"use strict";

// hmip-plugin-fusionsolar — entry point.
//
// CLI:  node src/index.js <pluginId> <hcuHost> <authTokenFile>
// Container entrypoint passes <hcuHost>=host.containers.internal and the
// auth token mounted at /TOKEN.

const log = require("./logger");
const config = require("./config");
const history = require("./history");
const hcuLog = require("./hcuLog");
const { HcuClient } = require("./hcu/client");
const M = require("./hcu/messages");
const cfgTpl = require("./hcu/configTemplate");
const { Poller } = require("./sun2000/poller");
const { buildDevices, handleControl } = require("./devices/mapper");
const { buildServer } = require("./dashboard/server");

const PLUGIN_FRIENDLY = {
	en: "Sun2000 / FusionSolar",
	de: "Sun2000 / FusionSolar",
};

const args = process.argv.slice(2);
const pluginId = args[0];
const hcuHost = args[1] || "host.containers.internal";
const tokenFile = args[2] || "/TOKEN";

if (!pluginId) {
	console.error("Usage: node src/index.js <pluginId> <hcuHost> <authTokenFile>");
	process.exit(2);
}

const authToken = HcuClient.readToken(tokenFile);
if (!authToken) {
	log.error("No auth token, exiting");
	process.exit(2);
}

config.load();

const hcu = new HcuClient({
	pluginId,
	host: hcuHost,
	authToken,
	friendlyName: PLUGIN_FRIENDLY,
});

const poller = new Poller(config.get());
let lastDevices = [];

function recomputeReadiness() {
	if (!config.isReady()) return "CONFIG_REQUIRED";
	const snap = poller.getSnapshot();
	if (!snap.connected && !snap.lastUpdate) return "CONFIG_REQUIRED";
	return "READY";
}

function publishStatusEvents() {
	if (!hcu.connected) return;
	const snap = poller.getSnapshot();
	const devices = buildDevices(config.get(), snap);
	lastDevices = devices;
	// Remember SN for the control mapper:
	config.get()._lastSn = snap.static?.sn;

	// Persist the inverter SN the very first time we see one. From then on
	// HmIP device IDs stay constant across plugin restarts even if a later
	// startup fails to read the SN immediately (slow Modbus, night mode).
	const liveSn = snap.static?.sn;
	const cfg = config.get();
	if (liveSn && !cfg.persistedSn) {
		log.info(`Persisting inverter SN ${liveSn} for stable device IDs`);
		config.save({ persistedSn: liveSn });
	}

	const included = hcu.includedDeviceIds;
	for (const d of devices) {
		if (!included.size || included.has(d.deviceId)) {
			hcu.send(M.statusEvent(pluginId, d.deviceId, d.features));
		}
	}
}

// Wire HCU events ───────────────────────────────────────────────
hcu.on("open", () => {
	hcu.sendPluginState(recomputeReadiness());
});

hcu.on("pluginStateRequest", (msg) => {
	hcu.respondPluginState(msg.id, recomputeReadiness());
});

hcu.on("discoverRequest", (msg) => {
	const devices = buildDevices(config.get(), poller.getSnapshot());
	lastDevices = devices;
	hcu.send(M.discoverResponse(pluginId, devices, msg.id));
});

hcu.on("statusRequest", (msg) => {
	const devices = buildDevices(config.get(), poller.getSnapshot());
	lastDevices = devices;
	const wantIds = new Set(msg.body?.deviceIds || []);
	const filtered = wantIds.size ? devices.filter((d) => wantIds.has(d.deviceId)) : devices;
	hcu.send(M.statusResponse(pluginId, filtered, msg.id));
});

hcu.on("controlRequest", async (msg) => {
	const { deviceId, features } = msg.body || {};
	const result = await handleControl(poller.getModbus(), config.get(), deviceId, features || []);
	hcu.send(M.controlResponse(pluginId, deviceId, result.success, result.error, msg.id));
	// Re-publish state shortly after the write so HmIP reflects reality.
	setTimeout(publishStatusEvents, 1500);
});

hcu.on("configTemplateRequest", (msg) => {
	const lang = msg.body?.languageCode || "de";
	hcu.send(M.configTemplateResponse(pluginId, cfgTpl.build(config.get(), lang), msg.id));
});

hcu.on("configUpdateRequest", async (msg) => {
	try {
		const next = cfgTpl.applyUpdate(config.get(), msg.body?.properties || {});
		config.save(next);
		await poller.restart(config.get());
		dashboard.maybeRestart(config.get());
		hcu.send(
			M.configUpdateResponse(
				pluginId,
				"APPLIED",
				config.isReady() ? "Konfiguration übernommen." : "Konfiguration gespeichert. Wechselrichter-Adresse fehlt.",
				msg.id
			)
		);
		hcu.sendPluginState(recomputeReadiness());
	} catch (e) {
		log.error("Config update failed:", e);
		hcu.send(M.configUpdateResponse(pluginId, "FAILED", e.message, msg.id));
	}
});

hcu.on("inclusion", () => publishStatusEvents());

// Wire poller events ───────────────────────────────────────────
poller.on("snapshot", (snap) => {
	history.pushSnapshot(snap);
	publishStatusEvents();
});

// Local debug dashboard ────────────────────────────────────────
const dashboard = (() => {
	let server = null;
	let activePort = null;

	function start(c) {
		if (!c.dashboardEnabled) return;
		const app = buildServer({
			getSnapshot: () => poller.getSnapshot(),
			getModbus: () => poller.getModbus(),
			getConfig: () => config.get(),
			saveConfig: async (patch) => {
				const next = config.save(patch);
				await poller.restart(next);
				return next;
			},
			getHcuStatus: () => ({
				connected: hcu.connected,
				includedDevices: hcu.includedDeviceIds.size,
				pluginId,
				host: hcuHost,
			}),
			getDevices: () => lastDevices,
		});
		server = app.listen(c.dashboardPort, "0.0.0.0", () => {
			activePort = c.dashboardPort;
			log.info(`Dashboard listening on :${c.dashboardPort}`);
		});
	}

	function stop() {
		return new Promise((res) => {
			if (!server) return res();
			server.close(() => {
				server = null;
				activePort = null;
				res();
			});
		});
	}

	async function maybeRestart(c) {
		const want = c.dashboardEnabled;
		const portChanged = c.dashboardPort !== activePort;
		if (server && (!want || portChanged)) await stop();
		if (want && !server) start(c);
	}

	return { start, stop, maybeRestart };
})();

// Boot ─────────────────────────────────────────────────────────
(async () => {
	await poller.start();
	dashboard.start(config.get());
	hcu.connect();
})();

process.on("SIGTERM", async () => {
	log.info("SIGTERM received, shutting down");
	poller.stop();
	await dashboard.stop();
	process.exit(0);
});
process.on("SIGINT", async () => {
	log.info("SIGINT received, shutting down");
	poller.stop();
	await dashboard.stop();
	process.exit(0);
});

process.on("unhandledRejection", (e) => log.error("UnhandledRejection:", e));
process.on("uncaughtException", (e) => log.error("UncaughtException:", e));

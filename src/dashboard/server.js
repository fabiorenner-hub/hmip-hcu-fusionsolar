"use strict";

const path = require("path");
const express = require("express");
const log = require("../logger");
const history = require("../history");
const hcuLog = require("../hcuLog");
const { REG } = require("../sun2000/registers");

function buildServer({ getSnapshot, getModbus, getConfig, saveConfig, getHcuStatus, getDevices }) {
	const app = express();
	app.use(express.json({ limit: "256kb" }));
	app.use(express.static(path.join(__dirname, "public"), { etag: true, maxAge: "1h" }));

	// ── Snapshot / overview ────────────────────────────────────────
	app.get("/api/snapshot", (_req, res) => {
		res.json(buildPayload());
	});

	function buildPayload() {
		return {
			snapshot: getSnapshot(),
			devices: getDevices(),
			hcu: getHcuStatus(),
			config: redactConfig(getConfig()),
			stats: {
				...history.stats(),
				selfSufficiency: history.selfSufficiency(),
			},
		};
	}

	// ── Server-Sent Events stream ──────────────────────────────────
	const sseClients = new Set();
	app.get("/api/stream", (req, res) => {
		res.set({
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		});
		res.flushHeaders();
		res.write(`retry: 3000\n\n`);
		send(res, "snapshot", buildPayload());
		sseClients.add(res);
		const ping = setInterval(() => res.write(": ping\n\n"), 20000);
		req.on("close", () => {
			clearInterval(ping);
			sseClients.delete(res);
		});
	});

	function broadcast(event, data) {
		const blob = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
		for (const c of sseClients) {
			try { c.write(blob); } catch {}
		}
	}

	function send(res, event, data) {
		res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
	}

	// Hook poller updates to SSE.
	const broadcastTimer = setInterval(() => {
		broadcast("snapshot", buildPayload());
	}, 2000);
	broadcastTimer.unref?.();

	// ── History / charts ───────────────────────────────────────────
	app.get("/api/history", (req, res) => {
		const sec = Math.min(21600, Math.max(60, parseInt(req.query.seconds, 10) || 3600));
		res.json({ window: sec, samples: history.range(sec), tracked: history.TRACK });
	});

	// ── Register catalog & manipulation ────────────────────────────
	app.get("/api/registers", (_req, res) => {
		const meta = {};
		for (const [name, def] of Object.entries(REG)) {
			meta[name] = {
				addr: def.addr,
				length: def.length,
				type: def.type,
				unit: def.unit,
				rw: def.rw,
				scale: def.scale || null,
			};
		}
		res.json(meta);
	});

	app.get("/api/registers/:name", async (req, res) => {
		try {
			const value = await getModbus().readRegister(req.params.name);
			res.json({ name: req.params.name, value });
		} catch (e) {
			res.status(500).json({ error: e.message });
		}
	});

	app.post("/api/registers/:name", async (req, res) => {
		try {
			const value = req.body?.value;
			if (value === undefined) return res.status(400).json({ error: "Missing value" });
			await getModbus().writeRegister(req.params.name, value);
			res.json({ ok: true });
		} catch (e) {
			res.status(500).json({ error: e.message });
		}
	});

	app.get("/api/raw/:addr/:len", async (req, res) => {
		try {
			const addr = parseInt(req.params.addr, 10);
			const len = Math.min(125, parseInt(req.params.len, 10) || 1);
			const words = await getModbus().readRaw(addr, len);
			res.json({ addr, length: len, words, hex: words.map((w) => "0x" + w.toString(16).padStart(4, "0")) });
		} catch (e) {
			res.status(500).json({ error: e.message });
		}
	});

	// Range scanner: walks a register window in chunks.
	app.get("/api/scan/:from/:to", async (req, res) => {
		try {
			const from = parseInt(req.params.from, 10);
			const to = parseInt(req.params.to, 10);
			if (!(to > from && to - from < 500)) return res.status(400).json({ error: "Invalid range" });
			const out = [];
			let addr = from;
			while (addr < to) {
				const chunk = Math.min(50, to - addr);
				try {
					const words = await getModbus().readRaw(addr, chunk);
					for (let i = 0; i < words.length; i += 1) {
						out.push({ addr: addr + i, raw: words[i], hex: "0x" + words[i].toString(16).padStart(4, "0") });
					}
				} catch (e) {
					out.push({ addr, error: e.message });
					break;
				}
				addr += chunk;
			}
			res.json({ from, to, items: out });
		} catch (e) {
			res.status(500).json({ error: e.message });
		}
	});

	// ── High-level control endpoints ───────────────────────────────
	const CONTROL_ACTIONS = {
		batteryMode: { reg: "batteryWorkingMode", values: { adaptive: 0, force_charge: 1, force_discharge: 2, stop: 3 } },
		chargeFromGrid: { reg: "chargeFromGridEnable", values: { off: 0, on: 1 } },
	};

	app.post("/api/control/:action", async (req, res) => {
		try {
			const action = req.params.action;
			const cfg = CONTROL_ACTIONS[action];
			if (cfg) {
				const v = cfg.values[req.body?.value];
				if (v === undefined) return res.status(400).json({ error: "Unknown value" });
				await getModbus().writeRegister(cfg.reg, v);
				return res.json({ ok: true });
			}
			if (action === "maxChargePower") {
				await getModbus().writeRegister("maxChargePower", parseInt(req.body.value, 10));
				return res.json({ ok: true });
			}
			if (action === "maxDischargePower") {
				await getModbus().writeRegister("maxDischargePower", parseInt(req.body.value, 10));
				return res.json({ ok: true });
			}
			if (action === "forcedChargeTargetSoc") {
				const pct = Math.max(0, Math.min(100, Number(req.body.value)));
				await getModbus().writeRegister("forcedChargeTargetSoc", pct);
				return res.json({ ok: true });
			}
			if (action === "activePowerLimit") {
				const pct = Math.max(0, Math.min(100, Number(req.body.value)));
				await getModbus().writeRegister("activePowerLimit", pct);
				return res.json({ ok: true });
			}
			res.status(404).json({ error: "Unknown action" });
		} catch (e) {
			res.status(500).json({ error: e.message });
		}
	});

	// ── Config ────────────────────────────────────────────────────
	app.get("/api/config", (_req, res) => {
		res.json(redactConfig(getConfig()));
	});

	app.post("/api/config", async (req, res) => {
		try {
			const merged = await saveConfig(req.body || {});
			res.json(redactConfig(merged));
			broadcast("snapshot", buildPayload());
		} catch (e) {
			res.status(500).json({ error: e.message });
		}
	});

	// ── Logs & diagnostics ────────────────────────────────────────
	app.get("/api/logs", (req, res) => {
		const n = Math.min(2000, parseInt(req.query.n, 10) || 500);
		res.json({ lines: log.tail(n) });
	});

	app.get("/api/hculog", (req, res) => {
		const n = Math.min(500, parseInt(req.query.n, 10) || 200);
		res.json({ messages: hcuLog.tail(n) });
	});

	app.get("/api/diagnostics", async (_req, res) => {
		const snap = getSnapshot();
		const cfg = getConfig();
		const tcpOk = snap.connected;
		const recentError = snap.lastError;
		const ageMs = snap.lastUpdate ? Date.now() - snap.lastUpdate : null;
		const m = getModbus();
		const mStatus = m.getStatus ? m.getStatus() : {};
		const reads = mStatus.reads || 0;
		const ok = mStatus.readsOk || 0;
		const timeouts = mStatus.readsTimeout || 0;
		const allTimeout = reads > 5 && ok === 0 && timeouts >= reads - 1;

		const checks = [
			{ id: "config", label: "Konfiguration vorhanden", ok: !!cfg.inverterHost, hint: cfg.inverterHost ? null : "Wechselrichter-IP fehlt" },
			{ id: "modbus_tcp", label: "Modbus TCP verbunden", ok: !!mStatus.connected, hint: mStatus.connected ? null : (recentError || "Nicht verbunden") },
			{ id: "modbus_replies", label: "Wechselrichter antwortet", ok: ok > 0, hint: allTimeout
				? "TCP ok, aber alle Lesevorgänge laufen ins Timeout. Mögliche Ursachen: (a) Wechselrichter im Nachtmodus / kein Sonnenlicht, (b) falsche Slave-ID, (c) anderer Modbus-Master blockiert die Verbindung."
				: ok > 0 ? `${ok}/${reads} Lesevorgänge erfolgreich` : "Noch keine Daten" },
			{ id: "freshness", label: "Daten aktuell (< 60 s)", ok: ageMs != null && ageMs < 60000, hint: ageMs == null ? "Noch keine Daten" : `Letzte Daten vor ${Math.round(ageMs / 1000)} s` },
			{ id: "hcu", label: "HCU WebSocket verbunden", ok: getHcuStatus().connected },
			{ id: "battery", label: "Speicher antwortet", ok: !cfg.hasBattery || ((snap.values || {}).batteryRunningStatus !== undefined && (snap.values || {}).batteryRunningStatus !== null), hint: cfg.hasBattery ? null : "Deaktiviert" },
			{ id: "meter", label: "Smart Meter antwortet", ok: !cfg.hasMeter || (snap.values || {}).meterStatus === 1, hint: cfg.hasMeter ? null : "Deaktiviert" },
		];
		res.json({
			checks,
			modbus: mStatus,
			environment: {
				node: process.version,
				platform: process.platform,
				uptimeSec: Math.round(process.uptime()),
				rss: process.memoryUsage().rss,
			},
		});
	});

	// Probe: try a small read against alternative Slave-IDs to find which
	// one responds. Only runs when Modbus is connected.
	app.post("/api/probe/slave", async (_req, res) => {
		try {
			const m = getModbus();
			const cfg = getConfig();
			const results = [];
			for (const id of [0, 1, 2, 3]) {
				try {
					m.client.setID(id);
					const r = await m.client.readHoldingRegisters(30000, 1); // model[0]
					results.push({ unitId: id, ok: true, sample: r.data[0] });
				} catch (e) {
					results.push({ unitId: id, ok: false, error: e.message });
				}
			}
			// Restore configured ID
			try { m.client.setID(cfg.inverterUnitId || 1); } catch {}
			res.json({ tested: results, configured: cfg.inverterUnitId });
		} catch (e) {
			res.status(500).json({ error: e.message });
		}
	});

	// Probe: TCP-only check — bypasses Modbus, just opens a socket to host:port.
	app.get("/api/probe/tcp", async (_req, res) => {
		const cfg = getConfig();
		const net = require("net");
		const start = Date.now();
		const sock = new net.Socket();
		const timeout = 4000;
		const done = (result) => {
			try { sock.destroy(); } catch {}
			res.json({ host: cfg.inverterHost, port: cfg.inverterPort, durationMs: Date.now() - start, ...result });
		};
		sock.setTimeout(timeout);
		sock.once("connect", () => done({ ok: true }));
		sock.once("timeout", () => done({ ok: false, error: "timeout" }));
		sock.once("error", (e) => done({ ok: false, error: e.message }));
		sock.connect(cfg.inverterPort || 502, cfg.inverterHost);
	});

	app.get("/healthz", (_req, res) => {
		const s = getSnapshot();
		res.status(s.connected ? 200 : 503).json({
			connected: s.connected,
			lastUpdate: s.lastUpdate,
			lastError: s.lastError,
		});
	});

	app.broadcastSnapshot = () => broadcast("snapshot", buildPayload());
	return app;
}

function redactConfig(c) {
	return { ...c, cloudPassword: c.cloudPassword ? "•••" : "" };
}

module.exports = { buildServer };

"use strict";

// Sun2000 / HmIP Plugin · Dashboard frontend
// No framework, no build step. Single-page with hash-routed tabs, SSE
// stream for live updates, vanilla canvas charts.

const I18N = {
	de: {
		"tab.overview": "Übersicht",
		"tab.live": "Live",
		"tab.inverter": "Wechselrichter",
		"tab.battery": "Speicher",
		"tab.grid": "Netz",
		"tab.control": "Steuerung",
		"tab.registers": "Modbus",
		"tab.hcu": "HCU",
		"tab.config": "Konfig",
		"tab.logs": "Logs",
		"tab.diag": "Diagnose",
		"overview.pv": "PV-Erzeugung",
		"overview.ac": "Wechselrichter AC",
		"overview.grid": "Netz",
		"overview.battery": "Speicher",
		"overview.house": "Hausverbrauch",
		"overview.hcu": "HCU-Verbindung",
		"overview.todayPeaks": "Tagesspitzen",
		"connected": "verbunden",
		"disconnected": "getrennt",
		"saved": "Gespeichert um",
	},
	en: {
		"tab.overview": "Overview",
		"tab.live": "Live",
		"tab.inverter": "Inverter",
		"tab.battery": "Battery",
		"tab.grid": "Grid",
		"tab.control": "Control",
		"tab.registers": "Modbus",
		"tab.hcu": "HCU",
		"tab.config": "Config",
		"tab.logs": "Logs",
		"tab.diag": "Diagnostics",
		"overview.pv": "PV production",
		"overview.ac": "Inverter AC",
		"overview.grid": "Grid",
		"overview.battery": "Battery",
		"overview.house": "House load",
		"overview.hcu": "HCU connection",
		"overview.todayPeaks": "Today's peaks",
		"connected": "connected",
		"disconnected": "disconnected",
		"saved": "Saved at",
	},
};
const TABS = [
	"overview", "live", "inverter", "battery", "grid",
	"control", "registers", "hcu", "config", "logs", "diag",
];
let lang = localStorage.getItem("lang") || "de";
let theme = localStorage.getItem("theme") || "dark";
document.documentElement.dataset.theme = theme;

const $ = (id) => document.getElementById(id);
const t = (key) => I18N[lang][key] || I18N.de[key] || key;

const fmt = {
	w: (v) => v == null ? "–" : `${Math.round(v).toLocaleString("de-DE")} W`,
	kwh: (v) => v == null ? "–" : `${(+v).toFixed(2)} kWh`,
	pct: (v) => v == null ? "–" : `${(+v).toFixed(1)} %`,
	v: (v) => v == null ? "–" : `${(+v).toFixed(1)} V`,
	a: (v) => v == null ? "–" : `${(+v).toFixed(2)} A`,
	hz: (v) => v == null ? "–" : `${(+v).toFixed(2)} Hz`,
	deg: (v) => v == null ? "–" : `${(+v).toFixed(1)} °C`,
	rel: (ms) => ms == null ? "–" : `${Math.round((Date.now() - ms) / 1000)} s`,
};

let state = { snapshot: null, devices: [], hcu: {}, config: {}, stats: {} };
let registerMeta = null;
let history = null;
let charts = {};
let logsRaw = [];

// ── Layout ─────────────────────────────────────────────────────
function buildTabs() {
	const bar = $("tabBar");
	bar.innerHTML = TABS.map(
		(id) => `<button data-tab="${id}">${t("tab." + id)}</button>`
	).join("");
	bar.querySelectorAll("button").forEach((b) => {
		b.addEventListener("click", () => activateTab(b.dataset.tab));
	});
	const initial = location.hash.replace("#", "") || "overview";
	activateTab(TABS.includes(initial) ? initial : "overview");
}

function activateTab(name) {
	location.hash = name;
	document.querySelectorAll("#tabBar button").forEach((b) =>
		b.classList.toggle("active", b.dataset.tab === name)
	);
	document.querySelectorAll(".tab").forEach((s) =>
		s.classList.toggle("active", s.id === "tab-" + name)
	);
	if (name === "logs") refreshLogs();
	if (name === "registers" && !registerMeta) loadRegisters();
	if (name === "config" && !$("configForm").children.length) loadConfig();
	if (name === "live" || name === "battery" || name === "grid") refreshHistory();
	if (name === "hcu") refreshHcuMessages();
	if (name === "diag") refreshDiag();
}
window.addEventListener("hashchange", () => {
	const n = location.hash.replace("#", "");
	if (TABS.includes(n)) activateTab(n);
});

// ── Theme & language ───────────────────────────────────────────
$("themeToggle").addEventListener("click", () => {
	theme = theme === "dark" ? "light" : "dark";
	document.documentElement.dataset.theme = theme;
	localStorage.setItem("theme", theme);
});
$("langSelect").value = lang;
$("langSelect").addEventListener("change", (e) => {
	lang = e.target.value;
	localStorage.setItem("lang", lang);
	document.documentElement.lang = lang;
	buildTabs();
	render();
});

// ── Server-Sent Events ─────────────────────────────────────────
function openStream() {
	const es = new EventSource("/api/stream");
	es.addEventListener("snapshot", (e) => {
		try {
			const data = JSON.parse(e.data);
			state = { ...state, ...data };
			render();
		} catch (err) {
			console.warn("Bad SSE payload", err);
		}
	});
	es.addEventListener("error", () => {
		setConn(false, "Stream getrennt");
	});
}

// ── Header / status pill ───────────────────────────────────────
function setConn(ok, text, sub) {
	const dot = $("connDot");
	dot.className = "dot " + (ok ? "good" : "bad");
	$("connText").textContent = text;
	if (sub !== undefined) $("lastUpdate").textContent = sub;
}

// ── Render entry point ─────────────────────────────────────────
function render() {
	const s = state.snapshot || {};
	const v = s.values || {};
	const stat = state.stats || {};

	const ok = s.connected;
	setConn(ok, ok ? `Modbus · ${s.static?.model || "Sun2000"}` : "Modbus getrennt",
		s.lastUpdate ? `· vor ${fmt.rel(s.lastUpdate)}` : "");

	// Overview KPIs
	$("kpiPv").textContent = fmt.w(v.inputPower);
	$("kpiPvDay").textContent = `heute ${fmt.kwh(v.dailyYield)} · gesamt ${fmt.kwh(v.totalYield)}`;
	const pvBar = clampBar(v.inputPower, s.static?.ratedPower);
	$("kpiPvBar").style.width = pvBar + "%";

	$("kpiAc").textContent = fmt.w(v.activePower);
	$("kpiInv").textContent = `${v.deviceStatusText || "–"} · ${fmt.deg(v.internalTemp)}`;

	$("kpiGrid").textContent = fmt.w(v.meterActivePower);
	$("kpiGridEnergy").textContent =
		`Bezug ${fmt.kwh(v.meterPositiveActiveEnergy)} · Einspeisung ${fmt.kwh(v.meterReverseActiveEnergy)}`;

	$("kpiBattery").textContent = fmt.pct(v.batterySoc);
	$("kpiBatteryPower").textContent = `${fmt.w(v.batteryChargeDischargePower)} · ${v.batteryRunningStatusText || "–"}`;
	$("kpiBatteryBar").style.width = (v.batterySoc || 0) + "%";

	const inv = v.activePower || 0;
	const grid = v.meterActivePower || 0;
	const house = Math.max(0, inv - grid);
	$("kpiHouse").textContent = fmt.w(house);
	$("kpiHouseSelf").textContent = stat.selfSufficiency != null
		? `Eigenverbrauch ${(stat.selfSufficiency * 100).toFixed(1)} %`
		: "Eigenverbrauch –";

	$("kpiHcu").textContent = state.hcu?.connected ? t("connected") : t("disconnected");
	$("kpiHcuDetails").textContent = `${state.hcu?.includedDevices ?? 0} Geräte · ${state.hcu?.pluginId || "–"}`;

	renderPeaks(stat);
	renderFlow(v, house);
	renderInverter(s);
	renderBattery(s);
	renderGrid(s);
	renderHcuPanel();
}

function clampBar(v, max) {
	if (!max || !v) return 0;
	return Math.max(0, Math.min(100, (v / max) * 100));
}

// ── Tagesspitzen ──────────────────────────────────────────────
function renderPeaks(stat) {
	const items = [
		["PV", fmt.w(stat.peakPv)],
		["Hausverbrauch", fmt.w(stat.peakHouse)],
		["Bezug", fmt.w(stat.peakImport)],
		["Einspeisung", fmt.w(stat.peakExport)],
		["Speicher laden", fmt.w(stat.peakBatteryCharge)],
		["Speicher entladen", fmt.w(stat.peakBatteryDischarge)],
		["SOC min", stat.minSoc != null ? `${stat.minSoc.toFixed(1)} %` : "–"],
		["SOC max", stat.maxSoc != null ? `${stat.maxSoc.toFixed(1)} %` : "–"],
	];
	$("peaks").innerHTML = items.map(([k, v]) =>
		`<div class="peak"><span class="muted">${k}</span><strong>${v}</strong></div>`
	).join("");
}

// ── Energy-flow SVG ───────────────────────────────────────────
function renderFlow(v, houseLoad) {
	const pv = v.inputPower || 0;
	const grid = v.meterActivePower || 0;          // + export, − import
	const battery = v.batteryChargeDischargePower || 0; // + charge, − discharge
	const flow = $("flow");

	flow.innerHTML = `
		<defs>
			<marker id="arrowH" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto">
				<path d="M0 0 L10 5 L0 10 Z" fill="var(--accent)" />
			</marker>
		</defs>
		${nodeBox(80, 50, "PV", fmt.w(pv), "var(--good)")}
		${nodeBox(360, 30, "Wechselrichter", fmt.w(v.activePower), "var(--accent)")}
		${nodeBox(640, 50, "Netz", fmt.w(grid), grid > 0 ? "var(--good)" : "var(--warn)")}
		${nodeBox(360, 200, "Haus", fmt.w(houseLoad), "var(--text)")}
		${nodeBox(640, 200, "Speicher", fmt.pct(v.batterySoc), battery > 0 ? "var(--good)" : "var(--warn)")}
		${flowLine(170, 90, 360, 90, pv > 50)}
		${flowLine(540, 90, 640, 90, true, grid > 50 ? "→" : grid < -50 ? "←" : "")}
		${flowLine(450, 130, 450, 200, houseLoad > 50)}
		${flowLine(540, 230, 640, 230, true, battery > 50 ? "→" : battery < -50 ? "←" : "")}
	`;
}
function nodeBox(x, y, label, value, color) {
	return `
		<g transform="translate(${x},${y})">
			<rect width="180" height="80" rx="10" ry="10" fill="var(--panel)" stroke="${color}" stroke-width="1.5"/>
			<text x="90" y="32" text-anchor="middle" font-size="13" fill="var(--muted)">${escape(label)}</text>
			<text x="90" y="56" text-anchor="middle" font-size="20" font-weight="600" fill="${color}">${escape(value)}</text>
		</g>
	`;
}
function flowLine(x1, y1, x2, y2, active, hint = "") {
	const cls = active ? "flow-line active" : "flow-line";
	return `
		<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cls}" />
		${hint ? `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 6}" text-anchor="middle" fill="var(--accent)" font-size="14">${hint}</text>` : ""}
	`;
}

// ── Inverter tab ──────────────────────────────────────────────
function renderInverter(s) {
	if (!document.getElementById("tab-inverter").classList.contains("active") && !document.getElementById("tab-overview").classList.contains("active")) {
		// still update silently so switching is instant
	}
	const v = s.values || {};
	const st = s.static || {};
	dl("invInfo", [
		["Modell", st.model || "–"],
		["Seriennummer", st.sn || "–"],
		["Firmware", st.firmwareVersion || "–"],
		["Nennleistung", fmt.w(st.ratedPower)],
	]);
	dl("invAc", [
		["Wirkleistung", fmt.w(v.activePower)],
		["Blindleistung", v.reactivePower != null ? `${Math.round(v.reactivePower)} var` : "–"],
		["Leistungsfaktor", v.powerFactor != null ? v.powerFactor.toFixed(3) : "–"],
		["Frequenz", fmt.hz(v.gridFrequency)],
		["Wirkungsgrad", fmt.pct(v.efficiency)],
	]);
	const pv = [
		["1", v.pv1Voltage, v.pv1Current],
		["2", v.pv2Voltage, v.pv2Current],
		["3", v.pv3Voltage, v.pv3Current],
		["4", v.pv4Voltage, v.pv4Current],
	].filter((r) => (r[1] != null && r[1] !== 0) || (r[2] != null && r[2] !== 0));
	$("pvTable").querySelector("tbody").innerHTML = (pv.length ? pv : [["1", null, null]]).map(
		([n, vo, cu]) => `<tr><td>PV${n}</td><td>${fmt.v(vo)}</td><td>${fmt.a(cu)}</td><td>${fmt.w(vo != null && cu != null ? vo * cu : null)}</td></tr>`
	).join("");
	const phases = [
		["L1", v.phaseAVoltage, v.phaseACurrent],
		["L2", v.phaseBVoltage, v.phaseBCurrent],
		["L3", v.phaseCVoltage, v.phaseCCurrent],
	];
	$("phaseTable").querySelector("tbody").innerHTML = phases.map(
		([n, vo, cu]) => `<tr><td>${n}</td><td>${fmt.v(vo)}</td><td>${fmt.a(cu)}</td><td>${fmt.w(vo != null && cu != null ? vo * cu : null)}</td></tr>`
	).join("");
	dl("invYield", [
		["Heute", fmt.kwh(v.dailyYield)],
		["Gesamt", fmt.kwh(v.totalYield)],
	]);
	dl("invStatus", [
		["Status", v.deviceStatusText || "–"],
		["Innentemperatur", fmt.deg(v.internalTemp)],
		["Isolationswiderstand", v.insulationRes != null ? v.insulationRes.toFixed(2) + " MΩ" : "–"],
	]);
}

// ── Battery tab ───────────────────────────────────────────────
function renderBattery(s) {
	const v = s.values || {};
	const st = s.static || {};
	const soc = v.batterySoc;
	const arc = $("batteryArc");
	const len = 251;
	const pct = soc != null ? Math.max(0, Math.min(100, soc)) : 0;
	if (arc) arc.setAttribute("stroke-dashoffset", String(len - (len * pct) / 100));
	$("batteryText").textContent = soc != null ? soc.toFixed(1) + "%" : "–";

	dl("batMain", [
		["Zustand", v.batteryRunningStatusText || "–"],
		["Leistung", fmt.w(v.batteryChargeDischargePower)],
		["SOC", fmt.pct(soc)],
		["Bus-Spannung", fmt.v(v.batteryBusVoltage)],
		["Backup-Zeit", v.batteryBackupTime != null ? v.batteryBackupTime + " min" : "–"],
		["Nennkapazität", st.batteryRatedCapacity ? (st.batteryRatedCapacity / 1000).toFixed(2) + " kWh" : "–"],
	]);
	dl("batToday", [
		["Geladen", fmt.kwh(v.batteryDayChargeCapacity)],
		["Entladen", fmt.kwh(v.batteryDayDischargeCapacity)],
	]);
	dl("batLifetime", [
		["Geladen gesamt", fmt.kwh(v.batteryTotalCharge)],
		["Entladen gesamt", fmt.kwh(v.batteryTotalDischarge)],
	]);
}

// ── Grid tab ──────────────────────────────────────────────────
function renderGrid(s) {
	const v = s.values || {};
	dl("meterMain", [
		["Status", v.meterStatus === 1 ? "online" : v.meterStatus === 0 ? "offline" : "–"],
		["Wirkleistung", fmt.w(v.meterActivePower)],
		["Blindleistung", v.meterReactivePower != null ? Math.round(v.meterReactivePower) + " var" : "–"],
		["Leistungsfaktor", v.meterPowerFactor != null ? v.meterPowerFactor.toFixed(3) : "–"],
		["Frequenz", fmt.hz(v.meterFrequency)],
	]);
	$("meterPhases").querySelector("tbody").innerHTML = [
		["L1", v.meterPhaseAVoltage, v.meterPhaseACurrent],
		["L2", v.meterPhaseBVoltage, v.meterPhaseBCurrent],
		["L3", v.meterPhaseCVoltage, v.meterPhaseCCurrent],
	].map(([n, vo, cu]) => `<tr><td>${n}</td><td>${fmt.v(vo)}</td><td>${fmt.a(cu)}</td></tr>`).join("");
	dl("meterEnergy", [
		["Bezug heute", fmt.kwh(v.meterPositiveActiveEnergy)],
		["Einspeisung heute", fmt.kwh(v.meterReverseActiveEnergy)],
	]);
}

// ── HCU tab ───────────────────────────────────────────────────
function renderHcuPanel() {
	dl("hcuInfo", [
		["Plugin-ID", state.hcu?.pluginId || "–"],
		["HCU-Host", state.hcu?.host || "–"],
		["Verbunden", state.hcu?.connected ? "ja" : "nein"],
		["Inkludierte Geräte", state.hcu?.includedDevices ?? 0],
	]);
	const root = $("devicesList");
	const ds = state.devices || [];
	if (!ds.length) {
		root.innerHTML = '<p class="muted">Noch keine Geräte gemeldet.</p>';
	} else {
		root.innerHTML = ds.map((d) => `
			<div class="device">
				<h4>${escape(d.friendlyName)}</h4>
				<div>
					<span class="pill">${d.deviceType}</span>
					<span class="pill">${escape(d.modelType || "")}</span>
					<span class="pill">FW ${escape(d.firmwareVersion || "")}</span>
					<span class="pill mono">${escape(d.deviceId)}</span>
				</div>
				<div class="feature">${escape(JSON.stringify(d.features))}</div>
			</div>
		`).join("");
	}
}

async function refreshHcuMessages() {
	const r = await fetch("/api/hculog?n=200").then((x) => x.json());
	const types = new Set(r.messages.map((m) => m.type));
	const sel = $("hcuTypeFilter");
	const current = sel.value;
	sel.innerHTML = `<option value="">alle Typen</option>` +
		[...types].sort().map((tp) => `<option ${tp === current ? "selected" : ""}>${tp}</option>`).join("");
	const dirF = $("hcuFilter").value;
	const typeF = sel.value;
	$("hcuMessages").innerHTML = r.messages
		.filter((m) => (!dirF || m.dir === dirF) && (!typeF || m.type === typeF))
		.reverse()
		.map((m) => `
			<details class="msg ${m.dir}">
				<summary>
					<span class="dir">${m.dir === "in" ? "▼" : "▲"}</span>
					<span class="time mono">${new Date(m.t).toLocaleTimeString()}</span>
					<span class="type">${m.type}</span>
					<span class="muted mono">${m.id || ""}</span>
				</summary>
				<pre class="mono">${escape(JSON.stringify(m.body, null, 2))}</pre>
			</details>
		`).join("");
}
$("hcuFilter").addEventListener("change", refreshHcuMessages);
$("hcuTypeFilter").addEventListener("change", refreshHcuMessages);
$("hcuRefresh").addEventListener("click", refreshHcuMessages);

// ── History / charts ──────────────────────────────────────────
async function refreshHistory() {
	const sec = parseInt($("liveWindow").value, 10) || 3600;
	const r = await fetch(`/api/history?seconds=${sec}`).then((x) => x.json());
	history = r.samples;
	if (!history.length) return;
	if (!charts.power) {
		charts.power = new TimeChart($("chartPower"), { yLabel: "W", yFormat: (v) => Math.round(v) + " W", zeroLine: true });
		charts.soc = new TimeChart($("chartSoc"), { yFormat: (v) => v.toFixed(0) + " %", min: 0, max: 100 });
		charts.temp = new TimeChart($("chartTemp"), { yFormat: (v) => v.toFixed(1) + " °C" });
		charts.battery = new TimeChart($("chartBattery"), { yFormat: (v) => v.toFixed(0), zeroLine: true });
		charts.grid = new TimeChart($("chartGrid"), { yFormat: (v) => Math.round(v) + " W", zeroLine: true });
	}
	charts.power.setSeries([
		{ key: "inputPower", label: "PV", color: "#4fbfa8", area: true },
		{ key: "activePower", label: "AC", color: "#60a5fa" },
		{ key: "houseLoad", label: "Haus", color: "#f59e0b" },
		{ key: "meterActivePower", label: "Netz", color: "#a78bfa" },
		{ key: "batteryChargeDischargePower", label: "Speicher", color: "#34d399" },
	]);
	charts.power.setData(history);
	$("legendPower").innerHTML = charts.power.opts.series.map(
		(s) => `<span><i style="background:${s.color}"></i>${s.label}</span>`
	).join("");

	charts.soc.setSeries([{ key: "batterySoc", label: "SOC", color: "#34d399", area: true }]);
	charts.soc.setData(history, { min: 0, max: 100 });

	charts.temp.setSeries([{ key: "internalTemp", label: "T", color: "#ef4444" }]);
	charts.temp.setData(history);

	charts.battery.setSeries([
		{ key: "batteryChargeDischargePower", label: "P", color: "#34d399" },
		{ key: "batterySoc", label: "SOC", color: "#60a5fa" },
	]);
	charts.battery.setData(history);

	charts.grid.setSeries([
		{ key: "meterActivePower", label: "Netz", color: "#a78bfa", area: true },
	]);
	charts.grid.setData(history);

	$("liveAge").textContent = `${history.length} Punkte · neuester ${fmt.rel(history[history.length - 1].t)}`;
}
$("liveWindow").addEventListener("change", refreshHistory);
setInterval(() => {
	if ($("liveAuto").checked && document.getElementById("tab-live").classList.contains("active")) {
		refreshHistory();
	}
}, 5000);

// ── Registers tab ─────────────────────────────────────────────
async function loadRegisters() {
	registerMeta = await fetch("/api/registers").then((r) => r.json());
	renderRegTable();
}

function renderRegTable() {
	const search = $("regSearch").value.toLowerCase();
	const filt = $("regFilter").value;
	const base = $("regBase").value;
	const tbody = document.querySelector("#regTable tbody");
	tbody.innerHTML = "";
	for (const [name, def] of Object.entries(registerMeta)) {
		if (filt === "rw" && def.rw !== "rw") continue;
		if (filt === "r" && def.rw !== "r") continue;
		if (search && !name.toLowerCase().includes(search) && String(def.addr) !== search) continue;
		const tr = document.createElement("tr");
		tr.innerHTML = `
			<td class="mono">${name}</td>
			<td class="mono">${base === "hex" ? "0x" + def.addr.toString(16) : def.addr}</td>
			<td>${def.type}</td>
			<td>${def.unit || ""}</td>
			<td class="mono" id="val-${name}">…</td>
			<td>
				<button class="ghost" data-read="${name}">lesen</button>
				${def.rw === "rw" ? `<button class="ghost" data-write="${name}">schreiben</button>` : ""}
			</td>`;
		tbody.appendChild(tr);
	}
}
["regSearch", "regFilter", "regBase"].forEach((id) => $(id).addEventListener("input", () => registerMeta && renderRegTable()));
document.querySelector("#regTable tbody").addEventListener("click", async (e) => {
	const r = e.target.dataset.read;
	const w = e.target.dataset.write;
	if (r) {
		const out = await fetch("/api/registers/" + r).then((x) => x.json());
		document.getElementById("val-" + r).textContent = out.error ? "ERR " + out.error : String(out.value);
	}
	if (w) {
		const v = prompt(`Wert für ${w}?`);
		if (v === null) return;
		const num = Number(v);
		if (Number.isNaN(num)) return alert("Ungültige Zahl");
		if (!confirm(`Wirklich ${w} auf ${num} setzen?`)) return;
		const out = await fetch("/api/registers/" + w, {
			method: "POST", headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ value: num }),
		}).then((x) => x.json());
		alert(out.ok ? "OK" : "Fehler: " + out.error);
	}
});
$("regReadAll").addEventListener("click", async () => {
	for (const name of Object.keys(registerMeta)) {
		try {
			const out = await fetch("/api/registers/" + name).then((x) => x.json());
			const cell = document.getElementById("val-" + name);
			if (cell) cell.textContent = out.error ? "ERR" : String(out.value);
		} catch {}
	}
});
$("regExport").addEventListener("click", async () => {
	const lines = ["name,addr,type,unit,value"];
	for (const [name, def] of Object.entries(registerMeta)) {
		const cell = document.getElementById("val-" + name);
		const v = cell ? cell.textContent : "";
		lines.push(`${name},${def.addr},${def.type},${def.unit || ""},"${v}"`);
	}
	downloadText("registers.csv", lines.join("\n"));
});

$("rawRead").addEventListener("click", async () => {
	const a = $("rawAddr").value, l = $("rawLen").value || 2;
	if (!a) return;
	const r = await fetch(`/api/raw/${a}/${l}`).then((x) => x.json());
	$("rawResult").textContent = r.error ? "ERR " + r.error : `[${r.words.join(", ")}]  hex=[${r.hex.join(", ")}]`;
});
$("scanRun").addEventListener("click", runScan);
$("scanCsv").addEventListener("click", () => exportScan());
let lastScan = [];
async function runScan() {
	const from = parseInt($("scanFrom").value, 10);
	const to = parseInt($("scanTo").value, 10);
	$("scanOut").textContent = "Scannt …";
	const r = await fetch(`/api/scan/${from}/${to}`).then((x) => x.json());
	if (r.error) { $("scanOut").textContent = "Fehler: " + r.error; return; }
	lastScan = r.items;
	$("scanOut").innerHTML = `<table class="zebra"><thead><tr><th>Addr</th><th>dec</th><th>hex</th></tr></thead><tbody>${
		r.items.map((it) => `<tr><td class="mono">${it.addr}</td><td class="mono">${it.raw ?? "ERR"}</td><td class="mono">${it.hex || ""}</td></tr>`).join("")
	}</tbody></table>`;
}
function exportScan() {
	if (!lastScan.length) return alert("Erst einen Scan ausführen");
	const lines = ["addr,dec,hex"];
	for (const it of lastScan) lines.push(`${it.addr},${it.raw ?? ""},${it.hex || ""}`);
	downloadText("scan.csv", lines.join("\n"));
}

// ── Control tab ───────────────────────────────────────────────
$("ctlSoc").addEventListener("input", (e) => $("ctlSocVal").textContent = e.target.value + " %");
$("ctlLimit").addEventListener("input", (e) => $("ctlLimitVal").textContent = e.target.value + " %");
document.querySelectorAll("[data-ctl]").forEach((btn) => {
	btn.addEventListener("click", async () => {
		const action = btn.dataset.ctl;
		const fromId = btn.dataset.from;
		const value = btn.dataset.val ?? (fromId ? $(fromId).value : null);
		if (!confirm(`${action} = ${value}\n\nWirklich an den Wechselrichter senden?`)) return;
		btn.disabled = true;
		try {
			const r = await fetch("/api/control/" + action, {
				method: "POST", headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ value }),
			}).then((x) => x.json());
			alert(r.ok ? "OK" : "Fehler: " + (r.error || "unknown"));
		} finally {
			btn.disabled = false;
		}
	});
});

// ── Logs tab ──────────────────────────────────────────────────
async function refreshLogs() {
	const r = await fetch("/api/logs?n=1000").then((x) => x.json());
	logsRaw = r.lines || [];
	renderLogs();
}
function renderLogs() {
	const lvl = $("logLevel").value;
	const search = $("logSearch").value.toLowerCase();
	const filtered = logsRaw.filter((l) => {
		if (lvl && !l.includes(`[${lvl}]`)) return false;
		if (search && !l.toLowerCase().includes(search)) return false;
		return true;
	});
	$("logBox").textContent = filtered.join("\n");
	$("logBox").scrollTop = $("logBox").scrollHeight;
}
["logLevel", "logSearch"].forEach((id) => $(id).addEventListener("input", renderLogs));
$("logClear").addEventListener("click", () => { logsRaw = []; renderLogs(); });
setInterval(() => { if ($("logAuto").checked && document.getElementById("tab-logs").classList.contains("active")) refreshLogs(); }, 3000);

// ── Config tab ────────────────────────────────────────────────
async function loadConfig() {
	const cfg = await fetch("/api/config").then((r) => r.json());
	const fields = [
		["inverterHost", "Sun2000 Host", "text", "z. B. 192.168.1.50"],
		["inverterPort", "Modbus Port", "number"],
		["inverterUnitId", "Modbus Slave-ID", "number"],
		["pollIntervalMs", "Abfrage-Intervall (ms)", "number"],
		["hasBattery", "LUNA2000 vorhanden", "checkbox"],
		["hasMeter", "DTSU666-H vorhanden", "checkbox"],
		["enableBatteryForcedCharge", "Speicher-Schalter freischalten", "checkbox"],
		["dashboardEnabled", "Dashboard aktiv", "checkbox"],
		["dashboardPort", "Dashboard-Port", "number"],
		["cloudEnabled", "Cloud-Fallback", "checkbox"],
		["cloudUser", "FusionSolar User", "text"],
		["cloudPassword", "FusionSolar Passwort", "password"],
		["cloudSubdomain", "Region", "text"],
	];
	const f = $("configForm");
	f.innerHTML = "";
	for (const [k, label, type, hint] of fields) {
		const wrapper = document.createElement("label");
		wrapper.innerHTML = `<span>${label}</span>${hint ? `<span class="desc">${hint}</span>` : ""}`;
		const input = document.createElement("input");
		input.type = type;
		input.name = k;
		if (type === "checkbox") input.checked = !!cfg[k];
		else input.value = cfg[k] ?? "";
		wrapper.appendChild(input);
		f.appendChild(wrapper);
	}
}
$("saveConfig").addEventListener("click", async () => {
	const f = $("configForm");
	const data = {};
	[...f.querySelectorAll("input")].forEach((i) => {
		if (i.type === "checkbox") data[i.name] = i.checked;
		else if (i.type === "number") data[i.name] = i.value === "" ? null : Number(i.value);
		else data[i.name] = i.value;
	});
	if (data.cloudPassword === "" || data.cloudPassword === "•••") delete data.cloudPassword;
	await fetch("/api/config", {
		method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
	}).then((r) => r.json());
	$("saveStatus").textContent = `${t("saved")} ${new Date().toLocaleTimeString()}`;
});

// ── Diagnostics ───────────────────────────────────────────────
async function refreshDiag() {
	const r = await fetch("/api/diagnostics").then((x) => x.json());
	$("diagChecks").innerHTML = r.checks.map((c) => `
		<div class="check ${c.ok ? "ok" : "bad"}">
			<span class="dot ${c.ok ? "good" : "bad"}"></span>
			<strong>${c.label}</strong>
			${c.hint ? `<span class="muted">${escape(c.hint)}</span>` : ""}
		</div>
	`).join("");
	dl("diagEnv", [
		["Node", r.environment.node],
		["Plattform", r.environment.platform],
		["Uptime", r.environment.uptimeSec + " s"],
		["RSS Memory", (r.environment.rss / 1024 / 1024).toFixed(1) + " MB"],
	]);
	const stat = state.stats || {};
	dl("diagStats", [
		["History-Punkte", stat.samples ?? "–"],
		["Aufbewahrung", stat.retentionSeconds ? Math.round(stat.retentionSeconds / 60) + " min" : "–"],
		["Eigenverbrauchsanteil", stat.selfSufficiency != null ? (stat.selfSufficiency * 100).toFixed(1) + " %" : "–"],
	]);
}

// ── Helpers ───────────────────────────────────────────────────
function dl(id, rows) {
	$(id).innerHTML = rows.map(
		([k, v]) => `<dt>${escape(k)}</dt><dd>${escape(String(v ?? "–"))}</dd>`
	).join("");
}
function downloadText(name, content) {
	const a = document.createElement("a");
	a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(content);
	a.download = name;
	a.click();
}
function escape(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({
		"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
	}[c]));
}

// ── Boot ──────────────────────────────────────────────────────
buildTabs();
openStream();
fetch("/api/snapshot").then((r) => r.json()).then((d) => { state = d; render(); });

"use strict";

// Event_Detector — turns runtime state changes into Notification_Events.
//
// It is a passive observer: it never mutates or blocks the poller/HCU. It
// holds the minimal previous-state needed for edge detection and reads all
// enable flags and thresholds live from getConfig().notifications so config
// changes take effect immediately (no restart).

const { EventEmitter } = require("events");

// Documented category catalog (keys + defaults). The persisted config in
// config.js DEFAULTS mirrors these; this is the single source of truth for
// the catalog contents.
const CATEGORIES = {
	connection: { defaultEnabled: true, defaultMinSeverity: "warning" },
	"modbus-error": { defaultEnabled: true, defaultMinSeverity: "warning" },
	hcu: { defaultEnabled: true, defaultMinSeverity: "warning" },
	"battery-soc-low": { defaultEnabled: true, defaultMinSeverity: "warning" },
	"battery-soc-full": { defaultEnabled: false, defaultMinSeverity: "info" },
	"energy-milestone": { defaultEnabled: false, defaultMinSeverity: "info" },
	"power-peak": { defaultEnabled: false, defaultMinSeverity: "info" },
	"device-status": { defaultEnabled: true, defaultMinSeverity: "info" },
	"inverter-alarm": { defaultEnabled: true, defaultMinSeverity: "warning" },
	"plugin-update": { defaultEnabled: true, defaultMinSeverity: "info" },
};

let seq = 0;
function eventId(t) {
	seq = (seq + 1) % 1e6;
	return `evt_${t}_${seq}`;
}

function isNum(v) {
	return typeof v === "number" && !Number.isNaN(v);
}

class EventDetector extends EventEmitter {
	constructor(getConfig, opts = {}) {
		super();
		this._getConfig = getConfig;
		this._now = opts.now || Date.now;
		this.prev = {
			connState: null,
			lastError: null,
			inLockdown: false,
			soc: null,
			dailyYield: null,
			deviceStatus: null,
			peakFiredDay: null,
			activeAlarmCodes: new Set(),
		};
	}

	_enabled(category) {
		const c = (this._getConfig().notifications || {}).categories || {};
		return !!(c[category] && c[category].enabled);
	}

	_emit(category, severity, title, message, data) {
		if (!this._enabled(category)) return; // disabled → no event (Req 1.3)
		const t = this._now();
		this.emit("event", { id: eventId(t), category, severity, title, message, data, t, read: false });
	}

	// poller "snapshot" + modbus getStatus()
	onSnapshot(snapshot, modbusStatus) {
		const v = (snapshot && snapshot.values) || {};
		const tcp = !!(modbusStatus && modbusStatus.connected);
		const connected = !!(snapshot && snapshot.connected);

		// connection state transitions
		const state = connected ? "online" : tcp ? "standby" : "offline";
		if (this.prev.connState !== null && state !== this.prev.connState) {
			const sev = state === "online" ? "info" : "warning";
			const label = state === "online" ? "Verbindung wiederhergestellt" : state === "standby" ? "Wechselrichter im Standby" : "Verbindung getrennt";
			this._emit("connection", sev, label, `Zustand: ${state}`, { state });
		}
		this.prev.connState = state;

		// modbus error / lockdown
		const lockNow = !!(modbusStatus && modbusStatus.lockdownUntil && modbusStatus.lockdownUntil > this._now());
		if (lockNow && !this.prev.inLockdown) {
			this._emit("modbus-error", "critical", "Modbus-Lockdown", "Dongle limitiert hart — keine Verbindungsversuche.", null);
		} else if (modbusStatus && modbusStatus.lastError && modbusStatus.lastError !== this.prev.lastError && /ECONNRESET|EPIPE|socket|closed by peer/i.test(modbusStatus.lastError)) {
			this._emit("modbus-error", "warning", "Modbus-Fehler", String(modbusStatus.lastError), null);
		}
		this.prev.inLockdown = lockNow;
		if (modbusStatus) this.prev.lastError = modbusStatus.lastError || this.prev.lastError;

		// battery SOC thresholds (edge-triggered)
		const t = (this._getConfig().notifications || {}).thresholds || {};
		if (isNum(v.batterySoc) && isNum(this.prev.soc)) {
			if (this.prev.soc > t.lowSocPct && v.batterySoc <= t.lowSocPct) {
				this._emit("battery-soc-low", "warning", "Batterie niedrig", `SOC ${v.batterySoc}% (Schwelle ${t.lowSocPct}%)`, { soc: v.batterySoc, threshold: t.lowSocPct });
			}
			if (this.prev.soc < t.fullSocPct && v.batterySoc >= t.fullSocPct) {
				this._emit("battery-soc-full", "info", "Batterie voll", `SOC ${v.batterySoc}% (Schwelle ${t.fullSocPct}%)`, { soc: v.batterySoc, threshold: t.fullSocPct });
			}
		}
		if (isNum(v.batterySoc)) this.prev.soc = v.batterySoc;

		// daily energy milestone
		if (isNum(v.dailyYield) && isNum(this.prev.dailyYield) && t.milestoneKwh > 0) {
			const before = Math.floor(this.prev.dailyYield / t.milestoneKwh);
			const after = Math.floor(v.dailyYield / t.milestoneKwh);
			if (after > before) {
				this._emit("energy-milestone", "info", "Energie-Meilenstein", `${after * t.milestoneKwh} kWh heute erreicht`, { kwh: v.dailyYield });
			}
		}
		if (isNum(v.dailyYield)) this.prev.dailyYield = v.dailyYield;

		// power peak (edge-triggered, once per day)
		const today = new Date(this._now()).toDateString();
		if (isNum(v.inputPower) && this.prev.peakFiredDay !== today && v.inputPower > t.peakPowerW) {
			this._emit("power-peak", "info", "Leistungsspitze", `PV ${Math.round(v.inputPower)} W über ${t.peakPowerW} W`, { power: v.inputPower });
			this.prev.peakFiredDay = today;
		}

		// device status change
		if (v.deviceStatusText && v.deviceStatusText !== this.prev.deviceStatus && this.prev.deviceStatus !== null) {
			this._emit("device-status", "info", "Statuswechsel", `${this.prev.deviceStatus} → ${v.deviceStatusText}`, { status: v.deviceStatusText });
		}
		if (v.deviceStatusText) this.prev.deviceStatus = v.deviceStatusText;

		// inverter alarms — edge-triggered, re-arm after a code clears
		const alarms = Array.isArray(snapshot && snapshot.alarms) ? snapshot.alarms : [];
		const curr = new Set();
		for (const a of alarms) {
			if (!a || !a.code) continue;
			curr.add(a.code);
			if (!this.prev.activeAlarmCodes.has(a.code)) {
				this._emit("inverter-alarm", a.severity === "critical" ? "critical" : "warning", "Wechselrichter-Alarm", a.name || a.code, { code: a.code });
			}
		}
		this.prev.activeAlarmCodes = curr;
	}

	onHcuState(connected) {
		const state = connected ? "online" : "offline";
		if (this.prev.hcuState !== undefined && this.prev.hcuState !== state) {
			this._emit("hcu", connected ? "info" : "warning", connected ? "HCU verbunden" : "HCU getrennt", `HCU-WebSocket ${state}`, { state });
		}
		this.prev.hcuState = state;
	}
}

module.exports = { EventDetector, CATEGORIES };

"use strict";

// Polls the inverter on a timer and emits a normalized snapshot.

const { EventEmitter } = require("events");
const log = require("../logger");
const { Sun2000Modbus } = require("./modbus");
const { BATTERY_STATUS, DEVICE_STATUS } = require("./registers");

const STATIC_REGS = ["model", "sn", "firmwareVersion", "ratedPower", "batteryRatedCapacity"];

const REALTIME_REGS_BASE = [
	"inputPower",
	"activePower",
	"reactivePower",
	"powerFactor",
	"gridFrequency",
	"internalTemp",
	"deviceStatus",
	"dailyYield",
	"totalYield",
];

const METER_REGS = [
	"meterStatus",
	"meterActivePower",
	"meterReactivePower",
	"meterPowerFactor",
	"meterFrequency",
	"meterPositiveActiveEnergy",
	"meterReverseActiveEnergy",
	"meterPhaseAVoltage",
	"meterPhaseBVoltage",
	"meterPhaseCVoltage",
	"meterPhaseACurrent",
	"meterPhaseBCurrent",
	"meterPhaseCCurrent",
];

const BATTERY_REGS = [
	"batteryRunningStatus",
	"batteryChargeDischargePower",
	"batterySoc",
	"batteryBusVoltage",
	"batteryBackupTime",
	"batteryDayChargeCapacity",
	"batteryDayDischargeCapacity",
	"batteryTotalCharge",
	"batteryTotalDischarge",
];

class Poller extends EventEmitter {
	constructor(config) {
		super();
		this.config = config;
		this.modbus = new Sun2000Modbus();
		this.timer = null;
		this.snapshot = {
			connected: false,
			lastUpdate: null,
			lastError: null,
			static: {},
			values: {},
		};
	}

	async start() {
		if (!this.config.inverterHost) {
			log.warn("Poller not started: no inverter host configured");
			return;
		}
		try {
			await this.modbus.connect({
				host: this.config.inverterHost,
				port: this.config.inverterPort,
				unitId: this.config.inverterUnitId,
			});
			this.snapshot.connected = true;
			await this._readStatic();
		} catch (e) {
			this.snapshot.connected = false;
			this.snapshot.lastError = e.message;
		}
		const interval = Math.max(2000, this.config.pollIntervalMs || 10000);
		this.timer = setInterval(() => this._tick().catch((e) => log.error("Poll error:", e)), interval);
		this._tick().catch((e) => log.error("Initial poll error:", e));
	}

	stop() {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		this.modbus.close();
	}

	async restart(newConfig) {
		this.stop();
		this.config = newConfig;
		this.snapshot = { connected: false, lastUpdate: null, lastError: null, static: {}, values: {} };
		await this.start();
	}

	getSnapshot() {
		return this.snapshot;
	}

	getModbus() {
		return this.modbus;
	}

	async _readStatic() {
		const data = await this.modbus.readMany(STATIC_REGS);
		this.snapshot.static = data;
		log.info(`Inverter: ${data.model || "?"} SN ${data.sn || "?"} FW ${data.firmwareVersion || "?"}`);
	}

	async _tick() {
		const cfg = this.config;
		const regs = [...REALTIME_REGS_BASE];
		if (cfg.hasMeter) regs.push(...METER_REGS);
		if (cfg.hasBattery) regs.push(...BATTERY_REGS);

		try {
			const v = await this.modbus.readMany(regs);
			this.snapshot.values = v;
			this.snapshot.connected = true;
			this.snapshot.lastUpdate = Date.now();
			this.snapshot.lastError = null;

			// Annotate enums
			this.snapshot.values.deviceStatusText = DEVICE_STATUS[v.deviceStatus] || `0x${(v.deviceStatus || 0).toString(16)}`;
			if (cfg.hasBattery) {
				this.snapshot.values.batteryRunningStatusText = BATTERY_STATUS[v.batteryRunningStatus] || String(v.batteryRunningStatus);
			}

			this.emit("snapshot", this.snapshot);
		} catch (e) {
			this.snapshot.connected = false;
			this.snapshot.lastError = e.message;
			this.emit("error", e);
		}
	}
}

module.exports = { Poller };

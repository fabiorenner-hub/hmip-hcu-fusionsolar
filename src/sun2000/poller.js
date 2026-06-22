"use strict";

// Polls the inverter on an adaptive timer.
//
// Strategy: instead of issuing one Modbus request per register (which the
// SDongleA-05 dislikes – it tends to drop the connection when other
// masters are competing), we read whole register blocks at once and
// decode the named fields locally. That cuts a 30+ request poll down
// to ~5 requests.
//
// Adaptive interval: on success we use config.pollIntervalMs. On any
// block failure we back off exponentially (2x each time) up to 60 s,
// and reset to base on the next success. This is friendly to the
// inverter and quiet in the logs.

const { EventEmitter } = require("events");
const log = require("../logger");
const { Sun2000Modbus } = require("./modbus");
const { BATTERY_STATUS, DEVICE_STATUS, READ_BLOCKS } = require("./registers");

const MAX_BACKOFF_MS = 60_000;

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
		this._currentInterval = null;
		this._consecutiveFailures = 0;
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
		this._scheduleNext(0);
	}

	stop() {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		this.modbus.close();
	}

	async restart(newConfig) {
		this.stop();
		this.config = newConfig;
		this.snapshot = { connected: false, lastUpdate: null, lastError: null, static: {}, values: {} };
		this._currentInterval = null;
		this._consecutiveFailures = 0;
		await this.start();
	}

	// Soft update for config changes that do NOT affect the Modbus connection.
	// Avoids tearing down the live TCP socket on dashboard / cloud / hardware-
	// flag changes — those would trigger the SDongle to reject reconnects for
	// many minutes (a known firmware quirk).
	updateConfig(newConfig) {
		const old = this.config || {};
		const connChanged =
			old.inverterHost !== newConfig.inverterHost ||
			old.inverterPort !== newConfig.inverterPort ||
			old.inverterUnitId !== newConfig.inverterUnitId;
		if (connChanged) return false;
		this.config = newConfig;
		log.info("Poller config updated in-place (no Modbus reconnect)");
		return true;
	}

	getSnapshot() {
		return this.snapshot;
	}

	getModbus() {
		return this.modbus;
	}

	_baseInterval() {
		return Math.max(2000, this.config.pollIntervalMs || 10000);
	}

	_nextDelay(success) {
		if (success) {
			this._consecutiveFailures = 0;
			this._currentInterval = this._baseInterval();
		} else {
			this._consecutiveFailures += 1;
			const next = (this._currentInterval || this._baseInterval()) * 2;
			this._currentInterval = Math.min(MAX_BACKOFF_MS, next);
		}
		return this._currentInterval;
	}

	_scheduleNext(delay) {
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this._tick().catch((e) => log.error("Poll error:", e));
		}, delay);
	}

	async _readStatic() {
		try {
			const data = await this.modbus.readBlock(
				READ_BLOCKS.staticInfo.start,
				READ_BLOCKS.staticInfo.count,
				READ_BLOCKS.staticInfo.names
			);
			let bat = {};
			if (this.config.hasBattery) {
				bat = await this.modbus.readBlock(
					READ_BLOCKS.batteryStatic.start,
					READ_BLOCKS.batteryStatic.count,
					READ_BLOCKS.batteryStatic.names
				);
			}
			// Merge non-null values onto existing static info: if the dongle
			// flakes during this read, we don't want to overwrite a previously
			// good SN/model/FW with nulls.
			const merged = { ...this.snapshot.static };
			for (const [k, v] of Object.entries({ ...data, ...bat })) {
				if (v !== null && v !== undefined && v !== "") merged[k] = v;
			}
			this.snapshot.static = merged;
			if (data.sn || data.model || data.firmwareVersion) {
				log.info(`Inverter: ${merged.model || "?"} SN ${merged.sn || "?"} FW ${merged.firmwareVersion || "?"}`);
			}
		} catch (e) {
			log.warn(`Static read failed: ${e.message}`);
		}
	}

	async _tick() {
		const cfg = this.config;
		let success = false;
		try {
			const merged = {};
			const readBlock = async (b) => {
				const data = await this.modbus.readBlock(b.start, b.count, b.names);
				Object.assign(merged, data);
				return Object.values(data).some((v) => v !== null && v !== undefined);
			};

			// Always: PV/AC + yields
			const pvOk = await readBlock(READ_BLOCKS.pvAndAc);
			const yieldsOk = await readBlock(READ_BLOCKS.yields);
			let meterOk = false;
			let batteryOk = false;
			if (cfg.hasMeter) meterOk = await readBlock(READ_BLOCKS.meter);
			if (cfg.hasBattery) batteryOk = await readBlock(READ_BLOCKS.battery);

			// Block reads are atomic: one unsupported/de-energised register
			// (typically the PV strings at dusk) fails the whole pvAndAc block.
			// If another block proves the inverter is awake, retry pvAndAc
			// register-by-register so the readable fields (AC power, status,
			// temperature) still come through instead of the tick going dark.
			if (!pvOk && (yieldsOk || meterOk || batteryOk)) {
				Object.assign(merged, await this.modbus.readEach(READ_BLOCKS.pvAndAc.names));
			}

			// If no model SN was read at startup (e.g. inverter was asleep),
			// retry it opportunistically once we get any successful read.
			if (!this.snapshot.static.sn) {
				try { await this._readStatic(); } catch {}
			}

			// We consider the tick successful if at least one core field arrived.
			const anyOk = Object.values(merged).some((v) => v !== null && v !== undefined);
			if (!anyOk) throw new Error("All blocks returned null");

			merged.deviceStatusText = DEVICE_STATUS[merged.deviceStatus] || (merged.deviceStatus != null ? `0x${merged.deviceStatus.toString(16)}` : "–");
			if (cfg.hasBattery) {
				merged.batteryRunningStatusText = BATTERY_STATUS[merged.batteryRunningStatus] || String(merged.batteryRunningStatus ?? "");
			}

			this.snapshot.values = merged;
			this.snapshot.connected = true;
			this.snapshot.lastUpdate = Date.now();
			this.snapshot.lastError = null;
			this.emit("snapshot", this.snapshot);
			success = true;
		} catch (e) {
			this.snapshot.connected = false;
			this.snapshot.lastError = e.message;
			this.emit("error", e);
		} finally {
			this._scheduleNext(this._nextDelay(success));
		}
	}
}

module.exports = { Poller };

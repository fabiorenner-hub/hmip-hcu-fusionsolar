"use strict";

// Thin wrapper around modbus-serial. Sun2000 inverters answer slowly and
// the TCP socket sometimes drops; we serialize requests, retry on failure
// and reconnect transparently.

const ModbusRTU = require("modbus-serial");
const log = require("../logger");
const { REG, decode, encode } = require("./registers");

const READ_DELAY_MS = 80;       // Sun2000 likes a short pause between reads
const REQUEST_TIMEOUT_MS = 4000;
const RECONNECT_DELAY_MS = 2000;

class Sun2000Modbus {
	constructor() {
		this.client = new ModbusRTU();
		this.connected = false;
		this.queue = Promise.resolve();
		this.opts = null;
	}

	async connect({ host, port, unitId }) {
		this.opts = { host, port, unitId };
		try {
			if (this.connected) {
				try {
					this.client.close(() => {});
				} catch {}
			}
			this.client = new ModbusRTU();
			this.client.setTimeout(REQUEST_TIMEOUT_MS);
			await this.client.connectTCP(host, { port });
			this.client.setID(unitId);
			this.connected = true;
			log.info(`Modbus connected to ${host}:${port} unit ${unitId}`);
		} catch (e) {
			this.connected = false;
			log.warn(`Modbus connect failed: ${e.message}`);
			throw e;
		}
	}

	async _ensureConnected() {
		if (this.connected) return;
		if (!this.opts) throw new Error("Modbus not configured");
		await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));
		await this.connect(this.opts);
	}

	// Serialise all bus access on a single promise chain.
	_run(task) {
		const next = this.queue.then(task, task);
		this.queue = next.catch(() => undefined);
		return next;
	}

	async readRegister(name) {
		const reg = REG[name];
		if (!reg) throw new Error(`Unknown register: ${name}`);
		return this._run(async () => {
			await this._ensureConnected();
			try {
				const result = await this.client.readHoldingRegisters(reg.addr, reg.length);
				await new Promise((r) => setTimeout(r, READ_DELAY_MS));
				return decode(reg, result.data);
			} catch (e) {
				log.warn(`Read ${name} (@${reg.addr}) failed: ${e.message}`);
				this.connected = false;
				throw e;
			}
		});
	}

	async readMany(names) {
		const out = {};
		for (const name of names) {
			try {
				out[name] = await this.readRegister(name);
			} catch (e) {
				out[name] = null;
			}
		}
		return out;
	}

	async readRaw(addr, length) {
		return this._run(async () => {
			await this._ensureConnected();
			const r = await this.client.readHoldingRegisters(addr, length);
			await new Promise((r2) => setTimeout(r2, READ_DELAY_MS));
			return r.data;
		});
	}

	async writeRegister(name, value) {
		const reg = REG[name];
		if (!reg) throw new Error(`Unknown register: ${name}`);
		if (reg.rw !== "rw") throw new Error(`Register ${name} is read-only`);
		const words = encode(reg, value);
		return this._run(async () => {
			await this._ensureConnected();
			try {
				await this.client.writeRegisters(reg.addr, words);
				log.info(`Wrote ${name} (@${reg.addr}) = ${value}`);
			} catch (e) {
				log.warn(`Write ${name} (@${reg.addr}) failed: ${e.message}`);
				this.connected = false;
				throw e;
			}
		});
	}

	async writeRaw(addr, words) {
		return this._run(async () => {
			await this._ensureConnected();
			await this.client.writeRegisters(addr, words);
		});
	}

	close() {
		try {
			this.client.close(() => {});
		} catch {}
		this.connected = false;
	}
}

module.exports = { Sun2000Modbus };

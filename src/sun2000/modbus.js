"use strict";

// Thin wrapper around modbus-serial. The Sun2000 quirks we handle here:
//
// 1. The inverter goes to sleep at night. The SDongleA-05 stays awake,
//    so the TCP connect succeeds, but every Modbus request times out.
//    We must NOT tear down the TCP socket on read timeouts — re-connecting
//    just adds noise without fixing anything.
// 2. Some firmwares answer slowly right after wake-up, so we use a long
//    read timeout (8 s) and a short pause between requests.
// 3. To keep logs readable, repeated identical warnings are throttled.
//
// State machine:
//   not-connected -> connecting -> connected (TCP) -> ...
//   connected + reads succeed   ⇒ healthy
//   connected + reads timeout   ⇒ asleep (probably night) — keep socket
//   connected + socket error    ⇒ drop, reconnect

const ModbusRTU = require("modbus-serial");
const log = require("../logger");
const { REG, decode, encode } = require("./registers");

const READ_DELAY_MS = 80;
const REQUEST_TIMEOUT_MS = 8000;
const RECONNECT_DELAY_MS = 3000;
const WARN_THROTTLE_MS = 60_000; // same warning at most once per minute

class Sun2000Modbus {
	constructor() {
		this.client = new ModbusRTU();
		this.connected = false;
		this.queue = Promise.resolve();
		this.opts = null;
		// Counters surfaced via getStatus() for the diagnostics tab.
		this.stats = { reads: 0, readsOk: 0, readsTimeout: 0, readsError: 0, writes: 0, lastError: null };
		this._warnedAt = new Map();
	}

	_warnThrottled(key, message) {
		const now = Date.now();
		const last = this._warnedAt.get(key) || 0;
		if (now - last >= WARN_THROTTLE_MS) {
			this._warnedAt.set(key, now);
			log.warn(message);
		}
	}

	async connect({ host, port, unitId }) {
		this.opts = { host, port, unitId };
		try {
			if (this.client) {
				try { this.client.close(() => {}); } catch {}
			}
			this.client = new ModbusRTU();
			this.client.setTimeout(REQUEST_TIMEOUT_MS);
			await this.client.connectTCP(host, { port });
			this.client.setID(unitId);
			// Listen for socket-level errors so we know when to drop.
			const sock = this.client._port?._client || this.client._port;
			if (sock && sock.on) {
				sock.on("error", (err) => {
					this._warnThrottled("sock-err", `Modbus socket error: ${err.message}`);
					this.connected = false;
				});
				sock.on("close", () => {
					if (this.connected) {
						this._warnThrottled("sock-close", "Modbus socket closed by peer");
					}
					this.connected = false;
				});
			}
			this.connected = true;
			this._warnedAt.clear();
			log.info(`Modbus connected to ${host}:${port} unit ${unitId}`);
		} catch (e) {
			this.connected = false;
			this.stats.lastError = e.message;
			this._warnThrottled("connect", `Modbus connect failed: ${e.message}`);
			throw e;
		}
	}

	async _ensureConnected() {
		if (this.connected) return;
		if (!this.opts) throw new Error("Modbus not configured");
		await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));
		await this.connect(this.opts);
	}

	_run(task) {
		const next = this.queue.then(task, task);
		this.queue = next.catch(() => undefined);
		return next;
	}

	_classifyAndHandle(err, label) {
		const msg = err && err.message ? err.message : String(err);
		this.stats.lastError = `${label}: ${msg}`;
		const isTimeout = /Timed out|timeout/i.test(msg);
		const isSocket = /ECONNRESET|ECONNREFUSED|EPIPE|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|socket/i.test(msg);
		if (isTimeout) {
			this.stats.readsTimeout += 1;
			// Inverter probably asleep. Keep the socket; no reconnect.
			this._warnThrottled("read-timeout", `Modbus reads timing out (likely inverter asleep): last failure ${label}`);
		} else if (isSocket) {
			this.stats.readsError += 1;
			this._warnThrottled("read-sock", `Modbus socket trouble: ${msg} (${label})`);
			this.connected = false; // drop and reconnect
		} else {
			this.stats.readsError += 1;
			this._warnThrottled("read-err-" + label, `Read ${label} failed: ${msg}`);
		}
	}

	async readRegister(name) {
		const reg = REG[name];
		if (!reg) throw new Error(`Unknown register: ${name}`);
		return this._run(async () => {
			await this._ensureConnected();
			this.stats.reads += 1;
			try {
				const result = await this.client.readHoldingRegisters(reg.addr, reg.length);
				await new Promise((r) => setTimeout(r, READ_DELAY_MS));
				this.stats.readsOk += 1;
				return decode(reg, result.data);
			} catch (e) {
				this._classifyAndHandle(e, `${name}@${reg.addr}`);
				throw e;
			}
		});
	}

	async readMany(names) {
		const out = {};
		for (const name of names) {
			try {
				out[name] = await this.readRegister(name);
			} catch {
				out[name] = null;
			}
		}
		return out;
	}

	async readRaw(addr, length) {
		return this._run(async () => {
			await this._ensureConnected();
			this.stats.reads += 1;
			try {
				const r = await this.client.readHoldingRegisters(addr, length);
				await new Promise((r2) => setTimeout(r2, READ_DELAY_MS));
				this.stats.readsOk += 1;
				return r.data;
			} catch (e) {
				this._classifyAndHandle(e, `raw@${addr}`);
				throw e;
			}
		});
	}

	async writeRegister(name, value) {
		const reg = REG[name];
		if (!reg) throw new Error(`Unknown register: ${name}`);
		if (reg.rw !== "rw") throw new Error(`Register ${name} is read-only`);
		const words = encode(reg, value);
		return this._run(async () => {
			await this._ensureConnected();
			this.stats.writes += 1;
			try {
				await this.client.writeRegisters(reg.addr, words);
				log.info(`Wrote ${name} (@${reg.addr}) = ${value}`);
			} catch (e) {
				this._classifyAndHandle(e, `write ${name}@${reg.addr}`);
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

	getStatus() {
		return { connected: this.connected, opts: this.opts, ...this.stats };
	}

	close() {
		try { this.client.close(() => {}); } catch {}
		this.connected = false;
	}
}

module.exports = { Sun2000Modbus };

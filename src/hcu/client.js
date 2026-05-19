"use strict";

// HCU WebSocket client. Manages the connection lifecycle, dispatches
// inbound PluginMessages and exposes helpers to send STATUS_EVENT updates.

const fs = require("fs");
const WebSocket = require("ws");
const { EventEmitter } = require("events");
const log = require("../logger");
const hcuLog = require("../hcuLog");
const M = require("./messages");

const RECONNECT_DELAY_MS = 5000;

class HcuClient extends EventEmitter {
	constructor({ pluginId, host, authToken, friendlyName }) {
		super();
		this.pluginId = pluginId;
		this.host = host;
		this.authToken = authToken;
		this.friendlyName = friendlyName;
		this.ws = null;
		this.includedDeviceIds = new Set();
		this.reconnectTimer = null;
		this.connected = false;
	}

	static readToken(path) {
		try {
			return fs.readFileSync(path, "utf8").trim();
		} catch (e) {
			log.error(`Cannot read auth token from ${path}: ${e.message}`);
			return null;
		}
	}

	connect() {
		const url = `wss://${this.host}:9001`;
		log.info(`Connecting to HCU at ${url} as ${this.pluginId}`);
		this.ws = new WebSocket(url, {
			rejectUnauthorized: false,
			headers: {
				authtoken: this.authToken,
				"plugin-id": this.pluginId,
			},
		});

		this.ws.on("open", () => {
			log.info("HCU WebSocket connected");
			this.connected = true;
			this.emit("open");
		});

		this.ws.on("message", (raw) => {
			let msg;
			try {
				msg = JSON.parse(raw.toString());
			} catch (e) {
				log.warn("Bad HCU message:", e.message);
				return;
			}
			hcuLog.record("in", msg);
			this._dispatch(msg);
		});

		this.ws.on("close", (code, reason) => {
			this.connected = false;
			log.warn(`HCU WebSocket closed: ${code} ${reason}`);
			this._scheduleReconnect();
		});

		this.ws.on("error", (err) => {
			log.warn(`HCU WebSocket error: ${err.code || ""} ${err.message || err}`);
		});
	}

	_scheduleReconnect() {
		if (this.reconnectTimer) return;
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.connect();
		}, RECONNECT_DELAY_MS);
	}

	_dispatch(msg) {
		log.debug("HCU →", msg.type, msg.id);
		switch (msg.type) {
			case "PLUGIN_STATE_REQUEST":
				this.emit("pluginStateRequest", msg);
				break;
			case "DISCOVER_REQUEST":
				this.emit("discoverRequest", msg);
				break;
			case "STATUS_REQUEST":
				this.emit("statusRequest", msg);
				break;
			case "CONTROL_REQUEST":
				this.emit("controlRequest", msg);
				break;
			case "CONFIG_TEMPLATE_REQUEST":
				this.emit("configTemplateRequest", msg);
				break;
			case "CONFIG_UPDATE_REQUEST":
				this.emit("configUpdateRequest", msg);
				break;
			case "INCLUSION_EVENT":
				(msg.body?.deviceIds || []).forEach((id) => this.includedDeviceIds.add(id));
				log.info(`Inclusion event: ${this.includedDeviceIds.size} devices included`);
				this.emit("inclusion", msg.body?.deviceIds || []);
				break;
			case "EXCLUSION_EVENT":
				(msg.body?.deviceIds || []).forEach((id) => this.includedDeviceIds.delete(id));
				log.info(`Exclusion event: ${this.includedDeviceIds.size} devices remain`);
				this.emit("exclusion", msg.body?.deviceIds || []);
				break;
			case "ERROR_RESPONSE":
				log.warn("HCU error response:", JSON.stringify(msg.body));
				break;
			default:
				log.debug("Unhandled HCU message", msg.type);
		}
	}

	send(message) {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			log.warn(`Cannot send ${message.type}, socket not open`);
			return false;
		}
		this.ws.send(JSON.stringify(message));
		hcuLog.record("out", message);
		log.debug("HCU ←", message.type, message.id);
		return true;
	}

	sendPluginState(status) {
		this.send(M.pluginStateResponse(this.pluginId, status, this.friendlyName));
	}

	respondPluginState(reqId, status) {
		this.send(M.pluginStateResponse(this.pluginId, status, this.friendlyName, reqId));
	}
}

module.exports = { HcuClient };

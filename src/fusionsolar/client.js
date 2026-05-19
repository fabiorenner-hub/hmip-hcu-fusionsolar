"use strict";

// Minimal port of FusionSolarPy's client. Read-only. Used as a fallback
// when local Modbus is unreachable. Captcha solving is NOT implemented –
// if Huawei prompts for one the call simply fails and we continue using
// the cached snapshot.
//
// Reference: https://github.com/jgriss/FusionSolarPy

const log = require("../logger");

class FusionSolarClient {
	constructor({ user, password, subdomain }) {
		this.user = user;
		this.password = password;
		this.subdomain = subdomain || "region01eu5";
		this.baseUrl = `https://${this.subdomain}.fusionsolar.huawei.com`;
		this.cookies = "";
		this.lastLogin = 0;
	}

	async _request(path, { method = "GET", body, headers } = {}) {
		const url = this.baseUrl + path;
		const res = await fetch(url, {
			method,
			headers: {
				"User-Agent": "hmip-fusionsolar/0.1",
				"Content-Type": "application/json",
				Cookie: this.cookies,
				...(headers || {}),
			},
			body: body ? JSON.stringify(body) : undefined,
		});
		const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
		if (setCookie.length) {
			const merged = setCookie.map((c) => c.split(";")[0]).join("; ");
			this.cookies = this.cookies ? `${this.cookies}; ${merged}` : merged;
		}
		const text = await res.text();
		if (!res.ok) {
			throw new Error(`FusionSolar ${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
		}
		try {
			return JSON.parse(text);
		} catch {
			return text;
		}
	}

	async login() {
		// We use the v3 login flow used by FusionSolarPy >= 0.0.19.
		const r = await this._request("/unisso/v3/validateUser.action?timeStamp=" + Date.now(), {
			method: "POST",
			body: {
				organizationName: "",
				username: this.user,
				password: this.password,
			},
		});
		if (r && r.errorCode && r.errorCode !== "0") {
			throw new Error(`FusionSolar login failed: ${r.errorCode}`);
		}
		this.lastLogin = Date.now();
		log.info("FusionSolar cloud login OK");
	}

	async getStationList() {
		const data = await this._request(
			"/rest/pvms/web/station/v1/station/station-list?_=" + Date.now(),
			{ method: "POST", body: { curPage: 1, pageSize: 10, gridConnectedTime: "" } }
		);
		return data?.data?.list || [];
	}

	async getCurrentPlantData(plantDn) {
		const data = await this._request(
			`/rest/pvms/web/station/v1/overview/energy-flow?stationDn=${encodeURIComponent(plantDn)}&_=${Date.now()}`
		);
		return data?.data || {};
	}
}

module.exports = { FusionSolarClient };

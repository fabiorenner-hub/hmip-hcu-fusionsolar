"use strict";

// Lightweight "is there a newer release on GitHub?" checker.
//
// Polls the public GitHub Releases API on a slow, unref'd timer (so it never
// keeps the process alive) and caches the result. Pure version comparison is
// split out so it can be property-tested. No new runtime dependency — uses
// Node's built-in https. Network/parse failures are non-fatal: the cached
// status simply records the error and the dashboard keeps working.

const https = require("https");
const log = require("./logger");

const REPO = "fabiorenner-hub/hmip-hcu-fusionsolar";
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;

let state = {
	current: "0.0.0",
	latest: null,
	updateAvailable: false,
	releaseUrl: RELEASES_PAGE,
	checkedAt: null,
	error: null,
};
let notifiedFor = null; // last `latest` we already raised a notification for
let timer = null;

// Parse a semver-ish string ("v1.2.3", "1.2.3", "1.2.3-rc1") → [maj,min,patch].
function parseVersion(v) {
	const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(v == null ? "" : v));
	if (!m) return null;
	return [Number(m[1]), Number(m[2]), Number(m[3])];
}

// Pure: is `latest` strictly newer than `current`? Unparseable inputs → false.
function isNewer(latest, current) {
	const a = parseVersion(latest);
	const b = parseVersion(current);
	if (!a || !b) return false;
	for (let i = 0; i < 3; i += 1) {
		if (a[i] > b[i]) return true;
		if (a[i] < b[i]) return false;
	}
	return false;
}

function defaultFetch(url) {
	return new Promise((resolve, reject) => {
		const req = https.get(
			url,
			{ headers: { "User-Agent": "hmip-fusionsolar", Accept: "application/vnd.github+json" } },
			(res) => {
				let body = "";
				res.on("data", (c) => (body += c));
				res.on("end", () => {
					if (res.statusCode < 200 || res.statusCode >= 300) {
						reject(new Error(`HTTP ${res.statusCode}`));
						return;
					}
					try {
						resolve(JSON.parse(body));
					} catch (e) {
						reject(e);
					}
				});
			}
		);
		req.on("error", reject);
		req.setTimeout(10000, () => req.destroy(new Error("timeout")));
	});
}

// Run a single check. fetchImpl/notify are injectable for tests. Never throws.
async function checkNow({ fetchImpl = defaultFetch, notify } = {}) {
	try {
		const data = await fetchImpl(LATEST_API);
		const latest = data && data.tag_name ? String(data.tag_name) : null;
		const releaseUrl = (data && data.html_url) || RELEASES_PAGE;
		state.latest = latest;
		state.releaseUrl = latest ? releaseUrl : RELEASES_PAGE;
		state.updateAvailable = latest ? isNewer(latest, state.current) : false;
		state.checkedAt = Date.now();
		state.error = null;
		if (state.updateAvailable && typeof notify === "function" && notifiedFor !== latest) {
			notifiedFor = latest;
			try {
				notify(getStatus());
			} catch (e) {
				log.warn("Update notify failed:", e.message);
			}
		}
	} catch (e) {
		state.error = e.message;
		state.checkedAt = Date.now();
		log.warn("Update check failed:", e.message);
	}
	return getStatus();
}

// Start the periodic checker. Returns a stop() function.
function start({ currentVersion, notify, intervalMs = 6 * 60 * 60 * 1000, fetchImpl, setIntervalFn = setInterval } = {}) {
	if (currentVersion) state.current = String(currentVersion);
	checkNow({ fetchImpl, notify });
	timer = setIntervalFn(() => checkNow({ fetchImpl, notify }), intervalMs);
	if (timer && typeof timer.unref === "function") timer.unref();
	return function stop() {
		clearInterval(timer);
	};
}

function getStatus() {
	return { ...state };
}

// Test seam: reset the module's cached state between cases.
function _reset(current = "0.0.0") {
	state = { current, latest: null, updateAvailable: false, releaseUrl: RELEASES_PAGE, checkedAt: null, error: null };
	notifiedFor = null;
}

module.exports = { start, checkNow, getStatus, parseVersion, isNewer, _reset, REPO, RELEASES_PAGE, LATEST_API };

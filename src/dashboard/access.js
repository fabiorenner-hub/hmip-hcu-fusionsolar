"use strict";

// Access control for the dashboard/API:
//   1. Network gate — only local/private (or explicitly allow-listed) source
//      IPs may reach the API. This reliably blocks public exposure if the
//      HCU's published port ends up forwarded to the internet.
//   2. Admin sessions — write operations require an authenticated token.
//
// NAT caveat: the plugin runs in a container behind the HCU's port mapping.
// Depending on the HCU's networking, the source IP we see may be the bridge
// gateway rather than the real LAN client. The private-network default
// therefore behaves as "block non-private", which is the property that
// actually matters for security. The allowedSubnets allowlist is available
// for setups where real client IPs are preserved.

const crypto = require("crypto");
const os = require("os");

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 h admin session
const tokens = new Map(); // token -> expiresAt

// ── IP helpers ─────────────────────────────────────────────────────

function normalizeIp(raw) {
	if (!raw) return "";
	let ip = String(raw).trim();
	// Strip IPv4-mapped IPv6 prefix (::ffff:192.168.0.1)
	if (ip.startsWith("::ffff:")) ip = ip.slice(7);
	// Drop zone id / brackets
	ip = ip.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
	return ip;
}

function clientIp(req) {
	return normalizeIp(req.socket?.remoteAddress || req.connection?.remoteAddress || "");
}

function ipv4ToInt(ip) {
	const parts = ip.split(".");
	if (parts.length !== 4) return null;
	let n = 0;
	for (const p of parts) {
		const o = Number(p);
		if (!Number.isInteger(o) || o < 0 || o > 255) return null;
		n = (n * 256 + o) >>> 0;
	}
	return n >>> 0;
}

function inCidr(ip, cidr) {
	const [range, bitsRaw] = cidr.split("/");
	const bits = parseInt(bitsRaw, 10);
	const ipN = ipv4ToInt(ip);
	const rangeN = ipv4ToInt(range);
	if (ipN === null || rangeN === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
	if (bits === 0) return true;
	const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
	return (ipN & mask) === (rangeN & mask);
}

function isLoopback(ip) {
	return ip === "::1" || ip === "127.0.0.1" || ip.startsWith("127.");
}

function isPrivateV4(ip) {
	return (
		inCidr(ip, "10.0.0.0/8") ||
		inCidr(ip, "172.16.0.0/12") ||
		inCidr(ip, "192.168.0.0/16") ||
		inCidr(ip, "169.254.0.0/16") || // link-local
		inCidr(ip, "100.64.0.0/10") // CGNAT / Tailscale-style
	);
}

function isPrivateV6(ip) {
	const low = ip.toLowerCase();
	return low.startsWith("fc") || low.startsWith("fd") || low.startsWith("fe80");
}

// Subnets of this host's own non-internal interfaces (so a same-subnet
// client is recognised even on unusual private ranges).
function ownSubnets() {
	const out = [];
	const ifaces = os.networkInterfaces();
	for (const list of Object.values(ifaces)) {
		for (const i of list || []) {
			if (i.internal || i.family !== "IPv4") continue;
			if (i.cidr) out.push(i.cidr);
		}
	}
	return out;
}

// Decide whether a request's source is allowed by the network gate.
function classify(req, cfg) {
	const ip = clientIp(req);
	if (!ip) return { ip, lan: false, reason: "no-ip" };
	if (isLoopback(ip)) return { ip, lan: true, reason: "loopback" };

	const allow = String(cfg.allowedSubnets || "").split(",").map((s) => s.trim()).filter(Boolean);
	if (allow.length) {
		const ok = allow.some((c) => inCidr(ip, c));
		return { ip, lan: ok, reason: ok ? "allowlist" : "not-in-allowlist" };
	}

	if (isPrivateV4(ip) || isPrivateV6(ip)) return { ip, lan: true, reason: "private" };
	if (ownSubnets().some((c) => inCidr(ip, c))) return { ip, lan: true, reason: "same-subnet" };
	return { ip, lan: false, reason: "public" };
}

// ── Admin sessions ─────────────────────────────────────────────────

function gc() {
	const now = Date.now();
	for (const [tok, exp] of tokens) if (exp <= now) tokens.delete(tok);
}

function issueToken() {
	gc();
	const tok = crypto.randomBytes(24).toString("hex");
	tokens.set(tok, Date.now() + TOKEN_TTL_MS);
	return tok;
}

function tokenFromReq(req) {
	const h = req.headers["x-admin-token"];
	if (h) return String(h);
	const auth = req.headers["authorization"];
	if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
	return "";
}

function isAuthed(req) {
	gc();
	const tok = tokenFromReq(req);
	if (!tok) return false;
	const exp = tokens.get(tok);
	if (!exp || exp <= Date.now()) return false;
	// Sliding expiry: refresh on use.
	tokens.set(tok, Date.now() + TOKEN_TTL_MS);
	return true;
}

function revoke(req) {
	const tok = tokenFromReq(req);
	if (tok) tokens.delete(tok);
}

// Timing-safe password compare.
function passwordMatches(input, expected) {
	const a = Buffer.from(String(input || ""));
	const b = Buffer.from(String(expected || ""));
	if (a.length !== b.length) return false;
	try {
		return crypto.timingSafeEqual(a, b);
	} catch {
		return false;
	}
}

// ── Login rate limiting ────────────────────────────────────────────
// Per-IP failed-attempt counter for /api/admin/login. Decisions are made
// before evaluating the password so a blocked IP never reaches passwordMatches.
const loginAttempts = new Map(); // ip -> { count, resetAt }

function checkLoginAllowed(ip, { now = Date.now(), max = 5 } = {}) {
	const e = loginAttempts.get(ip);
	if (!e) return { allowed: true, retryAfterMs: 0 };
	if (now >= e.resetAt) { loginAttempts.delete(ip); return { allowed: true, retryAfterMs: 0 }; }
	if (e.count >= max) return { allowed: false, retryAfterMs: e.resetAt - now };
	return { allowed: true, retryAfterMs: 0 };
}

function recordLoginFailure(ip, { now = Date.now(), windowMs = 15 * 60 * 1000 } = {}) {
	let e = loginAttempts.get(ip);
	if (!e || now >= e.resetAt) {
		e = { count: 0, resetAt: now + windowMs };
		loginAttempts.set(ip, e);
	}
	e.count += 1;
	return e.count;
}

function resetLoginAttempts(ip) {
	loginAttempts.delete(ip);
}

module.exports = {
	classify,
	clientIp,
	inCidr,
	issueToken,
	isAuthed,
	revoke,
	passwordMatches,
	checkLoginAllowed,
	recordLoginFailure,
	resetLoginAttempts,
	TOKEN_TTL_MS,
};

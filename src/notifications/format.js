"use strict";

// Pure digest → text formatting for Telegram. No I/O, no token handling, so
// it is trivially testable in isolation.

const TELEGRAM_MAX = 4096; // Telegram message limit in UTF-16 code units

const SEVERITY_ICON = { info: "ℹ️", warning: "⚠️", critical: "🚨" };

function severityRank(s) {
	return s === "critical" ? 3 : s === "warning" ? 2 : 1;
}

// Highest severity across a list of events ("info" if empty).
function highestSeverity(events) {
	let best = "info";
	for (const e of events || []) {
		if (severityRank(e.severity) > severityRank(best)) best = e.severity;
	}
	return best;
}

// Render a digest into a single Telegram-ready string, truncated to the limit.
function formatDigest(digest) {
	const events = (digest && digest.events) || [];
	const top = highestSeverity(events);
	const header = `${SEVERITY_ICON[top] || ""} Sun2000${digest && digest.coalesced ? " (gesammelt)" : ""} · ${events.length} Ereignis${events.length === 1 ? "" : "se"}`;
	const lines = [header.trim()];
	for (const e of events) {
		const icon = SEVERITY_ICON[e.severity] || "";
		const time = new Date(e.t || Date.now()).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
		const title = e.title ? `${e.title}: ` : "";
		lines.push(`${icon} ${time} ${title}${e.message || ""}`.trim());
	}
	return truncate(lines.join("\n"), TELEGRAM_MAX);
}

function truncate(text, max) {
	if (text.length <= max) return text;
	return text.slice(0, max - 1) + "…";
}

module.exports = { formatDigest, highestSeverity, severityRank, truncate, TELEGRAM_MAX, SEVERITY_ICON };

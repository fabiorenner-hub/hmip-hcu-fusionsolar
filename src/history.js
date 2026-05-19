"use strict";

// In-memory ring buffer of recent snapshots. Backs the live charts and the
// "today" / cycle statistics surfaced on the dashboard.
//
// At 10 s poll interval, 6 hours = 2160 samples. Memory footprint is well
// below 5 MB even with 30+ tracked fields.

const MAX_SAMPLES = 2160;
const TRACK = [
	"inputPower",
	"activePower",
	"meterActivePower",
	"batteryChargeDischargePower",
	"batterySoc",
	"internalTemp",
	"gridFrequency",
];

const samples = [];
let dailyResetAt = startOfDay();

const today = freshDay();

function freshDay() {
	return {
		peakPv: 0,
		peakHouse: 0,
		peakImport: 0,
		peakExport: 0,
		peakBatteryCharge: 0,
		peakBatteryDischarge: 0,
		minSoc: null,
		maxSoc: null,
	};
}

function startOfDay() {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

function maybeRollover() {
	const now = Date.now();
	if (now - dailyResetAt >= 24 * 60 * 60 * 1000 || new Date().getTime() < dailyResetAt) {
		dailyResetAt = startOfDay();
		Object.assign(today, freshDay());
	}
}

function pushSnapshot(snapshot) {
	maybeRollover();
	const v = snapshot.values || {};
	const sample = { t: snapshot.lastUpdate || Date.now() };
	for (const f of TRACK) sample[f] = typeof v[f] === "number" ? v[f] : null;

	// Derived: house load = inverter AC − meter export
	const inv = sample.activePower || 0;
	const grid = sample.meterActivePower || 0;
	sample.houseLoad = Math.max(0, inv - grid);

	samples.push(sample);
	if (samples.length > MAX_SAMPLES) samples.shift();

	// Update peaks
	updatePeak("peakPv", sample.inputPower);
	updatePeak("peakHouse", sample.houseLoad);
	if ((sample.meterActivePower || 0) < 0) updatePeak("peakImport", -sample.meterActivePower);
	if ((sample.meterActivePower || 0) > 0) updatePeak("peakExport", sample.meterActivePower);
	if ((sample.batteryChargeDischargePower || 0) > 0) updatePeak("peakBatteryCharge", sample.batteryChargeDischargePower);
	if ((sample.batteryChargeDischargePower || 0) < 0) updatePeak("peakBatteryDischarge", -sample.batteryChargeDischargePower);
	if (typeof v.batterySoc === "number") {
		if (today.minSoc === null || v.batterySoc < today.minSoc) today.minSoc = v.batterySoc;
		if (today.maxSoc === null || v.batterySoc > today.maxSoc) today.maxSoc = v.batterySoc;
	}
}

function updatePeak(key, value) {
	if (typeof value === "number" && value > today[key]) today[key] = value;
}

function range(seconds = 3600) {
	const cutoff = Date.now() - seconds * 1000;
	return samples.filter((s) => s.t >= cutoff);
}

function stats() {
	maybeRollover();
	return { ...today, samples: samples.length, retentionSeconds: MAX_SAMPLES * 10 };
}

function selfSufficiency() {
	// Σ(produced consumed locally) / Σ(consumed) over the buffer window.
	let consumed = 0;
	let importGrid = 0;
	for (const s of samples) {
		const c = s.houseLoad || 0;
		const grid = s.meterActivePower || 0;
		consumed += c;
		if (grid < 0) importGrid += -grid;
	}
	if (consumed <= 0) return null;
	return Math.max(0, Math.min(1, 1 - importGrid / consumed));
}

module.exports = { pushSnapshot, range, stats, selfSufficiency, TRACK };

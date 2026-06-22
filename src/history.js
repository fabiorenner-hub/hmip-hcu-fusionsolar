"use strict";

// Tiered, memory-bounded history.
//
// The plugin runs 24/7 inside the HCU container, so unbounded sample
// retention would slowly eat memory. We keep three tiers, each cheaper than
// the last, and fold older data into coarser summaries instead of dropping
// it outright:
//
//   1. raw      — full 10 s resolution, last 6 h. Backs the live charts.
//   2. hourly   — one aggregate bucket per hour (avg/min/max + energy),
//                 retained up to 96 h.
//   3. daily    — after 96 h, hourly buckets are condensed into one summary
//                 per day (the essentials only) and kept for ~30 days.
//
// At 10 s poll interval, 6 h = 2160 raw samples. The hourly tier is ~96
// tiny objects, the daily tier ~30 — both negligible compared to the raw
// ring, so total footprint stays well under 5 MB regardless of uptime.

const MAX_SAMPLES = 2160; // 6 h of raw samples @ 10 s
const HOURLY_RETENTION_MS = 96 * 60 * 60 * 1000; // 96 h before condensing to daily
const DAILY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days of daily summaries
const BUCKET_MS = 60 * 60 * 1000; // 1 h aggregate buckets
const MAX_DT_MS = 60 * 1000; // cap per-sample integration gap (guards energy after downtime)

const TRACK = [
	"inputPower",
	"activePower",
	"meterActivePower",
	"batteryChargeDischargePower",
	"batterySoc",
	"internalTemp",
	"gridFrequency",
];

const samples = []; // raw tier
const hourly = []; // aggregate tier (completed buckets)
const daily = []; // condensed tier (one per day)

let bucket = null; // open hourly accumulator
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

// ── Aggregation tier ───────────────────────────────────────────────

function newBucket(startMs) {
	return {
		start: startMs,
		n: 0,
		sum: {}, // per-field running sum → avg
		min: {}, // per-field minimum
		max: {}, // per-field maximum
		// Energy integrals (Wh) over the bucket window
		pvWh: 0,
		houseWh: 0,
		importWh: 0,
		exportWh: 0,
		battChargeWh: 0,
		battDischargeWh: 0,
		lastT: null,
	};
}

function accumulate(b, sample) {
	// Per-field statistics
	for (const f of TRACK) {
		const v = sample[f];
		if (typeof v !== "number") continue;
		b.sum[f] = (b.sum[f] || 0) + v;
		b.min[f] = b.min[f] === undefined ? v : Math.min(b.min[f], v);
		b.max[f] = b.max[f] === undefined ? v : Math.max(b.max[f], v);
	}
	b.n += 1;

	// Energy integration: power (W) × Δt (h) → Wh. Clamp Δt so a long gap
	// (plugin restart, inverter night mode) can't inflate the totals.
	if (b.lastT != null) {
		const dtH = Math.min(MAX_DT_MS, sample.t - b.lastT) / 3600000;
		if (dtH > 0) {
			const pv = sample.inputPower || 0;
			const house = sample.houseLoad || 0;
			const grid = sample.meterActivePower || 0;
			const batt = sample.batteryChargeDischargePower || 0;
			b.pvWh += pv * dtH;
			b.houseWh += house * dtH;
			if (grid < 0) b.importWh += -grid * dtH;
			if (grid > 0) b.exportWh += grid * dtH;
			if (batt > 0) b.battChargeWh += batt * dtH;
			if (batt < 0) b.battDischargeWh += -batt * dtH;
		}
	}
	b.lastT = sample.t;
}

function finalizeBucket(b) {
	const avg = {};
	for (const f of TRACK) {
		if (b.sum[f] !== undefined && b.n > 0) avg[f] = b.sum[f] / b.n;
	}
	return {
		start: b.start,
		n: b.n,
		avg,
		min: { ...b.min },
		max: { ...b.max },
		energy: {
			pvWh: round(b.pvWh),
			houseWh: round(b.houseWh),
			importWh: round(b.importWh),
			exportWh: round(b.exportWh),
			battChargeWh: round(b.battChargeWh),
			battDischargeWh: round(b.battDischargeWh),
		},
	};
}

function round(n) {
	return Math.round(n * 100) / 100;
}

function feedAggregates(sample) {
	const bucketStart = Math.floor(sample.t / BUCKET_MS) * BUCKET_MS;
	if (!bucket) {
		bucket = newBucket(bucketStart);
	} else if (bucketStart !== bucket.start) {
		// Hour boundary crossed — close the current bucket and open a new one.
		if (bucket.n > 0) hourly.push(finalizeBucket(bucket));
		bucket = newBucket(bucketStart);
	}
	accumulate(bucket, sample);
	condenseOldData(sample.t);
}

// Fold hourly buckets older than 96 h into one daily summary each, then drop
// them. Keeps long-term trends visible while shedding most of the volume.
function condenseOldData(now) {
	const cutoff = now - HOURLY_RETENTION_MS;
	let changed = false;
	while (hourly.length && hourly[0].start < cutoff) {
		foldIntoDaily(hourly.shift());
		changed = true;
	}
	if (changed) {
		const dayCutoff = now - DAILY_RETENTION_MS;
		while (daily.length && daily[0].day < dayCutoff) daily.shift();
	}
}

function foldIntoDaily(h) {
	const dayStart = startOfDayMs(h.start);
	let d = daily.length && daily[daily.length - 1].day === dayStart ? daily[daily.length - 1] : null;
	if (!d) {
		d = {
			day: dayStart,
			hours: 0,
			energy: { pvWh: 0, houseWh: 0, importWh: 0, exportWh: 0, battChargeWh: 0, battDischargeWh: 0 },
			peakPv: 0,
			peakHouse: 0,
			minSoc: null,
			maxSoc: null,
		};
		daily.push(d);
	}
	d.hours += 1;
	for (const k of Object.keys(d.energy)) d.energy[k] = round(d.energy[k] + (h.energy[k] || 0));
	if (h.max.inputPower !== undefined) d.peakPv = Math.max(d.peakPv, h.max.inputPower);
	if (h.max.activePower !== undefined) d.peakHouse = Math.max(d.peakHouse, h.max.activePower);
	if (h.min.batterySoc !== undefined) d.minSoc = d.minSoc == null ? h.min.batterySoc : Math.min(d.minSoc, h.min.batterySoc);
	if (h.max.batterySoc !== undefined) d.maxSoc = d.maxSoc == null ? h.max.batterySoc : Math.max(d.maxSoc, h.max.batterySoc);
}

function startOfDayMs(ms) {
	const d = new Date(ms);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

// ── Ingest ─────────────────────────────────────────────────────────

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

	feedAggregates(sample);

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

// ── Accessors ──────────────────────────────────────────────────────

function range(seconds = 3600) {
	const cutoff = Date.now() - seconds * 1000;
	return samples.filter((s) => s.t >= cutoff);
}

// Long-term tiers for trend views. `hourly` includes the still-open bucket
// so the current hour is visible immediately.
function aggregates() {
	const open = bucket && bucket.n > 0 ? [finalizeBucket(bucket)] : [];
	return { hourly: [...hourly, ...open], daily: [...daily] };
}

function stats() {
	maybeRollover();
	return {
		...today,
		samples: samples.length,
		retentionSeconds: MAX_SAMPLES * 10,
		hourlyBuckets: hourly.length + (bucket && bucket.n > 0 ? 1 : 0),
		dailySummaries: daily.length,
	};
}

function selfSufficiency() {
	// Σ(produced consumed locally) / Σ(consumed) over the raw buffer window.
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

module.exports = { pushSnapshot, range, stats, selfSufficiency, aggregates, TRACK };

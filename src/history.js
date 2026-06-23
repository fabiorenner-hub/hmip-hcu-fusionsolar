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
const MAX_HOURLY = Math.round(HOURLY_RETENTION_MS / BUCKET_MS); // 96
const MAX_DAILY = Math.round(DAILY_RETENTION_MS / (24 * 60 * 60 * 1000)); // 30
const HISTORY_STORE_VERSION = 1;
let lastPersistError = null;

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
let cachedSelfSufficiency = null; // recomputed once per snapshot, not per read

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
		// Accurate daily energy (kWh) sourced from the inverter's own counters
		// rather than integrated power. PV / battery have native daily
		// registers; grid import/export are derived from the lifetime meter
		// counters minus their value at the first sample of the day.
		startImport: null,
		startExport: null,
		energyToday: { pv: null, battCharge: null, battDischarge: null, import: null, export: null },
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
		// De-dupe by start so a restored hourly bucket is never duplicated.
		if (bucket.n > 0) {
			const finalized = finalizeBucket(bucket);
			const idx = hourly.findIndex((h) => h.start === finalized.start);
			if (idx >= 0) hourly[idx] = finalized;
			else hourly.push(finalized);
		}
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

	updateDailyEnergy(v);
	cachedSelfSufficiency = computeSelfSufficiency();
}

// Daily energy from the inverter's counters (more accurate than integrating
// power). PV and battery expose native daily registers; grid import/export
// are deltas of the lifetime meter counters since the first sample today.
function updateDailyEnergy(v) {
	const e = today.energyToday;
	if (typeof v.dailyYield === "number") e.pv = v.dailyYield;
	if (typeof v.batteryDayChargeCapacity === "number") e.battCharge = v.batteryDayChargeCapacity;
	if (typeof v.batteryDayDischargeCapacity === "number") e.battDischarge = v.batteryDayDischargeCapacity;

	if (typeof v.meterPositiveActiveEnergy === "number") {
		if (today.startImport === null) today.startImport = v.meterPositiveActiveEnergy;
		if (v.meterPositiveActiveEnergy >= today.startImport) e.import = round(v.meterPositiveActiveEnergy - today.startImport);
	}
	if (typeof v.meterReverseActiveEnergy === "number") {
		if (today.startExport === null) today.startExport = v.meterReverseActiveEnergy;
		if (v.meterReverseActiveEnergy >= today.startExport) e.export = round(v.meterReverseActiveEnergy - today.startExport);
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
	return cachedSelfSufficiency;
}

// Σ(produced consumed locally) / Σ(consumed) over the raw buffer window.
// Computed once per snapshot (in pushSnapshot) and cached — callers (every
// /api/snapshot and every 2 s SSE broadcast) just read the cached value.
function computeSelfSufficiency() {
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

module.exports = { pushSnapshot, range, stats, selfSufficiency, aggregates, TRACK, serialize, restore, historyToCsv, persistError, notePersistError, HISTORY_STORE_VERSION };

// ── Persistence ────────────────────────────────────────────────────

// Pure, JSON-safe snapshot of the long-term tiers (and optionally a recent raw
// window). Excludes the still-open bucket so a restore never duplicates the
// current hour.
function serialize({ includeRawWindowMs = 0, now = Date.now() } = {}) {
	const store = { version: HISTORY_STORE_VERSION, savedAt: now, hourly: hourly.slice(), daily: daily.slice() };
	if (includeRawWindowMs > 0) {
		const cutoff = now - includeRawWindowMs;
		store.raw = samples.filter((s) => s.t >= cutoff).map((s) => ({ ...s }));
	}
	return store;
}

// Resilient restore into the live tiers. Never throws. Missing/unparseable/
// unknown-version → empty tiers. Prunes out-of-window entries, skips malformed
// ones, de-dupes by start/day, and bounds the tier sizes.
function restore(store, { now = Date.now() } = {}) {
	hourly.length = 0;
	daily.length = 0;
	if (!store || typeof store !== "object" || store.version !== HISTORY_STORE_VERSION) {
		const reason = !store || typeof store !== "object" ? "missing" : "version";
		return { ok: false, reason, restored: { hourly: 0, daily: 0, raw: 0 }, skipped: 0 };
	}
	let skipped = 0;
	const hourlyCutoff = now - HOURLY_RETENTION_MS;
	const dailyCutoff = now - DAILY_RETENTION_MS;

	const seenH = new Set();
	for (const h of Array.isArray(store.hourly) ? store.hourly : []) {
		if (!h || typeof h.start !== "number" || typeof h.energy !== "object" || h.energy === null) { skipped += 1; continue; }
		if (h.start < hourlyCutoff || seenH.has(h.start)) continue;
		seenH.add(h.start);
		hourly.push(h);
	}
	hourly.sort((a, b) => a.start - b.start);
	if (hourly.length > MAX_HOURLY) hourly.splice(0, hourly.length - MAX_HOURLY);

	const seenD = new Set();
	for (const d of Array.isArray(store.daily) ? store.daily : []) {
		if (!d || typeof d.day !== "number" || typeof d.energy !== "object" || d.energy === null) { skipped += 1; continue; }
		if (d.day < dailyCutoff || seenD.has(d.day)) continue;
		seenD.add(d.day);
		daily.push(d);
	}
	daily.sort((a, b) => a.day - b.day);
	if (daily.length > MAX_DAILY) daily.splice(0, daily.length - MAX_DAILY);

	let rawN = 0;
	if (Array.isArray(store.raw)) {
		const cutoff = now - MAX_SAMPLES * 10 * 1000;
		for (const s of store.raw) {
			if (s && typeof s.t === "number" && s.t >= cutoff) { samples.push(s); rawN += 1; }
		}
		samples.sort((a, b) => a.t - b.t);
		while (samples.length > MAX_SAMPLES) samples.shift();
	}
	return { ok: true, reason: "ok", restored: { hourly: hourly.length, daily: daily.length, raw: rawN }, skipped };
}

const CSV_HEADER = "tier,startOrDay,n,pvWh,houseWh,importWh,exportWh,battChargeWh,battDischargeWh,peakPv,peakHouse,minSoc,maxSoc";

// Pure CSV formatter for the aggregate tiers. Always emits the header first.
function historyToCsv({ hourly: h = [], daily: d = [] } = {}) {
	const lines = [CSV_HEADER];
	const e = (x) => (x === null || x === undefined ? "" : x);
	for (const b of h) {
		const en = b.energy || {};
		const mx = b.max || {};
		const mn = b.min || {};
		lines.push(["hourly", e(b.start), e(b.n), e(en.pvWh), e(en.houseWh), e(en.importWh), e(en.exportWh), e(en.battChargeWh), e(en.battDischargeWh), e(mx.inputPower), e(mx.activePower), e(mn.batterySoc), e(mx.batterySoc)].join(","));
	}
	for (const s of d) {
		const en = s.energy || {};
		lines.push(["daily", e(s.day), e(s.hours), e(en.pvWh), e(en.houseWh), e(en.importWh), e(en.exportWh), e(en.battChargeWh), e(en.battDischargeWh), e(s.peakPv), e(s.peakHouse), e(s.minSoc), e(s.maxSoc)].join(","));
	}
	return lines.join("\n");
}

function persistError() {
	return lastPersistError;
}
function notePersistError(err) {
	lastPersistError = err || null;
}

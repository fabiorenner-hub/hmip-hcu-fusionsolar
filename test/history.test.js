"use strict";

const test = require("node:test");
const assert = require("node:assert");
const history = require("../src/history");

function snap(values, t) {
	return { lastUpdate: t || Date.now(), values };
}

test("daily energy from inverter counters", () => {
	// First sample sets the import/export baseline.
	history.pushSnapshot(snap({
		inputPower: 1000, activePower: 900, meterActivePower: -200,
		batteryChargeDischargePower: 0, batterySoc: 50,
		dailyYield: 5.0, batteryDayChargeCapacity: 1.2, batteryDayDischargeCapacity: 0.8,
		meterPositiveActiveEnergy: 100.0, meterReverseActiveEnergy: 40.0,
	}));
	history.pushSnapshot(snap({
		inputPower: 1200, activePower: 1100, meterActivePower: 100,
		batteryChargeDischargePower: 300, batterySoc: 55,
		dailyYield: 5.4, batteryDayChargeCapacity: 1.5, batteryDayDischargeCapacity: 0.8,
		meterPositiveActiveEnergy: 100.6, meterReverseActiveEnergy: 41.0,
	}));

	const s = history.stats();
	assert.strictEqual(s.energyToday.pv, 5.4, "pv = latest dailyYield");
	assert.strictEqual(s.energyToday.battCharge, 1.5);
	assert.ok(Math.abs(s.energyToday.import - 0.6) < 1e-6, "import delta since first sample");
	assert.ok(Math.abs(s.energyToday.export - 1.0) < 1e-6, "export delta since first sample");
});

test("aggregates expose hourly buckets and tracked fields", () => {
	const agg = history.aggregates();
	assert.ok(Array.isArray(agg.hourly));
	assert.ok(Array.isArray(agg.daily));
	const stats = history.stats();
	assert.ok(stats.samples >= 2);
	assert.ok(stats.retentionSeconds > 0);
});

test("selfSufficiency within 0..1 or null", () => {
	const v = history.selfSufficiency();
	assert.ok(v === null || (v >= 0 && v <= 1));
});

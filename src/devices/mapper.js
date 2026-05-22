"use strict";

// Translates a Sun2000 snapshot into HCU plugin device descriptors and
// feature update sets. DeviceType / Feature names follow the HCU
// Connect API documentation v1.0.1, sections 6.5.1 (Device), 6.6.5
// (DeviceType) and 6.7 (Feature schemas).

const log = require("../logger");

// Stable device IDs derived from the inverter SN (or "unknown") so they
// survive plugin restarts. UUID v5 would be cleaner but adds a dep we
// don't strictly need; a deterministic string is good enough.
function did(sn, suffix) {
	const base = (sn || "sun2000").replace(/[^A-Za-z0-9]/g, "").toLowerCase().slice(0, 24);
	return `${base}-${suffix}`;
}

function clampSoc(socPercent) {
	if (typeof socPercent !== "number" || Number.isNaN(socPercent)) return 0;
	const v = Math.max(0, Math.min(100, socPercent));
	return v / 100;
}

function buildDevices(config, snapshot) {
	// Prefer the persisted SN. This is the SN we observed on the very first
	// successful static read and saved to /data/config.json. Falling back
	// to the live SN only on a fresh install — and to a generic literal as
	// a last resort, but that path means HmIP devices will be re-registered
	// once a real SN appears, which we want to avoid.
	const sn = config.persistedSn || snapshot.static.sn;
	const model = snapshot.static.model || "Sun2000";
	const fw = snapshot.static.firmwareVersion || "0.0.0";
	const v = snapshot.values || {};
	const devices = [];

	// 1. Solar inverter ─────────────────────────────────────────────
	devices.push({
		deviceType: "INVERTER",
		deviceId: did(sn, "inverter"),
		modelType: model,
		firmwareVersion: fw,
		friendlyName: "Sun2000 Wechselrichter",
		features: [
			{ type: "currentPower", currentPower: numOr0(v.activePower) },
			{ type: "energyCounter", in: 0, out: numOr0(v.totalYield) },
			{ type: "maintenance", unreach: !snapshot.connected, lowBat: false, sabotage: false },
		],
	});

	// 2. Grid connection point (the smart meter) ──────────────────
	if (config.hasMeter) {
		const meterPower = numOr0(v.meterActivePower); // + export, − import (Huawei convention)
		// HmIP convention for GRID_CONNECTION_POINT.currentPower is "consumed
		// or produced power". We expose the meter sign as-is so HmIP charts
		// show export positive / import negative, matching the Huawei sign.
		devices.push({
			deviceType: "GRID_CONNECTION_POINT",
			deviceId: did(sn, "grid"),
			modelType: "DTSU666-H",
			firmwareVersion: fw,
			friendlyName: "Netzanschluss",
			features: [
				{ type: "currentPower", currentPower: meterPower },
				{
					type: "energyCounter",
					in: numOr0(v.meterPositiveActiveEnergy), // imported from grid
					out: numOr0(v.meterReverseActiveEnergy), // fed into grid
				},
				{ type: "maintenance", unreach: !snapshot.connected || v.meterStatus === 0, lowBat: false, sabotage: false },
			],
		});

		// 3. Derived "House" energy meter (consumption) ─────────────
		// House load = inverter active power − grid feed-in
		//            = inverterActive + (gridImport−gridExport)
		// Using meterActivePower with Huawei sign: meter+ is export.
		const inverterAc = numOr0(v.activePower);
		const houseLoad = Math.max(0, inverterAc - meterPower);
		devices.push({
			deviceType: "ENERGY_METER",
			deviceId: did(sn, "house"),
			modelType: "Virtual",
			firmwareVersion: fw,
			friendlyName: "Hausverbrauch",
			features: [
				{ type: "currentPower", currentPower: houseLoad },
				{ type: "maintenance", unreach: !snapshot.connected, lowBat: false, sabotage: false },
			],
		});
	}

	// 4. Battery ───────────────────────────────────────────────────
	if (config.hasBattery) {
		const ratedWh = numOr0(v.batteryRatedCapacity || snapshot.static.batteryRatedCapacity);
		// Huawei sign: + = charging, − = discharging. INVERTER deviceType uses
		// CurrentPower with positive = "produced" power. For BATTERY we use
		// the natural sign to keep app graphs readable.
		const chargePow = numOr0(v.batteryChargeDischargePower);
		devices.push({
			deviceType: "BATTERY",
			deviceId: did(sn, "battery"),
			modelType: "LUNA2000",
			firmwareVersion: fw,
			friendlyName: "LUNA2000 Speicher",
			features: [
				{
					type: "batteryState",
					batteryLevel: clampSoc(v.batterySoc),
					batteryCapacity: ratedWh || undefined,
				},
				{ type: "currentPower", currentPower: chargePow },
				{
					type: "energyCounter",
					in: numOr0(v.batteryTotalCharge),
					out: numOr0(v.batteryTotalDischarge),
				},
				{
					type: "maintenance",
					unreach: !snapshot.connected || v.batteryRunningStatus === 0,
					lowBat: clampSoc(v.batterySoc) < 0.05,
					sabotage: false,
				},
			],
		});

		// Optional control switch for forced-charge mode
		if (config.enableBatteryForcedCharge) {
			const mode = v.batteryWorkingMode;
			devices.push({
				deviceType: "SWITCH",
				deviceId: did(sn, "force-charge"),
				modelType: "Virtual",
				firmwareVersion: fw,
				friendlyName: "Speicher Zwangsladung",
				features: [
					{ type: "switchState", on: mode === 1 },
					{ type: "maintenance", unreach: !snapshot.connected, lowBat: false, sabotage: false },
				],
			});
		}
	}

	return devices;
}

function numOr0(v) {
	return typeof v === "number" && !Number.isNaN(v) ? v : 0;
}

// Reverse mapping for ControlRequest: turn an incoming device control
// request into a Modbus write.
async function handleControl(modbus, config, deviceId, features) {
	const sn = config.persistedSn || config._lastSn || "sun2000";
	const forceChargeId = did(sn, "force-charge");
	if (deviceId === forceChargeId) {
		const sw = features.find((f) => f.type === "switchState");
		if (!sw) return { success: false, error: { code: "BAD_REQUEST", message: "switchState missing" } };
		// 1 = forced charge, 0 = adaptive
		try {
			await modbus.writeRegister("batteryWorkingMode", sw.on ? 1 : 0);
			return { success: true };
		} catch (e) {
			return { success: false, error: { code: "MODBUS_WRITE_FAILED", message: e.message } };
		}
	}
	return { success: false, error: { code: "DEVICE_NOT_CONTROLLABLE", message: "Device is read-only" } };
}

module.exports = { buildDevices, handleControl, did };

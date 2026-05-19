"use strict";

// Sun2000 / SDongleA-05 / LUNA2000 / DTSU666-H Modbus register map.
//
// Sources: Huawei "Solar Inverter Modbus Interface Definitions" v3.0+ and
// the well-established community-maintained map used by HomeAssistant
// integrations and FusionSolarPy. All registers are holding registers
// (function code 0x03 for read, 0x10 for write multiple).
//
// type:
//   "u16" / "i16" / "u32" / "i32" : numeric, big-endian word order
//   "string"                       : ASCII string of `length` words
// scale:
//   value = raw / scale (apply only to numeric types)
// unit: informational
// rw: "r" or "rw"

const REG = {
	// ── Inverter info ───────────────────────────────────────────────
	model:           { addr: 30000, length: 15, type: "string", unit: "",   rw: "r"  },
	sn:              { addr: 30015, length: 10, type: "string", unit: "",   rw: "r"  },
	pn:              { addr: 30025, length: 10, type: "string", unit: "",   rw: "r"  },
	firmwareVersion: { addr: 30035, length: 15, type: "string", unit: "",   rw: "r"  },
	ratedPower:      { addr: 30073, length:  2, type: "u32",    unit: "W",  rw: "r"  },

	// ── Inverter realtime ──────────────────────────────────────────
	inputPower:      { addr: 32064, length: 2, type: "i32", unit: "W",     rw: "r" },                 // PV input total
	gridFrequency:   { addr: 32085, length: 1, type: "u16", unit: "Hz",    rw: "r", scale: 100 },
	internalTemp:    { addr: 32087, length: 1, type: "i16", unit: "°C",    rw: "r", scale: 10  },
	insulationRes:   { addr: 32088, length: 1, type: "u16", unit: "MΩ",    rw: "r", scale: 1000 },
	deviceStatus:    { addr: 32089, length: 1, type: "u16", unit: "",      rw: "r" },
	activePower:     { addr: 32080, length: 2, type: "i32", unit: "W",     rw: "r" },                 // inverter active power output (AC)
	reactivePower:   { addr: 32082, length: 2, type: "i32", unit: "var",   rw: "r" },
	powerFactor:     { addr: 32084, length: 1, type: "i16", unit: "",      rw: "r", scale: 1000 },
	efficiency:      { addr: 32086, length: 1, type: "u16", unit: "%",     rw: "r", scale: 100 },

	// PV strings (up to 4 inputs on common Sun2000 residential models)
	pv1Voltage: { addr: 32016, length: 1, type: "i16", unit: "V", rw: "r", scale: 10 },
	pv1Current: { addr: 32017, length: 1, type: "i16", unit: "A", rw: "r", scale: 100 },
	pv2Voltage: { addr: 32018, length: 1, type: "i16", unit: "V", rw: "r", scale: 10 },
	pv2Current: { addr: 32019, length: 1, type: "i16", unit: "A", rw: "r", scale: 100 },
	pv3Voltage: { addr: 32020, length: 1, type: "i16", unit: "V", rw: "r", scale: 10 },
	pv3Current: { addr: 32021, length: 1, type: "i16", unit: "A", rw: "r", scale: 100 },
	pv4Voltage: { addr: 32022, length: 1, type: "i16", unit: "V", rw: "r", scale: 10 },
	pv4Current: { addr: 32023, length: 1, type: "i16", unit: "A", rw: "r", scale: 100 },

	// Per-phase inverter AC values
	phaseAVoltage: { addr: 32069, length: 1, type: "u16", unit: "V", rw: "r", scale: 10  },
	phaseBVoltage: { addr: 32070, length: 1, type: "u16", unit: "V", rw: "r", scale: 10  },
	phaseCVoltage: { addr: 32071, length: 1, type: "u16", unit: "V", rw: "r", scale: 10  },
	phaseACurrent: { addr: 32072, length: 2, type: "i32", unit: "A", rw: "r", scale: 1000 },
	phaseBCurrent: { addr: 32074, length: 2, type: "i32", unit: "A", rw: "r", scale: 1000 },
	phaseCCurrent: { addr: 32076, length: 2, type: "i32", unit: "A", rw: "r", scale: 1000 },

	// Yields
	dailyYield:      { addr: 32114, length: 2, type: "u32", unit: "kWh", rw: "r", scale: 100 },
	totalYield:      { addr: 32106, length: 2, type: "u32", unit: "kWh", rw: "r", scale: 100 },
	accumulatedYield:{ addr: 32106, length: 2, type: "u32", unit: "kWh", rw: "r", scale: 100 }, // alias

	// ── DTSU666-H Smart meter (via inverter passthrough) ──────────
	meterStatus:           { addr: 37100, length: 1, type: "u16", unit: "",   rw: "r" }, // 0 offline, 1 online
	meterActivePower:      { addr: 37113, length: 2, type: "i32", unit: "W",  rw: "r" }, // grid: + = export, − = import
	meterReactivePower:    { addr: 37115, length: 2, type: "i32", unit: "var",rw: "r" },
	meterPowerFactor:      { addr: 37117, length: 1, type: "i16", unit: "",   rw: "r", scale: 1000 },
	meterFrequency:        { addr: 37118, length: 1, type: "u16", unit: "Hz", rw: "r", scale: 100 },
	meterPositiveActiveEnergy: { addr: 37119, length: 2, type: "u32", unit: "kWh", rw: "r", scale: 100 }, // imported
	meterReverseActiveEnergy:  { addr: 37121, length: 2, type: "u32", unit: "kWh", rw: "r", scale: 100 }, // exported

	meterPhaseAVoltage: { addr: 37101, length: 2, type: "u32", unit: "V", rw: "r", scale: 10  },
	meterPhaseBVoltage: { addr: 37103, length: 2, type: "u32", unit: "V", rw: "r", scale: 10  },
	meterPhaseCVoltage: { addr: 37105, length: 2, type: "u32", unit: "V", rw: "r", scale: 10  },
	meterPhaseACurrent: { addr: 37107, length: 2, type: "i32", unit: "A", rw: "r", scale: 100 },
	meterPhaseBCurrent: { addr: 37109, length: 2, type: "i32", unit: "A", rw: "r", scale: 100 },
	meterPhaseCCurrent: { addr: 37111, length: 2, type: "i32", unit: "A", rw: "r", scale: 100 },

	// ── LUNA2000 battery ──────────────────────────────────────────
	batteryRunningStatus: { addr: 37000, length: 1, type: "u16", unit: "", rw: "r" }, // 0 offline, 1 standby, 2 running, 3 fault, 4 hibernate
	batteryChargeDischargePower: { addr: 37001, length: 2, type: "i32", unit: "W",   rw: "r" }, // − = discharge, + = charge
	batteryDayChargeCapacity:    { addr: 37015, length: 2, type: "u32", unit: "kWh", rw: "r", scale: 100 },
	batteryDayDischargeCapacity: { addr: 37017, length: 2, type: "u32", unit: "kWh", rw: "r", scale: 100 },
	batteryTotalCharge:          { addr: 37066, length: 2, type: "u32", unit: "kWh", rw: "r", scale: 100 },
	batteryTotalDischarge:       { addr: 37068, length: 2, type: "u32", unit: "kWh", rw: "r", scale: 100 },
	batterySoc:                  { addr: 37004, length: 1, type: "u16", unit: "%",   rw: "r", scale: 10  },
	batteryRatedCapacity:        { addr: 37758, length: 2, type: "u32", unit: "Wh",  rw: "r" },
	batteryBusVoltage:           { addr: 37003, length: 1, type: "u16", unit: "V",   rw: "r", scale: 10  },
	batteryBackupTime:           { addr: 37025, length: 1, type: "u16", unit: "min", rw: "r" },

	// ── Battery control (writeable) ────────────────────────────────
	// 0 = adaptive, 1 = forced charge, 2 = forced discharge, 3 = stop
	batteryWorkingMode:    { addr: 47004, length: 1, type: "u16", unit: "",   rw: "rw" },
	// Charge from grid allowed: 0 disabled, 1 enabled
	chargeFromGridEnable:  { addr: 47087, length: 1, type: "u16", unit: "",   rw: "rw" },
	// Forced charge/discharge target SOC % * 10
	forcedChargeTargetSoc: { addr: 47101, length: 1, type: "u16", unit: "%",  rw: "rw", scale: 10 },
	// Maximum charging power, W
	maxChargePower:        { addr: 47075, length: 2, type: "u32", unit: "W",  rw: "rw" },
	maxDischargePower:     { addr: 47077, length: 2, type: "u32", unit: "W",  rw: "rw" },
	// Active power derating (limit PV feed-in to grid), 0..100 %, *10
	activePowerLimit:      { addr: 40125, length: 1, type: "u16", unit: "%",  rw: "rw", scale: 10 },
};

// ── Decoders ──────────────────────────────────────────────────────────────

function decodeString(words, length) {
	const buf = Buffer.alloc(length * 2);
	for (let i = 0; i < length; i += 1) {
		buf.writeUInt16BE(words[i] & 0xffff, i * 2);
	}
	// trim NULs and trailing whitespace
	let end = buf.length;
	while (end > 0 && (buf[end - 1] === 0 || buf[end - 1] === 0x20)) end -= 1;
	return buf.slice(0, end).toString("ascii");
}

function decode(reg, words) {
	switch (reg.type) {
		case "string":
			return decodeString(words, reg.length);
		case "u16": {
			const v = words[0] & 0xffff;
			return reg.scale ? v / reg.scale : v;
		}
		case "i16": {
			let v = words[0] & 0xffff;
			if (v & 0x8000) v -= 0x10000;
			return reg.scale ? v / reg.scale : v;
		}
		case "u32": {
			const v = ((words[0] & 0xffff) << 16) >>> 0 | (words[1] & 0xffff);
			return reg.scale ? v / reg.scale : v >>> 0;
		}
		case "i32": {
			const hi = words[0] & 0xffff;
			const lo = words[1] & 0xffff;
			let v = (hi << 16) | lo;
			if (hi & 0x8000) v = v | 0; // already 32-bit signed in JS shift world
			else v = v >>> 0;
			// Re-derive a real signed 32-bit value:
			let signed = (hi << 16) | lo;
			signed = signed | 0; // JS bitwise is 32-bit signed
			return reg.scale ? signed / reg.scale : signed;
		}
		default:
			return null;
	}
}

function encode(reg, value) {
	const raw = reg.scale ? Math.round(value * reg.scale) : Math.round(value);
	switch (reg.type) {
		case "u16":
			return [raw & 0xffff];
		case "i16": {
			const v = raw < 0 ? raw + 0x10000 : raw;
			return [v & 0xffff];
		}
		case "u32":
			return [(raw >>> 16) & 0xffff, raw & 0xffff];
		case "i32": {
			const v = raw < 0 ? raw + 0x100000000 : raw;
			return [(v >>> 16) & 0xffff, v & 0xffff];
		}
		default:
			throw new Error(`Cannot encode register type ${reg.type}`);
	}
}

// Battery enums
const BATTERY_STATUS = {
	0: "OFFLINE",
	1: "STANDBY",
	2: "RUNNING",
	3: "FAULT",
	4: "HIBERNATE",
};

const DEVICE_STATUS = {
	0x0000: "Standby: initializing",
	0x0001: "Standby: detecting insulation resistance",
	0x0002: "Standby: detecting irradiation",
	0x0003: "Standby: grid detecting",
	0x0100: "Starting",
	0x0200: "On-grid",
	0x0201: "Grid Connection: power limited",
	0x0202: "Grid Connection: self derating",
	0x0300: "Shutdown: fault",
	0x0301: "Shutdown: command",
	0x0302: "Shutdown: OVGR",
	0x0303: "Shutdown: communication disconnected",
	0x0304: "Shutdown: power limited",
	0x0305: "Shutdown: manual startup required",
	0x0306: "Shutdown: DC switches disconnected",
	0x0307: "Shutdown: rapid cutoff",
	0x0308: "Shutdown: input underpower",
	0x0401: "Grid scheduling: cosphi-P curve",
	0x0402: "Grid scheduling: Q-U curve",
	0x0403: "Grid scheduling: PF-U curve",
	0x0404: "Grid scheduling: dry contact",
	0x0405: "Grid scheduling: Q-P curve",
	0x0500: "Spot-check ready",
	0x0501: "Spot-checking",
	0x0600: "Inspecting",
	0x0700: "AFCI self check",
	0x0800: "I-V scanning",
	0x0900: "DC input detection",
	0x0a00: "Running: off-grid charging",
	0xa000: "Standby: no irradiation",
};

// Contiguous register windows, each readable in a single Modbus request.
// Groups were chosen by inspecting REG addresses and bundling neighbours
// up to ~80 words per block (well below the 125-word Modbus limit).
const READ_BLOCKS = {
	staticInfo: {
		start: 30000,
		count: 75,                        // 30000 model … 30074 ratedPower
		names: ["model", "sn", "pn", "firmwareVersion", "ratedPower"],
	},
	pvAndAc: {
		start: 32016,
		count: 80,                        // 32016 pv1V … 32089 deviceStatus
		names: [
			"pv1Voltage", "pv1Current", "pv2Voltage", "pv2Current",
			"pv3Voltage", "pv3Current", "pv4Voltage", "pv4Current",
			"inputPower", "phaseAVoltage", "phaseBVoltage", "phaseCVoltage",
			"phaseACurrent", "phaseBCurrent", "phaseCCurrent",
			"activePower", "reactivePower", "powerFactor",
			"gridFrequency", "efficiency", "internalTemp",
			"insulationRes", "deviceStatus",
		],
	},
	yields: {
		start: 32106,
		count: 12,                         // 32106 totalYield … 32114 dailyYield
		names: ["totalYield", "dailyYield"],
	},
	battery: {
		start: 37000,
		count: 70,                         // 37000 status … 37068 totalDischarge
		names: [
			"batteryRunningStatus", "batteryChargeDischargePower",
			"batterySoc", "batteryBusVoltage", "batteryBackupTime",
			"batteryDayChargeCapacity", "batteryDayDischargeCapacity",
			"batteryTotalCharge", "batteryTotalDischarge",
		],
	},
	batteryStatic: {
		start: 37758,
		count: 2,                          // batteryRatedCapacity
		names: ["batteryRatedCapacity"],
	},
	meter: {
		start: 37100,
		count: 25,                         // 37100 meterStatus … 37121 reverseEnergy
		names: [
			"meterStatus",
			"meterPhaseAVoltage", "meterPhaseBVoltage", "meterPhaseCVoltage",
			"meterPhaseACurrent", "meterPhaseBCurrent", "meterPhaseCCurrent",
			"meterActivePower", "meterReactivePower",
			"meterPowerFactor", "meterFrequency",
			"meterPositiveActiveEnergy", "meterReverseActiveEnergy",
		],
	},
};

module.exports = { REG, decode, encode, BATTERY_STATUS, DEVICE_STATUS, READ_BLOCKS };

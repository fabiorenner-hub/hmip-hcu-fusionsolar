"use strict";

// Builds the ConfigTemplateResponse body that HCUweb renders as a form.
// Spec: HCU Connect API documentation v1.0.1 sections 6.3.1 / 6.5.3 / 6.5.4.

function build(currentConfig, languageCode = "de") {
	const c = currentConfig;
	const de = languageCode === "de";

	const groups = {
		modbus: {
			friendlyName: de ? "Wechselrichter (Modbus TCP)" : "Inverter (Modbus TCP)",
			description: de
				? "Lokale Verbindung zum Sun2000 über die SDongleA-05 oder den eingebauten WLAN-AP."
				: "Local connection to the Sun2000 via SDongleA-05 or the built-in WLAN AP.",
			order: 1,
		},
		hardware: {
			friendlyName: de ? "Komponenten" : "Components",
			description: de
				? "Welche Bestandteile sind verbaut? Standard ist beides aktiv."
				: "Which components are installed? Default is both enabled.",
			order: 2,
		},
		dashboard: {
			friendlyName: de ? "Debug-Dashboard" : "Debug dashboard",
			description: de
				? "Lokales Web-UI zur Live-Anzeige und Diagnose."
				: "Local web UI for live values and diagnostics.",
			order: 3,
		},
		cloud: {
			friendlyName: de ? "FusionSolar Cloud (Fallback)" : "FusionSolar cloud (fallback)",
			description: de
				? "Optional, nur lesend. Standardmäßig deaktiviert. Wird nur genutzt, wenn der lokale Modbus nicht erreichbar ist."
				: "Optional, read-only. Disabled by default. Used only when local Modbus is unreachable.",
			order: 4,
		},
	};

	const properties = {
		inverterHost: {
			dataType: "STRING",
			groupId: "modbus",
			order: 1,
			required: true,
			friendlyName: de ? "IP-Adresse / Hostname" : "IP address / hostname",
			description: de
				? "Adresse der SDongleA-05 oder des Inverter-WLAN-APs (z. B. 192.168.1.50)."
				: "Address of the SDongleA-05 or the inverter WLAN AP (e.g. 192.168.1.50).",
			currentValue: c.inverterHost || "",
			minimumLength: 1,
			maximumLength: 253,
		},
		inverterPort: {
			dataType: "INTEGER",
			groupId: "modbus",
			order: 2,
			required: true,
			friendlyName: de ? "Modbus-Port" : "Modbus port",
			currentValue: String(c.inverterPort ?? 502),
			defaultValue: "502",
			minimum: 1,
			maximum: 65535,
		},
		inverterUnitId: {
			dataType: "INTEGER",
			groupId: "modbus",
			order: 3,
			required: true,
			friendlyName: de ? "Modbus-Slave-ID" : "Modbus slave ID",
			description: de
				? "Bei SDongleA-05 üblicherweise 1, bei Master-/Slave-Verkettung höher."
				: "Usually 1 for SDongleA-05, higher in master/slave chains.",
			currentValue: String(c.inverterUnitId ?? 1),
			defaultValue: "1",
			minimum: 0,
			maximum: 247,
		},
		pollIntervalMs: {
			dataType: "INTEGER",
			groupId: "modbus",
			order: 4,
			required: true,
			friendlyName: de ? "Abfrage-Intervall (ms)" : "Poll interval (ms)",
			description: de
				? "Empfohlen: 10000 ms. Werte unter 5000 ms können den Wechselrichter überlasten."
				: "Recommended: 10000 ms. Values below 5000 ms can overload the inverter.",
			currentValue: String(c.pollIntervalMs ?? 10000),
			defaultValue: "10000",
			minimum: 2000,
			maximum: 600000,
		},

		hasBattery: {
			dataType: "BOOLEAN",
			groupId: "hardware",
			order: 1,
			friendlyName: de ? "LUNA2000 Speicher vorhanden" : "LUNA2000 battery installed",
			currentValue: String(Boolean(c.hasBattery)),
			defaultValue: "true",
		},
		hasMeter: {
			dataType: "BOOLEAN",
			groupId: "hardware",
			order: 2,
			friendlyName: de ? "DTSU666-H Smart Meter vorhanden" : "DTSU666-H smart meter installed",
			currentValue: String(Boolean(c.hasMeter)),
			defaultValue: "true",
		},
		enableBatteryForcedCharge: {
			dataType: "BOOLEAN",
			groupId: "hardware",
			order: 3,
			friendlyName: de
				? "Speicher-Steuerung als HmIP-Schalter freischalten"
				: "Expose battery control as HmIP switch",
			description: de
				? "Erzeugt einen Schalter „Speicher Zwangsladung“. Schreibzugriff auf Modbus-Register 47004."
				: "Creates a switch \"Battery forced charge\". Writes to Modbus register 47004.",
			currentValue: String(Boolean(c.enableBatteryForcedCharge)),
			defaultValue: "false",
		},

		dashboardEnabled: {
			dataType: "BOOLEAN",
			groupId: "dashboard",
			order: 1,
			friendlyName: de ? "Dashboard aktivieren" : "Enable dashboard",
			currentValue: String(Boolean(c.dashboardEnabled)),
			defaultValue: "true",
		},
		dashboardPort: {
			dataType: "INTEGER",
			groupId: "dashboard",
			order: 2,
			friendlyName: de ? "Dashboard-Port" : "Dashboard port",
			description: de
				? "Im Container EXPOSEd. HCU mappt 1:1 auf den selben Port nach außen."
				: "EXPOSEd in the container. HCU maps 1:1 to the same external port.",
			currentValue: String(c.dashboardPort ?? 8088),
			defaultValue: "8088",
			minimum: 1025,
			maximum: 65535,
		},

		cloudEnabled: {
			dataType: "BOOLEAN",
			groupId: "cloud",
			order: 1,
			friendlyName: de ? "Cloud-Fallback aktivieren" : "Enable cloud fallback",
			currentValue: String(Boolean(c.cloudEnabled)),
			defaultValue: "false",
		},
		cloudUser: {
			dataType: "STRING",
			groupId: "cloud",
			order: 2,
			friendlyName: de ? "FusionSolar Benutzername" : "FusionSolar user name",
			currentValue: c.cloudUser || "",
			minimumLength: 0,
			maximumLength: 200,
		},
		cloudPassword: {
			dataType: "PASSWORD",
			groupId: "cloud",
			order: 3,
			friendlyName: de ? "FusionSolar Passwort" : "FusionSolar password",
			currentValue: c.cloudPassword ? "••••••••" : "",
			minimumLength: 0,
			maximumLength: 200,
		},
		cloudSubdomain: {
			dataType: "STRING",
			groupId: "cloud",
			order: 4,
			friendlyName: de ? "Region (Subdomain)" : "Region (subdomain)",
			description: "z. B. region01eu5 / uni002eu5",
			currentValue: c.cloudSubdomain || "region01eu5",
			defaultValue: "region01eu5",
			minimumLength: 0,
			maximumLength: 30,
		},
	};

	return { groups, properties };
}

// Coerce HCUweb-supplied property values back to their typed form.
function applyUpdate(currentConfig, properties) {
	const next = { ...currentConfig };
	for (const [key, raw] of Object.entries(properties || {})) {
		switch (key) {
			case "inverterHost":
			case "cloudUser":
			case "cloudSubdomain":
				next[key] = String(raw || "").trim();
				break;
			case "cloudPassword":
				if (raw === "••••••••" || raw === "") break; // unchanged
				next[key] = String(raw);
				break;
			case "inverterPort":
			case "inverterUnitId":
			case "pollIntervalMs":
			case "dashboardPort":
				next[key] = parseInt(raw, 10);
				break;
			case "hasBattery":
			case "hasMeter":
			case "enableBatteryForcedCharge":
			case "dashboardEnabled":
			case "cloudEnabled":
				next[key] = raw === true || raw === "true" || raw === 1 || raw === "1";
				break;
			default:
				next[key] = raw;
		}
	}
	return next;
}

module.exports = { build, applyUpdate };

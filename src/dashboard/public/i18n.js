"use strict";

// Translations + pure i18n/theme helpers. Loaded as a plain <script> before
// app.js (exposes globals on window) and also require()-able under node:test
// (exposes module.exports) — it contains NO DOM access so it is safe to import.

(function () {
	const I18N = {
		de: {
			"tab.overview": "Übersicht",
			"tab.live": "Live",
			"tab.trend": "Verlauf",
			"tab.notifications": "Meldungen",
			"tab.inverter": "Wechselrichter",
			"tab.battery": "Speicher",
			"tab.grid": "Netz",
			"tab.control": "Steuerung",
			"tab.registers": "Modbus",
			"tab.hcu": "HCU",
			"tab.config": "Konfig",
			"tab.logs": "Logs",
			"tab.diag": "Diagnose",
			"overview.pv": "PV-Erzeugung",
			"overview.ac": "Wechselrichter AC",
			"overview.grid": "Netz",
			"overview.battery": "Speicher",
			"overview.house": "Hausverbrauch",
			"overview.hcu": "HCU-Verbindung",
			"overview.todayPeaks": "Tagesspitzen",
			"connected": "verbunden",
			"disconnected": "getrennt",
			"saved": "Gespeichert um",
			"update.install": "Update installieren",
			"update.current": "Aktuelle Version",
			"update.available": "Update verfügbar",
		},
		en: {
			"tab.overview": "Overview",
			"tab.live": "Live",
			"tab.trend": "Trend",
			"tab.notifications": "Notifications",
			"tab.inverter": "Inverter",
			"tab.battery": "Battery",
			"tab.grid": "Grid",
			"tab.control": "Control",
			"tab.registers": "Modbus",
			"tab.hcu": "HCU",
			"tab.config": "Config",
			"tab.logs": "Logs",
			"tab.diag": "Diagnostics",
			"overview.pv": "PV production",
			"overview.ac": "Inverter AC",
			"overview.grid": "Grid",
			"overview.battery": "Battery",
			"overview.house": "House load",
			"overview.hcu": "HCU connection",
			"overview.todayPeaks": "Today's peaks",
			"connected": "connected",
			"disconnected": "disconnected",
			"saved": "Saved at",
			"update.install": "Install update",
			"update.current": "Current version",
			"update.available": "Update available",
		},
	};

	// Pure: initial theme = stored preference, else OS preference (light/dark).
	function initialTheme(stored, prefersLight) {
		if (stored === "light" || stored === "dark") return stored;
		return prefersLight ? "light" : "dark";
	}

	// Pure: bidirectional key parity check for the I18N table.
	function i18nKeyParity(table) {
		const de = Object.keys((table && table.de) || {});
		const en = Object.keys((table && table.en) || {});
		const deSet = new Set(de);
		const enSet = new Set(en);
		return {
			missingInEn: de.filter((k) => !enSet.has(k)),
			missingInDe: en.filter((k) => !deSet.has(k)),
		};
	}

	if (typeof window !== "undefined") {
		window.I18N = I18N;
		window.initialTheme = initialTheme;
		window.i18nKeyParity = i18nKeyParity;
	}
	if (typeof module !== "undefined" && module.exports) {
		module.exports = { I18N, initialTheme, i18nKeyParity };
	}
})();

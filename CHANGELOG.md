# Changelog

## 0.2.0
- Massively expanded debug dashboard:
  - Server-Sent Events (SSE) for instant live updates.
  - 11 tabs: Overview, Live, Inverter, Battery, Grid, Control, Modbus, HCU, Config, Logs, Diagnostics.
  - Animated SVG energy-flow diagram.
  - Vanilla-canvas multi-series line charts (no external deps).
  - Light/dark theme toggle, DE/EN UI.
  - Per-string PV view, per-phase grid view, battery SOC gauge.
  - Control panel for storage mode, max charge/discharge, target SOC, active power limit.
  - Register browser with search/filter/hex toggle, CSV export, raw-range scanner.
  - HCU message log viewer.
  - Today's peaks (PV, house, import/export, charge/discharge, SOC min/max), self-sufficiency %.
- 6 h history ring buffer (10 s resolution).
- Additional Modbus registers: PV strings 1–4 (V/A), inverter per-phase voltage/current.

## 0.1.0
- Initial release.
- Modbus TCP polling of Sun2000 inverter, LUNA2000 battery, DTSU666-H smart meter.
- HCU Connect API integration: virtual INVERTER, BATTERY, GRID_CONNECTION_POINT, ENERGY_METER devices.
- Optional virtual SWITCH devices for battery forced-charge / forced-discharge.
- Optional FusionSolar cloud fallback (read-only).
- HCUweb config page with grouped properties.
- Local debug dashboard on port 8088 with live values, register browser and write-register tool.

# Changelog

## 0.3.3
- Modbus: keep TCP socket open when reads time out (typical at night when
  the inverter is sleeping). Avoids the spammy "Modbus connected" log loop.
- Modbus: read timeout raised from 4 s to 8 s for slow wake-up responses.
- Modbus: identical warnings throttled to once per minute (less log noise).
- Modbus: socket-level errors now drop the connection (and reconnect),
  but timeouts no longer do.
- Dashboard → Diagnose: new "Modbus-Statistik" panel (reads / OK / timeouts /
  errors / writes / last error).
- Dashboard → Diagnose: TCP probe and Slave-ID probe buttons.
- Diagnose check now distinguishes between "TCP connected" and
  "inverter actually answers", with a clear hint pointing at night mode /
  wrong slave id / blocking master when only TCP is up.

## 0.3.0
- Plugin metadata: issuer set to Fabio Renner, GitHub URL and PayPal donation link appended to description rendered in the HCU plugin tile.
- README.md / README.de.md: plugin icon at the top, GitHub link, PayPal donate form, updated download link.
- New plugin icon (icon.svg).

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


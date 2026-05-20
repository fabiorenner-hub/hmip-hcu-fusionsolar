> [🇬🇧 English](README.md) | 🇩🇪 Deutsch

<p align="center">
  <img src="icon.svg" alt="hmip-hcu-fusionsolar Symbolbild" width="128" height="128"/>
</p>

# HMIP HCU Plugin: Sun2000 / FusionSolar

📦 **[Aktuelle Plugin-Datei (.tar.gz) herunterladen](https://github.com/fabiorenner-hub/hmip-hcu-fusionsolar/releases/latest/download/hmip-hcu-fusionsolar.tar.gz)** — Installation in HCUweb über *Entwicklermodus → Plugins → Aus Datei installieren*.

🆘 **Probleme?** Siehe **[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)** — deckt SDongle Modbus-TCP-Konfiguration, Dongle-Firmware-Bugs, die FusionSolar-App-Pfade und den Huawei-Support ab.

GitHub: <https://github.com/fabiorenner-hub/hmip-hcu-fusionsolar>

Homematic IP HCU-Plugin zum lokalen Auslesen (und teilweise Steuern) einer
Huawei-Sun2000-PV-Anlage via Modbus TCP, mit optionalem
FusionSolar-Cloud-Fallback und ausführlichem Debug-Dashboard.

## Spenden

Wenn dir dieses Plugin hilft, freue ich mich über eine kleine Spende — sie
hält bei mir die Lichter an, während ich weitere HCU-Plugins baue:
[Spenden via PayPal](https://www.paypal.com/donate/?hosted_button_id=JPZRATUUHRT5C).

## Auf der HCU installieren

1. `hmip-hcu-fusionsolar-<version>.tar.gz` aus den
   [Releases](https://github.com/fabiorenner-hub/hmip-hcu-fusionsolar/releases) holen.
2. In HCUweb *Entwicklermodus → Plugins → Aus Datei installieren* öffnen und hochladen.
3. Plugin konfigurieren und optional das Debug-Dashboard unter
   `http://<hcu-ip>:8088` öffnen.

## Selbst bauen

```powershell
./build.ps1   # Windows
```

```bash
chmod +x build.sh
./build.sh    # macOS / Linux
```

## Funktionen

- Modbus-TCP-Polling für Sun2000 Wechselrichter, LUNA2000 Speicher und DTSU666-H Smart Meter.
- Connect-API-Integration: virtuelle `INVERTER`-, `BATTERY`-, `GRID_CONNECTION_POINT`- und `ENERGY_METER`-Geräte.
- Optionale virtuelle SWITCH-Geräte für erzwungene Lade- bzw. Entladevorgänge.
- Optionaler FusionSolar-Cloud-Fallback (read-only).
- HCUweb-Konfigurationsseite mit gruppierten Properties.
- Lokales Debug-Dashboard auf Port 8088 mit Live-Werten, Register-Browser, Write-Register-Tool, Energieflussdiagramm.

## Herausgeber

Herausgegeben von **Fabio Renner**.

### Verwendete Drittanbieter

- [`modbus-serial`](https://github.com/yaacov/node-modbus-serial) von Yaacov Zamir und Mitwirkenden — Modbus-Client für Node.js (ISC).
- [`express`](https://expressjs.com/) — HTTP-Server für das lokale Debug-Dashboard (MIT).
- Sun2000, LUNA2000 und die FusionSolar-Cloud sind Produkte von Huawei Technologies; dieses Plugin ist mit Huawei nicht verbunden und wird nicht unterstützt. Der DTSU666-H ist ein CHINT-Zähler, der über die Huawei-Smart-Meter-Modbus-Map angesprochen wird.
- Gebaut gegen die [Homematic IP Connect API 1.0.1](https://github.com/homematicip/connect-api) von eQ-3.

## Lizenz

Apache-2.0

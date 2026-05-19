# Sun2000 / FusionSolar HmIP Plugin

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Homematic%20IP%20HCU2-orange.svg)](https://github.com/homematicip/connect-api)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-green.svg)](https://nodejs.org)

🇩🇪 **[Deutsch](#-deutsch)** · 🇬🇧 **[English](#-english)**

---

## 🇩🇪 Deutsch

Lokale Anbindung der Huawei-Solaranlage (Sun2000-Wechselrichter, LUNA2000-Speicher,
DTSU666-H Smart Meter) an die Homematic IP Home Control Unit (HCU2) über Modbus TCP,
mit optionalem FusionSolar-Cloud-Fallback.

### Was das Plugin macht

In der Homematic IP App erscheinen folgende virtuelle Geräte:

| HmIP-Gerät                | DeviceType            | Quelle                       |
| ------------------------- | --------------------- | ---------------------------- |
| Sun2000 Wechselrichter    | INVERTER              | Modbus 32064 / 32080 / 32106 |
| Netzanschluss             | GRID_CONNECTION_POINT | Modbus 37113 / 37119 / 37121 |
| Hausverbrauch (errechnet) | ENERGY_METER          | Inverter AC − Meter          |
| LUNA2000 Speicher         | BATTERY               | Modbus 37000 ff.             |
| Speicher Zwangsladung     | SWITCH (optional)     | Schreibt 47004               |

Zusätzlich gibt es ein lokales Debug-Dashboard auf Port **8088** mit Live-Werten,
Energieflow-Diagramm, Charts, Steuerung, Modbus-Browser inklusive Schreibzugriff,
Bereichs-Scanner, HCU-Nachrichtenlog und Diagnose.

### Schnellstart

1. Auf der HCU den Entwicklermodus aktivieren (HCUweb → Entwicklermodus).
2. Eine Plugin-ID festlegen, z. B. `de.fr.renner.plugin.fusionsolar`,
   Aktivierungsschlüssel erzeugen und Auth-Token holen
   (siehe `connect-api-documentation-1.0.1.html`, Kapitel 2.5).
3. Image bauen und packen:
   ```
   npm run build           # Linux / macOS / WSL
   npm run build:win       # Windows / PowerShell
   ```
   Das fertige Archiv liegt anschließend unter `dist/hmip-hcu-fusionsolar-<version>.tar.gz`.
4. `.tar.gz` über HCUweb installieren.
5. In HCUweb beim Plugin auf **Konfigurieren** klicken und mindestens
   die Wechselrichter-IP eintragen.

### Lokale Entwicklung gegen die HCU

Auf der HCU den WebSocket nach außen freigeben, dann:

```
npm install
node src/index.js de.fr.renner.plugin.fusionsolar hcu1-XXXX.local authtoken.txt
```

`authtoken.txt` enthält den abgeholten Token in einer Zeile.

### Konfigurationsfelder

Erscheinen in HCUweb (`ConfigTemplate`-Form), gleichzeitig auch unter
`http://<plugin-host>:8088` → Konfiguration:

- **Wechselrichter (Modbus TCP)**
  - IP/Hostname, Port (502), Slave-ID (1), Abfrage-Intervall (10 s)
- **Komponenten**
  - LUNA2000 vorhanden, DTSU666-H vorhanden,
    optionaler Steuer-Schalter „Speicher Zwangsladung“
- **Debug-Dashboard**
  - aktiv / Port
- **FusionSolar Cloud (Fallback)**
  - aktiv / Benutzer / Passwort / Region

Werte werden in `/data/config.json` persistiert (HCU-übergreifend).

### Dashboard

Erreichbar unter `http://<HCU-IP>:8088`. Elf Tabs:

| Tab            | Inhalt                                                            |
| -------------- | ----------------------------------------------------------------- |
| Übersicht      | KPI-Kacheln, animiertes Energieflow-Diagramm, Tagesspitzen        |
| Live           | Multi-Series Leistungs-Chart, SOC, Temperatur (10 min – 6 h)      |
| Wechselrichter | Modell, AC, MPPT-Strings, Phasen, Erträge, Status                 |
| Speicher       | SOC-Gauge, Heute, Lebensdauer, SOC/Leistungs-Chart                |
| Netz           | Smart-Meter, Phasen, Energie-Bilanz, Netzleistungs-Chart          |
| Steuerung      | Speichermodus, Lade-/Entladegrenzen, Ziel-SOC, Wirkleistungslimit |
| Modbus         | Register-Tabelle (Suche/Filter/Hex), CSV-Export, Bereichs-Scanner |
| HCU            | Verbindung, gemeldete Geräte, vollständiges Nachrichten-Log       |
| Konfig         | Form-Editor (gespiegelt zur HCUweb-Form)                          |
| Logs           | Tail mit Level- und Volltextfilter                                |
| Diagnose       | System-Checks, Umgebung, Statistik                                |

### Sicherheitshinweise

- Schreibzugriffe auf den Sun2000 (Speichermodus, Leistungsbegrenzung)
  können den Wechselrichter abschalten oder die Garantie berühren.
  Der Schreib-Schalter im Dashboard akzeptiert daher nur Werte, die
  in `src/sun2000/registers.js` als `rw: "rw"` markiert sind.
- Der Cloud-Fallback ist standardmäßig **aus**. Aktivieren Sie ihn nur,
  wenn Sie damit einverstanden sind, dass Zugangsdaten zur
  FusionSolar-Cloud im HCU-`/data`-Bereich gespeichert werden.

### Quellen

- [homematicip/connect-api](https://github.com/homematicip/connect-api)
  (HCU Connect API 1.0.1, Apache-2.0)
- [jgriss/FusionSolarPy](https://github.com/jgriss/FusionSolarPy)
  (Cloud-Fallback-Vorlage, MIT)
- Huawei „Solar Inverter Modbus Interface Definitions"

### Lizenz

Apache-2.0 – siehe [LICENSE](LICENSE).

---

## 🇬🇧 English

Local integration of the Huawei solar system (Sun2000 inverter, LUNA2000 battery,
DTSU666-H smart meter) with the Homematic IP Home Control Unit (HCU2) via Modbus
TCP, with optional FusionSolar cloud fallback.

### What this plugin does

The following virtual devices appear in the Homematic IP app:

| HmIP device              | DeviceType            | Source                       |
| ------------------------ | --------------------- | ---------------------------- |
| Sun2000 inverter         | INVERTER              | Modbus 32064 / 32080 / 32106 |
| Grid connection          | GRID_CONNECTION_POINT | Modbus 37113 / 37119 / 37121 |
| House load (calculated)  | ENERGY_METER          | inverter AC − meter          |
| LUNA2000 battery         | BATTERY               | Modbus 37000 ff.             |
| Battery forced charge    | SWITCH (optional)     | writes 47004                 |

There is also a local debug dashboard on port **8088** with live values,
an energy-flow diagram, charts, control panel, Modbus browser with write
access, range scanner, HCU message log and diagnostics.

### Quick start

1. Enable developer mode on the HCU (HCUweb → developer mode).
2. Pick a plugin id, e.g. `de.fr.renner.plugin.fusionsolar`, generate an
   activation key and obtain an auth token (see
   `connect-api-documentation-1.0.1.html`, chapter 2.5).
3. Build and package the image:
   ```
   npm run build           # Linux / macOS / WSL
   npm run build:win       # Windows / PowerShell
   ```
   The resulting archive ends up at
   `dist/hmip-hcu-fusionsolar-<version>.tar.gz`.
4. Install the `.tar.gz` via HCUweb.
5. Open the plugin's **Configure** dialog in HCUweb and at least set the
   inverter IP.

### Local development against the HCU

Expose the WebSocket on the HCU, then:

```
npm install
node src/index.js de.fr.renner.plugin.fusionsolar hcu1-XXXX.local authtoken.txt
```

`authtoken.txt` contains the token on a single line.

### Configuration fields

Available both in HCUweb (`ConfigTemplate` form) and at
`http://<plugin-host>:8088` → Config:

- **Inverter (Modbus TCP)**
  - IP/hostname, port (502), slave id (1), poll interval (10 s)
- **Components**
  - LUNA2000 installed, DTSU666-H installed,
    optional control switch "Battery forced charge"
- **Debug dashboard**
  - enabled / port
- **FusionSolar cloud (fallback)**
  - enabled / user / password / region

Values are persisted to `/data/config.json` (preserved across HCU updates).

### Dashboard

Reachable at `http://<HCU-IP>:8088`. Eleven tabs:

| Tab            | Contents                                                          |
| -------------- | ----------------------------------------------------------------- |
| Overview       | KPI cards, animated energy-flow diagram, today's peaks            |
| Live           | Multi-series power chart, SOC, temperature (10 min – 6 h)         |
| Inverter       | Model, AC stats, MPPT strings, phases, yields, status             |
| Battery        | SOC gauge, today, lifetime, SOC/power chart                       |
| Grid           | Smart meter, phases, energy totals, grid-power chart              |
| Control        | Storage mode, charge/discharge limits, target SOC, power limit    |
| Modbus         | Register table (search/filter/hex), CSV export, range scanner     |
| HCU            | Connection, advertised devices, full message log                  |
| Config         | Form editor (mirror of the HCUweb form)                           |
| Logs           | Tail with level filter and full-text search                       |
| Diagnostics    | System checks, environment, statistics                            |

### Safety notes

- Write access to the Sun2000 (storage mode, power limits) can shut the
  inverter down or affect warranty. The write button in the dashboard
  therefore only accepts values flagged `rw: "rw"` in
  `src/sun2000/registers.js`.
- The cloud fallback is **off** by default. Enable it only if you are
  comfortable with FusionSolar credentials being stored in the HCU's
  `/data` area.

### Sources

- [homematicip/connect-api](https://github.com/homematicip/connect-api)
  (HCU Connect API 1.0.1, Apache-2.0)
- [jgriss/FusionSolarPy](https://github.com/jgriss/FusionSolarPy)
  (cloud fallback template, MIT)
- Huawei "Solar Inverter Modbus Interface Definitions"

### License

Apache-2.0 — see [LICENSE](LICENSE).

# Sun2000 / FusionSolar HmIP Plugin

Lokale Anbindung der Huawei-Solaranlage (Sun2000-Wechselrichter, LUNA2000-Speicher,
DTSU666-H Smart Meter) an die Homematic IP Home Control Unit (HCU2)
über Modbus TCP, mit optionalem FusionSolar-Cloud-Fallback.

## Was das Plugin macht

In der Homematic IP App erscheinen folgende virtuelle Geräte:

| HmIP-Gerät                | DeviceType            | Quelle                       |
| ------------------------- | --------------------- | ---------------------------- |
| Sun2000 Wechselrichter    | INVERTER              | Modbus 32064 / 32080 / 32106 |
| Netzanschluss             | GRID_CONNECTION_POINT | Modbus 37113 / 37119 / 37121 |
| Hausverbrauch (errechnet) | ENERGY_METER          | Inverter AC − Meter          |
| LUNA2000 Speicher         | BATTERY               | Modbus 37000 ff.             |
| Speicher Zwangsladung     | SWITCH (optional)     | Schreibt 47004               |

Zusätzlich gibt es ein lokales Debug-Dashboard auf Port **8088** mit
Live-Werten, Energieflow-Diagramm, Charts, Steuerung, Modbus-Browser
inklusive Schreibzugriff, Bereichs-Scanner, HCU-Nachrichtenlog und
Diagnose.

## Schnellstart

1. Auf der HCU den Entwicklermodus aktivieren (HCUweb → Entwicklermodus).
2. Eine Plugin-ID festlegen, z. B. `de.fr.renner.plugin.fusionsolar`,
   Aktivierungsschlüssel erzeugen und Auth-Token holen
   (siehe `connect-api-documentation-1.0.1.html`, Kapitel 2.5).
3. Image bauen und packen:
   ```
   docker buildx build --platform linux/arm64 -t hmip-fusionsolar:0.1.0 .
   docker save hmip-fusionsolar:0.1.0 | gzip > hmip-fusionsolar-0.1.0.tar.gz
   ```
4. `.tar.gz` über HCUweb installieren.
5. In HCUweb beim Plugin auf **Konfigurieren** klicken und mindestens
   die Wechselrichter-IP eintragen.

## Lokale Entwicklung gegen die HCU

Auf der HCU den WebSocket nach außen freigeben, dann:

```
npm install
node src/index.js de.fr.renner.plugin.fusionsolar hcu1-XXXX.local authtoken.txt
```

`authtoken.txt` enthält den abgeholten Token in einer Zeile.

## Konfigurationsfelder

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

## Sicherheitshinweise

- Schreibzugriffe auf den Sun2000 (Speichermodus, Leistungsbegrenzung)
  können den Wechselrichter abschalten oder die Garantie berühren.
  Der Schreib-Schalter im Dashboard akzeptiert daher nur Werte, die
  in `src/sun2000/registers.js` als `rw: "rw"` markiert sind.
- Der Cloud-Fallback ist standardmäßig **aus**. Aktivieren Sie ihn nur,
  wenn Sie damit einverstanden sind, dass Zugangsdaten zur
  FusionSolar-Cloud im HCU-`/data`-Bereich gespeichert werden.

## Quellen

- [homematicip/connect-api](https://github.com/homematicip/connect-api)
  (HCU Connect API 1.0.1, Apache-2.0)
- [jgriss/FusionSolarPy](https://github.com/jgriss/FusionSolarPy)
  (Cloud-Fallback-Vorlage, MIT)
- Huawei „Solar Inverter Modbus Interface Definitions“

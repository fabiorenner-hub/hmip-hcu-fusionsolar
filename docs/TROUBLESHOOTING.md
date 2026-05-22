# Troubleshooting

🇩🇪 **[Deutsch](#-deutsch)** · 🇬🇧 **[English](#-english)**

---

## 🇩🇪 Deutsch

Dieses Dokument fasst die häufigsten Fehlerbilder und ihre Diagnose zusammen,
die im Zusammenspiel zwischen einem Huawei Sun2000 + SDongleA-05 + Homematic IP
HCU2 auftreten. Reihenfolge: oberste Box zuerst lesen, dann gezielt zum
passenden Abschnitt springen.

### Schnell-Diagnose

| Symptom | Wahrscheinliche Ursache | Abschnitt |
| --- | --- | --- |
| Dashboard nicht erreichbar | Plugin nicht aktiviert / falscher Port | [Dashboard nicht erreichbar](#dashboard-nicht-erreichbar) |
| HCU-WebSocket verbindet nicht | Auth-Token oder Plugin-ID falsch | [HCU-Verbindung](#hcu-websocket-verbindet-nicht) |
| `ECONNREFUSED 192.168.x.y:502` | Modbus TCP am Dongle nicht aktiviert | [Modbus TCP aktivieren](#modbus-tcp-am-dongle-aktivieren) |
| TCP geht, alle Reads timeout | Inverter im Nachtmodus oder Dongle-Firmware-Bug | [Reads laufen ins Timeout](#reads-laufen-ins-timeout) |
| `socket closed by peer` alle ~10 s | Anderer Modbus-Master / Cloud-Sync stört | [Verbindung wird abgebrochen](#verbindung-wird-stndig-abgebrochen) |
| Werte da, aber alle 0 W | Modbus liefert nichts trotz Verbindung | [Werte sind alle 0 W](#werte-sind-alle-0-w) |
| Static-Read OK, Realtime fail | Klassischer SPC125-Bug | [Firmware-Update](#dongle-firmware-aktualisieren) |
| Anlage zeigt Daten in FusionSolar, im Plugin nichts | Dongle leitet Modbus nicht weiter | [Firmware-Update](#dongle-firmware-aktualisieren) |
| Kein Installer-Konto verfügbar | Standardmäßig nur Owner | [Installer-Konto bekommen](#installer-konto-bekommen) |

### So sieht „läuft" aus

Wenn alles funktioniert, ist das Bild im Plugin so:

- Plugin-Logs zeigen einmalig `Inverter: SUN2000-…  SN …  FW V…` und danach
  beim Polling **keine** Warnings mehr (höchstens nachts wenn der Inverter
  abschaltet — dann gedrosselt einmal pro Minute „inverter asleep").
- Dashboard → **Übersicht** zeigt Live-PV-Leistung, Hausverbrauch, Netz und
  Speicher, nicht überall 0 W.
- Dashboard → **Diagnose** → alle Checks grün außer ggf. „Daten aktuell"
  bei Nacht.
- HmIP-App: vier (oder fünf, mit dem Speicher-Schalter) virtuelle Geräte
  mit aktuellen Leistungen.

Wenn dein Bild anders aussieht: Spalte rechts in der Quick-Triage-Tabelle
folgen.

### Werte vergleichen — FusionSolar vs. Plugin

Wenn die Zahlen in der FusionSolar-App und im Plugin nicht 1:1 übereinstimmen,
ist das **nicht zwingend ein Fehler**. Hintergründe:

- **Zeitversatz**: Die FusionSolar-App zeigt Cloud-Daten mit 30 s bis 5 min
  Verzögerung. Das Plugin liest live alle 10 s. Bei wechselhafter Bewölkung
  sind ±2 kW innerhalb einer Minute völlig normal.
- **DC vs. AC**: Die FusionSolar-„PV"-Anzeige ist die DC-Leistung am
  Wechselrichter-Eingang. Das HmIP-Gerät „SUN2000" zeigt die AC-Wirkleistung
  am Ausgang. Bei Speicher-Beteiligung kommen Beiträge dazu, bei Eigenverbrauch
  des Wechselrichters gehen welche ab. Differenzen von 100–500 W sind normal.
- **Bilanz prüfen**: Die einzige verlässliche Konsistenzprüfung ist die
  Energiebilanz. Bei dir (Beispiel aus realer Installation):
  - FusionSolar: PV 4368 = Haus 393 + Grid 3975 ✓
  - Plugin: AC 5860 − Grid 5280 = Haus 580 ✓
  Beide gehen für sich auf — nur unterschiedliche Augenblicke.
- **Speicher-Rauschen**: Wenn der Speicher voll und idle ist, zeigt das
  Plugin oft 20–50 W (das BMS-Eigenrauschen). FusionSolar rundet das auf
  0 W. Beides ist korrekt.

### Doppelte Geräte in der HmIP-App

Wenn nach einem Update oder Konfig-Wechsel auf einmal **doppelte Geräte**
(„SUN2000 (1)", „SUN2000 (2)") auftauchen und eines davon als
„nicht erreichbar" markiert ist:

Das war ein Bug in Plugin-Versionen vor 0.3.5. Damals wurde die Geräte-ID
aus der live gelesenen Inverter-SN abgeleitet. Wenn der erste Static-Read
fehlschlug (träger Modbus, Nachtmodus), kam ein generischer Fallback-Name
zum Einsatz. Beim nächsten erfolgreichen Start wurden Geräte mit der
echten SN als ID gemeldet — die HCU sah die als „neue" Geräte an, die
alten blieben als „nicht erreichbar" stehen.

**Fix**: Ab 0.3.5 wird die SN beim ersten erfolgreichen Read in
`/data/config.json` als `persistedSn` gespeichert. Folgestarts benutzen
immer denselben Wert.

**Bereinigung der HmIP-App**:

1. In der HmIP-App auf **Geräte** → **alle anzeigen** wechseln.
2. Die mit „nicht erreichbar" markierten doppelten Geräte antippen.
3. **Aus dem System entfernen**.
4. Die übrig gebliebenen sind die richtigen, mit stabilen IDs.

Falls du noch immer doppelte siehst nach dem Update auf 0.3.5: einmal
Plugin neu starten, dann sollte `/data/config.json` einen Eintrag
`"persistedSn": "BT21..."` enthalten. Ab dann passiert es nicht mehr.

### Bevor du anfängst

Drei Dinge solltest du jederzeit kennen:

1. **Plugin-Logs**: HCUweb → Plugin → „Logs" oder im Dashboard unter dem
   Tab **Logs**.
2. **Dashboard-Diagnose**: `http://<HCU-IP>:8088` → Tab **Diagnose**. Dort
   gibt es zwei Schnell-Tests:
   - **TCP-Verbindung testen** — öffnet einen rohen Socket zum Dongle
   - **Slave-IDs durchprobieren** — testet IDs 0/1/2/3 mit einem Mini-Read
3. **Direktzugriff**: Wenn du Zweifel hast, ob das Problem an der HCU oder am
   Dongle liegt — von einem Notebook im selben LAN versuchen. Die meisten
   Probleme reproduzieren sich dort identisch und beweisen, dass die HCU
   unbeteiligt ist.

### Dashboard nicht erreichbar

`http://<HCU-IP>:8088` lädt nicht oder gibt „Verbindung abgelehnt".

- Plugin-Status in HCUweb prüfen — steht das Plugin auf **Aktiv**?
- Dashboard-Port in der Plugin-Konfig (HCUweb → Plugin → Konfigurieren)
  steht standardmäßig auf **8088**. Wenn du ihn manuell auf z. B. 8089
  umgestellt hast: nutze den. Falls du den Wert vergessen hast: Dashboard
  ist nach Container-Restart automatisch unter dem konfigurierten Port
  erreichbar.
- Container-Restart erzwingen: in HCUweb das Plugin deaktivieren und wieder
  aktivieren. Manchmal hängt der Express-Server nach längerem Idle.
- IPv4 verwenden, nicht IPv6 — manche HCU-Setups blockieren das interne
  Port-Mapping nur für IPv4.

### HCU-WebSocket verbindet nicht

In den Logs erscheint `HCU WebSocket error: 401` oder die Verbindung
wird sofort wieder geschlossen.

- **Plugin-ID** im Dockerfile-LABEL muss exakt mit der ID übereinstimmen,
  für die der Auth-Token erzeugt wurde. Default: `de.fr.renner.plugin.fusionsolar`.
- **Entwicklermodus** muss in HCUweb aktiv sein. Status-Anzeige im
  Entwicklermodus-Bereich.
- **Auth-Token** wird vor dem Build per HCUweb erzeugt. Bei jedem Reset
  des Entwicklermodus wird er ungültig. Token neu holen, Image neu bauen.

### Modbus TCP am Dongle aktivieren

Der wichtigste Punkt überhaupt. Ohne diese Einstellung lässt der SDongle
gar keine Modbus-Verbindung zu.

1. **FusionSolar-App** (nicht die SUN2000-App) öffnen
2. Unten **„Geräte-Inbetriebnahme"** wählen — nicht die normale
   Anlagensicht!
3. Mit dem **Wechselrichter** verbinden (über sein WLAN
   `SUN2000-<Seriennummer>` oder LAN, falls vorhanden)
4. Login als **Installer** — das normale Owner-Konto sieht den Punkt
   nicht. Standard-Passwort: `00000a`
5. **Einstellungen → Kommunikationskonfiguration → Dongle-Parametereinstellungen
   → Modbus-TCP**
6. Auswahl **„Aktivieren (uneingeschränkt)"**, **nicht** „Aktivieren
   (eingeschränkt)"
7. Speichern, Dongle für 2 Minuten in Ruhe lassen, dann Plugin testen

**Wichtig**: „Eingeschränkt" lässt nur einen einzigen aktiven Master zu.
Da der SDongle selbst alle paar Sekunden mit der Huawei-Cloud spricht,
verdrängt er deine Plugin-Verbindung permanent. Genau das verursacht
das `socket closed by peer`-Muster in den Logs.

Falls der Pfad anders aussieht: prüfe, dass du dich tatsächlich mit dem
Inverter verbunden hast (nicht direkt mit dem Dongle). Der Punkt
**„Dongle-Parametereinstellungen"** existiert nur in der Inverter-Inbetriebnahme.

### Reads laufen ins Timeout

TCP-Verbindung steht (`Modbus connected to ...` im Log), aber jeder Lese-
versuch endet mit `Timed out`.

#### Mögliche Ursachen, von wahrscheinlich nach unwahrscheinlich

1. **Inverter im Nachtmodus.** Der SDongleA-05 bleibt wach, der Inverter
   schaltet sich aber bei zu wenig Sonnenlicht (typisch ab 19–21 Uhr im
   Sommer, früher im Winter) komplett ab. Modbus-Anfragen erreichen den
   Inverter dann nicht — der Dongle hält die TCP-Verbindung trotzdem auf.
   - **Test**: Tagsüber mit Sonne wiederholen.
   - Nachts werden im Plugin-Diagnose-Tab alle Reads als Timeout
     markiert, das ist normal und kein Bug.

2. **Falsche Slave-ID.** Bei einem einzelnen Inverter ist die ID immer 1.
   Bei Inverter-Kaskaden über RS485 hat jeder Inverter eine eigene ID.
   - **Test**: Dashboard → Diagnose → „Slave-IDs durchprobieren". Wenn
     dort z. B. ID 2 antwortet, in der Plugin-Konfig anpassen.

3. **Dongle-Firmware-Bug**, siehe nächster Abschnitt.

### Verbindung wird ständig abgebrochen

Logs zeigen alle 6–10 Sekunden `Modbus socket closed by peer` oder
`ECONNRESET`, dazwischen ein paar erfolgreiche Reads.

#### Ursache

Der SDongle akzeptiert in **eingeschränktem** Modus nur einen aktiven
Master gleichzeitig. Selbst wenn du nur ein Plugin angeschlossen hast,
gibt es immer einen zweiten Konkurrenten: den **internen Cloud-Sync**
des Dongles, der alle paar Sekunden Daten zur FusionSolar-Cloud sendet.
Während dieser Sync-Anfrage wirft der Dongle externe Modbus-Verbindungen
raus.

#### Lösung

→ [Modbus TCP am Dongle aktivieren](#modbus-tcp-am-dongle-aktivieren) auf
**„Aktivieren (uneingeschränkt)"** umstellen. Damit erlaubt der Dongle
mehrere parallele Master.

Wenn das umgestellt ist und es trotzdem so weitergeht, ist es fast
sicher der Firmware-Bug aus dem nächsten Abschnitt.

### Werte sind alle 0 W

Plugin zeigt 8 Geräte in HmIP an, alle aber mit Wert 0. In den Plugin-Logs
stehen Modbus-Timeouts oder „Inverter: ? SN ? FW ?" als Static-Read.

Das bedeutet: kein einziger Modbus-Lesevorgang ist erfolgreich. Das HmIP-
Mapping setzt fehlende Werte auf 0.

→ Geh oben in der Tabelle auf das passende Symptom (Reads laufen ins
Timeout, Verbindung abgebrochen, Dongle-Firmware) und folge der Diagnose.

### Dongle-Firmware aktualisieren

Wenn alles oben sauber konfiguriert ist (Modbus uneingeschränkt aktiviert,
Slave-ID korrekt, Inverter wach) und du trotzdem noch entweder Timeouts
oder `ECONNRESET` siehst, bist du wahrscheinlich auf einer alten
Dongle-Firmware mit bekanntem Modbus-TCP-Bug.

#### Bekannte Problem-Versionen

- **V100R001C00SPC125 und älter** — Modbus-Server akzeptiert TCP, leitet
  aber Anfragen nicht zuverlässig an den Inverter weiter. Aktive Sessions
  werden bei jedem internen Cloud-Heartbeat verworfen.

#### Stabile Versionen

- **V100R001C00SPC127** — erste verbreitete Version mit gefixtem Modbus-
  Stack
- **V100R001C00SPC210** und neuer — alles seitdem ist ok
- **V200R022C10SPCxxx** — neue Generation, ebenfalls ok

#### Update-Wege

1. **FusionSolar Webportal** (https://eu5.fusionsolar.huawei.com) →
   einloggen → **Wartung → Upgrade-Verwaltung → Einzel-Upgrade** →
   Anlage und SDongle auswählen → neueste Zielversion → „Jetzt
   aktualisieren". **Erfordert Installer-Konto.** Owner-Konten sehen
   das Menü nicht.

2. **FusionSolar-App** im Inbetriebnahme-Modus → mit dem Dongle direkt
   verbinden (Dongle-WLAN-AP, nur ~3 Min nach Power-On aktiv) → Wartung
   → Geräte-Upgrade.

3. **Über deinen Installateur** — die Installationsfirma hat einen
   Installer-Account und kann das Update in 5 Minuten anstoßen.

4. **Über Huawei-Support** — E-Mail an `eu_inverter_support@huawei.com`
   mit Betreff „TCP MODBUS PROBLEM, requesting latest firmware files".
   Inverter-SN, Dongle-SN, aktuelle Firmware-Versionen mitschicken.
   Antwort kommt typischerweise binnen 1–2 Werktagen mit Firmware-Datei
   und Anleitung zum lokalen Einspielen.

#### Während des Updates

- **Nicht** den Strom abschalten. Update bei Tageslicht durchführen,
  damit AC und DC stabil sind. Das Update dauert 15–25 Minuten pro Gerät,
  Cloud-Verbindung muss in der Zeit halten.
- Plugin-Logs werden während des Reboots Errors zeigen
  (`ECONNREFUSED`, `socket closed`). Das adaptive Backoff fängt das ab,
  du musst nichts tun.
- Nach dem Reboot 2–3 Minuten warten, bevor du im Dashboard auf
  „TCP-Verbindung testen" klickst.

#### Nach dem Update

Manche Versionssprünge setzen die Modbus-TCP-Einstellung auf den Default
zurück. Im Zweifel:

1. App → Inbetriebnahme → Inverter → Einstellungen → Kommunikationskonfiguration
   → Dongle-Parametereinstellungen → Modbus-TCP → „Aktivieren
   (uneingeschränkt)"
2. Im Plugin-Dashboard → Diagnose → „TCP-Verbindung testen" → muss < 50 ms
   ok melden
3. Dann „Slave-IDs durchprobieren" → ID 1 sollte mit einem Sample-Wert
   antworten

### Installer-Konto bekommen

Damit du selbst Firmware-Updates über das FusionSolar-Webportal anstoßen
kannst (oder den Modbus-TCP-Schalter in der Inbetriebnahme-App siehst),
brauchst du ein **Installer-Konto**. Ein normales Owner-Konto sieht weder
den „Upgrade-Verwaltung"-Menüpunkt im Webportal noch die Installer-
spezifischen Einstellungen in der App.

Es gibt drei realistische Wege, an Installer-Rechte zu kommen, in
absteigender Reihenfolge der Empfehlung:

#### A. Über deinen Original-Installateur (am einfachsten)

Die Firma, die deine Anlage installiert hat, hat fast garantiert ein
Installer-Konto im FusionSolar-System. Der dortige Mitarbeiter kann:

1. Sich am Webportal mit seinem Installer-Konto einloggen
2. Auf deine Anlage navigieren
3. Wartung → Upgrade-Verwaltung → Einzel-Upgrade → SDongle/Inverter
   auswählen → Update auslösen

Aufwand für den Installateur: 5 Minuten. Kostet typischerweise nichts,
da es Teil der Anlagenpflege ist. Frag einfach mit dem Stichwort
**„SDongle Firmware-Update auf neueste Version"**, idealerweise zusammen
mit deiner Anlagen-Kennung (PVN oder Plant Name aus FusionSolar).

#### B. Eigenes Installer-Konto registrieren

Theoretisch kannst du dich selbst als „Installer" beim FusionSolar-
Webportal anmelden. Praktisch ist die Registrierung dafür aber nicht
für Endkunden gedacht — sie verlangt entweder eine Einladung von einem
bereits registrierten Installer-Unternehmen, eine Gewerbeanmeldung oder
in manchen Fällen eine Huawei-Partner-ID.

Die App bietet unter der Login-Maske den Punkt „Registrieren" → „Ich bin
Installer" an. Wenn dein Land das ohne Firmenkonto erlaubt, ist das ein
gangbarer Weg, sonst bleibt's auf der Eingabe einer Firmen-Steuernummer
hängen. Hängt regional stark ab.

#### C. Über Huawei-Support

Wenn A und B beide nicht klappen, ist der Weg über die Support-Mail
zuverlässig. Huawei schickt dir die Firmware-Datei per Mail zu, du
spielst sie selbst in der FusionSolar-App lokal ein:

1. Eine Mail an `eu_inverter_support@huawei.com` (Mail-Vorlage siehe
   weiter unten unter [Beim Huawei-Support melden](#beim-huawei-support-melden)).
2. Antwort kommt innerhalb von 1–2 Werktagen mit einem `.zip` oder
   `.bin` mit Anleitung.
3. Anleitung zum Einspielen über die FusionSolar-App im Inbetriebnahme-
   Modus → Dongle direkt verbinden → Wartung → „Lokales Software-Upgrade".

Vorteil: kein Installer-Konto nötig.
Nachteil: 1–2 Tage Wartezeit, und du brauchst ein Android-Gerät — die
iOS-App von FusionSolar unterstützt das lokale Firmware-Update nicht.

### Firmware-Update über das FusionSolar-Webportal (Schritt für Schritt)

Wenn du Installer-Rechte hast (eigene oder vom Installateur), ist das
der bequemste Weg.

1. Browser öffnen, **https://eu5.fusionsolar.huawei.com** aufrufen.
   Falls du in einer anderen Region bist: `intl.fusionsolar.huawei.com`
   oder die regionale Subdomain.
2. **Mit dem Installer-Konto** einloggen.
3. In der Hauptnavigation oben **„Wartung"** auswählen (englisch:
   „Maintenance").
4. Untermenü **„Upgrade-Verwaltung" → „Einzel-Upgrade"** öffnen
   (englisch: „Upgrade Management" → „Single Upgrade").
5. **Anlage suchen**: oben rechts den Filter auf deine Anlage setzen
   (per Name oder PVN).
6. **Geräteart filtern**: links auf **„Smart Dongle"** schalten — die
   Liste zeigt jetzt deinen SDongleA-05.
7. Den Dongle anhaken (Checkbox links).
8. Spalte **„Zielversion"**: aus der Dropdown-Liste die neueste
   verfügbare Version wählen (typisch **V100R001C00SPC210** oder neuer,
   manchmal gibt's auch eine V200R022-Version).
9. **„Jetzt aktualisieren"** klicken, Bestätigung im Popup mit „OK"
   bestätigen.
10. Die Statusspalte wechselt auf **„Wird ausgeführt"**. Dauer:
    15–25 Minuten. **Anlage darf in der Zeit nicht stromlos werden**,
    Cloud-Verbindung muss halten.
11. Nach Abschluss zeigt die Statusspalte **„Erfolgreich"** an. Der
    Dongle bootet automatisch neu.
12. **Wichtig danach**: Modbus-TCP-Einstellung kontrollieren — siehe
    Abschnitt [Nach dem Update](#nach-dem-update). Manche Versionssprünge
    setzen die Einstellung auf den Default zurück.

Falls das Menü „Einzel-Upgrade" leer ist oder dein Gerät nicht
auftaucht: dein Konto hat Installer-Rolle, aber keine Upgrade-Permission
für deine Anlage. Lass deinen Original-Installateur dich als
„Lifecycle-Manager" auf der Anlage hinzufügen, oder geh den Support-Weg.

### Alternative: RS485-Bypass

Wenn die Dongle-Probleme auch nach Firmware-Update nicht weggehen oder
deine Anlage besonders anspruchsvoll ist (Kaskaden, mehrere Master),
kannst du den Dongle für die Datenabfrage komplett umgehen:

- Hardware: Hi-Flying **Elfin-EW11** (WLAN, ~25 €) oder **Elfin-EE11**
  (LAN, ~30 €)
- Anschluss an die RS485A1/B1-Pins im COM-Port unter dem Inverter
- Stromversorgung: 5 V über USB. Achtung: gleiches Port wie der Dongle —
  parallel geht nicht direkt. Workaround: Dongle weiterhin an USB lassen
  und 5 V woanders herziehen, oder Y-Adapter
- Konfiguration: Web-UI des Elfin → Baudrate **9600**, Protokoll **Modbus**,
  Mode **TCP Server**, Port **8899**
- Im Plugin-Dashboard: IP des Elfin eintragen, Port 8899, Slave-ID 1

Sehr gute Anleitung im wlcrs/huawei_solar-Wiki:
[Connecting to the inverter](https://github.com/wlcrs/huawei_solar/wiki/Connecting-to-the-inverter)

### Logs lesen

Die Plugin-Logs sind dein wichtigstes Werkzeug. Hier die typischen Muster:

```
[info] Modbus connected to 192.168.x.y:502 unit 1
```
→ TCP-Handshake mit dem Dongle ist durch. Das heißt **noch nicht**, dass
Modbus funktioniert — siehe `Read … failed` weiter unten.

```
[warn] Modbus connect failed: connect ECONNREFUSED ...
```
→ Modbus TCP ist am Dongle nicht aktiviert. Geh zu
[Modbus TCP aktivieren](#modbus-tcp-am-dongle-aktivieren).

```
[warn] Modbus reads timing out (likely inverter asleep): last failure ...
```
→ Inverter antwortet nicht auf Modbus. Bei Nacht normal. Tagsüber → siehe
[Reads laufen ins Timeout](#reads-laufen-ins-timeout).

```
[warn] Modbus socket closed by peer
```
→ Dongle hat die Verbindung gekappt. Klassisches Master-Konkurrenz-Problem,
siehe [Verbindung wird abgebrochen](#verbindung-wird-stndig-abgebrochen).

```
[info] Inverter: SUN2000-8KTL-M1 SN BT21C0060114 FW V100R001-02
```
→ Static-Read war erfolgreich, Modbus geht prinzipiell. Wenn danach
ständig Timeouts kommen, ist es fast sicher das Master-Konkurrenz-Problem
oder der Firmware-Bug.

### Beim Huawei-Support melden

Mail-Vorlage:

> **Betreff**: TCP MODBUS PROBLEM — request for latest SDongleA-05 and
> SUN2000 firmware
>
> Dear Huawei Support,
>
> I have a SUN2000-8KTL-M1 inverter (SN: ___) connected to an SDongleA-05
> (SN: ___). Current firmware: SDongle V100R001C00SPC125, inverter
> V100R001C00SPC174.
>
> Modbus TCP on port 502 is enabled (unrestricted) but the dongle does
> not relay Modbus requests reliably to the inverter. TCP connections
> are accepted, but the first Modbus request times out, then the socket
> is reset (ECONNRESET). Tested from multiple LAN clients — same
> behavior.
>
> Please send me the latest stable firmware for the SDongleA-05 (ideally
> the V200R022 generation if applicable to my hardware) and the
> upgrade instructions for offline installation via the FusionSolar app.
>
> Thank you,
> ___

E-Mail an: `eu_inverter_support@huawei.com`

Antwort kommt typischerweise innerhalb von 1–2 Werktagen mit einem ZIP-
Archiv und einer kurzen Anleitung zum Einspielen über die FusionSolar-App.

---

## 🇬🇧 English

This document collects the most common failure modes and their diagnosis
when running a Huawei Sun2000 + SDongleA-05 + Homematic IP HCU2 stack.
Read the top table first, then jump to the matching section.

### Quick triage

| Symptom | Likely cause | Section |
| --- | --- | --- |
| Dashboard not reachable | Plugin not active / wrong port | [Dashboard not reachable](#dashboard-not-reachable) |
| HCU WebSocket fails | Auth token or plugin id wrong | [HCU connection](#hcu-websocket-fails) |
| `ECONNREFUSED 192.168.x.y:502` | Modbus TCP not enabled on dongle | [Enable Modbus TCP](#enable-modbus-tcp-on-the-dongle) |
| TCP works, all reads time out | Inverter asleep or dongle firmware bug | [Reads time out](#reads-time-out) |
| `socket closed by peer` every ~10 s | Another Modbus master / cloud sync | [Connection keeps dropping](#connection-keeps-dropping) |
| Values present but all 0 W | Modbus returns nothing despite link | [All values are 0 W](#all-values-are-0-w) |
| Static read OK, realtime fails | Classic SPC125 firmware bug | [Update dongle firmware](#update-dongle-firmware) |
| FusionSolar app shows data, plugin shows nothing | Dongle not relaying Modbus | [Update dongle firmware](#update-dongle-firmware) |
| No installer account | Default end-user role is Owner | [Getting an installer account](#getting-an-installer-account) |

### What "working" looks like

When everything is healthy, the picture in the plugin is:

- Plugin logs show `Inverter: SUN2000-…  SN …  FW V…` once at startup, and
  no more warnings during polling (at most a once-per-minute "inverter
  asleep" line at night when the inverter shuts down).
- Dashboard → **Overview** shows live PV power, house load, grid and
  battery — not all zero.
- Dashboard → **Diagnostics** → all checks green except possibly "Data
  fresh" at night.
- HmIP app: four (or five with the battery switch) virtual devices
  reporting current readings.

If your picture differs: follow the right-hand column of the quick
triage table.

### Comparing values: FusionSolar vs. plugin

If FusionSolar app numbers don't match the plugin 1:1, that is **not
necessarily a bug**. Reasons:

- **Time skew**: the FusionSolar app shows cloud-aggregated data with
  30 s to 5 min latency. The plugin reads live every 10 s. With
  changing cloud cover, ±2 kW swings within a minute are normal.
- **DC vs AC**: FusionSolar's "PV" reading is DC power at the
  inverter input. The plugin's `SUN2000` device exposes AC active
  power at the output. With battery involvement, contributions add
  up; with inverter self-consumption, some power is lost. 100–500 W
  differences are routine.
- **Balance check**: the only solid consistency check is the energy
  balance. Real-world example:
  - FusionSolar: PV 4368 = house 393 + grid 3975 ✓
  - Plugin: AC 5860 − grid 5280 = house 580 ✓
  Each side balances on its own — they're just different moments.
- **Battery noise**: when the battery is full and idle, the plugin
  often reports 20–50 W (BMS self-consumption). FusionSolar rounds
  that to 0 W. Both are correct.

### Duplicate devices in the HmIP app

If after an update or config change you suddenly see **duplicate
devices** ("SUN2000 (1)", "SUN2000 (2)") with one of them flagged as
"not reachable":

This was a bug in plugin versions before 0.3.5. Device IDs were
derived from the live-read inverter SN. When the first static read
failed (slow Modbus, night mode), a generic fallback name was used.
On the next successful start, devices were announced with the real
SN as ID — the HCU treated them as new, the old ones stayed as
"unreachable".

**Fix**: from 0.3.5 onward the SN is persisted to `/data/config.json`
as `persistedSn` on the first successful read. Subsequent starts
always use the same value.

**Cleanup in the HmIP app**:

1. Go to **Devices → show all**.
2. Tap the duplicate ones flagged as "not reachable".
3. **Remove from system**.
4. The ones that remain are the correct, stable-ID devices.

If you still see duplicates after upgrading to 0.3.5: restart the
plugin once, then `/data/config.json` should contain a
`"persistedSn": "BT21..."` entry. From then on it will not happen
again.

### Before you start

Three things to know:

1. **Plugin logs**: HCUweb → Plugin → "Logs" or in the dashboard under
   the **Logs** tab.
2. **Dashboard diagnostics**: `http://<HCU-IP>:8088` → **Diagnostics**
   tab. Two quick tests:
   - **TCP probe** — opens a raw socket to the dongle
   - **Slave ID probe** — tries IDs 0/1/2/3 with a tiny read
3. **Direct probe**: when in doubt whether the issue is in the HCU or
   in the dongle, try from a laptop on the same LAN. Most issues
   reproduce identically there, proving the HCU is innocent.

### Dashboard not reachable

`http://<HCU-IP>:8088` does not load or refuses the connection.

- Check plugin status in HCUweb — is the plugin **enabled**?
- Dashboard port in the plugin config (HCUweb → Plugin → Configure)
  defaults to **8088**. If you changed it, use the new value.
- Force a container restart: disable and re-enable the plugin in
  HCUweb. The Express server occasionally hangs after long idle.
- Use IPv4, not IPv6 — some HCU setups only forward the internal port
  on IPv4.

### HCU WebSocket fails

Logs show `HCU WebSocket error: 401` or the connection closes
immediately.

- The **plugin id** in the Dockerfile LABEL must exactly match the id
  you generated the auth token for. Default: `de.fr.renner.plugin.fusionsolar`.
- **Developer mode** must be active in HCUweb.
- The **auth token** is generated via HCUweb before the build. Resetting
  developer mode invalidates it. Re-fetch the token, rebuild the image.

### Enable Modbus TCP on the dongle

The single most important setting. Without it the SDongle accepts no
Modbus connection at all.

1. Open the **FusionSolar app** (not the SUN2000 app)
2. Bottom navigation: **"Device commissioning"** — not the normal
   plant view!
3. Connect to the **inverter** (via its `SUN2000-<serial>` Wi-Fi or
   LAN if available)
4. Login as **Installer** — owner accounts do not see the option.
   Default password: `00000a`
5. **Settings → Communication configuration → Dongle parameter
   settings → Modbus TCP**
6. Set to **"Enable (unrestricted)"**, **not** "Enable (restricted)"
7. Save, leave the dongle alone for 2 minutes, then test the plugin

**Important**: "Restricted" allows only one active master at a time.
Since the SDongle itself talks to the Huawei cloud every few seconds,
it kicks your plugin connection out of the way every time. That is
exactly what produces the `socket closed by peer` log pattern.

If the path looks different on your screen: confirm that you are
connected to the inverter (not directly to the dongle). The
**Dongle parameter settings** section is only available from the
inverter commissioning view.

### Reads time out

TCP is up (`Modbus connected to ...` in the log), but every read
attempt ends with `Timed out`.

#### Possible causes, most likely first

1. **Inverter sleeping.** The SDongleA-05 stays awake, but the inverter
   shuts down completely when there is too little sunlight (typically
   from 7–9 PM in summer, earlier in winter). Modbus requests then do
   not reach the inverter — the dongle still keeps the TCP connection
   open.
   - **Test**: retry during daylight.
   - At night, every read in the diagnostics tab will be marked as
     timeout. That is normal, not a bug.

2. **Wrong slave id.** A single inverter is always id 1. RS485
   cascades have a per-inverter id.
   - **Test**: Dashboard → Diagnostics → "Slave ID probe". If id 2
     responds for example, change it in the plugin config.

3. **Dongle firmware bug**, see next section.

### Connection keeps dropping

Logs show `Modbus socket closed by peer` or `ECONNRESET` every 6–10 s,
with a few successful reads in between.

#### Cause

In **restricted** mode the SDongle accepts only one active master at
a time. Even if you only connect a single client, there is always a
second contender: the dongle's **internal cloud sync**, which sends
data to the FusionSolar cloud every few seconds. During that sync the
dongle drops external Modbus connections.

#### Fix

→ Switch [Enable Modbus TCP](#enable-modbus-tcp-on-the-dongle) to
**"Enable (unrestricted)"**. The dongle then allows multiple parallel
masters.

If you set that and it still happens, you are almost certainly hitting
the firmware bug in the next section.

### All values are 0 W

Plugin shows 8 devices in HmIP, all reporting 0. Plugin logs show
Modbus timeouts or `Inverter: ? SN ? FW ?` for the static read.

That means no Modbus read succeeded at all. The HmIP mapping defaults
missing values to 0.

→ Look at the table at the top, jump to the matching section
(reads time out, connection drops, dongle firmware) and follow the
diagnostics.

### Update dongle firmware

If everything above is configured cleanly (Modbus unrestricted, correct
slave id, inverter awake) and you still see timeouts or `ECONNRESET`,
you are likely on an old dongle firmware with the known Modbus-TCP bug.

#### Known problem versions

- **V100R001C00SPC125 and older** — Modbus server accepts TCP but does
  not reliably relay requests to the inverter. Active sessions get
  reset on every internal cloud heartbeat.

#### Known good versions

- **V100R001C00SPC127** — first widespread release with the fix
- **V100R001C00SPC210** and newer — all good
- **V200R022C10SPCxxx** — new generation, also fine

#### Update paths

1. **FusionSolar web portal** (https://eu5.fusionsolar.huawei.com) →
   log in → **Maintenance → Upgrade Management → Single Upgrade** →
   pick plant and SDongle → newest target version → "Upgrade Now".
   **Requires installer account.** Owner accounts do not see the menu.

2. **FusionSolar app** in commissioning mode → connect directly to
   the dongle (its WLAN AP is only active for ~3 min after power-on)
   → Maintenance → Upgrade device.

3. **Through your installer** — the installation company has an
   installer account and can push the update in 5 minutes.

4. **Through Huawei support** — email `eu_inverter_support@huawei.com`
   with subject "TCP MODBUS PROBLEM, requesting latest firmware files".
   Include inverter SN, dongle SN, current firmware versions. Reply
   typically within 1–2 working days with the firmware archive and
   instructions for offline install via the FusionSolar app.

#### During the update

- **Do not** kill power. Run the update in daylight so AC and DC stay
  stable. Update takes 15–25 minutes per device, the cloud connection
  must hold.
- Plugin logs will show errors during the reboot (`ECONNREFUSED`,
  `socket closed`). The adaptive backoff handles it, no action needed.
- After the reboot wait 2–3 minutes before clicking "TCP probe" in
  the dashboard.

#### After the update

Some major version jumps reset the Modbus-TCP setting to the default.
To be safe:

1. App → Commissioning → Inverter → Settings → Communication
   configuration → Dongle parameter settings → Modbus TCP → "Enable
   (unrestricted)"
2. Plugin dashboard → Diagnostics → "TCP probe" — should report ok
   in <50 ms
3. Then "Slave ID probe" → id 1 should answer with a sample value

### Getting an installer account

To trigger firmware updates from the FusionSolar web portal yourself
(or to see installer-only options in the commissioning app), you need
an **installer account**. A normal owner account does not see the
"Upgrade Management" menu in the web portal or the installer-specific
settings in the app.

Three realistic ways, in order of how much I'd recommend them:

#### A. Through your original installer (easiest)

The company that installed your plant almost certainly has an installer
account on FusionSolar. They can:

1. Log in to the web portal with their installer credentials
2. Navigate to your plant
3. Maintenance → Upgrade Management → Single Upgrade → pick your
   dongle/inverter → push the update

Effort for them: 5 minutes. Usually free as it's part of routine
maintenance. Just ask for the **"SDongle firmware update to the latest
version"**, ideally with your plant identifier (PVN or plant name from
FusionSolar).

#### B. Register your own installer account

In theory you can register yourself as "installer" on the FusionSolar
portal. In practice the registration is not designed for end users —
it asks for either an invitation from an already-registered installer
company, a business registration number, or in some regions a Huawei
partner id.

The app login screen has a "Register" → "I'm an installer" entry. If
your country allows it without a company tax number, this is a viable
path; otherwise you'll get stuck on the company validation step.
Region-dependent.

#### C. Through Huawei support

When A and B don't work, the support-email path is reliable. Huawei
sends you the firmware as a file by email; you flash it locally via
the FusionSolar app:

1. Email `eu_inverter_support@huawei.com` (template at
   [Reaching out to Huawei support](#reaching-out-to-huawei-support)).
2. Reply within 1–2 working days with a `.zip` or `.bin` plus
   instructions.
3. Flash via FusionSolar app in commissioning mode → connect directly
   to the dongle → Maintenance → "Local software upgrade".

Pro: no installer account needed.
Con: 1–2 days wait, and you need an Android device — the iOS app does
not support local firmware updates.

### Firmware update via the FusionSolar web portal (step by step)

If you have installer rights (your own or via your installer), this is
the most convenient path.

1. Open a browser, go to **https://eu5.fusionsolar.huawei.com**.
   For other regions: `intl.fusionsolar.huawei.com` or your regional
   subdomain.
2. Log in with the **installer account**.
3. In the top navigation pick **"Maintenance"**.
4. Open submenu **"Upgrade Management" → "Single Upgrade"**.
5. **Find the plant**: filter top-right to your plant (by name or PVN).
6. **Filter device type** in the left sidebar to **"Smart Dongle"** —
   the list now shows your SDongleA-05.
7. Tick the dongle's checkbox.
8. Column **"Target version"**: pick the newest from the dropdown
   (typically **V100R001C00SPC210** or newer, sometimes a V200R022
   variant).
9. Click **"Upgrade Now"**, confirm in the popup with "OK".
10. Status switches to **"In progress"**. Duration: 15–25 minutes.
    **Power must stay on**, the cloud connection must hold.
11. When done the column shows **"Successful"**. The dongle reboots
    automatically.
12. **Important next step**: re-check the Modbus-TCP setting — see
    [After the update](#after-the-update). Big version jumps sometimes
    reset that setting to the default.

If "Single Upgrade" is empty or your device is missing: your account
has the installer role but not the upgrade permission for this plant.
Ask your original installer to add you as "lifecycle manager" on the
plant, or use the support route.

### Alternative: RS485 bypass

If dongle issues persist after the firmware update or your install
is particularly demanding (cascades, multiple masters), you can
bypass the dongle for data acquisition entirely:

- Hardware: Hi-Flying **Elfin-EW11** (Wi-Fi, ~€25) or **Elfin-EE11**
  (Ethernet, ~€30)
- Wire to the RS485A1/B1 pins in the COM port under the inverter
- Power: 5 V via USB. Caution: same port as the dongle — they cannot
  share directly. Workaround: keep the dongle on USB and pull 5 V
  from elsewhere, or use a Y splitter
- Config: Elfin web UI → baud **9600**, protocol **Modbus**, mode
  **TCP Server**, port **8899**
- In the plugin dashboard: IP of the Elfin, port 8899, slave id 1

Excellent guide in the wlcrs/huawei_solar wiki:
[Connecting to the inverter](https://github.com/wlcrs/huawei_solar/wiki/Connecting-to-the-inverter)

### Reading the logs

Plugin logs are your most important tool. Typical patterns:

```
[info] Modbus connected to 192.168.x.y:502 unit 1
```
→ TCP handshake with the dongle succeeded. This does **not** mean
Modbus works — see `Read … failed` below.

```
[warn] Modbus connect failed: connect ECONNREFUSED ...
```
→ Modbus TCP is not enabled on the dongle. Go to
[Enable Modbus TCP](#enable-modbus-tcp-on-the-dongle).

```
[warn] Modbus reads timing out (likely inverter asleep): last failure ...
```
→ Inverter is not answering Modbus. Normal at night. During daylight,
see [Reads time out](#reads-time-out).

```
[warn] Modbus socket closed by peer
```
→ Dongle dropped the connection. Classic master-contention issue, see
[Connection keeps dropping](#connection-keeps-dropping).

```
[info] Inverter: SUN2000-8KTL-M1 SN BT21C0060114 FW V100R001-02
```
→ Static read worked, Modbus is fundamentally fine. If timeouts come
in continuously after that, it is almost always the master-contention
problem or the firmware bug.

### Reaching out to Huawei support

Email template:

> **Subject**: TCP MODBUS PROBLEM — request for latest SDongleA-05 and
> SUN2000 firmware
>
> Dear Huawei Support,
>
> I have a SUN2000-8KTL-M1 inverter (SN: ___) connected to an
> SDongleA-05 (SN: ___). Current firmware: SDongle V100R001C00SPC125,
> inverter V100R001C00SPC174.
>
> Modbus TCP on port 502 is enabled (unrestricted) but the dongle does
> not relay Modbus requests reliably to the inverter. TCP connections
> are accepted, but the first Modbus request times out, then the socket
> is reset (ECONNRESET). Tested from multiple LAN clients — same
> behavior.
>
> Please send me the latest stable firmware for the SDongleA-05 (ideally
> the V200R022 generation if applicable to my hardware) and the upgrade
> instructions for offline installation via the FusionSolar app.
>
> Thank you,
> ___

Email: `eu_inverter_support@huawei.com`

Reply usually within 1–2 working days with a ZIP archive and a short
guide for offline installation via the FusionSolar app.

---

## Sources

- Huawei "FusionSolar Smart PV Management System Connection User Manual
  (Inverters + SDongle)" — [How to set the Modbus-TCP parameter](https://support.huawei.com/enterprise/en/doc/EDOC1100315115/9412a362/how-do-i-set-the-modbus-tcp-parameter)
- [wlcrs/huawei_solar wiki — Connecting to the inverter](https://github.com/wlcrs/huawei_solar/wiki/Connecting-to-the-inverter)
- [evcc-io discussion #2868 — Huawei Wechselrichter / Smart Dongle / Modbus TCP](https://github.com/evcc-io/evcc/discussions/2868)
- Symptoms and solutions are based on debugging on a real
  SUN2000-8KTL-M1 + SDongleA-05 setup. Content was rephrased from the
  above sources for compliance with their licensing.

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

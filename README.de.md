> [ðŸ‡¬ðŸ‡§ English](README.md) | ðŸ‡©ðŸ‡ª Deutsch

<p align="center">
  <img src="icon.svg" alt="hmip-hcu-fusionsolar Symbolbild" width="128" height="128"/>
</p>

# HMIP HCU Plugin: Sun2000 / FusionSolar

ðŸ“¦ **[hmip-hcu-fusionsolar-0.3.1.tar.gz herunterladen](https://github.com/fabiorenner-hub/hmip-hcu-fusionsolar/releases/latest/download/hmip-hcu-fusionsolar-0.3.1.tar.gz)** â€” Installation in HCUweb Ã¼ber *Entwicklermodus â†’ Plugins â†’ Aus Datei installieren*.

GitHub: <https://github.com/fabiorenner-hub/hmip-hcu-fusionsolar>

Homematic IP HCU-Plugin zum lokalen Auslesen (und teilweise Steuern) einer
Huawei-Sun2000-PV-Anlage via Modbus TCP, mit optionalem
FusionSolar-Cloud-Fallback und ausfÃ¼hrlichem Debug-Dashboard.

## Spenden

Wenn dir dieses Plugin hilft, freue ich mich über eine kleine Spende — sie
hält bei mir die Lichter an, während ich weitere HCU-Plugins baue:
[Spenden via PayPal](https://www.paypal.com/donate/?hosted_button_id=JPZRATUUHRT5C).

## Auf der HCU installieren

1. `hmip-hcu-fusionsolar-<version>.tar.gz` aus den
   [Releases](https://github.com/fabiorenner-hub/hmip-hcu-fusionsolar/releases) holen.
2. In HCUweb *Entwicklermodus â†’ Plugins â†’ Aus Datei installieren* Ã¶ffnen und hochladen.
3. Plugin konfigurieren und optional das Debug-Dashboard unter
   `http://<hcu-ip>:8088` Ã¶ffnen.

## Selbst bauen

```powershell
./build.ps1   # Windows
```

```bash
chmod +x build.sh
./build.sh    # macOS / Linux
```

## Herausgeber

Herausgegeben von **Fabio Renner**.

## Lizenz

Apache-2.0

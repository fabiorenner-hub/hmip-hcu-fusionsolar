> [🇬🇧 English](README.md) | 🇩🇪 Deutsch

<p align="center">
  <img src="icon.svg" alt="hmip-hcu-fusionsolar Symbolbild" width="128" height="128"/>
</p>

# HMIP HCU Plugin: Sun2000 / FusionSolar

📦 **[hmip-hcu-fusionsolar-0.3.0.tar.gz herunterladen](https://github.com/fabiorenner-hub/hmip-hcu-fusionsolar/releases/latest/download/hmip-hcu-fusionsolar-0.3.0.tar.gz)** — Installation in HCUweb über *Entwicklermodus → Plugins → Aus Datei installieren*.

GitHub: <https://github.com/fabiorenner-hub/hmip-hcu-fusionsolar>

Homematic IP HCU-Plugin zum lokalen Auslesen (und teilweise Steuern) einer
Huawei-Sun2000-PV-Anlage via Modbus TCP, mit optionalem
FusionSolar-Cloud-Fallback und ausführlichem Debug-Dashboard.

## Spenden

Wenn dir dieses Plugin hilft, freue ich mich über eine kleine Spende — sie hilft
mir, weitere HCU-Plugins zu bauen und zu pflegen.

<form action="https://www.paypal.com/donate" method="post" target="_top"><input type="hidden" name="hosted_button_id" value="JPZRATUUHRT5C" /><input type="image" src="https://www.paypalobjects.com/de_DE/DE/i/btn/btn_donate_SM.gif" border="0" name="submit" title="PayPal - The safer, easier way to pay online!" alt="Spenden mit dem PayPal-Button" /><img alt="" border="0" src="https://www.paypal.com/de_DE/i/scr/pixel.gif" width="1" height="1" /></form>

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

## Herausgeber

Herausgegeben von **Fabio Renner**.

## Lizenz

Apache-2.0

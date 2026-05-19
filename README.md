> ðŸ‡¬ðŸ‡§ English | [ðŸ‡©ðŸ‡ª Deutsch](README.de.md)

<p align="center">
  <img src="icon.svg" alt="hmip-hcu-fusionsolar icon" width="128" height="128"/>
</p>

# HMIP HCU Plugin: Sun2000 / FusionSolar

ðŸ“¦ **[Download hmip-hcu-fusionsolar-0.3.1.tar.gz](https://github.com/fabiorenner-hub/hmip-hcu-fusionsolar/releases/latest/download/hmip-hcu-fusionsolar-0.3.1.tar.gz)** â€” install via HCUweb â†’ *Developer mode â†’ Plugins â†’ Install from file*.

GitHub: <https://github.com/fabiorenner-hub/hmip-hcu-fusionsolar>

A Homematic IP HCU plugin that reads (and where supported, controls) a Huawei
Sun2000 PV system locally via Modbus TCP, with optional FusionSolar cloud
fallback. Includes an extensive debug dashboard.

## Support

If this plugin is useful to you, please consider a small donation — it helps
me keep the lights on while building more HCU plugins:
[Donate via PayPal](https://www.paypal.com/donate/?hosted_button_id=JPZRATUUHRT5C).

## Install on your HCU

1. Download `hmip-hcu-fusionsolar-<version>.tar.gz` from the
   [Releases](https://github.com/fabiorenner-hub/hmip-hcu-fusionsolar/releases).
2. In HCUweb open *Developer mode â†’ Plugins â†’ Install from file* and upload it.
3. Configure the plugin and (optionally) open the local debug dashboard at
   `http://<hcu-ip>:8088`.

## Build it yourself

```powershell
./build.ps1   # Windows
```

```bash
chmod +x build.sh
./build.sh    # macOS / Linux
```

## Author

Issued by **Fabio Renner**.

## License

Apache-2.0

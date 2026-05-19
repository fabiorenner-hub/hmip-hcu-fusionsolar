# Sun2000 / FusionSolar plugin for Homematic IP HCU
# Targets HCU2 (ARM64). Built on the same alpine-node image used by the
# official examples in homematicip/connect-api.

FROM --platform=linux/arm64 ghcr.io/homematicip/alpine-node-simple:0.0.1

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

# Local debug dashboard. Per HCU Connect API doc 4.3 the HCU maps EXPOSEd
# ports >1024 1:1 to the outside, so the dashboard is reachable at
# http://<hcu-ip>:8088 once the plugin is running.
EXPOSE 8088

# Persistent data lives in /data (preserved across plugin updates).
VOLUME ["/data"]

ENTRYPOINT ["node", "src/index.js", "de.fr.renner.plugin.fusionsolar", "host.containers.internal", "/TOKEN"]

LABEL de.eq3.hmip.plugin.metadata=\
'{\
	"pluginId": "de.fr.renner.plugin.fusionsolar",\
	"issuer": "Frank Renner",\
	"version": "0.2.0",\
	"hcuMinVersion": "1.4.7",\
	"scope": "LOCAL",\
	"friendlyName": {\
		"en": "Sun2000 / FusionSolar",\
		"de": "Sun2000 / FusionSolar"\
	},\
	"description": {\
		"en": "Local Modbus TCP integration for Huawei Sun2000 inverters, LUNA2000 batteries and DTSU666-H smart meters with optional FusionSolar cloud fallback.",\
		"de": "Lokale Modbus-TCP-Anbindung für Huawei Sun2000 Wechselrichter, LUNA2000 Speicher und DTSU666-H Smart Meter mit optionalem FusionSolar-Cloud-Fallback."\
	},\
	"logsEnabled": true\
}'

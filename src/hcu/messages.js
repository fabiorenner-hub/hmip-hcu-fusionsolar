"use strict";

const { v4: uuid } = require("uuid");

// Helpers to build the JSON envelopes specified in the HCU Connect API
// documentation v1.0.1, sections 6.2 PluginMessage / 6.3 plugin->HCU.

function envelope(pluginId, type, body, id) {
	return {
		id: id || uuid(),
		pluginId,
		type,
		body,
	};
}

function pluginStateResponse(pluginId, status, friendlyName, id) {
	return envelope(pluginId, "PLUGIN_STATE_RESPONSE", { pluginReadinessStatus: status, friendlyName }, id);
}

function discoverResponse(pluginId, devices, id) {
	return envelope(pluginId, "DISCOVER_RESPONSE", { success: true, devices }, id);
}

function statusResponse(pluginId, devices, id) {
	return envelope(pluginId, "STATUS_RESPONSE", { success: true, devices }, id);
}

function statusEvent(pluginId, deviceId, features) {
	return envelope(pluginId, "STATUS_EVENT", { deviceId, features });
}

function controlResponse(pluginId, deviceId, success, error, id) {
	const body = { deviceId, success };
	if (error) body.error = error;
	return envelope(pluginId, "CONTROL_RESPONSE", body, id);
}

function configTemplateResponse(pluginId, template, id) {
	return envelope(pluginId, "CONFIG_TEMPLATE_RESPONSE", template, id);
}

function configUpdateResponse(pluginId, status, message, id) {
	return envelope(pluginId, "CONFIG_UPDATE_RESPONSE", { status, message }, id);
}

module.exports = {
	envelope,
	pluginStateResponse,
	discoverResponse,
	statusResponse,
	statusEvent,
	controlResponse,
	configTemplateResponse,
	configUpdateResponse,
};

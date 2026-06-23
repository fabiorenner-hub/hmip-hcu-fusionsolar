"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("events");
const os = require("os");
const path = require("path");
process.env.HMIP_DATA_DIR = path.join(os.tmpdir(), "hmip-notif-safety-" + Date.now());

const config = require("../../src/config");
const notifications = require("../../src/notifications");

// Task 14.3 / Requirement 6.5: an error inside the notification snapshot
// listener must not prevent other listeners on the same event from running.
test("a throwing notification listener does not break sibling snapshot listeners", () => {
	notifications.init(() => ({ notifications: config.DEFAULTS.notifications }));

	const poller = new EventEmitter();
	// getModbus throws → forces the notification listener's body to throw,
	// which the facade must swallow.
	poller.getModbus = () => ({ getStatus: () => { throw new Error("boom"); } });

	notifications.attach({ poller }); // registers the notification listener
	let sibling = 0;
	poller.on("snapshot", () => { sibling += 1; }); // registered AFTER the notif listener

	assert.doesNotThrow(() => poller.emit("snapshot", { connected: true, values: {} }));
	assert.strictEqual(sibling, 1); // sibling ran despite the notif listener throwing
});

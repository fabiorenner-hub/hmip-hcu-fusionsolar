"use strict";

// Notification subsystem facade. Wires the store, grouping engine, dispatcher,
// Telegram channel and detector together, exposes passive `attach()` for the
// runtime event sources, and a small dashboard-facing API.
//
// Two independent paths from each detected event:
//   detector "event" → store.append  (feeds the Notification Center)
//   detector "event" → grouping.add  (feeds delivery via dispatcher)
// so the dashboard keeps updating even when Telegram is unreachable.

const log = require("../logger");
const { createStore } = require("./store");
const { GroupingEngine } = require("./grouping");
const { Dispatcher } = require("./dispatcher");
const { TelegramChannel } = require("./telegram");
const { EventDetector } = require("./detector");

let store = null;
let grouping = null;
let dispatcher = null;
let telegram = null;
let detector = null;
let pumpTimer = null;
let _getConfig = () => ({});
let _injectedSeq = 0;

function init(getConfig) {
	_getConfig = getConfig;
	store = createStore();
	telegram = new TelegramChannel(getConfig);
	dispatcher = new Dispatcher(getConfig, { telegram, log });
	grouping = new GroupingEngine(getConfig);
	detector = new EventDetector(getConfig);

	detector.on("event", (ev) => {
		try { store.append(ev); } catch (e) { log.error("notif store error:", e.message); }
		try { grouping.add(ev); } catch (e) { log.error("notif grouping error:", e.message); }
	});
	grouping.on("digest", (d) => {
		try { dispatcher.dispatch(d); } catch (e) { log.error("notif dispatch error:", e.message); }
	});

	// Low-frequency pump so quiet-hours-end flushes and coalesced digests are
	// delivered even without new events.
	pumpTimer = setInterval(() => {
		try { dispatcher.pump(); } catch { /* ignore */ }
	}, 30000);
	if (pumpTimer && typeof pumpTimer.unref === "function") pumpTimer.unref();

	return api;
}

// Passive subscriptions only — never mutates or blocks the sources. Each
// callback is wrapped so a thrown error is logged and swallowed, never
// disrupting the other listeners on the same event.
function attach({ poller, hcu }) {
	if (poller && typeof poller.on === "function") {
		poller.on("snapshot", (snap) => {
			try {
				const ms = poller.getModbus ? poller.getModbus().getStatus() : null;
				detector.onSnapshot(snap, ms);
			} catch (e) {
				log.error("notif detector error:", e.message);
			}
		});
	}
	if (hcu && typeof hcu.on === "function") {
		hcu.on("open", () => { try { detector.onHcuState(true); } catch { /* ignore */ } });
		hcu.on("close", () => { try { detector.onHcuState(false); } catch { /* ignore */ } });
	}
}

const api = {
	init,
	attach,
	// Inject an event not derived from a poller/HCU snapshot (e.g. a plugin
	// update became available). Routed through the same two paths as detector
	// events: the Notification Center store and the delivery pipeline. Honors
	// the category enable flag so users can silence it.
	notify: (category, severity, title, message, data) => {
		const cats = (_getConfig().notifications || {}).categories || {};
		if (!(cats[category] && cats[category].enabled)) return null;
		_injectedSeq = (_injectedSeq + 1) % 1e6;
		const ev = { id: `evt_inj_${Date.now()}_${_injectedSeq}`, category, severity, title, message, data: data || null, t: Date.now(), read: false };
		if (store) {
			try { store.append(ev); } catch (e) { log.error("notif store error:", e.message); }
		}
		if (grouping) {
			try { grouping.add(ev); } catch (e) { log.error("notif grouping error:", e.message); }
		}
		return ev;
	},
	listGrouped: () => (store ? store.listGrouped() : {}),
	listUnread: () => (store ? store.listUnread() : []),
	markRead: (id) => (store ? store.markRead(id) : 0),
	markAllRead: () => (store ? store.markAllRead() : 0),
	unreadCount: () => (store ? store.unreadCount() : 0),
	sendTest: () => (telegram ? telegram.sendTest() : Promise.resolve({ delivered: false, reason: "not-initialised" })),
};

module.exports = api;

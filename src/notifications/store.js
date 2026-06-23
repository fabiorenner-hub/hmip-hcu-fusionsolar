"use strict";

// Notification_Store — bounded ring buffer of notification events plus their
// read/unread state, backing the dashboard Notification Center.
//
// Mirrors the retention discipline of logger.js / hcuLog.js: a hard cap with
// oldest-first discard. The unread counter is maintained incrementally so it
// is cheap to read on every SSE tick (it rides the snapshot payload).

const MAX_NOTIFICATIONS = 500; // documented bound (Requirement 5.10)

function createStore(max = MAX_NOTIFICATIONS) {
	const buffer = []; // newest pushed to the end
	let unread = 0;

	function append(event) {
		buffer.push(event);
		if (event.read !== true) {
			event.read = false;
			unread += 1;
		}
		// Bound: discard oldest, adjusting the unread counter for any unread
		// events that fall off the end.
		while (buffer.length > max) {
			const dropped = buffer.shift();
			if (dropped && dropped.read === false) unread -= 1;
		}
		return event;
	}

	function listUnread() {
		return buffer.filter((e) => e.read === false).reverse(); // newest first
	}

	function listGrouped() {
		const groups = {};
		for (let i = buffer.length - 1; i >= 0; i -= 1) {
			const e = buffer[i];
			if (e.read !== false) continue;
			(groups[e.category] = groups[e.category] || []).push(e);
		}
		return groups;
	}

	function markRead(id) {
		let newly = 0;
		for (const e of buffer) {
			if (e.id === id && e.read === false) {
				e.read = true;
				newly += 1;
				break;
			}
		}
		unread -= newly;
		return newly;
	}

	// Atomically mark every event read so none remains unread afterwards.
	function markAllRead() {
		let newly = 0;
		for (const e of buffer) {
			if (e.read === false) {
				e.read = true;
				newly += 1;
			}
		}
		unread -= newly;
		return newly;
	}

	function unreadCount() {
		return unread;
	}

	function size() {
		return buffer.length;
	}

	return { append, listUnread, listGrouped, markRead, markAllRead, unreadCount, size, MAX: max };
}

module.exports = { createStore, MAX_NOTIFICATIONS };

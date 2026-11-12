/* SubFeed for X: read posts shared between browsers and devices. Optional:
   it does nothing until a sync server is set up (see README, "Sync").

   Runs next to page.js, in the content-script world. page.js keeps the posts
   you read in X's localStorage; every half minute, and whenever the tab is
   shown or hidden, this sends the ones read since the last call to the server
   and merges in the ones read elsewhere, so the next timeline X loads leaves
   them out here too. The server only ever sees post ids and when they were
   read.

   The server call goes through a transport: the extension's background worker
   by default (it holds the server address), or, where the page runs inside an
   app, a function the app puts in globalThis.__subfeedSyncTransport first.
   Either way it takes {since, seen} and answers {ok, seq, seen}, or {ok: false}
   when sync is off. */
(() => {
  "use strict";
  const KEY = "subfeed";
  const SYNC = "subfeed.sync"; // {since: server cursor, pushed: newest read time sent}
  const FORGET = 14 * 24 * 3600e3; // as long as page.js remembers a read post
  const EVERY = 30e3;
  if (window.top !== window || globalThis.__subfeedSync) return;
  globalThis.__subfeedSync = true;

  const transport =
    globalThis.__subfeedSyncTransport ||
    ((msg) => chrome.runtime.sendMessage({ subfeedSync: msg }));

  const get = (key) => {
    try {
      return JSON.parse(localStorage.getItem(key)) || {};
    } catch {
      return {};
    }
  };

  let busy = false;
  let off = false;
  async function round() {
    if (busy || off) return;
    busy = true;
    try {
      const sync = get(SYNC);
      const pushed = Number(sync.pushed) || 0;
      const out = {};
      let newest = pushed;
      for (const [id, t] of Object.entries(get(KEY).seen || {})) {
        if (typeof t === "number" && t > pushed) {
          out[id] = t;
          newest = Math.max(newest, t);
        }
      }
      const res = await transport({ since: Number(sync.since) || 0, seen: out });
      if (!res || res.ok === false) {
        if (res && res.off) off = true; // no server set up: stop asking
        return;
      }
      // Read again: page.js may have saved while the call was out. Everything
      // here runs in one go, so nothing page.js writes is lost in between.
      const state = get(KEY);
      state.seen = state.seen || {};
      const now = Date.now();
      let added = 0;
      for (const [id, t] of Object.entries(res.seen || {})) {
        if (id in state.seen || typeof t !== "number" || t < now - FORGET) continue;
        // Never later than now, so a post read elsewhere can't move this
        // device's "pushed" mark past posts it reads next.
        state.seen[id] = Math.min(t, now);
        added++;
      }
      if (added) {
        localStorage.setItem(KEY, JSON.stringify({ on: !!state.on, min: !!state.min, seen: state.seen }));
        window.postMessage({ subfeed: "adopt" }, location.origin); // page.js picks them up
      }
      // Ten seconds back: another X tab may still hold a post it read just
      // before, unsaved for two seconds. Sending one twice costs nothing.
      const mark = Math.max(pushed, newest - 10e3);
      localStorage.setItem(SYNC, JSON.stringify({ since: res.seq, pushed: mark, at: now, got: added, sent: Object.keys(out).length }));
    } catch {
      // Offline, server asleep: the next round sends the same posts again.
    } finally {
      busy = false;
    }
  }

  round();
  setInterval(() => document.visibilityState === "visible" && round(), EVERY);
  document.addEventListener("visibilitychange", round);
  addEventListener("pagehide", round);
})();

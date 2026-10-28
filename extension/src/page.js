/* SubFeed for X: two switches.

   "Minimalist" hides X's right column (news, trends, who to follow, footer)
   except its search bar and these switches, and leaves only Home,
   Notifications, Profile and Post in the left menu, before X draws them.

   "Never twice": when it is on, X's home
   timeline (For you and Following) leaves out
   - posts you have already read (on screen for about a second, anywhere on X),
   - posts older than 72 hours; the Following feed simply ends there.

   Posts are removed from X's own timeline responses before X renders them,
   so a reload paints only what is left: nothing flashes, collapses or jumps,
   and X never pages back through days of hidden posts. When a page has
   (almost) nothing unread left, older pages are fetched with X's own request
   and merged in before X sees it. X's client loads timelines with
   XMLHttpRequest and reads responseText, which is what this wraps; that is
   why it runs in the page's world, at document_start. */
(() => {
  "use strict";
  const VERSION = "0.5.0";
  const HOUR = 3600e3;
  const MAX_AGE = 72 * HOUR;
  const FORGET = 14 * 24 * HOUR; // read posts are remembered this long
  const KEY = "subfeed";
  const TIMELINE = /\/graphql\/[\w-]+\/(HomeTimeline|HomeLatestTimeline)(?:[?/]|$)/;
  const STATUS = /\/status\/(\d+)/;
  const EPOCH = 1288834974657; // X's snowflake ids carry their creation time

  // ---------- state: X's localStorage, so the filter can read it synchronously
  function read() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && typeof s === "object") return { on: !!s.on, min: !!s.min, seen: s.seen || {} };
    } catch {}
    return { on: false, min: false, seen: {} };
  }
  const S = read();
  let saveTimer = 0;
  // Writes what this tab read; the switches are taken from storage unless
  // this tab is the one flipping them, so a stale tab never undoes a toggle.
  function save(change = {}) {
    clearTimeout(saveTimer);
    saveTimer = 0;
    const disk = read(); // other X tabs may have read posts since
    S.on = "on" in change ? change.on : disk.on;
    S.min = "min" in change ? change.min : disk.min;
    for (const [id, t] of Object.entries(disk.seen)) if (!(id in S.seen)) S.seen[id] = t;
    const min = Date.now() - FORGET;
    for (const [id, t] of Object.entries(S.seen)) if (typeof t !== "number" || t < min) delete S.seen[id];
    try {
      localStorage.setItem(KEY, JSON.stringify(S));
    } catch {}
  }
  function adopt() {
    const disk = read();
    S.on = disk.on;
    S.min = disk.min;
    Object.assign(S.seen, disk.seen);
    minimal();
    paint();
  }
  addEventListener("storage", (e) => e.key === KEY && adopt()); // another tab
  addEventListener("pagehide", () => saveTimer && save());

  // ---------- Minimalist: the right column keeps its search bar and the
  // switches; whatever X puts after the switches is hidden. Until they are in
  // place the column stays invisible, so news and trends never show, even for
  // a frame. The left menu loses X's logo, its account button and every item
  // but these (by test id, else by link, as X renames things):
  const KEEP = [
    '[data-testid="AppTabBar_Home_Link"]', '[href="/home"]',
    '[data-testid="AppTabBar_Notifications_Link"]', '[href="/notifications"]',
    '[data-testid="AppTabBar_Profile_Link"]', '[aria-label="Profile"]',
    '[data-testid="SideNav_NewTweet_Button"]', '[href="/compose/post"]',
  ].join(", ");
  const MENU = 'header[role="banner"] nav[role="navigation"]';
  const pageSheet = new CSSStyleSheet();
  pageSheet.replaceSync(`
    html[data-subfeed-min] [data-testid="sidebarColumn"]:not(:has(subfeed-switch)) { visibility: hidden !important; }
    html[data-subfeed-min] subfeed-switch ~ *,
    html[data-subfeed-min] header[role="banner"] h1,
    html[data-subfeed-min] [data-testid="SideNav_AccountSwitcher_Button"],
    html[data-subfeed-min] ${MENU} :is(a, button):not(${KEEP}) { display: none !important; }
  `);
  function minimal() {
    if (!document.adoptedStyleSheets.includes(pageSheet)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, pageSheet];
    const html = document.documentElement;
    if (html.hasAttribute("data-subfeed-min") !== S.min) html.toggleAttribute("data-subfeed-min", S.min);
  }
  minimal();

  // ---------- one copy per page. After the extension reloads, Chromium can
  // keep injecting the copy it had before into X tabs that were already open,
  // ahead of this one. Two copies would filter twice and fight over the switches, so
  // the first one in runs, and a later one only adds the stylesheet above (for
  // the left menu, which older copies don't hide). Every copy since v0.3 reads
  // XHR responses through rewritten(); v0.4.7 and later also mark the window.
  const reader = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, "responseText")?.get;
  const older = !!reader && /rewritten\(this, raw\)/.test(Function.prototype.toString.call(reader));
  if (window.__subfeed || older) {
    try {
      localStorage.setItem(KEY + ".dup", JSON.stringify({ t: Date.now(), running: window.__subfeed || "older", skipped: VERSION, path: location.pathname }));
    } catch {}
    return;
  }
  Object.defineProperty(window, "__subfeed", { value: VERSION });

  // ---------- the filter
  const stats = { responses: 0, read: 0, old: 0 };
  const idTime = (id) => {
    try {
      return Number(BigInt(id) >> 22n) + EPOCH;
    } catch {
      return 0;
    }
  };
  const unwrap = (r) => (r && r.__typename === "TweetWithVisibilityResults" ? r.tweet : r);

  function post(ic) {
    if (!ic || ic.itemType !== "TimelineTweet" || ic.promotedMetadata) return null;
    const t = unwrap(ic.tweet_results?.result);
    if (!t?.rest_id) return null;
    const original = unwrap(t.legacy?.retweeted_status_result?.result);
    // Age = when it reached your timeline (a repost's own id); identity = the
    // original post, so the same post reposted by three people shows once.
    return { id: original?.rest_id || t.rest_id, at: idTime(t.rest_id) };
  }

  // The posts in a timeline entry, or null for anything that isn't only
  // organic posts (ads, cursors, who-to-follow...), which is left alone.
  function postsOf(entry) {
    if (/^promoted/i.test(entry.entryId || "")) return null;
    const c = entry.content || {};
    const ics = c.itemContent ? [c.itemContent] : Array.isArray(c.items) ? c.items.map((i) => i?.item?.itemContent) : [];
    const posts = ics.map(post);
    return posts.length && posts.every(Boolean) ? posts : null;
  }

  const instructionsOf = (json) => {
    const ins = json?.data?.home?.home_timeline_urt?.instructions;
    return Array.isArray(ins) ? ins : null;
  };
  const isEnd = (ins) => ins.type === "TimelineTerminateTimeline" && ins.direction === "Bottom";

  // Drops read and old posts from one timeline response, in place.
  function filter(json, req) {
    const instructions = instructionsOf(json);
    if (!instructions) return null;
    const r = { read: 0, old: 0, kept: 0, end: false };
    if (!S.on) return r;
    const cutoff = Date.now() - MAX_AGE;
    let reachedOld = false;
    for (const ins of instructions) {
      if (ins.type !== "TimelineAddEntries" || !Array.isArray(ins.entries)) continue;
      ins.entries = ins.entries.filter((entry) => {
        const posts = postsOf(entry);
        if (!posts) return true;
        if (Math.max(...posts.map((p) => p.at)) < cutoff) {
          reachedOld = true;
          r.old++;
          return false;
        }
        // A conversation stays whole while any post in it is new to you.
        if (posts.every((p) => p.id in S.seen || p.at < cutoff)) {
          r.read++;
          return false;
        }
        r.kept++;
        return true;
      });
    }
    // A page with nothing left to read loses its ad and suggestions too, or
    // the ones from skipped pages would pile up on top of each other.
    if (!r.kept && (r.read || r.old)) {
      for (const ins of instructions) {
        if (ins.type === "TimelineAddEntries" && Array.isArray(ins.entries)) ins.entries = ins.entries.filter((e) => e.content?.cursorType);
      }
    }
    // Following runs newest first: past 72 h there is nothing left to show,
    // so tell X the timeline ends here (it then stops fetching older pages).
    r.end = reachedOld && req.op === "HomeLatestTimeline" && !req.ranked;
    if (r.end && !instructions.some(isEnd)) instructions.push({ type: "TimelineTerminateTimeline", direction: "Bottom" });
    return r;
  }

  // ---------- topping up: a page that is all read would leave X with nothing
  // to draw (it then shows "Welcome to X!" and stops paging), so before X sees
  // the response, older pages are fetched with X's own request and merged in.
  const WANT = 10; // unread posts to aim for before X draws the page...
  const SOFT = 1500; // ...for this long (ms); after that, whatever was found
  const BUDGET = 8000; // ms, while nothing unread was found; X shows its spinner
  const MAX_PAGES = 30;
  const tops = new Set(); // cursors X uses to poll for newer posts: never topped up

  function cursorOf(json, type) {
    let value = null;
    for (const ins of instructionsOf(json) || []) {
      if (ins.type === "TimelineAddEntries") {
        for (const e of ins.entries || []) if (e.content?.cursorType === type) value = e.content.value;
      } else if (ins.type === "TimelineReplaceEntry" && ins.entry?.content?.cursorType === type) {
        value = ins.entry.content.value;
      }
    }
    return value;
  }

  // Older posts from `page` go after what `into` already has, and `into`'s
  // bottom cursor moves on to `page`'s, so X's next "load more" continues there.
  function merge(into, page) {
    const list = instructionsOf(into);
    let adds = list.find((ins) => ins.type === "TimelineAddEntries");
    if (!adds) list.unshift((adds = { type: "TimelineAddEntries", entries: [] }));
    const known = new Set(adds.entries.map((e) => e.entryId));
    const fresh = [];
    let bottom = null;
    for (const ins of instructionsOf(page)) {
      if (ins.type === "TimelineAddEntries") {
        for (const e of ins.entries || []) {
          const type = e.content?.cursorType;
          if (type === "Bottom") bottom = e;
          else if (!type && !known.has(e.entryId)) known.add(e.entryId), fresh.push(e);
        }
      } else if (ins.type === "TimelineReplaceEntry" && ins.entry?.content?.cursorType === "Bottom") {
        bottom = ins.entry;
      } else if (isEnd(ins) && !list.some(isEnd)) {
        list.push(ins);
      }
    }
    const isBottom = (e) => e.content?.cursorType === "Bottom";
    const cursors = adds.entries.filter((e) => e.content?.cursorType && !isBottom(e));
    const old = adds.entries.find(isBottom);
    adds.entries = [...adds.entries.filter((e) => !e.content?.cursorType), ...fresh, ...cursors];
    for (const ins of list) {
      if (ins.type === "TimelineReplaceEntry" && ins.entry?.content?.cursorType === "Bottom" && bottom) ins.entry = { ...ins.entry, content: bottom.content };
    }
    if (bottom) adds.entries.push(old ? { ...old, content: bottom.content, sortIndex: bottom.sortIndex ?? old.sortIndex } : bottom);
  }

  // X's request again, one page further down: same method, headers and body.
  function more(req, cursor) {
    return new Promise((resolve) => {
      let url = req.url;
      let body = req.body;
      try {
        if (typeof body === "string" && body) {
          const b = JSON.parse(body);
          b.variables = { ...b.variables, cursor };
          body = JSON.stringify(b);
        } else {
          const u = new URL(url, location.href);
          const v = JSON.parse(u.searchParams.get("variables") || "{}");
          v.cursor = cursor;
          u.searchParams.set("variables", JSON.stringify(v));
          url = u.href;
        }
      } catch {
        return resolve({ status: -1, json: null });
      }
      const x = new XMLHttpRequest();
      open.call(x, req.method, url);
      x.withCredentials = true;
      x.timeout = 15000;
      for (const [k, v] of req.headers) setHeader.call(x, k, v);
      x.onloadend = () => {
        let json = null;
        if (x.status === 200) {
          try {
            json = JSON.parse(nativeText.call(x));
          } catch {}
        }
        resolve({ status: x.status, json });
      };
      send.call(x, body);
    });
  }

  // What a response looked like before filtering, for the log.
  function shape(json) {
    const list = instructionsOf(json) || [];
    const entries = list.flatMap((i) => (Array.isArray(i.entries) ? i.entries : i.entry ? [i.entry] : []));
    // Entries by kind (entry id prefix; "?" = not read as posts), and how many
    // of the posts this tab already knows as read.
    const kinds = {};
    let known = 0;
    for (const e of entries) {
      const posts = postsOf(e);
      const k = (e.entryId || "").split("-")[0] + (posts ? "" : "?");
      kinds[k] = (kinds[k] || 0) + 1;
      if (posts?.every((p) => p.id in S.seen)) known++;
    }
    return {
      kinds: Object.entries(kinds).map(([k, n]) => `${k}:${n}`).join(","),
      known,
      seen: Object.keys(S.seen).length,
      ins: list.map((i) => i.type.replace("Timeline", "") + (Array.isArray(i.entries) ? ":" + i.entries.length : "")).join(","),
      cur: entries.filter((e) => /cursor/i.test(e.entryId || "") || e.content?.cursorType).map((e) => `${(e.entryId || "").split("-").slice(0, 2).join("-")}:${e.content?.cursorType || Object.keys(e.content || {}).join("/")}`).join(","),
    };
  }

  async function fill(xhr) {
    const req = xhr[REQ];
    const raw = nativeText.call(xhr);
    const json = JSON.parse(raw);
    req.shape ||= shape(json);
    req.held = true;
    const r = filter(json, req);
    if (!r) return (xhr[OUT] = { json, text: raw });
    const total = { ...r, pages: 0 };
    const t0 = Date.now();
    // Only a first load or X's "load older" is topped up, never its polls for newer posts.
    if (S.on && !tops.has(req.cursor)) {
      const wanted = () => (total.kept ? total.kept < WANT && Date.now() - t0 < SOFT : Date.now() - t0 < BUDGET);
      while (!total.end && total.pages < MAX_PAGES && wanted()) {
        const cursor = cursorOf(json, "Bottom");
        if (!cursor) break;
        const res = await more(req, cursor);
        const p = res.json && filter(res.json, req);
        if (!p) {
          total.fail = res.status;
          break;
        }
        total.pages++;
        total.read += p.read;
        total.old += p.old;
        total.kept += p.kept;
        total.end = total.end || p.end;
        merge(json, res.json);
      }
    }
    const top = cursorOf(json, "Top");
    if (top) tops.add(top);
    done(req, total, Date.now() - t0);
    return (xhr[OUT] = { json, text: total.read || total.old || total.end ? JSON.stringify(json) : raw });
  }

  function done(req, r, ms) {
    stats.responses++;
    stats.read += r.read;
    stats.old += r.old;
    log({ op: req.op, method: req.method, count: req.count, cursor: req.cursor ? (tops.has(req.cursor) ? "top" : "more") : "first", read: r.read, old: r.old, kept: r.kept, end: r.end, pages: r.pages || 0, ms, fail: r.fail, held: !!req.held, ctx: req.ctx, ...req.shape });
    paint();
    if (S.on && !req.cursor && !r.kept) watchEmpty();
  }

  // ---------- the hook on X's timeline requests
  const REQ = Symbol("subfeed.req");
  const OUT = Symbol("subfeed.out");
  const XHR = XMLHttpRequest.prototype;
  const open = XHR.open;
  const send = XHR.send;
  const setHeader = XHR.setRequestHeader;
  const nativeText = Object.getOwnPropertyDescriptor(XHR, "responseText").get;
  XHR.open = function (method, url) {
    const m = TIMELINE.exec(String(url));
    // "Popular" sort on Following isn't chronological: never end it early.
    this[REQ] = m ? { op: m[1], method: String(method).toUpperCase(), url: String(url), headers: [], ranked: /enableRanking(%22)?(%3A|":)true/.test(String(url)) } : null;
    this[OUT] = undefined;
    return open.apply(this, arguments);
  };
  XHR.setRequestHeader = function (name, value) {
    if (this[REQ]) this[REQ].headers.push([name, value]);
    return setHeader.apply(this, arguments);
  };
  XHR.send = function (body) {
    const req = this[REQ];
    if (req) {
      req.body = body;
      if (typeof body === "string" && /"enableRanking":\s*true/.test(body)) req.ranked = true;
      try {
        const v = typeof body === "string" && body ? JSON.parse(body).variables : JSON.parse(new URL(req.url, location.href).searchParams.get("variables") || "{}");
        req.cursor = v?.cursor || null;
        req.count = v?.count;
        req.ctx = v?.requestContext;
      } catch {}
      // X reads the response in onreadystatechange (its HttpClient) or onload
      // (its newer fetch stand-in), both set before send: hold those calls
      // until the page is topped up, so X draws it once, complete.
      if (S.on) for (const prop of ["onreadystatechange", "onload"]) hold(this, prop);
    }
    return send.apply(this, arguments);
  };
  const FILL = Symbol("subfeed.fill");
  const HELD = Symbol("subfeed.held");
  function hold(xhr, prop) {
    const handler = xhr[prop];
    if (typeof handler !== "function") return;
    xhr[HELD] = true;
    xhr[prop] = function (ev) {
      const ready = this.readyState === 4 && this.status === 200 && (!this.responseType || this.responseType === "text");
      if (!ready) return handler.call(this, ev);
      // If topping up fails, X gets the filtered page as it came.
      (this[FILL] ||= fill(this).catch(() => (this[HELD] = false))).then(() => handler.call(this, ev));
    };
  }
  // The response as X gets it. Read before the held handler is done (X's
  // network monitoring does), it is filtered but not topped up or counted.
  function rewritten(xhr, raw) {
    if (xhr[OUT] !== undefined) return xhr[OUT];
    let out;
    let r = null;
    try {
      const json = typeof raw === "string" ? JSON.parse(raw) : raw;
      xhr[REQ].shape ||= shape(json);
      r = filter(json, xhr[REQ]);
      out = { json, text: r && (r.read || r.old || r.end) && typeof raw === "string" ? JSON.stringify(json) : raw };
    } catch {
      out = { json: raw, text: raw };
    }
    if (xhr[HELD]) return out;
    if (r) done(xhr[REQ], r, 0);
    return (xhr[OUT] = out);
  }
  for (const prop of ["responseText", "response"]) {
    const d = Object.getOwnPropertyDescriptor(XHR, prop);
    Object.defineProperty(XHR, prop, {
      ...d,
      get() {
        const raw = d.get.call(this);
        if (!this[REQ] || this.readyState !== 4 || this.status !== 200) return raw;
        if (prop === "response" && this.responseType === "json") return rewritten(this, raw).json;
        if (prop === "response" && this.responseType && this.responseType !== "text") return raw;
        return rewritten(this, raw).text;
      },
    });
  }

  // Last few timeline responses and the card's state, for bug reports: counts
  // and entry kinds only, never what a post says or who wrote it.
  const recent = [];
  const card = { state: "" };
  function writeLog() {
    try {
      localStorage.setItem(KEY + ".log", JSON.stringify({ v: VERSION, on: S.on, min: S.min, stats, card, recent }));
    } catch {}
  }
  function log(row) {
    recent.push({ t: Date.now(), ...row });
    if (recent.length > 12) recent.shift();
    writeLog();
  }
  function note(state) {
    if (card.state === state) return;
    card.state = state;
    card.at = Date.now();
    writeLog();
  }

  // ---------- reading: a post counts as read after ~0.8 s mostly on screen
  const watched = new Set();
  const timers = new Map();
  const idOf = (article) => {
    const href = article.querySelector('a[href*="/status/"] time')?.closest("a")?.getAttribute("href");
    return href?.match(STATUS)?.[1] || null;
  };
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const el = e.target;
        const vh = e.rootBounds?.height || innerHeight;
        const visible = e.intersectionRatio >= 0.6 || e.intersectionRect.height >= vh * 0.5; // tall posts never reach 60%
        if (visible && !timers.has(el)) {
          timers.set(el, setTimeout(() => markRead(el), 800));
        } else if (!visible && timers.has(el)) {
          clearTimeout(timers.get(el));
          timers.delete(el);
        }
      }
    },
    { threshold: [0, 0.25, 0.5, 0.6, 0.8, 1] },
  );
  function unwatch(el) {
    io.unobserve(el);
    watched.delete(el);
    clearTimeout(timers.get(el));
    timers.delete(el);
  }
  function markRead(el) {
    const id = idOf(el);
    unwatch(el);
    if (!id || id in S.seen) return;
    S.seen[id] = Date.now();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 2000);
  }
  function scan() {
    for (const el of watched) if (!el.isConnected) unwatch(el);
    for (const a of document.getElementsByTagName("article")) {
      if (watched.has(a) || a.getAttribute("data-testid") !== "tweet") continue;
      const id = idOf(a);
      if (!id || id in S.seen) continue;
      watched.add(a);
      io.observe(a);
    }
  }

  // ---------- the switches, in X's right column
  const CSS = `
    :host {
      --fg: #0f1419; --muted: #536471; --line: #eff3f4; --track: #cfd9de; --hover: rgba(15, 20, 25, 0.03);
      --accent: #1d9bf0; --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
      all: initial; display: block; margin: 0 0 16px;
      font-family: TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    :host([theme="dim"]) { --fg: #f7f9f9; --muted: #8b98a5; --line: #38444d; --track: #425364; --hover: rgba(247, 249, 249, 0.03); }
    :host([theme="dark"]) { --fg: #e7e9ea; --muted: #71767b; --line: #2f3336; --track: #3e4144; --hover: rgba(231, 233, 234, 0.03); }
    .card { border: 1px solid var(--line); border-radius: 16px; overflow: hidden; }
    button {
      all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 12px;
      padding: 12px 16px; cursor: pointer; transition: background-color 0.2s;
    }
    button + button { border-top: 1px solid var(--line); }
    button:hover { background: var(--hover); }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    .text { flex: 1; min-width: 0; display: grid; gap: 2px; }
    .title { color: var(--fg); font-size: 15px; font-weight: 700; line-height: 20px; }
    .sub { color: var(--muted); font-size: 13px; line-height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .knob { flex: none; position: relative; width: 36px; height: 20px; border-radius: 10px; background: var(--track); transition: background-color 0.2s var(--ease); }
    .knob::after {
      content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
      background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2); transition: transform 0.2s var(--ease);
    }
    [aria-checked="true"] .knob { background: var(--accent); }
    [aria-checked="true"] .knob::after { transform: translateX(16px); }
  `;
  let host = null;
  let ui = null;
  let painted = "";
  let broken = false;
  let ticks = 0;

  function build() {
    host = document.createElement("subfeed-switch");
    const root = host.attachShadow({ mode: "open" });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];
    const row = (title) => `<button role="switch" aria-checked="false"><span class="text"><span class="title">${title}</span><span class="sub"></span></span><span class="knob"></span></button>`;
    root.innerHTML = `<div class="card">${row("Never twice")}${row("Minimalist")}</div>`;
    const [never, min] = [...root.querySelectorAll("button")].map((button) => ({ button, sub: button.querySelector(".sub") }));
    ui = { never, min };
    never.button.addEventListener("click", toggle);
    min.button.addEventListener("click", toggleMin);
  }

  function toggle() {
    save({ on: !S.on });
    paint();
    // What's already on screen came in before the switch: reload to apply it.
    if (location.pathname === "/home") setTimeout(() => location.reload(), 220);
  }

  function toggleMin() {
    save({ min: !S.min });
    minimal();
    paint();
    record();
  }

  function subtitle() {
    if (!S.on) return "Off";
    if (broken) return "Not filtering: X changed how it loads posts";
    const parts = [];
    if (stats.read) parts.push(`${stats.read} read`);
    if (stats.old) parts.push(`${stats.old} older than 72 h`);
    return parts.length ? `Hid ${parts.join(" · ")}` : "Hides read posts and anything over 72 h";
  }

  function theme() {
    const bg = getComputedStyle(document.body).backgroundColor;
    return bg === "rgb(0, 0, 0)" ? "dark" : bg === "rgb(21, 32, 43)" ? "dim" : "light";
  }

  function paint() {
    if (!ui) return;
    if (ticks % 8 === 0 || !host.hasAttribute("theme")) host.setAttribute("theme", theme());
    const next = `${S.on}|${S.min}|${subtitle()}`;
    if (next === painted) return;
    painted = next;
    ui.never.button.setAttribute("aria-checked", String(S.on));
    ui.never.sub.textContent = subtitle();
    ui.min.button.setAttribute("aria-checked", String(S.min));
    ui.min.sub.textContent = S.min ? "Hides news, trends and menu extras" : "Off";
  }

  // Right under X's search bar, above its first sidebar block. X re-renders
  // and reorders the sidebar's children, so the spot is checked whenever the
  // column changes (and every tick).
  function spot(sc) {
    const search = sc.querySelector('form[role="search"]');
    const block = sc.querySelector('section, aside, nav[aria-label], [data-testid="super-upsell-UpsellCardRenderProperties"]');
    if (!search || !block) return null;
    let parent = block;
    while (parent && !parent.contains(search)) parent = parent.parentElement;
    if (!parent) return null;
    let bar = search;
    while (bar.parentElement !== parent) bar = bar.parentElement;
    // Skip the empty spacer X puts under its fixed search bar (and the card).
    let before = bar.nextElementSibling;
    while (before && (before === host || !before.textContent.trim())) before = before.nextElementSibling;
    return { parent, bar, before };
  }
  // Anywhere between the search bar and X's first block will do: the card
  // never moves just to be adjacent, so nothing can keep it moving.
  const follows = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  const placed = (s) => host.parentElement === s.parent && follows(s.bar, host) && (!s.before || follows(host, s.before));

  // X adds the column's blocks as they load. The switches go in as soon as
  // the column changes, before the browser paints, so nothing shifts under
  // them and Minimalist never shows a block. Cheap on the rest of the page:
  // once the column is found, only the column is watched.
  let column = null;
  let layoutTimer = 0;
  const columnObs = new MutationObserver(() => safely(placeCard));
  new MutationObserver(() => column?.isConnected || safely(placeCard)).observe(document, { childList: true, subtree: true });
  function safely(fn) {
    try {
      fn();
    } catch (e) {
      note(`error: ${e?.message || e}`);
    }
  }

  function placeCard() {
    if (!column?.isConnected) {
      column = document.querySelector('[data-testid="sidebarColumn"]');
      columnObs.disconnect();
      if (column) columnObs.observe(column, { childList: true, subtree: true });
    }
    if (!column || !document.body) return note("no sidebar");
    const s = spot(column);
    if (!s) return note("no spot");
    if (!host) build();
    if (!placed(s)) {
      s.parent.insertBefore(host, s.before);
      note("placed");
    }
    paint();
    record();
  }
  // Written only by a tab that can see them (background tabs draw neither),
  // so another X tab never clears what was seen.
  let recorded = "";
  function record() {
    layoutTimer ||= setTimeout(() => {
      layoutTimer = 0;
      const seen = { column: layout(), menu: menu() };
      const next = JSON.stringify(seen);
      if ((!seen.column && !seen.menu) || next === recorded) return;
      recorded = next;
      try {
        localStorage.setItem(KEY + ".layout", JSON.stringify({ t: Date.now(), path: location.pathname, min: S.min, ...seen }));
      } catch {}
    }, 1500);
  }

  // The left menu, for the log: each item, kept or not, and its height (0 = hidden).
  function menu() {
    const all = [...document.querySelectorAll(`${MENU} :is(a, button)`)];
    if (!all.length) return "";
    const items = all.map((el) => {
      const name = el.dataset.testid || el.getAttribute("aria-label") || el.getAttribute("href");
      return `${name}:${el.matches(KEEP) ? "keep" : "hide"}/${Math.round(el.getBoundingClientRect().height)}`;
    });
    const h = (sel) => Math.round(document.querySelector(sel)?.getBoundingClientRect().height ?? -1);
    return `logo/${h('header[role="banner"] h1')} ${items.join(" ")} post/${h('[data-testid="SideNav_NewTweet_Button"]')} account/${h('[data-testid="SideNav_AccountSwitcher_Button"]')}`;
  }

  // What the column holds, for the log: each block's kind and height (0 = hidden).
  function layout() {
    const parent = host?.parentElement;
    if (!parent) return "";
    return [...parent.children]
      .map((el) => {
        const landmark = 'section, aside, nav, [data-testid="super-upsell-UpsellCardRenderProperties"]';
        const mark = el.matches(landmark) ? el : el.querySelector(landmark);
        const kind = el === host ? "switches" : el.querySelector('form[role="search"]') ? "search" : mark ? `${mark.tagName.toLowerCase()}${mark.getAttribute("aria-label") ? `[${mark.getAttribute("aria-label")}]` : ""}` : el.textContent.trim() ? "text" : "empty";
        return `${kind}/${Math.round(el.getBoundingClientRect().height)}`;
      })
      .join(" ");
  }

  // Everything from the last 72 h is read: X would greet you like a brand
  // new account ("Welcome to X!"), so its empty state says what happened.
  function caughtUp() {
    if (!S.on || location.pathname !== "/home" || !(stats.read || stats.old)) return false;
    const box = document.querySelector('[data-testid="primaryColumn"] [data-testid="emptyState"]');
    if (!box) return false;
    relabel(box.querySelector('[data-testid="empty_state_header_text"]'), "You’re all caught up");
    relabel(box.querySelector('[data-testid="empty_state_body_text"]'), "You’ve read everything new from the people you follow. New posts will show up here.");
    const button = box.querySelector('[data-testid="empty_state_button_text"]');
    if (button && button.style.display !== "none") button.style.display = "none";
    return true;
  }
  // Right as X adds it, before it is painted, so "Welcome to X!" never shows.
  function watchEmpty() {
    const mo = new MutationObserver(() => caughtUp() && mo.disconnect());
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => mo.disconnect(), 5000);
  }
  // Changes the text in place (React keeps its own nodes).
  function relabel(el, text) {
    if (!el || el.textContent === text) return;
    const nodes = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) nodes.push(walk.currentNode);
    if (!nodes.length) return;
    nodes[0].nodeValue = text;
    for (const n of nodes.slice(1)) n.nodeValue = "";
  }

  function tick() {
    ticks++;
    if (document.hidden) return;
    safely(() => {
      minimal();
      scan();
      placeCard();
      caughtUp();
      record();
    });
  }
  setInterval(tick, 500);

  // If X stops loading timelines the way this expects, say so on the card.
  if (S.on && location.pathname === "/home") {
    setTimeout(() => {
      if (!stats.responses && location.pathname === "/home") {
        broken = true;
        paint();
      }
    }, 15000);
  }
})();

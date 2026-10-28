// End-to-end check of the extension on the X stand-in (dev/): filter before
// render, 72 h end of feed, read marking, reload, both switches, two copies.
// Run it with node test/run.mjs, which starts a browser and the stand-in.
// SHOTS=1 also saves the screenshots in docs/.
import { openPage, sleep } from "./cdp.mjs";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const VERSION = fs.readFileSync(path.join(root, "extension/src/page.js"), "utf8").match(/VERSION = "([^"]+)"/)[1];
const BASE = process.env.BASE || "http://127.0.0.1:3491";
const URL_ = BASE + "/home";
const SHOTS = !!process.env.SHOTS;
const page = await openPage("about:blank");
await page.viewport(1200, 900, 2);
await page.send("Page.bringToFront");
await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });

const results = [];
const check = (name, ok, info = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  " + info : ""}`);
};
const state = () =>
  page.eval(`JSON.stringify((() => {
    const M = window.__mock;
    const ids = [...document.querySelectorAll("article a[href*='/status/'] time")].map((t) => t.closest("a").getAttribute("href").split("/").pop());
    const ages = ids.map((id) => (Date.now() - (Number(BigInt(id) >> 22n) + 1288834974657)) / 3600e3);
    const host = document.querySelector("subfeed-switch");
    const ads = [...document.querySelectorAll(".ctx")].filter((c) => c.textContent === "Ad").length;
    const inModule = M.entries.filter((e) => e.content.items).flatMap((e) => e.content.items.map((i) => { const t = i.item.itemContent.tweet_results.result; return t.legacy.retweeted_status_result?.result?.tweet?.rest_id || t.rest_id; }));
    const reposted = M.entries.flatMap((e) => (e.content.itemContent ? [e.content.itemContent] : (e.content.items || []).map((i) => i.item.itemContent)))
      .map((ic) => ic?.tweet_results?.result?.legacy?.retweeted_status_result?.result?.tweet?.rest_id).filter(Boolean);
    const adIds = M.entries.filter((e) => e.entryId.startsWith("promoted")).map((e) => e.content.itemContent.tweet_results.result.rest_id);
    return { ids, ages, ads, inModule, reposted, adIds, requests: M.requests, atBottom: M.atBottom, inserted: M.inserted, removed: M.removed,
      card: host ? { checked: host.shadowRoot.querySelector("button").getAttribute("aria-checked"), sub: host.shadowRoot.querySelector(".sub").textContent,
        prev: host.previousElementSibling?.querySelector("form[role=search]") ? "search" : host.previousElementSibling?.previousElementSibling?.querySelector("form[role=search]") ? "search+spacer" : host.previousElementSibling?.tagName,
        next: host.nextElementSibling?.textContent.trim().slice(0, 12), y: Math.round(host.getBoundingClientRect().y) } : null,
      empty: document.querySelector('[data-testid="emptyState"]') ? { header: document.querySelector('[data-testid="empty_state_header_text"]').textContent, button: getComputedStyle(document.querySelector('[data-testid="empty_state_button_text"]')).display } : null,
      store: JSON.parse(localStorage.getItem("subfeed") || "null"), log: JSON.parse(localStorage.getItem("subfeed.log") || "null"), seen: JSON.parse(localStorage.getItem("subfeed.layout") || "null") };
  })())`).then(JSON.parse);
const dev = (path) => fetch(BASE + path).then((r) => r.json());
const setStore = (on, seen = {}, min = false) => page.eval(`localStorage.clear(); localStorage.setItem("subfeed", ${JSON.stringify(JSON.stringify({ on, min, seen }))}); 1`);
// The right column as drawn: X's blocks shown now, and any ever drawn in a frame.
const BLOCKS = `section, aside, nav, #news`;
// X's left menu: logo, items, Post, account button.
const MENU = `header[role=banner] :is(h1, nav a, nav button, [data-testid=SideNav_NewTweet_Button], [data-testid=SideNav_AccountSwitcher_Button])`;
const MENU_KEPT = "Home,Notifications,Post,Profile";
const sideState = () =>
  page.eval(`JSON.stringify((() => {
    const sc = document.querySelector('[data-testid="sidebarColumn"]');
    const host = document.querySelector("subfeed-switch");
    const shown = (el) => !!el && el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== "hidden";
    return { menuSeen: [...(window.__menuSeen || [])].sort().join(), menuNow: [...document.querySelectorAll("${MENU}")].filter(shown).map((el) => el.getAttribute("aria-label") || el.tagName).sort().join(),
      seen: [...(window.__sideSeen || [])], visible: [...sc.querySelectorAll("${BLOCKS}")].filter(shown).length,
      search: shown(sc.querySelector("form[role=search]")), card: shown(host), min: host?.shadowRoot.querySelectorAll("button")[1].getAttribute("aria-checked"),
      sub: host?.shadowRoot.querySelectorAll(".sub")[1].textContent, noReload: window.__noReload === 1, store: JSON.parse(localStorage.getItem("subfeed")) };
  })())`).then(JSON.parse);
const clickMin = () => page.eval(`window.__noReload = 1; document.querySelector("subfeed-switch").shadowRoot.querySelectorAll("button")[1].click(); 1`);
const load = async (ms = 1500) => {
  await page.goto(URL_ + (process.env.THEME ? "?theme=" + process.env.THEME : ""), ms);
};
const scrollToEnd = async (rounds = 30) => {
  for (let i = 0; i < rounds; i++) {
    await page.eval("window.scrollTo(0, document.body.scrollHeight); 1");
    await sleep(350);
  }
};

// 1. Off: X untouched.
await page.goto(URL_, 300);
await setStore(false);
await load();
let s = await state();
check("off: first page rendered untouched", s.ids.length === 20 && s.ads === 0, `posts=${s.ids.length} ads=${s.ads}`);
check("off: card says Off, under the search bar, above Today's News, after X reorders", s.card?.checked === "false" && s.card?.sub === "Off" && s.card?.prev === "search+spacer" && s.card?.next === "Today’s News", JSON.stringify(s.card));

// 2. On, nothing read: only the last 72 h, and the feed ends there.
await setStore(true);
await load();
await scrollToEnd();
s = await state();
// Reposts show the original's (older) id: their age is when they were reposted.
const organicAges = s.ages.filter((a, i) => !s.adIds.includes(s.ids[i]) && !s.reposted.includes(s.ids[i]));
check("on: nothing older than 72 h rendered (ads aside)", Math.max(...organicAges) < 72, `oldest=${Math.max(...organicAges).toFixed(1)} h, posts=${s.ids.length}`);
check("on: feed ended at 72 h (TerminateTimeline)", s.atBottom === true, `requests=${s.requests}`);
const reqAtEnd = s.requests;
await scrollToEnd(8);
s = await state();
check("on: no more requests after the end", s.requests === reqAtEnd, `requests ${reqAtEnd} -> ${s.requests}`);
check("on: ads untouched", s.ads >= 1, `ads=${s.ads}`);
check("on: card counts old posts", /older than 72 h/.test(s.card?.sub || ""), s.card?.sub);

// 3. Read some posts, reload: they're gone, and nothing was removed on screen.
await setStore(true);
await load();
for (let i = 0; i < 8; i++) {
  await page.eval("window.scrollBy(0, 420); 1");
  await sleep(1300);
}
await sleep(2600); // debounced save
s = await state();
const readIds = Object.keys(s.store?.seen || {});
check("reading marks posts", readIds.length >= 8, `read=${readIds.length}`);
await load();
s = await state();
const shownAgain = s.ids.filter((id) => readIds.includes(id));
// A conversation is kept whole while one of its posts is unread (context).
const shownAlone = shownAgain.filter((id) => !s.inModule.includes(id) && !s.adIds.includes(id));
console.log("shown again:", shownAgain.map((id) => `${id}${s.adIds.includes(id) ? " (ad)" : ""}${s.inModule.includes(id) ? " (conversation)" : ""}`).join(", "));
check("reload: read posts not shown again (outside half-read conversations)", shownAlone.length === 0, `shown again=${shownAgain.length} (ads or half-read conversations: ${shownAgain.length - shownAlone.length}), first page posts=${s.ids.length}`);
check("reload: no post inserted then removed (no flash)", s.removed === 0, `inserted=${s.inserted} removed=${s.removed}`);
check("reload: card counts read posts", /\d+ read/.test(s.card?.sub || ""), s.card?.sub);
console.log("log:", JSON.stringify(s.log?.recent?.slice(-3)));

// 3b. The first four pages are all read (what X showed: "Welcome to X!" and no
// posts). The extension fetches ahead before X draws: X gets unread posts at once.
const read80 = await dev("/__ids?upto=81");
const firstUnread = read80.pop();
await page.goto(URL_, 300);
await setStore(true, Object.fromEntries(read80.map((id) => [id, Date.now()])));
await dev("/__reset");
await load(2500);
s = await state();
let served = await dev("/__log");
const organic = s.ids.filter((id) => !s.adIds.includes(id));
check("all-read first pages: X draws unread posts, not its empty state", organic.length >= 10 && !s.empty, `posts=${organic.length} empty=${JSON.stringify(s.empty)}`);
check("all-read first pages: newest unread post first, no read post", organic[0] === firstUnread && !organic.some((id) => read80.includes(id)), `first=${organic[0] === firstUnread} read shown=${organic.filter((id) => read80.includes(id)).length}`);
check("all-read first pages: pages fetched ahead with X's request, X asked once", s.requests === 1 && served.slice(0, 5).join() === "0,1,2,3,4", `X requests=${s.requests} served=${served.join(",")}`);
check("all-read first pages: nothing drawn then removed", s.removed === 0, `inserted=${s.inserted} removed=${s.removed}`);
const firstRows = (s.log?.recent || []).filter((r) => r.cursor === "first");
check("all-read first pages: counted once, though X's monitor read it first", firstRows.length === 1 && s.card?.sub === `Hid ${firstRows[0].read} read`, `rows=${firstRows.length} sub=${s.card?.sub}`);
await scrollToEnd(6);
served = await dev("/__log");
check("all-read first pages: X's own paging continues after the fetched pages", s.requests >= 1 && new Set(served).size === served.length && served.length > 5, `served=${served.join(",")}`);
console.log("log:", JSON.stringify((await state()).log?.recent?.slice(-2)));

// 3c. Everything from the last 72 h read: X's empty state says so.
const all = await dev("/__ids?upto=400");
await setStore(true, Object.fromEntries(all.map((id) => [id, Date.now()])));
await dev("/__reset");
await load(5000);
s = await state();
served = await dev("/__log");
check("caught up: empty state relabeled, button hidden", s.empty?.header === "You’re all caught up" && s.empty?.button === "none", JSON.stringify(s.empty));
check("caught up: feed ended at 72 h, X asked once", s.atBottom === true && s.requests === 1, `atBottom=${s.atBottom} X requests=${s.requests} served=${served.length}`);
console.log("log:", JSON.stringify(s.log?.recent?.slice(-1)));

// 4. The switch: click turns it off and reloads into plain X.
await page.eval(`document.querySelector("subfeed-switch").shadowRoot.querySelector("button").click(); 1`);
await sleep(1800);
s = await state();
check("switch: off after click, page reloaded unfiltered", s.store?.on === false && s.card?.sub === "Off" && s.ids.some((id) => readIds.includes(id)), `on=${s.store?.on} sub=${s.card?.sub}`);
await page.eval(`document.querySelector("subfeed-switch").shadowRoot.querySelector("button").click(); 1`);
await sleep(1800);
s = await state();
check("switch: back on after click", s.store?.on === true && s.card?.checked === "true", `on=${s.store?.on} sub=${s.card?.sub}`);

// 5. Card screenshots in each X theme.
for (const theme of SHOTS ? ["", "dim", "dark"] : []) {
  await page.goto(URL_ + (theme ? "?theme=" + theme : ""), 1500);
  await page.eval("window.scrollTo(0, 0); 1");
  await sleep(300);
  const b = JSON.parse(await page.eval(`JSON.stringify(document.querySelector('[data-testid="sidebarColumn"]').getBoundingClientRect())`));
  await page.shot(path.join(root, "docs", `switches-${theme || "light"}.png`), { clip: { x: b.x - 16, y: 0, width: b.width + 32, height: 300, scale: 1 } });
}

// 6. Minimalist: the column keeps its search bar and the switches; X's blocks
// are never drawn, not for a single frame, even as they load and X reorders them.
await page.send("Page.addScriptToEvaluateOnNewDocument", {
  source: `window.__sideSeen = new Set();
    window.__menuSeen = new Set();
    (function frame() {
      const shown = (el) => el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== "hidden";
      const sc = document.querySelector('[data-testid="sidebarColumn"]');
      if (sc) for (const el of sc.querySelectorAll("${BLOCKS}")) if (shown(el)) window.__sideSeen.add(el.id || el.tagName);
      for (const el of document.querySelectorAll("${MENU}")) if (shown(el)) window.__menuSeen.add(el.getAttribute("aria-label") || el.tagName);
      requestAnimationFrame(frame);
    })();`,
});
await page.goto(URL_, 300);
await setStore(false);
await load(2500);
let side = await sideState();
check("control: with Minimalist off, the frame recorder sees X's blocks", side.seen.length >= 4 && side.visible >= 4, `drawn=${side.seen.join(",")}`);
check("control: with Minimalist off, the whole left menu is drawn", side.menuNow.split(",").length === 16 && side.menuSeen === side.menuNow, side.menuSeen);
await setStore(false, {}, true);
await load(2500);
side = await sideState();
check("minimalist: X's blocks never drawn while loading and after X reorders", side.seen.length === 0 && side.visible === 0, `drawn=${side.seen.join(",")} visible=${side.visible}`);
check("minimalist: search bar and switches shown", side.search && side.card && side.min === "true" && side.sub === "Hides news, trends and menu extras", JSON.stringify(side));
check("minimalist: left menu drew only Home, Notifications, Profile and Post, never the rest", side.menuSeen === MENU_KEPT && side.menuNow === MENU_KEPT, `drawn=${side.menuSeen}`);
check("minimalist: Never twice left off", side.store?.on === false && side.store?.min === true, JSON.stringify(side.store));
if (SHOTS) await page.shot(path.join(root, "docs", "minimalist.png"), { clip: { x: 0, y: 0, width: 1200, height: 520, scale: 1 } });
await clickMin();
await sleep(300);
side = await sideState();
check("minimalist off: blocks back at once, no reload", side.visible >= 4 && side.menuNow.split(",").length === 16 && side.noReload && side.min === "false" && side.store?.min === false, `visible=${side.visible} noReload=${side.noReload} min=${side.min}`);
await clickMin();
await sleep(300);
side = await sideState();
check("minimalist on: blocks hidden at once, no reload", side.visible === 0 && side.menuNow === MENU_KEPT && side.search && side.card && side.noReload && side.store?.min === true, `visible=${side.visible} noReload=${side.noReload}`);
await setStore(true, {}, true);
await load(2500);
side = await sideState();
s = await state();
check("minimalist + Never twice: both on, feed filtered, column hidden", s.card?.checked === "true" && side.min === "true" && side.seen.length === 0 && s.log?.min === true && s.log?.v === VERSION, `never=${s.card?.checked} min=${side.min} drawn=${side.seen.join(",")}`);
await sleep(2500);
s = await state();
check("log: the column's layout is recorded", /^search\/\d+ empty\/64 switches\/\d+ .*nav\[Footer\]\/0$/.test(s.seen?.column || ""), s.seen?.column);
check("log: the left menu is recorded", /^logo\/0 AppTabBar_Home_Link:keep\/[1-9]\d* AppTabBar_Explore_Link:hide\/0 .*AppTabBar_Profile_Link:keep\/[1-9]\d* AppTabBar_More_Menu:hide\/0 post\/[1-9]\d* account\/0$/.test(s.seen?.menu || ""), s.seen?.menu);

// 6b. Minimalist on Home: X's tab bar is never drawn, and Following is the
// timeline shown, whatever tab X remembers. X then remembers Following.
await page.send("Page.addScriptToEvaluateOnNewDocument", {
  source: `window.__tabsSeen = 0;
    window.__forYouSeen = 0;
    (function frame() {
      const list = document.querySelector("[role=tablist]");
      if (list && list.getBoundingClientRect().height > 0) window.__tabsSeen++;
      if (document.querySelector('[data-tab="for-you"] article')) window.__forYouSeen++;
      requestAnimationFrame(frame);
    })();`,
});
const tabState = () =>
  page.eval(`JSON.stringify({ tabsSeen: window.__tabsSeen, forYouSeen: window.__forYouSeen, ops: window.__mock.ops.join(","),
    open: [...document.querySelectorAll("[role=tab]")].findIndex((t) => t.getAttribute("aria-selected") === "true"),
    bar: Math.round(document.querySelector("[role=tablist]")?.getBoundingClientRect().height ?? -1),
    top: Math.round(document.querySelector(".head .top")?.getBoundingClientRect().height ?? -1),
    posts: document.querySelectorAll("[data-tab=following] article").length, remembered: localStorage.getItem("mock.tab"),
    noReload: window.__noReload === 1, log: JSON.parse(localStorage.getItem("subfeed.layout") || "null")?.tabs })`).then(JSON.parse);
const openHome = async (tab, min, query = "") => {
  await page.goto(URL_, 300);
  await setStore(false, {}, min);
  await page.eval(`localStorage.setItem("mock.tab", "${tab}"); 1`);
  await page.goto(URL_ + query, 2500);
  return tabState();
};
let t = await openHome("for-you", false);
check("tabs control: with Minimalist off, the tab bar is drawn and For you stays open", t.tabsSeen > 0 && t.bar > 0 && t.open === 0 && t.forYouSeen > 0 && t.ops === "HomeTimeline", JSON.stringify(t));
t = await openHome("for-you", true);
check("tabs: For you remembered, Minimalist opens Following before any post is drawn", t.open === 1 && t.forYouSeen === 0 && t.posts >= 10 && t.ops === "HomeTimeline,HomeLatestTimeline", `open=${t.open} forYouDrawn=${t.forYouSeen} posts=${t.posts} ops=${t.ops}`);
check("tabs: the tab bar is never drawn", t.tabsSeen === 0 && t.bar === 0, `frames=${t.tabsSeen} bar=${t.bar}`);
check("tabs: X now remembers Following", t.remembered === "following", t.remembered);
await page.goto(URL_, 2500);
t = await tabState();
check("tabs: next load asks X for Following only", t.ops === "HomeLatestTimeline" && t.open === 1 && t.tabsSeen === 0, `ops=${t.ops}`);
t = await openHome("list", true);
check("tabs: a pinned list remembered, Following opens", t.open === 1 && t.tabsSeen === 0 && t.remembered === "following", `open=${t.open} remembered=${t.remembered}`);
t = await openHome("for-you", true, "?narrow=1");
check("tabs, narrow window: X's top bar stays, only the tab row goes", t.top > 0 && t.bar === 0 && t.tabsSeen === 0 && t.open === 1, `top=${t.top} bar=${t.bar} open=${t.open}`);
t = await openHome("for-you", false);
await clickMin();
await sleep(600);
t = await tabState();
check("tabs: turning Minimalist on with For you open switches to Following, no reload", t.open === 1 && t.bar === 0 && t.noReload && t.posts >= 10, `open=${t.open} bar=${t.bar} noReload=${t.noReload}`);
await clickMin();
await sleep(300);
t = await tabState();
check("tabs: turning Minimalist off shows the tab bar again, on Following", t.bar > 0 && t.open === 1 && t.noReload, `bar=${t.bar} open=${t.open}`);
await openHome("following", true);
await sleep(2000);
t = await tabState();
check("log: Home's tabs are recorded", /^tabs\/3 open\/1 bar\/\d+\/0$/.test(t.log || ""), t.log);

// 7. Another copy already in the page: after the extension reloads, Chromium
// can keep injecting its previous copy into X tabs that were open, ahead of the
// new one. The tab must not freeze, filter twice or show two cards.
const OLD = fs.readFileSync(path.join(root, "test/fixtures/page-0.4.js"), "utf8"); // v0.4, as shipped
const withCopy = async (source, min) => {
  const { identifier } = await page.send("Page.addScriptToEvaluateOnNewDocument", {
    // Like a content script at document_start: once <html> exists.
    source: `(() => {
      const run = () => (0, eval)(${JSON.stringify(source)});
      if (document.documentElement) return run();
      const mo = new MutationObserver(() => document.documentElement && (mo.disconnect(), run()));
      mo.observe(document, { childList: true });
    })();`,
  });
  const readFirst = (await dev("/__ids?upto=6")).slice(0, 5);
  await page.goto(URL_, 300);
  await setStore(true, Object.fromEntries(readFirst.map((id) => [id, Date.now()])), min);
  await dev("/__reset");
  await page.goto(URL_, 3000);
  const out = await Promise.race([
    sideState().then(async (side) => ({ side, s: await state(), dup: JSON.parse((await page.eval(`localStorage.getItem("subfeed.dup")`)) || "null"), hosts: Number(await page.eval(`document.querySelectorAll("subfeed-switch").length`)) })),
    sleep(8000).then(() => null),
  ]);
  await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
  return out;
};
let two = await withCopy(OLD, true);
check("older copy first: the tab answers (no freeze)", !!two);
if (two) {
  const row = two.s.log?.recent?.find((r) => r.cursor === "first");
  check("older copy first: it runs alone, filters once, one card", two.s.log?.v === "0.4" && row?.read >= 5 && two.hosts === 1 && two.side.card, `log v=${two.s.log?.v} read=${row?.read} cards=${two.hosts}`);
  check("older copy first: this copy steps aside and says so", two.dup?.running === "older" && two.dup?.skipped === VERSION, JSON.stringify(two.dup));
  check("older copy first: the left menu is still trimmed", two.side.menuNow === MENU_KEPT, two.side.menuNow);
}
// An older copy this one can't recognise: the two cards must still settle.
two = await withCopy(OLD.replaceAll("rewritten(this, raw)", "rewritten(this,raw)"), true);
check("unrecognised copy first: the tab answers (no freeze)", !!two, two ? `cards=${two.hosts}` : "");
await page.goto("about:blank", 300);

const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);

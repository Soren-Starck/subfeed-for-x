// Minimal Chrome DevTools Protocol client (Node 22+, no dependencies) for the
// browser test/run.mjs starts. Works on one tab it opens.
import fs from "node:fs";

const PORT = process.env.CDP_PORT || 9222;

export async function browserWs() {
  const v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  return v.webSocketDebuggerUrl;
}

export class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        for (const l of this.listeners) l(msg);
      }
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", rej, { once: true });
    });
    return new Session(ws);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(fn) {
    this.listeners.push(fn);
  }
  close() {
    this.ws.close();
  }
}

// Page wrapper bound to one target via flattened sessions.
export class Page {
  constructor(browser, targetId, sessionId) {
    this.b = browser;
    this.targetId = targetId;
    this.sid = sessionId;
  }
  send(method, params) {
    return this.b.send(method, params, this.sid);
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800));
    return r.result.value;
  }
  async goto(url, waitMs = 4000) {
    await this.send("Page.navigate", { url });
    await sleep(waitMs);
  }
  async viewport(width, height, scale = 2, mobile = false) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: scale,
      mobile,
    });
  }
  async shot(file, opts = {}) {
    const r = await this.send("Page.captureScreenshot", { format: "png", ...opts });
    fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    return file;
  }
}

export async function openPage(url = "about:blank", { reuse } = {}) {
  const browser = await Session.connect(await browserWs());
  let targetId = reuse;
  if (!targetId) {
    const t = await browser.send("Target.createTarget", { url, background: true });
    targetId = t.targetId;
  }
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const page = new Page(browser, targetId, sessionId);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  return page;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

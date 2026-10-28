// Runs the end-to-end test: starts the X stand-in (dev/serve.py) and a headless
// Chrome or Chromium with a throwaway profile, runs test/e2e.mjs against them,
// then stops both. Needs Node 22+, Python 3 and Chrome (or set CHROME=/path).
// Usage: node test/run.mjs     HEADED=1 to watch it, SHOTS=1 to refresh docs/.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The version is written in two places; they must agree.
const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
const pageVersion = fs.readFileSync(path.join(root, "extension/src/page.js"), "utf8").match(/VERSION = "([^"]+)"/)?.[1];
if (manifest.version !== pageVersion) {
  console.error(`FAIL  version: manifest.json says ${manifest.version}, page.js says ${pageVersion}`);
  process.exit(1);
}

function chromePath() {
  const candidates = [
    process.env.CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error("No Chrome or Chromium found: set CHROME=/path/to/chrome");
  return found;
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

async function waitFor(fn, what, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

const children = [];
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "subfeed-test-"));
async function cleanup() {
  const exited = children.map((child) => child.exitCode !== null || new Promise((r) => child.once("exit", r)));
  for (const child of children) child.kill();
  await Promise.race([Promise.all(exited), sleep(5000)]);
  // Chrome's helpers can still be writing to the profile for a moment.
  for (let i = 0; i < 20 && fs.existsSync(profile); i++) {
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {
      await sleep(250);
    }
  }
}
process.on("SIGINT", () => cleanup().then(() => process.exit(130)));

let code = 1;
try {
  const devPort = await freePort();
  const python = process.platform === "win32" ? "python" : "python3";
  children.push(spawn(python, [path.join(root, "dev/serve.py"), String(devPort)], { stdio: "inherit" }));
  const base = `http://127.0.0.1:${devPort}`;
  await waitFor(() => fetch(base + "/__log").then((r) => r.ok), "the X stand-in");

  const args = [
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1200,900",
    ...(process.env.HEADED ? [] : ["--headless=new"]),
    ...(process.env.CI ? ["--no-sandbox"] : []),
    "about:blank",
  ];
  children.push(spawn(chromePath(), args, { stdio: "ignore" }));
  const portFile = path.join(profile, "DevToolsActivePort");
  const cdpPort = await waitFor(() => fs.existsSync(portFile) && fs.readFileSync(portFile, "utf8").split("\n")[0], "the browser");

  const test = spawn(process.execPath, [path.join(root, "test/e2e.mjs")], {
    stdio: "inherit",
    env: { ...process.env, CDP_PORT: cdpPort, BASE: base },
  });
  code = await new Promise((resolve) => test.on("exit", (c) => resolve(c ?? 1)));
} catch (e) {
  console.error(e.message);
} finally {
  await cleanup();
}
process.exit(code);

/* Loaded unpacked from a folder (a git clone, say), the extension picks up
   new files by itself: update.js asks on every X page load, and when the
   manifest on disk carries another version, the extension reloads. */
chrome.runtime.onMessage.addListener((message) => {
  if (message !== "update?") return;
  fetch(chrome.runtime.getURL("manifest.json"), { cache: "no-store" })
    .then((response) => response.json())
    .then((disk) => disk.version !== chrome.runtime.getManifest().version && chrome.runtime.reload())
    .catch(() => {});
});

/* Sync (optional): sync.js in each X tab sends the posts read there and gets the
   ones read elsewhere, through this worker, to the server named in sync.json
   next to manifest.json: {"url": "https://...", "token": "..."}. No sync.json,
   no sync: the tab is told so once and stops asking. */
let syncConfig;
const loadSync = () =>
  (syncConfig ??= fetch(chrome.runtime.getURL("sync.json"), { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((c) => (c && c.url && c.token ? c : null))
    .catch(() => null));

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (!message || !message.subfeedSync) return;
  loadSync()
    .then(async (config) => {
      if (!config) return reply({ ok: false, off: true });
      const response = await fetch(config.url.replace(/\/$/, "") + "/v1/x/seen", {
        method: "POST",
        headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
        body: JSON.stringify(message.subfeedSync),
      });
      if (!response.ok) return reply({ ok: false, status: response.status });
      reply({ ok: true, ...(await response.json()) });
    })
    .catch((e) => reply({ ok: false, error: String(e) }));
  return true; // answers later
});

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

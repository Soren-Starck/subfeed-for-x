// Runs on every X page load: is there a new version on disk? (see background.js)
chrome.runtime.sendMessage("update?").catch(() => {});

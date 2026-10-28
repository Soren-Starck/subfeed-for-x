# Contributing

Thanks for helping. Most changes here are small: X renamed something, and a selector or a GraphQL operation name needs updating. This page explains how to see the extension work without touching your real X account, and how to check a change.

## What's where

```
extension/          the extension itself: load this folder unpacked
  manifest.json
  src/page.js       everything that matters: the filter, Minimalist, the switches
  src/background.js reloads the extension when the files on disk change version
  src/update.js     asks background.js to check, on every X page load
dev/
  x-mock.html       a small stand-in for X's home page: same markup hooks
                    (data-testid), same XHR pattern, same timeline JSON shape
  serve.py          serves it, with a made-up timeline API spanning ~98 hours
test/
  run.mjs           starts the stand-in and a headless Chrome, runs e2e.mjs
  e2e.mjs           the checks
  fixtures/         an older page.js, to test two copies in one tab
docs/               screenshots and release notes (docs/releases/vX.Y.Z.md)
```

There is no build step and no dependency to install.

## Run it locally

You need Python 3, Node 22 or later, and Chrome or Chromium.

```sh
python3 dev/serve.py 3491
```

Then open <http://127.0.0.1:3491/home>. The stand-in loads `extension/src/page.js` directly, as the extension would at `document_start`, so you can edit the file and reload. Add `?theme=dim` or `?theme=dark` for X's other themes. The extension's state is in the page's local storage under `subfeed`; clear it to start over.

To try a change on the real X, load the `extension` folder unpacked (see the README) and reload x.com. Your own X account is then the test data, so be careful with anything that marks posts as read.

## Run the tests

```sh
node test/run.mjs
```

It starts the stand-in on a free port and a headless browser with a throwaway profile, runs 37 end-to-end checks and prints `ALL PASS` (or what failed). It takes about a minute. `HEADED=1` shows the browser, `CHROME=/path/to/chrome` picks the browser, and `SHOTS=1` also refreshes the screenshots in `docs/`.

The same run happens on every pull request.

## When X changes

X ships its web app often. The usual breakages:

- **Never twice stops filtering** (the switch says "Not filtering: X changed how it loads posts"). Check the timeline requests in DevTools' Network tab: the operation names (`HomeTimeline`, `HomeLatestTimeline`), the response shape (`data.home.home_timeline_urt.instructions`), or the way X reads the response (`XMLHttpRequest` and `responseText`) may have changed.
- **Minimalist misses a block or a menu item.** X renamed a `data-testid` or a link. The selectors are at the top of `page.js` (`KEEP`, `MENU` and the stylesheet under them).
- **The switches don't appear.** X changed its right column; see `spot()` in `page.js`.

`localStorage["subfeed.log"]` and `localStorage["subfeed.layout"]` on x.com show what the extension saw. Paste them into an issue; they hold no post text or user names.

When you fix one of these, update `dev/x-mock.html` (or `dev/serve.py`) to match what X does now, so the test covers it.

## What we're keeping

- **Two switches, nothing else.** No popup, no options page, no counters to manage. A change that adds interface needs an issue first, where we can agree it's worth it.
- **Nothing flashes.** Posts are removed before X draws them, and Minimalist hides blocks before they're painted. If a change makes something appear and then disappear, it's a bug.
- **Nothing leaves the browser.** No analytics, no remote requests of the extension's own, no new permissions.
- **Plain JavaScript.** No framework, no bundler, no dependencies.

## Pull requests

1. Fork, branch, change.
2. Run `node test/run.mjs` and make sure it ends with `ALL PASS`. Add a check to `test/e2e.mjs` for what you fixed or added.
3. Describe what changed and how you checked it on the real X, if you did.

Keep the comments in `page.js` in the same style: say why, in plain sentences.

## Releases

The maintainer bumps `version` in `extension/manifest.json` and `VERSION` in `extension/src/page.js` (the test checks they match), writes the notes in `docs/releases/v0.5.1.md`, and pushes the tag `v0.5.1`. A workflow tests, zips the `extension` folder and attaches it to a GitHub release.

## Ports

A Firefox port would need a `background.scripts` entry instead of the service worker, and a check that Firefox runs `world: "MAIN"` content scripts at `document_start` before X's own code. If you try it, open an issue to share what you find.

# SubFeed for X

A browser extension that adds two switches to X (Twitter) on the web.

- **Never twice** hides the posts you have already read, and anything older than 72 hours, from your Home timeline.
- **Minimalist** hides the news, trends, "who to follow" and the footer in the right column, every left-menu item except Home, Notifications, Profile and Post, and Home's tab bar, so Home always shows Following, newest first. It also takes ads and suggested posts and people out of every timeline, and Grok and Premium prompts out of the page.

![X with Minimalist on: three menu items, the Post button, the Following timeline with no tab bar, and the two switches under the search bar](docs/minimalist.png)

The switches sit at the top of X's right column, under the search bar. That's all the interface there is: no popup, no settings page, no account.

<p>
  <img src="docs/switches-light.png" width="380" alt="The switches in X's light theme">
  <img src="docs/switches-dark.png" width="380" alt="The switches in X's dark theme">
</p>

## Install

It works in any Chromium browser, version 111 or later: Chrome, Edge, Brave, Arc, Vivaldi, Opera, Helium. It is not in the Chrome Web Store, so you load it yourself. That takes about a minute.

1. Download `subfeed-for-x-<version>.zip` from the [latest release](https://github.com/Soren-Starck/subfeed-for-x/releases/latest) and unzip it.
2. Open `chrome://extensions` (in Edge, `edge://extensions`; in Brave, `brave://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and choose the unzipped `subfeed-for-x` folder.
5. Open or reload [x.com](https://x.com/home).

Keep the folder where it is: the browser runs the extension from it.

### Or from a clone, to update with `git pull`

```sh
git clone https://github.com/Soren-Starck/subfeed-for-x.git
```

Load the `extension` folder inside the clone (steps 2 to 4 above). To update, run `git pull`. The extension notices the new version the next time an X page loads, reloads itself, and the following X page load runs it.

Firefox and Safari are not supported yet. If you want to port it, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Use

**Never twice** is off at first. Turn it on and X reloads your timeline with only what you haven't seen:

- A post counts as read once it has been on your screen for about a second, anywhere on X. Reposts of a post you've read are hidden too.
- Read posts are dropped from X's timeline data before X draws anything, so nothing appears and then disappears, and the page doesn't jump.
- On **Following**, the timeline ends at 72 hours. On **For you**, posts older than 72 hours are dropped wherever they appear.
- If every page is already read, the extension fetches older pages before X draws the first one, so you don't get X's empty "Welcome to X!" page. When you have read everything from the last 72 hours, X says "You're all caught up".
- The switch's subtitle counts what it hid in this tab: "Hid 54 read · 7 older than 72 h".
- Conversations stay whole while any post in them is new to you. Ads are left alone (Minimalist removes them).

**Minimalist** applies at once, with no reload. With it on:

- Home has no tab bar (For you, Following, pinned lists, +) and always shows Following. If X had For you or a list open, Minimalist switches to Following before X draws a post, and X remembers that choice.
- Following stays sorted by **Recent**: if X had it on **Popular**, Minimalist asks X for the newest posts first. For you, if X ever loads it, comes back empty.
- Ads, "Who to follow", "Discover more" under a post, and X's other suggested posts, people and Premium prompts are removed from every timeline X loads (Home, a post's replies, profiles, search), before X draws them.
- Explore is only a search box: its tabs and what X picks for you there are hidden. Grok buttons on posts and Premium upgrade buttons are hidden everywhere.
- X's logo, the account button and the **More** menu are hidden too. Turn Minimalist off to switch accounts, open a pinned list or reach Settings, or go straight to [x.com/settings](https://x.com/settings).
- In a narrow window (X's phone layout), Home's tab row shows only Following, the bottom bar keeps Home, Search and Notifications, and the menu behind your picture loses Premium, Communities, Monetization and the like.

When the browser window is too narrow, X drops its right column, and the switches go with it. Widen the window to see them again.

### Sync (optional)

If you read X in more than one browser or on more than one computer, Never twice can share what you have read, so a post read in one place stays out of the others. This needs a small server of your own that every browser can reach; the extension never talks to anything else. It is off unless you set it up.

1. Run a server that answers `POST /v1/x/seen` (described below), behind a bearer token.
2. Put a `sync.json` file next to `manifest.json` in the extension folder:
   ```json
   { "url": "https://your-server.example", "token": "your-token" }
   ```
3. Reload the extension in `chrome://extensions`.

Every 30 seconds while an X tab is in front, and whenever you switch to or away from it, the extension sends the ids of posts read since its last call and gets back those read elsewhere. The server sees post ids and the time each was read, nothing else.

The call takes `{"since": <cursor>, "seen": {"<post id>": <ms epoch>, ...}}` and answers `{"seq": <new cursor>, "seen": {...}}` with the posts other places sent after `since` (the first call sends 0). Keep posts 14 days, as the extension does. `sync.json` is in `.gitignore`, so a clone keeps it out of git.

## Privacy

- The extension asks for no permissions and runs only on `x.com`.
- It sends nothing anywhere unless you set up [Sync](#sync-optional), and then only read post ids, to your own server. Otherwise it makes no requests of its own, except to repeat X's own timeline request one page further down, to your X session, when the pages so far were all read.
- What it remembers stays in your browser, in x.com's local storage:
  - `subfeed`: the two switches, and the ids of posts you read in the last 14 days (older ones are forgotten);
  - `subfeed.sync`: with Sync on, where this browser is in the server's list, and how many posts the last call sent and got;
  - `subfeed.log` and `subfeed.layout`: a short log of the last timeline responses and of what the switches hid, for bug reports. It holds counts and entry types, never what a post says or who wrote it.

To start over, remove those keys in DevTools (Application, Local storage, `https://x.com`).

## How it works

X's web app loads timelines with `XMLHttpRequest` and reads `responseText`. The extension runs in the page itself at `document_start` and wraps those reads for the `HomeTimeline` and `HomeLatestTimeline` GraphQL calls, removing read and old posts before X's code sees them. With Minimalist on, it also reads X's other GraphQL timelines and drops the entries X marks as ads or suggestions (`promoted-…`, `who-to-follow-…`, `tweetdetailrelatedtweets-…` and the like); a response with none of them is passed on untouched. Minimalist's look is one stylesheet, keyed to X's `data-testid` attributes and links, that the extension adds to the page before X draws it, plus one click on Home's Following tab when another tab is open.

All of it is in [`extension/src/page.js`](extension/src/page.js), about 950 commented lines with no dependencies and no build step. The optional sync is [`extension/src/sync.js`](extension/src/sync.js), which talks to the server through [`extension/src/background.js`](extension/src/background.js).

X changes its web app often. If it changes how timelines load, the switch's subtitle says "Not filtering: X changed how it loads posts". Please [open an issue](https://github.com/Soren-Starck/subfeed-for-x/issues/new/choose) when you see that, or when Minimalist misses something.

## Contributing

Bug reports, fixes and ports are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) explains how to run the extension against a local copy of X's page and run the tests, which take about a minute.

## License

[MIT](LICENSE). SubFeed for X is an independent project, not affiliated with or endorsed by X Corp.

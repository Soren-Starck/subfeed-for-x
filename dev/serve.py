# Dev server for the X stand-in: /home is dev/x-mock.html, /src/* the extension,
# and /i/api/graphql/<id>/HomeLatestTimeline answers like X's GraphQL, with a
# made-up feed whose posts span the last ~98 hours.
# Usage: python3 dev/serve.py 3491, then open http://127.0.0.1:3491/home
import http.server, json, os, random, sys, time, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
EXT = os.path.join(os.path.dirname(HERE), "extension")

AUTHORS = [
    ("Mara Lindqvist", "mara_lindqvist"), ("Theo Okafor", "theo_okafor_dev"), ("Juniper Labs", "juniperlabs_hq"),
    ("Ines Duarte", "ines_draws_things"), ("Kenji Watanabe", "kenji_w_builds"), ("Night Owl Weather", "nightowl_wx"),
    ("Priya Raman", "priya_ships"), ("The Daily Commit", "dailycommit_news"), ("Sam Feld", "samfeld_writes"),
    ("Lena Brooks", "lena_brooks_ux"), ("Oskar Nyberg", "oskar_nyberg"), ("Field Notes Radio", "fieldnotes_radio"),
]
TEXTS = [
    "Shipped the new onboarding today. Three screens instead of nine, and nobody asked where the other six went.",
    "Morning run along the river. 6 km, one heron, zero excuses.",
    "Reminder that a README with one working example beats ten pages of options.",
    "Rain until Thursday, then a clear and cold weekend. Bring a scarf.",
    "We rewrote the importer in a weekend. The tests caught four bugs before anyone else did.",
    "Hot take: the best feature this quarter was deleting a settings page.",
    "New sketch: the old bridge at dusk, ink and a little watercolor.",
    "If your build takes longer than your coffee, start there.",
    "Episode 42 is out: how small teams decide what not to build.",
    "Today I learned you can pause a CSS animation with one property. Huge.",
    "Our status page was green while the login button was not. Fixed both.",
    "Reading list for the weekend: two essays on attention and one on bread.",
    "Small thread on naming things, since it came up three times this week.",
    "Release notes are a love letter to the people who update. Write them well.",
    "Pair programming with a designer for an afternoon changed how I see spacing.",
    "Kept the first draft short. The second draft is shorter. Shipping the third.",
    "Wind gusts up to 60 km/h on the coast tonight. Secure the patio chairs.",
    "A bug report with a screenshot and steps is a gift. Thank you, whoever you are.",
]
rnd = random.Random(7)
# Two paragraphs each, so a page of 20 fills the screen like X's own.
FEED = [
    {"author": {"name": n, "handle": h, "avatar": ""}, "text": "\n\n".join(rnd.sample(TEXTS, 2))}
    for n, h in (rnd.choice(AUTHORS) for _ in range(452))
]
EPOCH = 1288834974657
STEP_MIN = 13  # minutes between posts: 452 posts span ~98 h, ~332 within 72 h
PAGE = 20
T0 = int(time.time() * 1000)


def snowflake(ms, seq):
    return str(((ms - EPOCH) << 22) | (seq & 0x3FFFFF))


def fmt(ms):
    return time.strftime("%a %b %d %H:%M:%S +0000 %Y", time.gmtime(ms / 1000))


def tweet(i, ms, item, sid=None):
    return {
        "__typename": "Tweet",
        "rest_id": sid or snowflake(ms, i),
        "core": {"user_results": {"result": {"__typename": "User", "legacy": {"screen_name": item["author"]["handle"], "name": item["author"]["name"]}, "avatar": {"image_url": item["author"].get("avatar", "")}}}},
        "legacy": {"created_at": fmt(ms), "full_text": item["text"][:280]},
    }


def item_content(i):
    item = FEED[i % len(FEED)]
    ms = T0 - i * STEP_MIN * 60000
    t = tweet(i, ms, item)
    if i % 9 == 4:  # a repost (now) of a post from 5 days earlier
        orig_ms = ms - 5 * 86400000
        t["legacy"]["retweeted_status_result"] = {"result": {"__typename": "TweetWithVisibilityResults", "tweet": tweet(i + 100000, orig_ms, item)}}
    return {"itemType": "TimelineTweet", "__typename": "TimelineTweet", "tweet_results": {"result": t}, "tweetDisplayType": "Tweet"}


def read_id(i):
    """The id the extension remembers for item i (the original, for a repost)."""
    ms = T0 - i * STEP_MIN * 60000
    if i % 9 == 4:
        return snowflake(ms - 5 * 86400000, i + 100000)
    return snowflake(ms, i)


def page(n):
    entries = []
    start = n * PAGE
    i = start
    while i < min(start + PAGE, len(FEED)):
        ic = item_content(i)
        rid = ic["tweet_results"]["result"]["rest_id"]
        if i % PAGE == 5 and i + 1 < len(FEED):  # a conversation: two posts in one module
            ic2 = item_content(i + 1)
            entries.append({"entryId": f"home-conversation-{rid}", "sortIndex": rid, "content": {"entryType": "TimelineTimelineModule", "__typename": "TimelineTimelineModule", "displayType": "VerticalConversation", "items": [{"entryId": f"home-conversation-{rid}-tweet-{rid}", "item": {"itemContent": ic2}}, {"entryId": f"home-conversation-{rid}-tweet-x", "item": {"itemContent": ic}}]}})
            i += 2
            continue
        entries.append({"entryId": f"tweet-{rid}", "sortIndex": rid, "content": {"entryType": "TimelineTimelineItem", "__typename": "TimelineTimelineItem", "itemContent": ic}})
        i += 1
    # an ad with an old post on every other page (none on the first, as on
    # X's Following): must stay, and must not end the feed
    if n % 2 == 1:
        ad = item_content(start + 7)
        ad["promotedMetadata"] = {"advertiser_results": {}}
        ad["tweet_results"]["result"]["rest_id"] = snowflake(T0 - 40 * 86400000, n)
        entries.insert(3, {"entryId": f"promoted-tweet-{n}-abc", "sortIndex": "x", "content": {"entryType": "TimelineTimelineItem", "itemContent": ad}})
    # X's suggestions: "Who to follow" on even pages, a Premium prompt on the first
    if n % 2 == 0:
        entries.insert(8, who_to_follow(f"who-to-follow-{n}"))
    if n == 0:
        entries.insert(2, {"entryId": "messageprompt-premium-plus-upsell-prompt", "sortIndex": "p", "content": {"entryType": "TimelineTimelineItem", "itemContent": {"itemType": "TimelineMessagePrompt", "content": {"headerText": "Get Premium"}}}})
    entries.append({"entryId": f"cursor-top-{n}", "sortIndex": "top", "content": {"entryType": "TimelineTimelineCursor", "value": "top", "cursorType": "Top"}})
    if start + PAGE < len(FEED):
        entries.append({"entryId": f"cursor-bottom-{n}", "sortIndex": "bottom", "content": {"entryType": "TimelineTimelineCursor", "value": f"p:{n + 1}", "cursorType": "Bottom"}})
    return {"data": {"home": {"home_timeline_urt": {"instructions": [{"type": "TimelineAddEntries", "entries": entries}], "metadata": {}}}}}


def who_to_follow(entry_id):
    users = [{"entryId": f"{entry_id}-user-{i}", "item": {"itemContent": {"itemType": "TimelineUser", "__typename": "TimelineUser", "user_results": {"result": {"__typename": "User", "legacy": {"name": f"Suggested {i}", "screen_name": f"suggested_{i}"}}}}}} for i in range(3)]
    return {"entryId": entry_id, "sortIndex": "w", "content": {"entryType": "TimelineTimelineModule", "__typename": "TimelineTimelineModule", "displayType": "Vertical", "header": {"text": "Who to follow"}, "items": users}}


def entry(i, prefix="tweet"):
    ic = item_content(i)
    return {"entryId": f"{prefix}-{ic['tweet_results']['result']['rest_id']}", "sortIndex": "s", "content": {"entryType": "TimelineTimelineItem", "itemContent": ic}}


def ad(i):
    e = entry(i, "promoted-tweet")
    e["content"]["itemContent"]["promotedMetadata"] = {"advertiser_results": {}}
    return e


def other(op):
    """Other X calls: a post's replies, a profile, and one that is no timeline."""
    cursor = {"entryId": "cursor-bottom-1", "sortIndex": "c", "content": {"entryType": "TimelineTimelineCursor", "value": "b", "cursorType": "Bottom"}}
    if op == "TweetDetail":
        thread = {"entryId": "conversationthread-1", "sortIndex": "t", "content": {"entryType": "TimelineTimelineModule", "items": [
            {"entryId": "conversationthread-1-tweet-1", "item": {"itemContent": item_content(1)}},
            {"entryId": "conversationthread-1-promoted-tweet-2", "item": {"itemContent": {**item_content(2), "promotedMetadata": {}}}},
        ]}}
        related = {"entryId": "tweetdetailrelatedtweets-1", "sortIndex": "r", "content": {"entryType": "TimelineTimelineModule", "header": {"text": "Discover more"}, "items": [
            {"entryId": "tweetdetailrelatedtweets-1-tweet-3", "item": {"itemContent": item_content(3)}}]}}
        ins = [{"type": "TimelineAddEntries", "entries": [entry(0), thread, ad(4), related, cursor]}]
        return {"data": {"threaded_conversation_with_injections_v2": {"instructions": ins}}}
    if op == "UserTweets":
        ins = [
            {"type": "TimelineClearCache"},
            {"type": "TimelineAddEntries", "entries": [entry(5), ad(6), who_to_follow("who-to-follow-9"), entry(7), cursor]},
            {"type": "TimelineAddToModule", "moduleEntryId": "profile-conversation-1", "moduleItems": [
                {"entryId": "profile-conversation-1-tweet-8", "item": {"itemContent": item_content(8)}},
                {"entryId": "profile-conversation-1-promoted-tweet-9", "item": {"itemContent": {**item_content(9), "promotedMetadata": {}}}}]},
        ]
        return {"data": {"user": {"result": {"__typename": "User", "timeline": {"timeline": {"instructions": ins}}}}}}
    return {"data": {"user": {"result": {"__typename": "User", "rest_id": "42", "legacy": {"name": "Mara Lindqvist", "screen_name": "mara_lindqvist"}}}}}


LOG = []
RANKED = []


class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = path.split("?")[0]
        if p == "/home" or p == "/explore":
            return os.path.join(HERE, "x-mock.html")
        return os.path.join(EXT, p.lstrip("/"))

    def timeline(self, v):
        # X refuses API calls without its transaction id header
        if not self.headers.get("x-client-transaction-id"):
            return self.json({"errors": [{"message": "no transaction id"}]}, 404)
        cursor = str(v.get("cursor") or "")
        n = int(cursor.split(":")[1]) if cursor.startswith("p:") else 0
        LOG.append(n)
        RANKED.append(v.get("enableRanking"))
        time.sleep(0.15)
        self.json(page(n))

    def json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        body = self.rfile.read(int(self.headers.get("content-length") or 0))
        if "/graphql/" in u.path and u.path.endswith(("HomeLatestTimeline", "HomeTimeline")):
            return self.timeline(json.loads(body or b"{}").get("variables") or {})
        self.send_error(404)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        if "/graphql/" in u.path and u.path.endswith(("HomeLatestTimeline", "HomeTimeline")):
            return self.timeline(json.loads(q.get("variables", ["{}"])[0]))
        if "/graphql/" in u.path:
            return self.json(other(u.path.rsplit("/", 1)[-1]))
        if u.path == "/__log":
            return self.json(LOG)
        if u.path == "/__ranked":
            return self.json(RANKED)
        if u.path == "/__ids":  # the ids of items 0..upto-1, as the extension stores them
            return self.json([read_id(i) for i in range(min(int(q.get("upto", ["0"])[0]), len(FEED)))])
        if u.path == "/__reset":
            LOG.clear()
            RANKED.clear()
            return self.json([])
        return super().do_GET()

    def log_message(self, *a):
        pass


class Server(http.server.ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        if not isinstance(sys.exc_info()[1], (BrokenPipeError, ConnectionResetError)):
            super().handle_error(request, client_address)  # a closed tab is not an error


Server(("127.0.0.1", int(sys.argv[1] if len(sys.argv) > 1 else 3491)), H).serve_forever()

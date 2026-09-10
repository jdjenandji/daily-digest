# Daily Digest

A one-page-per-side PDF briefing, generated on your Mac each morning: Berlin weather,
today's calendar, five headlines from each of six papers, world market indices, and
gold, oil and Bitcoin prices.

No API keys. No accounts. Every source is public.

## Quick start

```bash
npm install
npm run calendar:auth   # one-off: grants access to macOS Calendar
npm start               # http://127.0.0.1:4174
```

Click **Generate**. The PDF lands in `out/` and appears in the page.

To get one automatically every morning:

```bash
npm run agent:install
```

## Commands

| Command | What it does |
|---|---|
| `npm start` | Web UI with a Generate button, at `127.0.0.1:4174` |
| `npm run digest` | Generate once from the terminal and exit |
| `npm run doctor` | Health-check every source, Chrome, the calendar grant and the schedule |
| `npm run calendars` | List your calendar names, for the `include`/`exclude` config |
| `npm run calendar:auth` | Trigger the macOS calendar permission prompt |
| `npm run agent:install` | Schedule a daily run via launchd |
| `npm run agent:uninstall` | Remove the schedule |

## Sources

| Section | Source |
|---|---|
| Weather | Open-Meteo |
| Calendar | macOS Calendar, via a small Swift EventKit helper |
| News | WSJ, FT, NYTimes, Reuters, Bild, Le Monde |
| Markets | CNBC, with Yahoo Finance as a per-instrument fallback |

Two of these needed more than the obvious endpoint:

- **WSJ** moved feed hosts. The widely documented `feeds.a.dj.com` URL still returns
  HTTP 200 with valid XML, but the content has been frozen since January 2025. The live
  feed is on `feeds.content.dowjones.io`.
- **Reuters** retired every public RSS feed and returns 401 to non-browser clients. The
  digest reads their Google News sitemap instead, which is the freshest source of the
  six. It carries no standfirst, so Reuters runs as headlines only.

## How it behaves when something breaks

The PDF is always produced. There is no all-or-nothing path.

- A source that fails renders as a labelled gap, and the other sections are untouched.
- A source that succeeds but returns old data is graded **stale** and prints its age in
  red. This matters more than error handling: a frozen feed returns a perfectly healthy
  HTTP 200, so age is the only real check.
- Weather, markets and news fall back to a cached copy when the upstream is down, and
  anything served from cache is stamped with when it was fetched.
- The calendar never falls back to a previous day. Yesterday's meetings are worse than
  nothing.
- A status strip along the footer reports every source as ok, stale, cached or failed.

`npm run doctor` reports the same picture on demand, plus Chrome, the calendar
permission, and whether the scheduled job has actually been running.

## Configuration

Edit `config.json`, created from `config.example.json` on first run. It holds the
location and time zone, calendar include/exclude lists, the six feed URLs, the market
instruments, per-source timeouts, cache windows, and the schedule time.

Feeds and market instruments live in config on purpose: they are the things most likely
to break, and both should be fixable by editing JSON rather than code.

To limit which calendars appear:

```bash
npm run calendars       # see the names
```

then set `calendar.include` to a list of them, or leave it `null` for all and use
`calendar.exclude` to drop the noisy ones.

## Calendar permissions

macOS ties a privacy grant to the helper binary's code signature, and it attributes the
grant to whichever process asked. Two consequences:

- **Recompiling the helper revokes access.** The build script only rebuilds when the
  Swift source actually changes, and there is deliberately no `postinstall` hook.
- **Terminal and the scheduled job hold separate grants.** `npm run calendar:auth`
  grants the terminal. For the scheduled job, run it once by hand while logged in:

  ```bash
  launchctl kickstart -k gui/$UID/com.jd.daily-digest
  ```

The scheduled job always runs with `--no-prompt`, so a 06:30 run can never raise a
dialog on a machine nobody is sitting at. Without the grant it prints a visible notice
in the calendar section rather than an empty block that reads as "no meetings today".

## Layout notes

A4, two pages. Page one is the masthead, a weather strip, then calendar and markets side
by side. Page two is the six papers in two balanced columns.

Overflow is defended in three layers: headlines are truncated in the data layer on a
word boundary so layout never depends on font metrics, then line-clamped in CSS, then a
post-render fit check shrinks the page once if it still spills, floored at 0.85 rather
than shipping unreadable type.

The page loads zero network assets. System fonts only, and weather icons are inline SVG.
An asset load race is the most common cause of a blank PDF.

## Requirements

macOS with Xcode command line tools for the Swift helper, Node 20 or newer, and a Chrome
installation. Chrome is found automatically, preferring a pinned build in the puppeteer
cache over system Chrome, since system Chrome auto-updates and can shift print metrics.

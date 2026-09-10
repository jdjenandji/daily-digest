# Daily Digest

A plain-text PDF briefing, generated on your Mac each morning: Berlin weather,
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
| `npm run calendar:auth` | Grant calendar access, once, for every context |
| `npm run agent:install` | Schedule a daily run via launchd |
| `npm run agent:uninstall` | Remove the schedule |

## Sources

| Section | Source |
|---|---|
| Weather | Open-Meteo |
| Calendar | macOS Calendar, via a small Swift EventKit helper app |
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

Grant it once:

```bash
npm run calendar:auth
```

That covers everything: this terminal, any editor or agent, and the scheduled daily
run. Verify with `npm run doctor`.

**Why it is built the way it is.** macOS attributes a privacy grant to the *responsible
process*, not to whatever binary does the asking. A helper executed straight from a
shell is attributed to the app that owns that shell, which has three consequences: the
grant has to be repeated for every terminal, editor or agent you run it from; a host app
with no calendar usage string in its `Info.plist` cannot raise the dialog at all, so the
request returns `denied` instantly while the status stays `notDetermined`; and the
scheduled job, which has no owning app, is a fourth identity again.

A loose command-line binary is also a poor TCC subject in its own right. It does not
appear in the Privacy pane and cannot prompt.

So the helper is built as a real `.app` bundle and launched through LaunchServices
rather than executed directly. Launched as an app it is its own responsible process, so
one grant holds from anywhere. LaunchServices gives the caller no pipe, so the helper
writes its JSON to a file that the Node side polls for.

Two things follow from this that are worth knowing:

- **Recompiling revokes the grant.** macOS keys it to the bundle's code signature, so a
  rebuild is a new identity. The build script only rebuilds when the Swift source or the
  plist actually changes, and there is deliberately no `postinstall` hook. After a real
  source change, run `npm run calendar:auth` again.
- **The daily job never prompts.** It always passes `--no-prompt`, so it cannot raise a
  dialog on a machine nobody is sitting at. It relies on the grant already being in
  place.

If the dialog does not appear, enable "Daily Digest Calendar" in System Settings ›
Privacy & Security › Calendars.

Without a grant the digest still generates. The calendar block prints a visible notice
rather than an empty section that would read as "no meetings today".

## Layout notes

A4, Courier, plain text in a single column. Every device that normally marks rank has
been removed:

- **One type size.** Exactly one `font-size` declaration in the stylesheet, on `body`,
  reading a single `--fs` variable. Nothing overrides it.
- **One weight.** No bold anywhere, including on tags the browser bolds by default.
- **No headings.** Section labels are ordinary lines of text in ordinary case.
- **No rules, boxes or graphics.** No borders, no tints, no icons.
- **One column.** Nothing sits side by side; the document flows continuously across as
  many pages as it needs.

What is left to carry structure is indentation and blank space. Each section label sits
flush left and its content is indented three characters under it, papers indent again
under their name. Grey pushes supporting text back: standfirsts, labels, timestamps.
Colour appears in only two places, on the sign of a market change and on a warning.

That last point is load-bearing. With no bold left, a frozen feed is flagged by colour
alone, so the stale marker and the footer status letters have to carry it: `+` for a
live source, `~` cached, `!` stale, `x` failed.

Removing the fixed two-page layout removed a mechanism with it. The renderer used to run
a post-render fit check that scaled the page down when content overran. A single
continuous column is paginated by the browser, so there is nothing to shrink to fit and
that scale-down would only make a longer digest unreadable. The renderer measures the
flow and reports a page count instead.

Order is weather, today's calendar, the papers, then markets last.

At 10.8pt a normal day runs about 640mm of copy, so three pages: the papers fill the
first two and markets closes the third. Dropping the one size variable brings that back
down, and around 8.8pt it lands on two pages. Nothing else needs touching to change it,
which is the point of having a single size.

Headlines are truncated in the data layer on a word boundary, so layout never depends on
font metrics, then clamped to two lines with standfirsts clamped to one. At full column
width most headlines fit on a single line.

The page loads zero network assets. Courier New ships with macOS.

## Requirements

macOS with Xcode command line tools for the Swift helper, Node 20 or newer, and a Chrome
installation. Chrome is found automatically, preferring a pinned build in the puppeteer
cache over system Chrome, since system Chrome auto-updates and can shift print metrics.

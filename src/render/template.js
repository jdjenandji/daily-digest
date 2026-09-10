import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { icon } from './icons.js';
import { esc, price, pct, num, timeIn, longDate, relAge } from '../lib/fmt.js';

const CSS = () => readFile(path.resolve(process.cwd(), 'src/render/styles.css'), 'utf8');

/** The template sees only the normalized model. It knows nothing about CNBC or RSS. */
export async function renderHtml(model) {
  const css = await CSS();
  const tz = model.timezone;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Daily Digest — ${esc(model.ymd)}</title>
<style>${css}</style>
</head><body>
<div class="sheet">
${masthead(model, tz)}
${weatherBand(model, tz)}
<div class="band">
  <section class="section">
    <h2>Today</h2>
    ${calendarList(model, tz)}
  </section>
  <section class="section">
    <h2>Markets</h2>
    ${marketsTable(model, tz)}
  </section>
</div>
</div>
<div class="sheet page-break">
<section class="section">
  <h2>The Papers</h2>
  <div class="papers">${model.news.map(paper).join('\n')}</div>
</section>
${footer(model, tz)}
</div>
</body></html>`;
}

/* ------------------------------- masthead -------------------------------- */

function masthead(model, tz) {
  const date = longDate(new Date(model.generatedAt), tz);
  return `<header class="masthead">
  <h1>Daily Digest</h1>
  <div class="meta">
    <strong>${esc(date)}</strong><br>
    ${esc(model.location.label)} · generated ${esc(timeIn(model.generatedAt, tz))}
  </div>
</header>`;
}

/* -------------------------------- weather -------------------------------- */

function weatherBand(model, tz) {
  const r = model.weather;
  if (!r?.ok) {
    return section('Weather', `<p class="note">Weather unavailable: ${esc(r?.error ?? 'unknown error')}</p>`);
  }
  const { now, today, slots } = r.data;
  const facts = [
    ['High / Low', `${num(today.max, 0)}° / ${num(today.min, 0)}°`],
    ['Rain', today.precipChance == null ? '—' : `${num(today.precipChance, 0)}%`],
    ['Wind', `${num(now.wind, 0)} km/h`],
    ['Humidity', now.humidity == null ? '—' : `${num(now.humidity, 0)}%`],
    ...slots.map((s) => [`${String(s.hour).padStart(2, '0')}:00`, `${num(s.temp, 0)}°`]),
    ['Sun', `${timeIn(today.sunrise, tz)}–${timeIn(today.sunset, tz)}`],
  ];
  const cached = r.fromCache ? ` <span class="missing">as of ${esc(timeIn(r.fetchedAt, tz))}</span>` : '';

  return section(`Weather · ${esc(model.location.label)}${cached}`, `<div class="weather">
  <div class="headline-temp">
    ${icon(now.icon)}
    <div>
      <div class="temp">${num(now.temp, 0)}°</div>
      <div class="cond">${esc(now.label)}</div>
      <div class="feels">feels like ${num(now.feels, 0)}° · ${esc(today.label)} later</div>
    </div>
  </div>
  <dl class="facts">
    ${facts.map(([k, v]) => `<div class="fact"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}
  </dl>
</div>`);
}

/* -------------------------------- calendar ------------------------------- */

function calendarList(model, tz) {
  const r = model.calendar;
  if (!r?.ok) return `<p class="note">Calendar unavailable.</p>`;
  const { events, allDay, notice } = r.data;
  if (notice) return `<p class="note">${esc(notice)}</p>`;
  if (!events.length && !allDay.length) return `<p class="empty">No events scheduled.</p>`;

  const row = (e, isAllDay) => `<div class="event${isAllDay ? ' all-day' : ''}">
  <div class="when">${isAllDay ? 'all day'
    : `${esc(timeIn(e.start, tz))}<span class="to">${esc(timeIn(e.end, tz))}</span>`}</div>
  <div>
    <div class="what">${esc(e.title)}</div>
    ${e.location ? `<div class="where">${esc(e.location)}</div>` : ''}
  </div>
</div>`;

  return allDay.map((e) => row(e, true)).join('') + events.map((e) => row(e, false)).join('');
}

/* -------------------------------- markets -------------------------------- */

function marketsTable(model, tz) {
  const r = model.markets;
  if (!r?.ok) return `<p class="note">Market data unavailable: ${esc(r?.error ?? 'unknown error')}</p>`;
  const d = r.data;

  const rows = (g) => g.rows.map((q) => {
    if (q.price == null) {
      return `<tr><td class="name">${esc(q.name)}</td><td class="last missing" colspan="2">unavailable</td></tr>`;
    }
    const dir = q.changePct == null ? 'flat' : q.changePct > 0 ? 'up' : q.changePct < 0 ? 'down' : 'flat';
    const stamp = q.fromCache ? ' *' : '';
    return `<tr>
      <td class="name">${esc(q.name)}${stamp}</td>
      <td class="last">${esc(q.digits ? num(q.price, q.digits) : price(q.price))}</td>
      <td class="chg ${dir}">${esc(pct(q.changePct))}</td>
    </tr>`;
  }).join('');

  const asOf = d.asOf ? `as of ${esc(timeIn(d.asOf, tz))}` : '';
  const note = d.degraded ? ` · ${d.live}/${d.total} live` : '';

  return d.groups.map((g) => `<div class="market-group">
  <h3>${esc(g.label)}</h3>
  <table class="quotes"><tbody>${rows(g)}</tbody></table>
</div>`).join('')
    + `<div class="market-group"><h3>${esc(d.provider)} ${asOf}${note}</h3></div>`;
}

/* --------------------------------- news ---------------------------------- */

function paper(r) {
  const name = r.name ?? r.data?.name ?? r.id.replace('news_', '');

  if (!r.ok) {
    return `<article class="paper"><h3>${esc(name)}</h3>
      <p class="note">Feed unavailable.</p></article>`;
  }
  const d = r.data;
  const age = d.newest ? relAge(Date.now() - d.newest) : '';

  // A frozen feed that still returns HTTP 200 must be visibly flagged, not printed
  // as if it were today's news.
  const staleClass = d.stale ? ' is-stale' : '';
  const label = d.stale ? `stale · ${age}` : age;

  const stories = d.items.map((i) => `<div class="story${d.hasStandfirst ? '' : ' wide'}">
    ${i.kicker ? `<span class="kicker">${esc(i.kicker)}</span>` : ''}
    <p class="head">${esc(i.headline)}</p>
    ${i.standfirst ? `<p class="stand">${esc(i.standfirst)}</p>` : ''}
  </div>`).join('');

  return `<article class="paper${staleClass}">
  <h3><span>${esc(name)}</span><span class="age">${esc(label)}</span></h3>
  ${stories}
</article>`;
}

/* -------------------------------- footer --------------------------------- */

function footer(model, tz) {
  const chips = model.statuses.map((s) =>
    `<span class="chip ${s.state}">${esc(s.label)}</span>`).join('');
  return `<div class="footer">
  <div class="chips">${chips}</div>
  <div>Generated ${esc(timeIn(model.generatedAt, tz))} in ${(model.tookMs / 1000).toFixed(1)}s</div>
</div>`;
}

const section = (title, body) => `<section class="section"><h2>${title}</h2>${body}</section>`;

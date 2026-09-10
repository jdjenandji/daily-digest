import { readFile } from 'node:fs/promises';
import path from 'node:path';
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
<section class="section">
  <h2>Today</h2>
  ${calendarList(model, tz)}
</section>
<section class="section">
  <h2>Weather · ${esc(model.location.label)}</h2>
  ${weatherBody(model, tz)}
</section>
<section class="section">
  <h2>Markets</h2>
  ${marketsTable(model, tz)}
</section>
${imageSection(model)}
<section class="section papers-page">
  <h2>The Papers</h2>
  <div class="papers">${model.news.map(paper).join('\n')}</div>
</section>
${poemSection(model)}
${footer(model, tz)}
</div>
</body></html>`;
}

/* ------------------------------- masthead -------------------------------- */

function masthead(model, tz) {
  // One plain line. With no heading styling left, a stacked masthead would just be
  // two undifferentiated lines of text.
  const parts = [
    'Daily Digest',
    longDate(new Date(model.generatedAt), tz),
    model.location.label,
    `generated ${timeIn(model.generatedAt, tz)}`,
  ];
  return `<header class="masthead">${esc(parts.join(' \u00b7 '))}</header>`;
}

/* -------------------------------- weather -------------------------------- */

function weatherBody(model, tz) {
  const r = model.weather;
  if (!r?.ok) {
    return `<p class="note">Weather unavailable: ${esc(r?.error ?? 'unknown error')}</p>`;
  }
  const { now, today, slots } = r.data;
  // Two fixed rows rather than one flowing list. As a single row these eight readings
  // wrapped wherever the width ran out, which stranded the first hourly reading at the
  // end of the conditions line. Splitting them puts the break where it belongs.
  const conditions = [
    ['Hi/Lo', `${num(today.max, 0)}°/${num(today.min, 0)}°`],
    ['Rain', today.precipChance == null ? '—' : `${num(today.precipChance, 0)}%`],
    ['Wind', `${num(now.wind, 0)}km/h`],
    ['Hum', now.humidity == null ? '—' : `${num(now.humidity, 0)}%`],
    ['Sun', `${timeIn(today.sunrise, tz)}–${timeIn(today.sunset, tz)}`],
  ];
  const hourly = slots.map((s) => [`${String(s.hour).padStart(2, '0')}h`, `${num(s.temp, 0)}°`]);

  const row = (facts) => (facts.length
    ? `<dl class="facts">${facts.map((f) =>
        `<div class="fact"><dt>${esc(f[0])}</dt><dd>${esc(f[1])}</dd></div>`).join('')}</dl>`
    : '');
  return `<div class="weather">
  <div class="headline-temp">
    <div>
      <div class="temp">${num(now.temp, 0)}°</div>
      <div class="cond">${esc(now.label)}</div>
      <div class="feels">feels like ${num(now.feels, 0)}° · ${esc(today.label)} later</div>
    </div>
  </div>
  ${row(conditions)}
  ${row(hourly)}
</div>`;
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
    + `<div class="market-group provider"><h3>${esc(d.provider)} ${asOf}${note}</h3></div>`;
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

  const stories = d.items.map((i) =>
    `<div class="story"><p class="head">${esc(i.headline)}</p></div>`).join('');

  return `<article class="paper${staleClass}">
  <h3><span>${esc(name)}</span><span class="age">${esc(label)}</span></h3>
  ${stories}
</article>`;
}

/* --------------------------------- image --------------------------------- */

function imageSection(model) {
  const r = model.image;
  if (!r || (r.ok && !r.data)) return '';
  if (!r.ok) {
    return `<section class="section"><h2>Image</h2>
      <p class="note">Image unavailable: ${esc(r.error ?? 'unknown error')}</p></section>`;
  }
  const d = r.data;
  const credit = [d.channel, d.owner].filter(Boolean).join(' · ');
  // The cap lives in config and is applied here, not in the stylesheet, so the one
  // number that decides whether page one still fits is actually the one you can edit.
  const cap = model.imageMaxHeightMm ?? 70;
  return `<section class="section image">
  <h2>Image</h2>
  <img style="max-height:${cap}mm" src="${d.dataUri}" alt="${esc(d.title || 'image of the day')}">
  <p class="credit">${esc(credit)}</p>
</section>`;
}

/* --------------------------------- poem ---------------------------------- */

function poemSection(model) {
  const r = model.poem;
  if (!r || (r.ok && !r.data)) return '';
  if (!r.ok) {
    return `<section class="section"><h2>Poem</h2>
      <p class="note">Poem unavailable: ${esc(r.error ?? 'unknown error')}</p></section>`;
  }
  const d = r.data;
  // Each line is its own element: a poem's line breaks are part of the poem, so they
  // must not be reflowed. Blank lines are stanza breaks and are kept as spacing.
  const lines = d.lines.map((l) => (l.trim()
    ? `<div class="line">${esc(l)}</div>`
    : '<div class="line blank"></div>')).join('');

  // Attributed because Wikipedia's text is CC BY-SA, and because a reader should be
  // able to see where a claim about the poet came from.
  const bio = d.bio
    ? `<p class="bio">${esc(d.bio.text)} <span class="cite">${esc(d.bio.source)}</span></p>`
    : '';

  return `<section class="section poem">
  <h2>Poem</h2>
  <p class="attrib">${esc(d.title)} · ${esc(d.author)}</p>
  ${bio}
  <div class="verse">${lines}</div>
</section>`;
}

/* -------------------------------- footer --------------------------------- */

function footer(model, tz) {
  // Joined with a real space so the line can break between entries rather than
  // through the middle of a paper's name.
  const chips = model.statuses.map((s) =>
    `<span class="chip ${s.state}">${esc(s.label)}</span>`).join(' ');
  return `<div class="footer">
  <div class="chips">${chips}</div>
  <div>Generated ${esc(timeIn(model.generatedAt, tz))} in ${(model.tookMs / 1000).toFixed(1)}s</div>
</div>`;
}


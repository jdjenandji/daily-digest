import { readFile } from 'node:fs/promises';
import path from 'node:path';
import figlet from 'figlet';
import { esc, price, pct, num, timeIn } from '../lib/fmt.js';

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
${marketsSections(model, tz)}
${predictionsSection(model)}
<section class="section papers-page">
  <h2>The Papers</h2>
  <div class="papers">${onPage(model, 'papers').map((r) => paper(r, tz)).join('\n')}</div>
</section>
${announcementsSection(model)}
${poemSection(model)}
${memeImage(model)}
${footer(model, tz)}
</div>
</body></html>`;
}

/* ------------------------------- masthead -------------------------------- */

function masthead(model, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, month: 'long', day: 'numeric', year: 'numeric',
  }).formatToParts(new Date(model.generatedAt));
  const value = (type) => parts.find((part) => part.type === type)?.value ?? '';
  const banner = (title) => {
    const lines = figlet.textSync(title, {
      font: 'Big Money-nw',
      width: 1000,
      whitespaceBreak: false,
    }).split('\n');

    // FIGlet pads this font with blank rows. Remove only those rows, preserving the
    // spaces that make up the banner itself.
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines.at(-1).trim()) lines.pop();
    return {
      title,
      art: lines.join('\n'),
      columns: Math.max(...lines.map((line) => line.length)),
    };
  };

  const month = value('month').toUpperCase();
  const suffix = `${value('day')} ${value('year')}`;
  let heading = banner(`${month} ${suffix}`);
  if (heading.columns > 79 && month === 'SEPTEMBER') heading = banner(`SEPT ${suffix}`);
  const scale = Math.min(1, 78 / heading.columns);

  return `<header class="masthead" aria-label="${esc(heading.title)}">
  <pre class="ascii-title" style="--ascii-scale:${scale.toFixed(4)}">${esc(heading.art)}</pre>
</header>`;
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

function marketsSections(model, tz) {
  const r = model.markets;
  if (!r?.ok) return `<section class="section"><h2>Markets</h2>
    <p class="note">Market data unavailable: ${esc(r?.error ?? 'unknown error')}</p></section>`;
  const d = r.data;

  const rows = (quotes) => quotes.map((q) => {
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

  const group = (g, showLabel = true) => {
    if (g.columns === 2) {
      const middle = Math.ceil(g.rows.length / 2);
      const columns = [g.rows.slice(0, middle), g.rows.slice(middle)];
      return `<div class="market-group two-column">
  ${showLabel ? `<h3>${esc(g.label)}</h3>` : ''}
  <div class="quote-columns">${columns.map((column) =>
    `<table class="quotes"><tbody>${rows(column)}</tbody></table>`).join('')}</div>
</div>`;
    }
    return `<div class="market-group">
  <h3>${esc(g.label)}</h3>
  <table class="quotes"><tbody>${rows(g.rows)}</tbody></table>
</div>`;
  };

  const asOf = d.asOf ? `as of ${esc(timeIn(d.asOf, tz))}` : '';
  const note = d.degraded ? ` · ${d.live}/${d.total} live` : '';
  const stockGroups = d.groups.filter((g) => g.columns === 2);
  const marketGroups = d.groups.filter((g) => g.columns !== 2);
  const stocks = stockGroups.length ? `<section class="section stocks-section">
  <h2>Stocks</h2>
  ${stockGroups.map((g) => group(g, false)).join('')}
</section>` : '';

  return `${stocks}<section class="section">
  <h2>Markets</h2>
  ${marketGroups.map(group).join('')}
  <div class="market-group provider"><h3>${esc(d.provider)} ${asOf}${note}</h3></div>
</section>`;
}

function predictionsSection(model) {
  const r = model.predictions;
  if (!r || (r.ok && !r.data)) return '';
  if (!r.ok) {
    return `<section class="section predictions"><h2>Predictions</h2>
      <p class="note">Polymarket unavailable: ${esc(r.error ?? 'unknown error')}</p></section>`;
  }
  const d = r.data;
  const rows = d.items.map((item) => `<div class="prediction">
    <div class="probability">${esc(predictionPct(item.probability))}</div>
    <div>${esc(item.question)}</div>
  </div>`).join('');
  return `<section class="section predictions">
  <h2>Predictions</h2>
  <div class="prediction-grid">${rows}</div>
</section>`;
}

function predictionPct(probability) {
  const pct = probability * 100;
  if (pct > 0 && pct < 1) return '<1%';
  if (pct > 99 && pct < 100) return '>99%';
  return `${num(pct, 0)}%`;
}

/* --------------------------------- news ---------------------------------- */

function paper(r, tz) {
  const name = r.name ?? r.data?.name ?? r.id.replace('news_', '');

  if (!r.ok) {
    return `<article class="paper"><h3>${esc(name)}</h3>
      <p class="note">Feed unavailable.</p></article>`;
  }
  const d = r.data;
  const asOf = d.newest ? `as of ${timeIn(d.newest, tz)}` : '';

  // A frozen feed that still returns HTTP 200 must be visibly flagged, not printed
  // as if it were today's news.
  const staleClass = d.stale ? ' is-stale' : '';
  const label = d.stale ? `stale · ${asOf}` : asOf;

  const stories = d.items.map((i) =>
    `<div class="story"><p class="head">${esc(i.headline)}</p></div>`).join('');

  return `<article class="paper${staleClass}">
  <h3><span>${esc(name)}</span><span class="stamp">${esc(label)}</span></h3>
  ${stories}
</article>`;
}

/* ----------------------------- announcements ----------------------------- */

function announcementsSection(model) {
  const r = model.announcements;
  const artNews = onPage(model, 'art');
  if ((!r || (r.ok && !r.data)) && !artNews.length) return '';
  const label = model.announcementsLabel ?? 'Announcements';

  let announcements = '';
  if (r && !r.ok) {
    announcements = `<h2>${esc(label)}</h2>
      <p class="note">Announcements unavailable: ${esc(r.error ?? 'unknown error')}</p>`;
  } else if (r?.data) {
    const d = r.data;
    // Venue in grey ahead of the title, so the eye can still scan the exhibitions.
    const rows = d.items.map((i) => `<p class="ann">${
      i.venue ? `<span class="venue">${esc(i.venue)}</span>` : ''}${esc(i.title)}</p>`).join('');
    announcements = `<h2>${esc(label)}</h2>
      ${rows}
      <p class="credit">${esc(d.source)}</p>`;
  }

  return `<section class="section announcements">
  ${artNews.map((r) => paper(r, model.timezone)).join('\n')}
  ${announcements}
</section>`;
}

/** News sources assigned to a given page of the digest. */
function onPage(model, page) {
  return (model.news ?? []).filter((r) => (r.page ?? 'papers') === page);
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

  const translated = d.translatedBy?.length
    ? ` · translated by ${esc(d.translatedBy.join(', '))}`
    : '';
  const epigraph = d.epigraph ? `<p class="epigraph">${esc(d.epigraph)}</p>` : '';
  const editorNote = d.editorNote ? `<p class="note">${esc(d.editorNote)}</p>` : '';
  const credit = d.credit ? ` · ${esc(d.credit)}` : '';

  return `<section class="section poem">
  <h2>Poem</h2>
  <p class="attrib">${esc(d.title)} · ${esc(d.author)}${translated}</p>
  ${editorNote}
  ${epigraph}
  <div class="verse">${lines}</div>
  <p class="source">${esc(d.source)}${credit}</p>
</section>`;
}

function memeImage(model) {
  const r = model.meme;
  if (!r?.ok || !r.data) return '';
  const d = r.data;
  const cap = model.memeMaxHeightMm ?? 50;
  return `<div class="poem-meme"><img style="max-height:${cap}mm" src="${d.dataUri}" alt="${esc(d.title || 'meme of the day')}"></div>`;
}

/* -------------------------------- footer --------------------------------- */

function footer(model, tz) {
  return `<div class="footer">Generated ${esc(timeIn(model.generatedAt, tz))} in ${(model.tookMs / 1000).toFixed(1)}s</div>`;
}

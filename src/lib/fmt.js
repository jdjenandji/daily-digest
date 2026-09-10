const nf = (opts) => new Intl.NumberFormat('en-GB', opts);

export function num(value, digits = 2) {
  if (value == null || Number.isNaN(value)) return '—';
  return nf({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

/** Indices want no decimals; a $78,045 Bitcoin wants none either. Small numbers keep two. */
export function price(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return num(value, Math.abs(value) >= 1000 ? 0 : 2);
}

export function pct(value) {
  if (value == null || Number.isNaN(value)) return '—';
  const s = value >= 0 ? '+' : '−';
  return `${s}${num(Math.abs(value), 2)}%`;
}

export function timeIn(iso, timezone, opts = {}) {
  if (!iso) return '';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false, ...opts,
  }).format(d);
}

export function longDate(date, timezone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(date);
}

/** Calendar date string (YYYY-MM-DD) for a given instant in a given zone. */
export function dateKey(date, timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

export function relAge(ms) {
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`;
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Truncate on a word boundary. Layout stability comes from the data layer, not CSS. */
export function clip(text, max) {
  if (!text) return '';
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:.\-–—]$/, '')}…`;
}

export function stripTags(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Inline SVG so the page pulls zero network assets. Stroke-only, 24x24 viewBox.
const wrap = (body) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" `
  + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const SUN = '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2'
  + 'M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6"/>';
const CLOUD = '<path d="M6.5 18.5h11a3.9 3.9 0 0 0 .3-7.8 5.6 5.6 0 0 0-10.8-1.4A3.6 3.6 0 0 0 6.5 18.5z"/>';
const PARTLY = '<circle cx="8.4" cy="8" r="3.1"/><path d="M8.4 2.4v1.6M2.8 8h1.6M4.4 4l1.1 1.1M12.4 4l-1.1 1.1"/>'
  + '<path d="M9.5 19.6h8.6a3.4 3.4 0 0 0 .3-6.8 4.9 4.9 0 0 0-9.4-1.2 3.1 3.1 0 0 0 .5 8z"/>';
const RAIN = CLOUD + '<path d="M9 20.6l-.9 2M13 20.6l-.9 2M17 20.6l-.9 2"/>';
const DRIZZLE = CLOUD + '<path d="M9.4 20.8v1.2M13.4 20.8v1.2"/>';
const SHOWERS = CLOUD + '<path d="M8.6 20.4l-1.2 2.4M12.6 20.4l-1.2 2.4M16.6 20.4l-1.2 2.4"/>';
const SNOW = CLOUD + '<path d="M9 21.4h.01M12.5 21.4h.01M16 21.4h.01M10.7 22.9h.01M14.2 22.9h.01"/>';
const SLEET = CLOUD + '<path d="M9.4 20.6l-.9 2M13 21.3h.01M16.4 20.6l-.9 2"/>';
const STORM = CLOUD + '<path d="M13 19.6l-2.6 3.4h3l-1.6 2.4"/>';
const FOG = '<path d="M4 9.5h16M6 13h14M4 16.5h13M7 20h11"/>';

export const ICONS = {
  sun: wrap(SUN), cloud: wrap(CLOUD), partly: wrap(PARTLY), rain: wrap(RAIN),
  drizzle: wrap(DRIZZLE), showers: wrap(SHOWERS), snow: wrap(SNOW),
  sleet: wrap(SLEET), storm: wrap(STORM), fog: wrap(FOG),
};

export const icon = (key) => ICONS[key] ?? ICONS.cloud;

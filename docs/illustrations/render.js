// Renders integration widget contents the way the Gladys front does
// (front/src/components/boxs/external-widget: ExternalWidgetBox +
// WidgetComponents, and the area chart of boxs/chart), in plain DOM, with the
// same slots, order, class names and ApexCharts options.
// Query: ?lang=fr&cards=box,calls,network
/* global ApexCharts, DATA */
const params = new URLSearchParams(location.search);
const LANG = params.get('lang') || 'en';
const CARDS = (params.get('cards') || 'box').split(',');

// The "now" of the contents: the chart axis matches it.
const realNow = Date.now;
Date.now = () => DATA.now;

const text = (value) =>
  value && typeof value === 'object' ? (value[LANG] ?? value.en ?? '') : (value ?? '');
const formatNumber = (value) =>
  typeof value === 'number'
    ? new Intl.NumberFormat(LANG, { maximumFractionDigits: 2 }).format(value)
    : (value ?? '');
const COLOR = {
  neutral: 'colorNeutral',
  primary: 'colorPrimary',
  success: 'colorSuccess',
  warning: 'colorWarning',
  danger: 'colorDanger',
  info: 'colorInfo',
};
const BADGE_COLOR = {
  primary: 'badgeColorPrimary',
  success: 'badgeColorSuccess',
  warning: 'badgeColorWarning',
  danger: 'badgeColorDanger',
  info: 'badgeColorInfo',
};
const el = (tag, cls, children = []) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
};
const svg = (tag, attributes) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
};
const icon = (name, cls = '') => el('i', `fe fe-${name} ${cls}`);

function splitIntoSlots(components) {
  const slots = { header: [], tiles: [], focal: null, body: null, status: null, buttons: [] };
  for (const c of components) {
    if (c.type === 'text') c.variant === 'body' ? (slots.body = c) : slots.header.push(c);
    else if (c.type === 'value' || c.type === 'gauge') slots.tiles.push(c);
    else if (['chart', 'card-list', 'image'].includes(c.type)) slots.focal = c;
    else if (c.type === 'status') slots.status = c;
    else if (c.type === 'button') slots.buttons.push(c);
  }
  return slots;
}

const header = (components) =>
  el(
    'div',
    'header',
    components.map((c) => el('div', c.variant === 'heading' ? 'heading' : 'caption', text(c.text))),
  );

// The 270° arc of the Gauge component.
const GAUGE_ARC_LENGTH = (2 * Math.PI * 34 * 270) / 360;
const ARC = 'M 20 62 A 34 34 0 1 1 68 62';

function gauge(c) {
  const ratio = Math.min(1, Math.max(0, (c.value - c.min) / (c.max - c.min)));
  const drawing = svg('svg', {
    class: `gauge ${COLOR[c.color || 'primary']}`,
    viewBox: '0 0 88 66',
    'aria-hidden': 'true',
  });
  drawing.append(
    svg('path', {
      class: 'gaugeTrack',
      d: ARC,
      'stroke-dasharray': `${GAUGE_ARC_LENGTH} ${GAUGE_ARC_LENGTH}`,
    }),
    svg('path', {
      class: 'gaugeArc',
      d: ARC,
      'stroke-dasharray': `${ratio * GAUGE_ARC_LENGTH} ${GAUGE_ARC_LENGTH}`,
    }),
  );
  return el('div', 'gaugeBox', [
    drawing,
    el('div', 'tileValue gaugeValue', [
      formatNumber(c.value),
      c.unit ? el('span', 'tileUnit', text(c.unit)) : null,
    ]),
  ]);
}

const tiles = (components) =>
  el(
    'div',
    'tilesBox',
    el(
      'div',
      `tiles tilesCount${Math.min(components.length, 6)}`,
      components.map((c) =>
        el('div', 'tile', [
          c.icon && c.type === 'value' ? icon(c.icon, `tileIcon ${COLOR[c.color] || ''}`) : null,
          c.type === 'gauge'
            ? gauge(c)
            : el('span', `tileValue ${COLOR[c.color] || ''}`, [
                formatNumber(c.value),
                c.unit ? el('span', 'tileUnit', text(c.unit)) : null,
              ]),
          c.label ? el('span', 'tileLabel', text(c.label)) : null,
        ]),
      ),
    ),
  );

// yAxisFormatter of front/src/components/boxs/chart.
const yAxisFormatter = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) return value;
  if (value === 0) return '0';
  const rounded = parseFloat(value.toPrecision(4));
  if (Math.abs(rounded) < 0.001 || Math.abs(rounded) >= 1e9) return rounded.toExponential(2);
  return value.toFixed(2);
};

// getApexChartAreaOptions (or Line) of front/src/components/boxs/chart,
// display_axes on, height 200, the default colors of the chart box.
function chart(component) {
  const box = el('div', null, [
    component.title ? el('div', 'caption mb-1', text(component.title)) : null,
  ]);
  const target = el('div');
  box.append(target);
  const area = component.chart_type === 'area';
  const series = component.series.map((s, i) => ({
    name: text(s.name) || `${i + 1}`,
    data: s.points.map((p) => [new Date(p.t).getTime(), p.v]),
  }));
  const options = {
    chart: {
      locales: window.APEX_LOCALES,
      defaultLocale: LANG,
      type: area ? 'area' : 'line',
      fontFamily: 'inherit',
      height: 200,
      parentHeightOffset: 0,
      sparkline: { enabled: false },
      toolbar: { show: false },
      animations: { enabled: false },
    },
    dataLabels: { enabled: false },
    fill: area ? { opacity: 0.16, type: 'solid' } : { opacity: 1 },
    stroke: { width: 2, lineCap: 'round', curve: 'smooth' },
    series,
    grid: { strokeDashArray: 4, padding: { left: -4 } },
    xaxis: {
      labels: { padding: 0, datetimeUTC: false },
      tooltip: { enabled: false },
      axisBorder: { show: false },
      type: 'datetime',
    },
    yaxis: { labels: { padding: 4, formatter: yAxisFormatter } },
    colors: ['#316cbe', '#d63031', '#00b894', '#fdcb6e', '#6c5ce7'],
    legend: { show: true, position: 'bottom' },
  };
  requestAnimationFrame(() => {
    window.PENDING_CHARTS += 1;
    new ApexCharts(target, options).render().then(() => {
      window.PENDING_CHARTS -= 1;
    });
  });
  return box;
}

// formatDate of widgetContentUtils: dayjs 'lll' ("18 oct. 2026 19:42"), here
// through Intl in the time zone of Paris (the zone of the made-up home).
const formatDate = (value) =>
  new Intl.DateTimeFormat(LANG, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  }).format(new Date(value));

// WidgetCardList: an item with a description or links is clickable; with a
// date, the date replaces the subtitle.
const cardList = (component) =>
  el(
    'div',
    null,
    el(
      'div',
      'cardList',
      component.items.map((item) => {
        const clickable = Boolean(item.description) || (item.links && item.links.length > 0);
        const node = el('button', `cardListItem ${clickable ? 'clickable' : ''}`, [
          el('div', 'cardListText', [
            el('span', 'cardTitle', text(item.title)),
            item.date || item.subtitle
              ? el('span', 'cardMeta', item.date ? formatDate(item.date) : text(item.subtitle))
              : null,
            item.badge
              ? el('span', `wbadge ${BADGE_COLOR[item.badge.color] || ''}`, text(item.badge.text))
              : null,
          ]),
        ]);
        node.type = 'button';
        node.disabled = !clickable;
        return node;
      }),
    ),
  );

const statusList = (component) =>
  el(
    'ul',
    'statusList',
    component.items.map((item) =>
      el('li', 'statusRow', [
        item.icon
          ? icon(item.icon, `statusIcon ${COLOR[item.color || 'neutral']}`)
          : el('span', `statusDot ${COLOR[item.color || 'neutral']}`),
        el('span', 'statusLabel', text(item.label)),
        el('span', 'statusValue', formatNumber(text(item.value))),
      ]),
    ),
  );

const buttons = (components) =>
  el(
    'div',
    'buttons',
    components.map((c) => {
      const node = el(
        'button',
        `button ${c.style === 'primary' ? 'buttonPrimary' : ''} ${c.style === 'danger' ? 'buttonDanger' : ''}`,
        [
          el('span', 'buttonIcon', icon(c.icon || 'play')),
          el('span', 'buttonLabel', text(c.label)),
        ],
      );
      node.type = 'button';
      return node;
    }),
  );

function card(name) {
  const content = DATA.contents[LANG][name];
  const widget = DATA.widgets[name];
  const slots = splitIntoSlots(content.components);
  const focal = slots.focal;
  return el('div', 'card', [
    el(
      'div',
      'card-header',
      el('h3', 'card-title', [icon(widget.icon), el('span', 'm-1', text(widget.label))]),
    ),
    el(
      'div',
      'card-body',
      el('div', 'slots', [
        slots.header.length ? header(slots.header) : null,
        slots.tiles.length ? tiles(slots.tiles) : null,
        focal && focal.type === 'chart' ? chart(focal) : null,
        focal && focal.type === 'card-list' ? cardList(focal) : null,
        slots.body ? el('p', 'body', text(slots.body.text)) : null,
        slots.status ? statusList(slots.status) : null,
        slots.buttons.length ? buttons(slots.buttons) : null,
      ]),
    ),
  ]);
}

window.PENDING_CHARTS = 0;
const row = document.getElementById('row');
const columns = [el('div', 'col'), el('div', 'col')];
columns.forEach((column) => row.append(column));
CARDS.forEach((name, index) => columns[index % 2].append(card(name)));
setTimeout(() => {
  const wait = () => {
    if (window.PENDING_CHARTS === 0) {
      document.body.dataset.ready = '1';
      Date.now = realNow;
    } else setTimeout(wait, 50);
  };
  wait();
}, 100);

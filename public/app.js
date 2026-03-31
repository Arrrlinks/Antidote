const statusEl = document.getElementById('status');
const pdfInput = document.getElementById('pdfInput');
const uploadQueueEl = document.getElementById('uploadQueue');
const kpisEl = document.getElementById('kpis');
const rangeControlsEl = document.getElementById('rangeControls');
const prevRangeBtn = document.getElementById('prevRangeBtn');
const nextRangeBtn = document.getElementById('nextRangeBtn');
const moodInsightsEl = document.getElementById('moodInsights');
const heatmapLegendEl = document.getElementById('heatmapLegend');
const moodHeatmapEl = document.getElementById('moodHeatmap');
const metricBlocksEl = document.getElementById('metricBlocks');
const monthlyBody = document.querySelector('#monthlyTable tbody');
const reportsBody = document.querySelector('#reportsTable tbody');

const tooltipEl = document.createElement('div');
tooltipEl.className = 'chart-tooltip hidden';
document.body.appendChild(tooltipEl);

const PERIODS = [
  { key: '7d', label: '7 days', mode: 'week' },
  { key: '30d', label: '1 month', mode: 'month' },
  { key: '90d', label: '3 months', mode: 'quarter' },
  { key: '1y', label: '1 year', mode: 'year' },
  { key: 'all', label: 'All', days: null }
];

const SYMPTOM_METRICS = [
  { key: 'headache', label: 'Headache', color: '#c1121f', max: 10 },
  { key: 'fatigue', label: 'Fatigue', color: '#d97706', max: 10 },
  { key: 'anxiety', label: 'Anxiety', color: '#7c2d12', max: 10 }
];

const MOOD_COLORS = ['#111111', '#dc2626', '#eab308', '#16a34a', '#2563eb'];

const state = {
  stats: { global: {}, monthly: [], daily: [] },
  reportFiles: [],
  dailyPoints: [],
  selectedPeriod: 'all',
  cursorEnd: null,
  initialized: false
};

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#991b1b' : '#7a3c3c';
}

function parseDate(value) {
  if (!value) return null;
  const iso = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = iso
    ? new Date(Number.parseInt(iso[1], 10), Number.parseInt(iso[2], 10) - 1, Number.parseInt(iso[3], 10))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fmt(value, digits = 2) {
  if (typeof value !== 'number') return '-';
  const fixed = value.toFixed(digits);
  return fixed
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?[1-9])0+$/, '$1');
}

function formatDate(date) {
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function showTooltip(event, html) {
  tooltipEl.innerHTML = html;
  tooltipEl.classList.remove('hidden');
  const offset = 14;
  tooltipEl.style.left = `${event.clientX + offset}px`;
  tooltipEl.style.top = `${event.clientY + offset}px`;
}

function hideTooltip() {
  tooltipEl.classList.add('hidden');
}

function bindDataTooltips(scopeElement) {
  if (!scopeElement) return;
  scopeElement.querySelectorAll('[data-tooltip]').forEach((el) => {
    el.addEventListener('mousemove', (event) => {
      showTooltip(event, el.dataset.tooltip);
    });
    el.addEventListener('mouseleave', hideTooltip);
  });
}

function normalizeDaily(points) {
  return (points || [])
    .map((point) => {
      const date = parseDate(point.date);
      return { ...point, _date: date };
    })
    .filter((point) => point._date)
    .sort((a, b) => a._date - b._date);
}

function resolveDefaultPeriod(points) {
  if (!points.length) return 'all';
  const first = points[0]._date;
  const last = points[points.length - 1]._date;
  const spanDays = Math.floor((last - first) / 86400000);
  return spanDays > 365 ? '1y' : 'all';
}

function getPeriodConfig() {
  return PERIODS.find((item) => item.key === state.selectedPeriod) || PERIODS[0];
}

function startOfWeekMonday(date) {
  const out = new Date(date);
  const day = out.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  out.setDate(out.getDate() + diff);
  out.setHours(0, 0, 0, 0);
  return out;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function startOfQuarter(date) {
  const firstMonth = Math.floor(date.getMonth() / 3) * 3;
  return new Date(date.getFullYear(), firstMonth, 1);
}

function endOfQuarter(date) {
  const firstMonth = Math.floor(date.getMonth() / 3) * 3;
  return new Date(date.getFullYear(), firstMonth + 3, 0);
}

function startOfYear(date) {
  return new Date(date.getFullYear(), 0, 1);
}

function endOfYear(date) {
  return new Date(date.getFullYear(), 11, 31);
}

function shiftAnchor(anchor, mode, direction) {
  const shifted = new Date(anchor);
  if (mode === 'week') {
    shifted.setDate(shifted.getDate() + (7 * direction));
    return shifted;
  }

  if (mode === 'month') {
    shifted.setMonth(shifted.getMonth() + direction);
    return shifted;
  }

  if (mode === 'quarter') {
    shifted.setMonth(shifted.getMonth() + (3 * direction));
    return shifted;
  }

  if (mode === 'year') {
    shifted.setFullYear(shifted.getFullYear() + direction);
    return shifted;
  }

  return shifted;
}

function calendarWindowFor(anchor, mode) {
  if (mode === 'week') {
    const start = startOfWeekMonday(anchor);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { start, end };
  }

  if (mode === 'month') {
    return { start: startOfMonth(anchor), end: endOfMonth(anchor) };
  }

  if (mode === 'quarter') {
    return { start: startOfQuarter(anchor), end: endOfQuarter(anchor) };
  }

  if (mode === 'year') {
    return { start: startOfYear(anchor), end: endOfYear(anchor) };
  }

  return { start: null, end: null };
}

function getBounds(points) {
  if (!points.length) return { minDate: null, maxDate: null };
  return {
    minDate: points[0]._date,
    maxDate: points[points.length - 1]._date
  };
}

function getWindow(points) {
  const { minDate, maxDate } = getBounds(points);
  if (!minDate || !maxDate) return { start: null, end: null, rows: [] };

  if (!state.cursorEnd) {
    state.cursorEnd = new Date(maxDate);
  }

  const period = getPeriodConfig();
  if (period.key === 'all') {
    return { start: minDate, end: maxDate, rows: points };
  }

  const anchor = state.cursorEnd > maxDate ? maxDate : state.cursorEnd;
  const { start, end } = calendarWindowFor(anchor, period.mode);

  const rows = points.filter((point) => point._date >= start && point._date <= end);
  return { start, end, rows };
}

function getPreviousWindow(points, currentStart) {
  const period = getPeriodConfig();
  if (period.key === 'all' || !currentStart || !period.mode) {
    return { start: null, end: null, rows: [] };
  }

  const previousAnchor = shiftAnchor(currentStart, period.mode, -1);
  const { start, end } = calendarWindowFor(previousAnchor, period.mode);

  const rows = points.filter((point) => point._date >= start && point._date <= end);
  return { start, end, rows };
}

function canMovePrev(points) {
  const period = getPeriodConfig();
  if (period.key === 'all' || !period.mode) return false;
  const { minDate } = getBounds(points);
  if (!minDate || !state.cursorEnd) return false;

  const { start } = calendarWindowFor(state.cursorEnd, period.mode);
  return start > minDate;
}

function canMoveNext(points) {
  const period = getPeriodConfig();
  if (period.key === 'all' || !period.mode) return false;
  const { maxDate } = getBounds(points);
  if (!maxDate || !state.cursorEnd) return false;

  const { end } = calendarWindowFor(state.cursorEnd, period.mode);
  return end < maxDate;
}

function shiftWindow(direction) {
  const period = getPeriodConfig();
  if (period.key === 'all' || !state.cursorEnd || !period.mode) return;

  state.cursorEnd = shiftAnchor(state.cursorEnd, period.mode, direction);

  renderDashboard();
}

function renderRangeControls() {
  rangeControlsEl.innerHTML = PERIODS.map((period) => {
    const active = state.selectedPeriod === period.key ? 'active' : '';
    return `<button class="range-chip ${active}" data-period="${period.key}">${period.label}</button>`;
  }).join('');

  rangeControlsEl.querySelectorAll('.range-chip').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedPeriod = button.dataset.period;
      const { maxDate } = getBounds(state.dailyPoints);
      state.cursorEnd = maxDate ? new Date(maxDate) : null;
      renderDashboard();
    });
  });

  prevRangeBtn.disabled = !canMovePrev(state.dailyPoints);
  nextRangeBtn.disabled = !canMoveNext(state.dailyPoints);
}

function buildStats(rows) {
  const keys = ['mood', 'headache', 'fatigue', 'anxiety'];
  const out = { count: rows.length };

  for (const key of keys) {
    const values = rows.map((row) => row[key]).filter((v) => typeof v === 'number');
    out[`${key}Avg`] = values.length ? Number((values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(2)) : null;
  }

  return out;
}

function percentChange(currentValue, previousValue) {
  if (typeof currentValue !== 'number' || typeof previousValue !== 'number') return null;
  if (previousValue === 0) return null;
  return ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
}

function renderDeltaBadge(deltaPercent) {
  if (typeof deltaPercent !== 'number' || Number.isNaN(deltaPercent)) return '';

  const rounded = Math.round(Math.abs(deltaPercent));
  if (rounded === 0) {
    return `<span class="card-delta card-delta-flat">0%</span>`;
  }

  const isUp = deltaPercent > 0;
  const directionClass = isUp ? 'card-delta-up' : 'card-delta-down';
  const triangle = isUp ? '&#9650;' : '&#9660;';
  return `<span class="card-delta ${directionClass}">${triangle} ${rounded}%</span>`;
}

function renderKpis(windowRows, windowStart, windowEnd) {
  const stats = buildStats(windowRows);
  const previousWindow = getPreviousWindow(state.dailyPoints, windowStart);
  const previousStats = buildStats(previousWindow.rows);
  const showDelta = getPeriodConfig().key !== 'all';
  const rangeText = windowStart && windowEnd ? `${formatDate(windowStart)} - ${formatDate(windowEnd)}` : 'No range';

  const cards = [
    { label: 'Period', value: rangeText, delta: null },
    { label: 'Tracked Days', value: String(stats.count || 0), delta: null },
    { label: 'Mood Avg (0-4)', value: fmt(stats.moodAvg), delta: percentChange(stats.moodAvg, previousStats.moodAvg) },
    { label: 'Headache Avg', value: fmt(stats.headacheAvg), delta: percentChange(stats.headacheAvg, previousStats.headacheAvg) },
    { label: 'Fatigue Avg', value: fmt(stats.fatigueAvg), delta: percentChange(stats.fatigueAvg, previousStats.fatigueAvg) },
    { label: 'Anxiety Avg', value: fmt(stats.anxietyAvg), delta: percentChange(stats.anxietyAvg, previousStats.anxietyAvg) }
  ];

  kpisEl.innerHTML = cards
    .map((card) => {
      const deltaBadge = showDelta ? renderDeltaBadge(card.delta) : '';
      return `<article class="card"><div class="label">${card.label}</div><div class="value">${card.value}</div>${deltaBadge}</article>`;
    })
    .join('');
}

function moodTrendText(rows) {
  if (rows.length < 4) return 'Not enough data';
  const moodValues = rows.map((row) => row.mood).filter((v) => typeof v === 'number');
  if (moodValues.length < 4) return 'Not enough data';

  const block = Math.max(3, Math.floor(moodValues.length / 4));
  const firstAvg = moodValues.slice(0, block).reduce((a, b) => a + b, 0) / block;
  const lastAvg = moodValues.slice(-block).reduce((a, b) => a + b, 0) / block;
  const delta = Number((lastAvg - firstAvg).toFixed(2));

  if (Math.abs(delta) < 0.08) return 'Stable';
  return delta > 0 ? `Improving (+${delta})` : `Lower (${delta})`;
}

function renderMoodInsights(windowRows) {
  const moodRows = windowRows.filter((row) => typeof row.mood === 'number');
  if (!moodRows.length) {
    moodInsightsEl.innerHTML = '<article class="insight"><div class="title">Mood trend</div><div class="big">No mood data</div></article>';
    return;
  }

  const avg = moodRows.reduce((sum, row) => sum + row.mood, 0) / moodRows.length;
  const best = moodRows.reduce((bestRow, row) => (!bestRow || row.mood > bestRow.mood ? row : bestRow), null);
  const worst = moodRows.reduce((worstRow, row) => (!worstRow || row.mood < worstRow.mood ? row : worstRow), null);

  const items = [
    { title: 'Mood trend', value: moodTrendText(moodRows) },
    { title: 'Average mood', value: fmt(avg) },
    { title: 'Best day', value: `${fmt(best.mood)} on ${formatDate(best._date)}` },
    { title: 'Lowest day', value: `${fmt(worst.mood)} on ${formatDate(worst._date)}` }
  ];

  moodInsightsEl.innerHTML = items
    .map((item) => `<article class="insight"><div class="title">${item.title}</div><div class="big">${item.value}</div></article>`)
    .join('');
}

function moodColor(value) {
  if (typeof value !== 'number') return '#f2e4e4';
  if (value < 0.8) return MOOD_COLORS[0];
  if (value < 1.6) return MOOD_COLORS[1];
  if (value < 2.4) return MOOD_COLORS[2];
  if (value < 3.2) return MOOD_COLORS[3];
  return MOOD_COLORS[4];
}

function renderHeatmapLegend() {
  const labels = ['Very Bad', 'Bad', 'OK', 'Good', 'Very Good'];
  heatmapLegendEl.innerHTML = labels
    .map((label, i) => `<span class="swatch" style="background:${MOOD_COLORS[i]}"></span><span>${label}</span>`)
    .join(' ');
}

function renderMoodHeatmap(allDailyRows, anchorDate) {
  const withMood = allDailyRows.filter((row) => typeof row.mood === 'number');
  if (!withMood.length) {
    moodHeatmapEl.innerHTML = '<div class="heatmap-empty">No mood data for heatmap.</div>';
    return;
  }

  const anchor = anchorDate || state.cursorEnd || withMood[withMood.length - 1]._date;
  const year = anchor.getFullYear();

  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);

  const valueByDay = new Map();
  withMood
    .filter((row) => row._date.getFullYear() === year)
    .forEach((row) => {
      valueByDay.set(row._date.toISOString().slice(0, 10), row.mood);
    });

  const firstCell = new Date(start);
  firstCell.setDate(start.getDate() - start.getDay());
  const lastCell = new Date(end);
  lastCell.setDate(end.getDate() + (6 - end.getDay()));

  const cells = [];
  for (let date = new Date(firstCell); date <= lastCell; date.setDate(date.getDate() + 1)) {
    cells.push(new Date(date));
  }

  const size = 14;
  const gap = 4;
  const weeks = Math.ceil(cells.length / 7);
  const width = weeks * (size + gap) + 44;
  const height = 7 * (size + gap) + 24;

  const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const dayText = dayLabels
    .map((label, row) => `<text x="3" y="${17 + row * (size + gap)}" font-size="9" fill="#7a3c3c">${label}</text>`)
    .join('');

  const rects = cells
    .map((date, index) => {
      const week = Math.floor(index / 7);
      const row = index % 7;
      const iso = date.toISOString().slice(0, 10);
      const value = valueByDay.get(iso);
      const inYear = date.getFullYear() === year;
      const opacity = inYear ? 1 : 0.28;

      const tooltip = `${formatDate(date)}<br>Mood: <strong>${fmt(value, 0)}</strong> / 4`;
      return `<rect class="heat-cell" x="${35 + week * (size + gap)}" y="${8 + row * (size + gap)}" width="${size}" height="${size}" rx="4" fill="${moodColor(value)}" opacity="${opacity}" data-tooltip="${tooltip}"></rect>`;
    })
    .join('');

  moodHeatmapEl.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-label="Mood heatmap ${year}">
      <text x="2" y="8" font-size="10" fill="#7a3c3c">${year}</text>
      ${dayText}
      ${rects}
    </svg>
  `;

  bindDataTooltips(moodHeatmapEl);
}

function renderMoodLine(rows) {
  const chart = renderMetricChart(rows, { key: 'mood', label: 'Mood', color: '#2563eb', max: 4 });
  moodHeatmapEl.innerHTML = `<div class="chart">${chart}</div>`;
  bindDataTooltips(moodHeatmapEl);
}

function renderMoodPanel(windowRows, windowEnd) {
  const period = getPeriodConfig();
  const useHeatmap = period.key === 'all' || period.key === '1y';

  if (useHeatmap) {
    heatmapLegendEl.style.display = 'flex';
    renderHeatmapLegend();
    renderMoodHeatmap(state.dailyPoints, windowEnd);
    return;
  }

  heatmapLegendEl.style.display = 'none';
  renderMoodLine(windowRows);
}

function smoothPath(points) {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }

  return d;
}

function renderMetricChart(rows, metric) {
  const width = 860;
  const height = 220;
  const margin = { top: 14, right: 16, bottom: 28, left: 34 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const maxIndex = Math.max(rows.length - 1, 1);

  const values = rows.map((row) => row[metric.key]).filter((value) => typeof value === 'number');
  if (!values.length) {
    return '<div class="chart-empty">No values in this period.</div>';
  }

  const x = (index) => margin.left + (index / maxIndex) * innerW;
  const y = (value) => margin.top + ((metric.max - value) / metric.max) * innerH;

  const points = rows
    .map((row, index) => ({
      x: x(index),
      y: typeof row[metric.key] === 'number' ? y(row[metric.key]) : null,
      value: row[metric.key],
      date: row._date
    }))
    .filter((point) => typeof point.value === 'number');

  const hoverZones = points
    .map((point, index) => {
      const prevX = index > 0 ? points[index - 1].x : point.x;
      const nextX = index < points.length - 1 ? points[index + 1].x : point.x;
      const left = index > 0 ? (prevX + point.x) / 2 : margin.left;
      const right = index < points.length - 1 ? (point.x + nextX) / 2 : margin.left + innerW;
      const widthZone = Math.max(8, right - left);
      const tooltip = `${formatDate(point.date)}<br>${metric.label}: <strong>${fmt(point.value, 0)}</strong>`;

      return `<rect class="chart-hover-hit" x="${left}" y="${margin.top}" width="${widthZone}" height="${innerH}" data-tooltip="${tooltip}"></rect>`;
    })
    .join('');

  const circles = points
    .map((point) => {
      const tooltip = `${formatDate(point.date)}<br>${metric.label}: <strong>${fmt(point.value, 0)}</strong>`;
      return `<circle cx="${point.x}" cy="${point.y}" r="3" fill="${metric.color}" data-tooltip="${tooltip}"></circle>`;
    })
    .join('');

  const first = rows[0]._date;
  const last = rows[rows.length - 1]._date;

  return `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="${metric.label} trend chart">
      <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + innerH}" class="axis"></line>
      <line x1="${margin.left}" y1="${margin.top + innerH}" x2="${margin.left + innerW}" y2="${margin.top + innerH}" class="axis"></line>
      <line x1="${margin.left}" y1="${y(metric.max / 2)}" x2="${margin.left + innerW}" y2="${y(metric.max / 2)}" class="axis" stroke-dasharray="4 4"></line>
      ${hoverZones}
      <path class="line" d="${smoothPath(points)}" stroke="${metric.color}"></path>
      ${circles}
      <text x="${margin.left}" y="${height - 8}" font-size="11" fill="#7a3c3c">${formatDate(first)}</text>
      <text x="${margin.left + innerW - 88}" y="${height - 8}" font-size="11" fill="#7a3c3c">${formatDate(last)}</text>
      <text x="6" y="${margin.top + 3}" font-size="10" fill="#7a3c3c">${metric.max}</text>
      <text x="9" y="${margin.top + innerH + 3}" font-size="10" fill="#7a3c3c">0</text>
    </svg>
  `;
}

function metricStats(rows, key) {
  const values = rows.map((row) => row[key]).filter((v) => typeof v === 'number');
  if (!values.length) {
    return { avg: null, min: null, max: null, latest: null };
  }

  return {
    avg: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)),
    min: Math.min(...values),
    max: Math.max(...values),
    latest: values[values.length - 1]
  };
}

function renderMetricBlocks(windowRows) {
  metricBlocksEl.innerHTML = SYMPTOM_METRICS.map((metric) => {
    const stats = metricStats(windowRows, metric.key);
    const chart = renderMetricChart(windowRows, metric);

    return `
      <section class="panel metric-card">
        <div class="metric-head">
          <h3>${metric.label}</h3>
          <span class="metric-meta">Daily trend in selected period</span>
        </div>
        <div class="metric-stats">
          <article class="insight"><div class="title">Average</div><div class="big">${fmt(stats.avg)}</div></article>
          <article class="insight"><div class="title">Latest</div><div class="big">${fmt(stats.latest)}</div></article>
          <article class="insight"><div class="title">Min</div><div class="big">${fmt(stats.min)}</div></article>
          <article class="insight"><div class="title">Max</div><div class="big">${fmt(stats.max)}</div></article>
        </div>
        <div class="chart">${chart}</div>
      </section>
    `;
  }).join('');

  bindDataTooltips(metricBlocksEl);
}

function renderMonthly(monthlyRows) {
  if (!monthlyRows.length) {
    monthlyBody.innerHTML = '<tr><td colspan="6">No monthly data.</td></tr>';
    return;
  }

  monthlyBody.innerHTML = monthlyRows
    .map(
      (row) =>
        `<tr>
          <td>${row.month || '-'}</td>
          <td>${fmt(row.mood)}</td>
          <td>${fmt(row.headache)}</td>
          <td>${fmt(row.fatigue)}</td>
          <td>${fmt(row.anxiety)}</td>
          <td>${row.count ?? 0}</td>
        </tr>`
    )
    .join('');
}

function renderReports(reports) {
  if (!reports.length) {
    reportsBody.innerHTML = '<tr><td colspan="6">No imported report.</td></tr>';
    return;
  }

  reportsBody.innerHTML = reports
    .map(
      (row) =>
        `<tr>
          <td>${row.fileName}</td>
          <td>${row.reportDate || '-'}</td>
          <td>${fmt(row.mood)}</td>
          <td>${fmt(row.headache)}</td>
          <td>${fmt(row.fatigue)}</td>
          <td>${fmt(row.anxiety)}</td>
        </tr>`
    )
    .join('');
}

function renderDashboard() {
  renderRangeControls();

  const windowData = getWindow(state.dailyPoints);
  renderKpis(windowData.rows, windowData.start, windowData.end);
  renderMoodInsights(windowData.rows);
  renderMoodPanel(windowData.rows, windowData.end);
  renderMetricBlocks(windowData.rows);
  renderMonthly(state.stats.monthly || []);
  renderReports(state.reportFiles || []);
}

async function refreshAll() {
  const [statsRes, reportsRes] = await Promise.all([fetch('/api/stats'), fetch('/api/reports')]);

  if (!statsRes.ok || !reportsRes.ok) {
    throw new Error('Could not load data from server.');
  }

  state.stats = await statsRes.json();
  state.reportFiles = await reportsRes.json();
  state.dailyPoints = normalizeDaily(state.stats.daily || []);

  if (!state.initialized) {
    state.selectedPeriod = resolveDefaultPeriod(state.dailyPoints);
    const { maxDate } = getBounds(state.dailyPoints);
    state.cursorEnd = maxDate ? new Date(maxDate) : null;
    state.initialized = true;
  }

  renderDashboard();
}

function createUploadItem(file) {
  const item = document.createElement('article');
  item.className = 'upload-item';
  item.innerHTML = `
    <div class="upload-top">
      <div class="upload-name" title="${file.name}">${file.name}</div>
      <div class="upload-meta">Queued</div>
    </div>
    <div class="upload-track"><div class="upload-fill"></div></div>
  `;

  uploadQueueEl.prepend(item);

  return {
    item,
    metaEl: item.querySelector('.upload-meta'),
    fillEl: item.querySelector('.upload-fill')
  };
}

function setUploadProgress(ui, value, label) {
  const pct = Math.max(0, Math.min(100, value));
  ui.fillEl.style.width = `${pct}%`;
  ui.metaEl.textContent = label || `${Math.round(pct)}%`;
}

function markUploadSuccess(ui) {
  ui.item.classList.remove('is-error');
  ui.item.classList.add('is-done');
  setUploadProgress(ui, 100, 'Uploaded');

  setTimeout(() => {
    ui.item.classList.add('fade-out');
    setTimeout(() => {
      ui.item.remove();
    }, 650);
  }, 5000);
}

function markUploadError(ui, message) {
  ui.item.classList.remove('is-done');
  ui.item.classList.add('is-error');
  ui.metaEl.textContent = message || 'Upload failed';
}

function uploadSingleFile(file, ui) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('pdfs', file);

    xhr.open('POST', '/api/upload');

    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      const pct = (event.loaded / event.total) * 100;
      setUploadProgress(ui, pct);
    });

    xhr.addEventListener('load', () => {
      let payload = {};
      try {
        payload = JSON.parse(xhr.responseText || '{}');
      } catch (_) {
        payload = {};
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        markUploadSuccess(ui);
        resolve(payload);
      } else {
        const errorMessage = payload.error || 'Upload failed';
        markUploadError(ui, errorMessage);
        reject(new Error(errorMessage));
      }
    });

    xhr.addEventListener('error', () => {
      markUploadError(ui, 'Network error');
      reject(new Error('Network error'));
    });

    setUploadProgress(ui, 2, 'Starting...');
    xhr.send(formData);
  });
}

async function handlePdfSelection() {
  const files = Array.from(pdfInput.files || []);
  if (!files.length) {
    return;
  }

  setStatus(`Uploading ${files.length} file(s)...`);

  const tasks = files.map((file) => {
    const ui = createUploadItem(file);
    return uploadSingleFile(file, ui)
      .then(() => ({ ok: true }))
      .catch((error) => ({ ok: false, error }));
  });

  const results = await Promise.all(tasks);
  const successCount = results.filter((r) => r.ok).length;
  const failureCount = results.length - successCount;

  if (successCount > 0) {
    await refreshAll();
  }

  if (failureCount > 0) {
    setStatus(`${successCount} uploaded, ${failureCount} failed.`, true);
  } else {
    setStatus(`${successCount} PDF(s) uploaded.`);
  }

  pdfInput.value = '';
}

pdfInput.addEventListener('change', () => {
  handlePdfSelection().catch((error) => {
    setStatus(error.message, true);
  });
});

prevRangeBtn.addEventListener('click', () => shiftWindow(-1));
nextRangeBtn.addEventListener('click', () => shiftWindow(1));

refreshAll().catch((error) => {
  setStatus(error.message, true);
});



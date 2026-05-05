/* ─────────────────────────────────────────────────────────────────────────
   Gold COT Dashboard — Larry Williams Commercial Index
   Data source: CFTC Disaggregated COT report (COMEX Gold Futures, code 088691)
   Williams COT Index formula: Stochastic of (net position / open interest)
   over a user-selectable lookback period (default 26 weeks)
───────────────────────────────────────────────────────────────────────── */

// ── Theme toggle ────────────────────────────────────────────────────────────

// ── Flow Data (embedded, refreshed on build) ──────────────────────────────
// GLD ETF weekly holdings (price-ratio method). Source: Yahoo Finance / SPDR.
let GLD_DATA = [];

// Central bank quarterly net purchases. Source: World Gold Council / IMF IFS.
// Annual totals verified: 2023=1,051t, 2024=1,045t, 2025=863t
let CB_DATA = [];


// Silver COT data (weekly, 2024-2026). Source: CFTC disaggregated futures.
let SILVER_DATA = [];

// Gold/Silver ratio + SLV ETF data (weekly). Source: Yahoo Finance.
let RATIO_DATA = [];

(function() {


  const toggle = document.querySelector('[data-theme-toggle]');
  const root = document.documentElement;
  let theme = root.getAttribute('data-theme') || 
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  root.setAttribute('data-theme', theme);

  if (toggle) toggle.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', theme);
    // Update chart colors
    if (window._charts) updateChartTheme();
  });

  // Metal toggle
// Metal panel toggle — initialised after DOM ready
document.addEventListener('DOMContentLoaded', () => {
  // Hide non-gold panels on load
  ['panel-silver', 'panel-ratio'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });

  const metalBtns  = document.querySelectorAll('.metal-btn');
  const panelMap   = { gold: document.getElementById('panel-gold'), silver: document.getElementById('panel-silver'), ratio: document.getElementById('panel-ratio') };
  let activeMetal  = 'gold';

  metalBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const metal = btn.dataset.metal;
      if (metal === activeMetal) return;
      activeMetal = metal;
      metalBtns.forEach(b => b.classList.toggle('active', b.dataset.metal === metal));
      Object.entries(panelMap).forEach(([k, el]) => { if (el) el.classList.toggle('hidden', k !== metal); });
      if (metal === 'silver' && !window._charts.siCotIndex) renderSilver();
      if (metal === 'ratio'  && !window._charts.ratio)      renderRatio();
    });
  });
});

})();

// ── Helpers ──────────────────────────────────────────────────────────────────
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

function fmt(n) {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 }).format(n);
}

function fmtNet(n) {
  if (n === null || n === undefined) return '—';
  const s = n >= 0 ? '+' : '';
  return s + new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 }).format(n);
}

function fmtIdx(v) {
  if (v === null || v === undefined) return '—';
  return v.toFixed(1) + '%';
}

function getSignal(idx, isCommercial) {
  if (idx === null || idx === undefined) return { label: '—', cls: 'signal-neutral' };
  if (isCommercial) {
    if (idx >= 80) return { label: '▲ Bullish signal', cls: 'signal-bull' };
    if (idx <= 20) return { label: '▼ Bearish signal', cls: 'signal-bear' };
    return { label: '— Neutral', cls: 'signal-neutral' };
  } else {
    // For specs and MM: extreme long = contrarian bearish
    if (idx >= 80) return { label: '▲ Crowded long', cls: 'signal-bear' };
    if (idx <= 20) return { label: '▼ Crowded short', cls: 'signal-bull' };
    return { label: '— Neutral', cls: 'signal-neutral' };
  }
}

function idxClass(v) {
  if (v >= 80) return 'idx-bull';
  if (v <= 20) return 'idx-bear';
  return 'idx-mid';
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// ── Chart theme ───────────────────────────────────────────────────────────────
function getChartColors() {
  return {
    grid: cssVar('--divider'),
    tick: cssVar('--text-faint'),
    label: cssVar('--text-muted'),
    gold: '#e8af34',
    goldDim: 'rgba(232,175,52,0.15)',
    blue: '#5591c7',
    blueDim: 'rgba(85,145,199,0.15)',
    purple: '#a86fdf',
    purpleDim: 'rgba(168,111,223,0.15)',
    orange: '#fdab43',
    orangeDim: 'rgba(253,171,67,0.12)',
    green: '#6daa45',
    red: '#dd6974',
    surface: cssVar('--surface'),
  };
}

Chart.defaults.font.family = "'DM Sans', system-ui, sans-serif";
Chart.defaults.font.size = 11;

// ── Data loading ──────────────────────────────────────────────────────────────
let allData = [];
let period = 26;

async function loadData() {
  try {
    const [gold, silver, ratio, gld, cb] = await Promise.all([
      fetch('gold_cot_data.json').then(r => r.json()),
      fetch('silver_cot_data.json').then(r => r.json()),
      fetch('ratio_data.json').then(r => r.json()),
      fetch('gld_data.json').then(r => r.json()),
      fetch('cb_data.json').then(r => r.json()),
    ]);
    allData      = gold;
    SILVER_DATA  = silver;
    RATIO_DATA   = ratio;
    GLD_DATA     = gld;
    CB_DATA      = cb;
    return true;
  } catch (e) {
    console.error('Data load error:', e);
    return false;
  }
}

function parseGoldLine(line) {
  if (!line) return null;
  // Simple CSV parse
  const row = [];
  let inQuote = false, cur = '';
  for (const ch of line) {
    if (ch === '"') { inQuote = !inQuote; }
    else if (ch === ',' && !inQuote) { row.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  row.push(cur.trim());
  if (row.length < 18) return null;
  try {
    const d = {
      date: row[2],
      open_interest: parseInt(row[7]),
      comm_long: parseInt(row[8]),
      comm_short: parseInt(row[9]),
      swap_long: parseInt(row[10]),
      swap_short: parseInt(row[11]),
      mm_long: parseInt(row[13]),
      mm_short: parseInt(row[14]),
      other_long: parseInt(row[16]),
      other_short: parseInt(row[17]),
    };
    const oi = d.open_interest;
    d.comm_net = (d.comm_long + d.swap_long) - (d.comm_short + d.swap_short);
    d.mm_net = d.mm_long - d.mm_short;
    d.other_net = d.other_long - d.other_short;
    d.comm_oi_ratio = d.comm_net / oi;
    d.mm_oi_ratio = d.mm_net / oi;
    d.other_oi_ratio = d.other_net / oi;
    return d;
  } catch { return null; }
}

// ── COT Index calculation ─────────────────────────────────────────────────────
function calcCotIndex(data, lookback) {
  return data.map((d, i) => {
    const start = Math.max(0, i - lookback + 1);
    const window = data.slice(start, i + 1);
    const result = {};
    for (const key of ['comm_oi_ratio', 'mm_oi_ratio', 'other_oi_ratio', 'nr_oi_ratio']) {
      const vals = window.map(w => w[key]);
      const mn = Math.min(...vals);
      const mx = Math.max(...vals);
      const rng = mx - mn;
      const idxKey = key.replace('_oi_ratio', '_cot_index');
      result[idxKey] = rng !== 0 ? parseFloat(((d[key] - mn) / rng * 100).toFixed(1)) : 50;
    }
    return { ...d, ...result };
  });
}

// ── Get display slice ─────────────────────────────────────────────────────────
function getDisplayData() {
  const calculated = calcCotIndex(allData, period);
  const numWeeks = period === 104 ? allData.length : period * 2;
  return calculated.slice(-numWeeks);
}

// ── KPI Update ────────────────────────────────────────────────────────────────
function updateKPIs(data) {
  const latest = data[data.length - 1];
  if (!latest) return;

  const reportDate = new Date(latest.date + 'T00:00:00Z');
  const now = new Date();
  const daysDiff = Math.floor((now - reportDate) / 86400000);

  $('#kpi-date').textContent = latest.date;
  
  // Comm net
  const commNet = $('#kpi-comm-net');
  commNet.textContent = fmtNet(latest.comm_net);
  commNet.className = 'kpi-value mono ' + (latest.comm_net >= 0 ? 'positive' : 'negative');

  // Comm index
  $('#kpi-comm-idx').textContent = fmtIdx(latest.comm_cot_index);
  const commSig = getSignal(latest.comm_cot_index, true);
  const commSigEl = $('#kpi-comm-signal');
  commSigEl.textContent = commSig.label;
  commSigEl.className = 'kpi-signal ' + commSig.cls;

  // MM net
  const mmNet = $('#kpi-mm-net');
  mmNet.textContent = fmtNet(latest.mm_net);
  mmNet.className = 'kpi-value mono ' + (latest.mm_net >= 0 ? 'positive' : 'negative');

  // MM index
  $('#kpi-mm-idx').textContent = fmtIdx(latest.mm_cot_index);
  const mmSig = getSignal(latest.mm_cot_index, false);
  const mmSigEl = $('#kpi-mm-signal');
  mmSigEl.textContent = mmSig.label;
  mmSigEl.className = 'kpi-signal ' + mmSig.cls;

  // Other net
  const otherNet = $('#kpi-other-net');
  otherNet.textContent = fmtNet(latest.other_net);
  otherNet.className = 'kpi-value mono ' + (latest.other_net >= 0 ? 'positive' : 'negative');

  // Other index
  $('#kpi-other-idx').textContent = fmtIdx(latest.other_cot_index);
  const otherSig = getSignal(latest.other_cot_index, false);
  const otherSigEl = $('#kpi-other-signal');
  otherSigEl.textContent = otherSig.label;
  otherSigEl.className = 'kpi-signal ' + otherSig.cls;

  // NR net
  const nrNetEl = $('#kpi-nr-net');
  nrNetEl.textContent = fmtNet(latest.nr_net);
  nrNetEl.className = 'kpi-value mono ' + (latest.nr_net >= 0 ? 'positive' : 'negative');

  // NR index — contrarian: >80 = crowded long (bearish), <20 = crowded short (bullish)
  $('#kpi-nr-idx').textContent = fmtIdx(latest.nr_cot_index);
  const nrSigObj = getSignal(latest.nr_cot_index, false);
  const nrSigEl = $('#kpi-nr-signal');
  nrSigEl.textContent = nrSigObj.label;
  nrSigEl.className = 'kpi-signal ' + nrSigObj.cls;

  // OI
  $('#kpi-oi').textContent = fmt(latest.open_interest);

  // Status
  const dot = $('#status-dot');
  const txt = $('#status-text');
  if (daysDiff <= 7) {
    dot.className = 'status-dot live';
    txt.textContent = `Current · Report date ${latest.date}`;
  } else {
    dot.className = 'status-dot stale';
    txt.textContent = `${daysDiff}d since report · ${latest.date}`;
  }
}

// ── Chart instances ───────────────────────────────────────────────────────────
window._charts = {};



// ── Spring Gauge ──────────────────────────────────────────────────────────
function updateSpringGauge(data) {
  if (!data || data.length === 0) return;
  const latest = data[data.length - 1];

  const comm = latest.comm_cot_index;
  const mm   = latest.mm_cot_index;
  const nr   = latest.nr_cot_index;

  // Targets
  const COMM_TARGET = 80;  // need >= 80
  const MM_TARGET   = 30;  // need <= 30
  const NR_TARGET   = 40;  // need <= 40

  // Progress toward target (0-100%)
  // Commercials: progress = comm / 80 (higher is better)
  const commProgress = Math.min(comm / COMM_TARGET * 100, 100);
  // MM: progress = (100 - mm) / 70  (lower mm is better, starting from 100 toward 30)
  const mmProgress   = Math.min(Math.max((100 - mm) / (100 - MM_TARGET) * 100, 0), 100);
  // NR: progress = (100 - nr) / 60  (lower nr is better, starting from 100 toward 40)
  const nrProgress   = Math.min(Math.max((100 - nr) / (100 - NR_TARGET) * 100, 0), 100);

  // Overall score = average of three progresses
  const overall = Math.round((commProgress + mmProgress + nrProgress) / 3);

  // Helper: gap class
  function gapClass(gap) {
    if (gap > 30) return 'gap-large';
    if (gap > 15) return 'gap-medium';
    return 'gap-small';
  }

  // Helper: bar colour class based on progress %
  function barClass(progress) {
    if (progress >= 85) return 'ready';
    if (progress >= 60) return 'close';
    if (progress >= 35) return 'warn';
    return '';
  }

  // Commercials
  const commBar = $('#gauge-bar-comm');
  commBar.style.width = commProgress.toFixed(1) + '%';
  commBar.className = 'gauge-bar gauge-bar-comm ' + barClass(commProgress);
  $('#gauge-comm-val').textContent = comm.toFixed(1) + '%';
  const commGap = Math.max(0, COMM_TARGET - comm);
  const commGapEl = $('#gauge-comm-gap');
  commGapEl.textContent = commGap > 0
    ? '+' + commGap.toFixed(0) + 'pts needed to target'
    : '✓ At target';
  commGapEl.className = 'gauge-gap ' + (commGap > 0 ? gapClass(commGap) : 'gap-small');

  // Managed Money
  const mmBar = $('#gauge-bar-mm');
  mmBar.style.width = mmProgress.toFixed(1) + '%';
  mmBar.className = 'gauge-bar gauge-bar-mm ' + barClass(mmProgress);
  $('#gauge-mm-val').textContent = mm.toFixed(1) + '%';
  const mmGap = Math.max(0, mm - MM_TARGET);
  const mmGapEl = $('#gauge-mm-gap');
  mmGapEl.textContent = mmGap > 0
    ? '-' + mmGap.toFixed(0) + 'pts needed to target'
    : '✓ At target';
  mmGapEl.className = 'gauge-gap ' + (mmGap > 0 ? gapClass(mmGap) : 'gap-small');

  // Non-Reportables
  const nrBar = $('#gauge-bar-nr');
  nrBar.style.width = nrProgress.toFixed(1) + '%';
  nrBar.className = 'gauge-bar gauge-bar-nr ' + barClass(nrProgress);
  $('#gauge-nr-val').textContent = nr.toFixed(1) + '%';
  const nrGap = Math.max(0, nr - NR_TARGET);
  const nrGapEl = $('#gauge-nr-gap');
  nrGapEl.textContent = nrGap > 0
    ? '-' + nrGap.toFixed(0) + 'pts needed to target'
    : '✓ At target';
  nrGapEl.className = 'gauge-gap ' + (nrGap > 0 ? gapClass(nrGap) : 'gap-small');

  // Overall score
  const scoreEl = $('#spring-overall-score');
  const statusEl = $('#spring-overall-status');
  scoreEl.textContent = overall + '%';

  const allMet = comm >= COMM_TARGET && mm <= MM_TARGET && nr <= NR_TARGET;
  if (allMet) {
    scoreEl.className = 'spring-score ready';
    statusEl.textContent = '⚡ Spring conditions met — verify EW structure';
  } else if (overall >= 60) {
    scoreEl.className = 'spring-score close';
    statusEl.textContent = 'Approaching — monitor closely';
  } else if (overall >= 35) {
    scoreEl.className = 'spring-score';
    statusEl.textContent = 'Building — re-accumulation in progress';
  } else {
    scoreEl.className = 'spring-score far';
    statusEl.textContent = 'Far from Spring — correction needed';
  }
}

// ── Flow KPIs ─────────────────────────────────────────────────────────────
function updateFlowKPIs() {
  // GLD
  const latest = GLD_DATA[GLD_DATA.length - 1];
  const prev   = GLD_DATA[GLD_DATA.length - 2];
  if (latest) {
    $('#kpi-gld-tonnes').textContent = latest.gld_tonnes != null ? latest.gld_tonnes.toFixed(0) + ' t' : '—';
    const chg = latest.gld_tonnes_chg;
    const el = $('#kpi-gld-chg');
    if (chg != null) {
      const sign = chg >= 0 ? '+' : '';
      el.textContent = sign + chg.toFixed(1) + ' t wk';
      el.className = 'kpi-signal ' + (chg >= 0 ? 'signal-bull' : 'signal-bear');
    } else {
      el.textContent = '—';
    }
  }

  // Central bank
  const latestCB = CB_DATA[CB_DATA.length - 1];
  if (latestCB) {
    $('#kpi-cb-net').textContent = '+' + latestCB.cb_net_t.toFixed(0) + ' t';
    $('#kpi-cb-period').textContent = latestCB.period;
    $('#kpi-cb-period').className = 'kpi-signal signal-neutral';
    $('#kpi-cb-total').textContent = (latestCB.cb_total_t / 1000).toFixed(1) + 'k t';
  }
}

function buildChartDefaults(c) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--surface-3').trim() || '#222',
        borderColor: c.grid,
        borderWidth: 1,
        titleColor: c.label,
        bodyColor: c.label,
        padding: 10,
        callbacks: {}
      }
    },
    scales: {
      x: {
        type: 'time',
        time: { unit: 'month', displayFormats: { month: 'MMM yy' } },
        grid: { color: c.grid, drawBorder: false },
        ticks: { color: c.tick, maxRotation: 0, font: { size: 10 } },
        border: { display: false }
      },
      y: {
        grid: { color: c.grid, drawBorder: false },
        ticks: { color: c.tick, font: { size: 10 } },
        border: { display: false }
      }
    }
  };
}

function buildCotIndexChart(data) {
  const c = getChartColors();
  const ctx = $('#cotIndexChart').getContext('2d');
  const labels = data.map(d => d.date);

  // Destroy existing
  if (window._charts.cotIndex) window._charts.cotIndex.destroy();

  const cfg = buildChartDefaults(c);

  // Add threshold annotations via dataset
  const bull80 = data.map(() => 80);
  const bear20 = data.map(() => 20);
  const mid50 = data.map(() => 50);

  cfg.scales.y = {
    ...cfg.scales.y,
    min: 0, max: 100,
    ticks: {
      ...cfg.scales.y.ticks,
      callback: v => v + '%',
      stepSize: 20,
    }
  };

  cfg.plugins.tooltip.callbacks.label = (ctx) => {
    return ` ${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)}%`;
  };

  window._charts.cotIndex = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Comm. Index',
          data: data.map(d => d.comm_cot_index),
          borderColor: c.gold,
          backgroundColor: c.goldDim,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.2,
          fill: false,
          order: 1,
        },
        {
          label: 'MM Index',
          data: data.map(d => d.mm_cot_index),
          borderColor: c.blue,
          backgroundColor: c.blueDim,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.2,
          fill: false,
          order: 2,
        },
        {
          label: 'Spec Index',
          data: data.map(d => d.other_cot_index),
          borderColor: c.purple,
          backgroundColor: c.purpleDim,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.2,
          fill: false,
          order: 3,
        },
        {
          label: 'NR Index',
          data: data.map(d => d.nr_cot_index),
          borderColor: c.orange,
          backgroundColor: 'rgba(253,171,67,0.12)',
          borderWidth: 1.5,
          borderDash: [5, 3],
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.2,
          fill: false,
          order: 4,
        },
        {
          label: 'Bull 80',
          data: bull80,
          borderColor: 'rgba(109,170,69,0.35)',
          borderWidth: 1,
          borderDash: [4, 4],
          pointRadius: 0,
          fill: false,
          order: 10,
          tooltip: { enabled: false }
        },
        {
          label: 'Bear 20',
          data: bear20,
          borderColor: 'rgba(221,105,116,0.35)',
          borderWidth: 1,
          borderDash: [4, 4],
          pointRadius: 0,
          fill: false,
          order: 11,
          tooltip: { enabled: false }
        },
        {
          label: 'Mid 50',
          data: mid50,
          borderColor: 'rgba(120,117,113,0.2)',
          borderWidth: 1,
          borderDash: [2, 4],
          pointRadius: 0,
          fill: false,
          order: 12,
          tooltip: { enabled: false }
        },
      ]
    },
    options: {
      ...cfg,
      plugins: {
        ...cfg.plugins,
        tooltip: {
          ...cfg.plugins.tooltip,
          filter: (item) => item.datasetIndex < 4
        }
      }
    }
  });
}

function buildNetPositionsChart(data) {
  const c = getChartColors();
  const ctx = $('#netPositionsChart').getContext('2d');
  const labels = data.map(d => d.date);

  if (window._charts.netPositions) window._charts.netPositions.destroy();

  const cfg = buildChartDefaults(c);
  cfg.scales.y.ticks.callback = v => {
    const abs = Math.abs(v);
    const sign = v < 0 ? '-' : v > 0 ? '+' : '';
    if (abs >= 1000) return sign + (abs / 1000).toFixed(0) + 'k';
    return sign + abs;
  };
  cfg.plugins.tooltip.callbacks.label = (ctx) => {
    const v = ctx.parsed.y;
    return ` ${ctx.dataset.label}: ${fmtNet(v)} contracts`;
  };

  // Zero line
  cfg.scales.y.grid = {
    ...cfg.scales.y.grid,
    color: (ctx) => ctx.tick.value === 0 ? 'rgba(120,117,113,0.5)' : getChartColors().grid
  };

  window._charts.netPositions = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Comm. Net',
          data: data.map(d => d.comm_net),
          borderColor: c.gold,
          backgroundColor: c.goldDim,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.2,
          fill: true,
        },
        {
          label: 'MM Net',
          data: data.map(d => d.mm_net),
          borderColor: c.blue,
          backgroundColor: c.blueDim,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.2,
          fill: true,
        },
        {
          label: 'Spec Net',
          data: data.map(d => d.other_net),
          borderColor: c.purple,
          backgroundColor: c.purpleDim,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.2,
          fill: true,
        },
        {
          label: 'NR Net',
          data: data.map(d => d.nr_net),
          borderColor: c.orange,
          backgroundColor: 'rgba(253,171,67,0.10)',
          borderWidth: 1.5,
          borderDash: [5, 3],
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.2,
          fill: true,
        },
      ]
    },
    options: cfg
  });
}


// ── ETF Holdings Chart ────────────────────────────────────────────────────
function buildETFChart() {
  const c = getChartColors();
  const ctx = $('#etfChart').getContext('2d');
  const labels = GLD_DATA.map(d => d.date);
  const tonnes  = GLD_DATA.map(d => d.gld_tonnes);
  const changes = GLD_DATA.map(d => d.gld_tonnes_chg);

  if (window._charts.etf) window._charts.etf.destroy();

  // Colour bars: inflow=teal/green, outflow=red
  const barColors = changes.map(v =>
    v == null ? 'transparent' :
    v >= 0 ? 'rgba(109,170,69,0.55)' : 'rgba(221,105,116,0.55)'
  );

  window._charts.etf = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        {
          type: 'line',
          label: 'Holdings (t)',
          data: tonnes,
          borderColor: c.gold,
          backgroundColor: 'rgba(255,196,0,0.08)',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.2,
          fill: true,
          yAxisID: 'yLeft',
          order: 1,
        },
        {
          type: 'bar',
          label: 'Weekly Chg (t)',
          data: changes,
          backgroundColor: barColors,
          borderRadius: 2,
          yAxisID: 'yRight',
          order: 2,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => {
              const v = item.raw;
              if (v == null) return null;
              if (item.dataset.label === 'Holdings (t)') return ' Holdings: ' + v.toFixed(0) + ' t';
              const sign = v >= 0 ? '+' : '';
              return ' Week chg: ' + sign + v.toFixed(1) + ' t';
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: c.grid },
          ticks: { color: c.tick, maxTicksLimit: 12, maxRotation: 0 }
        },
        yLeft: {
          position: 'left',
          grid: { color: c.grid },
          ticks: {
            color: c.tick,
            callback: v => v.toFixed(0) + ' t'
          },
          title: { display: true, text: 'Tonnes', color: c.tick, font: { size: 10 } }
        },
        yRight: {
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: {
            color: c.tick,
            callback: v => (v >= 0 ? '+' : '') + v.toFixed(0) + 't'
          },
          title: { display: true, text: 'Wk Chg (t)', color: c.tick, font: { size: 10 } }
        }
      }
    }
  });
}


// ── Central Bank Chart ────────────────────────────────────────────────────
function buildCBChart() {
  const c = getChartColors();
  const ctx = $('#cbChart').getContext('2d');
  const labels  = CB_DATA.map(d => d.period);
  const netBuys = CB_DATA.map(d => d.cb_net_t);
  const totals  = CB_DATA.map(d => d.cb_total_t);

  if (window._charts.cb) window._charts.cb.destroy();

  window._charts.cb = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        {
          type: 'line',
          label: 'World CB Holdings (t)',
          data: totals,
          borderColor: c.gold,
          backgroundColor: 'rgba(255,196,0,0.08)',
          borderWidth: 2.5,
          pointRadius: 4,
          pointHoverRadius: 6,
          tension: 0.25,
          fill: true,
          yAxisID: 'yLeft',
          order: 1,
        },
        {
          type: 'bar',
          label: 'Quarterly Net Purchases (t)',
          data: netBuys,
          backgroundColor: 'rgba(109,170,69,0.6)',
          borderColor: 'rgba(109,170,69,0.9)',
          borderWidth: 1,
          borderRadius: 3,
          yAxisID: 'yRight',
          order: 2,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => {
              const v = item.raw;
              if (item.dataset.label.includes('Holdings'))
                return ' World total: ' + v.toFixed(0) + ' t';
              return ' Quarterly buy: +' + v.toFixed(0) + ' t';
            },
            afterBody: (items) => {
              // Add note for estimated quarters
              const label = items[0]?.label || '';
              if (label === '2025-Q2' || label === '2025-Q3') {
                return ['\u26a0 WGC estimate (not yet finalised)'];
              }
              return [];
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: c.grid },
          ticks: { color: c.tick, maxRotation: 30, font: { size: 10 } }
        },
        yLeft: {
          position: 'left',
          grid: { color: c.grid },
          ticks: {
            color: c.tick,
            callback: v => (v / 1000).toFixed(1) + 'k t'
          },
          title: { display: true, text: 'Total Holdings (t)', color: c.tick, font: { size: 10 } }
        },
        yRight: {
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: {
            color: c.tick,
            callback: v => '+' + v.toFixed(0) + 't'
          },
          min: 0,
          title: { display: true, text: 'Net Purchases (t)', color: c.tick, font: { size: 10 } }
        }
      }
    }
  });
}


// ── Silver KPIs ───────────────────────────────────────────────────────────
function updateSilverKPIs() {
  if (!SILVER_DATA.length) return;
  const s = SILVER_DATA[SILVER_DATA.length - 1];
  // Latest silver spot from RATIO_DATA
  const ratioLatest = RATIO_DATA[RATIO_DATA.length - 1];

  $('#si-kpi-date').textContent    = s.date;
  $('#si-kpi-spot').textContent    = ratioLatest ? '$' + ratioLatest.silver_spot.toFixed(2) + '/oz' : '—';
  $('#si-kpi-oi').textContent      = s.oi.toLocaleString();
  $('#si-kpi-comm-net').textContent = s.comm_net.toLocaleString(undefined, {signDisplay:'always'});
  $('#si-kpi-mm-net').textContent   = s.mm_net.toLocaleString(undefined, {signDisplay:'always'});
  $('#si-kpi-nr-net').textContent   = s.nr_net.toLocaleString(undefined, {signDisplay:'always'});

  function setIdx(valEl, sigEl, val, bullishHigh) {
    $(valEl).textContent = val.toFixed(1) + '%';
    const [label, ] = getSignalLabel(val, bullishHigh);
    const el = $(sigEl);
    el.textContent = label;
    el.className = 'kpi-signal ' + getSignalClass(val, bullishHigh);
  }

  setIdx('#si-kpi-comm-idx', '#si-kpi-comm-sig', s.comm_cot_index, true);
  setIdx('#si-kpi-mm-idx',   '#si-kpi-mm-sig',   s.mm_cot_index,  false);
  setIdx('#si-kpi-nr-idx',   '#si-kpi-nr-sig',   s.nr_cot_index,  false);

  // SLV
  const slv = RATIO_DATA[RATIO_DATA.length - 1];
  if (slv && slv.slv_tonnes) {
    $('#si-kpi-slv-t').textContent = slv.slv_tonnes.toFixed(0) + ' t';
    const chg = slv.slv_tonnes_chg;
    const chgEl = $('#si-kpi-slv-chg');
    if (chg != null) {
      chgEl.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(0) + ' t wk';
      chgEl.className = 'kpi-signal ' + (chg >= 0 ? 'signal-bull' : 'signal-bear');
    }
  }
}

// Helper signal label (used by silver KPIs)
function getSignalLabel(val, bullishHigh) {
  if (bullishHigh) {
    if (val >= 80) return ['Crowded long', 'signal-bear'];
    if (val >= 60) return ['Bullish bias', 'signal-bull'];
    if (val >= 40) return ['Neutral', 'signal-neutral'];
    if (val >= 20) return ['Bearish bias', 'signal-bear'];
    return ['Crowded short', 'signal-bull'];
  } else {
    if (val >= 80) return ['Crowded long', 'signal-bear'];
    if (val >= 60) return ['Elevated', 'signal-neutral'];
    if (val >= 40) return ['Neutral', 'signal-neutral'];
    if (val >= 20) return ['Washing out', 'signal-bull'];
    return ['Extreme washout', 'signal-bull'];
  }
}
function getSignalClass(val, bullishHigh) {
  return getSignalLabel(val, bullishHigh)[1];
}


// ── Silver Spring Gauge ───────────────────────────────────────────────────
function updateSilverSpringGauge() {
  if (!SILVER_DATA.length) return;
  const s = SILVER_DATA[SILVER_DATA.length - 1];
  const comm = s.comm_cot_index, mm = s.mm_cot_index, nr = s.nr_cot_index;

  const COMM_T = 70, MM_T = 30, NR_T = 40;
  const commP = Math.min(comm / COMM_T * 100, 100);
  const mmP   = Math.min(Math.max((100 - mm) / (100 - MM_T) * 100, 0), 100);
  const nrP   = Math.min(Math.max((100 - nr) / (100 - NR_T) * 100, 0), 100);
  const overall = Math.round((commP + mmP + nrP) / 3);

  function gapClass(g) { return g > 30 ? 'gap-large' : g > 15 ? 'gap-medium' : 'gap-small'; }
  function barClass(p) { return p >= 85 ? 'ready' : p >= 60 ? 'close' : p >= 35 ? 'warn' : ''; }

  const setGauge = (barId, valId, gapId, progress, current, target, higher) => {
    const bar = $(barId);
    bar.style.width = progress.toFixed(1) + '%';
    bar.className = bar.className.replace(/ (ready|close|warn)/g,'') + ' ' + barClass(progress);
    $(valId).textContent = current.toFixed(1) + '%';
    const gap = higher ? Math.max(0, target - current) : Math.max(0, current - target);
    const gapEl = $(gapId);
    gapEl.textContent = gap > 0
      ? (higher ? '+' : '-') + gap.toFixed(0) + 'pts needed'
      : '✓ At target';
    gapEl.className = 'gauge-gap ' + (gap > 0 ? gapClass(gap) : 'gap-small');
  };

  setGauge('#si-gauge-bar-comm','#si-gauge-comm-val','#si-gauge-comm-gap', commP, comm, COMM_T, true);
  setGauge('#si-gauge-bar-mm',  '#si-gauge-mm-val',  '#si-gauge-mm-gap',   mmP,  mm,   MM_T,  false);
  setGauge('#si-gauge-bar-nr',  '#si-gauge-nr-val',  '#si-gauge-nr-gap',   nrP,  nr,   NR_T,  false);

  $('#si-spring-score').textContent = overall + '%';
  const allMet = comm >= COMM_T && mm <= MM_T && nr <= NR_T;
  if (allMet) {
    $('#si-spring-score').className = 'spring-score ready';
    $('#si-spring-status').textContent = '⚡ Spring conditions met';
  } else if (overall >= 60) {
    $('#si-spring-score').className = 'spring-score close';
    $('#si-spring-status').textContent = 'Approaching — monitor closely';
  } else if (overall >= 35) {
    $('#si-spring-score').className = 'spring-score';
    $('#si-spring-status').textContent = 'Building — re-accumulation in progress';
  } else {
    $('#si-spring-score').className = 'spring-score far';
    $('#si-spring-status').textContent = 'Far from Spring — correction needed';
  }
}


// ── Silver Charts ─────────────────────────────────────────────────────────
function buildSilverCotIndexChart() {
  const c = getChartColors();
  const ctx = $('#siCotIndexChart').getContext('2d');
  const labels = SILVER_DATA.map(d => d.date);
  const bull80 = SILVER_DATA.map(() => 80);
  const bear20 = SILVER_DATA.map(() => 20);
  const mid50  = SILVER_DATA.map(() => 50);

  if (window._charts.siCotIndex) window._charts.siCotIndex.destroy();
  window._charts.siCotIndex = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label:'Comm. Index', data: SILVER_DATA.map(d=>d.comm_cot_index), borderColor:c.teal, backgroundColor:c.tealDim, borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:0.2, fill:false, order:1 },
        { label:'MM Index',   data: SILVER_DATA.map(d=>d.mm_cot_index),   borderColor:c.blue, backgroundColor:c.blueDim,  borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:0.2, fill:false, order:2 },
        { label:'Spec Index', data: SILVER_DATA.map(d=>d.other_cot_index),borderColor:c.purple,backgroundColor:c.purpleDim,borderWidth:1.5,pointRadius:0,pointHoverRadius:4,tension:0.2,fill:false,order:3 },
        { label:'NR Index',   data: SILVER_DATA.map(d=>d.nr_cot_index),   borderColor:c.orange,backgroundColor:'rgba(253,171,67,0.12)',borderWidth:1.5,borderDash:[5,3],pointRadius:0,pointHoverRadius:4,tension:0.2,fill:false,order:4 },
        { label:'Bull 80', data:bull80, borderColor:'rgba(109,170,69,0.35)', borderWidth:1, pointRadius:0, borderDash:[4,4], fill:false, order:5 },
        { label:'Bear 20', data:bear20, borderColor:'rgba(221,105,116,0.35)',borderWidth:1, pointRadius:0, borderDash:[4,4], fill:false, order:6 },
        { label:'Mid 50',  data:mid50,  borderColor:'rgba(160,160,160,0.2)', borderWidth:1, pointRadius:0, borderDash:[2,4], fill:false, order:7 },
      ]
    },
    options: { ...buildChartDefaults(c), plugins: { ...buildChartDefaults(c).plugins, tooltip: { ...buildChartDefaults(c).plugins.tooltip, filter: item => item.datasetIndex < 4 } } }
  });
}

function buildSilverNetChart() {
  const c = getChartColors();
  const ctx = $('#siNetChart').getContext('2d');
  if (window._charts.siNet) window._charts.siNet.destroy();
  window._charts.siNet = new Chart(ctx, {
    type: 'line',
    data: {
      labels: SILVER_DATA.map(d => d.date),
      datasets: [
        { label:'Comm. Net', data:SILVER_DATA.map(d=>d.comm_net), borderColor:c.teal,   backgroundColor:c.tealDim,   borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:0.2, fill:true },
        { label:'MM Net',    data:SILVER_DATA.map(d=>d.mm_net),   borderColor:c.blue,   backgroundColor:c.blueDim,   borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:0.2, fill:true },
        { label:'Spec Net',  data:SILVER_DATA.map(d=>d.other_net),borderColor:c.purple, backgroundColor:c.purpleDim, borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:0.2, fill:true },
        { label:'NR Net',    data:SILVER_DATA.map(d=>d.nr_net),   borderColor:c.orange, backgroundColor:'rgba(253,171,67,0.10)', borderWidth:1.5, borderDash:[5,3], pointRadius:0, pointHoverRadius:4, tension:0.2, fill:true },
      ]
    },
    options: buildChartDefaults(c)
  });
}

function buildSilverSLVChart() {
  const c = getChartColors();
  const ctx = $('#siSlvChart').getContext('2d');
  const barColors = RATIO_DATA.map(d => d.slv_tonnes_chg == null ? 'transparent' : d.slv_tonnes_chg >= 0 ? 'rgba(109,170,69,0.55)' : 'rgba(221,105,116,0.55)');
  if (window._charts.siSlv) window._charts.siSlv.destroy();
  window._charts.siSlv = new Chart(ctx, {
    data: {
      labels: RATIO_DATA.map(d => d.date),
      datasets: [
        { type:'line', label:'Holdings (t)', data:RATIO_DATA.map(d=>d.slv_tonnes), borderColor:c.gold, backgroundColor:'rgba(255,196,0,0.08)', borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:0.2, fill:true, yAxisID:'yLeft', order:1 },
        { type:'bar',  label:'Weekly Chg (t)', data:RATIO_DATA.map(d=>d.slv_tonnes_chg), backgroundColor:barColors, borderRadius:2, yAxisID:'yRight', order:2 },
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      interaction:{ mode:'index', intersect:false },
      plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label: item => item.dataset.label==='Holdings (t)' ? ' Holdings: '+item.raw.toFixed(0)+' t' : ' Wk chg: '+(item.raw>=0?'+':'')+item.raw.toFixed(0)+' t' }}},
      scales:{
        x:{ grid:{color:c.grid}, ticks:{color:c.tick,maxTicksLimit:12,maxRotation:0} },
        yLeft:{  position:'left',  grid:{color:c.grid}, ticks:{color:c.tick, callback:v=>v.toFixed(0)+' t'} },
        yRight:{ position:'right', grid:{drawOnChartArea:false}, ticks:{color:c.tick, callback:v=>(v>=0?'+':'')+v.toFixed(0)+'t'} }
      }
    }
  });
}

function renderSilver() {
  updateSilverKPIs();
  updateSilverSpringGauge();
  buildSilverCotIndexChart();
  buildSilverNetChart();
  buildSilverSLVChart();
}


// ── Ratio Panel ───────────────────────────────────────────────────────────
function updateRatioKPIs() {
  if (!RATIO_DATA.length) return;
  const latest = RATIO_DATA[RATIO_DATA.length - 1];
  const last52  = RATIO_DATA.slice(-52);
  const hi52 = Math.max(...last52.map(d=>d.gs_ratio));
  const lo52 = Math.min(...last52.map(d=>d.gs_ratio));
  const pct52 = ((latest.gs_ratio - lo52) / (hi52 - lo52) * 100).toFixed(0);

  $('#r-kpi-ratio').textContent  = latest.gs_ratio.toFixed(1);
  $('#r-kpi-hi').textContent     = hi52.toFixed(1);
  $('#r-kpi-lo').textContent     = lo52.toFixed(1);
  $('#r-kpi-pct').textContent    = pct52 + '%';
  $('#r-kpi-gold').textContent   = '$' + latest.gold_spot.toLocaleString(undefined,{maximumFractionDigits:0}) + '/oz';
  $('#r-kpi-silver').textContent = '$' + latest.silver_spot.toFixed(2) + '/oz';

  const sig = $('#r-kpi-ratio-sig');
  if (latest.gs_ratio >= 80) { sig.textContent='Extreme — silver historically cheap'; sig.className='kpi-signal signal-bull'; }
  else if (latest.gs_ratio >= 65) { sig.textContent='Elevated — watch for compression'; sig.className='kpi-signal signal-neutral'; }
  else if (latest.gs_ratio >= 50) { sig.textContent='Neutral range'; sig.className='kpi-signal signal-neutral'; }
  else { sig.textContent='Low — gold relatively cheap'; sig.className='kpi-signal signal-bear'; }

  // Latest COT commercial indices
  const goldLatest   = window._goldDisplayData ? window._goldDisplayData[window._goldDisplayData.length-1] : null;
  const silverLatest = SILVER_DATA[SILVER_DATA.length-1];
  if (goldLatest)   $('#r-kpi-gold-comm').textContent   = goldLatest.comm_cot_index.toFixed(1) + '%';
  if (silverLatest) $('#r-kpi-silver-comm').textContent = silverLatest.comm_cot_index.toFixed(1) + '%';
}

function buildRatioChart() {
  const c = getChartColors();
  const ctx = $('#ratioChart').getContext('2d');
  const labels = RATIO_DATA.map(d=>d.date);
  const ratios = RATIO_DATA.map(d=>d.gs_ratio);
  if (window._charts.ratio) window._charts.ratio.destroy();
  window._charts.ratio = new Chart(ctx, {
    type:'line',
    data:{
      labels,
      datasets:[
        { label:'G/S Ratio', data:ratios, borderColor:c.gold, backgroundColor:'rgba(255,196,0,0.07)', borderWidth:2.5, pointRadius:0, pointHoverRadius:5, tension:0.2, fill:true, order:1 },
        { label:'Extreme (80)', data:labels.map(()=>80), borderColor:'rgba(221,105,116,0.5)', borderWidth:1.5, borderDash:[4,4], pointRadius:0, fill:false, order:2 },
        { label:'Elevated (65)',data:labels.map(()=>65), borderColor:'rgba(253,171,67,0.5)',  borderWidth:1,   borderDash:[4,4], pointRadius:0, fill:false, order:3 },
        { label:'Neutral (50)', data:labels.map(()=>50), borderColor:'rgba(160,160,160,0.3)', borderWidth:1,   borderDash:[2,4], pointRadius:0, fill:false, order:4 },
      ]
    },
    options:{ ...buildChartDefaults(c), plugins:{ ...buildChartDefaults(c).plugins, tooltip:{ ...buildChartDefaults(c).plugins.tooltip, filter: item => item.datasetIndex === 0 } } }
  });
}

function buildRatioCotChart() {
  const c = getChartColors();
  const ctx = $('#ratioCotChart').getContext('2d');
  // Align by date — gold COT data vs silver COT data
  const goldData   = window._goldDisplayData || [];
  const silverData = SILVER_DATA;
  // Build merged date labels from gold (authoritative)
  const labels = goldData.map(d=>d.date);
  const goldComm   = goldData.map(d=>d.comm_cot_index);
  const silverComm = labels.map(l => { const s=silverData.find(d=>d.date===l); return s ? s.comm_cot_index : null; });

  if (window._charts.ratioCot) window._charts.ratioCot.destroy();
  window._charts.ratioCot = new Chart(ctx, {
    type:'line',
    data:{
      labels,
      datasets:[
        { label:'Gold Comm. Index',   data:goldComm,   borderColor:c.gold,     backgroundColor:'rgba(255,196,0,0.06)', borderWidth:2.5, pointRadius:0, pointHoverRadius:4, tension:0.2, fill:false },
        { label:'Silver Comm. Index', data:silverComm, borderColor:'#c0c0c0',  backgroundColor:'rgba(192,192,192,0.06)', borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:0.2, fill:false, borderDash:[5,3] },
        { label:'Bull 80', data:labels.map(()=>80), borderColor:'rgba(109,170,69,0.3)',  borderWidth:1, borderDash:[4,4], pointRadius:0, fill:false },
        { label:'Bear 20', data:labels.map(()=>20), borderColor:'rgba(221,105,116,0.3)', borderWidth:1, borderDash:[4,4], pointRadius:0, fill:false },
      ]
    },
    options:{ ...buildChartDefaults(c), plugins:{ ...buildChartDefaults(c).plugins, tooltip:{ ...buildChartDefaults(c).plugins.tooltip, filter: item => item.datasetIndex < 2 } } }
  });
}

function buildRatioEtfChart() {
  const c = getChartColors();
  const ctx = $('#ratioEtfChart').getContext('2d');
  // Normalise both to index 100 from first available
  const gldData = GLD_DATA.filter(d=>d.gld_tonnes != null);
  const slvData = RATIO_DATA.filter(d=>d.slv_tonnes != null);
  const gldBase = gldData[0].gld_tonnes;
  const slvBase = slvData[0].slv_tonnes;
  const labels  = gldData.map(d=>d.date);
  const gldIdx  = gldData.map(d=>(d.gld_tonnes/gldBase*100).toFixed(2));
  const slvIdx  = labels.map(l=>{ const s=slvData.find(d=>d.date===l); return s ? (s.slv_tonnes/slvBase*100).toFixed(2) : null; });

  if (window._charts.ratioEtf) window._charts.ratioEtf.destroy();
  window._charts.ratioEtf = new Chart(ctx, {
    type:'line',
    data:{
      labels,
      datasets:[
        { label:'GLD (indexed)', data:gldIdx, borderColor:c.gold,  backgroundColor:'rgba(255,196,0,0.07)',   borderWidth:2.5, pointRadius:0, pointHoverRadius:4, tension:0.2, fill:true },
        { label:'SLV (indexed)', data:slvIdx, borderColor:'#c0c0c0',backgroundColor:'rgba(192,192,192,0.07)',borderWidth:2,   pointRadius:0, pointHoverRadius:4, tension:0.2, fill:true },
        { label:'Base (100)',    data:labels.map(()=>100), borderColor:'rgba(160,160,160,0.25)', borderWidth:1, borderDash:[3,4], pointRadius:0, fill:false },
      ]
    },
    options:{ ...buildChartDefaults(c), plugins:{ ...buildChartDefaults(c).plugins, tooltip:{ ...buildChartDefaults(c).plugins.tooltip, filter: item => item.datasetIndex < 2 } } }
  });
}

function renderRatio() {
  updateRatioKPIs();
  buildRatioChart();
  buildRatioCotChart();
  buildRatioEtfChart();
}

function buildOIChart(data) {
  const c = getChartColors();
  const ctx = $('#oiChart').getContext('2d');
  const labels = data.map(d => d.date);

  if (window._charts.oi) window._charts.oi.destroy();

  const cfg = buildChartDefaults(c);
  cfg.scales.y.ticks.callback = v => (v / 1000).toFixed(0) + 'k';
  cfg.plugins.tooltip.callbacks.label = (ctx) => ` OI: ${fmt(ctx.parsed.y)} contracts`;

  // Create gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, 200);
  gradient.addColorStop(0, 'rgba(232,175,52,0.25)');
  gradient.addColorStop(1, 'rgba(232,175,52,0.02)');

  window._charts.oi = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Open Interest',
        data: data.map(d => d.open_interest),
        borderColor: c.gold,
        backgroundColor: gradient,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.2,
        fill: true,
      }]
    },
    options: cfg
  });
}

function buildGrossCommChart(data) {
  const c = getChartColors();
  const ctx = $('#grossCommChart').getContext('2d');
  const labels = data.map(d => d.date);

  if (window._charts.grossComm) window._charts.grossComm.destroy();

  const cfg = buildChartDefaults(c);
  cfg.scales.y.ticks.callback = v => (v / 1000).toFixed(0) + 'k';
  cfg.plugins.tooltip.callbacks.label = (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)} contracts`;

  window._charts.grossComm = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Comm. Long',
          data: data.map(d => d.comm_long + d.swap_long),
          borderColor: c.green,
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 3,
          tension: 0.2,
        },
        {
          label: 'Comm. Short',
          data: data.map(d => -(d.comm_short + d.swap_short)),
          borderColor: c.red,
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 3,
          tension: 0.2,
        },
      ]
    },
    options: {
      ...cfg,
      scales: {
        ...cfg.scales,
        y: {
          ...cfg.scales.y,
          ticks: {
            ...cfg.scales.y.ticks,
            callback: v => {
              const abs = Math.abs(v);
              const sign = v < 0 ? '-' : '';
              return sign + (abs / 1000).toFixed(0) + 'k';
            }
          }
        }
      }
    }
  });
}

function updateChartTheme() {
  const data = getDisplayData();
  buildCotIndexChart(data);
  buildNetPositionsChart(data);
  buildOIChart(data);
  buildGrossCommChart(data);
  buildETFChart();
  buildCBChart();
}

// ── Table ─────────────────────────────────────────────────────────────────────
function buildTable(data) {
  const tbody = $('#table-body');
  const rows = [...data].reverse().slice(0, 52);
  tbody.innerHTML = rows.map(d => {
    const ci = d.comm_cot_index;
    const mi = d.mm_cot_index;
    const oi = d.other_cot_index;
    const ni = d.nr_cot_index;
    return `<tr>
      <td>${d.date}</td>
      <td>${fmt(d.open_interest)}</td>
      <td class="${d.comm_net >= 0 ? 'net-pos' : 'net-neg'}">${fmtNet(d.comm_net)}</td>
      <td class="${idxClass(ci)}">${fmtIdx(ci)}</td>
      <td class="${d.mm_net >= 0 ? 'net-pos' : 'net-neg'}">${fmtNet(d.mm_net)}</td>
      <td class="${idxClass(mi)}">${fmtIdx(mi)}</td>
      <td class="${d.other_net >= 0 ? 'net-pos' : 'net-neg'}">${fmtNet(d.other_net)}</td>
      <td class="${idxClass(oi)}">${fmtIdx(oi)}</td>
      <td class="${d.nr_net >= 0 ? 'net-pos' : 'net-neg'}">${fmtNet(d.nr_net)}</td>
      <td class="${idxClass(ni)}">${fmtIdx(ni)}</td>
    </tr>`;
  }).join('');
}

// ── Export CSV ────────────────────────────────────────────────────────────────
function exportCSV() {
  const data = getDisplayData();
  const headers = ['Date','Open_Interest','Comm_Net','Comm_COT_Index_%','MM_Net','MM_COT_Index_%','Spec_Net','Spec_COT_Index_%','NR_Net','NR_COT_Index_%'];
  const rows = data.map(d => [
    d.date, d.open_interest, d.comm_net,
    d.comm_cot_index?.toFixed(1),
    d.mm_net, d.mm_cot_index?.toFixed(1),
    d.other_net, d.other_cot_index?.toFixed(1),
    d.nr_net, d.nr_cot_index?.toFixed(1)
  ].join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gold_cot_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Period selector ───────────────────────────────────────────────────────────
$$('.period-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    period = parseInt(btn.dataset.weeks);
    
    const label = period === 104 ? 'All Data' : `${period}-Week`;
    $('#period-label').textContent = label;
    
    render();
  });
});

// ── Export button ─────────────────────────────────────────────────────────────
$('#export-btn')?.addEventListener('click', exportCSV);

// ── Main render ───────────────────────────────────────────────────────────────
function render() {
  const data = getDisplayData();
  window._goldDisplayData = data;
  updateKPIs(data);
  updateFlowKPIs();
  updateSpringGauge(data);
  buildCotIndexChart(data);
  buildNetPositionsChart(data);
  buildOIChart(data);
  buildGrossCommChart(data);
  buildETFChart();
  buildCBChart();
  buildTable(data);
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  $('#status-dot').className = 'status-dot';
  $('#status-text').textContent = 'Loading COT data…';

  const ok = await loadData();
  if (!ok || allData.length === 0) {
    $('#status-dot').className = 'status-dot error';
    $('#status-text').textContent = 'Failed to load data';
    return;
  }

  render();
}

init();

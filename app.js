/* ============================================================
   Mapping the Modern Agora — front-end app
   D3 v7 + topojson-client v3
   ============================================================ */

// ----- color scales -----
const QUINTILE_COLORS = ['#f0e7d3', '#e3c98a', '#d2a44c', '#a87520', '#5a3a08'];
const QUINTILE_LABELS = ['Lowest', 'Low', 'Mid', 'High', 'Highest'];

// Categorical scheme for primary org type
const PRIM_TYPES = [
  'Religious', 'Social & Fraternal', 'Youth', 'Hobby & Sports', 'Healthcare',
  'Community', 'Education', 'Economic', 'Arts & Cultural', 'Professional',
  'Political', 'Unions', 'Foundations', 'Research & Think Tank', 'Housing'
];
const PRIM_PALETTE = {
  'Social & Fraternal': '#0a2540',
  'Religious':          '#c9a24a',
  'Youth':              '#7a8da3',
  'Hobby & Sports':     '#a87520',
  'Healthcare':         '#4a6b8a',
  'Community':          '#8a6b1f',
  'Education':          '#3d5a7a',
  'Economic':           '#d2a44c',
  'Arts & Cultural':    '#5a3a08',
  'Professional':       '#1a3a5f',
  'Political':          '#e3c98a',
  'Unions':             '#2c4a6a',
  'Foundations':        '#b58500',
  'Research & Think Tank': '#6b7d92',
  'Housing':            '#465a72'
};

// Pretty state names for sidebar
const STATE_NAMES = {
  AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California',
  CO:'Colorado', CT:'Connecticut', DE:'Delaware', DC:'District of Columbia',
  FL:'Florida', GA:'Georgia', HI:'Hawaii', ID:'Idaho', IL:'Illinois',
  IN:'Indiana', IA:'Iowa', KS:'Kansas', KY:'Kentucky', LA:'Louisiana',
  ME:'Maine', MD:'Maryland', MA:'Massachusetts', MI:'Michigan',
  MN:'Minnesota', MS:'Mississippi', MO:'Missouri', MT:'Montana',
  NE:'Nebraska', NV:'Nevada', NH:'New Hampshire', NJ:'New Jersey',
  NM:'New Mexico', NY:'New York', NC:'North Carolina', ND:'North Dakota',
  OH:'Ohio', OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island',
  SC:'South Carolina', SD:'South Dakota', TN:'Tennessee', TX:'Texas',
  UT:'Utah', VT:'Vermont', VA:'Virginia', WA:'Washington', WV:'West Virginia',
  WI:'Wisconsin', WY:'Wyoming', PR:'Puerto Rico'
};

// ----- formatting helpers -----
const fmt = d3.format(',');
const fmt1 = d3.format(',.1f');
const fmtPct = (v) => (v == null ? '—' : fmt1(v) + '%');

// ----- state -----
let DATA = null;       // baked county data
let TOPO = null;       // us-atlas topojson
let COUNTY_NAMES = {}; // FIPS → "County Name"
let CURRENT_LAYER = 'index';
let SELECTED_FIPS = null;

// ============================================================
//  BOOT
// ============================================================
async function boot() {
  try {
    const [data, topo] = await Promise.all([
      fetch('agora_data.json').then(r => r.json()),
      fetch('https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/counties-albers-10m.json').then(r => r.json())
    ]);
    DATA = data;
    TOPO = topo;

    // Build name lookup from topojson
    topo.objects.counties.geometries.forEach(g => {
      // pad FIPS to 5 chars
      const f = String(g.id).padStart(5, '0');
      COUNTY_NAMES[f] = g.properties.name;
    });

    // Update n_civic_orgs in the about section
    const civicEl = document.getElementById('stat-civic');
    if (civicEl && DATA.summary?.n_civic_orgs) {
      const v = DATA.summary.n_civic_orgs;
      // round to nearest 1k
      civicEl.innerHTML = (Math.round(v/1000)).toLocaleString() + '<em>k</em>';
    }

    drawMap();
    drawLegend();
    drawUCurve();
    drawCorrelations();
    drawRegional();
    drawRanking();
    bindUI();

    document.getElementById('map-loading').classList.add('hidden');
  } catch (err) {
    console.error('Boot failed:', err);
    document.getElementById('map-loading').textContent = 'Failed to load map data — check your connection';
  }
}

// ============================================================
//  MAP
// ============================================================
function drawMap() {
  const svg = d3.select('#map-svg');
  svg.selectAll('*').remove();

  const path = d3.geoPath();
  const counties = topojson.feature(TOPO, TOPO.objects.counties);
  const states = topojson.mesh(TOPO, TOPO.objects.states, (a,b) => a !== b);
  const nation = topojson.mesh(TOPO, TOPO.objects.nation);

  const g = svg.append('g');

  // Counties
  g.append('g')
    .selectAll('path')
    .data(counties.features)
    .join('path')
    .attr('class', 'county')
    .attr('d', path)
    .attr('fill', d => fillForCounty(d))
    .on('mouseenter', (event, d) => onCountyHover(event, d, true))
    .on('mousemove', (event, d) => onCountyHover(event, d, true))
    .on('mouseleave', (event, d) => onCountyHover(event, d, false))
    .on('click', (event, d) => selectCounty(getFips(d)));

  g.append('path')
    .datum(states)
    .attr('class', 'state')
    .attr('d', path);

  g.append('path')
    .datum(nation)
    .attr('class', 'nation')
    .attr('d', path);
}

function getFips(feature) {
  return String(feature.id).padStart(5, '0');
}

function fillForCounty(feature) {
  const fips = getFips(feature);
  const c = DATA.counties[fips];
  if (!c) return '#e8e2d4'; // grey for missing
  if (CURRENT_LAYER === 'index') {
    return QUINTILE_COLORS[(c.opp_idx || 1) - 1] || '#e8e2d4';
  } else {
    const prim = c.prim || (c.types && c.types.length ? c.types[0].c : null);
    return PRIM_PALETTE[prim] || '#e8e2d4';
  }
}

function recolorMap() {
  d3.selectAll('#map-svg path.county').attr('fill', d => fillForCounty(d));
}

// ----- tooltip -----
const tooltip = d3.select('#tooltip');
function onCountyHover(event, feature, show) {
  const fips = getFips(feature);
  const c = DATA.counties[fips];
  const name = COUNTY_NAMES[fips] || 'Unknown';
  if (!show || !c) {
    tooltip.classed('visible', false);
    return;
  }
  let stat;
  if (CURRENT_LAYER === 'index') {
    stat = `${fmt1(c.opp_score)} per 100k · Quintile ${c.opp_idx}`;
  } else {
    const prim = c.prim || (c.types && c.types.length ? c.types[0].c : null);
    stat = prim ? `Primary type: ${prim}` : 'No civic orgs';
  }
  tooltip
    .html(`<span class="tt-name">${name} County, ${c.st}</span><span class="tt-stat">${stat}</span>`)
    .classed('visible', true)
    .style('left', (event.clientX + 14) + 'px')
    .style('top',  (event.clientY + 14) + 'px');
}

// ============================================================
//  LEGEND
// ============================================================
function drawLegend() {
  const el = document.getElementById('map-legend');
  if (CURRENT_LAYER === 'index') {
    el.innerHTML = `
      <h4>Civic Opportunity Index</h4>
      <div class="legend-bar">
        ${QUINTILE_COLORS.map(c => `<div style="background:${c}"></div>`).join('')}
      </div>
      <div class="legend-labels">
        <span>Lowest 20%</span>
        <span>Highest 20%</span>
      </div>
    `;
  } else {
    // Show top types from national share
    const topTypes = Object.entries(DATA.stories.national_primary_pct)
      .sort((a,b) => b[1] - a[1])
      .slice(0, 8);
    el.innerHTML = `
      <h4>Most Common Org Type</h4>
      <div class="legend-categorical">
        ${topTypes.map(([t,p]) => `
          <div><span style="background:${PRIM_PALETTE[t] || '#999'}"></span>${t} (${p}%)</div>
        `).join('')}
      </div>
    `;
  }
}

// ============================================================
//  SIDEBAR
// ============================================================
function selectCounty(fips) {
  const c = DATA.counties[fips];
  if (!c) return;
  SELECTED_FIPS = fips;

  // Visual highlight
  d3.selectAll('#map-svg path.county').classed('selected', d => getFips(d) === fips);

  // Header
  const name = COUNTY_NAMES[fips] || 'County';
  document.getElementById('sb-name').textContent = name + ' County';
  document.getElementById('sb-state').textContent = (STATE_NAMES[c.st] || c.st).toUpperCase() + ' · FIPS ' + fips;

  // Body
  document.getElementById('sb-body').innerHTML = renderSidebarBody(c);

  // Open
  const sb = document.getElementById('sidebar');
  sb.classList.add('open');
  sb.setAttribute('aria-hidden', 'false');
}

function renderSidebarBody(c) {
  // Quintile pips
  const pips = Array.from({length: 5}, (_, i) =>
    `<div class="${i < c.opp_idx ? 'on' : ''}"></div>`
  ).join('');

  // Percentile expressed as "Top X%"
  const topPct = c.pct == null ? '—' : (c.pct <= 50 ? `Top ${fmt1(c.pct)}%` : `Bottom ${fmt1(100 - c.pct)}%`);

  // Type breakdown — top 6
  const types = (c.types || []).slice(0, 8);
  const maxN = types.length ? types[0].n : 1;
  const typeBars = types.length === 0
    ? '<div style="font-family:var(--mono);font-size:11px;color:var(--ink-faint)">No civic-opportunity organizations identified.</div>'
    : types.map((t, i) => `
        <div class="sb-bar ${i === 0 ? 'primary' : ''}">
          <span class="lab">${t.c}</span>
          <span class="track"><span class="fill" style="width:${(t.n / maxN * 100).toFixed(1)}%"></span></span>
          <span class="num">${t.n}</span>
        </div>
      `).join('');

  // Civic opportunity subtype bars (membership / volunteer / events / take action)
  const subOpps = [
    {label: 'Membership',    n: c.mem_n, pc: c.mem_pc},
    {label: 'Volunteer',     n: c.vol_n, pc: c.vol_pc},
    {label: 'Public Events', n: c.evt_n, pc: c.evt_pc},
    {label: 'Take Action',   n: c.act_n, pc: c.act_pc}
  ];
  const maxOpp = Math.max(1, ...subOpps.map(s => s.pc || 0));
  const oppBars = subOpps.map(s => `
    <div class="sb-bar">
      <span class="lab">${s.label}</span>
      <span class="track"><span class="fill" style="width:${((s.pc || 0) / maxOpp * 100).toFixed(1)}%"></span></span>
      <span class="num">${s.n}</span>
    </div>
  `).join('');

  return `
    <div class="sb-score-block">
      <div class="sb-score-num">${c.opp_score == null ? '—' : fmt1(c.opp_score)}</div>
      <div>
        <div class="sb-score-label">Civic Opportunity per 100k</div>
        <div class="sb-quintile-pips">${pips}</div>
        <div class="sb-rank">
          <strong>${topPct}</strong> nationally ·
          <strong>#${c.state_rank}</strong> of ${c.state_n} in state
        </div>
      </div>
    </div>

    <div class="sb-section-title">Snapshot</div>
    <div class="sb-grid">
      <div class="sb-stat"><span class="l">Population</span><div class="v">${fmt(c.pop)}</div></div>
      <div class="sb-stat"><span class="l">Total Nonprofits</span><div class="v">${fmt(c.n)}</div></div>
      <div class="sb-stat"><span class="l">Civic Opportunity Orgs</span><div class="v">${fmt(c.civic_org)}</div></div>
      <div class="sb-stat"><span class="l">National Rank</span><div class="v">#${fmt(c.nat_rank)}<span class="vsub">/ ${fmt(DATA.summary.n_counties)}</span></div></div>
    </div>

    <div class="sb-section-title">Civic Opportunity Types</div>
    <div class="sb-bars">${oppBars}</div>

    <div class="sb-section-title">Organization Mix · Top Categories</div>
    <div class="sb-bars">${typeBars}</div>

    <div class="sb-section-title">Community Context</div>
    <div class="sb-grid">
      <div class="sb-stat"><span class="l">Poverty rate (150% FPL)</span><div class="v">${fmtPct(c.pov)}</div></div>
      <div class="sb-stat"><span class="l">No HS diploma</span><div class="v">${fmtPct(c.edu)}</div></div>
      <div class="sb-stat"><span class="l">Unemployment</span><div class="v">${fmtPct(c.unp)}</div></div>
      <div class="sb-stat"><span class="l">No broadband</span><div class="v">${fmtPct(c.brd)}</div></div>
      <div class="sb-stat"><span class="l">Single-parent HHs</span><div class="v">${fmtPct(c.sng)}</div></div>
      <div class="sb-stat"><span class="l">Minority share</span><div class="v">${fmtPct(c.min)}</div></div>
    </div>
  `;
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar').setAttribute('aria-hidden', 'true');
  d3.selectAll('#map-svg path.county').classed('selected', false);
  SELECTED_FIPS = null;
}

// ============================================================
//  STORY 1 — U-curve bar chart
// ============================================================
function drawUCurve() {
  const data = DATA.stories.ucurve;
  const max = d3.max(data, d => d.median);
  const wrap = document.getElementById('ucurve');
  wrap.innerHTML = data.map(d => {
    const h = (d.median / max * 92);
    return `
      <div class="bar">
        <div style="flex:1; display:flex; align-items:flex-end; width:100%;">
          <div class="col" style="height:${h}%; width:100%">
            <span class="val">${fmt1(d.median)}</span>
          </div>
        </div>
        <div class="lab">${d.label}<br><span style="opacity:.6">${formatPopRange(d.pop_min, d.pop_max)}</span></div>
      </div>
    `;
  }).join('');
}
function formatPopRange(min, max) {
  const s = (n) => n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? Math.round(n/1e3)+'k' : n;
  return `${s(min)}–${s(max)}`;
}

// ============================================================
//  STORY 2 — Adversity correlations
// ============================================================
function drawCorrelations() {
  const data = DATA.stories.adversity;
  const maxAbs = d3.max(data, d => Math.abs(d.r));
  const wrap = document.getElementById('corr-list');
  wrap.innerHTML = data.map(d => {
    // axis: 0 in middle, fill from middle
    const widthPct = (Math.abs(d.r) / 0.6 * 50);
    const left = d.r < 0 ? (50 - widthPct) : 50;
    return `
      <div class="corr-row">
        <span class="l">${d.label}</span>
        <span class="axis">
          <span class="fill" style="left:${left}%; width:${widthPct}%"></span>
        </span>
        <span class="v">${d.r > 0 ? '+' : ''}${d.r.toFixed(2)}</span>
      </div>
    `;
  }).join('');
}

// ============================================================
//  STORY 3 — Regional / state primary type
// ============================================================
function drawRegional() {
  const data = DATA.stories.state_primary;
  const rows = Object.entries(data)
    .map(([state, info]) => ({state, ...info}))
    .filter(r => STATE_NAMES[r.state]) // skip unknown
    .sort((a, b) => {
      // Group by primary type then by state
      if (a.top !== b.top) {
        const order = {'Religious': 0, 'Social & Fraternal': 1};
        return (order[a.top] ?? 99) - (order[b.top] ?? 99) || a.top.localeCompare(b.top);
      }
      return b.n - a.n;
    });
  const wrap = document.getElementById('region-list');
  wrap.innerHTML = rows.map(r => `
    <div class="region-row">
      <span class="st">${r.state}</span>
      <span class="typ" style="--dot:${PRIM_PALETTE[r.top] || '#999'}">
        <style scoped></style>
        ${r.top}
      </span>
      <span class="num">${r.n} cnty</span>
    </div>
  `).join('');

  // Set the dot color via inline style on each ::before (CSS variable trick alt: direct inline)
  // Simpler: just inject inline-styled spans
  document.querySelectorAll('#region-list .typ').forEach((el, i) => {
    const color = PRIM_PALETTE[rows[i].top] || '#999';
    el.style.setProperty('--dot', color);
  });
}
// Override .typ::before to use --dot via stylesheet:
const styleEl = document.createElement('style');
styleEl.textContent = `.region-row .typ::before { background: var(--dot, var(--gold-deep)) !important; }`;
document.head.appendChild(styleEl);

// ============================================================
//  STORY 4 — Top / Bottom 10
// ============================================================
let RANK_TAB = 'top';
function drawRanking() {
  const data = RANK_TAB === 'top' ? DATA.stories.top10 : DATA.stories.bot10;
  const wrap = document.getElementById('rank-table');
  wrap.innerHTML = data.map((r, i) => {
    const name = COUNTY_NAMES[r.fips] || `FIPS ${r.fips}`;
    return `
      <div class="rank-row" data-fips="${r.fips}" style="cursor:pointer">
        <span class="rk">${i + 1}</span>
        <span class="nm">${name}<small>${r.state}</small></span>
        <span class="pop">${formatPopShort(r.pop)}</span>
        <span class="sc">${fmt1(r.score)}</span>
      </div>
    `;
  }).join('');
  // Click to open county on map
  wrap.querySelectorAll('.rank-row').forEach(el => {
    el.addEventListener('click', () => {
      const fips = el.dataset.fips;
      selectCounty(fips);
      document.getElementById('map').scrollIntoView({behavior: 'smooth', block: 'start'});
    });
  });
}
function formatPopShort(n) {
  if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
  if (n >= 1e3) return Math.round(n/1e3) + 'k';
  return String(n);
}

// ============================================================
//  UI bindings
// ============================================================
function bindUI() {
  // Layer toggle
  document.querySelectorAll('.layer-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.layer-toggle button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      CURRENT_LAYER = btn.dataset.layer;
      recolorMap();
      drawLegend();
    });
  });

  // Sidebar close
  document.getElementById('sb-close').addEventListener('click', closeSidebar);

  // Esc key closes sidebar
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSidebar();
  });

  // Rank table tabs
  document.querySelectorAll('.rank-tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rank-tabs button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      RANK_TAB = btn.dataset.tab;
      drawRanking();
    });
  });
}

// Go!
boot();

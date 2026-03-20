/**
 * Conversation Analytics Dashboard — self-contained HTML page.
 *
 * Fetches /analytics/conversations/insights on load and on 60s auto-refresh.
 * Sections: Overview KPIs, Topic Clusters, FAQs, Handle Time by Topic,
 * Resolution Paths, with tenantId/date-range filter controls.
 *
 * Electric blue design system. Zero external JS/CSS dependencies.
 */

export function conversationAnalyticsDashboardHtml(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Conversation Analytics</title>
<style>
/* ── Reset & tokens ─────────────────────────────────────── */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0a0a0f;--surface:#111118;--border:#1e1e2e;
  --text:#e2e8f0;--muted:#64748b;--blue:#3b82f6;--blue-dim:#1d4ed8;
  --green:#22c55e;--yellow:#eab308;--red:#ef4444;--orange:#f97316;
  --purple:#a855f7;
  --radius:10px;--gap:1rem;
}
html,body{height:100%;background:var(--bg);color:var(--text);
  font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.5}

/* ── Layout ────────────────────────────────────────────── */
.shell{display:flex;flex-direction:column;min-height:100vh}
header{display:flex;align-items:center;justify-content:space-between;
  padding:.75rem 1.5rem;border-bottom:1px solid var(--border);background:var(--surface);
  position:sticky;top:0;z-index:100}
.logo{font-weight:700;font-size:1rem;color:var(--blue);letter-spacing:-.01em}
.logo span{color:var(--muted);font-weight:400}
.header-right{display:flex;align-items:center;gap:1rem}
.ts{font-size:.75rem;color:var(--muted)}
.back-link{font-size:.78rem;color:var(--blue);text-decoration:none;padding:.25rem .6rem;
  border:1px solid var(--blue-dim);border-radius:6px}
.back-link:hover{background:var(--blue-dim);color:#fff}

main{flex:1;padding:1.25rem 1.5rem;display:flex;flex-direction:column;gap:1.5rem;
  max-width:1400px;margin:0 auto;width:100%}

/* ── Filter bar ─────────────────────────────────────────── */
.filter-bar{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:.85rem 1.1rem;display:flex;align-items:center;flex-wrap:wrap;gap:.75rem}
.filter-bar label{font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;
  color:var(--muted);margin-right:.25rem}
.filter-bar input{background:#16161f;border:1px solid var(--border);border-radius:6px;
  color:var(--text);font-size:.82rem;padding:.35rem .65rem;width:180px}
.filter-bar input:focus{outline:none;border-color:var(--blue)}
.btn{background:var(--blue-dim);color:#fff;border:none;border-radius:6px;
  padding:.38rem .85rem;font-size:.82rem;font-weight:600;cursor:pointer;transition:background .2s}
.btn:hover{background:var(--blue)}
.btn-sm{padding:.25rem .6rem;font-size:.75rem}

/* ── Cards ─────────────────────────────────────────────── */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:1.1rem 1.25rem}
.card-title{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.07em;
  color:var(--muted);margin-bottom:.85rem}

/* ── KPI strip ──────────────────────────────────────────── */
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:var(--gap)}
.kpi{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:1rem 1.1rem;position:relative;overflow:hidden}
.kpi::after{content:'';position:absolute;inset:0;border-radius:var(--radius);
  border-top:2px solid var(--accent,var(--blue));pointer-events:none}
.kpi-label{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.07em;
  color:var(--muted);margin-bottom:.35rem}
.kpi-value{font-size:2rem;font-weight:800;color:var(--accent,var(--blue));line-height:1;margin-bottom:.25rem}
.kpi-sub{font-size:.72rem;color:var(--muted)}

/* ── Two-col row ────────────────────────────────────────── */
.row2{display:grid;grid-template-columns:1fr 1fr;gap:var(--gap)}
@media(max-width:900px){.row2{grid-template-columns:1fr}}

/* ── Tables ─────────────────────────────────────────────── */
.tbl{width:100%;border-collapse:collapse}
.tbl th{font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;
  color:var(--muted);padding:.45rem .7rem;border-bottom:1px solid var(--border);
  text-align:left;white-space:nowrap}
.tbl td{padding:.5rem .7rem;border-bottom:1px solid #16161f;color:var(--text);
  font-size:.82rem;vertical-align:middle}
.tbl tr:last-child td{border-bottom:none}
.tbl tr:hover td{background:#13131a}
.empty{color:var(--muted);text-align:center;padding:1.5rem;font-size:.82rem}

/* ── Badges / pills ─────────────────────────────────────── */
.badge{display:inline-block;border-radius:9999px;padding:.18rem .6rem;
  font-size:.7rem;font-weight:600;line-height:1.4}
.badge-blue{background:#1e3a8a33;color:var(--blue)}
.badge-green{background:#14532d33;color:var(--green)}
.badge-yellow{background:#78350f33;color:var(--yellow)}
.badge-red{background:#7f1d1d33;color:var(--red)}
.badge-gray{background:#1e1e2e;color:var(--muted)}

/* ── Bar charts (CSS) ───────────────────────────────────── */
.bar-track{background:#1e1e2e;border-radius:9999px;height:8px;flex:1;
  overflow:hidden;min-width:60px}
.bar-fill{height:100%;border-radius:9999px;transition:width .5s ease}
.bar-row{display:flex;align-items:center;gap:.65rem;margin-bottom:.55rem}
.bar-label{font-size:.78rem;color:var(--text);min-width:120px;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
.bar-pct{font-size:.72rem;color:var(--muted);min-width:50px;text-align:right}

/* ── Resolution path ────────────────────────────────────── */
.path-row{display:flex;flex-wrap:wrap;align-items:center;gap:.35rem;
  padding:.55rem .7rem;border-bottom:1px solid #16161f;font-size:.78rem}
.path-row:last-child{border-bottom:none}
.path-step{background:#1e1e2e;border-radius:4px;padding:.18rem .45rem;
  color:var(--muted);font-family:monospace;font-size:.72rem}
.path-step.user{color:var(--blue)}
.path-step.agent{color:var(--green)}
.path-step.policy{color:var(--purple)}
.path-step.end{color:var(--muted)}
.path-arrow{color:var(--border);font-size:.65rem}
.path-meta{margin-left:auto;display:flex;gap:.5rem;align-items:center;
  font-size:.72rem;color:var(--muted)}

/* ── Loading / error ────────────────────────────────────── */
.loading{color:var(--muted);padding:2rem;text-align:center;font-size:.85rem}
.err-banner{background:#7f1d1d33;border:1px solid var(--red);border-radius:8px;
  padding:.75rem 1rem;color:var(--red);font-size:.82rem;margin-bottom:1rem;display:none}

footer{padding:.75rem 1.5rem;border-top:1px solid var(--border);
  font-size:.7rem;color:var(--muted);text-align:center;background:var(--surface)}
</style>
</head>
<body>
<div class="shell">

<!-- ── Header ──────────────────────────────────────────────────── -->
<header>
  <div class="logo">Voice Jib-Jab <span>/ Conversation Analytics</span></div>
  <div class="header-right">
    <a class="back-link" href="/dashboard">← Dashboard</a>
    <div class="ts" id="ts">--:--:--</div>
  </div>
</header>

<main>

<!-- ── Error banner ─────────────────────────────────────────────── -->
<div class="err-banner" id="err-banner"></div>

<!-- ── Filter controls ──────────────────────────────────────────── -->
<div class="filter-bar">
  <div>
    <label for="f-tenant">Tenant</label>
    <input id="f-tenant" type="text" placeholder="all tenants"/>
  </div>
  <div>
    <label for="f-from">From</label>
    <input id="f-from" type="date"/>
  </div>
  <div>
    <label for="f-to">To</label>
    <input id="f-to" type="date"/>
  </div>
  <button class="btn" id="btn-analyze" onclick="analyze()">Analyze</button>
</div>

<!-- ── Overview KPIs ────────────────────────────────────────────── -->
<div class="kpi-grid" id="kpi-grid">
  <div class="kpi" style="--accent:var(--blue)">
    <div class="kpi-label">Sessions</div>
    <div class="kpi-value" id="kpi-sessions">--</div>
    <div class="kpi-sub">total analyzed</div>
  </div>
  <div class="kpi" style="--accent:var(--green)">
    <div class="kpi-label">Avg Handle Time</div>
    <div class="kpi-value" id="kpi-aht">--</div>
    <div class="kpi-sub" id="kpi-p50">p50: --</div>
  </div>
  <div class="kpi" style="--accent:var(--red)">
    <div class="kpi-label">Escalation Rate</div>
    <div class="kpi-value" id="kpi-esc">--%</div>
    <div class="kpi-sub">of all sessions</div>
  </div>
  <div class="kpi" style="--accent:var(--purple)">
    <div class="kpi-label">Resolution Rate</div>
    <div class="kpi-value" id="kpi-res">--%</div>
    <div class="kpi-sub">non-escalated</div>
  </div>
</div>

<!-- ── Topic clusters + Handle time by topic ────────────────────── -->
<div class="row2">
  <div class="card">
    <div class="card-title">Topic Clusters</div>
    <div id="topic-bars"><div class="loading">Loading…</div></div>
  </div>
  <div class="card" id="handle-time-card">
    <div class="card-title">Handle Time by Topic</div>
    <div id="handle-bars"><div class="loading">Loading…</div></div>
  </div>
</div>

<!-- ── FAQs ─────────────────────────────────────────────────────── -->
<div class="card">
  <div class="card-title">Top Frequent Questions</div>
  <table class="tbl" id="faq-table">
    <thead><tr>
      <th>Question</th><th>Count</th><th>Avg Handle Time</th><th>Topic</th><th>Esc Rate</th>
    </tr></thead>
    <tbody id="faq-body">
      <tr><td class="empty" colspan="5">Loading…</td></tr>
    </tbody>
  </table>
</div>

<!-- ── Resolution paths ─────────────────────────────────────────── -->
<div class="card">
  <div class="card-title">Top Resolution Paths</div>
  <div id="path-list"><div class="loading">Loading…</div></div>
</div>

</main>

<footer>Conversation Analytics &mdash; auto-refresh every 60s &mdash; <a href="/dashboard" style="color:var(--blue);text-decoration:none">/dashboard</a></footer>
</div>

<script>
'use strict';

// ── Helpers ───────────────────────────────────────────────────────────

function fmtMs(ms) {
  if (!ms || ms === 0) return '--';
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  return Math.floor(ms / 60000) + 'm ' + Math.floor((ms % 60000) / 1000) + 's';
}

function pct(r) {
  return (r * 100).toFixed(1) + '%';
}

function escColor(rate) {
  if (rate < 0.10) return 'var(--green)';
  if (rate < 0.20) return 'var(--yellow)';
  return 'var(--red)';
}

function escBadge(rate) {
  const cls = rate < 0.10 ? 'badge-green' : rate < 0.20 ? 'badge-yellow' : 'badge-red';
  return '<span class="badge ' + cls + '">' + pct(rate) + '</span>';
}

function topicBadge(label) {
  if (!label) return '<span class="badge badge-gray">—</span>';
  return '<span class="badge badge-blue">' + label + '</span>';
}

function stepHtml(step) {
  let cls = 'path-step';
  if (step === 'user') cls += ' user';
  else if (step === 'agent') cls += ' agent';
  else if (step.startsWith('policy')) cls += ' policy';
  else if (step === 'end') cls += ' end';
  return '<span class="' + cls + '">' + step + '</span>';
}

function outcomeBadge(label) {
  const map = {
    resolved: 'badge-green',
    escalated: 'badge-red',
    refused: 'badge-yellow',
    abandoned: 'badge-gray',
  };
  return '<span class="badge ' + (map[label] || 'badge-gray') + '">' + label + '</span>';
}

// ── Build insights URL from filters ──────────────────────────────────

function insightsUrl() {
  const tenant = document.getElementById('f-tenant').value.trim();
  const from = document.getElementById('f-from').value;
  const to = document.getElementById('f-to').value;
  const params = new URLSearchParams();
  if (tenant) params.set('tenantId', tenant);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  return '/analytics/conversations/insights' + (qs ? '?' + qs : '');
}

// ── Render KPIs ───────────────────────────────────────────────────────

function renderKpis(d) {
  document.getElementById('kpi-sessions').textContent = d.sessionCount;
  document.getElementById('kpi-aht').textContent = fmtMs(d.overallStats.avgHandleTimeMs);
  document.getElementById('kpi-p50').textContent = 'p50: ' + fmtMs(d.overallStats.p50HandleTimeMs);
  document.getElementById('kpi-esc').textContent = pct(d.overallStats.overallEscalationRate);
  document.getElementById('kpi-res').textContent = pct(d.overallStats.overallResolutionRate);
}

// ── Render topic clusters ─────────────────────────────────────────────

function renderTopicClusters(clusters) {
  const wrap = document.getElementById('topic-bars');
  if (!clusters || !clusters.length) {
    wrap.innerHTML = '<div class="empty">No topic data</div>';
    return;
  }
  const maxCount = Math.max(...clusters.map(c => c.sessionCount), 1);
  wrap.innerHTML = clusters.map(c => {
    const pctWidth = Math.round(c.sessionCount / maxCount * 100);
    const col = escColor(c.escalationRate);
    const escLabel = '<span style="font-size:.7rem;color:' + col + '">' + pct(c.escalationRate) + ' esc</span>';
    return '<div class="bar-row">' +
      '<div class="bar-label">' + c.label + '</div>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + pctWidth + '%;background:var(--blue)"></div></div>' +
      '<div class="bar-pct">' + c.sessionCount + '</div>' +
      escLabel +
      '</div>';
  }).join('');
}

// ── Render handle time by topic ───────────────────────────────────────

function renderHandleTime(items) {
  const wrap = document.getElementById('handle-bars');
  if (!items || !items.length) {
    wrap.innerHTML = '<div class="empty">No handle time data</div>';
    return;
  }
  const maxMs = Math.max(...items.map(i => i.avgMs), 1);
  wrap.innerHTML = items.map(i => {
    const pctWidth = Math.round(i.avgMs / maxMs * 100);
    return '<div class="bar-row">' +
      '<div class="bar-label">' + i.topicLabel + '</div>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + pctWidth + '%;background:var(--purple)"></div></div>' +
      '<div class="bar-pct">' + fmtMs(i.avgMs) + '</div>' +
      '</div>';
  }).join('');
}

// ── Render FAQ table ──────────────────────────────────────────────────

function renderFAQs(faqs) {
  const tbody = document.getElementById('faq-body');
  if (!faqs || !faqs.length) {
    tbody.innerHTML = '<tr><td class="empty" colspan="5">No frequent questions found</td></tr>';
    return;
  }
  tbody.innerHTML = faqs.map(q =>
    '<tr>' +
      '<td style="max-width:380px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + q.text + '">' + q.text + '</td>' +
      '<td><span class="badge badge-blue">' + q.occurrences + '</span></td>' +
      '<td>' + fmtMs(q.avgHandleTimeMs) + '</td>' +
      '<td>' + topicBadge(q.topicLabel) + '</td>' +
      '<td>' + escBadge(q.escalationRate) + '</td>' +
    '</tr>'
  ).join('');
}

// ── Render resolution paths ───────────────────────────────────────────

function renderPaths(paths) {
  const wrap = document.getElementById('path-list');
  if (!paths || !paths.length) {
    wrap.innerHTML = '<div class="empty">No resolution paths found</div>';
    return;
  }
  wrap.innerHTML = paths.slice(0, 5).map(p => {
    const stepsHtml = p.steps.map(stepHtml).join('<span class="path-arrow"> → </span>');
    return '<div class="path-row">' +
      stepsHtml +
      '<div class="path-meta">' +
        outcomeBadge(p.outcomeLabel) +
        '<span>' + p.occurrences + 'x</span>' +
        '<span style="color:var(--muted)">' + fmtMs(p.avgHandleTimeMs) + '</span>' +
      '</div>' +
    '</div>';
  }).join('');
}

// ── Main load ─────────────────────────────────────────────────────────

async function loadInsights() {
  const errEl = document.getElementById('err-banner');
  errEl.style.display = 'none';

  try {
    const resp = await fetch(insightsUrl());
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body.error || 'HTTP ' + resp.status);
    }
    const data = await resp.json();

    renderKpis(data);
    renderTopicClusters(data.topicClusters);
    renderHandleTime(data.handleTimeByTopic);
    renderFAQs(data.frequentQuestions);
    renderPaths(data.resolutionPaths);

    document.getElementById('ts').textContent = new Date().toTimeString().slice(0, 8);
  } catch (e) {
    errEl.textContent = 'Failed to load insights: ' + e.message;
    errEl.style.display = 'block';
    console.warn('[ConvAnalytics] load error', e);
  }
}

function analyze() {
  loadInsights();
}

// ── Boot + auto-refresh ───────────────────────────────────────────────

loadInsights();
setInterval(loadInsights, 60000);
</script>
</body>
</html>`;
}

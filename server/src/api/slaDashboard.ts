/**
 * SLA Monitor Dashboard
 *
 * Serves a self-contained HTML page at GET /sla/dashboard.
 * Polls /sla/status every 10 s and renders:
 *   • Overall status badge — OK / WARNING / CRITICAL
 *   • One card per metric (ttfb, policyEval, ttsLatency, sttLatency)
 *     each showing p50/p95/p99, breach rate, uptime, sample count
 *
 * Zero external JS/CSS dependencies.  All rendering is vanilla DOM + CSS.
 */

export function slaDashboardHtml(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>VJJ SLA Monitor</title>
<style>
/* ── Reset & tokens ─────────────────────────────────────── */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0a0a0f;--surface:#111118;--border:#1e1e2e;
  --text:#e2e8f0;--muted:#64748b;--blue:#3b82f6;--blue-dim:#1d4ed8;
  --green:#22c55e;--yellow:#eab308;--red:#ef4444;--orange:#f97316;
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
.back-link{font-size:.78rem;color:var(--blue);text-decoration:none}
.back-link:hover{text-decoration:underline}

main{flex:1;padding:1.25rem 1.5rem;display:flex;flex-direction:column;gap:1.5rem;
  max-width:1200px;margin:0 auto;width:100%}

/* ── Overall status badge ───────────────────────────────── */
.status-banner{display:flex;align-items:center;gap:1rem;
  background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius);padding:1rem 1.5rem}
.status-label{font-size:.75rem;font-weight:600;text-transform:uppercase;
  letter-spacing:.08em;color:var(--muted)}
.status-badge{font-size:1.5rem;font-weight:800;letter-spacing:.04em}
.status-ok{color:var(--green)}
.status-warning{color:var(--yellow)}
.status-critical{color:var(--red)}
.status-window{font-size:.78rem;color:var(--muted);margin-left:auto}

/* ── Metric cards grid ──────────────────────────────────── */
.metrics-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:var(--gap)}

/* ── Metric card ────────────────────────────────────────── */
.metric-card{background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius);padding:1.1rem 1.25rem;
  border-top:3px solid var(--card-accent,var(--border))}
.metric-card.ok{--card-accent:var(--green)}
.metric-card.warning{--card-accent:var(--yellow)}
.metric-card.critical{--card-accent:var(--red)}

.metric-name{font-size:.82rem;font-weight:700;color:var(--text);margin-bottom:.15rem}
.metric-desc{font-size:.7rem;color:var(--muted);margin-bottom:.85rem}

.metric-row{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.5rem}
.metric-chip{font-size:.72rem;background:#1e1e2e;border-radius:6px;
  padding:.2rem .55rem;color:var(--muted)}
.metric-chip span{color:var(--text);font-weight:600}

.breach-row{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.6rem}
.breach-chip{font-size:.72rem;border-radius:6px;padding:.2rem .55rem;font-weight:600}
.breach-chip.ok{background:#14532d33;color:var(--green)}
.breach-chip.warning{background:#78350f33;color:var(--yellow)}
.breach-chip.critical{background:#7f1d1d33;color:var(--red)}

.metric-footer{font-size:.7rem;color:var(--muted);padding-top:.5rem;
  border-top:1px solid var(--border)}

footer{padding:.75rem 1.5rem;border-top:1px solid var(--border);
  font-size:.7rem;color:var(--muted);text-align:center;background:var(--surface)}
</style>
</head>
<body>
<div class="shell">

<!-- ── Header ──────────────────────────────────────────────────── -->
<header>
  <div class="logo">Voice Jib-Jab <span>/ SLA Monitor</span></div>
  <div class="header-right">
    <a href="/dashboard" class="back-link">&larr; Back to Dashboard</a>
    <div class="ts" id="ts">--:--:--</div>
  </div>
</header>

<main>

<!-- ── Overall status ──────────────────────────────────────────── -->
<div class="status-banner">
  <div>
    <div class="status-label">Overall SLA Status</div>
    <div class="status-badge" id="overall-badge">--</div>
  </div>
  <div class="status-window" id="window-info">window: -- min &nbsp;·&nbsp; evaluated: --</div>
</div>

<!-- ── Metric cards ─────────────────────────────────────────────── -->
<div class="metrics-grid" id="metrics-grid">
  <div style="color:var(--muted);padding:2rem;text-align:center">Loading…</div>
</div>

</main>

<footer>
  Voice Jib-Jab SLA Monitor &mdash; auto-refresh every 10 s &mdash;
  <a href="/sla/status" style="color:var(--blue);text-decoration:none">/sla/status</a>
  &nbsp;·&nbsp;
  <a href="/dashboard" style="color:var(--blue);text-decoration:none">/dashboard</a>
</footer>
</div>

<script>
'use strict';

// Known SLA metric keys — used for stable card ordering and id references.
var KNOWN_METRICS = ['ttfb','policyEval','ttsLatency','sttLatency'];

function qs(id){ return document.getElementById(id); }

function statusClass(overall){
  if(overall==='ok') return 'status-ok';
  if(overall==='warning') return 'status-warning';
  return 'status-critical';
}

function statusLabel(overall){
  if(overall==='ok') return 'OK';
  if(overall==='warning') return 'WARNING';
  return 'CRITICAL';
}

function cardClass(breachRatePct){
  if(breachRatePct >= 20) return 'critical';
  if(breachRatePct >= 5)  return 'warning';
  return 'ok';
}

function breachChipClass(breachRatePct){
  if(breachRatePct >= 20) return 'critical';
  if(breachRatePct >= 5)  return 'warning';
  return 'ok';
}

function fmt(ms){ return ms.toFixed(0)+'ms'; }
function fmtPct(p){ return p.toFixed(1)+'%'; }

function renderMetrics(data){
  const overall = data.overall || 'ok';
  const badge = qs('overall-badge');
  badge.textContent = statusLabel(overall);
  badge.className = 'status-badge ' + statusClass(overall);

  qs('window-info').textContent =
    'window: '+data.windowMinutes+' min \u00b7 evaluated: '+
    new Date(data.evaluatedAt).toTimeString().slice(0,8);

  const grid = qs('metrics-grid');
  if(!data.metrics || !data.metrics.length){
    grid.innerHTML='<div style="color:var(--muted);padding:2rem;text-align:center">No metrics</div>';
    return;
  }

  grid.innerHTML = data.metrics.map(function(m){
    const cls = cardClass(m.breachRatePct);
    const bCls = breachChipClass(m.breachRatePct);
    return '<div class="metric-card '+cls+'">'+
      '<div class="metric-name">'+m.target.name+'</div>'+
      '<div class="metric-desc">'+m.target.description+'</div>'+
      '<div class="metric-row">'+
        '<div class="metric-chip">Target <span>'+fmt(m.target.targetMs)+'</span></div>'+
        '<div class="metric-chip">p50 <span>'+fmt(m.p50Ms)+'</span></div>'+
        '<div class="metric-chip">p95 <span>'+fmt(m.p95Ms)+'</span></div>'+
        '<div class="metric-chip">p99 <span>'+fmt(m.p99Ms)+'</span></div>'+
      '</div>'+
      '<div class="breach-row">'+
        '<div class="breach-chip '+bCls+'">Breach rate: '+fmtPct(m.breachRatePct)+'</div>'+
        '<div class="breach-chip ok">Uptime: '+fmtPct(m.uptimePct)+'</div>'+
      '</div>'+
      '<div class="metric-footer">Samples in window: '+m.sampleCount+'</div>'+
    '</div>';
  }).join('');
}

async function refresh(){
  try{
    const resp = await fetch('/sla/status');
    const data = await resp.json();
    renderMetrics(data);
    qs('ts').textContent = new Date().toTimeString().slice(0,8);
  }catch(e){
    console.warn('[SLA Monitor] fetch error', e);
  }
}

refresh();
setInterval(refresh, 10000);
</script>
</body>
</html>`;
}

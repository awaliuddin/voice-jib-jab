/**
 * Voice Agent Monitoring Dashboard
 *
 * Serves a self-contained HTML page at GET /dashboard.
 * Polls five server endpoints every 5 s and renders:
 *   • KPI strip  — active sessions, avg quality, escalation rate, compliance, uptime
 *   • Active sessions table — ID, state, tenant, uptime
 *   • Quality scores bar chart — per-tenant avg quality (CSS bars)
 *   • Sentiment heatmap — positive/neutral/negative/frustrated per tenant
 *   • Escalation rate table — sorted by escalation %, with sparkline bars
 *   • Top policy violations — horizontal bar chart
 *   • Calls per day sparkline — last 14 days
 *
 * Zero external JS/CSS dependencies.  All rendering is vanilla DOM + CSS.
 */

export function monitoringDashboardHtml(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>VJJ Monitor — Voice Agent Dashboard</title>
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
.conn{display:flex;align-items:center;gap:.4rem;font-size:.78rem;color:var(--muted)}
.conn-dot{width:8px;height:8px;border-radius:50%;background:var(--green);
  box-shadow:0 0 6px var(--green);transition:background .3s}
.conn-dot.err{background:var(--red);box-shadow:0 0 6px var(--red)}
.ts{font-size:.75rem;color:var(--muted)}

main{flex:1;padding:1.25rem 1.5rem;display:flex;flex-direction:column;gap:1.5rem;max-width:1400px;margin:0 auto;width:100%}

/* ── Cards ─────────────────────────────────────────────── */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.1rem 1.25rem}
.card-title{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.07em;
  color:var(--muted);margin-bottom:.85rem}

/* ── KPI strip ──────────────────────────────────────────── */
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:var(--gap)}
.kpi{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:1rem 1.1rem;position:relative;overflow:hidden}
.kpi::after{content:'';position:absolute;inset:0;border-radius:var(--radius);
  border-top:2px solid var(--accent,var(--blue));pointer-events:none}
.kpi-label{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:.35rem}
.kpi-value{font-size:2rem;font-weight:800;color:var(--accent,var(--blue));line-height:1;margin-bottom:.25rem}
.kpi-sub{font-size:.72rem;color:var(--muted)}

/* ── Two-col row ────────────────────────────────────────── */
.row2{display:grid;grid-template-columns:1fr 1fr;gap:var(--gap)}
.row3{display:grid;grid-template-columns:2fr 1fr 1fr;gap:var(--gap)}
@media(max-width:900px){.row2,.row3{grid-template-columns:1fr}}

/* ── Tables ─────────────────────────────────────────────── */
.tbl{width:100%;border-collapse:collapse}
.tbl th{font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;
  color:var(--muted);padding:.45rem .7rem;border-bottom:1px solid var(--border);text-align:left;white-space:nowrap}
.tbl td{padding:.5rem .7rem;border-bottom:1px solid #16161f;color:var(--text);font-size:.82rem;vertical-align:middle}
.tbl tr:last-child td{border-bottom:none}
.tbl tr:hover td{background:#13131a}
.empty{color:var(--muted);text-align:center;padding:1.5rem;font-size:.82rem}

/* ── Badges / pills ─────────────────────────────────────── */
.badge{display:inline-block;border-radius:9999px;padding:.18rem .6rem;font-size:.7rem;font-weight:600;line-height:1.4}
.badge-blue{background:#1e3a8a33;color:var(--blue)}
.badge-green{background:#14532d33;color:var(--green)}
.badge-yellow{background:#78350f33;color:var(--yellow)}
.badge-red{background:#7f1d1d33;color:var(--red)}
.badge-gray{background:#1e1e2e;color:var(--muted)}

/* ── Bar charts (CSS) ───────────────────────────────────── */
.bar-track{background:#1e1e2e;border-radius:9999px;height:8px;flex:1;overflow:hidden;min-width:60px}
.bar-fill{height:100%;border-radius:9999px;transition:width .5s ease}
.bar-row{display:flex;align-items:center;gap:.65rem;margin-bottom:.55rem}
.bar-label{font-size:.78rem;color:var(--text);min-width:110px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar-pct{font-size:.72rem;color:var(--muted);min-width:36px;text-align:right}

/* ── Sentiment heatmap ──────────────────────────────────── */
.heatmap{display:grid;gap:2px}
.hm-header{display:grid;gap:2px;margin-bottom:4px}
.hm-cell{border-radius:4px;display:flex;align-items:center;justify-content:center;
  font-size:.68rem;font-weight:600;transition:background .3s;min-height:32px}
.hm-tenant{font-size:.72rem;color:var(--muted);display:flex;align-items:center;
  padding:.2rem .4rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ── Sparkline SVG ──────────────────────────────────────── */
.sparkline{display:block;width:100%;height:48px}

/* ── State chip ─────────────────────────────────────────── */
.state{display:inline-flex;align-items:center;gap:.3rem;font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.state::before{content:'';width:6px;height:6px;border-radius:50%;flex-shrink:0}
.state-idle::before{background:var(--muted)}
.state-connecting::before{background:var(--yellow);animation:pulse 1s infinite}
.state-connected::before,.state-listening::before,.state-processing::before{background:var(--blue);animation:pulse 1.5s infinite}
.state-speaking::before{background:var(--green);animation:pulse 1s infinite}
.state-error::before{background:var(--red)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}

/* ── Quality score color ────────────────────────────────── */
.q-a{color:var(--green)}
.q-b{color:#86efac}
.q-c{color:var(--yellow)}
.q-d{color:var(--orange)}
.q-f{color:var(--red)}

footer{padding:.75rem 1.5rem;border-top:1px solid var(--border);
  font-size:.7rem;color:var(--muted);text-align:center;background:var(--surface)}
</style>
</head>
<body>
<div class="shell">

<!-- ── Header ──────────────────────────────────────────────────── -->
<header>
  <div class="logo">Voice Jib-Jab <span>/ Monitor</span></div>
  <div class="header-right">
    <div class="conn"><div class="conn-dot" id="dot"></div><span id="conn-label">Connecting…</span></div>
    <div class="ts" id="ts">--:--:--</div>
  </div>
</header>

<main>

<!-- ── KPI strip ───────────────────────────────────────────────── -->
<div class="kpi-grid" id="kpis">
  <div class="kpi" style="--accent:var(--blue)">
    <div class="kpi-label">Active Sessions</div>
    <div class="kpi-value" id="kpi-active">--</div>
    <div class="kpi-sub" id="kpi-total-sub">-- total recorded</div>
  </div>
  <div class="kpi" style="--accent:var(--green)">
    <div class="kpi-label">Avg Quality Score</div>
    <div class="kpi-value" id="kpi-quality">--</div>
    <div class="kpi-sub" id="kpi-quality-sub">across all sessions</div>
  </div>
  <div class="kpi" style="--accent:var(--red)">
    <div class="kpi-label">Escalation Rate</div>
    <div class="kpi-value" id="kpi-esc">--%</div>
    <div class="kpi-sub" id="kpi-esc-sub">-- escalations</div>
  </div>
  <div class="kpi" style="--accent:var(--purple)">
    <div class="kpi-label">Compliance Rate</div>
    <div class="kpi-value" id="kpi-comp">--%</div>
    <div class="kpi-sub">policy decisions</div>
  </div>
  <div class="kpi" style="--accent:var(--yellow)">
    <div class="kpi-label">Uptime</div>
    <div class="kpi-value" id="kpi-uptime">--</div>
    <div class="kpi-sub" id="kpi-mem">-- MB heap</div>
  </div>
</div>

<!-- ── Active sessions + Calls/day ─────────────────────────────── -->
<div class="row2">
  <div class="card">
    <div class="card-title">Active Sessions</div>
    <table class="tbl" id="sessions-table">
      <thead><tr>
        <th>Session ID</th><th>State</th><th>Tenant</th><th>Uptime</th>
      </tr></thead>
      <tbody id="sessions-body">
        <tr><td class="empty" colspan="4">No active sessions</td></tr>
      </tbody>
    </table>
  </div>
  <div class="card">
    <div class="card-title">Calls per Day <span style="font-weight:400;text-transform:none;letter-spacing:0">(last 14 days)</span></div>
    <svg id="sparkline" class="sparkline" viewBox="0 0 320 48" preserveAspectRatio="none"></svg>
    <div id="sparkline-labels" style="display:flex;justify-content:space-between;margin-top:.4rem;font-size:.65rem;color:var(--muted)"></div>
  </div>
</div>

<!-- ── Quality + Escalation by tenant ─────────────────────────── -->
<div class="row2">
  <div class="card">
    <div class="card-title">Quality Score by Tenant</div>
    <div id="quality-bars"></div>
  </div>
  <div class="card">
    <div class="card-title">Escalation Rate by Tenant</div>
    <table class="tbl" id="esc-table">
      <thead><tr><th>Tenant</th><th>Sessions</th><th>Escalations</th><th>Rate</th></tr></thead>
      <tbody id="esc-body">
        <tr><td class="empty" colspan="4">No data</td></tr>
      </tbody>
    </table>
  </div>
</div>

<!-- ── Sentiment heatmap + Top violations ──────────────────────── -->
<div class="row2">
  <div class="card">
    <div class="card-title">Sentiment Heatmap — by Tenant</div>
    <div id="heatmap-wrap"></div>
  </div>
  <div class="card">
    <div class="card-title">Top Policy Violations</div>
    <div id="violations-bars"></div>
  </div>
</div>

</main>

<footer>Voice Jib-Jab &mdash; auto-refresh every 5 s &mdash; <a href="/metrics" style="color:var(--blue);text-decoration:none">/metrics</a> &nbsp;·&nbsp; <a href="/analytics/dashboard" style="color:var(--blue);text-decoration:none">/analytics/dashboard</a> &nbsp;·&nbsp; <a href="/health" style="color:var(--blue);text-decoration:none">/health</a></footer>
</div>

<script>
'use strict';

// ── Helpers ──────────────────────────────────────────────────────
function qs(id){ return document.getElementById(id); }

function fmtUptime(s){
  if(s < 60) return s+'s';
  if(s < 3600) return Math.floor(s/60)+'m '+( s%60)+'s';
  return Math.floor(s/3600)+'h '+Math.floor((s%3600)/60)+'m';
}

function qualityClass(q){
  if(q>=90) return 'q-a';
  if(q>=80) return 'q-b';
  if(q>=70) return 'q-c';
  if(q>=60) return 'q-d';
  return 'q-f';
}

function qualityBadge(q){
  const cls = q>=90?'badge-green':q>=80?'badge-blue':q>=70?'badge-yellow':'badge-red';
  return '<span class="badge '+cls+'">'+q+'</span>';
}

function escBadge(rate){
  if(rate===0) return '<span class="badge badge-green">0%</span>';
  if(rate<5)   return '<span class="badge badge-yellow">'+rate.toFixed(1)+'%</span>';
  return '<span class="badge badge-red">'+rate.toFixed(1)+'%</span>';
}

function stateChip(state){
  const s=(state||'idle').toLowerCase().replace(/[^a-z]/g,'-');
  return '<span class="state state-'+s+'">'+state+'</span>';
}

// ── Sentiment heat colour ────────────────────────────────────────
function heatColor(pct, sentiment){
  const palettes = {
    positive: ['#14532d22','#15803d55','#16a34a88','#22c55ebb'],
    neutral:  ['#1e1e2e22','#1e3a5f44','#1d4ed866','#3b82f699'],
    negative: ['#7f1d1d22','#991b1b55','#b91c1c88','#ef4444bb'],
    frustrated:['#431407','#7c2d1255','#9a3412aa','#f97316dd'],
  };
  const p = palettes[sentiment] || palettes.neutral;
  if(pct===0) return '#16161f';
  if(pct<15)  return p[0];
  if(pct<35)  return p[1];
  if(pct<60)  return p[2];
  return p[3];
}

// ── Fetch all data ───────────────────────────────────────────────
async function fetchAll(){
  const [metrics, analytics, tenants, callsPerDay] = await Promise.all([
    fetch('/metrics').then(r=>r.json()),
    fetch('/analytics/dashboard').then(r=>r.json()),
    fetch('/analytics/tenants').then(r=>r.json()),
    fetch('/analytics/calls-per-day').then(r=>r.json()),
  ]);
  return { metrics, analytics, tenants, callsPerDay };
}

// ── Render KPIs ──────────────────────────────────────────────────
function renderKpis(metrics, analytics){
  qs('kpi-active').textContent = metrics.sessions.active;
  qs('kpi-total-sub').textContent = (analytics.sessions?.length ?? 0)+' total recorded';

  const sessions = analytics.sessions || [];
  const avgQ = sessions.length
    ? Math.round(sessions.reduce((s,x)=>s+(x.qualityScore||0),0)/sessions.length)
    : 0;
  const qEl = qs('kpi-quality');
  qEl.textContent = avgQ || '--';
  qEl.className = 'kpi-value '+qualityClass(avgQ);

  const totalEsc = sessions.reduce((s,x)=>s+(x.escalationCount||0),0);
  const escRate = sessions.length ? (totalEsc/sessions.length*100) : 0;
  qs('kpi-esc').textContent = escRate.toFixed(1)+'%';
  qs('kpi-esc-sub').textContent = totalEsc+' escalations';

  const avgComp = sessions.length
    ? Math.round(sessions.reduce((s,x)=>s+(x.complianceRate||0),0)/sessions.length*10)/10
    : 0;
  qs('kpi-comp').textContent = (avgComp*100).toFixed(1)+'%';

  qs('kpi-uptime').textContent = fmtUptime(metrics.uptime_seconds);
  qs('kpi-mem').textContent = metrics.memory.heap_used_mb+' MB heap';
}

// ── Active sessions table ────────────────────────────────────────
function renderActiveSessions(metrics){
  const body = qs('sessions-body');
  const rows = metrics.session_detail || [];
  if(!rows.length){
    body.innerHTML='<tr><td class="empty" colspan="4">No active sessions</td></tr>';
    return;
  }
  body.innerHTML = rows.map(s=>'<tr>'+
    '<td style="font-family:monospace;font-size:.75rem;color:var(--muted)">'+s.id.slice(0,20)+'…</td>'+
    '<td>'+stateChip(s.state)+'</td>'+
    '<td><span class="badge badge-gray">'+(s.tenantId||'—')+'</span></td>'+
    '<td style="color:var(--muted)">'+fmtUptime(Math.round(s.uptime_ms/1000))+'</td>'+
  '</tr>').join('');
}

// ── Calls per day sparkline ──────────────────────────────────────
function renderSparkline(callsPerDay){
  const data = (callsPerDay.callsPerDay || callsPerDay || []).slice(-14);
  const svg = qs('sparkline');
  const labels = qs('sparkline-labels');
  if(!data.length){ svg.innerHTML=''; labels.innerHTML=''; return; }

  const W=320, H=48, pad=4;
  const maxV = Math.max(...data.map(d=>d.count), 1);
  const xStep = (W - pad*2) / Math.max(data.length-1, 1);

  const pts = data.map((d,i)=>{
    const x = pad + i*xStep;
    const y = H - pad - ((d.count/maxV)*(H-pad*2));
    return [x,y];
  });

  // Area fill
  const pathD = 'M'+pts.map(p=>p.join(',')).join('L')+
    'L'+pts[pts.length-1][0]+','+(H-pad)+' L'+pts[0][0]+','+(H-pad)+' Z';

  // Line
  const lineD = 'M'+pts.map(p=>p.join(',')).join('L');

  // Dots
  const dots = pts.map(([x,y])=>'<circle cx="'+x+'" cy="'+y+'" r="2.5" fill="#3b82f6"/>').join('');

  svg.innerHTML =
    '<defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">'+
    '<stop offset="0%" stop-color="#3b82f6" stop-opacity=".3"/>'+
    '<stop offset="100%" stop-color="#3b82f6" stop-opacity="0"/></linearGradient></defs>'+
    '<path d="'+pathD+'" fill="url(#sg)"/>'+
    '<path d="'+lineD+'" fill="none" stroke="#3b82f6" stroke-width="1.5"/>'+
    dots;

  // Labels: first, middle, last
  const show = [0, Math.floor(data.length/2), data.length-1];
  labels.innerHTML = data.map((d,i)=>
    show.includes(i)
      ? '<span>'+d.date.slice(5)+'</span>'
      : '<span></span>'
  ).join('');
  labels.style.display='grid';
  labels.style.gridTemplateColumns='repeat('+data.length+',1fr)';
}

// ── Quality bars by tenant ───────────────────────────────────────
function renderQualityBars(tenants){
  const wrap = qs('quality-bars');
  if(!tenants.length){ wrap.innerHTML='<div class="empty">No tenant data</div>'; return; }
  const sorted = [...tenants].sort((a,b)=>(b.avgQualityScore||0)-(a.avgQualityScore||0));
  wrap.innerHTML = sorted.map(t=>{
    const q = Math.round(t.avgQualityScore||0);
    const pct = Math.min(q,100);
    const col = q>=80?'var(--green)':q>=60?'var(--yellow)':'var(--red)';
    return '<div class="bar-row">'+
      '<div class="bar-label">'+t.tenantId+'</div>'+
      '<div class="bar-track"><div class="bar-fill" style="width:'+pct+'%;background:'+col+'"></div></div>'+
      '<div class="bar-pct '+qualityClass(q)+'">'+q+'</div>'+
    '</div>';
  }).join('');
}

// ── Escalation table by tenant ───────────────────────────────────
function renderEscalationTable(tenants){
  const body = qs('esc-body');
  if(!tenants.length){ body.innerHTML='<tr><td class="empty" colspan="4">No data</td></tr>'; return; }
  const sorted = [...tenants].sort((a,b)=>{
    const ra=(a.escalationCount||0)/(a.sessionCount||1);
    const rb=(b.escalationCount||0)/(b.sessionCount||1);
    return rb-ra;
  });
  body.innerHTML = sorted.map(t=>{
    const rate = t.sessionCount ? (t.escalationCount||0)/t.sessionCount*100 : 0;
    return '<tr>'+
      '<td><code style="font-size:.75rem;color:var(--blue)">'+t.tenantId+'</code></td>'+
      '<td>'+t.sessionCount+'</td>'+
      '<td>'+(t.escalationCount||0)+'</td>'+
      '<td>'+escBadge(rate)+'</td>'+
    '</tr>';
  }).join('');
}

// ── Sentiment heatmap ────────────────────────────────────────────
function renderSentimentHeatmap(tenants){
  const wrap = qs('heatmap-wrap');
  if(!tenants.length){ wrap.innerHTML='<div class="empty">No tenant data</div>'; return; }

  const sentiments = ['positive','neutral','negative','frustrated'];
  const sCols = sentiments.length + 1; // tenant label + 4 sentiments

  let html = '<div style="display:grid;grid-template-columns:120px repeat(4,1fr);gap:3px;align-items:center">';

  // Header row
  html += '<div></div>';
  sentiments.forEach(s=>{
    html += '<div style="text-align:center;font-size:.65rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);padding-bottom:4px">'+s+'</div>';
  });

  // Data rows
  tenants.forEach(t=>{
    const dist = t.sentimentDistribution || {};
    const total = sentiments.reduce((sum,s)=>sum+(dist[s]||0),0)||1;
    html += '<div class="hm-tenant" title="'+t.tenantId+'">'+t.tenantId+'</div>';
    sentiments.forEach(s=>{
      const count = dist[s]||0;
      const pct = Math.round(count/total*100);
      const bg = heatColor(pct, s);
      html += '<div class="hm-cell" style="background:'+bg+'" title="'+s+': '+count+' ('+pct+'%)">'+
        (count?'<span style="text-shadow:0 1px 2px rgba(0,0,0,.8)">'+pct+'%</span>':
               '<span style="color:var(--border)">·</span>')+
      '</div>';
    });
  });

  // Global row from analytics
  html += '</div>';
  wrap.innerHTML = html;
}

// ── Policy violations bars ───────────────────────────────────────
function renderViolationBars(analytics){
  const wrap = qs('violations-bars');
  const violations = analytics.topPolicyViolations || [];
  if(!violations.length){wrap.innerHTML='<div class="empty">No policy violations recorded</div>';return;}
  const max = violations[0].count||1;
  wrap.innerHTML = violations.slice(0,7).map(v=>{
    const pct = Math.round(v.count/max*100);
    return '<div class="bar-row">'+
      '<div class="bar-label" style="color:var(--text)">'+v.violation+'</div>'+
      '<div class="bar-track"><div class="bar-fill" style="width:'+pct+'%;background:var(--red)"></div></div>'+
      '<div class="bar-pct">'+v.count+'</div>'+
    '</div>';
  }).join('');
}

// ── Main refresh loop ────────────────────────────────────────────
let errCount = 0;

async function refresh(){
  try {
    const { metrics, analytics, tenants, callsPerDay } = await fetchAll();

    renderKpis(metrics, analytics);
    renderActiveSessions(metrics);
    renderSparkline(callsPerDay);
    renderQualityBars(tenants);
    renderEscalationTable(tenants);
    renderSentimentHeatmap(tenants);
    renderViolationBars(analytics);

    errCount = 0;
    qs('dot').classList.remove('err');
    qs('conn-label').textContent = 'Live';
    qs('ts').textContent = new Date().toTimeString().slice(0,8);
  } catch(e) {
    errCount++;
    qs('dot').classList.add('err');
    qs('conn-label').textContent = 'Retry '+errCount;
    console.warn('[VJJ Monitor] fetch error', e);
  }
}

refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;
}

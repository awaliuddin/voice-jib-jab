/**
 * Compliance Dashboard HTML — self-contained SPA page for the compliance dashboard.
 *
 * Dark electric blue design system. Auto-fetches /compliance-dashboard/overview on
 * load and refreshes every 30 seconds. Supports regulation filter tabs and expandable
 * tenant rows showing gap analysis.
 */

export function complianceDashboardPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Compliance Dashboard — Voice Jib-Jab</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0a0a0f;--surface:#111118;--surface2:#16161f;--border:#1e1e2e;
  --text:#e2e8f0;--muted:#64748b;--blue:#3b82f6;--blue-dim:#1d4ed8;
  --green:#22c55e;--yellow:#eab308;--red:#ef4444;
  --radius:10px;--gap:1rem;
}
html,body{min-height:100%;background:var(--bg);color:var(--text);
  font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.5}
a{color:var(--blue);text-decoration:none}
a:hover{text-decoration:underline}

/* ── Layout ────────────────────────────────────────────────── */
.shell{display:flex;flex-direction:column;min-height:100vh}
header{
  display:flex;align-items:center;justify-content:space-between;
  padding:.75rem 1.5rem;border-bottom:1px solid var(--border);
  background:var(--surface);position:sticky;top:0;z-index:100;
}
.logo{font-weight:700;font-size:1rem;color:var(--blue)}
.logo span{color:var(--muted);font-weight:400}
.header-right{display:flex;align-items:center;gap:1rem}
.ts{font-size:.75rem;color:var(--muted)}
.conn{display:flex;align-items:center;gap:.4rem;font-size:.78rem;color:var(--muted)}
.conn-dot{width:8px;height:8px;border-radius:50%;background:var(--green);
  box-shadow:0 0 6px var(--green);transition:background .3s}
.conn-dot.err{background:var(--red);box-shadow:0 0 6px var(--red)}

main{flex:1;padding:1.25rem 1.5rem;display:flex;flex-direction:column;
  gap:1.5rem;max-width:1400px;margin:0 auto;width:100%}

/* ── Cards ─────────────────────────────────────────────────── */
.card{background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius);padding:1.1rem 1.25rem}
.card-title{font-size:.7rem;font-weight:600;text-transform:uppercase;
  letter-spacing:.07em;color:var(--muted);margin-bottom:.85rem}

/* ── Stats bar ──────────────────────────────────────────────── */
.stats-bar{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));
  gap:var(--gap)}
.stat{background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius);padding:.85rem 1rem;position:relative;overflow:hidden}
.stat::after{content:'';position:absolute;inset:0;border-radius:var(--radius);
  border-top:2px solid var(--accent,var(--blue));pointer-events:none}
.stat-label{font-size:.68rem;font-weight:600;text-transform:uppercase;
  letter-spacing:.07em;color:var(--muted);margin-bottom:.3rem}
.stat-value{font-size:1.75rem;font-weight:800;color:var(--accent,var(--blue));line-height:1}

/* ── Regulation tabs ────────────────────────────────────────── */
.tabs{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1rem}
.tab{padding:.4rem .9rem;border-radius:9999px;font-size:.78rem;font-weight:600;
  cursor:pointer;border:1px solid var(--border);background:var(--surface2);
  color:var(--muted);transition:all .15s;user-select:none}
.tab:hover{border-color:var(--blue);color:var(--blue)}
.tab.active{background:var(--blue-dim);border-color:var(--blue);color:#e2e8f0}

/* ── Tenant table ───────────────────────────────────────────── */
.tbl{width:100%;border-collapse:collapse}
.tbl th{font-size:.68rem;font-weight:600;text-transform:uppercase;
  letter-spacing:.06em;color:var(--muted);padding:.45rem .7rem;
  border-bottom:1px solid var(--border);text-align:left;white-space:nowrap}
.tbl td{padding:.55rem .7rem;border-bottom:1px solid #16161f;
  color:var(--text);font-size:.82rem;vertical-align:middle}
.tbl tr:last-child td{border-bottom:none}
.tbl tbody tr.tenant-row{cursor:pointer;transition:background .1s}
.tbl tbody tr.tenant-row:hover td{background:var(--surface2)}
.tbl tbody tr.detail-row td{background:#0f0f15;padding:0}
.tbl tbody tr.detail-row.hidden{display:none}

/* ── Status badges ──────────────────────────────────────────── */
.badge{display:inline-block;border-radius:9999px;padding:.18rem .65rem;
  font-size:.7rem;font-weight:700;line-height:1.4;letter-spacing:.03em}
.badge-compliant{background:#14532d33;color:var(--green);border:1px solid #16a34a55}
.badge-partial{background:#78350f33;color:var(--yellow);border:1px solid #d9770055}
.badge-non_compliant{background:#7f1d1d33;color:var(--red);border:1px solid #ef444455}

/* ── Score bar ──────────────────────────────────────────────── */
.score-wrap{display:flex;align-items:center;gap:.5rem;min-width:130px}
.bar-track{flex:1;height:6px;background:#1e1e2e;border-radius:9999px;overflow:hidden}
.bar-fill{height:100%;border-radius:9999px;transition:width .4s ease}
.bar-pct{font-size:.72rem;color:var(--muted);min-width:34px;text-align:right}

/* ── Regulation dots ────────────────────────────────────────── */
.reg-dots{display:flex;gap:.35rem;align-items:center}
.reg-dot{font-size:.95rem;line-height:1;cursor:default}
.reg-dot[title]{cursor:help}

/* ── Cert link ──────────────────────────────────────────────── */
.cert-link{font-size:.75rem;color:var(--blue)}
.cert-link.disabled{color:var(--muted);cursor:not-allowed;opacity:.5}
.cert-link:hover:not(.disabled){text-decoration:underline}

/* ── Detail panel ───────────────────────────────────────────── */
.detail-panel{padding:1rem 1.25rem;border-top:1px solid var(--border)}
.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem;
  margin-bottom:1rem}
@media(max-width:700px){.detail-grid{grid-template-columns:1fr}}
.detail-section-title{font-size:.68rem;font-weight:600;text-transform:uppercase;
  letter-spacing:.07em;color:var(--muted);margin-bottom:.5rem}
.gap-item{display:flex;align-items:flex-start;gap:.5rem;
  padding:.4rem 0;border-bottom:1px solid #16161f;font-size:.8rem}
.gap-item:last-child{border-bottom:none}
.gap-id{font-family:monospace;font-size:.72rem;color:var(--blue);
  min-width:70px;flex-shrink:0}
.gap-desc{color:var(--text)}
.reg-breakdown{margin-top:.25rem}
.reg-row{display:flex;align-items:center;justify-content:space-between;
  padding:.3rem 0;border-bottom:1px solid #16161f;font-size:.8rem}
.reg-row:last-child{border-bottom:none}
.reg-name{font-weight:600;color:var(--blue)}

/* ── Gap analysis section ───────────────────────────────────── */
.gap-analysis{margin-top:.5rem}
.gap-bar-row{display:flex;align-items:center;gap:.75rem;margin-bottom:.5rem}
.gap-req-id{font-family:monospace;font-size:.72rem;color:var(--blue);min-width:80px}
.gap-count-bar{flex:1;height:8px;background:#1e1e2e;border-radius:9999px;overflow:hidden}
.gap-count-fill{height:100%;border-radius:9999px;background:var(--red)}
.gap-count-num{font-size:.72rem;color:var(--muted);min-width:30px;text-align:right}
.gap-req-desc{font-size:.75rem;color:var(--muted);flex:2;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ── Empty / loading states ─────────────────────────────────── */
.empty{color:var(--muted);text-align:center;padding:2rem;font-size:.85rem}
.loading{color:var(--muted);text-align:center;padding:3rem;font-size:.9rem;
  animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}

footer{padding:.75rem 1.5rem;border-top:1px solid var(--border);
  font-size:.7rem;color:var(--muted);text-align:center;background:var(--surface)}
</style>
</head>
<body>
<div class="shell">

<header>
  <div class="logo">Voice Jib-Jab <span>/ Compliance</span></div>
  <div class="header-right">
    <a href="/dashboard" style="font-size:.8rem;color:var(--muted)">&#8592; Back to Dashboard</a>
    <div class="conn"><div class="conn-dot" id="dot"></div><span id="conn-label">Loading…</span></div>
    <div class="ts" id="ts">--:--:--</div>
  </div>
</header>

<main>

<!-- ── Stats bar ──────────────────────────────────────────────── -->
<div class="stats-bar" id="stats-bar">
  <div class="stat" style="--accent:var(--green)">
    <div class="stat-label">Compliant</div>
    <div class="stat-value" id="stat-compliant">--</div>
  </div>
  <div class="stat" style="--accent:var(--yellow)">
    <div class="stat-label">Partial</div>
    <div class="stat-value" id="stat-partial">--</div>
  </div>
  <div class="stat" style="--accent:var(--red)">
    <div class="stat-label">Non-Compliant</div>
    <div class="stat-value" id="stat-noncompliant">--</div>
  </div>
  <div class="stat" style="--accent:var(--blue)">
    <div class="stat-label">Total Tenants</div>
    <div class="stat-value" id="stat-total">--</div>
  </div>
</div>

<!-- ── Tenant compliance table ───────────────────────────────── -->
<div class="card">
  <div class="card-title">Tenant Compliance Status</div>

  <div class="tabs" id="reg-tabs">
    <div class="tab active" data-reg="ALL">ALL</div>
    <div class="tab" data-reg="GDPR">GDPR</div>
    <div class="tab" data-reg="HIPAA">HIPAA</div>
    <div class="tab" data-reg="SOC2">SOC2</div>
    <div class="tab" data-reg="PCI_DSS">PCI_DSS</div>
    <div class="tab" data-reg="CCPA">CCPA</div>
  </div>

  <table class="tbl" id="tenant-table">
    <thead>
      <tr>
        <th>Tenant</th>
        <th>Status</th>
        <th>Score</th>
        <th>GDPR</th>
        <th>HIPAA</th>
        <th>SOC2</th>
        <th>PCI_DSS</th>
        <th>CCPA</th>
        <th>Certificate</th>
        <th>Report</th>
      </tr>
    </thead>
    <tbody id="tenant-body">
      <tr><td colspan="10" class="loading">Loading compliance data…</td></tr>
    </tbody>
  </table>
</div>

<!-- ── Gap analysis ──────────────────────────────────────────── -->
<div class="card" id="gap-card">
  <div class="card-title">Gap Analysis — Requirements Failing Across Most Tenants</div>
  <div id="gap-analysis-wrap" class="gap-analysis">
    <div class="empty">No data loaded yet</div>
  </div>
</div>

</main>

<footer>
  Voice Jib-Jab &mdash; compliance view &mdash; auto-refresh every 30s &mdash;
  <a href="/dashboard">/dashboard</a> &nbsp;·&nbsp;
  <a href="/compliance-dashboard/overview">/compliance-dashboard/overview</a>
</footer>
</div>

<script>
'use strict';

// ── State ─────────────────────────────────────────────────────
let overviewData = null;
let activeReg = 'ALL';

// ── DOM helpers ───────────────────────────────────────────────
function qs(id){ return document.getElementById(id); }

function statusBadge(status){
  return '<span class="badge badge-' + status + '">' +
    status.replace('_', ' ').toUpperCase() + '</span>';
}

function regDot(status){
  const color = status === 'compliant' ? '#22c55e'
              : status === 'partial'   ? '#eab308'
              :                          '#ef4444';
  const label = status.replace('_', ' ');
  return '<span class="reg-dot" title="' + label + '" style="color:' + color + '">&#9679;</span>';
}

function scoreBar(pct){
  const color = pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--yellow)' : 'var(--red)';
  return '<div class="score-wrap">' +
    '<div class="bar-track"><div class="bar-fill" style="width:' + Math.min(pct,100).toFixed(1) + '%;background:' + color + '"></div></div>' +
    '<div class="bar-pct">' + pct.toFixed(1) + '%</div>' +
    '</div>';
}

// ── Render tenant detail panel ────────────────────────────────
function renderDetail(report){
  const regs = ['GDPR','HIPAA','SOC2','PCI_DSS','CCPA'];

  // Regulation breakdown
  let regRows = regs.map(reg => {
    const r = report.byRegulation[reg];
    return '<div class="reg-row">' +
      '<span class="reg-name">' + reg + '</span>' +
      '<span>' + statusBadge(r.status) + '</span>' +
      '<span style="color:var(--muted);font-size:.78rem">' + r.passed + '/' + r.total + ' passed</span>' +
      '</div>';
  }).join('');

  // Gaps
  let gapRows = report.gaps.length === 0
    ? '<div style="color:var(--green);font-size:.8rem;padding:.5rem 0">No gaps — all requirements met</div>'
    : report.gaps.map(g =>
        '<div class="gap-item">' +
          '<span class="gap-id">' + g.requirementId + '</span>' +
          '<span class="gap-desc">' + escHtml(g.description) + '</span>' +
        '</div>'
      ).join('');

  return '<div class="detail-panel">' +
    '<div class="detail-grid">' +
      '<div>' +
        '<div class="detail-section-title">Regulation Breakdown</div>' +
        '<div class="reg-breakdown">' + regRows + '</div>' +
      '</div>' +
      '<div>' +
        '<div class="detail-section-title">Gaps (' + report.gaps.length + ')</div>' +
        gapRows +
      '</div>' +
    '</div>' +
  '</div>';
}

// ── Render tenant table ───────────────────────────────────────
function renderTenants(reports){
  const regs = ['GDPR','HIPAA','SOC2','PCI_DSS','CCPA'];
  const body = qs('tenant-body');

  const filtered = activeReg === 'ALL'
    ? reports
    : reports.filter(r => r.byRegulation[activeReg].status !== 'compliant' ||
                          r.byRegulation[activeReg].status === 'compliant');
  // For regulation tab filtering, highlight non-compliant for that reg
  // but show all tenants (dimming fully compliant ones)

  if(!filtered.length){
    body.innerHTML = '<tr><td colspan="10" class="empty">No tenants</td></tr>';
    return;
  }

  const rows = filtered.map(report => {
    const rowId = 'detail-' + report.tenantId.replace(/[^a-zA-Z0-9]/g,'_');
    const certLink = report.certificateEligible
      ? '<a class="cert-link" href="/compliance-dashboard/tenants/' + encodeURIComponent(report.tenantId) + '/certificate" target="_blank">View Certificate</a>'
      : '<span class="cert-link disabled" title="Score below 80% required">View Certificate</span>';

    const dimStyle = (activeReg !== 'ALL' && report.byRegulation[activeReg].status === 'compliant')
      ? ' style="opacity:0.5"'
      : '';

    return '<tr class="tenant-row" data-tenant="' + escAttr(report.tenantId) + '" data-detail="' + rowId + '"' + dimStyle + '>' +
        '<td><code style="font-size:.78rem;color:var(--blue)">' + escHtml(report.tenantId) + '</code></td>' +
        '<td>' + statusBadge(report.overallStatus) + '</td>' +
        '<td>' + scoreBar(report.complianceScorePct) + '</td>' +
        regs.map(reg => '<td>' + regDot(report.byRegulation[reg].status) + '</td>').join('') +
        '<td>' + certLink + '</td>' +
        '<td><a class="cert-link" href="/compliance-dashboard/tenants/' + encodeURIComponent(report.tenantId) + '" target="_blank">View Report</a></td>' +
      '</tr>' +
      '<tr class="detail-row hidden" id="' + rowId + '">' +
        '<td colspan="10">' + renderDetail(report) + '</td>' +
      '</tr>';
  }).join('');

  body.innerHTML = rows;

  // Bind click-to-expand on tenant rows
  body.querySelectorAll('.tenant-row').forEach(row => {
    row.addEventListener('click', function(e){
      // Don't intercept link clicks
      if(e.target.tagName === 'A'){ return; }
      const detailId = this.getAttribute('data-detail');
      const detailRow = document.getElementById(detailId);
      if(!detailRow){ return; }
      detailRow.classList.toggle('hidden');
    });
  });
}

// ── Render gap analysis ───────────────────────────────────────
function renderGapAnalysis(reports){
  const wrap = qs('gap-analysis-wrap');
  if(!reports.length){ wrap.innerHTML = '<div class="empty">No tenant data</div>'; return; }

  // Count how many tenants fail each requirement
  const failCounts = {};
  const reqMeta = {};
  reports.forEach(r => {
    r.gaps.forEach(g => {
      failCounts[g.requirementId] = (failCounts[g.requirementId] || 0) + 1;
      reqMeta[g.requirementId] = g;
    });
  });

  const sorted = Object.entries(failCounts)
    .sort((a,b) => b[1] - a[1])
    .slice(0, 10);

  if(!sorted.length){
    wrap.innerHTML = '<div style="color:var(--green);padding:.75rem;font-size:.85rem">No gaps detected across any tenant.</div>';
    return;
  }

  const maxCount = sorted[0][1];
  wrap.innerHTML = sorted.map(([reqId, count]) => {
    const meta = reqMeta[reqId];
    const pct = Math.round(count / maxCount * 100);
    return '<div class="gap-bar-row">' +
      '<span class="gap-req-id">' + escHtml(reqId) + '</span>' +
      '<div class="gap-count-bar"><div class="gap-count-fill" style="width:' + pct + '%"></div></div>' +
      '<span class="gap-count-num">' + count + '</span>' +
      '<span class="gap-req-desc" title="' + escAttr(meta.description) + '">' + escHtml(meta.description) + '</span>' +
    '</div>';
  }).join('');
}

// ── Render stats bar ──────────────────────────────────────────
function renderStats(overview){
  qs('stat-compliant').textContent = overview.compliantTenants;
  qs('stat-partial').textContent = overview.partialTenants;
  qs('stat-noncompliant').textContent = overview.nonCompliantTenants;
  qs('stat-total').textContent = overview.totalTenants;
}

// ── Fetch and refresh ─────────────────────────────────────────
let errCount = 0;

async function refresh(){
  try {
    const res = await fetch('/compliance-dashboard/overview');
    if(!res.ok) throw new Error('HTTP ' + res.status);
    overviewData = await res.json();

    renderStats(overviewData);
    renderTenants(overviewData.tenantReports || []);
    renderGapAnalysis(overviewData.tenantReports || []);

    errCount = 0;
    qs('dot').classList.remove('err');
    qs('conn-label').textContent = 'Live';
    qs('ts').textContent = new Date().toTimeString().slice(0,8);
  } catch(e){
    errCount++;
    qs('dot').classList.add('err');
    qs('conn-label').textContent = 'Error ' + errCount;
    console.warn('[Compliance] fetch error', e);
  }
}

// ── Regulation tab filter ─────────────────────────────────────
qs('reg-tabs').addEventListener('click', function(e){
  const tab = e.target.closest('.tab');
  if(!tab){ return; }
  activeReg = tab.getAttribute('data-reg');
  this.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  if(overviewData){
    renderTenants(overviewData.tenantReports || []);
  }
});

// ── Escape helpers ────────────────────────────────────────────
function escHtml(s){
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function escAttr(s){ return escHtml(s); }

// ── Init ──────────────────────────────────────────────────────
refresh();
setInterval(refresh, 30000);
</script>
</body>
</html>`;
}

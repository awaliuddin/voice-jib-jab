/**
 * Agent A/B Test Dashboard
 *
 * Serves a self-contained HTML page for managing and monitoring A/B tests.
 * Fetches /abtests on load, then fetches each test report in parallel.
 * Auto-refreshes every 30 s.
 *
 * Zero external JS/CSS dependencies.
 */

export function abTestDashboardHtml(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>VJJ A/B Test Dashboard</title>
<style>
/* ── Reset & tokens ─────────────────────────────────────── */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0a0a0f;--surface:#111118;--surface2:#16161f;--border:#1e1e2e;
  --text:#e2e8f0;--muted:#64748b;--blue:#3b82f6;--blue-dim:#1e3a5f;
  --green:#22c55e;--yellow:#eab308;--red:#ef4444;--orange:#f97316;
  --radius:10px;
}
html,body{height:100%;background:var(--bg);color:var(--text);
  font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.5}

/* ── Layout ─────────────────────────────────────────────── */
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
main{flex:1;padding:1.25rem 1.5rem;max-width:1400px;margin:0 auto;width:100%}
footer{padding:.75rem 1.5rem;border-top:1px solid var(--border);
  font-size:.7rem;color:var(--muted);text-align:center;background:var(--surface)}

/* ── Buttons ─────────────────────────────────────────────── */
.btn{display:inline-flex;align-items:center;gap:.35rem;padding:.4rem .85rem;
  border-radius:6px;border:none;cursor:pointer;font-size:.8rem;font-weight:600;
  transition:opacity .15s,background .15s;line-height:1}
.btn:hover{opacity:.85}
.btn-primary{background:var(--blue);color:#fff}
.btn-sm{padding:.28rem .6rem;font-size:.72rem}
.btn-yellow{background:#78350f55;color:var(--yellow);border:1px solid #78350f88}
.btn-green{background:#14532d55;color:var(--green);border:1px solid #14532d88}
.btn-red{background:#7f1d1d55;color:var(--red);border:1px solid #7f1d1d88}
.btn-blue{background:var(--blue-dim);color:var(--blue);border:1px solid #1e3a8a88}
.btn-gray{background:var(--surface2);color:var(--muted);border:1px solid var(--border)}

/* ── Card ─────────────────────────────────────────────────── */
.card{background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius);padding:1.1rem 1.25rem;margin-bottom:1.25rem}
.card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem}
.card-title{font-size:.7rem;font-weight:600;text-transform:uppercase;
  letter-spacing:.07em;color:var(--muted)}

/* ── Table ─────────────────────────────────────────────────── */
.tbl{width:100%;border-collapse:collapse}
.tbl th{font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;
  color:var(--muted);padding:.45rem .7rem;border-bottom:1px solid var(--border);
  text-align:left;white-space:nowrap}
.tbl td{padding:.55rem .7rem;border-bottom:1px solid var(--surface2);
  color:var(--text);font-size:.82rem;vertical-align:middle}
.tbl tr:last-child td{border-bottom:none}
.tbl tr:hover td{background:#13131a}
.empty{color:var(--muted);text-align:center;padding:2rem;font-size:.82rem}

/* ── Badges ─────────────────────────────────────────────────── */
.badge{display:inline-block;border-radius:9999px;padding:.18rem .6rem;
  font-size:.7rem;font-weight:600;line-height:1.4;white-space:nowrap}
.badge-green{background:#14532d33;color:var(--green)}
.badge-yellow{background:#78350f33;color:var(--yellow)}
.badge-blue{background:#1e3a8a33;color:var(--blue)}
.badge-gray{background:#1e1e2e;color:var(--muted)}

/* ── Quality bars ────────────────────────────────────────────── */
.qbars{display:flex;flex-direction:column;gap:3px;min-width:120px}
.qbar-row{display:flex;align-items:center;gap:.4rem}
.qbar-label{font-size:.65rem;color:var(--muted);width:10px;text-align:center}
.qbar-track{background:#1e1e2e;border-radius:9999px;height:8px;flex:1;overflow:hidden;min-width:60px}
.qbar-fill{height:100%;border-radius:9999px;transition:width .4s ease}

/* ── Spinner ─────────────────────────────────────────────────── */
@keyframes spin{to{transform:rotate(360deg)}}
.spinner{display:inline-block;width:12px;height:12px;border:2px solid var(--border);
  border-top-color:var(--blue);border-radius:50%;animation:spin .7s linear infinite;
  vertical-align:middle}

/* ── Modal overlay ───────────────────────────────────────────── */
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:200;
  display:flex;align-items:center;justify-content:center}
.overlay.hidden{display:none}
.modal{background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius);padding:1.5rem;width:min(96vw,640px);
  max-height:90vh;overflow-y:auto}
.modal-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem}
.modal-title{font-size:1rem;font-weight:700;color:var(--text)}
.modal-close{background:none;border:none;color:var(--muted);font-size:1.25rem;
  cursor:pointer;line-height:1;padding:.15rem .4rem;border-radius:4px}
.modal-close:hover{color:var(--text);background:var(--surface2)}

/* ── Form ────────────────────────────────────────────────────── */
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:.85rem 1rem}
.form-grid .full{grid-column:1/-1}
.form-group{display:flex;flex-direction:column;gap:.3rem}
.form-label{font-size:.72rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.form-input{background:var(--surface2);border:1px solid var(--border);border-radius:6px;
  padding:.45rem .65rem;color:var(--text);font-size:.84rem;width:100%;outline:none}
.form-input:focus{border-color:var(--blue)}
.form-section{grid-column:1/-1;font-size:.7rem;font-weight:700;text-transform:uppercase;
  letter-spacing:.07em;color:var(--blue);padding-top:.35rem;
  border-top:1px solid var(--border);margin-top:.15rem}
.form-actions{display:flex;gap:.65rem;justify-content:flex-end;margin-top:1rem;grid-column:1/-1}
.error-msg{color:var(--red);font-size:.78rem;margin-top:.5rem;display:none}
</style>
</head>
<body>
<div class="shell">

<!-- ── Header ───────────────────────────────────────────────────── -->
<header>
  <div class="logo">Voice Jib-Jab <span>/ A/B Tests</span></div>
  <div class="header-right">
    <button class="btn btn-primary" id="btn-new-test">+ New Test</button>
    <div class="conn"><div class="conn-dot" id="dot"></div><span id="conn-label">Loading…</span></div>
    <div class="ts" id="ts">--:--:--</div>
  </div>
</header>

<main>

<!-- ── Tests table card ──────────────────────────────────────────── -->
<div class="card">
  <div class="card-header">
    <div class="card-title">A/B Tests</div>
    <div style="display:flex;gap:.5rem;align-items:center">
      <select id="filter-status" class="form-input" style="width:auto;font-size:.78rem;padding:.3rem .55rem">
        <option value="">All statuses</option>
        <option value="active">Active</option>
        <option value="paused">Paused</option>
        <option value="concluded">Concluded</option>
      </select>
    </div>
  </div>
  <div style="overflow-x:auto">
    <table class="tbl" id="tests-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Tenant</th>
          <th>Status</th>
          <th>Variant A</th>
          <th>Variant B</th>
          <th>Sessions A / B</th>
          <th>Quality A vs B</th>
          <th>Winner</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody id="tests-body">
        <tr><td class="empty" colspan="9">Loading tests…</td></tr>
      </tbody>
    </table>
  </div>
</div>

</main>

<footer>Voice Jib-Jab &mdash; auto-refresh every 30 s &mdash;
  <a href="/dashboard" style="color:var(--blue);text-decoration:none">/dashboard</a>
  &nbsp;&middot;&nbsp;
  <a href="/health" style="color:var(--blue);text-decoration:none">/health</a>
</footer>
</div>

<!-- ── New Test Modal ─────────────────────────────────────────────── -->
<div class="overlay hidden" id="modal-overlay">
  <div class="modal">
    <div class="modal-header">
      <span class="modal-title">New A/B Test</span>
      <button class="modal-close" id="modal-close-btn" aria-label="Close">&times;</button>
    </div>
    <form id="new-test-form" autocomplete="off">
      <div class="form-grid">

        <div class="form-group full">
          <label class="form-label" for="f-name">Test Name <span style="color:var(--red)">*</span></label>
          <input class="form-input" id="f-name" type="text" placeholder="e.g. Empathetic voice vs. Standard" required/>
        </div>

        <div class="form-group">
          <label class="form-label" for="f-tenant">Tenant ID</label>
          <input class="form-input" id="f-tenant" type="text" placeholder="org_acme (leave blank for global)"/>
        </div>

        <div class="form-group">
          <label class="form-label" for="f-hypothesis">Hypothesis</label>
          <input class="form-input" id="f-hypothesis" type="text" placeholder="Empathetic voice reduces escalation"/>
        </div>

        <div class="form-section">Variant A</div>

        <div class="form-group">
          <label class="form-label" for="f-va-name">Name <span style="color:var(--red)">*</span></label>
          <input class="form-input" id="f-va-name" type="text" placeholder="Control" required/>
        </div>
        <div class="form-group">
          <label class="form-label" for="f-va-voice">Voice ID</label>
          <input class="form-input" id="f-va-voice" type="text" placeholder="voice_standard"/>
        </div>
        <div class="form-group full">
          <label class="form-label" for="f-va-persona">Persona ID</label>
          <input class="form-input" id="f-va-persona" type="text" placeholder="persona_default"/>
        </div>

        <div class="form-section">Variant B</div>

        <div class="form-group">
          <label class="form-label" for="f-vb-name">Name <span style="color:var(--red)">*</span></label>
          <input class="form-input" id="f-vb-name" type="text" placeholder="Treatment" required/>
        </div>
        <div class="form-group">
          <label class="form-label" for="f-vb-voice">Voice ID</label>
          <input class="form-input" id="f-vb-voice" type="text" placeholder="voice_empathetic"/>
        </div>
        <div class="form-group full">
          <label class="form-label" for="f-vb-persona">Persona ID</label>
          <input class="form-input" id="f-vb-persona" type="text" placeholder="persona_empathetic"/>
        </div>

        <div class="form-section">Settings</div>

        <div class="form-group">
          <label class="form-label" for="f-split">Split Ratio (A share, 0–1)</label>
          <input class="form-input" id="f-split" type="number" min="0" max="1" step="0.05" value="0.5"/>
        </div>
        <div class="form-group">
          <label class="form-label" for="f-min-samples">Min Samples per Variant</label>
          <input class="form-input" id="f-min-samples" type="number" min="1" step="1" value="10"/>
        </div>

        <div class="full">
          <div class="error-msg" id="form-error"></div>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-gray" id="modal-cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary" id="form-submit-btn">Create Test</button>
        </div>
      </div>
    </form>
  </div>
</div>

<script>
'use strict';

// ── Helpers ──────────────────────────────────────────────────────────
function qs(id){ return document.getElementById(id); }

function statusBadge(status){
  if(status === 'active')    return '<span class="badge badge-green">active</span>';
  if(status === 'paused')    return '<span class="badge badge-yellow">paused</span>';
  if(status === 'concluded') return '<span class="badge badge-blue">concluded</span>';
  return '<span class="badge badge-gray">'+status+'</span>';
}

function winnerBadge(test, report){
  if(test.status !== 'concluded'){
    if(report && report.winnerSuggestion !== 'insufficient_data'){
      const sug = report.winnerSuggestion;
      if(sug === 'A') return '<span class="badge badge-blue">A leading</span>';
      if(sug === 'B') return '<span class="badge badge-blue">B leading</span>';
    }
    return '<span class="spinner"></span>';
  }
  if(test.winner === 'A') return '<span class="badge badge-green">A wins &#x1F3C6;</span>';
  if(test.winner === 'B') return '<span class="badge badge-green">B wins &#x1F3C6;</span>';
  if(test.winner === 'none') return '<span class="badge badge-yellow">No clear winner</span>';
  return '<span style="color:var(--muted)">&#x2014;</span>';
}

function qualityBars(varA, varB){
  const qA = varA.avgQuality !== null ? Math.round(varA.avgQuality) : null;
  const qB = varB.avgQuality !== null ? Math.round(varB.avgQuality) : null;

  function bar(label, score, color){
    const w = score !== null ? Math.min(score, 100) : 0;
    const display = score !== null ? score : '—';
    return '<div class="qbar-row">'+
      '<div class="qbar-label" style="color:'+color+'">'+label+'</div>'+
      '<div class="qbar-track"><div class="qbar-fill" style="width:'+w+'%;background:'+color+'"></div></div>'+
      '<span style="font-size:.68rem;color:var(--muted);min-width:28px;text-align:right">'+display+'</span>'+
    '</div>';
  }

  const colA = qA !== null ? (qA >= 80 ? 'var(--green)' : qA >= 60 ? 'var(--yellow)' : 'var(--red)') : 'var(--muted)';
  const colB = qB !== null ? (qB >= 80 ? 'var(--green)' : qB >= 60 ? 'var(--yellow)' : 'var(--red)') : 'var(--muted)';

  return '<div class="qbars">'+bar('A', qA, colA)+bar('B', qB, colB)+'</div>';
}

function sessionsCell(varA, varB){
  return varA.totalSessions + ' / ' + varB.totalSessions;
}

function actionButtons(test){
  const id = test.testId;
  let html = '';

  if(test.status === 'active'){
    html += '<button class="btn btn-sm btn-blue" onclick="concludeTest(\''+id+'\')">Conclude</button> ';
    html += '<button class="btn btn-sm btn-yellow" onclick="pauseTest(\''+id+'\')">Pause</button> ';
  } else if(test.status === 'paused'){
    html += '<button class="btn btn-sm btn-green" onclick="resumeTest(\''+id+'\')">Resume</button> ';
  }

  html += '<button class="btn btn-sm btn-red" onclick="deleteTest(\''+id+'\','+JSON.stringify(test.name)+')">Delete</button>';
  return html;
}

// ── API calls ────────────────────────────────────────────────────────
async function apiFetch(method, path, body){
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if(body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  return res;
}

async function concludeTest(testId){
  await apiFetch('POST', '/abtests/'+testId+'/conclude', {});
  await refresh();
}

async function pauseTest(testId){
  await apiFetch('POST', '/abtests/'+testId+'/pause', {});
  await refresh();
}

async function resumeTest(testId){
  await apiFetch('POST', '/abtests/'+testId+'/resume', {});
  await refresh();
}

async function deleteTest(testId, name){
  if(!confirm('Delete test "'+name+'"? This cannot be undone.')) return;
  await apiFetch('DELETE', '/abtests/'+testId);
  await refresh();
}

// ── Render ───────────────────────────────────────────────────────────
function renderTable(reports){
  const body = qs('tests-body');
  const statusFilter = qs('filter-status').value;

  const filtered = statusFilter
    ? reports.filter(r => r.test.status === statusFilter)
    : reports;

  if(!filtered.length){
    body.innerHTML = '<tr><td class="empty" colspan="9">No tests found</td></tr>';
    return;
  }

  body.innerHTML = filtered.map(function(r){
    const test = r.test;
    const vA = r.variantA;
    const vB = r.variantB;

    return '<tr>'+
      '<td style="font-weight:600;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+escHtml(test.name)+'">'+escHtml(test.name)+'</td>'+
      '<td>'+(test.tenantId ? '<code style="font-size:.75rem;color:var(--blue)">'+escHtml(test.tenantId)+'</code>' : '<span style="color:var(--muted)">global</span>')+'</td>'+
      '<td>'+statusBadge(test.status)+'</td>'+
      '<td style="font-size:.78rem;color:var(--text)">'+escHtml(vA.name)+'</td>'+
      '<td style="font-size:.78rem;color:var(--text)">'+escHtml(vB.name)+'</td>'+
      '<td style="font-size:.8rem;color:var(--muted)">'+sessionsCell(vA, vB)+'</td>'+
      '<td>'+qualityBars(vA, vB)+'</td>'+
      '<td>'+winnerBadge(test, r)+'</td>'+
      '<td style="white-space:nowrap">'+actionButtons(test)+'</td>'+
    '</tr>';
  }).join('');
}

function escHtml(str){
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ── Fetch & refresh ──────────────────────────────────────────────────
let errCount = 0;
let cachedReports = [];

async function refresh(){
  try {
    const listRes = await fetch('/abtests');
    if(!listRes.ok) throw new Error('GET /abtests returned ' + listRes.status);
    const listData = await listRes.json();

    const tests = listData.tests || [];

    // Fetch each report in parallel
    const reports = await Promise.all(
      tests.map(function(t){
        return fetch('/abtests/'+t.testId)
          .then(function(r){ return r.ok ? r.json() : Promise.resolve({ test: t, variantA: { variant:'A', name: t.variantA.name, totalSessions:0, scoredSessions:0, avgQuality:null, avgDuration:null, avgTurnCount:null, escalationRate:null }, variantB: { variant:'B', name: t.variantB.name, totalSessions:0, scoredSessions:0, avgQuality:null, avgDuration:null, avgTurnCount:null, escalationRate:null }, winnerSuggestion:'insufficient_data', winnerSuggestionReason:'', totalSessions:0 }); })
          .catch(function(){ return { test: t, variantA: { variant:'A', name: t.variantA.name, totalSessions:0, scoredSessions:0, avgQuality:null, avgDuration:null, avgTurnCount:null, escalationRate:null }, variantB: { variant:'B', name: t.variantB.name, totalSessions:0, scoredSessions:0, avgQuality:null, avgDuration:null, avgTurnCount:null, escalationRate:null }, winnerSuggestion:'insufficient_data', winnerSuggestionReason:'', totalSessions:0 }; });
      })
    );

    cachedReports = reports;
    renderTable(cachedReports);

    errCount = 0;
    qs('dot').classList.remove('err');
    qs('conn-label').textContent = 'Live';
    qs('ts').textContent = new Date().toTimeString().slice(0,8);
  } catch(e){
    errCount++;
    qs('dot').classList.add('err');
    qs('conn-label').textContent = 'Retry ' + errCount;
    console.warn('[VJJ A/B] fetch error', e);
  }
}

// ── Status filter ────────────────────────────────────────────────────
qs('filter-status').addEventListener('change', function(){
  renderTable(cachedReports);
});

// ── Modal ────────────────────────────────────────────────────────────
function openModal(){
  qs('modal-overlay').classList.remove('hidden');
  qs('f-name').focus();
}

function closeModal(){
  qs('modal-overlay').classList.add('hidden');
  qs('new-test-form').reset();
  const errEl = qs('form-error');
  errEl.style.display = 'none';
  errEl.textContent = '';
}

qs('btn-new-test').addEventListener('click', openModal);
qs('modal-close-btn').addEventListener('click', closeModal);
qs('modal-cancel-btn').addEventListener('click', closeModal);

qs('modal-overlay').addEventListener('click', function(e){
  if(e.target === qs('modal-overlay')) closeModal();
});

qs('new-test-form').addEventListener('submit', async function(e){
  e.preventDefault();
  const submitBtn = qs('form-submit-btn');
  const errEl = qs('form-error');

  errEl.style.display = 'none';
  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating…';

  const splitVal = parseFloat(qs('f-split').value);
  const minSamples = parseInt(qs('f-min-samples').value, 10);

  const payload = {
    name: qs('f-name').value.trim(),
    tenantId: qs('f-tenant').value.trim() || null,
    hypothesis: qs('f-hypothesis').value.trim() || undefined,
    variantA: {
      name: qs('f-va-name').value.trim(),
      voiceId: qs('f-va-voice').value.trim() || undefined,
      personaId: qs('f-va-persona').value.trim() || undefined,
    },
    variantB: {
      name: qs('f-vb-name').value.trim(),
      voiceId: qs('f-vb-voice').value.trim() || undefined,
      personaId: qs('f-vb-persona').value.trim() || undefined,
    },
    splitRatio: Number.isFinite(splitVal) ? splitVal : 0.5,
    minSamplesPerVariant: Number.isFinite(minSamples) && minSamples > 0 ? minSamples : 10,
  };

  try {
    const res = await apiFetch('POST', '/abtests', payload);
    if(res.ok){
      closeModal();
      await refresh();
    } else {
      const data = await res.json().catch(function(){ return {}; });
      errEl.textContent = (data && data.error) ? data.error : 'Failed to create test ('+res.status+')';
      errEl.style.display = 'block';
    }
  } catch(err){
    errEl.textContent = 'Network error: ' + (err instanceof Error ? err.message : String(err));
    errEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create Test';
  }
});

// ── Boot ─────────────────────────────────────────────────────────────
refresh();
setInterval(refresh, 30000);
</script>
</body>
</html>`;
}

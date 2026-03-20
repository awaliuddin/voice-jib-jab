/**
 * Onboarding Wizard HTML
 *
 * Returns a fully self-contained HTML wizard page for enterprise tenant
 * onboarding. Uses the electric blue design system consistent with the
 * rest of the Voice Jib-Jab UI. No external dependencies.
 */

export function onboardingWizardHtml(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>VJJ — Tenant Onboarding Wizard</title>
<style>
/* ── Reset & tokens ─────────────────────────────────────────────────── */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0a0a0f;--surface:#111118;--border:#1e1e2e;
  --text:#e2e8f0;--muted:#64748b;--blue:#3b82f6;--blue-dim:#1d4ed8;
  --green:#22c55e;--yellow:#eab308;--red:#ef4444;--orange:#f97316;
  --radius:10px;--gap:1rem;
}
html,body{min-height:100%;background:var(--bg);color:var(--text);
  font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.5}

/* ── Layout ─────────────────────────────────────────────────────────── */
.shell{display:flex;flex-direction:column;min-height:100vh}
header{display:flex;align-items:center;justify-content:space-between;
  padding:.75rem 1.5rem;border-bottom:1px solid var(--border);background:var(--surface);
  position:sticky;top:0;z-index:100}
.logo{font-weight:700;font-size:1rem;color:var(--blue);letter-spacing:-.01em}
.logo span{color:var(--muted);font-weight:400}
main{flex:1;padding:2rem 1.5rem;max-width:760px;margin:0 auto;width:100%}
footer{padding:.75rem 1.5rem;border-top:1px solid var(--border);
  font-size:.7rem;color:var(--muted);text-align:center;background:var(--surface)}

/* ── Progress bar ────────────────────────────────────────────────────── */
.progress-wrap{margin-bottom:2rem}
.progress-steps{display:flex;align-items:center;gap:0}
.progress-step{display:flex;flex-direction:column;align-items:center;flex:1;position:relative}
.progress-step:not(:last-child)::after{
  content:'';position:absolute;top:16px;left:50%;width:100%;height:2px;
  background:var(--border);z-index:0}
.progress-step.complete::after,.progress-step.active::after{background:var(--blue)}
.step-circle{width:32px;height:32px;border-radius:50%;border:2px solid var(--border);
  background:var(--surface);display:flex;align-items:center;justify-content:center;
  font-size:.75rem;font-weight:700;color:var(--muted);position:relative;z-index:1;transition:all .25s}
.progress-step.complete .step-circle{background:var(--blue);border-color:var(--blue);color:#fff}
.progress-step.active .step-circle{border-color:var(--blue);color:var(--blue);
  box-shadow:0 0 0 3px rgba(59,130,246,.2)}
.step-label{font-size:.65rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;
  color:var(--muted);margin-top:.4rem;text-align:center;white-space:nowrap}
.progress-step.active .step-label{color:var(--blue)}
.progress-step.complete .step-label{color:var(--text)}

/* ── Cards ───────────────────────────────────────────────────────────── */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.5rem}
.card-title{font-size:1.1rem;font-weight:700;color:var(--text);margin-bottom:.35rem}
.card-subtitle{font-size:.82rem;color:var(--muted);margin-bottom:1.5rem}

/* ── Form elements ───────────────────────────────────────────────────── */
.field{margin-bottom:1.1rem}
label{display:block;font-size:.75rem;font-weight:600;color:var(--muted);
  text-transform:uppercase;letter-spacing:.05em;margin-bottom:.4rem}
input[type=text],input[type=email],select,textarea{
  width:100%;background:#0d0d14;border:1px solid var(--border);border-radius:6px;
  color:var(--text);padding:.55rem .75rem;font-size:.9rem;outline:none;
  transition:border-color .2s}
input[type=text]:focus,input[type=email]:focus,select:focus,textarea:focus{
  border-color:var(--blue);box-shadow:0 0 0 2px rgba(59,130,246,.15)}
select option{background:#111118}
textarea{resize:vertical;min-height:80px;font-family:inherit}

/* ── Range slider ─────────────────────────────────────────────────────── */
.slider-wrap{display:flex;align-items:center;gap:.75rem}
input[type=range]{flex:1;accent-color:var(--blue)}
.slider-val{font-size:.9rem;font-weight:700;color:var(--blue);min-width:36px;text-align:right}

/* ── Toggle ──────────────────────────────────────────────────────────── */
.toggle-row{display:flex;align-items:center;justify-content:space-between;padding:.5rem 0}
.toggle-label{font-size:.9rem;color:var(--text)}
.toggle{position:relative;width:40px;height:22px;flex-shrink:0}
.toggle input{opacity:0;width:0;height:0}
.toggle-track{position:absolute;inset:0;background:#1e1e2e;border-radius:9999px;
  cursor:pointer;transition:background .2s}
.toggle input:checked + .toggle-track{background:var(--blue)}
.toggle-knob{position:absolute;top:3px;left:3px;width:16px;height:16px;
  background:#fff;border-radius:50%;transition:transform .2s;pointer-events:none}
.toggle input:checked ~ .toggle-knob{transform:translateX(18px)}

/* ── Claims table ────────────────────────────────────────────────────── */
.claims-table{width:100%;border-collapse:collapse;margin-bottom:.75rem}
.claims-table th{font-size:.68rem;font-weight:600;text-transform:uppercase;
  letter-spacing:.06em;color:var(--muted);padding:.4rem .6rem;
  border-bottom:1px solid var(--border);text-align:left}
.claims-table td{padding:.4rem .6rem;border-bottom:1px solid #16161f;vertical-align:middle}
.claims-table tr:last-child td{border-bottom:none}
.btn-remove{background:none;border:none;color:var(--red);cursor:pointer;
  font-size:.85rem;padding:.2rem .4rem;border-radius:4px}
.btn-remove:hover{background:rgba(239,68,68,.1)}
.btn-add-claim{background:none;border:1px solid var(--border);color:var(--blue);
  padding:.4rem .9rem;border-radius:6px;cursor:pointer;font-size:.82rem;transition:all .2s}
.btn-add-claim:hover{border-color:var(--blue);background:rgba(59,130,246,.07)}
.claim-input{background:#0d0d14;border:1px solid var(--border);border-radius:4px;
  color:var(--text);padding:.3rem .5rem;font-size:.82rem;width:100%}

/* ── Navigation buttons ──────────────────────────────────────────────── */
.nav-row{display:flex;align-items:center;justify-content:space-between;margin-top:1.5rem;gap:.75rem}
.btn{display:inline-flex;align-items:center;gap:.4rem;padding:.55rem 1.2rem;
  border-radius:7px;font-size:.88rem;font-weight:600;cursor:pointer;
  transition:all .2s;border:none;text-decoration:none}
.btn-primary{background:var(--blue);color:#fff}
.btn-primary:hover:not(:disabled){background:var(--blue-dim)}
.btn-primary:disabled{opacity:.5;cursor:not-allowed}
.btn-secondary{background:transparent;color:var(--muted);border:1px solid var(--border)}
.btn-secondary:hover:not(:disabled){border-color:var(--muted);color:var(--text)}
.btn-secondary:disabled{opacity:.4;cursor:not-allowed}
.btn-ghost{background:transparent;color:var(--muted);border:none;font-size:.82rem;padding:.4rem .7rem}
.btn-ghost:hover{color:var(--text)}

/* ── Badges ──────────────────────────────────────────────────────────── */
.badge{display:inline-block;border-radius:9999px;padding:.18rem .6rem;
  font-size:.7rem;font-weight:600;line-height:1.4}
.badge-green{background:#14532d33;color:var(--green)}
.badge-red{background:#7f1d1d33;color:var(--red)}
.badge-blue{background:#1e3a8a33;color:var(--blue)}

/* ── Test call panel ─────────────────────────────────────────────────── */
.test-result{display:none;margin-top:1rem;padding:1rem;border-radius:8px;
  border:1px solid var(--border);background:#0d0d14}
.test-result.visible{display:block}
.test-result-row{display:flex;align-items:center;gap:.75rem;margin-bottom:.4rem}

/* ── Errors ──────────────────────────────────────────────────────────── */
.error-box{background:#7f1d1d22;border:1px solid var(--red);border-radius:6px;
  padding:.75rem 1rem;margin-bottom:1rem;font-size:.83rem;color:var(--red)}

/* ── Success screen ──────────────────────────────────────────────────── */
.success-screen{display:none;text-align:center;padding:3rem 1rem}
.success-screen.visible{display:block}
.success-icon{font-size:4rem;margin-bottom:1rem}
.success-title{font-size:1.5rem;font-weight:800;color:var(--green);margin-bottom:.5rem}
.success-sub{color:var(--muted);margin-bottom:2rem}

/* ── Step panels ─────────────────────────────────────────────────────── */
.step-panel{display:none}
.step-panel.active{display:block}
</style>
</head>
<body>
<div class="shell">

<!-- ── Header ──────────────────────────────────────────────────────── -->
<header>
  <div class="logo">Voice Jib-Jab <span>/ Tenant Onboarding</span></div>
  <div id="session-badge" style="font-size:.72rem;color:var(--muted)">Initializing…</div>
</header>

<main>

<!-- ── Progress bar ─────────────────────────────────────────────────── -->
<div class="progress-wrap" id="progress-wrap">
  <div class="progress-steps">
    <div class="progress-step active" id="prog-0">
      <div class="step-circle">1</div>
      <div class="step-label">Registration</div>
    </div>
    <div class="progress-step" id="prog-1">
      <div class="step-circle">2</div>
      <div class="step-label">Voice</div>
    </div>
    <div class="progress-step" id="prog-2">
      <div class="step-circle">3</div>
      <div class="step-label">Claims</div>
    </div>
    <div class="progress-step" id="prog-3">
      <div class="step-circle">4</div>
      <div class="step-label">Policy</div>
    </div>
    <div class="progress-step" id="prog-4">
      <div class="step-circle">5</div>
      <div class="step-label">Test Call</div>
    </div>
  </div>
</div>

<!-- ── Error display ─────────────────────────────────────────────────── -->
<div class="error-box" id="error-box" style="display:none"></div>

<!-- ── Step 1: Tenant Registration ──────────────────────────────────── -->
<div class="step-panel active" id="panel-0">
  <div class="card">
    <div class="card-title">Tenant Registration</div>
    <div class="card-subtitle">Tell us about your organization to get started.</div>

    <div class="field">
      <label for="tenantName">Organization Name <span style="color:var(--red)">*</span></label>
      <input type="text" id="tenantName" placeholder="Acme Corp" autocomplete="organization"/>
    </div>
    <div class="field">
      <label for="contactEmail">Contact Email</label>
      <input type="email" id="contactEmail" placeholder="admin@acme.com" autocomplete="email"/>
    </div>
    <div class="field">
      <label for="industry">Industry</label>
      <select id="industry">
        <option value="">Select industry…</option>
        <option value="financial_services">Financial Services</option>
        <option value="healthcare">Healthcare</option>
        <option value="retail">Retail &amp; E-Commerce</option>
        <option value="technology">Technology</option>
        <option value="telecommunications">Telecommunications</option>
        <option value="insurance">Insurance</option>
        <option value="government">Government</option>
        <option value="education">Education</option>
        <option value="other">Other</option>
      </select>
    </div>

    <div class="nav-row">
      <div></div>
      <div style="display:flex;gap:.5rem">
        <button class="btn btn-ghost" onclick="skipCurrentStep()">Skip</button>
        <button class="btn btn-primary" onclick="nextStep()">Next &rarr;</button>
      </div>
    </div>
  </div>
</div>

<!-- ── Step 2: Voice Configuration ──────────────────────────────────── -->
<div class="step-panel" id="panel-1">
  <div class="card">
    <div class="card-title">Voice Configuration</div>
    <div class="card-subtitle">Configure the voice profile for this tenant's agent.</div>

    <div class="field">
      <label for="voiceId">Voice Profile</label>
      <select id="voiceId">
        <option value="">Default voice</option>
        <option value="af_bella">Bella (Female, US)</option>
        <option value="af_nova">Nova (Female, US)</option>
        <option value="am_adam">Adam (Male, US)</option>
        <option value="bf_emma">Emma (Female, UK)</option>
        <option value="bm_george">George (Male, UK)</option>
        <option value="custom">Custom…</option>
      </select>
    </div>
    <div class="field">
      <label for="language">Language</label>
      <select id="language">
        <option value="en">English</option>
        <option value="es">Spanish</option>
        <option value="fr">French</option>
        <option value="de">German</option>
      </select>
    </div>
    <div class="field">
      <label>Speaking Speed</label>
      <div class="slider-wrap">
        <span style="font-size:.78rem;color:var(--muted)">0.5×</span>
        <input type="range" id="speed" min="0.5" max="2.0" step="0.1" value="1.0"
          oninput="document.getElementById('speed-val').textContent=parseFloat(this.value).toFixed(1)+'×'"/>
        <span style="font-size:.78rem;color:var(--muted)">2.0×</span>
        <div class="slider-val" id="speed-val">1.0×</div>
      </div>
    </div>

    <div class="nav-row">
      <button class="btn btn-secondary" onclick="prevStep()">&larr; Back</button>
      <div style="display:flex;gap:.5rem">
        <button class="btn btn-ghost" onclick="skipCurrentStep()">Skip</button>
        <button class="btn btn-primary" onclick="nextStep()">Next &rarr;</button>
      </div>
    </div>
  </div>
</div>

<!-- ── Step 3: Claims Registry ───────────────────────────────────────── -->
<div class="step-panel" id="panel-2">
  <div class="card">
    <div class="card-title">Claims Registry</div>
    <div class="card-subtitle">Define which factual claims the agent is permitted to make.</div>

    <table class="claims-table" id="claims-table">
      <thead>
        <tr>
          <th style="width:55%">Claim</th>
          <th>Allowed</th>
          <th>Escalate</th>
          <th></th>
        </tr>
      </thead>
      <tbody id="claims-body">
        <!-- rows inserted by JS -->
      </tbody>
    </table>
    <button class="btn-add-claim" onclick="addClaimRow()">+ Add Claim</button>

    <div class="nav-row">
      <button class="btn btn-secondary" onclick="prevStep()">&larr; Back</button>
      <div style="display:flex;gap:.5rem">
        <button class="btn btn-ghost" onclick="skipCurrentStep()">Skip</button>
        <button class="btn btn-primary" onclick="nextStep()">Next &rarr;</button>
      </div>
    </div>
  </div>
</div>

<!-- ── Step 4: Policy Rules ──────────────────────────────────────────── -->
<div class="step-panel" id="panel-3">
  <div class="card">
    <div class="card-title">Policy Rules</div>
    <div class="card-subtitle">Set escalation and content governance rules.</div>

    <div class="field">
      <label>Escalation Threshold (0 = never escalate, 10 = always escalate)</label>
      <div class="slider-wrap">
        <span style="font-size:.78rem;color:var(--muted)">0</span>
        <input type="range" id="escalationThreshold" min="0" max="10" step="1" value="5"
          oninput="document.getElementById('esc-val').textContent=this.value"/>
        <span style="font-size:.78rem;color:var(--muted)">10</span>
        <div class="slider-val" id="esc-val">5</div>
      </div>
    </div>

    <div class="field">
      <label for="blocklistKeywords">Blocklist Keywords <span style="font-weight:400;text-transform:none;letter-spacing:0">(one per line)</span></label>
      <textarea id="blocklistKeywords" placeholder="competitor_name&#10;restricted_term"></textarea>
    </div>

    <div class="toggle-row">
      <span class="toggle-label">Require Human Handoff on Escalation</span>
      <label class="toggle">
        <input type="checkbox" id="requireHumanHandoff"/>
        <div class="toggle-track"></div>
        <div class="toggle-knob"></div>
      </label>
    </div>

    <div class="nav-row">
      <button class="btn btn-secondary" onclick="prevStep()">&larr; Back</button>
      <div style="display:flex;gap:.5rem">
        <button class="btn btn-ghost" onclick="skipCurrentStep()">Skip</button>
        <button class="btn btn-primary" onclick="nextStep()">Next &rarr;</button>
      </div>
    </div>
  </div>
</div>

<!-- ── Step 5: Test Call ─────────────────────────────────────────────── -->
<div class="step-panel" id="panel-4">
  <div class="card">
    <div class="card-title">Test Call</div>
    <div class="card-subtitle">Run a test call to verify your configuration before going live.</div>

    <div style="text-align:center;padding:1.5rem 0">
      <button class="btn btn-primary" id="run-test-btn" onclick="runTestCall()" style="font-size:1rem;padding:.75rem 2rem">
        &#9654; Run Test Call
      </button>
    </div>

    <div class="test-result" id="test-result">
      <div class="test-result-row">
        <span id="test-badge"></span>
        <span id="test-latency" style="font-size:.82rem;color:var(--muted)"></span>
      </div>
      <div id="test-notes" style="font-size:.82rem;color:var(--muted)"></div>
    </div>

    <div class="nav-row">
      <button class="btn btn-secondary" onclick="prevStep()">&larr; Back</button>
      <div style="display:flex;gap:.5rem">
        <button class="btn btn-ghost" onclick="skipCurrentStep()">Skip</button>
        <button class="btn btn-primary" id="finish-btn" onclick="finishWizard()" disabled>Finish &rarr;</button>
      </div>
    </div>
  </div>
</div>

<!-- ── Success screen ────────────────────────────────────────────────── -->
<div class="success-screen" id="success-screen">
  <div class="success-icon">&#10003;</div>
  <div class="success-title">Onboarding Complete!</div>
  <div class="success-sub">Your tenant has been configured and is ready to go live.</div>
  <a href="/dashboard" class="btn btn-primary" style="display:inline-flex;margin:0 auto">
    Go to Dashboard &rarr;
  </a>
</div>

</main>

<footer>Voice Jib-Jab &mdash; Tenant Onboarding Wizard &nbsp;&middot;&nbsp;
  <a href="/dashboard" style="color:var(--blue);text-decoration:none">Dashboard</a></footer>
</div>

<script>
'use strict';

// ── State ─────────────────────────────────────────────────────────────
var SESSION_KEY = 'vjj_onboarding_session_id';
var TENANT_KEY  = 'vjj_onboarding_tenant_id';
var sessionId   = null;
var currentPanelIdx = 0;  // 0-4 for the 5 work steps
var testCallResult  = null;

var STEP_ORDER = [
  'tenant_registration',
  'voice_configuration',
  'claims_registry',
  'policy_rules',
  'test_call',
];

// ── Claim rows ────────────────────────────────────────────────────────
var claimRows = [];

function addClaimRow(claim, allowed, escalate) {
  var id = Date.now() + Math.random();
  claimRows.push({ id: id, claim: claim || '', allowed: allowed !== false, escalate: !!escalate });
  renderClaimsTable();
}

function removeClaimRow(id) {
  claimRows = claimRows.filter(function(r){ return r.id !== id; });
  renderClaimsTable();
}

function renderClaimsTable() {
  var tbody = document.getElementById('claims-body');
  if (!claimRows.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:var(--muted);text-align:center;padding:.75rem">No claims defined</td></tr>';
    return;
  }
  tbody.innerHTML = claimRows.map(function(r) {
    return '<tr>' +
      '<td><input class="claim-input" value="' + escHtml(r.claim) + '" data-id="' + r.id + '" data-field="claim" onchange="updateClaim(this)"/></td>' +
      '<td style="text-align:center"><input type="checkbox" ' + (r.allowed ? 'checked' : '') + ' data-id="' + r.id + '" data-field="allowed" onchange="updateClaim(this)"/></td>' +
      '<td style="text-align:center"><input type="checkbox" ' + (r.escalate ? 'checked' : '') + ' data-id="' + r.id + '" data-field="escalate" onchange="updateClaim(this)"/></td>' +
      '<td><button class="btn-remove" onclick="removeClaimRow(' + r.id + ')">&#10005;</button></td>' +
    '</tr>';
  }).join('');
}

function updateClaim(el) {
  var id = parseFloat(el.dataset.id);
  var field = el.dataset.field;
  var row = claimRows.find(function(r){ return r.id === id; });
  if (!row) return;
  if (field === 'claim') row.claim = el.value;
  else if (field === 'allowed') row.allowed = el.checked;
  else if (field === 'escalate') row.escalate = el.checked;
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Progress bar ──────────────────────────────────────────────────────
function updateProgress(stepIdx) {
  for (var i = 0; i < 5; i++) {
    var el = document.getElementById('prog-' + i);
    el.classList.remove('active', 'complete');
    if (i < stepIdx) el.classList.add('complete');
    else if (i === stepIdx) el.classList.add('active');
  }
}

// ── Panel navigation ──────────────────────────────────────────────────
function showPanel(idx) {
  for (var i = 0; i < 5; i++) {
    var p = document.getElementById('panel-' + i);
    p.classList.toggle('active', i === idx);
  }
  document.getElementById('success-screen').classList.remove('visible');
  document.getElementById('progress-wrap').style.display = '';
  currentPanelIdx = idx;
  updateProgress(idx);
  clearError();
}

function showSuccess() {
  for (var i = 0; i < 5; i++) {
    document.getElementById('panel-' + i).classList.remove('active');
  }
  document.getElementById('progress-wrap').style.display = 'none';
  document.getElementById('success-screen').classList.add('visible');
}

// ── Error display ─────────────────────────────────────────────────────
function showError(msg) {
  var box = document.getElementById('error-box');
  box.textContent = msg;
  box.style.display = '';
}

function clearError() {
  var box = document.getElementById('error-box');
  box.style.display = 'none';
  box.textContent = '';
}

// ── Collect payload for current step ─────────────────────────────────
function collectPayload() {
  var step = STEP_ORDER[currentPanelIdx];
  var payload = {};

  if (step === 'tenant_registration') {
    payload.tenantName    = document.getElementById('tenantName').value.trim();
    payload.contactEmail  = document.getElementById('contactEmail').value.trim();
    payload.industry      = document.getElementById('industry').value;
  } else if (step === 'voice_configuration') {
    var voiceId = document.getElementById('voiceId').value;
    if (voiceId) payload.voiceId = voiceId;
    payload.language = document.getElementById('language').value;
    payload.speed    = parseFloat(document.getElementById('speed').value);
  } else if (step === 'claims_registry') {
    payload.claimsEntries = claimRows.map(function(r) {
      return { claim: r.claim, allowed: r.allowed, requiresEscalation: r.escalate };
    });
  } else if (step === 'policy_rules') {
    payload.escalationThreshold = parseInt(document.getElementById('escalationThreshold').value, 10);
    var kw = document.getElementById('blocklistKeywords').value.trim();
    payload.blocklistKeywords = kw ? kw.split('\\n').map(function(s){ return s.trim(); }).filter(Boolean) : [];
    payload.requireHumanHandoff = document.getElementById('requireHumanHandoff').checked;
  } else if (step === 'test_call') {
    if (testCallResult !== null) {
      payload.testCallSuccess  = testCallResult.success;
      payload.testCallLatencyMs = testCallResult.latencyMs;
      payload.testCallNotes    = testCallResult.notes;
    }
  }

  return payload;
}

// ── API calls ─────────────────────────────────────────────────────────
async function apiPost(path, body) {
  var res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  var json = await res.json();
  if (!res.ok) {
    var msg = json.error || JSON.stringify(json);
    if (json.validationErrors && json.validationErrors.length) {
      msg = json.validationErrors.join(' / ');
    }
    throw new Error(msg);
  }
  return json;
}

// ── Wizard step advancement via API ───────────────────────────────────
async function nextStep() {
  clearError();
  if (!sessionId) { showError('Session not initialized. Please reload.'); return; }

  var step = STEP_ORDER[currentPanelIdx];

  // Test call step is handled separately by finishWizard()
  if (step === 'test_call') { finishWizard(); return; }

  try {
    var payload = collectPayload();
    await apiPost('/onboarding/sessions/' + sessionId + '/complete-step', payload);

    if (currentPanelIdx < 4) {
      showPanel(currentPanelIdx + 1);
    } else {
      showSuccess();
    }
  } catch (e) {
    showError(e.message);
  }
}

async function prevStep() {
  clearError();
  if (!sessionId) { showError('Session not initialized. Please reload.'); return; }

  try {
    await apiPost('/onboarding/sessions/' + sessionId + '/back', {});
    if (currentPanelIdx > 0) showPanel(currentPanelIdx - 1);
  } catch (e) {
    showError(e.message);
  }
}

async function skipCurrentStep() {
  clearError();
  if (!sessionId) { showError('Session not initialized. Please reload.'); return; }

  try {
    var res = await apiPost('/onboarding/sessions/' + sessionId + '/skip', {});
    if (res.complete) {
      showSuccess();
    } else if (currentPanelIdx < 4) {
      showPanel(currentPanelIdx + 1);
    } else {
      showSuccess();
    }
  } catch (e) {
    showError(e.message);
  }
}

// ── Test call simulation ──────────────────────────────────────────────
async function runTestCall() {
  var btn = document.getElementById('run-test-btn');
  btn.disabled = true;
  btn.textContent = 'Running…';

  // Simulate a test call with random latency
  await new Promise(function(r){ setTimeout(r, 1200 + Math.random() * 800); });

  var success  = Math.random() > 0.15;   // 85 % pass rate for demo
  var latencyMs = Math.round(180 + Math.random() * 220);
  var notes    = success
    ? 'Audio round-trip completed within SLA. Lane A reflex latency nominal.'
    : 'Audio round-trip exceeded SLA threshold. Check network configuration.';

  testCallResult = { success: success, latencyMs: latencyMs, notes: notes };

  var badge = success
    ? '<span class="badge badge-green">PASS</span>'
    : '<span class="badge badge-red">FAIL</span>';

  document.getElementById('test-badge').innerHTML = badge;
  document.getElementById('test-latency').textContent = latencyMs + ' ms round-trip';
  document.getElementById('test-notes').textContent   = notes;
  document.getElementById('test-result').classList.add('visible');

  btn.textContent = '&#9654; Re-run Test Call';
  btn.disabled = false;
  document.getElementById('finish-btn').disabled = false;
}

async function finishWizard() {
  clearError();
  if (!sessionId) { showError('Session not initialized. Please reload.'); return; }

  try {
    var payload = collectPayload();
    var res = await apiPost('/onboarding/sessions/' + sessionId + '/complete-step', payload);
    if (res.complete) {
      showSuccess();
    }
  } catch (e) {
    showError(e.message);
  }
}

// ── Initialise session on page load ──────────────────────────────────
async function initWizard() {
  var badge = document.getElementById('session-badge');

  // Try to resume existing session
  var storedSessionId = sessionStorage.getItem(SESSION_KEY);
  var tenantId = sessionStorage.getItem(TENANT_KEY);

  if (storedSessionId) {
    try {
      var existing = await fetch('/onboarding/sessions/' + storedSessionId);
      if (existing.ok) {
        var sess = await existing.json();
        sessionId = sess.sessionId;
        badge.textContent = 'Session: ' + sessionId.slice(0, 8) + '…';

        if (sess.complete) {
          showSuccess();
          return;
        }

        // Jump to the current step panel
        var idx = ['tenant_registration','voice_configuration','claims_registry','policy_rules','test_call']
          .indexOf(sess.currentStep);
        if (idx >= 0) showPanel(idx);
        return;
      }
    } catch (_) {
      // Fall through to create new session
    }
  }

  // Generate a demo tenantId for UI purposes (real apps would provide this)
  tenantId = tenantId || ('tenant_' + Math.random().toString(36).slice(2, 10));
  sessionStorage.setItem(TENANT_KEY, tenantId);

  try {
    var created = await apiPost('/onboarding/sessions', { tenantId: tenantId });
    sessionId = created.sessionId;
    sessionStorage.setItem(SESSION_KEY, sessionId);
    badge.textContent = 'Session: ' + sessionId.slice(0, 8) + '…';
    showPanel(0);
  } catch (e) {
    // If 409 — a session already exists for this tenant; fetch it
    if (e.message && e.message.includes('already exists')) {
      try {
        var byTenant = await fetch('/onboarding/tenants/' + tenantId);
        if (byTenant.ok) {
          var sess2 = await byTenant.json();
          sessionId = sess2.sessionId;
          sessionStorage.setItem(SESSION_KEY, sessionId);
          badge.textContent = 'Session: ' + sessionId.slice(0, 8) + '…';
          var idx2 = ['tenant_registration','voice_configuration','claims_registry','policy_rules','test_call']
            .indexOf(sess2.currentStep);
          showPanel(idx2 >= 0 ? idx2 : 0);
          return;
        }
      } catch (_) { /* ignore */ }
    }
    badge.textContent = 'Session error';
    showError('Could not initialize wizard session: ' + e.message);
  }
}

// Initialize on load
initWizard();
</script>
</body>
</html>`;
}

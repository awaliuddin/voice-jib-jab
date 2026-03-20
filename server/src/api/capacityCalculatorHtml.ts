/**
 * capacityCalculatorHtml
 *
 * Self-contained HTML capacity calculator for voice-jib-jab.
 * Renders a form that POSTs to /capacity/calculate and displays the results.
 * Zero external dependencies — vanilla DOM + CSS.
 * Design: electric blue design system matching the rest of the product.
 */

export function capacityCalculatorHtml(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>VJJ — Voice Agent Capacity Planner</title>
<style>
/* ── Reset & tokens ─────────────────────────────────────── */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0a0a0f;--surface:#111118;--surface2:#16161f;--border:#1e1e2e;
  --text:#e2e8f0;--muted:#64748b;--blue:#3b82f6;--blue-dim:#1d4ed8;
  --green:#22c55e;--yellow:#eab308;--red:#ef4444;--orange:#f97316;
  --radius:10px;--gap:1rem;
}
html,body{min-height:100%;background:var(--bg);color:var(--text);
  font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.5}

/* ── Shell ─────────────────────────────────────────────── */
.shell{display:flex;flex-direction:column;min-height:100vh}
header{display:flex;align-items:center;justify-content:space-between;
  padding:.75rem 1.5rem;border-bottom:1px solid var(--border);background:var(--surface);
  position:sticky;top:0;z-index:100}
.logo{font-weight:700;font-size:1rem;color:var(--blue);letter-spacing:-.01em}
.logo span{color:var(--muted);font-weight:400}
main{flex:1;padding:1.5rem;max-width:960px;margin:0 auto;width:100%;display:flex;flex-direction:column;gap:1.5rem}

/* ── Cards ─────────────────────────────────────────────── */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem 1.5rem}
.card-title{font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;
  color:var(--blue);margin-bottom:1rem}

/* ── Form grid ──────────────────────────────────────────── */
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
@media(max-width:600px){.form-grid{grid-template-columns:1fr}}
.form-group{display:flex;flex-direction:column;gap:.3rem}
.form-group.span2{grid-column:1/-1}
label{font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
input[type="number"],select{
  background:var(--surface2);color:var(--text);
  border:1px solid var(--border);border-radius:6px;
  padding:.5rem .75rem;font-size:.875rem;width:100%;
  transition:border-color .15s}
input[type="number"]:focus,select:focus{outline:none;border-color:var(--blue)}

/* ── Toggle ─────────────────────────────────────────────── */
.toggle-row{display:flex;align-items:center;justify-content:space-between;
  background:var(--surface2);border:1px solid var(--border);border-radius:6px;
  padding:.5rem .75rem}
.toggle-label{font-size:.85rem;color:var(--text)}
.toggle{position:relative;display:inline-block;width:40px;height:22px;flex-shrink:0}
.toggle input{opacity:0;width:0;height:0}
.slider{position:absolute;cursor:pointer;inset:0;background:#1e1e2e;
  border-radius:22px;transition:.2s}
.slider::before{content:'';position:absolute;height:16px;width:16px;
  left:3px;bottom:3px;background:var(--muted);border-radius:50%;transition:.2s}
.toggle input:checked+.slider{background:var(--blue-dim)}
.toggle input:checked+.slider::before{transform:translateX(18px);background:var(--blue)}

/* ── Button ─────────────────────────────────────────────── */
.btn{padding:.65rem 1.5rem;background:var(--blue);color:#fff;border:none;
  border-radius:6px;font-size:.875rem;font-weight:700;cursor:pointer;
  letter-spacing:.02em;transition:opacity .15s}
.btn:hover{opacity:.85}
.btn:disabled{opacity:.4;cursor:not-allowed}
.btn-row{display:flex;justify-content:flex-end;margin-top:.5rem}

/* ── Results ────────────────────────────────────────────── */
#results{display:none}
.metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:var(--gap)}
.metric{background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:1rem;position:relative}
.metric::after{content:'';position:absolute;top:0;left:0;right:0;height:2px;
  border-radius:8px 8px 0 0;background:var(--accent,var(--blue))}
.metric-label{font-size:.65rem;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:.25rem}
.metric-min{font-size:1.4rem;font-weight:800;color:var(--accent,var(--blue));line-height:1}
.metric-rec{font-size:.78rem;color:var(--muted);margin-top:.25rem}

/* ── Storage breakdown table ────────────────────────────── */
.tbl{width:100%;border-collapse:collapse;font-size:.82rem}
.tbl th{font-size:.66rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);
  padding:.4rem .6rem;border-bottom:1px solid var(--border);text-align:left}
.tbl td{padding:.45rem .6rem;border-bottom:1px solid var(--surface2);vertical-align:middle}
.tbl tr:last-child td{border-bottom:none}

/* ── Kubernetes block ───────────────────────────────────── */
#k8s-block{display:none}
.kv-grid{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}
.kv{background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:.6rem .8rem}
.kv-key{font-size:.65rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:.15rem}
.kv-val{font-size:.95rem;font-weight:700;color:var(--blue)}

/* ── Warnings & notes ───────────────────────────────────── */
.warn-list{display:flex;flex-direction:column;gap:.4rem}
.warn-item{background:#78350f22;border:1px solid #92400e55;border-radius:6px;
  padding:.55rem .8rem;font-size:.82rem;color:var(--yellow)}
.note-item{background:#1e1e2e;border-radius:6px;padding:.5rem .8rem;
  font-size:.82rem;color:var(--muted);list-style:none}

/* ── Cost banner ────────────────────────────────────────── */
.cost-banner{background:linear-gradient(135deg,#1d4ed820,#3b82f610);
  border:1px solid var(--blue-dim);border-radius:8px;padding:1rem 1.25rem;
  display:flex;align-items:center;gap:1rem;flex-wrap:wrap}
.cost-label{font-size:.72rem;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}
.cost-value{font-size:1.75rem;font-weight:800;color:var(--blue)}
.cost-sub{font-size:.72rem;color:var(--muted)}

/* ── Error ──────────────────────────────────────────────── */
#error-msg{display:none;background:#7f1d1d22;border:1px solid var(--red);
  border-radius:6px;padding:.75rem 1rem;font-size:.85rem;color:var(--red);margin-top:.5rem}

footer{padding:.75rem 1.5rem;border-top:1px solid var(--border);
  font-size:.7rem;color:var(--muted);text-align:center;background:var(--surface)}
</style>
</head>
<body>
<div class="shell">

<header>
  <div class="logo">Voice Jib-Jab <span>/ Capacity Planner</span></div>
</header>

<main>

<!-- ── Input form ──────────────────────────────────────────────────── -->
<div class="card">
  <div class="card-title">Workload Parameters</div>
  <div class="form-grid">

    <div class="form-group">
      <label for="peakConcurrentSessions">Peak Concurrent Sessions</label>
      <input type="number" id="peakConcurrentSessions" name="peakConcurrentSessions"
             min="1" value="20" required/>
    </div>

    <div class="form-group">
      <label for="avgSessionDurationMinutes">Avg Session Duration (minutes)</label>
      <input type="number" id="avgSessionDurationMinutes" name="avgSessionDurationMinutes"
             min="0.1" step="0.1" value="5" required/>
    </div>

    <div class="form-group">
      <label for="dailyCallVolume">Daily Call Volume</label>
      <input type="number" id="dailyCallVolume" name="dailyCallVolume"
             min="0" value="500" required/>
    </div>

    <div class="form-group">
      <label for="deploymentTarget">Deployment Target</label>
      <select id="deploymentTarget" name="deploymentTarget">
        <option value="single_server">Single Server</option>
        <option value="docker">Docker / Compose</option>
        <option value="kubernetes">Kubernetes</option>
      </select>
    </div>

    <!-- Recordings toggle -->
    <div class="form-group span2">
      <div class="toggle-row">
        <span class="toggle-label">Audio Recordings</span>
        <label class="toggle">
          <input type="checkbox" id="recordingsEnabled"/>
          <span class="slider"></span>
        </label>
      </div>
    </div>

    <div class="form-group" id="retentionGroup" style="display:none">
      <label for="recordingRetentionDays">Recording Retention (days)</label>
      <input type="number" id="recordingRetentionDays" name="recordingRetentionDays"
             min="1" value="30"/>
    </div>

    <!-- Feature toggles -->
    <div class="form-group span2">
      <div class="toggle-row" style="margin-bottom:.5rem">
        <span class="toggle-label">RAG / ChromaDB Embeddings</span>
        <label class="toggle">
          <input type="checkbox" id="ragEnabled"/>
          <span class="slider"></span>
        </label>
      </div>
      <div class="toggle-row" style="margin-bottom:.5rem">
        <span class="toggle-label">Sentiment Analysis</span>
        <label class="toggle">
          <input type="checkbox" id="sentimentAnalysisEnabled"/>
          <span class="slider"></span>
        </label>
      </div>
      <div class="toggle-row">
        <span class="toggle-label">Policy Evaluation (Lane C)</span>
        <label class="toggle">
          <input type="checkbox" id="policyEvaluationEnabled"/>
          <span class="slider"></span>
        </label>
      </div>
    </div>

  </div>

  <div id="error-msg"></div>

  <div class="btn-row">
    <button class="btn" id="calcBtn" onclick="runCalculation()">Calculate</button>
  </div>
</div>

<!-- ── Results ─────────────────────────────────────────────────────── -->
<div id="results">

  <!-- Core metrics -->
  <div class="card">
    <div class="card-title">Core Resource Requirements</div>
    <div class="metric-grid">

      <div class="metric" style="--accent:var(--blue)">
        <div class="metric-label">CPU</div>
        <div class="metric-min" id="r-cpu-min">--</div>
        <div class="metric-rec" id="r-cpu-rec">recommended: --</div>
      </div>

      <div class="metric" style="--accent:var(--green)">
        <div class="metric-label">RAM</div>
        <div class="metric-min" id="r-ram-min">--</div>
        <div class="metric-rec" id="r-ram-rec">recommended: --</div>
      </div>

      <div class="metric" style="--accent:var(--orange)">
        <div class="metric-label">Storage</div>
        <div class="metric-min" id="r-storage-min">--</div>
        <div class="metric-rec" id="r-storage-rec">recommended: --</div>
      </div>

      <div class="metric" style="--accent:var(--yellow)">
        <div class="metric-label">Network</div>
        <div class="metric-min" id="r-net-min">--</div>
        <div class="metric-rec" id="r-net-rec">recommended: --</div>
      </div>

    </div>
  </div>

  <!-- Cost estimate -->
  <div class="card">
    <div class="card-title">Monthly Cloud Cost Estimate</div>
    <div class="cost-banner">
      <div>
        <div class="cost-label">Estimated monthly cost</div>
        <div class="cost-value" id="r-cost">$-- – $--</div>
        <div class="cost-sub">Based on standard cloud pricing (CPU $0.048/vCPU-hr, RAM $0.006/GB-hr, SSD $0.02/GB-mo)</div>
      </div>
    </div>
  </div>

  <!-- Storage breakdown -->
  <div class="card">
    <div class="card-title">Storage Breakdown</div>
    <table class="tbl" id="storage-table">
      <thead><tr>
        <th>Component</th>
        <th>Per Session (MB)</th>
        <th>Daily (GB)</th>
        <th>Retention (GB)</th>
        <th>Total (GB)</th>
      </tr></thead>
      <tbody id="storage-body"></tbody>
    </table>
  </div>

  <!-- Kubernetes block -->
  <div class="card" id="k8s-block">
    <div class="card-title">Kubernetes Configuration</div>
    <div class="kv-grid">
      <div class="kv"><div class="kv-key">Min Replicas</div><div class="kv-val" id="k-minr">--</div></div>
      <div class="kv"><div class="kv-key">Max Replicas</div><div class="kv-val" id="k-maxr">--</div></div>
      <div class="kv"><div class="kv-key">CPU Request / Pod</div><div class="kv-val" id="k-cpureq">--</div></div>
      <div class="kv"><div class="kv-key">CPU Limit / Pod</div><div class="kv-val" id="k-cpulim">--</div></div>
      <div class="kv"><div class="kv-key">Mem Request / Pod</div><div class="kv-val" id="k-memreq">--</div></div>
      <div class="kv"><div class="kv-key">Mem Limit / Pod</div><div class="kv-val" id="k-memlim">--</div></div>
      <div class="kv"><div class="kv-key">HPA CPU Target</div><div class="kv-val" id="k-hpa">--</div></div>
    </div>
  </div>

  <!-- Warnings -->
  <div class="card" id="warnings-card" style="display:none">
    <div class="card-title" style="color:var(--yellow)">Warnings</div>
    <div class="warn-list" id="warnings-list"></div>
  </div>

  <!-- Scaling notes -->
  <div class="card" id="notes-card" style="display:none">
    <div class="card-title">Scaling Notes</div>
    <ul style="display:flex;flex-direction:column;gap:.4rem;padding:0" id="notes-list"></ul>
  </div>

</div><!-- /#results -->

</main>

<footer>Voice Jib-Jab &mdash; Capacity Planner &mdash; <a href="/dashboard" style="color:var(--blue);text-decoration:none">/dashboard</a></footer>
</div>

<script>
'use strict';

// Show/hide recording retention field
document.getElementById('recordingsEnabled').addEventListener('change', function() {
  document.getElementById('retentionGroup').style.display = this.checked ? '' : 'none';
});

function gv(id) { return document.getElementById(id); }

function getInput() {
  return {
    peakConcurrentSessions: parseInt(gv('peakConcurrentSessions').value, 10) || 0,
    avgSessionDurationMinutes: parseFloat(gv('avgSessionDurationMinutes').value) || 0,
    dailyCallVolume: parseInt(gv('dailyCallVolume').value, 10) || 0,
    recordingsEnabled: gv('recordingsEnabled').checked,
    recordingRetentionDays: parseInt(gv('recordingRetentionDays').value, 10) || 0,
    ragEnabled: gv('ragEnabled').checked,
    sentimentAnalysisEnabled: gv('sentimentAnalysisEnabled').checked,
    policyEvaluationEnabled: gv('policyEvaluationEnabled').checked,
    deploymentTarget: gv('deploymentTarget').value,
  };
}

async function runCalculation() {
  const btn = gv('calcBtn');
  const errEl = gv('error-msg');
  btn.disabled = true;
  btn.textContent = 'Calculating…';
  errEl.style.display = 'none';

  try {
    const payload = getInput();
    const resp = await fetch('/capacity/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();

    if (!resp.ok) {
      errEl.textContent = data.error || 'Calculation failed';
      errEl.style.display = '';
      return;
    }

    renderResults(data);
  } catch(e) {
    errEl.textContent = 'Network error: ' + (e.message || e);
    errEl.style.display = '';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Calculate';
  }
}

function fmt(n, unit) { return n + ' ' + unit; }

function renderResults(d) {
  // CPU
  gv('r-cpu-min').textContent = fmt(d.cpu.minimumCores, 'cores min');
  gv('r-cpu-rec').textContent = 'recommended: ' + d.cpu.recommendedCores + ' cores';

  // RAM
  gv('r-ram-min').textContent = fmt(d.ram.minimumGb, 'GB min');
  gv('r-ram-rec').textContent = 'recommended: ' + d.ram.recommendedGb + ' GB';

  // Storage
  gv('r-storage-min').textContent = fmt(d.storage.minimumGb, 'GB min');
  gv('r-storage-rec').textContent = 'recommended: ' + d.storage.recommendedGb + ' GB';

  // Network
  gv('r-net-min').textContent = fmt(d.network.minimumMbps, 'Mbps min');
  gv('r-net-rec').textContent = 'recommended: ' + d.network.recommendedMbps + ' Mbps';

  // Cost
  gv('r-cost').textContent = '$' + d.totalMonthlyCostEstimateUsd.low.toLocaleString() +
    ' – $' + d.totalMonthlyCostEstimateUsd.high.toLocaleString();

  // Storage breakdown
  const sb = gv('storage-body');
  sb.innerHTML = d.storage.breakdown.map(function(row) {
    return '<tr>' +
      '<td>' + row.component + '</td>' +
      '<td>' + row.perSessionMb.toFixed(2) + '</td>' +
      '<td>' + row.dailyGb.toFixed(3) + '</td>' +
      '<td>' + row.retentionGb.toFixed(2) + '</td>' +
      '<td style="font-weight:700">' + row.totalGb.toFixed(2) + '</td>' +
    '</tr>';
  }).join('');

  // Kubernetes
  const k8sBlock = gv('k8s-block');
  if (d.kubernetes) {
    k8sBlock.style.display = '';
    gv('k-minr').textContent = d.kubernetes.minReplicas;
    gv('k-maxr').textContent = d.kubernetes.maxReplicas;
    gv('k-cpureq').textContent = d.kubernetes.cpuRequestPerPod;
    gv('k-cpulim').textContent = d.kubernetes.cpuLimitPerPod;
    gv('k-memreq').textContent = d.kubernetes.memRequestPerPod;
    gv('k-memlim').textContent = d.kubernetes.memLimitPerPod;
    gv('k-hpa').textContent = d.kubernetes.hpaTargetCpuPct + '%';
  } else {
    k8sBlock.style.display = 'none';
  }

  // Warnings
  const warnCard = gv('warnings-card');
  const warnList = gv('warnings-list');
  if (d.warnings && d.warnings.length) {
    warnCard.style.display = '';
    warnList.innerHTML = d.warnings.map(function(w) {
      return '<div class="warn-item">&#9888; ' + w + '</div>';
    }).join('');
  } else {
    warnCard.style.display = 'none';
  }

  // Scaling notes
  const notesCard = gv('notes-card');
  const notesList = gv('notes-list');
  if (d.scalingNotes && d.scalingNotes.length) {
    notesCard.style.display = '';
    notesList.innerHTML = d.scalingNotes.map(function(n) {
      return '<li class="note-item">&#8250; ' + n + '</li>';
    }).join('');
  } else {
    notesCard.style.display = 'none';
  }

  gv('results').style.display = '';
  gv('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
</script>
</body>
</html>`;
}

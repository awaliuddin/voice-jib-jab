/**
 * Demo Dashboard HTML — self-contained SPA for the voice agent demo mode.
 *
 * No external dependencies: all CSS and JavaScript is inlined.
 * Follows the electric blue design system used across the project.
 *
 * Routes consumed:
 *   GET  /demo/scenarios
 *   POST /demo/start
 *   GET  /demo/events/:sessionId
 *   DELETE /demo/session/:sessionId
 */

/**
 * Return the complete HTML page for the voice agent demo dashboard.
 *
 * The page is fully self-contained — no CDN links, no external fonts.
 * It talks directly to the /demo/* API endpoints on the same origin.
 *
 * @returns Complete HTML string including DOCTYPE, styles, and scripts
 */
export function demoDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Voice Agent Demo</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0a0a0f;
  --panel:#12121a;
  --border:#1e1e2e;
  --blue:#3b82f6;
  --blue-dim:rgba(59,130,246,0.12);
  --green:#10b981;
  --red:#ef4444;
  --yellow:#f59e0b;
  --purple:#8b5cf6;
  --text:#e2e8f0;
  --muted:#64748b;
  --radius:10px;
  --gap:1rem;
}
html,body{
  min-height:100vh;background:var(--bg);color:var(--text);
  font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  font-size:14px;line-height:1.5;
}

/* ── Header ──────────────────────────────────────────────────── */
header{
  display:flex;align-items:center;gap:1rem;flex-wrap:wrap;
  padding:.75rem 1.5rem;border-bottom:1px solid var(--border);
  background:var(--panel);position:sticky;top:0;z-index:100;
}
.logo{
  font-weight:800;font-size:1.05rem;color:var(--blue);
  letter-spacing:-.01em;white-space:nowrap;margin-right:auto;
}
.logo span{color:var(--muted);font-weight:400;font-size:.85rem}
.hctl{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}
select,button{
  background:var(--panel);color:var(--text);border:1px solid var(--border);
  border-radius:6px;padding:.35rem .75rem;font-size:.82rem;cursor:pointer;
  transition:border-color .15s,background .15s;outline:none;
}
select:hover,select:focus{border-color:var(--blue)}
button{
  background:var(--blue);border-color:var(--blue);color:#fff;
  font-weight:600;display:flex;align-items:center;gap:.4rem;
}
button:hover:not(:disabled){background:#2563eb;border-color:#2563eb}
button:disabled{opacity:.5;cursor:not-allowed}
.speed-wrap{display:flex;align-items:center;gap:.4rem}
.speed-wrap label{font-size:.78rem;color:var(--muted);white-space:nowrap}

/* ── Main layout ─────────────────────────────────────────────── */
.shell{display:flex;height:calc(100vh - 49px);overflow:hidden}

/* ── Transcript panel ────────────────────────────────────────── */
.transcript-panel{
  flex:0 0 60%;display:flex;flex-direction:column;
  border-right:1px solid var(--border);
}
.transcript-header{
  padding:.6rem 1rem;border-bottom:1px solid var(--border);
  font-size:.72rem;font-weight:600;text-transform:uppercase;
  letter-spacing:.06em;color:var(--muted);background:var(--panel);
}
.transcript-scroll{
  flex:1;overflow-y:auto;padding:1rem;display:flex;flex-direction:column;gap:.5rem;
  scroll-behavior:smooth;
}

/* ── Chat bubbles ────────────────────────────────────────────── */
.bubble-row{display:flex;animation:fadein .25s ease}
.bubble-row.agent{justify-content:flex-end}
.bubble-row.user{justify-content:flex-start}
.bubble{
  max-width:72%;padding:.55rem .85rem;border-radius:10px;
  font-size:.85rem;line-height:1.5;
}
.bubble-row.user .bubble{
  background:var(--panel);border-left:3px solid var(--blue);border-radius:3px 10px 10px 3px;
}
.bubble-row.agent .bubble{
  background:var(--blue-dim);border-right:3px solid var(--blue);border-radius:10px 3px 3px 10px;
}
.bubble-label{
  font-size:.65rem;font-weight:600;text-transform:uppercase;
  letter-spacing:.06em;color:var(--muted);margin-bottom:.2rem;
}
.bubble-row.agent .bubble-label{text-align:right}

/* ── Policy badges ───────────────────────────────────────────── */
.policy-row{display:flex;animation:fadein .2s ease;padding:0 .5rem}
.policy-row.agent{justify-content:flex-end}
.policy-row.user{justify-content:flex-start}
.badge{
  font-size:.68rem;font-weight:700;text-transform:uppercase;
  letter-spacing:.06em;padding:.2rem .6rem;border-radius:9999px;
  border:1px solid;display:inline-flex;align-items:center;gap:.3rem;
}
.badge.allow{color:var(--green);border-color:rgba(16,185,129,.35);background:rgba(16,185,129,.08)}
.badge.refuse{color:var(--red);border-color:rgba(239,68,68,.35);background:rgba(239,68,68,.08)}
.badge.escalate{color:var(--yellow);border-color:rgba(245,158,11,.35);background:rgba(245,158,11,.08)}
.badge.rewrite{color:var(--purple);border-color:rgba(139,92,246,.35);background:rgba(139,92,246,.08)}

/* ── Banners ─────────────────────────────────────────────────── */
.banner{
  text-align:center;font-size:.78rem;font-weight:600;
  padding:.35rem .75rem;border-radius:6px;animation:fadein .2s ease;
  margin:.25rem 0;
}
.banner.start{background:rgba(59,130,246,.12);color:var(--blue);border:1px solid rgba(59,130,246,.2)}
.banner.end{background:rgba(16,185,129,.1);color:var(--green);border:1px solid rgba(16,185,129,.2)}

/* ── Sidebar ─────────────────────────────────────────────────── */
.sidebar{
  flex:0 0 40%;display:flex;flex-direction:column;gap:1rem;
  overflow-y:auto;padding:1rem;
}
.card{
  background:var(--panel);border:1px solid var(--border);
  border-radius:var(--radius);padding:1rem 1.1rem;
}
.card-title{
  font-size:.68rem;font-weight:700;text-transform:uppercase;
  letter-spacing:.07em;color:var(--muted);margin-bottom:.75rem;
}

/* ── Scenario info card ──────────────────────────────────────── */
.scenario-name{font-size:.95rem;font-weight:700;color:var(--text);margin-bottom:.3rem}
.scenario-desc{font-size:.8rem;color:var(--muted);margin-bottom:.75rem;line-height:1.5}
.pitch-list{list-style:none;display:flex;flex-direction:column;gap:.4rem}
.pitch-item{
  font-size:.78rem;color:var(--text);padding:.3rem .5rem;
  border-left:2px solid var(--blue);padding-left:.6rem;line-height:1.4;
}

/* ── Metrics card ────────────────────────────────────────────── */
.metrics-grid{
  display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:.75rem;
}
.metric{
  background:rgba(255,255,255,.03);border:1px solid var(--border);
  border-radius:7px;padding:.5rem .65rem;
}
.metric-label{font-size:.65rem;font-weight:600;text-transform:uppercase;
  letter-spacing:.06em;color:var(--muted);margin-bottom:.15rem}
.metric-value{font-size:1.35rem;font-weight:800;line-height:1}
.metric-value.allow{color:var(--green)}
.metric-value.refuse{color:var(--red)}
.metric-value.escalate{color:var(--yellow)}
.metric-value.rewrite{color:var(--purple)}

/* ── Sentiment indicator ─────────────────────────────────────── */
.sentiment-wrap{display:flex;align-items:center;gap:.6rem}
.sentiment-dot{
  width:10px;height:10px;border-radius:50%;
  background:var(--muted);transition:background .3s,box-shadow .3s;
  flex-shrink:0;
}
.sentiment-dot.positive{background:var(--green);box-shadow:0 0 6px var(--green)}
.sentiment-dot.negative{background:var(--red);box-shadow:0 0 6px var(--red)}
.sentiment-dot.neutral{background:var(--yellow);box-shadow:0 0 6px var(--yellow)}
.sentiment-label{font-size:.82rem;color:var(--text);font-weight:600}

/* ── Summary card ────────────────────────────────────────────── */
#summary-card{display:none;animation:fadein .3s ease}
.summary-grid{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}
.summary-stat{
  background:rgba(255,255,255,.03);border:1px solid var(--border);
  border-radius:7px;padding:.5rem .65rem;
}
.summary-stat-label{font-size:.65rem;font-weight:600;text-transform:uppercase;
  letter-spacing:.06em;color:var(--muted);margin-bottom:.15rem}
.summary-stat-value{font-size:1.2rem;font-weight:800;color:var(--blue)}

/* ── Spinner ─────────────────────────────────────────────────── */
.spinner{
  width:14px;height:14px;border:2px solid rgba(255,255,255,.3);
  border-top-color:#fff;border-radius:50%;animation:spin .6s linear infinite;
  display:none;
}
.spinner.visible{display:block}

/* ── Animations ──────────────────────────────────────────────── */
@keyframes fadein{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes spin{to{transform:rotate(360deg)}}

/* ── Empty state ─────────────────────────────────────────────── */
.empty-state{
  flex:1;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:.75rem;color:var(--muted);
  font-size:.85rem;
}
.empty-icon{font-size:2rem}
</style>
</head>
<body>

<header>
  <div class="logo">Voice Agent Demo <span>/ Enterprise Preview</span></div>
  <div class="hctl">
    <select id="scenario-select" aria-label="Select scenario">
      <option value="support">Customer Support</option>
      <option value="compliance">Compliance Hotline</option>
      <option value="sales">Sales Qualification</option>
    </select>
    <div class="speed-wrap">
      <label for="speed-select">Speed</label>
      <select id="speed-select" aria-label="Playback speed">
        <option value="0.5">0.5x</option>
        <option value="1" selected>1x</option>
        <option value="2">2x</option>
        <option value="5">5x</option>
      </select>
    </div>
    <button id="play-btn" type="button">
      <div class="spinner" id="spinner"></div>
      <span id="play-label">&#9654; Play Demo</span>
    </button>
  </div>
</header>

<div class="shell">
  <!-- Transcript panel (60%) -->
  <div class="transcript-panel">
    <div class="transcript-header">Live Conversation</div>
    <div class="transcript-scroll" id="transcript">
      <div class="empty-state" id="empty-state">
        <div class="empty-icon">&#127908;</div>
        <div>Select a scenario and click <strong>&#9654; Play Demo</strong> to begin</div>
      </div>
    </div>
  </div>

  <!-- Sidebar (40%) -->
  <div class="sidebar">

    <!-- Scenario info card -->
    <div class="card" id="scenario-card">
      <div class="card-title">Scenario</div>
      <div class="scenario-name" id="scenario-name">Loading…</div>
      <div class="scenario-desc" id="scenario-desc"></div>
      <ul class="pitch-list" id="pitch-list"></ul>
    </div>

    <!-- Live metrics card -->
    <div class="card">
      <div class="card-title">Live Metrics</div>
      <div class="metrics-grid">
        <div class="metric">
          <div class="metric-label">Allow</div>
          <div class="metric-value allow" id="m-allow">0</div>
        </div>
        <div class="metric">
          <div class="metric-label">Refuse</div>
          <div class="metric-value refuse" id="m-refuse">0</div>
        </div>
        <div class="metric">
          <div class="metric-label">Escalate</div>
          <div class="metric-value escalate" id="m-escalate">0</div>
        </div>
        <div class="metric">
          <div class="metric-label">Rewrite</div>
          <div class="metric-value rewrite" id="m-rewrite">0</div>
        </div>
      </div>
      <div class="card-title" style="margin-top:.5rem">Sentiment</div>
      <div class="sentiment-wrap">
        <div class="sentiment-dot" id="sentiment-dot"></div>
        <div class="sentiment-label" id="sentiment-label">Waiting…</div>
      </div>
    </div>

    <!-- Summary card (shown after session_end + summary event) -->
    <div class="card" id="summary-card">
      <div class="card-title">Session Summary</div>
      <div class="summary-grid" id="summary-grid"></div>
    </div>

  </div>
</div>

<script>
(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────
  let sessionId = null;
  let pollTimer = null;
  let lastEventIndex = 0;
  let scenarios = [];
  const metrics = { allow: 0, refuse: 0, escalate: 0, rewrite: 0 };

  // ── DOM refs ───────────────────────────────────────────────────────
  const scenarioSelect = document.getElementById('scenario-select');
  const speedSelect = document.getElementById('speed-select');
  const playBtn = document.getElementById('play-btn');
  const playLabel = document.getElementById('play-label');
  const spinner = document.getElementById('spinner');
  const transcript = document.getElementById('transcript');
  const emptyState = document.getElementById('empty-state');
  const scenarioName = document.getElementById('scenario-name');
  const scenarioDesc = document.getElementById('scenario-desc');
  const pitchList = document.getElementById('pitch-list');
  const sentimentDot = document.getElementById('sentiment-dot');
  const sentimentLabel = document.getElementById('sentiment-label');
  const summaryCard = document.getElementById('summary-card');
  const summaryGrid = document.getElementById('summary-grid');
  const mAllow = document.getElementById('m-allow');
  const mRefuse = document.getElementById('m-refuse');
  const mEscalate = document.getElementById('m-escalate');
  const mRewrite = document.getElementById('m-rewrite');

  // ── Init ───────────────────────────────────────────────────────────
  async function init() {
    try {
      const res = await fetch('/demo/scenarios');
      const data = await res.json();
      scenarios = data.scenarios || [];
      renderScenarioInfo(scenarioSelect.value);
    } catch (e) {
      console.error('[Demo] Failed to load scenarios', e);
      renderScenarioInfo('support');
    }
  }

  // ── Scenario info sidebar ──────────────────────────────────────────
  function renderScenarioInfo(id) {
    const s = scenarios.find(function(x){ return x.id === id; });
    if (!s) return;
    scenarioName.textContent = s.name;
    scenarioDesc.textContent = s.description;
    pitchList.innerHTML = '';
    (s.pitchPoints || []).forEach(function(p) {
      const li = document.createElement('li');
      li.className = 'pitch-item';
      li.textContent = p;
      pitchList.appendChild(li);
    });
  }

  scenarioSelect.addEventListener('change', function() {
    renderScenarioInfo(scenarioSelect.value);
  });

  // ── Play button ────────────────────────────────────────────────────
  playBtn.addEventListener('click', async function() {
    if (playBtn.disabled) return;
    await startDemo();
  });

  async function startDemo() {
    // Clean up any previous session
    if (sessionId) {
      stopPolling();
      await fetch('/demo/session/' + sessionId, { method: 'DELETE' }).catch(function(){});
      sessionId = null;
    }

    // Reset state
    lastEventIndex = 0;
    metrics.allow = 0; metrics.refuse = 0; metrics.escalate = 0; metrics.rewrite = 0;
    updateMetricCounters();
    summaryCard.style.display = 'none';
    summaryGrid.innerHTML = '';
    sentimentDot.className = 'sentiment-dot';
    sentimentLabel.textContent = 'Waiting\u2026';

    // Clear transcript
    transcript.innerHTML = '';

    // Disable button, show spinner
    playBtn.disabled = true;
    spinner.classList.add('visible');
    playLabel.textContent = 'Starting\u2026';

    try {
      const speed = parseFloat(speedSelect.value) || 1;
      const res = await fetch('/demo/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: scenarioSelect.value, speed: speed }),
      });

      if (!res.ok) {
        const err = await res.json().catch(function(){ return {}; });
        throw new Error(err.error || 'Failed to start demo');
      }

      const data = await res.json();
      sessionId = data.sessionId;
      playLabel.textContent = 'Playing\u2026';

      // Start polling for events
      pollTimer = setInterval(pollEvents, 500);
    } catch (e) {
      console.error('[Demo] Start failed', e);
      playBtn.disabled = false;
      spinner.classList.remove('visible');
      playLabel.textContent = '\u25B6 Play Demo';
    }
  }

  // ── Event polling ──────────────────────────────────────────────────
  async function pollEvents() {
    if (!sessionId) return;
    try {
      const res = await fetch('/demo/events/' + sessionId);
      if (!res.ok) {
        stopPolling();
        resetPlayButton();
        return;
      }

      const data = await res.json();
      const events = data.events || [];

      // Render only new events since last poll
      const newEvents = events.slice(lastEventIndex);
      newEvents.forEach(renderEvent);
      lastEventIndex = events.length;

      // Stop polling when playback is done and all events are consumed
      if (!data.playing && lastEventIndex >= events.length && events.length > 0) {
        stopPolling();
        playBtn.disabled = false;
        spinner.classList.remove('visible');
        playLabel.textContent = '\u25B6 Play Again';
      }
    } catch (e) {
      console.error('[Demo] Poll error', e);
    }
  }

  function stopPolling() {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function resetPlayButton() {
    playBtn.disabled = false;
    spinner.classList.remove('visible');
    playLabel.textContent = '\u25B6 Play Demo';
  }

  // ── Event rendering ────────────────────────────────────────────────
  function renderEvent(ev) {
    switch (ev.type) {
      case 'session_start':
        appendBanner('Session started', 'start');
        break;
      case 'turn':
        appendBubble(ev);
        break;
      case 'policy':
        appendPolicyBadge(ev);
        break;
      case 'sentiment':
        updateSentiment(ev.sentiment || 'neutral');
        break;
      case 'session_end':
        appendBanner('Session ended', 'end');
        break;
      case 'summary':
        renderSummary(ev);
        break;
      default:
        break;
    }
    scrollTranscript();
  }

  function appendBanner(text, type) {
    emptyState && emptyState.remove && emptyState.remove();
    const el = document.createElement('div');
    el.className = 'banner ' + type;
    el.textContent = text;
    transcript.appendChild(el);
  }

  function appendBubble(ev) {
    if (emptyState && emptyState.parentNode) emptyState.parentNode.removeChild(emptyState);
    const row = document.createElement('div');
    row.className = 'bubble-row ' + (ev.speaker === 'agent' ? 'agent' : 'user');
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const label = document.createElement('div');
    label.className = 'bubble-label';
    label.textContent = ev.speaker === 'agent' ? 'Agent' : 'User';
    const text = document.createElement('div');
    text.textContent = ev.text || '';
    bubble.appendChild(label);
    bubble.appendChild(text);
    row.appendChild(bubble);
    transcript.appendChild(row);
  }

  function appendPolicyBadge(ev) {
    const decision = (ev.policyDecision || '').toLowerCase();
    const validDecisions = ['allow', 'refuse', 'escalate', 'rewrite'];
    const cls = validDecisions.includes(decision) ? decision : 'allow';

    const row = document.createElement('div');
    // Align badge with the side of the last bubble
    const lastBubble = transcript.querySelector('.bubble-row:last-of-type');
    const side = lastBubble && lastBubble.classList.contains('agent') ? 'agent' : 'user';
    row.className = 'policy-row ' + side;

    const badge = document.createElement('span');
    badge.className = 'badge ' + cls;
    badge.textContent = 'Policy: ' + (ev.policyDecision || 'allow');

    if (ev.claimMatched) {
      const claim = document.createElement('span');
      claim.style.cssText = 'font-weight:400;text-transform:none;letter-spacing:0';
      claim.textContent = ' \u2014 ' + ev.claimMatched;
      badge.appendChild(claim);
    }

    row.appendChild(badge);
    transcript.appendChild(row);

    // Update metric counters
    if (cls in metrics) {
      metrics[cls]++;
      updateMetricCounters();
    }
  }

  function updateSentiment(value) {
    const v = (value || '').toLowerCase();
    sentimentDot.className = 'sentiment-dot';
    if (v.includes('positive') || v.includes('satisfied') || v.includes('happy')) {
      sentimentDot.classList.add('positive');
      sentimentLabel.textContent = 'Positive';
    } else if (v.includes('negative') || v.includes('frustrated') || v.includes('angry')) {
      sentimentDot.classList.add('negative');
      sentimentLabel.textContent = 'Negative';
    } else {
      sentimentDot.classList.add('neutral');
      sentimentLabel.textContent = 'Neutral';
    }
  }

  function renderSummary(ev) {
    summaryCard.style.display = 'block';
    summaryGrid.innerHTML = '';

    const stats = [
      { label: 'Total Turns', value: ev.totalTurns !== undefined ? ev.totalTurns : (lastEventIndex || '\u2014') },
      { label: 'Escalated', value: ev.escalated !== undefined ? ev.escalated : metrics.escalate },
      { label: 'Allow', value: ev.policyBreakdown && ev.policyBreakdown.allow !== undefined ? ev.policyBreakdown.allow : metrics.allow },
      { label: 'Refuse', value: ev.policyBreakdown && ev.policyBreakdown.refuse !== undefined ? ev.policyBreakdown.refuse : metrics.refuse },
    ];

    stats.forEach(function(s) {
      const cell = document.createElement('div');
      cell.className = 'summary-stat';
      cell.innerHTML = '<div class="summary-stat-label">' + s.label + '</div><div class="summary-stat-value">' + s.value + '</div>';
      summaryGrid.appendChild(cell);
    });
  }

  function updateMetricCounters() {
    mAllow.textContent = metrics.allow;
    mRefuse.textContent = metrics.refuse;
    mEscalate.textContent = metrics.escalate;
    mRewrite.textContent = metrics.rewrite;
  }

  function scrollTranscript() {
    transcript.scrollTop = transcript.scrollHeight;
  }

  // ── Bootstrap ──────────────────────────────────────────────────────
  init();
})();
</script>
</body>
</html>`;
}

import { html, useState, useEffect, mount, useEventData, PhaseBadge, ScheduleGrid, CategoryBars, CategoryTag, QR, getParam, siteUrl } from './ui.js';
import { backend } from './backend.js';
import { normalizeCode, categoryScores, ideaStats, ideaScore, sessionDemand } from './model.js';

function Display() {
  const code = normalizeCode(getParam('code') || '');
  const [uidReady, setReady] = useState(false);
  useEffect(() => {
    backend()
      .then((b) => b.ensureAnon())
      .then(() => setReady(true));
  }, []);
  const data = useEventData(uidReady && code ? code : null);
  if (!code) return html`<div class="display"><h1 class="center">Add ?code=YOURCODE to the URL</h1></div>`;
  if (!uidReady || data.loading) return html`<div class="display"><p class="loading">Loading…</p></div>`;
  if (!data.event) return html`<div class="display"><h1 class="center">No event “${code}”</h1></div>`;
  const { event, participants, ideas, sessions } = data;
  const phase = event.phase || 'setup';
  const joinUrl = siteUrl('index.html', event.id);
  const shortUrl = joinUrl.replace(/^https?:\/\//, '').replace(/\?.*/, '');
  const visible = ideas.filter((i) => !i.hidden);
  const showSchedule = phase === 'schedule' && event.schedule?.published;

  return html`<div class="display">
    <aside class="d-side">
      <div class="d-title">${event.title}</div>
      <${PhaseBadge} phase=${phase} />
      <${QR} text=${joinUrl} size=${6} />
      <div class="d-url">${shortUrl}</div>
      <div class="d-code">code <strong>${event.id}</strong></div>
      <div class="d-count"><strong>${participants.length}</strong> joined</div>
      <button class="link small fs-btn" onClick=${() => document.documentElement.requestFullscreen?.()}>Full screen</button>
    </aside>
    <main class="d-main">
      ${phase === 'setup' &&
      html`<div class="d-hero"><h1>Welcome!</h1><p>${event.tagline}</p><p class="muted">Scan the code or visit the link to join.</p></div>`}
      ${(phase === 'ideas' || phase === 'curate') &&
      html`<div class="d-cols">
        <section>
          <h2>Big topics</h2>
          <${CategoryBars} rows=${categoryScores(event, participants)} />
          <p class="muted small">${participants.filter((p) => p.catRank?.length).length} rankings in</p>
        </section>
        <section>
          <h2>${phase === 'curate' ? `Sessions taking shape (${sessions.length})` : `Ideas (${visible.length})`}</h2>
          ${phase === 'curate' ? html`<${SessionWall} event=${event} sessions=${sessions} />` : html`<${IdeaWall} event=${event} ideas=${visible} />`}
        </section>
      </div>`}
      ${(phase === 'vote' || (phase === 'schedule' && !showSchedule)) && html`<${VoteTally} event=${event} participants=${participants} sessions=${sessions} />`}
      ${showSchedule && html`<${ScheduleGrid} event=${event} sessions=${sessions} cells=${event.schedule.cells} big=${true} />`}
    </main>
  </div>`;
}

function IdeaWall({ event, ideas }) {
  const cats = Object.fromEntries((event.categories || []).map((c) => [c.id, c]));
  const newest = Math.max(0, ...ideas.map((i) => i.createdAt || 0));
  const top = [...ideas].sort((a, b) => ideaScore(b) - ideaScore(a) || (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 14);
  return html`<div class="wall">
    ${top.map(
      (i) => html`<div class=${i.createdAt === newest && Date.now() - newest < 60000 ? 'wall-card fresh' : 'wall-card'} style=${`--c:${cats[i.categoryId]?.color || '#888'}`} key=${i.id}>
        <span class="wall-votes">▲ ${ideaStats(i).votes}</span>
        <span>${i.title}</span>
      </div>`
    )}
  </div>`;
}

function SessionWall({ event, sessions }) {
  const cats = Object.fromEntries((event.categories || []).map((c) => [c.id, c]));
  return html`<div class="wall">
    ${sessions.map(
      (s) => html`<div class="wall-card" style=${`--c:${cats[s.categoryId]?.color || '#888'}`} key=${s.id}>
        <${CategoryTag} cat=${cats[s.categoryId]} />
        <span>${s.title}</span>
      </div>`
    )}
  </div>`;
}

function VoteTally({ event, participants, sessions }) {
  const d = sessionDemand(event, participants, sessions);
  const cats = Object.fromEntries((event.categories || []).map((c) => [c.id, c]));
  const rows = [...sessions].sort((a, b) => d[b.id].score - d[a.id].score);
  const max = Math.max(1, ...rows.map((s) => d[s.id].score));
  const voters = participants.filter((p) => Object.keys(p.votes || {}).length || Object.keys(p.dots || {}).length).length;
  return html`<section>
    <h2>Session votes <span class="muted small">${voters} of ${participants.length} have voted</span></h2>
    <div class="bars big-bars">
      ${rows.map(
        (s) => html`<div class="bar-row" key=${s.id}>
          <span class="bar-label">${s.title}</span>
          <span class="bar"><span style=${`width:${Math.max(2, (d[s.id].score / max) * 100)}%;background:${cats[s.categoryId]?.color || '#888'}`}></span></span>
          <span class="bar-val">${event.voting?.mode === 'dots' ? d[s.id].dots : d[s.id].must}<small>${event.voting?.mode === 'dots' ? ' dots' : ' must'}</small></span>
        </div>`
      )}
    </div>
  </section>`;
}

mount(Display);

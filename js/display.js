import { html, useState, useEffect, mount, useEventData, ScheduleGrid, CategoryBars, CategoryTag, QR, LoadError, Logo, StepTracker, getParam, siteUrl } from './ui.js';
import { backend } from './backend.js';
import { normalizeCode, categoryScores, ideaStats, ideaScore, sessionDemand, participantStep, STEPS } from './model.js';

function Display() {
  const code = normalizeCode(getParam('code') || '');
  const [uidReady, setReady] = useState(false);
  useEffect(() => {
    backend()
      .then((b) => b.ensureAnon())
      .then(() => setReady(true));
  }, []);
  const data = useEventData(uidReady && code ? code : null);
  if (!code) return html`<div class="proj-message"><h1>Add ?code=YOURCODE to the address</h1></div>`;
  if (!uidReady || data.loading) return html`<div class="proj-message"><p class="loading">Loading…</p></div>`;
  if (data.error) return html`<${LoadError} code=${code} error=${data.error} onRetry=${data.retry} />`;
  if (!data.event) return html`<div class="proj-message"><h1>No event “${code}”</h1></div>`;

  const { event, participants, ideas, sessions } = data;
  const phase = event.phase || 'setup';
  const published = phase === 'schedule' && event.schedule?.published;
  const joinUrl = siteUrl('index.html', event.id);
  const shortUrl = joinUrl.replace(/^https?:\/\//, '').replace(/index\.html.*$/, '').replace(/\/$/, '');
  const now = nowCopy(event);
  const { step, state } = participantStep(event);

  return html`<div class="proj">
    <header class="proj-head">
      <${Logo} />
      <div class="proj-event">${event.title}</div>
      <${StepTracker} event=${event} size="compact" />
    </header>
    <div class="proj-body">
      <aside class="proj-join" aria-label="How to join">
        <p class="join-label">Join on your phone or laptop</p>
        <${QR} text=${joinUrl} size=${6} />
        <p class="join-or">or go to</p>
        <p class="join-url">${shortUrl}</p>
        <div class="join-code"><span>Code</span><strong>${event.id}</strong></div>
        <p class="join-count"><strong>${participants.length}</strong> joined</p>
        <button class="link small fs-btn" onClick=${() => document.documentElement.requestFullscreen?.()}>Full screen</button>
      </aside>
      <main class="proj-main">
        <section class=${`proj-now ${state}`} aria-live="polite">
          <p class="eyebrow">${state === 'now' ? `Now · Step ${step}` : now.eyebrow}</p>
          <h1>${now.title}</h1>
          <p>${now.body}</p>
        </section>
        <section class="proj-live">
          ${phase === 'setup' && html`<${Welcome} participants=${participants} />`}
          ${phase === 'ideas' &&
          html`<div class="proj-cols">
            <div>
              <h2>Topic ranking <span class="muted">· ${participants.filter((p) => p.catRank?.length).length} in</span></h2>
              <${CategoryBars} rows=${categoryScores(event, participants)} />
            </div>
            <div>
              <h2>Most-backed ideas <span class="muted">· ${ideas.filter((i) => !i.hidden).length} total</span></h2>
              <${IdeaWall} event=${event} ideas=${ideas.filter((i) => !i.hidden)} />
            </div>
          </div>`}
          ${phase === 'curate' &&
          html`<h2>Sessions so far <span class="muted">· ${sessions.length}</span></h2>
            <${SessionWall} event=${event} sessions=${sessions} />`}
          ${(phase === 'vote' || (phase === 'schedule' && !published)) && html`<${VoteTally} event=${event} participants=${participants} sessions=${sessions} />`}
          ${published && html`<${ScheduleGrid} event=${event} sessions=${sessions} cells=${event.schedule.cells} big=${true} />`}
        </section>
      </main>
    </div>
  </div>`;
}

function nowCopy(event) {
  const phase = event.phase || 'setup';
  const dots = event.voting?.mode === 'dots';
  return {
    setup: { eyebrow: 'Welcome', title: 'Grab your phone or laptop and join', body: 'Scan the code or go to the link, then enter the code. We’ll start in a moment.' },
    ideas: { title: 'Share your ideas', body: 'Rank the big topics, back the ideas you’d attend, and suggest your own.' },
    curate: { eyebrow: 'Hang tight', title: 'Building sessions from your ideas', body: 'We’re combining similar ideas into sessions. Voting opens next.' },
    vote: {
      title: 'Vote for sessions',
      body: dots ? `Spread your ${event.voting.dots} dots across the sessions you want most.` : 'Mark each session Must attend, Interested, or Skip.',
    },
    schedule: event.schedule?.published
      ? { title: 'Here’s the day', body: 'Open the app and tap “Your day” to see your sessions and rooms.' }
      : { eyebrow: 'Almost there', title: 'Finalizing the schedule', body: 'Your personal schedule will appear on your device shortly.' },
  }[phase];
}

function Welcome({ participants }) {
  return html`<ol class="proj-preview">
      ${STEPS.map((s) => html`<li><span class="step-dot">${s.n}</span>${s.label}</li>`)}
    </ol>
    ${participants.length > 0 &&
    html`<div class="name-cloud" aria-label="Who has joined">
      ${participants
        .slice()
        .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))
        .map((p) => html`<span class="name-chip" key=${p.id}>${String(p.name).split(' ')[0]}</span>`)}
    </div>`}`;
}

function IdeaWall({ event, ideas }) {
  const cats = Object.fromEntries((event.categories || []).map((c) => [c.id, c]));
  const newest = Math.max(0, ...ideas.map((i) => i.createdAt || 0));
  const top = [...ideas].sort((a, b) => ideaScore(b) - ideaScore(a) || (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 12);
  return html`<div class="wall">
    ${top.map(
      (i) => html`<div class=${i.createdAt === newest && Date.now() - newest < 60000 ? 'wall-card fresh' : 'wall-card'} style=${`--c:${cats[i.categoryId]?.color || 'var(--blue)'}`} key=${i.id}>
        <span class="wall-votes">▲ ${ideaStats(i).votes}</span>
        <span>${i.title}</span>
      </div>`
    )}
  </div>`;
}

function SessionWall({ event, sessions }) {
  const cats = Object.fromEntries((event.categories || []).map((c) => [c.id, c]));
  if (!sessions.length) return html`<p class="muted">The first sessions will appear here in a moment.</p>`;
  return html`<div class="wall">
    ${sessions.map(
      (s) => html`<div class="wall-card session-card" style=${`--c:${cats[s.categoryId]?.color || 'var(--blue)'}`} key=${s.id}>
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
  const dots = event.voting?.mode === 'dots';
  return html`<h2>Votes so far <span class="muted">· ${voters} of ${participants.length} people</span></h2>
    <div class="bars big-bars">
      ${rows.map(
        (s) => html`<div class="bar-row" key=${s.id}>
          <span class="bar-label">${s.title}</span>
          <span class="bar"><span style=${`width:${Math.max(2, (d[s.id].score / max) * 100)}%;background:${cats[s.categoryId]?.color || 'var(--blue)'}`}></span></span>
          <span class="bar-val">${dots ? d[s.id].dots : d[s.id].must}<small>${dots ? ' dots' : ' must'}</small></span>
        </div>`
      )}
    </div>`;
}

mount(Display);

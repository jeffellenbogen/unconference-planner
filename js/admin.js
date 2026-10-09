import { html, useState, useEffect, useMemo, mount, useEventData, toast, guard, copyText, Tabs, CategoryTag, PhaseBadge, DemoBanner, Empty, ScheduleGrid, CategoryBars, Modal, QR, LoadError, getParam, setParam, siteUrl } from './ui.js';
import { backend, DEMO, DEL } from './backend.js';
import { ORGANIZER_EMAILS } from './config.js';
import {
  PHASES,
  CATEGORY_COLORS,
  INTEREST_LEVELS,
  techPdTemplate,
  blankTemplate,
  normalizeCode,
  uid as newId,
  ideaStats,
  ideaScore,
  duplicatePairs,
  categoryScores,
  sessionDemand,
  buildSchedule,
  evaluateSchedule,
  breakoutSlots,
  aiPrompt,
  parseAiGroups,
  leadersFromIdeas,
  scheduleText,
  fmtTime,
  emptyCells,
} from './model.js';

// ---------------- Auth & event picker ----------------

function AdminApp() {
  const [user, setUser] = useState(undefined);
  const [code, setCode] = useState(normalizeCode(getParam('code') || ''));
  useEffect(() => {
    let unsub = () => {};
    backend().then((b) => (unsub = b.onAuth(setUser)));
    return () => unsub();
  }, []);
  const open = (c) => {
    setCode(c);
    setParam('code', c);
  };
  if (user === undefined) return html`<div class="wrap"><p class="loading">Loading…</p></div>`;
  if (!user || user.isAnonymous) return html`<${SignIn} />`;
  if (!code) return html`<${EventPicker} user=${user} onOpen=${open} />`;
  return html`<${Console} user=${user} code=${code} onExit=${() => open('')} />`;
}

function SignIn() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const b = () => backend();
  return html`<${DemoBanner} />
    <main class="wrap narrow center-screen">
      <div class="card join">
        <p class="eyebrow">Organizer</p>
        <h1>Sign in to run an event</h1>
        ${DEMO
          ? html`<p class="muted">Demo mode: no real account needed.</p>
              <button class="btn primary block" onClick=${guard(async () => (await b()).signInGoogle())}>Enter as demo organizer</button>`
          : html`<button class="btn primary block" onClick=${guard(async () => (await b()).signInGoogle())}>Sign in with Google</button>
              <details class="email-signin">
                <summary>Use email & password instead</summary>
                <form class="stack" onSubmit=${guard(async (e) => (e.preventDefault(), (await b()).signInEmail(email, pw)))}>
                  <input type="email" placeholder="email" value=${email} onInput=${(e) => setEmail(e.target.value)} required aria-label="Email" />
                  <input type="password" placeholder="password" value=${pw} onInput=${(e) => setPw(e.target.value)} required aria-label="Password" />
                  <div class="row">
                    <button class="btn">Sign in</button>
                    <button type="button" class="btn ghost" onClick=${guard(async () => (await b()).createEmail(email, pw))}>Create account</button>
                  </div>
                </form>
              </details>`}
      </div>
    </main>`;
}

function EventPicker({ user, onOpen }) {
  const [events, setEvents] = useState(null);
  const [creating, setCreating] = useState(false);
  const canCreate = DEMO || !ORGANIZER_EMAILS?.length || ORGANIZER_EMAILS.includes(String(user.email || '').toLowerCase());
  useEffect(() => {
    backend()
      .then((b) => b.listMyEvents(user.uid))
      .then(setEvents)
      .catch((e) => (toast(e.message, 'err'), setEvents([])));
  }, [user.uid]);
  return html`<${DemoBanner} />
    <header class="topbar"><div class="wrap topbar-inner"><div class="ev-title">Unconference Planner · Organizer</div>
      <div class="me"><span class="muted small">${user.email}</span><button class="link" onClick=${guard(async () => (await backend()).signOut())}>Sign out</button></div></div></header>
    <main class="wrap">
      <div class="row between"><h2>Your events</h2>${canCreate && html`<button class="btn primary" onClick=${() => setCreating(true)}>+ New event</button>`}</div>
      ${!canCreate &&
      html`<div class="banner info">Signed in as <strong>${user.email}</strong>. Only ${ORGANIZER_EMAILS.join(', ')} can create events here.${' '}
        <button class="link" onClick=${guard(async () => (await backend()).signOut())}>Switch account</button></div>`}
      ${events === null && html`<p class="loading">Loading…</p>`}
      ${events?.length === 0 && html`<${Empty}>${canCreate ? 'No events yet. Create one to get started.' : 'No events for this account.'}<//>`}
      <div class="event-list">
        ${(events || [])
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
          .map(
            (e) => html`<button class="card event-pick" onClick=${() => onOpen(e.id)}>
              <strong>${e.title}</strong>
              <span class="muted">code: ${e.id}</span>
              <${PhaseBadge} phase=${e.phase} />
            </button>`
          )}
      </div>
      ${creating && html`<${CreateEvent} user=${user} events=${events || []} onClose=${() => setCreating(false)} onCreated=${onOpen} />`}
    </main>`;
}

function CreateEvent({ user, events, onClose, onCreated }) {
  const [title, setTitle] = useState('Tech Educators Unconference');
  const [code, setCode] = useState('');
  const [from, setFrom] = useState('techpd');
  const suggested = normalizeCode(title.split(/\s+/).map((w) => w[0]).join('') + new Date().getFullYear().toString().slice(2));
  const create = guard(async (e) => {
    e.preventDefault();
    const b = await backend();
    const id = normalizeCode(code || suggested);
    if (id.length < 3) throw new Error('Code must be at least 3 letters/numbers.');
    if (await b.getEvent(id)) throw new Error(`Code “${id}” is taken — pick another.`);
    let t;
    if (from === 'techpd') t = techPdTemplate();
    else if (from === 'blank') t = blankTemplate();
    else {
      const src = events.find((x) => x.id === from);
      t = { ...techPdTemplate(), ...pick(src, ['tagline', 'categories', 'rooms', 'agenda', 'roles', 'voting']), seeds: [] };
    }
    await b.set(`events/${id}`, {
      title: title.trim(),
      tagline: t.tagline,
      phase: 'setup',
      adminUids: [user.uid],
      createdAt: Date.now(),
      categories: t.categories,
      rooms: t.rooms,
      agenda: t.agenda,
      roles: t.roles,
      voting: t.voting,
      schedule: { published: false, cells: {} },
    });
    if (t.seeds.length)
      await b.batch(
        t.seeds.map((s) => ({
          op: 'set',
          path: `events/${id}/ideas/${newId(12)}`,
          data: { ...s, authorUid: user.uid, authorName: 'Organizer', organizer: true, createdAt: Date.now(), upvotes: {}, leads: {}, comments: [] },
        }))
      );
    onCreated(id);
  });
  return html`<${Modal} title="New event" onClose=${onClose}>
    <form class="stack" onSubmit=${create}>
      <label>Title<input value=${title} onInput=${(e) => setTitle(e.target.value)} required /></label>
      <label>Join code <span class="muted small">(what participants type — short & memorable)</span>
        <input value=${code} placeholder=${suggested} onInput=${(e) => setCode(e.target.value)} />
      </label>
      <label>Start from
        <select value=${from} onChange=${(e) => setFrom(e.target.value)}>
          <option value="techpd">Tech PD template (4 topics + starter ideas, 3 breakouts × 2 rooms)</option>
          <option value="blank">Blank</option>
          ${events.map((e) => html`<option value=${e.id}>Copy settings from “${e.title}”</option>`)}
        </select>
      </label>
      <p class="muted small">Everything (topics, rooms, times, voting style) can be edited after creating.</p>
      <button class="btn primary">Create event</button>
    </form>
  <//>`;
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]));

// ---------------- Console ----------------

function Console({ user, code, onExit }) {
  const data = useEventData(code);
  const [tab, setTab] = useState('overview');
  if (data.loading) return html`<div class="wrap"><p class="loading">Loading…</p></div>`;
  if (data.error) return html`<${LoadError} code=${code} error=${data.error} onRetry=${data.retry} onBack=${onExit} />`;
  if (!data.event)
    return html`<main class="wrap"><${Empty}>No event “${code}”. <button class="link" onClick=${onExit}>Back to events</button><//></main>`;
  if (!(data.event.adminUids || []).includes(user.uid))
    return html`<main class="wrap"><${Empty}>You're not an organizer of “${data.event.title}”. <button class="link" onClick=${onExit}>Back</button><//></main>`;

  const { event, participants, ideas, sessions } = data;
  const ctx = { ...data, base: `events/${event.id}`, user };
  const unassigned = ideas.filter((i) => !i.hidden && !i.sessionId).length;
  return html`<${DemoBanner} />
    <header class="topbar admin">
      <div class="wrap wide topbar-inner">
        <div>
          <button class="link small" onClick=${onExit}>← All events</button>
          <div class="ev-title">${event.title} <span class="muted small">· code <strong>${event.id}</strong></span></div>
        </div>
        <div class="row">
          <a class="btn small ghost" href=${siteUrl('index.html', event.id)} target="_blank" rel="noopener">Participant view ↗</a>
          <a class="btn small ghost" href=${siteUrl('display.html', event.id)} target="_blank" rel="noopener">Projector ↗</a>
        </div>
      </div>
    </header>
    <main class="wrap wide">
      <${PhaseStepper} event=${event} base=${ctx.base} tab=${tab} onTab=${setTab} />
      <${Tabs}
        active=${tab}
        onChange=${setTab}
        tabs=${[
          { id: 'overview', label: 'Overview' },
          { id: 'ideas', label: 'Ideas & merging', count: unassigned || null },
          { id: 'sessions', label: 'Sessions', count: sessions.length },
          { id: 'schedule', label: 'Schedule' },
          { id: 'setup', label: 'Settings' },
        ]}
      />
      ${tab === 'overview' && html`<${Overview} ...${ctx} />`}
      ${tab === 'ideas' && html`<${IdeasAdmin} ...${ctx} />`}
      ${tab === 'sessions' && html`<${SessionsAdmin} ...${ctx} />`}
      ${tab === 'schedule' && html`<${ScheduleAdmin} ...${ctx} />`}
      ${tab === 'setup' && html`<${Settings} ...${ctx} onDeleted=${onExit} />`}
    </main>`;
}

const PHASE_HELP = {
  setup: 'Participants can join and wait. Seed topics and ideas.',
  ideas: 'Participants rank big topics, +1 ideas, add flavor, and suggest new ideas.',
  curate: 'Suggestions close. Merge ideas into sessions — participants see sessions appear.',
  vote: 'Participants rate sessions and offer to lead.',
  schedule: 'Generate & tweak the schedule, then publish. Participants get “My day”.',
};

// Where the organizer's work happens in each phase.
const PHASE_TAB = {
  setup: ['setup', 'Settings'],
  curate: ['ideas', 'Ideas & merging'],
  vote: ['sessions', 'Sessions'],
  schedule: ['schedule', 'Schedule'],
};

function PhaseStepper({ event, base, tab, onTab }) {
  const cur = PHASES.findIndex((p) => p.id === (event.phase || 'setup'));
  const go = guard(async (id) => (await backend()).update(base, { phase: id }));
  const next = PHASES[cur + 1];
  return html`<section class="stepper-bar">
    <ol class="phases">
      ${PHASES.map(
        (p, i) => html`<li class=${i === cur ? 'now' : i < cur ? 'done' : ''}>
          <button onClick=${() => go(p.id)} title=${PHASE_HELP[p.id]}><span class="num">${i + 1}</span>${p.label}</button>
        </li>`
      )}
    </ol>
    <div class="phase-help">
      <span class="muted">${PHASE_HELP[PHASES[cur].id]}</span>
      <div class="row wrap-row">
        ${(() => {
          const [t, label] = PHASE_TAB[PHASES[cur].id] || [];
          return t && tab !== t && html`<button class="btn" onClick=${() => onTab(t)}>Go to ${label}</button>`;
        })()}
        ${next && html`<button class="btn primary" onClick=${() => go(next.id)}>Start ${next.label} →</button>`}
      </div>
    </div>
  </section>`;
}

// ---------------- Overview ----------------

function Overview({ event, participants, ideas, sessions, base }) {
  const joinUrl = siteUrl('index.html', event.id);
  const scores = categoryScores(event, participants);
  const ranked = participants.filter((p) => p.catRank?.length).length;
  const voted = participants.filter((p) => Object.keys(p.votes || {}).length || Object.keys(p.dots || {}).length).length;
  const roles = {};
  participants.forEach((p) => (roles[p.role || 'Not set'] = (roles[p.role || 'Not set'] || 0) + 1));
  const removeP = guard(async (p) => confirm(`Remove ${p.name}? Their rankings and votes are deleted.`) && (await backend()).remove(`${base}/participants/${p.id}`));
  return html`<div class="grid-2">
    <section class="card">
      <h3>Join</h3>
      <div class="join-box">
        <${QR} text=${joinUrl} />
        <div>
          <p>Go to <a href=${joinUrl} target="_blank" rel="noopener">${joinUrl.replace(/^https?:\/\//, '').replace(/\?.*/, '')}</a></p>
          <p>Code: <strong class="code">${event.id}</strong></p>
          <button class="btn small" onClick=${() => copyText(joinUrl, 'Join link copied')}>Copy join link</button>
        </div>
      </div>
    </section>
    <section class="card">
      <h3>Pulse</h3>
      <div class="stats">
        <div><strong>${participants.length}</strong><span>joined</span></div>
        <div><strong>${ranked}</strong><span>ranked topics</span></div>
        <div><strong>${ideas.filter((i) => !i.hidden).length}</strong><span>ideas</span></div>
        <div><strong>${sessions.length}</strong><span>sessions</span></div>
        <div><strong>${voted}</strong><span>voted</span></div>
      </div>
      <p class="small muted">${Object.entries(roles)
        .map(([r, n]) => `${r}: ${n}`)
        .join(' · ')}</p>
    </section>
    <section class="card">
      <h3>Big-topic ranking <span class="muted small">(Borda points, ${ranked} responses)</span></h3>
      <${CategoryBars} rows=${scores} />
    </section>
    <section class="card">
      <h3>Participants</h3>
      ${participants.length === 0 && html`<p class="muted">Nobody yet.</p>`}
      <ul class="people">
        ${participants
          .sort((a, b) => String(a.name).localeCompare(String(b.name)))
          .map(
            (p) => html`<li>
              <span>${p.name} ${p.role && html`<span class="muted small">· ${p.role}</span>`}</span>
              <span class="small">
                ${p.catRank?.length ? html`<span title="Ranked topics">✓R</span>` : html`<span class="muted" title="Hasn't ranked">–R</span>`}
                ${' '}${Object.keys(p.votes || {}).length + Object.keys(p.dots || {}).length ? html`<span title="Voted">✓V</span>` : html`<span class="muted" title="Hasn't voted">–V</span>`}
                <button class="link danger small" onClick=${() => removeP(p)} aria-label=${`Remove ${p.name}`}>remove</button>
              </span>
            </li>`
          )}
      </ul>
    </section>
  </div>`;
}

// ---------------- Session operations ----------------

// Writes that keep idea.sessionId and session.ideaIds in sync.
function sessionOps(base, sessions) {
  const byId = Object.fromEntries(sessions.map((s) => [s.id, { ...s, ideaIds: [...(s.ideaIds || [])] }]));
  const touched = new Set();
  const ops = [];
  const detach = (idea) => {
    const old = idea.sessionId && byId[idea.sessionId];
    if (old) {
      old.ideaIds = old.ideaIds.filter((x) => x !== idea.id);
      touched.add(old.id);
    }
  };
  return {
    create(data, ideas) {
      const id = newId(12);
      ideas.forEach(detach);
      byId[id] = { id, isNew: true, ...data, ideaIds: ideas.map((i) => i.id) };
      touched.add(id);
      ideas.forEach((i) => ops.push({ op: 'update', path: `${base}/ideas/${i.id}`, data: { sessionId: id } }));
      return id;
    },
    attach(sid, ideas) {
      ideas.filter((i) => i.sessionId !== sid).forEach((i) => {
        detach(i);
        byId[sid].ideaIds.push(i.id);
        ops.push({ op: 'update', path: `${base}/ideas/${i.id}`, data: { sessionId: sid } });
      });
      touched.add(sid);
    },
    detach(ideas) {
      ideas.forEach((i) => {
        detach(i);
        ops.push({ op: 'update', path: `${base}/ideas/${i.id}`, data: { sessionId: DEL } });
      });
    },
    async commit() {
      for (const sid of touched) {
        const s = byId[sid];
        if (s.isNew) {
          const { id, isNew, ...data } = s;
          ops.unshift({ op: 'set', path: `${base}/sessions/${sid}`, data: { createdAt: Date.now(), leaders: [], ...data } });
        } else ops.push({ op: 'update', path: `${base}/sessions/${sid}`, data: { ideaIds: s.ideaIds } });
      }
      await (await backend()).batch(ops);
    },
  };
}

function mostCommon(arr) {
  const c = {};
  arr.forEach((x) => x && (c[x] = (c[x] || 0) + 1));
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0];
}

// ---------------- Ideas & merging ----------------

function IdeasAdmin({ event, ideas, sessions, base, user }) {
  const [sel, setSel] = useState(new Set());
  const [filter, setFilter] = useState('unassigned');
  const [cat, setCat] = useState('all');
  const [modal, setModal] = useState(null);
  const [showDupes, setShowDupes] = useState(true);
  const cats = Object.fromEntries((event.categories || []).map((c) => [c.id, c]));
  const sessById = Object.fromEntries(sessions.map((s) => [s.id, s]));
  const visible = ideas.filter((i) => !i.hidden);
  const list = ideas
    .filter((i) => (filter === 'hidden' ? i.hidden : !i.hidden))
    .filter((i) => filter !== 'unassigned' || !i.sessionId)
    .filter((i) => filter !== 'assigned' || i.sessionId)
    .filter((i) => cat === 'all' || i.categoryId === cat)
    .sort((a, b) => ideaScore(b) - ideaScore(a));
  const selected = ideas.filter((i) => sel.has(i.id));
  const dupes = useMemo(() => duplicatePairs(visible.filter((i) => !i.sessionId)).slice(0, 8), [ideas]);
  const toggle = (id) => {
    const n = new Set(sel);
    n.has(id) ? n.delete(id) : n.add(id);
    setSel(n);
  };
  const clear = () => setSel(new Set());

  const eachOwn = guard(async () => {
    const ops = sessionOps(base, sessions);
    selected.forEach((i) => ops.create({ title: i.title, description: i.description || '', categoryId: i.categoryId, leaders: leadersFromIdeas([i]) }, [i]));
    await ops.commit();
    toast(`Created ${selected.length} session${selected.length > 1 ? 's' : ''}`);
    clear();
  });
  const setHidden = guard(async (hidden) => {
    await (await backend()).batch(selected.map((i) => ({ op: 'update', path: `${base}/ideas/${i.id}`, data: { hidden } })));
    clear();
  });
  const unassign = guard(async () => {
    const ops = sessionOps(base, sessions);
    ops.detach(selected.filter((i) => i.sessionId));
    await ops.commit();
    clear();
  });
  const attachTo = guard(async (sid) => {
    if (!sid) return;
    const ops = sessionOps(base, sessions);
    ops.attach(sid, selected);
    await ops.commit();
    toast(`Added to “${sessById[sid].title}”`);
    clear();
  });
  const editIdea = guard(async (i) => {
    const t = prompt('Idea title', i.title);
    if (t && t.trim()) await (await backend()).update(`${base}/ideas/${i.id}`, { title: t.trim() });
  });

  const target = Math.max(3, Math.round(breakoutSlots(event).length * (event.rooms || []).length * 1.5));
  return html`<div class="admin-ideas">
    ${(event.phase || 'setup') === 'curate' &&
    html`<details class="card howto" open>
      <summary><strong>How to curate</strong> <span class="muted small">— aim for about ${target} sessions (you have ${sessions.length})</span></summary>
      <ol>
        <li>Tick ideas that belong together → <strong>Merge into new session</strong>. “Possible duplicates” below helps spot them.</li>
        <li>Tick standalone ideas → <strong>Each → own session</strong>.</li>
        <li><strong>Hide</strong> test or off-topic ideas. Or use <strong>Export for AI</strong> → paste into Claude → <strong>Import AI groups</strong> to do it all at once.</li>
        <li>Polish titles and leaders in <strong>Sessions</strong>, then <strong>Start Phase 2: Vote</strong>.</li>
      </ol>
    </details>`}
    <div class="toolbar">
      <div class="chips">
        ${[
          ['unassigned', 'Not in a session'],
          ['assigned', 'In a session'],
          ['all', 'All'],
          ['hidden', 'Hidden'],
        ].map(([id, label]) => html`<button class=${filter === id ? 'chip on' : 'chip'} onClick=${() => setFilter(id)}>${label}</button>`)}
        <select aria-label="Category" value=${cat} onChange=${(e) => setCat(e.target.value)}>
          <option value="all">All topics</option>
          ${(event.categories || []).map((c) => html`<option value=${c.id}>${c.name}</option>`)}
        </select>
      </div>
      <div class="row">
        <button class="btn small ghost" onClick=${() => setModal('add')}>+ Organizer idea</button>
        <button class="btn small ghost" onClick=${() => setModal('ai-export')}>Export for AI</button>
        <button class="btn small ghost" onClick=${() => setModal('ai-import')}>Import AI groups</button>
      </div>
    </div>

    ${dupes.length > 0 &&
    filter === 'unassigned' &&
    html`<details class="card dupes" open=${showDupes} onToggle=${(e) => setShowDupes(e.target.open)}>
      <summary><strong>Possible duplicates</strong> <span class="muted small">(${dupes.length})</span></summary>
      ${dupes.map(
        (d) => html`<div class="dupe-row">
          <span>“${d.a.title}” ≈ “${d.b.title}”</span>
          <button class="btn small" onClick=${() => setSel(new Set([...sel, d.a.id, d.b.id]))}>Select both</button>
        </div>`
      )}
    </details>`}

    <div class=${selected.length ? 'selection-bar active' : 'selection-bar'}>
      <strong>${selected.length} selected</strong>
      <button class="btn small primary" disabled=${!selected.length} onClick=${() => setModal('merge')}>Merge into new session</button>
      <button class="btn small" disabled=${!selected.length} onClick=${eachOwn}>Each → own session</button>
      <select disabled=${!selected.length || !sessions.length} value="" onChange=${(e) => attachTo(e.target.value)} aria-label="Add to existing session">
        <option value="">Add to existing session…</option>
        ${sessions.map((s) => html`<option value=${s.id}>${s.title}</option>`)}
      </select>
      ${filter === 'hidden'
        ? html`<button class="btn small ghost" disabled=${!selected.length} onClick=${() => setHidden(false)}>Unhide</button>`
        : html`<button class="btn small ghost" disabled=${!selected.length} onClick=${() => setHidden(true)}>Hide</button>`}
      ${selected.some((i) => i.sessionId) && html`<button class="btn small ghost" onClick=${unassign}>Remove from session</button>`}
      ${selected.length > 0 && html`<button class="link small" onClick=${clear}>clear</button>`}
    </div>

    ${list.length === 0 && html`<${Empty}>${filter === 'unassigned' ? 'Every idea is in a session. 🎉' : 'Nothing here.'}<//>`}
    <div class="idea-table">
      ${list.map((i) => {
        const s = ideaStats(i);
        return html`<label class=${sel.has(i.id) ? 'idea-row selected' : 'idea-row'} key=${i.id}>
          <input type="checkbox" checked=${sel.has(i.id)} onChange=${() => toggle(i.id)} />
          <div class="idea-main">
            <div class="row wrap-row"><${CategoryTag} cat=${cats[i.categoryId]} /><strong>${i.title}</strong>
              <button class="link small" onClick=${(e) => (e.preventDefault(), editIdea(i))}>edit</button></div>
            ${i.description && html`<div class="small">${i.description}</div>`}
            ${(i.comments || []).length > 0 && html`<div class="small muted">💬 ${(i.comments || []).map((c) => `${c.name}: ${c.text}`).join(' · ')}</div>`}
            ${Object.keys(i.leads || {}).length > 0 && html`<div class="small">🙋 ${Object.values(i.leads).join(', ')}</div>`}
            ${i.sessionId && sessById[i.sessionId] && html`<div class="small in-session">→ ${sessById[i.sessionId].title}</div>`}
          </div>
          <div class="idea-nums">
            <span title="+1s">▲ ${s.votes}</span>
            <span class="muted small">${i.authorName || ''}</span>
          </div>
        </label>`;
      })}
    </div>

    ${modal === 'merge' && html`<${MergeModal} event=${event} ideas=${selected} sessions=${sessions} base=${base} onClose=${() => setModal(null)} onDone=${() => (setModal(null), clear())} />`}
    ${modal === 'add' && html`<${AddIdeaModal} event=${event} base=${base} user=${user} onClose=${() => setModal(null)} />`}
    ${modal === 'ai-export' && html`<${AiExportModal} event=${event} ideas=${visible} onClose=${() => setModal(null)} />`}
    ${modal === 'ai-import' && html`<${AiImportModal} event=${event} ideas=${visible} sessions=${sessions} base=${base} onClose=${() => setModal(null)} />`}
  </div>`;
}

function MergeModal({ event, ideas, sessions, base, onClose, onDone }) {
  const top = [...ideas].sort((a, b) => ideaScore(b) - ideaScore(a))[0];
  const [title, setTitle] = useState(top?.title || '');
  const [desc, setDesc] = useState(ideas.map((i) => i.description).filter(Boolean).join(' ').slice(0, 300));
  const [categoryId, setCategoryId] = useState(mostCommon(ideas.map((i) => i.categoryId)) || event.categories?.[0]?.id);
  const offers = leadersFromIdeas(ideas);
  const [leaders, setLeaders] = useState(offers.map((l) => l.uid));
  const create = guard(async (e) => {
    e.preventDefault();
    const ops = sessionOps(base, sessions);
    ops.create({ title: title.trim(), description: desc.trim(), categoryId, leaders: offers.filter((l) => leaders.includes(l.uid)) }, ideas);
    await ops.commit();
    toast('Session created');
    onDone();
  });
  return html`<${Modal} title=${`Merge ${ideas.length} idea${ideas.length > 1 ? 's' : ''} into a session`} onClose=${onClose}>
    <ul class="sources">${ideas.map((i) => html`<li>${i.title} <span class="muted small">▲${ideaStats(i).votes}</span></li>`)}</ul>
    <form class="stack" onSubmit=${create}>
      <label>Session title<input value=${title} onInput=${(e) => setTitle(e.target.value)} required maxlength="90" /></label>
      <label>Description<textarea rows="3" value=${desc} onInput=${(e) => setDesc(e.target.value)}></textarea></label>
      <label>Topic
        <select value=${categoryId} onChange=${(e) => setCategoryId(e.target.value)}>
          ${(event.categories || []).map((c) => html`<option value=${c.id}>${c.name}</option>`)}
        </select>
      </label>
      ${offers.length > 0 &&
      html`<fieldset><legend>Leaders (offered to lead)</legend>
        ${offers.map(
          (l) => html`<label class="check"><input type="checkbox" checked=${leaders.includes(l.uid)} onChange=${(e) => setLeaders(e.target.checked ? [...leaders, l.uid] : leaders.filter((x) => x !== l.uid))} /> ${l.name}</label>`
        )}
      </fieldset>`}
      <button class="btn primary">Create session</button>
    </form>
  <//>`;
}

function AddIdeaModal({ event, base, user, onClose }) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [categoryId, setCategoryId] = useState(event.categories?.[0]?.id);
  const add = guard(async (e) => {
    e.preventDefault();
    await (await backend()).set(`${base}/ideas/${newId(12)}`, {
      title: title.trim(),
      description: desc.trim(),
      categoryId,
      authorUid: user.uid,
      authorName: 'Organizer',
      organizer: true,
      createdAt: Date.now(),
      upvotes: {},
      leads: {},
      comments: [],
    });
    toast('Idea added');
    setTitle('');
    setDesc('');
  });
  return html`<${Modal} title="Add an organizer idea" onClose=${onClose}>
    <form class="stack" onSubmit=${add}>
      <label>Topic
        <select value=${categoryId} onChange=${(e) => setCategoryId(e.target.value)}>
          ${(event.categories || []).map((c) => html`<option value=${c.id}>${c.name}</option>`)}
        </select>
      </label>
      <label>Idea<input value=${title} onInput=${(e) => setTitle(e.target.value)} required maxlength="90" /></label>
      <label>Details<textarea rows="2" value=${desc} onInput=${(e) => setDesc(e.target.value)}></textarea></label>
      <div class="row"><button class="btn primary">Add</button><button type="button" class="btn ghost" onClick=${onClose}>Done</button></div>
    </form>
  <//>`;
}

function AiExportModal({ event, ideas, onClose }) {
  const cells = breakoutSlots(event).length * (event.rooms || []).length;
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [target, setTarget] = useState(Math.max(3, Math.round(cells * 1.5)));
  const pool = onlyOpen ? ideas.filter((i) => !i.sessionId) : ideas;
  const text = aiPrompt(event, pool, target);
  return html`<${Modal} title="Export ideas for AI grouping" onClose=${onClose} wide>
    <p class="muted small">Copy this prompt into Claude (or another assistant). Paste its JSON reply into <strong>Import AI groups</strong> to create the sessions in one step. You can edit everything afterwards.</p>
    <div class="row wrap-row">
      <label class="check"><input type="checkbox" checked=${onlyOpen} onChange=${(e) => setOnlyOpen(e.target.checked)} /> Only ideas not yet in a session (${ideas.filter((i) => !i.sessionId).length})</label>
      <label class="inline">Target sessions <input type="number" min="1" max="60" value=${target} onInput=${(e) => setTarget(Number(e.target.value) || 1)} /></label>
      <span class="muted small">${cells} schedule slots available — offering ~1.5× lets the vote decide.</span>
    </div>
    <textarea class="mono" rows="14" readonly value=${text}></textarea>
    <button class="btn primary" onClick=${() => copyText(text, 'Prompt copied')}>Copy prompt</button>
  <//>`;
}

function AiImportModal({ event, ideas, sessions, base, onClose }) {
  const [text, setText] = useState('');
  const [groups, setGroups] = useState(null);
  const [err, setErr] = useState('');
  const cats = Object.fromEntries((event.categories || []).map((c) => [c.id, c]));
  const ideaById = Object.fromEntries(ideas.map((i) => [i.id, i]));
  const preview = () => {
    try {
      setGroups(parseAiGroups(text, event, ideas));
      setErr('');
    } catch (e) {
      setErr(e.message);
      setGroups(null);
    }
  };
  const create = guard(async () => {
    const ops = sessionOps(base, sessions);
    for (const g of groups) {
      const src = g.ideaIds.map((id) => ideaById[id]).filter(Boolean);
      ops.create({ title: g.title, description: g.description, categoryId: g.categoryId, leaders: leadersFromIdeas(src) }, src);
    }
    await ops.commit();
    toast(`Created ${groups.length} sessions`);
    onClose();
  });
  return html`<${Modal} title="Import AI groups" onClose=${onClose} wide>
    <textarea class="mono" rows="8" placeholder='Paste the JSON reply here: [{"title": ..., "ideaIds": [...]}]' value=${text} onInput=${(e) => setText(e.target.value)}></textarea>
    ${err && html`<p class="error">${err}</p>`}
    <button class="btn" onClick=${preview} disabled=${!text.trim()}>Preview</button>
    ${groups &&
    html`<div class="ai-preview">
      ${groups.map(
        (g) => html`<div class="card small-card">
          <${CategoryTag} cat=${cats[g.categoryId]} /> <strong>${g.title}</strong>
          <div class="small">${g.description}</div>
          <ul class="sources">${g.ideaIds.map((id) => html`<li>${ideaById[id]?.title}</li>`)}</ul>
        </div>`
      )}
      <button class="btn primary" onClick=${create} disabled=${!groups.length}>Create ${groups.length} sessions</button>
    </div>`}
  <//>`;
}

// ---------------- Sessions ----------------

function SessionsAdmin({ event, sessions, ideas, participants, base }) {
  const demand = sessionDemand(event, participants, sessions);
  const [sort, setSort] = useState('demand');
  const list = [...sessions].sort((a, b) =>
    sort === 'demand' ? demand[b.id].score - demand[a.id].score || a.title.localeCompare(b.title) : String(a.title).localeCompare(String(b.title))
  );
  const addEmpty = guard(async () => {
    const ops = sessionOps(base, sessions);
    ops.create({ title: 'New session', description: '', categoryId: event.categories?.[0]?.id || null, leaders: [] }, []);
    await ops.commit();
  });
  return html`<div class="toolbar">
      <span class="muted">${sessions.length} sessions · ${breakoutSlots(event).length * (event.rooms || []).length} schedule cells</span>
      <div class="row">
        <select aria-label="Sort sessions" value=${sort} onChange=${(e) => setSort(e.target.value)}>
          <option value="demand">Sort by demand</option>
          <option value="title">Sort A–Z</option>
        </select>
        <button class="btn small" onClick=${addEmpty}>+ Empty session</button>
      </div>
    </div>
    ${sessions.length === 0 && html`<${Empty}>No sessions yet. Select ideas in “Ideas & merging” to create some.<//>`}
    <div class="session-admin-list">
      ${list.map((s) => html`<${SessionEditor} key=${s.id} s=${s} d=${demand[s.id]} event=${event} ideas=${ideas} sessions=${sessions} base=${base} />`)}
    </div>`;
}

function SessionEditor({ s, d, event, ideas, sessions, base }) {
  const path = `${base}/sessions/${s.id}`;
  const save = guard(async (patch) => (await backend()).update(path, patch));
  const src = (s.ideaIds || []).map((id) => ideas.find((i) => i.id === id)).filter(Boolean);
  const leaderKey = (l) => l.uid || l.name;
  const offers = [...leadersFromIdeas(src), ...d.leadOffers].filter(
    (o, i, arr) => !(s.leaders || []).some((l) => leaderKey(l) === o.uid) && arr.findIndex((x) => x.uid === o.uid) === i
  );
  const [newLeader, setNewLeader] = useState('');
  const mode = event.voting?.mode || 'interest';
  const del = guard(async () => {
    if (!confirm(`Delete “${s.title}”? Its ideas go back to the unassigned pile.`)) return;
    const ops = sessionOps(base, sessions);
    ops.detach(src);
    await ops.commit();
    await (await backend()).remove(path);
  });
  const detachIdea = guard(async (i) => {
    const ops = sessionOps(base, sessions);
    ops.detach([i]);
    await ops.commit();
  });
  return html`<article class="card session-edit" style=${`--c:${event.categories?.find((c) => c.id === s.categoryId)?.color || '#888'}`}>
    <div class="session-edit-main">
      <input class="title-input" value=${s.title} onChange=${(e) => e.target.value.trim() && save({ title: e.target.value.trim() })} aria-label="Session title" />
      <textarea rows="2" value=${s.description || ''} placeholder="Description" onChange=${(e) => save({ description: e.target.value })} aria-label="Description"></textarea>
      <div class="row wrap-row">
        <select value=${s.categoryId || ''} onChange=${(e) => save({ categoryId: e.target.value })} aria-label="Topic">
          ${(event.categories || []).map((c) => html`<option value=${c.id}>${c.name}</option>`)}
        </select>
        <span class="small">Leaders:</span>
        ${(s.leaders || []).map(
          (l) => html`<span class="chip on">${l.name} <button class="x" aria-label=${`Remove ${l.name}`} onClick=${() => save({ leaders: s.leaders.filter((x) => leaderKey(x) !== leaderKey(l)) })}>×</button></span>`
        )}
        ${offers.map((o) => html`<button class="chip" title="Offered to lead" onClick=${() => save({ leaders: [...(s.leaders || []), { uid: o.uid, name: o.name }] })}>+ ${o.name}</button>`)}
        <form class="inline" onSubmit=${(e) => (e.preventDefault(), newLeader.trim() && (save({ leaders: [...(s.leaders || []), { uid: null, name: newLeader.trim() }] }), setNewLeader('')))}>
          <input class="small-input" placeholder="add leader" value=${newLeader} onInput=${(e) => setNewLeader(e.target.value)} aria-label="Add leader by name" />
        </form>
      </div>
      ${src.length > 0 &&
      html`<details class="small"><summary>${src.length} source idea${src.length > 1 ? 's' : ''}</summary>
        <ul class="sources">${src.map((i) => html`<li>${i.title} <button class="link small" onClick=${() => detachIdea(i)}>remove</button></li>`)}</ul>
      </details>`}
    </div>
    <div class="session-edit-side">
      <div class="demand"><strong>${d.score}</strong><span>demand</span></div>
      <div class="small muted">
        ${mode === 'dots' ? html`${d.dots} dots` : html`${d.must} must · ${d.interested} int · ${d.skip} skip`}
      </div>
      <button class="link danger small" onClick=${del}>delete</button>
    </div>
  </article>`;
}

// ---------------- Schedule ----------------

function ScheduleAdmin({ event, sessions, participants, base }) {
  const slots = breakoutSlots(event);
  const rooms = event.rooms || [];
  const cells = { ...emptyCells(event), ...(event.schedule?.cells || {}) };
  const published = !!event.schedule?.published;
  const demand = sessionDemand(event, participants, sessions);
  const evalr = evaluateSchedule(event, participants, sessions, cells);
  const byId = Object.fromEntries(sessions.map((s) => [s.id, s]));
  const b = () => backend();
  const saveCells = guard(async (c) => (await b()).update(base, { 'schedule.cells': c }));
  const setCell = (slotId, roomId, val) => saveCells({ ...cells, [slotId]: { ...cells[slotId], [roomId]: val } });
  const generate = guard(async () => {
    const hasManual = Object.values(cells).some((r) => Object.values(r || {}).some((c) => c && !c.locked));
    if (hasManual && !confirm('Regenerate? Unlocked cells will be replaced (🔒 locked cells stay).')) return;
    await saveCells(buildSchedule(event, participants, sessions, cells));
    toast('Schedule generated');
  });
  const sorted = [...sessions].sort((a, b) => demand[b.id].score - demand[a.id].score);
  const text = scheduleText(event, sessions, cells);
  const csv = () => {
    const rows = [['Start', 'End', 'Block', ...rooms.map((r) => r.name)]];
    for (const item of event.agenda || [])
      rows.push([item.start, item.end, item.label, ...rooms.map((r) => (item.kind === 'breakout' ? byId[cells[item.id]?.[r.id]?.sid]?.title || '' : ''))]);
    const blob = new Blob([rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${event.id}-schedule.csv`;
    a.click();
  };

  if (!slots.length || !rooms.length)
    return html`<${Empty}>Add at least one breakout block and one room in Settings.<//>`;

  return html`<div class="toolbar">
      <div class="row wrap-row">
        <button class="btn primary" onClick=${generate} disabled=${!sessions.length}>⚡ Generate from votes</button>
        <button class="btn ghost" onClick=${() => confirm('Clear all cells, including locked?') && saveCells(emptyCells(event))}>Clear</button>
      </div>
      <div class="row wrap-row">
        <button class="btn small ghost" onClick=${() => copyText(text, 'Schedule copied')}>Copy text</button>
        <button class="btn small ghost" onClick=${csv}>CSV</button>
        <button class="btn small ghost" onClick=${() => window.print()}>Print</button>
        <label class=${published ? 'switch on' : 'switch'}>
          <input type="checkbox" checked=${published} onChange=${guard(async (e) => (await b()).update(base, { 'schedule.published': e.target.checked }))} />
          ${published ? 'Published to participants' : 'Not published'}
        </label>
      </div>
    </div>

    <div class="stats compact">
      <div><strong>${Math.round(evalr.coverage * 100)}%</strong><span>of “must” picks scheduled</span></div>
      <div class=${evalr.missedMust ? 'warn' : ''}><strong>${evalr.missedMust}</strong><span>must-vs-must clashes</span></div>
      <div class=${evalr.leaderClashes.length ? 'bad' : ''}><strong>${evalr.leaderClashes.length}</strong><span>leader double-booked</span></div>
      <div class=${evalr.overCapacity.length ? 'warn' : ''}><strong>${evalr.overCapacity.length}</strong><span>rooms over capacity</span></div>
    </div>

    <div class="sched-editor" style=${`--n:${rooms.length}`}>
      <div class="se-head"><span></span>${rooms.map((r) => html`<span>${r.name} <span class="muted small">(${r.capacity || '∞'})</span></span>`)}</div>
      ${slots.map((sl) => {
        const att = evalr.attendance[sl.id] || {};
        return html`<div class="se-row">
          <div class="se-slot"><strong>${sl.label}</strong><span class="muted small">${fmtTime(sl.start)}–${fmtTime(sl.end)}</span>
            ${att._undecided ? html`<span class="muted small">${att._undecided} undecided</span>` : ''}</div>
          ${rooms.map((r) => {
            const c = cells[sl.id]?.[r.id];
            const over = c && r.capacity && att[c.sid] > r.capacity;
            return html`<div class=${`se-cell${c?.locked ? ' locked' : ''}${over ? ' over' : ''}`}>
              <select value=${c?.sid || ''} onChange=${(e) => setCell(sl.id, r.id, e.target.value ? { sid: e.target.value, locked: !!c?.locked } : null)} aria-label=${`${sl.label} ${r.name}`}>
                <option value="">— open —</option>
                ${sorted.map((s) => html`<option value=${s.id}>${s.title} (${demand[s.id].score})</option>`)}
              </select>
              ${c &&
              html`<div class="se-meta">
                <span>~${Math.round(att[c.sid] || 0)} ${Math.round(att[c.sid] || 0) === 1 ? 'person' : 'people'}</span>
                <button class="link small" title=${c.locked ? 'Unlock' : 'Lock so regenerate keeps it'} onClick=${() => setCell(sl.id, r.id, { ...c, locked: !c.locked })}>${c.locked ? '🔒 locked' : '🔓 lock'}</button>
              </div>`}
            </div>`;
          })}
        </div>`;
      })}
    </div>

    <div class="grid-2">
      <section class="card">
        <h3>Clashes</h3>
        ${!evalr.conflicts.length && !evalr.leaderClashes.length && html`<p class="muted">None — nobody has two “must” sessions at the same time.</p>`}
        ${evalr.leaderClashes.map(
          (c) => html`<p class="bad small">⚠ Same leader in “${byId[c.a]?.title}” and “${byId[c.b]?.title}” (${slots.find((s) => s.id === c.slotId)?.label})</p>`
        )}
        ${evalr.conflicts.map(
          (c) => html`<p class="small"><strong>${c.people.length}</strong> want both “${byId[c.a]?.title}” & “${byId[c.b]?.title}” in ${slots.find((s) => s.id === c.slotId)?.label}
            <span class="muted">(${c.people.join(', ')})</span></p>`
        )}
      </section>
      <section class="card">
        <h3>Not scheduled</h3>
        ${!evalr.unscheduled.length && html`<p class="muted">Every session has a slot.</p>`}
        <ul class="plain">${evalr.unscheduled
          .sort((a, b) => demand[b.id].score - demand[a.id].score)
          .map((s) => html`<li>${s.title} <span class="muted small">demand ${demand[s.id].score}</span></li>`)}</ul>
      </section>
    </div>

    <section class="card print-area">
      <h3>Preview</h3>
      <${ScheduleGrid} event=${event} sessions=${sessions} cells=${cells} />
    </section>`;
}

// ---------------- Settings ----------------

function Settings({ event, participants, ideas, sessions, base, onDeleted }) {
  const [draft, setDraft] = useState(() => pick(event, ['title', 'tagline', 'categories', 'rooms', 'agenda', 'roles', 'voting']));
  const [dirty, setDirty] = useState(false);
  const up = (k, v) => (setDraft({ ...draft, [k]: v }), setDirty(true));
  const listOp = (k) => ({
    set: (i, patch) => up(k, draft[k].map((x, j) => (j === i ? { ...x, ...patch } : x))),
    del: (i) => up(k, draft[k].filter((_, j) => j !== i)),
    move: (i, d) => {
      const a = [...draft[k]];
      if (i + d < 0 || i + d >= a.length) return;
      [a[i], a[i + d]] = [a[i + d], a[i]];
      up(k, a);
    },
    add: (x) => up(k, [...draft[k], x]),
  });
  const cats = listOp('categories');
  const rooms = listOp('rooms');
  const agenda = listOp('agenda');
  const save = guard(async () => {
    const d = { ...draft, agenda: [...draft.agenda].sort((a, b) => a.start.localeCompare(b.start)) };
    if (!d.categories.length) throw new Error('Keep at least one topic.');
    await (await backend()).update(base, d);
    setDraft(d);
    setDirty(false);
    toast('Settings saved');
  });
  const reset = guard(async () => {
    if (prompt(`This deletes all participants, their votes, participant ideas, and sessions. Organizer ideas and settings stay.\nType the event code (${event.id}) to confirm:`) !== event.id) return;
    const ops = [
      ...participants.map((p) => ({ op: 'delete', path: `${base}/participants/${p.id}` })),
      ...sessions.map((s) => ({ op: 'delete', path: `${base}/sessions/${s.id}` })),
      ...ideas.map((i) =>
        i.organizer
          ? { op: 'update', path: `${base}/ideas/${i.id}`, data: { upvotes: {}, leads: {}, comments: [], sessionId: DEL, hidden: false } }
          : { op: 'delete', path: `${base}/ideas/${i.id}` }
      ),
      { op: 'update', path: base, data: { phase: 'setup', 'schedule.cells': {}, 'schedule.published': false } },
    ];
    await (await backend()).batch(ops);
    toast('Event reset');
  });
  const del = guard(async () => {
    if (prompt(`Delete this event permanently? Type the code (${event.id}) to confirm:`) !== event.id) return;
    const ops = [
      ...participants.map((p) => ({ op: 'delete', path: `${base}/participants/${p.id}` })),
      ...sessions.map((s) => ({ op: 'delete', path: `${base}/sessions/${s.id}` })),
      ...ideas.map((i) => ({ op: 'delete', path: `${base}/ideas/${i.id}` })),
    ];
    const b = await backend();
    await b.batch(ops);
    await b.remove(base);
    onDeleted();
  });
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ event, participants, ideas, sessions }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${event.id}-export.json`;
    a.click();
  };

  return html`<div class=${dirty ? 'save-bar dirty' : 'save-bar'}>
      <span>${dirty ? 'Unsaved changes' : 'All changes saved'}</span>
      <button class="btn primary" disabled=${!dirty} onClick=${save}>Save settings</button>
    </div>
    <div class="grid-2">
      <section class="card stack">
        <h3>Basics</h3>
        <label>Title<input value=${draft.title} onInput=${(e) => up('title', e.target.value)} /></label>
        <label>Welcome line<input value=${draft.tagline || ''} onInput=${(e) => up('tagline', e.target.value)} /></label>
        <label>Participant roles <span class="muted small">(comma separated, optional)</span>
          <input value=${(draft.roles || []).join(', ')} onInput=${(e) => up('roles', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} />
        </label>
        <fieldset>
          <legend>Phase 2 voting style</legend>
          <label class="check"><input type="radio" name="vm" checked=${draft.voting?.mode !== 'dots'} onChange=${() => up('voting', { ...draft.voting, mode: 'interest' })} /> Interest levels (Must / Interested / Skip)</label>
          <label class="check"><input type="radio" name="vm" checked=${draft.voting?.mode === 'dots'} onChange=${() => up('voting', { ...draft.voting, mode: 'dots' })} /> Dot voting</label>
          ${draft.voting?.mode === 'dots' &&
          html`<label class="inline">Dots per person <input type="number" min="1" max="20" value=${draft.voting.dots} onInput=${(e) => up('voting', { ...draft.voting, dots: Number(e.target.value) || 1 })} /></label>`}
        </fieldset>
      </section>

      <section class="card stack">
        <h3>Big topics</h3>
        ${draft.categories.map(
          (c, i) => html`<div class="edit-row">
            <input type="color" value=${c.color} onInput=${(e) => cats.set(i, { color: e.target.value })} aria-label="Color" />
            <div class="grow stack tight">
              <input value=${c.name} onInput=${(e) => cats.set(i, { name: e.target.value })} aria-label="Topic name" />
              <input class="small-input" value=${c.description || ''} placeholder="short description" onInput=${(e) => cats.set(i, { description: e.target.value })} aria-label="Topic description" />
            </div>
            <${RowBtns} i=${i} n=${draft.categories.length} op=${cats} />
          </div>`
        )}
        <button class="btn small" onClick=${() => cats.add({ id: newId(), name: 'New topic', description: '', color: CATEGORY_COLORS[draft.categories.length % CATEGORY_COLORS.length] })}>+ Topic</button>
      </section>

      <section class="card stack">
        <h3>Rooms</h3>
        ${draft.rooms.map(
          (r, i) => html`<div class="edit-row">
            <input class="grow" value=${r.name} onInput=${(e) => rooms.set(i, { name: e.target.value })} aria-label="Room name" />
            <label class="inline small">cap <input type="number" min="0" value=${r.capacity} onInput=${(e) => rooms.set(i, { capacity: Number(e.target.value) || 0 })} /></label>
            <${RowBtns} i=${i} n=${draft.rooms.length} op=${rooms} />
          </div>`
        )}
        <button class="btn small" onClick=${() => rooms.add({ id: newId(), name: `Room ${String.fromCharCode(65 + draft.rooms.length)}`, capacity: 15 })}>+ Room</button>
      </section>

      <section class="card stack">
        <h3>Agenda</h3>
        <p class="muted small">“Breakout” blocks get one session per room. Everything else is whole-group time.</p>
        ${draft.agenda.map(
          (a, i) => html`<div class="edit-row agenda-row">
            <input type="time" value=${a.start} onInput=${(e) => agenda.set(i, { start: e.target.value })} aria-label="Start" />
            <input type="time" value=${a.end} onInput=${(e) => agenda.set(i, { end: e.target.value })} aria-label="End" />
            <input class="grow" value=${a.label} onInput=${(e) => agenda.set(i, { label: e.target.value })} aria-label="Label" />
            <select value=${a.kind} onChange=${(e) => agenda.set(i, { kind: e.target.value })} aria-label="Kind">
              <option value="breakout">Breakout</option>
              <option value="plenary">Whole group</option>
            </select>
            <${RowBtns} i=${i} n=${draft.agenda.length} op=${agenda} />
          </div>`
        )}
        <button class="btn small" onClick=${() => {
          const last = draft.agenda.at(-1);
          agenda.add({ id: newId(), start: last?.end || '09:00', end: last?.end || '10:00', label: `Breakout ${breakoutSlots(draft).length + 1}`, kind: 'breakout' });
        }}>+ Block</button>
      </section>

      <section class="card stack">
        <h3>Data</h3>
        <button class="btn small" onClick=${exportJson}>Download all data (JSON)</button>
        <button class="btn small ghost danger" onClick=${reset}>Reset event (clear people, votes, sessions)</button>
        <button class="btn small ghost danger" onClick=${del}>Delete event</button>
      </section>
    </div>`;
}

function RowBtns({ i, n, op }) {
  return html`<div class="row-btns">
    <button class="icon-btn" aria-label="Move up" disabled=${i === 0} onClick=${() => op.move(i, -1)}>▲</button>
    <button class="icon-btn" aria-label="Move down" disabled=${i === n - 1} onClick=${() => op.move(i, 1)}>▼</button>
    <button class="icon-btn danger" aria-label="Delete" onClick=${() => op.del(i)}>✕</button>
  </div>`;
}

mount(AdminApp);

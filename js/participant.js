import { html, useState, useEffect, useMemo, mount, useEventData, toast, guard, CategoryTag, DemoBanner, Empty, ScheduleGrid, CategoryBars, LoadError, Logo, StepTracker, getParam, setParam } from './ui.js';
import { backend, DEL, union } from './backend.js';
import { normalizeCode, ideaStats, ideaScore, findSimilar, INTEREST_LEVELS, dotsUsed, personalAgenda, fmtTime, uid as newId, categoryScores, participantStep } from './model.js';

const store = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
    } catch {}
  },
};

function App() {
  const [uid, setUid] = useState(null);
  const [code, setCode] = useState(normalizeCode(getParam('code') || store.get('unconf:code') || ''));
  useEffect(() => {
    backend()
      .then((b) => b.ensureAnon())
      .then(setUid)
      .catch((e) => toast(e.message, 'err'));
  }, []);
  const data = useEventData(uid && code ? code : null);

  const chooseCode = (c) => {
    const n = normalizeCode(c);
    setCode(n);
    setParam('code', n);
    store.set('unconf:code', n || null);
  };

  if (!uid) return html`<div class="wrap"><p class="loading">Connecting…</p></div>`;
  if (!code) return html`<${CodeScreen} onCode=${chooseCode} />`;
  if (data.loading) return html`<div class="wrap"><p class="loading">Loading event…</p></div>`;
  if (data.error) return html`<${LoadError} code=${code} error=${data.error} onRetry=${data.retry} onBack=${() => chooseCode('')} />`;
  if (!data.event) return html`<${CodeScreen} onCode=${chooseCode} error=${`No event found with code “${code}”. Check the code on the screen.`} />`;
  const me = data.participants.find((p) => p.id === uid);
  if (!me) return html`<${NameScreen} event=${data.event} uid=${uid} onBack=${() => chooseCode('')} />`;
  return html`<${Main} ...${data} me=${me} uid=${uid} onLeave=${() => chooseCode('')} />`;
}

// ---------------- Joining ----------------

function CodeScreen({ onCode, error }) {
  const [v, setV] = useState('');
  return html`<${DemoBanner} />
    <main class="wrap narrow center-screen">
      <div class="card join">
        <${Logo} className="join-logo" />
        <h1>Join the unconference</h1>
        <p class="muted">Enter the code shown on the screen at the front of the room.</p>
        ${error && html`<p class="error" role="alert">${error}</p>`}
        <form onSubmit=${(e) => (e.preventDefault(), onCode(v))}>
          <input class="big-input" aria-label="Event code" placeholder="Event code" value=${v} onInput=${(e) => setV(e.target.value)} autofocus autocapitalize="off" autocomplete="off" />
          <button class="btn primary block" disabled=${!v.trim()}>Continue</button>
        </form>
      </div>
    </main>`;
}

function NameScreen({ event, uid, onBack }) {
  const [name, setName] = useState(store.get('unconf:name') || '');
  const [role, setRole] = useState('');
  const join = guard(async (e) => {
    e.preventDefault();
    const b = await backend();
    store.set('unconf:name', name.trim());
    await b.set(`events/${event.id}/participants/${uid}`, { name: name.trim(), role, joinedAt: Date.now() }, true);
  });
  return html`<${DemoBanner} />
    <main class="wrap narrow center-screen">
      <div class="card join">
        <${Logo} className="join-logo" />
        <p class="eyebrow">You're joining</p>
        <h1>${event.title}</h1>
        <form onSubmit=${join}>
          <label>Your name<input value=${name} onInput=${(e) => setName(e.target.value)} placeholder="First and last name" required maxlength="60" autofocus autocomplete="name" /></label>
          ${event.roles?.length > 0 &&
          html`<fieldset class="roles">
            <legend>Your focus <span class="muted">(optional)</span></legend>
            ${event.roles.map(
              (r) => html`<button type="button" class=${role === r ? 'chip on' : 'chip'} aria-pressed=${role === r} onClick=${() => setRole(role === r ? '' : r)}>${r}</button>`
            )}
          </fieldset>`}
          <button class="btn primary block" disabled=${!name.trim()}>Join</button>
        </form>
        <button class="link small" onClick=${onBack}>Use a different code</button>
      </div>
    </main>`;
}

// ---------------- Shell ----------------

function Main({ event, participants, ideas, sessions, me, uid, onLeave }) {
  const ctx = { event, participants, ideas: ideas.filter((i) => !i.hidden), sessions, me, uid, base: `events/${event.id}` };
  const phase = event.phase || 'setup';
  const published = phase === 'schedule' && event.schedule?.published;
  const rename = guard(async () => {
    const n = prompt('Your name', me.name);
    if (n && n.trim()) await (await backend()).update(`${ctx.base}/participants/${uid}`, { name: n.trim() });
  });
  return html`<${DemoBanner} />
    <header class="site-header">
      <div class="wrap header-inner">
        <${Logo} />
        <div class="me">
          <button class="link" onClick=${rename} title="Change your name">${me.name}</button>
          <button class="link muted" onClick=${onLeave}>Leave</button>
        </div>
      </div>
    </header>
    <main class="wrap">
      <h1 class="event-title">${event.title}</h1>
      <${StepTracker} event=${event} />
      <${NowCard} ...${ctx} />
      ${phase === 'ideas' && html`<${IdeasFlow} ...${ctx} />`}
      ${phase === 'curate' && html`<${SessionsPreview} ...${ctx} />`}
      ${(phase === 'vote' || (phase === 'schedule' && !published)) && html`<${VoteBoard} ...${ctx} />`}
      ${published && html`<${YourDay} ...${ctx} />`}
    </main>`;
}

// The one card that always answers "what do I do right now?"
function NowCard({ event, me, sessions }) {
  const phase = event.phase || 'setup';
  const { step, state } = participantStep(event);
  const dots = event.voting?.mode === 'dots';
  const copy = {
    setup: {
      title: `Welcome, ${me.name.split(' ')[0]}!`,
      body: "We'll start in a moment. When the organizer opens Step 1, this page updates on its own — no need to refresh.",
    },
    ideas: {
      title: 'Share your ideas',
      body: 'Three quick parts: rank the big topics, back the ideas you’d attend, and suggest your own.',
    },
    curate: {
      title: 'Building sessions from your ideas',
      body: 'Organizers are combining similar ideas into sessions. Voting opens in a few minutes — keep this page open.',
    },
    vote: {
      title: 'Vote for sessions',
      body: dots
        ? `Spread your ${event.voting.dots} dots across the sessions you want most. Put several on one if you really want it.`
        : 'For each session, choose Must attend, Interested, or Skip. Your “must” picks help us avoid scheduling them at the same time.',
    },
    schedule: event.schedule?.published
      ? { title: 'Your schedule is ready', body: 'Here’s your suggested day based on your votes. Rooms are open — go wherever is most useful.' }
      : { title: 'Finalizing the schedule', body: 'Your personal schedule will appear here shortly. You can still change your votes below.' },
  }[phase];
  const label = state === 'now' ? `Now · Step ${step}` : phase === 'setup' ? 'Getting started' : 'Hang tight';
  return html`<section class=${`now-card ${state}`} aria-live="polite">
    <p class="eyebrow">${label}</p>
    <h2>${copy.title}</h2>
    <p>${copy.body}</p>
    ${phase === 'curate' && sessions.length > 0 && html`<p class="small muted">${sessions.length} session${sessions.length > 1 ? 's' : ''} so far.</p>`}
  </section>`;
}

// ---------------- Step 1: guided ideas ----------------

function IdeasFlow(ctx) {
  const key = `unconf:part:${ctx.event.id}`;
  const [part, setPartState] = useState(() => store.get(key) || (ctx.me.catRank?.length ? 'back' : 'rank'));
  const setPart = (p) => {
    setPartState(p);
    store.set(key, p);
    document.getElementById('parts')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const backed = ctx.ideas.filter((i) => i.upvotes?.[ctx.uid]).length;
  const mine = ctx.ideas.filter((i) => i.authorUid === ctx.uid).length;
  const parts = [
    { id: 'rank', label: 'Rank topics', done: !!ctx.me.catRank?.length },
    { id: 'back', label: 'Back ideas', done: backed > 0 },
    { id: 'suggest', label: 'Suggest', done: mine > 0 },
  ];
  return html`<nav class="parts" id="parts" aria-label="Step 1 has three parts">
      ${parts.map(
        (p, i) => html`<button class=${`part${part === p.id ? ' on' : ''}${p.done ? ' done' : ''}`} aria-current=${part === p.id ? 'step' : undefined} onClick=${() => setPart(p.id)}>
          <span class="part-num">${p.done ? '✓' : i + 1}</span><span class="part-label">${p.label}</span>
        </button>`
      )}
    </nav>
    ${part === 'rank' && html`<${RankPart} ...${ctx} onNext=${() => setPart('back')} />`}
    ${part === 'back' && html`<${BackPart} ...${ctx} backed=${backed} onNext=${() => setPart('suggest')} />`}
    ${part === 'suggest' && html`<${SuggestPart} ...${ctx} mine=${mine} onBrowse=${() => setPart('back')} />`}`;
}

function rankedCategories(event, me) {
  const cats = event.categories || [];
  const ids = new Set(cats.map((c) => c.id));
  const order = (me.catRank || []).filter((id) => ids.has(id));
  for (const c of cats) if (!order.includes(c.id)) order.push(c.id);
  const byId = Object.fromEntries(cats.map((c) => [c.id, c]));
  return order.map((id) => byId[id]);
}

function RankPart({ event, participants, me, uid, base, onNext }) {
  const list = rankedCategories(event, me);
  const saved = !!me.catRank?.length;
  const [drag, setDrag] = useState(null);
  const save = guard(async (arr) => (await backend()).update(`${base}/participants/${uid}`, { catRank: arr.map((c) => c.id) }));
  const move = (i, j) => {
    if (j < 0 || j >= list.length || i === j) return;
    const arr = [...list];
    const [x] = arr.splice(i, 1);
    arr.splice(j, 0, x);
    save(arr);
  };
  const responses = participants.filter((p) => p.catRank?.length).length;
  return html`<section class="card part-card">
      <h3>Which topics matter most to you?</h3>
      <p class="muted">Drag, or use the arrows. #1 is the most important to you today.</p>
      <ol class="rank-list">
        ${list.map(
          (c, i) => html`<li
            class=${drag === i ? 'rank-item dragging' : 'rank-item'}
            draggable="true"
            onDragStart=${() => setDrag(i)}
            onDragOver=${(e) => e.preventDefault()}
            onDrop=${(e) => (e.preventDefault(), drag != null && move(drag, i), setDrag(null))}
            onDragEnd=${() => setDrag(null)}
            style=${`--c:${c.color}`}
          >
            <span class="rank-num">${i + 1}</span>
            <div class="rank-text"><strong>${c.name}</strong>${c.description && html`<span class="muted">${c.description}</span>`}</div>
            <div class="rank-btns">
              <button class="icon-btn" aria-label=${`Move ${c.name} up`} disabled=${i === 0} onClick=${() => move(i, i - 1)}>▲</button>
              <button class="icon-btn" aria-label=${`Move ${c.name} down`} disabled=${i === list.length - 1} onClick=${() => move(i, i + 1)}>▼</button>
            </div>
          </li>`
        )}
      </ol>
      <div class="part-footer">
        ${saved ? html`<span class="saved">✓ Saved</span>` : html`<span class="muted small">Not saved yet</span>`}
        <button class="btn primary" onClick=${() => (saved ? onNext() : (save(list), onNext()))}>${saved ? 'Continue' : 'Save and continue'} →</button>
      </div>
    </section>
    ${saved &&
    html`<details class="card room-ranking">
      <summary><strong>How the room is ranking</strong> <span class="muted small">(${responses} ${responses === 1 ? 'response' : 'responses'})</span></summary>
      <${CategoryBars} rows=${categoryScores(event, participants)} />
    </details>`}`;
}

function BackPart({ event, ideas, me, uid, base, backed, onNext }) {
  const [cat, setCat] = useState('all');
  const [sort, setSort] = useState('popular');
  const cats = Object.fromEntries((event.categories || []).map((c) => [c.id, c]));
  const list = ideas
    .filter((i) => cat === 'all' || i.categoryId === cat)
    .sort((a, b) => (sort === 'popular' ? ideaScore(b) - ideaScore(a) : 0) || (b.createdAt || 0) - (a.createdAt || 0));
  return html`<section class="part-intro">
      <h3>Back the ideas you’d attend</h3>
      <p class="muted">Tap <strong>▲</strong> on ideas you like. Use <strong>💬</strong> to add your angle, or say you <strong>could lead</strong> one.</p>
    </section>
    <div class="toolbar">
      <div class="chips" role="group" aria-label="Filter by topic">
        <button class=${cat === 'all' ? 'chip on' : 'chip'} aria-pressed=${cat === 'all'} onClick=${() => setCat('all')}>All</button>
        ${(event.categories || []).map(
          (c) => html`<button class=${cat === c.id ? 'chip on' : 'chip'} aria-pressed=${cat === c.id} style=${`--c:${c.color}`} onClick=${() => setCat(c.id)}>${c.name}</button>`
        )}
      </div>
      <select aria-label="Sort ideas" value=${sort} onChange=${(e) => setSort(e.target.value)}>
        <option value="popular">Most backed</option>
        <option value="new">Newest</option>
      </select>
    </div>
    ${list.length === 0 && html`<${Empty}>No ideas in this topic yet. <button class="link" onClick=${onNext}>Suggest one</button><//>`}
    <div class="idea-list">
      ${list.map((i) => html`<${IdeaCard} key=${i.id} idea=${i} cat=${cats[i.categoryId]} me=${me} uid=${uid} base=${base} />`)}
    </div>
    <div class="sticky-next">
      <span>${backed ? html`You’ve backed <strong>${backed}</strong> idea${backed > 1 ? 's' : ''}` : 'Back at least one idea'}</span>
      <button class="btn primary" onClick=${onNext}>Next: suggest your own →</button>
    </div>`;
}

function IdeaCard({ idea, cat, me, uid, base, readOnly }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const s = ideaStats(idea);
  const voted = !!idea.upvotes?.[uid];
  const leading = !!idea.leads?.[uid];
  const path = `${base}/ideas/${idea.id}`;
  const patch = guard(async (p) => (await backend()).update(path, p));
  const addComment = guard(async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    await (await backend()).update(path, { comments: union({ id: newId(), uid, name: me.name, text: text.trim(), at: Date.now() }) });
    setText('');
  });
  const leaders = Object.values(idea.leads || {});
  return html`<article class=${`idea card${voted ? ' backed' : ''}`} style=${cat ? `--c:${cat.color}` : ''}>
    <div class="idea-body">
      <div class="idea-head">
        <${CategoryTag} cat=${cat} />
        ${idea.authorName && idea.authorName !== 'Organizer' && html`<span class="muted small">from ${idea.authorName}</span>`}
      </div>
      <h4>${idea.title}</h4>
      ${idea.description && html`<p>${idea.description}</p>`}
      ${leaders.length > 0 && html`<p class="small leads-line">🙋 Could lead: ${leaders.join(', ')}</p>`}
      ${!readOnly &&
      html`<div class="idea-actions">
        <button class=${leading ? 'pill on' : 'pill'} aria-pressed=${leading} onClick=${() => patch({ [`leads.${uid}`]: leading ? DEL : me.name })}>
          🙋 ${leading ? 'You could lead' : 'I could lead'}
        </button>
        <button class=${open ? 'pill on-soft' : 'pill'} aria-expanded=${open} onClick=${() => setOpen(!open)}>💬 ${open ? 'Hide comments' : s.comments ? `${s.comments} comment${s.comments > 1 ? 's' : ''}` : 'Comment'}</button>
      </div>`}
      ${open &&
      html`<div class="comments">
        ${(idea.comments || []).map((c) => html`<div class="comment"><strong>${c.name}:</strong> ${c.text}</div>`)}
        <form class="comment-form" onSubmit=${addComment}>
          <input value=${text} onInput=${(e) => setText(e.target.value)} placeholder="Add your angle or question…" maxlength="280" aria-label="Add a comment" />
          <button class="btn small" disabled=${!text.trim()}>Add</button>
        </form>
      </div>`}
    </div>
    ${!readOnly &&
    html`<button class=${voted ? 'back-btn on' : 'back-btn'} aria-pressed=${voted} aria-label=${`${voted ? 'Un-back' : 'Back'} “${idea.title}” (${s.votes})`} onClick=${() => patch({ [`upvotes.${uid}`]: voted ? DEL : true })}>
      <span class="arrow">▲</span><span class="n">${s.votes}</span>
    </button>`}
  </article>`;
}

function SuggestPart({ event, ideas, me, uid, base, mine, onBrowse }) {
  const [categoryId, setCategoryId] = useState(event.categories?.[0]?.id || '');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [lead, setLead] = useState(false);
  const [done, setDone] = useState(null);
  const similar = useMemo(() => (title.trim().length >= 4 ? findSimilar(`${title} ${desc}`, ideas, 0.2) : []), [title, desc, ideas]);
  const reset = () => (setTitle(''), setDesc(''), setLead(false));

  const submit = guard(async (e) => {
    e.preventDefault();
    const id = newId(12);
    await (await backend()).set(`${base}/ideas/${id}`, {
      title: title.trim(),
      description: desc.trim(),
      categoryId,
      authorUid: uid,
      authorName: me.name,
      createdAt: Date.now(),
      upvotes: {},
      leads: lead ? { [uid]: me.name } : {},
      comments: [],
    });
    reset();
    setDone('Your idea is on the board.');
  });

  const addAsFlavor = guard(async (idea) => {
    const p = {
      comments: union({ id: newId(), uid, name: me.name, text: `${title.trim()}${desc.trim() ? ' — ' + desc.trim() : ''}`, at: Date.now() }),
      [`upvotes.${uid}`]: true,
    };
    if (lead) p[`leads.${uid}`] = me.name;
    await (await backend()).update(`${base}/ideas/${idea.id}`, p);
    reset();
    setDone(`You backed “${idea.title}” and added your angle.`);
  });

  if (done)
    return html`<section class="card part-card done-card">
      <p class="done-mark">✓</p>
      <h3>${done}</h3>
      <p class="muted">That’s Step 1! Keep browsing or suggest more until the organizer opens voting.</p>
      <div class="row center-row">
        <button class="btn primary" onClick=${() => setDone(null)}>Suggest another</button>
        <button class="btn" onClick=${onBrowse}>Browse ideas</button>
      </div>
    </section>`;

  return html`<section class="card part-card">
    <h3>Suggest a session idea</h3>
    <p class="muted">Something you’d want to discuss, learn, or lead. Short, specific titles work best.${mine ? ` You’ve suggested ${mine}.` : ''}</p>
    <form onSubmit=${submit} class="stack">
      <label>Topic
        <select value=${categoryId} onChange=${(e) => setCategoryId(e.target.value)}>
          ${(event.categories || []).map((c) => html`<option value=${c.id}>${c.name}</option>`)}
        </select>
      </label>
      <label>Your idea
        <input value=${title} onInput=${(e) => setTitle(e.target.value)} placeholder="e.g. Rolling out MFA for staff without the drama" maxlength="90" required />
      </label>
      <label><span>Details <span class="muted">(optional)</span></span>
        <textarea value=${desc} onInput=${(e) => setDesc(e.target.value)} rows="3" maxlength="400" placeholder="What questions should this session answer? What could you share?"></textarea>
      </label>
      <label class="check"><input type="checkbox" checked=${lead} onChange=${(e) => setLead(e.target.checked)} /> I’d be willing to lead or co-lead this</label>
      ${similar.length > 0 &&
      html`<div class="similar" role="status">
        <strong>Similar ideas are already on the board</strong>
        <p class="small">Joining forces keeps sessions from splintering. Add your angle to one of these instead?</p>
        ${similar.map(
          ({ idea }) => html`<div class="similar-item">
            <span>${idea.title}</span>
            <button type="button" class="btn small" onClick=${() => addAsFlavor(idea)}>Back it + add my angle</button>
          </div>`
        )}
      </div>`}
      <button class="btn primary" disabled=${!title.trim() || !categoryId}>${similar.length ? 'Post as a new idea anyway' : 'Post my idea'}</button>
    </form>
  </section>`;
}

// ---------------- Between steps ----------------

function SessionsPreview(ctx) {
  return html`${ctx.sessions.length === 0 && html`<${Empty}>Sessions will appear here as they’re created.<//>`}
    <${SessionList} ...${ctx} readOnly=${true} />`;
}

// ---------------- Step 2: vote ----------------

function VoteBoard(ctx) {
  return html`<${VoteStatus} ...${ctx} />
    <${SessionList} ...${ctx} />`;
}

function VoteStatus({ event, sessions, me }) {
  if (event.voting?.mode === 'dots') {
    const total = Number(event.voting.dots || 0);
    const left = total - dotsUsed(me);
    return html`<div class=${`sticky-status${left === 0 ? ' complete' : ''}`}>
      <span class="dots-left" aria-hidden="true">${Array.from({ length: total }, (_, i) => html`<span class=${i < left ? 'dot' : 'dot used'}></span>`)}</span>
      ${left === 0 ? html`<strong>All dots placed ✓</strong>` : html`<span><strong>${left}</strong> of ${total} dots left</span>`}
    </div>`;
  }
  const rated = sessions.filter((s) => me.votes?.[s.id]).length;
  const all = sessions.length > 0 && rated === sessions.length;
  return html`<div class=${`sticky-status${all ? ' complete' : ''}`}>
    <span class="bar small-bar" aria-hidden="true"><span style=${`width:${sessions.length ? (rated / sessions.length) * 100 : 0}%`}></span></span>
    ${all ? html`<strong>All done ✓</strong> <span class="muted small">You can change votes until the schedule is posted.</span>` : html`<span>Rated <strong>${rated}</strong> of ${sessions.length}</span>`}
  </div>`;
}

function SessionList({ event, sessions, ideas, me, uid, base, readOnly }) {
  const cats = event.categories || [];
  const groups = cats.map((c) => ({ cat: c, items: sessions.filter((s) => s.categoryId === c.id) }));
  const other = sessions.filter((s) => !cats.some((c) => c.id === s.categoryId));
  if (other.length) groups.push({ cat: null, items: other });
  const ideaById = Object.fromEntries(ideas.map((i) => [i.id, i]));
  return html`${groups
    .filter((g) => g.items.length)
    .map(
      (g) => html`<section class="session-group">
        <h3 class="group-title" style=${g.cat ? `--c:${g.cat.color}` : ''}>${g.cat ? g.cat.name : 'Other'}</h3>
        ${g.items
          .sort((a, b) => String(a.title).localeCompare(String(b.title)))
          .map(
            (s) => html`<${SessionCard} key=${s.id} s=${s} cat=${g.cat} event=${event} me=${me} uid=${uid} base=${base} readOnly=${readOnly} sources=${(s.ideaIds || []).map((id) => ideaById[id]).filter(Boolean)} />`
          )}
      </section>`
    )}`;
}

function SessionCard({ s, cat, event, me, uid, base, readOnly, sources }) {
  const [showSrc, setShowSrc] = useState(false);
  const path = `${base}/participants/${uid}`;
  const patch = guard(async (p) => (await backend()).update(path, p));
  const mode = event.voting?.mode || 'interest';
  const vote = me.votes?.[s.id];
  const dots = Number(me.dots?.[s.id] || 0);
  const left = Number(event.voting?.dots || 0) - dotsUsed(me);
  const leading = !!me.leads?.[s.id];
  return html`<article class=${`session card${vote ? ' voted-' + vote : ''}${dots ? ' has-dots' : ''}`} style=${cat ? `--c:${cat.color}` : ''}>
    <h4>${s.title}</h4>
    ${s.description && html`<p>${s.description}</p>`}
    ${s.leaders?.length > 0 && html`<p class="small leads-line">Led by ${s.leaders.map((l) => l.name).join(', ')}</p>`}
    ${sources.length > 1 &&
    html`<button class="link small" aria-expanded=${showSrc} onClick=${() => setShowSrc(!showSrc)}>${showSrc ? 'Hide' : 'Combines'} ${sources.length} ideas</button>
      ${showSrc && html`<ul class="sources">${sources.map((i) => html`<li>${i.title}</li>`)}</ul>`}`}
    ${!readOnly &&
    html`<div class="vote-row">
      ${mode === 'dots'
        ? html`<div class="stepper" role="group" aria-label=${`Dots for ${s.title}`}>
            <button class="icon-btn" aria-label="Remove a dot" disabled=${!dots} onClick=${() => patch({ [`dots.${s.id}`]: dots > 1 ? dots - 1 : DEL })}>−</button>
            <span class="dot-count">${dots ? Array.from({ length: dots }, () => html`<span class="dot"></span>`) : html`<span class="muted small">0 dots</span>`}</span>
            <button class="icon-btn" aria-label="Add a dot" disabled=${left <= 0} onClick=${() => patch({ [`dots.${s.id}`]: dots + 1 })}>+</button>
          </div>`
        : html`<div class="seg" role="group" aria-label=${`Interest in ${s.title}`}>
            ${INTEREST_LEVELS.map(
              (l) => html`<button class=${vote === l.id ? `seg-btn on ${l.id}` : 'seg-btn'} aria-pressed=${vote === l.id} onClick=${() => patch({ [`votes.${s.id}`]: vote === l.id ? DEL : l.id })}>${l.label}</button>`
            )}
          </div>`}
      <button class=${leading ? 'pill on' : 'pill'} aria-pressed=${leading} onClick=${() => patch({ [`leads.${s.id}`]: leading ? DEL : true })}>🙋 ${leading ? 'You’ll help lead' : 'I can lead'}</button>
    </div>`}
  </article>`;
}

// ---------------- Step 3: schedule ----------------

function YourDay(ctx) {
  const [view, setView] = useState('mine');
  const cells = ctx.event.schedule.cells || {};
  const rows = personalAgenda(ctx.event, ctx.me, ctx.sessions, cells);
  const mine = Object.fromEntries(rows.filter((r) => r.pick).map((r) => [r.item.id, r.pick.session.id]));
  return html`<div class="seg view-toggle" role="group" aria-label="Schedule view">
      <button class=${view === 'mine' ? 'seg-btn on must' : 'seg-btn'} aria-pressed=${view === 'mine'} onClick=${() => setView('mine')}>Your day</button>
      <button class=${view === 'all' ? 'seg-btn on must' : 'seg-btn'} aria-pressed=${view === 'all'} onClick=${() => setView('all')}>Full schedule</button>
    </div>
    ${view === 'mine' ? html`<${MyDay} ...${ctx} rows=${rows} />` : html`<${ScheduleGrid} event=${ctx.event} sessions=${ctx.sessions} cells=${cells} mine=${mine} />`}`;
}

function MyDay({ event, rows }) {
  const cats = Object.fromEntries((event.categories || []).map((c) => [c.id, c]));
  return html`<ol class="myday">
    ${rows.map(
      ({ item, pick, options }) => html`<li class=${`myday-item ${item.kind}`}>
        <div class="sched-time">${fmtTime(item.start)}<span>–${fmtTime(item.end)}</span></div>
        <div class="myday-body">
          ${item.kind !== 'breakout'
            ? html`<strong>${item.label}</strong>`
            : html`<div class="muted small">${item.label}</div>
                ${pick
                  ? html`<div class="pick" style=${`--c:${cats[pick.session.categoryId]?.color || 'var(--blue)'}`}>
                      <strong>${pick.session.title}</strong>
                      <span class="room-pill">${pick.room?.name}</span>
                      ${pick.leading && html`<span class="badge lead">You’re leading</span>`}
                    </div>`
                  : html`<div class="pick open"><strong>Your choice</strong> <span class="muted small">— pick any session below</span></div>`}
                ${options.filter((o) => o !== pick).length > 0 &&
                html`<div class="alts small">
                  ${pick ? 'Also running: ' : ''}${options
                    .filter((o) => o !== pick)
                    .map((o, i) => html`${i ? ' · ' : ''}${o.session.title} <span class="muted">(${o.room?.name})</span>`)}
                </div>`}`}
        </div>
      </li>`
    )}
  </ol>`;
}

mount(App);

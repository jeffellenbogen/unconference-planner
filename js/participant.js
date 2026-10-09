import { html, useState, useEffect, useMemo, mount, useEventData, toast, guard, Tabs, CategoryTag, PhaseBadge, DemoBanner, Empty, ScheduleGrid, CategoryBars, LoadError, getParam, setParam } from './ui.js';
import { backend, DEL, union } from './backend.js';
import { normalizeCode, ideaStats, ideaScore, findSimilar, INTEREST_LEVELS, dotsUsed, personalAgenda, fmtTime, uid as newId, categoryScores } from './model.js';

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
  if (!data.event) return html`<${CodeScreen} onCode=${chooseCode} error=${`No event found with code “${code}”.`} />`;
  const me = data.participants.find((p) => p.id === uid);
  if (!me) return html`<${NameScreen} event=${data.event} uid=${uid} onBack=${() => chooseCode('')} />`;
  return html`<${Main} ...${data} me=${me} uid=${uid} onLeave=${() => chooseCode('')} />`;
}

function CodeScreen({ onCode, error }) {
  const [v, setV] = useState('');
  return html`<${DemoBanner} />
    <main class="wrap narrow center-screen">
      <div class="card join">
        <h1>Join the unconference</h1>
        <p class="muted">Enter the event code shown at the front of the room.</p>
        ${error && html`<p class="error">${error}</p>`}
        <form onSubmit=${(e) => (e.preventDefault(), onCode(v))}>
          <input class="big-input" aria-label="Event code" placeholder="event code" value=${v} onInput=${(e) => setV(e.target.value)} autofocus autocapitalize="off" />
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
        <p class="eyebrow">Joining</p>
        <h1>${event.title}</h1>
        ${event.tagline && html`<p class="muted">${event.tagline}</p>`}
        <form onSubmit=${join}>
          <label>Your name<input value=${name} onInput=${(e) => setName(e.target.value)} placeholder="First and last name" required maxlength="60" autofocus /></label>
          ${event.roles?.length > 0 &&
          html`<fieldset class="roles">
            <legend>Your focus (optional)</legend>
            ${event.roles.map(
              (r) => html`<button type="button" class=${role === r ? 'chip on' : 'chip'} onClick=${() => setRole(role === r ? '' : r)}>${r}</button>`
            )}
          </fieldset>`}
          <button class="btn primary block" disabled=${!name.trim()}>Join</button>
        </form>
        <button class="link" onClick=${onBack}>Use a different code</button>
      </div>
    </main>`;
}

function Main({ event, participants, ideas, sessions, me, uid, onLeave }) {
  const phase = event.phase || 'setup';
  const ctx = { event, participants, ideas: ideas.filter((i) => !i.hidden), sessions, me, uid, base: `events/${event.id}` };
  const rename = guard(async () => {
    const n = prompt('Your name', me.name);
    if (n && n.trim()) await (await backend()).update(`${ctx.base}/participants/${uid}`, { name: n.trim() });
  });
  return html`<${DemoBanner} />
    <header class="topbar">
      <div class="wrap topbar-inner">
        <div>
          <div class="ev-title">${event.title}</div>
          <${PhaseBadge} phase=${phase} />
        </div>
        <div class="me">
          <button class="link" onClick=${rename} title="Change name">${me.name}</button>
          <button class="link muted" onClick=${onLeave}>Leave</button>
        </div>
      </div>
    </header>
    <main class="wrap">
      ${phase === 'setup' && html`<${Waiting} event=${event} />`}
      ${phase === 'ideas' && html`<${IdeasPhase} ...${ctx} />`}
      ${phase === 'curate' && html`<${CuratePhase} ...${ctx} />`}
      ${phase === 'vote' && html`<${VotePhase} ...${ctx} />`}
      ${phase === 'schedule' && html`<${SchedulePhase} ...${ctx} />`}
    </main>`;
}

function Waiting({ event }) {
  return html`<div class="card hero">
    <h2>You're in!</h2>
    ${event.tagline && html`<p>${event.tagline}</p>`}
    <p class="muted">When the organizer opens Phase 1, this page switches on its own and you'll be able to:</p>
    <ol class="coming">
      <li><strong>Rank</strong> the big topics</li>
      <li><strong>+1</strong> ideas and <strong>add flavor</strong> to the ones you like</li>
      <li><strong>Suggest</strong> your own session ideas — and offer to lead</li>
    </ol>
    <p class="muted small">Keep this page open. No need to refresh.</p>
  </div>`;
}

// ---------------- Phase 1 ----------------

function IdeasPhase(ctx) {
  const [tab, setTab] = useState(ctx.me.catRank?.length ? 'ideas' : 'rank');
  const mine = ctx.ideas.filter((i) => i.authorUid === ctx.uid).length;
  return html`<div class="intro">
      <h2>Phase 1: Shape the day</h2>
      <p class="muted">Rank the big topics, +1 ideas you like, add flavor, and suggest sessions you'd attend or lead.</p>
    </div>
    <${Tabs}
      active=${tab}
      onChange=${setTab}
      tabs=${[
        { id: 'rank', label: `${ctx.me.catRank?.length ? '✓ ' : ''}Rank topics` },
        { id: 'ideas', label: 'Ideas', count: ctx.ideas.length },
        { id: 'suggest', label: 'Suggest', count: mine || null },
      ]}
    />
    ${tab === 'rank' && html`<${RankCategories} ...${ctx} onDone=${() => setTab('ideas')} />`}
    ${tab === 'ideas' && html`<${IdeasBoard} ...${ctx} canInteract=${true} onSuggest=${() => setTab('suggest')} />`}
    ${tab === 'suggest' && html`<${SuggestForm} ...${ctx} onDone=${() => setTab('ideas')} />`}`;
}

function rankedCategories(event, me) {
  const cats = event.categories || [];
  const ids = new Set(cats.map((c) => c.id));
  const order = (me.catRank || []).filter((id) => ids.has(id));
  for (const c of cats) if (!order.includes(c.id)) order.push(c.id);
  const byId = Object.fromEntries(cats.map((c) => [c.id, c]));
  return order.map((id) => byId[id]);
}

function RankCategories({ event, participants, me, uid, base, onDone }) {
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
  const scores = saved ? categoryScores(event, participants) : [];
  const responses = participants.filter((p) => p.catRank?.length).length;
  return html`<section class="card">
      <h3>What matters most to you?</h3>
      <p class="muted">Drag or use the arrows. #1 = most important to you today.</p>
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
      ${saved
        ? html`<p class="saved">✓ Saved — changes save automatically.</p><button class="btn" onClick=${onDone}>Next: browse ideas →</button>`
        : html`<button class="btn primary" onClick=${() => (save(list), onDone())}>This order looks right</button>`}
    </section>
    ${saved &&
    html`<section class="card">
      <h3>The room so far <span class="muted small">(${responses} ${responses === 1 ? 'response' : 'responses'})</span></h3>
      <${CategoryBars} rows=${scores} />
    </section>`}`;
}

function IdeasBoard({ event, ideas, me, uid, base, canInteract, onSuggest }) {
  const [cat, setCat] = useState('all');
  const [sort, setSort] = useState('popular');
  const cats = Object.fromEntries((event.categories || []).map((c) => [c.id, c]));
  const list = ideas
    .filter((i) => cat === 'all' || i.categoryId === cat)
    .sort((a, b) => (sort === 'popular' ? ideaScore(b) - ideaScore(a) : 0) || (b.createdAt || 0) - (a.createdAt || 0));
  return html`<div class="toolbar">
      <div class="chips">
        <button class=${cat === 'all' ? 'chip on' : 'chip'} onClick=${() => setCat('all')}>All</button>
        ${(event.categories || []).map(
          (c) => html`<button class=${cat === c.id ? 'chip on' : 'chip'} style=${`--c:${c.color}`} onClick=${() => setCat(c.id)}>${c.name}</button>`
        )}
      </div>
      <select aria-label="Sort ideas" value=${sort} onChange=${(e) => setSort(e.target.value)}>
        <option value="popular">Most +1s</option>
        <option value="new">Newest</option>
      </select>
    </div>
    ${list.length === 0 && html`<${Empty}>No ideas here yet.${onSuggest && html` <button class="link" onClick=${onSuggest}>Suggest one</button>`}<//>`}
    <div class="idea-list">
      ${list.map((i) => html`<${IdeaCard} key=${i.id} idea=${i} cat=${cats[i.categoryId]} me=${me} uid=${uid} base=${base} canInteract=${canInteract} />`)}
    </div>`;
}

function IdeaCard({ idea, cat, me, uid, base, canInteract }) {
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
  return html`<article class="idea card" style=${cat ? `--c:${cat.color}` : ''}>
    <div class="idea-head">
      <${CategoryTag} cat=${cat} />
      <span class="muted small">${idea.authorName || 'Organizer'}</span>
    </div>
    <h4>${idea.title}</h4>
    ${idea.description && html`<p>${idea.description}</p>`}
    ${leaders.length > 0 && html`<p class="small leads-line">🙋 Could lead: ${leaders.join(', ')}</p>`}
    <div class="idea-actions">
      <button class=${voted ? 'pill on' : 'pill'} disabled=${!canInteract} aria-pressed=${voted} onClick=${() => patch({ [`upvotes.${uid}`]: voted ? DEL : true })}>
        ▲ ${s.votes}
      </button>
      <button class=${leading ? 'pill on' : 'pill'} disabled=${!canInteract} aria-pressed=${leading} onClick=${() => patch({ [`leads.${uid}`]: leading ? DEL : me.name })}>
        🙋 ${leading ? 'You could lead' : 'I could lead'}
      </button>
      <button class="pill" aria-expanded=${open} onClick=${() => setOpen(!open)}>💬 ${s.comments ? s.comments : ''} ${open ? 'Hide' : 'Add flavor'}</button>
    </div>
    ${open &&
    html`<div class="comments">
      ${(idea.comments || []).map((c) => html`<div class="comment"><strong>${c.name}:</strong> ${c.text}</div>`)}
      ${canInteract &&
      html`<form class="comment-form" onSubmit=${addComment}>
        <input value=${text} onInput=${(e) => setText(e.target.value)} placeholder="What angle or question would you bring?" maxlength="280" aria-label="Add a comment" />
        <button class="btn small" disabled=${!text.trim()}>Add</button>
      </form>`}
    </div>`}
  </article>`;
}

function SuggestForm({ event, ideas, me, uid, base, onDone }) {
  const [categoryId, setCategoryId] = useState(event.categories?.[0]?.id || '');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [lead, setLead] = useState(false);
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
    toast('Idea added — thanks!');
    onDone();
  });

  const addAsFlavor = guard(async (idea) => {
    const p = {
      comments: union({ id: newId(), uid, name: me.name, text: `${title.trim()}${desc.trim() ? ' — ' + desc.trim() : ''}`, at: Date.now() }),
      [`upvotes.${uid}`]: true,
    };
    if (lead) p[`leads.${uid}`] = me.name;
    await (await backend()).update(`${base}/ideas/${idea.id}`, p);
    reset();
    toast('Added to the existing idea');
    onDone();
  });

  return html`<section class="card">
    <h3>Suggest a session idea</h3>
    <p class="muted">Something you'd want to discuss, learn, or lead. Short, specific titles work best.</p>
    <form onSubmit=${submit} class="stack">
      <label>Big topic
        <select value=${categoryId} onChange=${(e) => setCategoryId(e.target.value)}>
          ${(event.categories || []).map((c) => html`<option value=${c.id}>${c.name}</option>`)}
        </select>
      </label>
      <label>Session idea
        <input value=${title} onInput=${(e) => setTitle(e.target.value)} placeholder="e.g. Rolling out MFA for staff without the drama" maxlength="90" required />
      </label>
      <label>Details <span class="muted">(optional)</span>
        <textarea value=${desc} onInput=${(e) => setDesc(e.target.value)} rows="3" maxlength="400" placeholder="What questions should this session answer? What could you share?"></textarea>
      </label>
      <label class="check"><input type="checkbox" checked=${lead} onChange=${(e) => setLead(e.target.checked)} /> I'd be willing to lead or co-lead this</label>
      ${similar.length > 0 &&
      html`<div class="similar">
        <strong>Similar ideas already posted</strong>
        <p class="small muted">Joining forces keeps sessions from splintering. You can add your angle to one of these instead:</p>
        ${similar.map(
          ({ idea }) => html`<div class="similar-item">
            <span>${idea.title}</span>
            <button type="button" class="btn small" onClick=${() => addAsFlavor(idea)}>+1 & add my angle</button>
          </div>`
        )}
      </div>`}
      <button class="btn primary" disabled=${!title.trim() || !categoryId}>${similar.length ? 'Post as a new idea anyway' : 'Post idea'}</button>
    </form>
  </section>`;
}

// ---------------- Curating ----------------

function CuratePhase(ctx) {
  const [tab, setTab] = useState('sessions');
  return html`<div class="banner info">Organizers are combining similar ideas into sessions. Voting opens soon — you can still +1 and comment.</div>
    <${Tabs}
      active=${tab}
      onChange=${setTab}
      tabs=${[
        { id: 'sessions', label: 'Sessions so far', count: ctx.sessions.length },
        { id: 'ideas', label: 'All ideas', count: ctx.ideas.length },
      ]}
    />
    ${tab === 'ideas' && html`<${IdeasBoard} ...${ctx} canInteract=${true} />`}
    ${tab === 'sessions' &&
    html`${ctx.sessions.length === 0 && html`<${Empty}>Sessions will appear here as they're created.<//>`}
      <${SessionList} ...${ctx} readOnly=${true} />`}`;
}

// ---------------- Phase 2 ----------------

function VotePhase(ctx) {
  return html`<div class="intro">
      <h2>Phase 2: Pick your sessions</h2>
      <p class="muted">
        ${ctx.event.voting?.mode === 'dots'
          ? `Spread your ${ctx.event.voting.dots} dots across the sessions you want most. Put several on one if you really want it.`
          : 'Mark each session Must attend, Interested, or Skip. Your “must” picks help us avoid scheduling them at the same time.'}
        ${' '}Tap “I can lead” if you'd lead or co-lead.
      </p>
    </div>
    <${VoteStatus} ...${ctx} />
    <${SessionList} ...${ctx} />`;
}

function VoteStatus({ event, sessions, me }) {
  if (event.voting?.mode === 'dots') {
    const total = Number(event.voting.dots || 0);
    const left = total - dotsUsed(me);
    return html`<div class="sticky-status">
      <span class="dots-left">${Array.from({ length: total }, (_, i) => html`<span class=${i < left ? 'dot' : 'dot used'}></span>`)}</span>
      <strong>${left}</strong> of ${total} dots left
    </div>`;
  }
  const rated = sessions.filter((s) => me.votes?.[s.id]).length;
  return html`<div class="sticky-status">
    <span class="bar small-bar"><span style=${`width:${sessions.length ? (rated / sessions.length) * 100 : 0}%`}></span></span>
    Rated <strong>${rated}</strong> of ${sessions.length}
  </div>`;
}

function SessionList({ event, sessions, ideas, me, uid, base, readOnly }) {
  const cats = event.categories || [];
  const groups = [...cats.map((c) => ({ cat: c, items: sessions.filter((s) => s.categoryId === c.id) }))];
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
  return html`<article class=${`session card ${vote ? 'voted-' + vote : ''} ${dots ? 'has-dots' : ''}`} style=${cat ? `--c:${cat.color}` : ''}>
    <h4>${s.title}</h4>
    ${s.description && html`<p>${s.description}</p>`}
    ${s.leaders?.length > 0 && html`<p class="small leads-line">Led by ${s.leaders.map((l) => l.name).join(', ')}</p>`}
    ${sources.length > 0 &&
    html`<button class="link small" onClick=${() => setShowSrc(!showSrc)}>${showSrc ? 'Hide' : 'Built from'} ${sources.length} idea${sources.length > 1 ? 's' : ''}</button>
      ${showSrc && html`<ul class="sources">${sources.map((i) => html`<li>${i.title}</li>`)}</ul>`}`}
    ${!readOnly &&
    html`<div class="vote-row">
      ${mode === 'dots'
        ? html`<div class="stepper" role="group" aria-label=${`Dots for ${s.title}`}>
            <button class="icon-btn" aria-label="Remove a dot" disabled=${!dots} onClick=${() => patch({ [`dots.${s.id}`]: dots > 1 ? dots - 1 : DEL })}>−</button>
            <span class="dot-count">${dots ? html`${Array.from({ length: dots }, () => html`<span class="dot"></span>`)}` : html`<span class="muted small">0 dots</span>`}</span>
            <button class="icon-btn" aria-label="Add a dot" disabled=${left <= 0} onClick=${() => patch({ [`dots.${s.id}`]: dots + 1 })}>+</button>
          </div>`
        : html`<div class="seg" role="group" aria-label=${`Interest in ${s.title}`}>
            ${INTEREST_LEVELS.map(
              (l) => html`<button class=${vote === l.id ? `seg-btn on ${l.id}` : 'seg-btn'} aria-pressed=${vote === l.id} onClick=${() => patch({ [`votes.${s.id}`]: vote === l.id ? DEL : l.id })}>${l.label}</button>`
            )}
          </div>`}
      <button class=${leading ? 'pill on' : 'pill'} aria-pressed=${leading} onClick=${() => patch({ [`leads.${s.id}`]: leading ? DEL : true })}>🙋 ${leading ? "You'll help lead" : 'I can lead'}</button>
    </div>`}
  </article>`;
}

// ---------------- Schedule ----------------

function SchedulePhase(ctx) {
  const published = ctx.event.schedule?.published;
  const [tab, setTab] = useState('mine');
  if (!published)
    return html`<div class="banner info">The schedule is being finalized. You can still adjust your picks below.</div>
      <${VoteStatus} ...${ctx} />
      <${SessionList} ...${ctx} />`;
  const cells = ctx.event.schedule.cells || {};
  return html`<${Tabs}
      active=${tab}
      onChange=${setTab}
      tabs=${[
        { id: 'mine', label: 'My day' },
        { id: 'all', label: 'Full schedule' },
      ]}
    />
    ${tab === 'mine' && html`<${MyDay} ...${ctx} cells=${cells} />`}
    ${tab === 'all' && html`<${ScheduleGrid} event=${ctx.event} sessions=${ctx.sessions} cells=${cells} mine=${myPicks(ctx, cells)} />`}`;
}

function myPicks({ event, me, sessions }, cells) {
  const out = {};
  for (const row of personalAgenda(event, me, sessions, cells)) if (row.pick) out[row.item.id] = row.pick.session.id;
  return out;
}

function MyDay({ event, me, sessions, cells }) {
  const rows = personalAgenda(event, me, sessions, cells);
  const cats = Object.fromEntries((event.categories || []).map((c) => [c.id, c]));
  return html`<p class="muted">Suggested from your votes. Rooms are open — go wherever is most useful.</p>
    <ol class="myday">
      ${rows.map(
        ({ item, pick, options }) => html`<li class=${`myday-item ${item.kind}`}>
          <div class="sched-time">${fmtTime(item.start)}<span>–${fmtTime(item.end)}</span></div>
          <div class="myday-body">
            ${item.kind !== 'breakout'
              ? html`<strong>${item.label}</strong>`
              : html`<div class="muted small">${item.label}</div>
                  ${pick
                    ? html`<div class="pick" style=${`--c:${cats[pick.session.categoryId]?.color || '#888'}`}>
                        <strong>${pick.session.title}</strong>
                        <span class="room-pill">${pick.room?.name}</span>
                        ${pick.leading && html`<span class="badge lead">You're leading</span>`}
                      </div>`
                    : html`<div class="pick open"><strong>Your choice</strong></div>`}
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

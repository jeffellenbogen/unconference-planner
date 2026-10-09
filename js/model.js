// Pure logic: templates, aggregation, similarity, scheduling.
// No DOM or backend imports so it can be unit-tested with `node --test`.

export const PHASES = [
  { id: 'setup', label: 'Setup', short: 'Getting ready' },
  { id: 'ideas', label: 'Phase 1: Ideas', short: 'Rank & suggest' },
  { id: 'curate', label: 'Curating', short: 'Building sessions' },
  { id: 'vote', label: 'Phase 2: Vote', short: 'Pick sessions' },
  { id: 'schedule', label: 'Schedule', short: 'Your day' },
];

export const CATEGORY_COLORS = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#4d7c0f'];

export const INTEREST_LEVELS = [
  { id: 'must', label: 'Must attend', weight: 3 },
  { id: 'interested', label: 'Interested', weight: 1 },
  { id: 'skip', label: 'Skip', weight: 0 },
];
const INTEREST_WEIGHT = Object.fromEntries(INTEREST_LEVELS.map((l) => [l.id, l.weight]));
const LEADER_CLASH = 1000;

export function uid(len = 8) {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function normalizeCode(code) {
  return String(code || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
}

export function count(obj) {
  return obj ? Object.keys(obj).length : 0;
}

export function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(m).padStart(2, '0')}`;
}

// ---------- Templates ----------

export function techPdTemplate() {
  const cats = [
    { name: 'Cybersecurity', description: 'Protecting people, data, and systems' },
    { name: 'AI in the Classroom', description: 'Teaching and learning with (and about) AI' },
    { name: 'Policy', description: 'Acceptable use, privacy, governance' },
    { name: 'Tech Professional Development', description: 'Helping colleagues grow with technology' },
  ].map((c, i) => ({ id: uid(), color: CATEGORY_COLORS[i], ...c }));
  const seeds = [
    [0, 'Phishing & social engineering training for staff', 'What actually changes behavior? Simulations, short trainings, reporting culture.'],
    [0, 'Student data privacy & vetting edtech vendors', 'DPAs, rostering, what to look for before approving a new tool.'],
    [0, 'Incident response for schools', 'Tabletop exercises and who-does-what when something goes wrong.'],
    [1, 'AI tools for lesson design & feedback', 'Practical workflows teachers are using today.'],
    [1, 'Academic integrity in the age of AI', 'Assessment redesign, detection limits, honest conversations with students.'],
    [1, 'Teaching AI literacy to students', 'How models work, bias, and when (not) to use them.'],
    [2, 'Writing an AI acceptable use policy', 'Share drafts, language that works, how to keep it current.'],
    [2, 'Phones & personal devices', 'Bell-to-bell bans, pouches, BYOD, enforcement.'],
    [3, 'Designing tech PD people actually want', 'Choice, just-in-time support, reaching reluctant adopters.'],
    [3, 'Tech coaching & champion programs', 'Building capacity beyond the tech office.'],
  ].map(([ci, title, description]) => ({ categoryId: cats[ci].id, title, description }));
  return {
    title: 'Tech Educators Unconference',
    tagline: 'Rank the big topics, add your ideas, and help build the day.',
    categories: cats,
    rooms: [
      { id: uid(), name: 'Room A', capacity: 15 },
      { id: uid(), name: 'Room B', capacity: 15 },
    ],
    agenda: [
      { id: uid(), start: '09:00', end: '09:40', label: 'Welcome, intros & idea sprint', kind: 'plenary' },
      { id: uid(), start: '09:40', end: '10:00', label: 'Vote & schedule reveal', kind: 'plenary' },
      { id: uid(), start: '10:00', end: '10:50', label: 'Breakout 1', kind: 'breakout' },
      { id: uid(), start: '10:55', end: '11:45', label: 'Breakout 2', kind: 'breakout' },
      { id: uid(), start: '11:45', end: '12:45', label: 'Lunch', kind: 'plenary' },
      { id: uid(), start: '12:45', end: '13:35', label: 'Breakout 3', kind: 'breakout' },
      { id: uid(), start: '13:40', end: '14:00', label: 'Share-out & wrap-up', kind: 'plenary' },
    ],
    roles: ['Teaching & Learning', 'IT / Infrastructure', 'Leadership', 'Other'],
    voting: { mode: 'interest', dots: 5 },
    seeds,
  };
}

export function blankTemplate() {
  const t = techPdTemplate();
  return {
    ...t,
    title: 'New Unconference',
    categories: [{ id: uid(), name: 'General', description: '', color: CATEGORY_COLORS[0] }],
    seeds: [],
  };
}

export function breakoutSlots(event) {
  return (event.agenda || []).filter((a) => a.kind === 'breakout');
}

// ---------- Phase 1 aggregation ----------

// Borda count: with n categories, a participant's #1 gets n-1 points, last gets 0.
export function categoryScores(event, participants) {
  const cats = event.categories || [];
  const n = cats.length;
  const rows = cats.map((c) => ({ ...c, points: 0, first: 0, voters: 0 }));
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  for (const p of participants) {
    const rank = (p.catRank || []).filter((id) => byId[id]);
    if (!rank.length) continue;
    rank.forEach((id, i) => {
      byId[id].points += n - 1 - i;
      byId[id].voters += 1;
      if (i === 0) byId[id].first += 1;
    });
  }
  const max = Math.max(1, ...rows.map((r) => r.points));
  rows.forEach((r) => (r.pct = r.points / max));
  return rows.sort((a, b) => b.points - a.points || b.first - a.first);
}

export function ideaStats(idea) {
  return { votes: count(idea.upvotes), leads: count(idea.leads), comments: (idea.comments || []).length };
}

export function ideaScore(idea) {
  const s = ideaStats(idea);
  return s.votes + s.leads * 0.5 + s.comments * 0.25;
}

// ---------- Similarity (catch duplicate ideas early) ----------

const STOP = new Set(
  'a an and are as at be but by can do for from how i in into is it its of on or our that the their them this to we what when with you your about using use vs versus'.split(' ')
);

export function tokens(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w))
      .map(stem)
  );
}

function stem(w) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export function similarity(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

const ideaText = (i) => `${i.title} ${i.title} ${i.description || ''}`;

export function findSimilar(text, ideas, threshold = 0.2, limit = 3) {
  return ideas
    .map((i) => ({ idea: i, score: similarity(text, ideaText(i)) }))
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function duplicatePairs(ideas, threshold = 0.25) {
  const pairs = [];
  for (let i = 0; i < ideas.length; i++)
    for (let j = i + 1; j < ideas.length; j++) {
      const s = Math.max(similarity(ideas[i].title, ideas[j].title), similarity(ideaText(ideas[i]), ideaText(ideas[j])));
      if (s >= threshold) pairs.push({ a: ideas[i], b: ideas[j], score: s });
    }
  return pairs.sort((x, y) => y.score - x.score);
}

// ---------- Phase 2 aggregation ----------

// How much participant p wants session sid (0 = not at all).
export function prefWeight(event, p, sid) {
  let w = 0;
  if (event.voting?.mode === 'dots') w = Number(p.dots?.[sid] || 0);
  else w = INTEREST_WEIGHT[p.votes?.[sid]] || 0;
  if (p.leads?.[sid]) w = Math.max(w, 3);
  return w;
}

export function dotsUsed(p) {
  return Object.values(p.dots || {}).reduce((a, b) => a + Number(b || 0), 0);
}

export function sessionDemand(event, participants, sessions) {
  const out = {};
  for (const s of sessions) {
    const d = { score: 0, must: 0, interested: 0, skip: 0, dots: 0, voters: 0, leadOffers: [] };
    for (const p of participants) {
      const v = p.votes?.[s.id];
      if (v && d[v] !== undefined) d[v]++;
      d.dots += Number(p.dots?.[s.id] || 0);
      const w = prefWeight(event, p, s.id);
      if (w > 0) d.voters++;
      d.score += w;
      if (p.leads?.[s.id]) d.leadOffers.push({ uid: p.id, name: p.name });
    }
    out[s.id] = d;
  }
  return out;
}

// ---------- Scheduling ----------

function leaderKeys(session) {
  return (session.leaders || []).map((l) => (l.uid ? `u:${l.uid}` : `n:${String(l.name).trim().toLowerCase()}`));
}

function participantLeads(p, session) {
  return (session.leaders || []).some((l) => (l.uid ? l.uid === p.id : String(l.name).trim().toLowerCase() === String(p.name).trim().toLowerCase()));
}

export function emptyCells(event) {
  const cells = {};
  for (const slot of breakoutSlots(event)) {
    cells[slot.id] = {};
    for (const room of event.rooms || []) cells[slot.id][room.id] = null;
  }
  return cells;
}

// Pairwise conflict: people who want both sessions + hard penalty for shared leaders.
function conflictMatrix(event, participants, sessions) {
  const ids = sessions.map((s) => s.id);
  const W = participants.map((p) => ids.map((id) => prefWeight(event, p, id)));
  const lk = sessions.map(leaderKeys);
  const M = ids.map(() => ids.map(() => 0));
  for (let a = 0; a < ids.length; a++)
    for (let b = a + 1; b < ids.length; b++) {
      let c = 0;
      for (const row of W) c += Math.min(row[a], row[b]);
      if (lk[a].some((k) => lk[b].includes(k))) c += LEADER_CLASH;
      M[a][b] = M[b][a] = c;
    }
  return M;
}

/**
 * Build a schedule: pick the most-wanted sessions, spread them across breakout
 * slots to minimize "I wanted both" conflicts, then put the biggest crowds in
 * the biggest rooms. Locked cells are kept as-is.
 * Returns cells: { [slotId]: { [roomId]: { sid, locked } | null } }
 */
export function buildSchedule(event, participants, sessions, prevCells = null) {
  const slots = breakoutSlots(event);
  const rooms = event.rooms || [];
  const cells = emptyCells(event);
  if (!slots.length || !rooms.length) return cells;

  const sessionIds = new Set(sessions.map((s) => s.id));
  const locked = new Set();
  for (const slot of slots)
    for (const room of rooms) {
      const c = prevCells?.[slot.id]?.[room.id];
      if (c?.locked && sessionIds.has(c.sid)) {
        cells[slot.id][room.id] = { sid: c.sid, locked: true };
        locked.add(c.sid);
      }
    }

  const demand = sessionDemand(event, participants, sessions);
  const idx = Object.fromEntries(sessions.map((s, i) => [s.id, i]));
  const M = conflictMatrix(event, participants, sessions);

  const freeCount = slots.reduce((n, sl) => n + rooms.filter((r) => !cells[sl.id][r.id]).length, 0);
  const candidates = sessions
    .filter((s) => !locked.has(s.id))
    .sort((a, b) => demand[b.id].score - demand[a.id].score || String(a.title).localeCompare(String(b.title)))
    .slice(0, freeCount);

  // slot membership: slotId -> [sid] (locked + chosen)
  const members = Object.fromEntries(slots.map((sl) => [sl.id, rooms.map((r) => cells[sl.id][r.id]?.sid).filter(Boolean)]));
  const capacity = Object.fromEntries(slots.map((sl) => [sl.id, rooms.length]));
  const slotCost = (sid, slotId, exclude = null) =>
    members[slotId].reduce((c, other) => (other === exclude || other === sid ? c : c + M[idx[sid]][idx[other]]), 0);

  // Greedy placement, most-wanted first.
  for (const s of candidates) {
    let best = null;
    for (const sl of slots) {
      if (members[sl.id].length >= capacity[sl.id]) continue;
      const load = members[sl.id].reduce((n, o) => n + demand[o].score, 0);
      const key = [slotCost(s.id, sl.id), members[sl.id].length, load];
      if (!best || key[0] < best.key[0] || (key[0] === best.key[0] && (key[1] < best.key[1] || (key[1] === best.key[1] && key[2] < best.key[2]))))
        best = { slot: sl.id, key };
    }
    if (best) members[best.slot].push(s.id);
  }

  // Hill-climb: swap (or move) unlocked sessions across slots while it helps.
  const improveOnce = () => {
    for (let i = 0; i < slots.length; i++)
      for (let j = 0; j < slots.length; j++) {
        if (i === j) continue;
        const A = slots[i].id;
        const B = slots[j].id;
        for (const a of members[A]) {
          if (locked.has(a)) continue;
          if (members[B].length < capacity[B] && slotCost(a, B) < slotCost(a, A)) {
            members[A] = members[A].filter((x) => x !== a);
            members[B] = [...members[B], a];
            return true;
          }
          if (j < i) continue;
          for (const b of members[B]) {
            if (locked.has(b)) continue;
            if (slotCost(a, B, b) + slotCost(b, A, a) < slotCost(a, A) + slotCost(b, B)) {
              members[A] = members[A].map((x) => (x === a ? b : x));
              members[B] = members[B].map((x) => (x === b ? a : x));
              return true;
            }
          }
        }
      }
    return false;
  };
  for (let iter = 0; iter < 500 && improveOnce(); iter++);

  // Room assignment: biggest expected crowd -> biggest free room.
  for (const sl of slots) {
    const placed = members[sl.id].filter((sid) => !locked.has(sid));
    const est = estimateSlotAttendance(event, participants, sessions, members[sl.id]);
    placed.sort((a, b) => (est[b] || 0) - (est[a] || 0));
    const freeRooms = rooms.filter((r) => !cells[sl.id][r.id]).sort((a, b) => (b.capacity || 0) - (a.capacity || 0));
    placed.forEach((sid, k) => {
      if (freeRooms[k]) cells[sl.id][freeRooms[k].id] = { sid, locked: false };
    });
  }
  return cells;
}

// For one slot's sessions, how many people would pick each one (ties split).
function estimateSlotAttendance(event, participants, sessions, sids) {
  const est = Object.fromEntries(sids.map((s) => [s, 0]));
  const byId = Object.fromEntries(sessions.map((s) => [s.id, s]));
  let undecided = 0;
  for (const p of participants) {
    const leading = sids.filter((sid) => byId[sid] && participantLeads(p, byId[sid]));
    if (leading.length) {
      est[leading[0]] += 1;
      continue;
    }
    let best = 0;
    let picks = [];
    for (const sid of sids) {
      const w = prefWeight(event, p, sid);
      if (w > best) {
        best = w;
        picks = [sid];
      } else if (w === best && w > 0) picks.push(sid);
    }
    if (!picks.length) undecided++;
    else picks.forEach((sid) => (est[sid] += 1 / picks.length));
  }
  est._undecided = undecided;
  return est;
}

export function evaluateSchedule(event, participants, sessions, cells) {
  const slots = breakoutSlots(event);
  const rooms = event.rooms || [];
  const byId = Object.fromEntries(sessions.map((s) => [s.id, s]));
  const attendance = {};
  const conflicts = [];
  const leaderClashes = [];
  const overCapacity = [];
  let missedMust = 0;
  let wantedTotal = 0;
  let wantedGot = 0;
  const scheduled = new Set();

  for (const sl of slots) {
    const sids = rooms.map((r) => cells?.[sl.id]?.[r.id]?.sid).filter((sid) => sid && byId[sid]);
    sids.forEach((s) => scheduled.add(s));
    const est = estimateSlotAttendance(event, participants, sessions, sids);
    attendance[sl.id] = est;
    for (const r of rooms) {
      const sid = cells?.[sl.id]?.[r.id]?.sid;
      if (sid && r.capacity && est[sid] > r.capacity) overCapacity.push({ slotId: sl.id, roomId: r.id, sid, n: Math.round(est[sid]) });
    }
    for (let a = 0; a < sids.length; a++)
      for (let b = a + 1; b < sids.length; b++) {
        const both = participants.filter((p) => prefWeight(event, p, sids[a]) >= 3 && prefWeight(event, p, sids[b]) >= 3);
        if (both.length) conflicts.push({ slotId: sl.id, a: sids[a], b: sids[b], people: both.map((p) => p.name) });
        const shared = leaderKeys(byId[sids[a]]).filter((k) => leaderKeys(byId[sids[b]]).includes(k));
        if (shared.length) leaderClashes.push({ slotId: sl.id, a: sids[a], b: sids[b] });
      }
    for (const p of participants) {
      const musts = sids.filter((sid) => prefWeight(event, p, sid) >= 3).length;
      if (musts > 1) missedMust += musts - 1;
    }
  }
  for (const p of participants)
    for (const s of sessions) {
      if (prefWeight(event, p, s.id) >= 3) {
        wantedTotal++;
        if (scheduled.has(s.id)) wantedGot++;
      }
    }
  return {
    attendance,
    conflicts: conflicts.sort((x, y) => y.people.length - x.people.length),
    leaderClashes,
    overCapacity,
    missedMust,
    unscheduled: sessions.filter((s) => !scheduled.has(s.id)),
    coverage: wantedTotal ? wantedGot / wantedTotal : 1,
  };
}

// Personal agenda: every agenda item, with this person's best pick per breakout.
export function personalAgenda(event, p, sessions, cells) {
  const byId = Object.fromEntries(sessions.map((s) => [s.id, s]));
  const rooms = Object.fromEntries((event.rooms || []).map((r) => [r.id, r]));
  return (event.agenda || []).map((item) => {
    if (item.kind !== 'breakout') return { item };
    const options = Object.entries(cells?.[item.id] || {})
      .filter(([, c]) => c?.sid && byId[c.sid])
      .map(([roomId, c]) => ({ session: byId[c.sid], room: rooms[roomId], weight: prefWeight(event, p, c.sid), leading: participantLeads(p, byId[c.sid]) }));
    const sorted = [...options].sort((a, b) => b.leading - a.leading || b.weight - a.weight);
    const pick = sorted[0] && (sorted[0].leading || sorted[0].weight > 0) ? sorted[0] : null;
    return { item, pick, options: sorted };
  });
}

// ---------- AI-assisted grouping (copy/paste round trip) ----------

export function aiPrompt(event, ideas, targetCount) {
  const cats = Object.fromEntries((event.categories || []).map((c) => [c.id, c.name]));
  const lines = ideas.map((i) => {
    const s = ideaStats(i);
    const flavor = (i.comments || []).map((c) => c.text).join(' | ');
    return `- id: ${i.id} | category: ${cats[i.categoryId] || 'Other'} | votes: ${s.votes} | would lead: ${s.leads}\n  title: ${i.title}${i.description ? `\n  details: ${i.description}` : ''}${flavor ? `\n  comments: ${flavor}` : ''}`;
  });
  return `I'm running an unconference called "${event.title}". Participants suggested the session ideas below. Many overlap.

Group them into about ${targetCount} distinct breakout sessions so we don't run overlapping sessions at the same time. Every idea id should appear in exactly one group. Write a short, clear session title (max ~8 words) and a one-sentence description that captures what people asked for. Weigh ideas with more votes more heavily. Use one of these categories for each group: ${Object.values(cats).join(', ')}.

Respond with ONLY a JSON array, no commentary, in this shape:
[{"title": "...", "description": "...", "category": "...", "ideaIds": ["id1", "id2"]}]

Ideas:
${lines.join('\n')}`;
}

export function parseAiGroups(text, event, ideas) {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error('No JSON array found. Paste the AI response that starts with [ and ends with ].');
  const raw = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(raw)) throw new Error('Expected a JSON array.');
  const ideaIds = new Set(ideas.map((i) => i.id));
  const catByName = Object.fromEntries((event.categories || []).map((c) => [c.name.toLowerCase(), c.id]));
  const catIds = new Set((event.categories || []).map((c) => c.id));
  return raw
    .filter((g) => g && g.title)
    .map((g) => ({
      title: String(g.title).trim(),
      description: String(g.description || '').trim(),
      categoryId: catIds.has(g.category) ? g.category : catByName[String(g.category || '').toLowerCase()] || event.categories?.[0]?.id || null,
      ideaIds: (g.ideaIds || g.ideas || []).map(String).filter((id) => ideaIds.has(id)),
    }));
}

// Leaders suggested from people who said "I could lead" on the source ideas.
export function leadersFromIdeas(ideas) {
  const seen = new Map();
  for (const i of ideas) for (const [u, name] of Object.entries(i.leads || {})) if (!seen.has(u)) seen.set(u, { uid: u, name });
  return [...seen.values()];
}

export function scheduleText(event, sessions, cells) {
  const byId = Object.fromEntries(sessions.map((s) => [s.id, s]));
  const out = [`${event.title}`, ''];
  for (const item of event.agenda || []) {
    out.push(`${fmtTime(item.start)}–${fmtTime(item.end)}  ${item.label}`);
    if (item.kind === 'breakout')
      for (const r of event.rooms || []) {
        const s = byId[cells?.[item.id]?.[r.id]?.sid];
        if (s) out.push(`    ${r.name}: ${s.title}${s.leaders?.length ? ` (${s.leaders.map((l) => l.name).join(', ')})` : ''}`);
      }
  }
  return out.join('\n');
}

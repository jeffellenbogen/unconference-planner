import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  techPdTemplate,
  categoryScores,
  similarity,
  findSimilar,
  duplicatePairs,
  sessionDemand,
  buildSchedule,
  evaluateSchedule,
  personalAgenda,
  parseAiGroups,
  breakoutSlots,
  fmtTime,
  participantStep,
} from '../js/model.js';

function event(mode = 'interest', rooms = 2) {
  const t = techPdTemplate();
  return { ...t, rooms: t.rooms.slice(0, rooms), voting: { mode, dots: 5 } };
}

const S = (id, extra = {}) => ({ id, title: `Session ${id}`, ...extra });

test('category Borda ranking', () => {
  const ev = event();
  const [a, b, c, d] = ev.categories.map((x) => x.id);
  const ps = [
    { id: '1', catRank: [a, b, c, d] },
    { id: '2', catRank: [a, c, b, d] },
    { id: '3', catRank: [c, a, b, d] },
  ];
  const r = categoryScores(ev, ps);
  assert.equal(r[0].id, a);
  assert.equal(r[0].points, 3 + 3 + 2);
  assert.equal(r.at(-1).id, d);
  assert.equal(r[0].first, 2);
});

test('similarity catches near-duplicate ideas', () => {
  assert.ok(similarity('AI policy for students', 'Student AI policies') > 0.5);
  assert.ok(similarity('Phishing training', 'Chromebook management') === 0);
  const ideas = [
    { id: 'x', title: 'Writing an AI acceptable use policy' },
    { id: 'y', title: 'Network segmentation' },
  ];
  const hits = findSimilar('AI use policy template', ideas);
  assert.equal(hits[0].idea.id, 'x');
  assert.equal(duplicatePairs([...ideas, { id: 'z', title: 'AI acceptable use policies' }])[0].score > 0.5, true);
});

test('demand in interest and dots modes', () => {
  const ss = [S('a'), S('b')];
  const ps = [
    { id: '1', votes: { a: 'must', b: 'interested' } },
    { id: '2', votes: { a: 'skip' }, leads: { b: true } },
  ];
  const d = sessionDemand(event('interest'), ps, ss);
  assert.equal(d.a.score, 3);
  assert.equal(d.a.must, 1);
  assert.equal(d.b.score, 1 + 3);
  assert.equal(d.b.leadOffers[0].uid, '2');

  const dd = sessionDemand(event('dots'), [{ id: '1', dots: { a: 4, b: 1 } }], ss);
  assert.equal(dd.a.score, 4);
  assert.equal(dd.b.dots, 1);
});

test('scheduler separates sessions the same people want', () => {
  const ev = event('interest', 2); // 3 slots x 2 rooms
  const ss = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => S(id));
  // Everyone wants a and b; nobody wants g.
  const ps = Array.from({ length: 10 }, (_, i) => ({
    id: String(i),
    name: `P${i}`,
    votes: { a: 'must', b: 'must', c: i < 5 ? 'must' : 'interested', d: 'interested', e: 'interested', f: i % 2 ? 'interested' : 'skip' },
  }));
  const cells = buildSchedule(ev, ps, ss);
  const slots = breakoutSlots(ev);
  const slotOf = {};
  for (const sl of slots) for (const c of Object.values(cells[sl.id])) if (c) slotOf[c.sid] = sl.id;
  assert.equal(Object.keys(slotOf).length, 6, 'fills all 6 cells');
  assert.equal(slotOf.g, undefined, 'least-wanted session left out');
  assert.notEqual(slotOf.a, slotOf.b);
  assert.notEqual(slotOf.a, slotOf.c);
  assert.notEqual(slotOf.b, slotOf.c);
  const ev2 = evaluateSchedule(ev, ps, ss, cells);
  assert.equal(ev2.missedMust, 0);
  assert.equal(ev2.unscheduled.map((s) => s.id).join(), 'g');
});

test('scheduler never puts one leader in two rooms at once', () => {
  const ev = event('interest', 2);
  const ss = [
    S('a', { leaders: [{ uid: 'L', name: 'Lee' }] }),
    S('b', { leaders: [{ uid: 'L', name: 'Lee' }] }),
    S('c'),
    S('d'),
  ];
  const cells = buildSchedule(ev, [], ss);
  const r = evaluateSchedule(ev, [], ss, cells);
  assert.equal(r.leaderClashes.length, 0);
});

test('locked cells survive regeneration', () => {
  const ev = event('interest', 2);
  const [s1] = breakoutSlots(ev);
  const room = ev.rooms[1];
  const ss = ['a', 'b', 'c'].map((id) => S(id));
  const prev = { [s1.id]: { [room.id]: { sid: 'c', locked: true } } };
  const cells = buildSchedule(ev, [{ id: '1', votes: { a: 'must', b: 'must' } }], ss, prev);
  assert.deepEqual(cells[s1.id][room.id], { sid: 'c', locked: true });
});

test('personal agenda picks the highest-rated session per slot', () => {
  const ev = event('interest', 2);
  const [s1] = breakoutSlots(ev);
  const [r1, r2] = ev.rooms;
  const ss = [S('a'), S('b')];
  const cells = { [s1.id]: { [r1.id]: { sid: 'a' }, [r2.id]: { sid: 'b' } } };
  const ag = personalAgenda(ev, { id: '1', votes: { a: 'interested', b: 'must' } }, ss, cells);
  const row = ag.find((x) => x.item.id === s1.id);
  assert.equal(row.pick.session.id, 'b');
  assert.equal(row.pick.room.id, r2.id);
  assert.equal(ag.length, ev.agenda.length);
});

test('AI grouping import is tolerant of surrounding text', () => {
  const ev = event();
  const ideas = [{ id: 'i1' }, { id: 'i2' }];
  const txt = `Sure! Here you go:\n[{"title":"AI Policy","description":"d","category":"policy","ideaIds":["i1","nope"]}]\nHope that helps`;
  const g = parseAiGroups(txt, ev, ideas);
  assert.equal(g.length, 1);
  assert.equal(g[0].categoryId, ev.categories[2].id);
  assert.deepEqual(g[0].ideaIds, ['i1']);
});

test('time formatting', () => {
  assert.equal(fmtTime('13:05'), '1:05');
  assert.equal(fmtTime('09:00'), '9:00');
  assert.equal(fmtTime('12:30'), '12:30');
});

test('participant step follows the organizer phase', () => {
  const at = (phase, published) => participantStep({ phase, schedule: { published } });
  assert.deepEqual(at('setup'), { step: 1, state: 'next' });
  assert.deepEqual(at('ideas'), { step: 1, state: 'now' });
  assert.deepEqual(at('curate'), { step: 2, state: 'next' });
  assert.deepEqual(at('vote'), { step: 2, state: 'now' });
  assert.deepEqual(at('schedule', false), { step: 3, state: 'next' });
  assert.deepEqual(at('schedule', true), { step: 3, state: 'now' });
});

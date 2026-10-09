import { html, render, useState, useEffect, useMemo, useRef, useCallback } from '../vendor/preact-htm.module.js';
import { backend, DEMO } from './backend.js';
import { PHASES, fmtTime } from './model.js';

export { html, render, useState, useEffect, useMemo, useRef, useCallback };

// Live event data. A listener that errors (e.g. a read sent just before sign-in
// finished) is dead, so resubscribe a few times before showing the error.
export function useEventData(eventId) {
  const [state, setState] = useState({ loading: true });
  const [attempt, setAttempt] = useState({ n: 0, eventId });
  const tries = attempt.eventId === eventId ? attempt.n : 0;
  useEffect(() => {
    if (!eventId) return;
    let unsub = () => {};
    let alive = true;
    let timer;
    setState({ loading: true });
    backend().then((b) => {
      if (!alive) return;
      unsub = b.watchEvent(eventId, (d) => {
        if (!alive) return;
        if (d.error && tries < 3) {
          alive = false;
          unsub();
          timer = setTimeout(() => setAttempt({ n: tries + 1, eventId }), 800 * 2 ** tries);
          return;
        }
        setState({ loading: false, ...d });
      });
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      unsub();
    };
  }, [eventId, tries, attempt]);
  return { ...state, retry: () => setAttempt({ n: 0, eventId }) };
}

export function LoadError({ code, error, onRetry, onBack }) {
  return html`<main class="wrap narrow center-screen">
    <div class="card join">
      <h1>Couldn't load “${code}”</h1>
      <p class="muted">Check your Wi-Fi and try again. If it keeps happening, let the organizer know.</p>
      <p class="small muted">${error}</p>
      <button class="btn primary block" onClick=${onRetry}>Try again</button>
      ${onBack && html`<button class="link" onClick=${onBack}>Use a different code</button>`}
    </div>
  </main>`;
}

let toastTimer;
export function toast(msg, kind = 'ok') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), 2600);
}

export async function copyText(text, msg = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg);
  } catch {
    window.prompt('Copy this:', text);
  }
}

// Wrap async handlers: shows errors as a toast instead of failing silently.
export function guard(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      console.error(e);
      toast(e.message || String(e), 'err');
    }
  };
}

export const phaseInfo = (id) => PHASES.find((p) => p.id === id) || PHASES[0];

export function PhaseBadge({ phase }) {
  return html`<span class="badge phase-${phase}">${phaseInfo(phase).label}</span>`;
}

export function CategoryTag({ cat }) {
  if (!cat) return null;
  return html`<span class="tag" style=${`--c:${cat.color}`}>${cat.name}</span>`;
}

export function Tabs({ tabs, active, onChange }) {
  return html`<nav class="tabs" role="tablist">
    ${tabs.map(
      (t) => html`<button role="tab" aria-selected=${active === t.id} class=${active === t.id ? 'tab active' : 'tab'} onClick=${() => onChange(t.id)}>
        ${t.label}${t.count != null ? html` <span class="count">${t.count}</span>` : ''}
      </button>`
    )}
  </nav>`;
}

export function DemoBanner() {
  if (!DEMO) return null;
  return html`<div class="demo-banner">Demo mode — data stays in this browser. Add your Firebase config in <code>js/config.js</code> to go live.</div>`;
}

export function Empty({ children }) {
  return html`<div class="empty">${children}</div>`;
}

// Agenda with the room grid for breakout slots. `mine` = { [slotId]: sessionId } to highlight.
export function ScheduleGrid({ event, sessions, cells, mine = {}, big = false }) {
  const byId = Object.fromEntries(sessions.map((s) => [s.id, s]));
  const cats = Object.fromEntries((event.categories || []).map((c) => [c.id, c]));
  const rooms = event.rooms || [];
  return html`<div class=${big ? 'sched big' : 'sched'}>
    ${(event.agenda || []).map(
      (item) => html`<div class=${`sched-row ${item.kind}`}>
        <div class="sched-time">${fmtTime(item.start)}<span>–${fmtTime(item.end)}</span></div>
        ${item.kind !== 'breakout'
          ? html`<div class="sched-plenary">${item.label}</div>`
          : html`<div class="sched-rooms" style=${`--n:${rooms.length}`}>
              ${rooms.map((r) => {
                const s = byId[cells?.[item.id]?.[r.id]?.sid];
                const cat = s && cats[s.categoryId];
                return html`<div class=${`sched-cell${s && mine[item.id] === s.id ? ' mine' : ''}${s ? '' : ' open'}`} style=${cat ? `--c:${cat.color}` : ''}>
                  <div class="room">${r.name}</div>
                  ${s
                    ? html`<div class="title">${s.title}</div>
                        ${s.leaders?.length ? html`<div class="leaders">${s.leaders.map((l) => l.name).join(', ')}</div>` : ''}`
                    : html`<div class="title muted">Open</div>`}
                </div>`;
              })}
            </div>`}
      </div>`
    )}
  </div>`;
}

export function mount(App) {
  const el = document.getElementById('app');
  el.textContent = '';
  render(html`<${App} />`, el);
}

export function getParam(name) {
  return new URLSearchParams(location.search).get(name);
}

export function setParam(name, value) {
  const u = new URL(location.href);
  if (value) u.searchParams.set(name, value);
  else u.searchParams.delete(name);
  history.replaceState(null, '', u);
}

export function siteUrl(page, code) {
  const u = new URL(page, location.href);
  u.search = code ? `?code=${encodeURIComponent(code)}` : '';
  return u.toString();
}

export function CategoryBars({ rows }) {
  return html`<div class="bars">
    ${rows.map(
      (r) => html`<div class="bar-row">
        <span class="bar-label">${r.name}</span>
        <span class="bar"><span style=${`width:${Math.max(2, r.pct * 100)}%;background:${r.color}`}></span></span>
        <span class="bar-val">${r.points}</span>
      </div>`
    )}
  </div>`;
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return html`<div class="modal-back" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class=${wide ? 'modal wide' : 'modal'} role="dialog" aria-modal="true" aria-label=${title}>
      <div class="modal-head"><h3>${title}</h3><button class="icon-btn" aria-label="Close" onClick=${onClose}>✕</button></div>
      ${children}
    </div>
  </div>`;
}

// Needs vendor/qrcode.js loaded as a classic <script> on the page.
export function QR({ text, size = 4 }) {
  const svg = useMemo(() => {
    if (!window.qrcode || !text) return '';
    const q = window.qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: size, margin: 2, scalable: true });
  }, [text, size]);
  return html`<div class="qr" dangerouslySetInnerHTML=${{ __html: svg }}></div>`;
}

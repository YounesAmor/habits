import * as store from './store.js';

const $ = id => document.getElementById(id);
const CACHE_KEY = 'habits.cache.v1'; // last data seen, so the app opens instantly / offline
const GREETED_KEY = 'habits.greeted';  // day we last showed the "keep your streak" nudge

// habits: array; done: Map<habitId, Set<'YYYY-MM-DD'>>
const state = { habits: [], done: new Map() };

// ---------- dates (always local time) ----------
const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
const monthName = (m, style = 'short') => new Date(2000, m, 1).toLocaleDateString(undefined, { month: style });

// ---------- schedules ----------
// `days` is a 7-char mask, Monday first: '1111111' = every day, '1111100' = weekdays.
const EVERY_DAY = '1111111', WEEKDAYS = '1111100';
const daysOf = h => (/^[01]{7}$/.test(h.days ?? '') && h.days !== '0000000' ? h.days : EVERY_DAY);
const weekdayIdx = d => (d.getDay() + 6) % 7; // Mon = 0
const isDue = (h, d) => daysOf(h)[weekdayIdx(d)] === '1';
const scheduleLabel = h => {
  const m = daysOf(h);
  if (m === EVERY_DAY) return '';
  if (m === WEEKDAYS) return 'Weekdays';
  if (m === '0000011') return 'Weekends';
  return [...m].map((c, i) => (c === '1' ? DAY_NAMES[i] : '')).join(' ').replace(/\s+/g, ' ').trim();
};
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ---------- streaks ----------
const doneSet = id => state.done.get(id) ?? state.done.set(id, new Set()).get(id);
const firstDay = set => (set.size ? fromKey([...set].sort()[0]) : null);
const createdDay = h => (h.created_at ? fromKey(keyOf(new Date(h.created_at))) : today());

// Days the habit isn't scheduled (e.g. weekends for a weekday habit) never break a streak;
// doing it anyway on such a day still counts. Today never breaks it either — you still have time.
function currentStreak(h) {
  const set = doneSet(h.id), floor = firstDay(set);
  if (!floor) return 0;
  let d = today(), n = 0;
  if (!set.has(keyOf(d))) d = addDays(d, -1);
  for (; d >= floor; d = addDays(d, -1)) {
    if (set.has(keyOf(d))) n++;
    else if (isDue(h, d)) break;
  }
  return n;
}
function bestStreak(h) {
  const set = doneSet(h.id), floor = firstDay(set);
  if (!floor) return 0;
  const t = today();
  let best = 0, run = 0;
  for (let d = floor; d <= t; d = addDays(d, 1)) {
    if (set.has(keyOf(d))) best = Math.max(best, ++run);
    else if (isDue(h, d) && d < t) run = 0;
  }
  return best;
}

// Completion over [from, to]: scheduled days done / scheduled days, ignoring days before the
// habit existed and days in the future.
function tally(h, from, to) {
  const set = doneSet(h.id);
  const start = [createdDay(h), firstDay(set) ?? today()].reduce((a, b) => (a < b ? a : b));
  const end = to < today() ? to : today();
  let due = 0, hits = 0;
  for (let d = from > start ? from : start; d <= end; d = addDays(d, 1)) {
    if (!isDue(h, d)) continue;
    due++;
    if (set.has(keyOf(d))) hits++;
  }
  return { due, hits };
}
const pct = ({ due, hits }) => (due ? Math.round((hits / due) * 100) : null);
function tallyAll(habits, from, to) {
  return habits.reduce((acc, h) => { const t = tally(h, from, to); acc.due += t.due; acc.hits += t.hits; return acc; }, { due: 0, hits: 0 });
}

// ---------- data ----------
function applyData({ habits, checkins }) {
  state.habits = habits;
  state.done = new Map();
  for (const c of checkins) doneSet(c.habit_id).add(c.day);
}
function snapshot() {
  const checkins = [];
  for (const [habit_id, set] of state.done) for (const day of set) checkins.push({ habit_id, day });
  return { habits: state.habits, checkins };
}
function saveCache() { localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot())); }

async function refresh() {
  try {
    applyData(await store.loadAll());
    saveCache();
  } catch (e) {
    toast(`Offline? Showing saved data. (${e.message})`);
  }
  render();
}

// Optimistic update: change the UI first, roll back if the save fails.
async function toggle(habitId, day) {
  const set = doneSet(habitId);
  const on = !set.has(day);
  on ? set.add(day) : set.delete(day);
  navigator.vibrate?.(10);
  render(); saveCache();
  if (on && day === keyOf(today())) celebrate(state.habits.find(h => h.id === habitId));
  try {
    await store.setCheckin(habitId, day, on);
  } catch (e) {
    on ? set.delete(day) : set.add(day);
    render(); saveCache();
    toast(`Couldn't save: ${e.message}`);
  }
}

// ---------- rendering ----------
function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const activeHabits = () => state.habits.filter(h => !h.archived);
const dueToday = () => activeHabits().filter(h => isDue(h, today()));

function render() {
  const t = today(), tk = keyOf(t);
  $('date').textContent = t.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const active = activeHabits();
  const archived = state.habits.filter(h => h.archived);
  const due = dueToday();
  const doneCount = due.filter(h => doneSet(h.id).has(tk)).length;

  $('summary').textContent = !active.length ? ''
    : !due.length ? 'Nothing scheduled today — enjoy the rest 😌'
    : doneCount === due.length ? `All ${due.length} done today 🎉`
    : `${doneCount} of ${due.length} done today`;
  $('progress-bar').style.width = due.length ? `${(doneCount / due.length) * 100}%` : '0';

  $('list').replaceChildren(...(active.length ? active.map(card) : [el('p', { className: 'empty', textContent: 'No habits yet. Tap + to add one.' })]));
  $('archived').hidden = !archived.length;
  $('archived').querySelector('summary').textContent = `Archived (${archived.length})`;
  $('archived-list').replaceChildren(...archived.map(card));

  if ($('detail-dialog').open) renderDetail();
  if ($('insights-dialog').open) renderInsights();
}

const COLORS = ['#34c77b', '#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#eab308', '#14b8a6', '#ef4444'];
const colorOf = h => h.color || COLORS[0];
const CARD_WEEKS = 26;

// Monday-first weeks ending with the current week; future days are hidden,
// days the habit isn't scheduled are drawn as "off" so they don't look like misses.
function gridCells(h, weeks, cellTag, onCell) {
  const set = doneSet(h.id);
  const t = today(), tk = keyOf(t);
  const start = addDays(t, -weekdayIdx(t) - 7 * (weeks - 1));
  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i), k = keyOf(d);
    const future = d > t;
    cells.push(el(cellTag, {
      className: [set.has(k) && 'on', !isDue(h, d) && 'off', k === tk && 'today', future && 'future'].filter(Boolean).join(' '),
      title: d.toDateString(),
      ...(onCell && { disabled: future, onclick: () => onCell(k) }),
    }));
  }
  return cells;
}

function card(h) {
  const set = doneSet(h.id);
  const t = today(), tk = keyOf(t);
  const cur = currentStreak(h), best = bestStreak(h);
  const sched = scheduleLabel(h);
  const rest = !isDue(h, t) && !set.has(tk);

  const meta = [cur ? `🔥 ${cur} day streak` : null, `best ${best}`, rest ? 'rest day' : sched || null].filter(Boolean).join(' · ');

  const grid = el('div', { className: 'grid', onclick: () => openDetail(h.id) });
  grid.style.setProperty('--weeks', CARD_WEEKS);
  grid.append(...gridCells(h, CARD_WEEKS, 'i'));

  const node = el('article', { className: `habit${set.has(tk) ? ' done' : ''}${rest ? ' rest' : ''}` },
    el('div', { className: 'habit-top' },
      el('button', { className: 'info', onclick: () => openDetail(h.id) },
        el('span', { className: 'tile', textContent: h.emoji || '✅' }),
        el('span', { className: 'text' },
          el('span', { className: 'name', textContent: h.name }),
          el('span', { className: 'meta', textContent: meta }),
        ),
      ),
      el('button', { className: 'check', textContent: '✓', ariaLabel: `Mark ${h.name} done today`, ariaPressed: String(set.has(tk)), onclick: () => toggle(h.id, tk) }),
    ),
    grid,
  );
  node.style.setProperty('--c', colorOf(h));
  return node;
}

// ---------- celebrations ----------
const CHEERS = [
  'Keep it going!', 'Nice work!', 'You showed up again 💪', 'Consistency wins.', 'Another one in the bag!',
  "Don't break the chain!", 'Future you says thanks.', 'On fire!', 'Small steps, big results.', 'Unstoppable.',
];
const MILESTONES = { 3: 'Three in a row!', 7: 'One full week! 🏆', 14: 'Two weeks strong! 🏆', 21: '21 days — it’s a habit now! 🏆', 30: 'A whole month! 🏆', 50: '50 days! Legendary 🏆', 75: '75 days! 🏆', 100: '💯 100 days!! 🏆', 150: '150 days! 🏆', 200: '200 days! 🏆', 365: 'ONE YEAR! 👑' };
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

let celebrateTimer;
function celebrate(h) {
  if (!h) return;
  const n = currentStreak(h);
  const due = dueToday();
  const perfect = due.length > 1 && due.every(x => doneSet(x.id).has(keyOf(today())));
  const milestone = MILESTONES[n];

  $('c-emoji').textContent = perfect ? '🎉' : milestone ? '🏆' : '🔥';
  $('c-count').textContent = perfect ? 'Perfect day!' : `${n} day streak`;
  $('c-msg').textContent = perfect ? `All ${due.length} habits done today. You're crushing it.` : milestone || `${h.emoji || ''} ${h.name} — ${pick(CHEERS)}`;

  const box = $('celebrate');
  box.style.setProperty('--c', colorOf(h));
  box.classList.toggle('big', Boolean(perfect || milestone));
  box.hidden = false;
  box.classList.remove('show'); void box.offsetWidth; box.classList.add('show');
  navigator.vibrate?.(perfect || milestone ? [20, 60, 20, 60, 40] : [15, 40, 15]);
  if (perfect || milestone) confetti();

  clearTimeout(celebrateTimer);
  celebrateTimer = setTimeout(() => (box.hidden = true), perfect || milestone ? 3200 : 2200);
}

function confetti() {
  const layer = $('confetti');
  layer.replaceChildren(...Array.from({ length: 36 }, () => {
    const p = el('i');
    p.style.setProperty('--x', `${(Math.random() - 0.5) * 340}px`);
    p.style.setProperty('--y', `${-160 - Math.random() * 260}px`);
    p.style.setProperty('--r', `${Math.random() * 720 - 360}deg`);
    p.style.setProperty('--d', `${0.9 + Math.random() * 0.8}s`);
    p.style.background = pick(COLORS);
    return p;
  }));
  setTimeout(() => layer.replaceChildren(), 1800);
}

// Once a day, when you open the app: nudge you about the streak most at risk.
function greet() {
  const tk = keyOf(today());
  if (localStorage.getItem(GREETED_KEY) === tk) return;
  localStorage.setItem(GREETED_KEY, tk);
  const pending = dueToday().filter(h => !doneSet(h.id).has(tk));
  if (!pending.length) return;
  const top = pending.map(h => ({ h, n: currentStreak(h) })).sort((a, b) => b.n - a.n)[0];
  toast(top.n
    ? `🔥 Your ${top.n}-day ${top.h.name} streak is on the line today. Keep it alive!`
    : `👋 Welcome back! ${pending.length} habit${pending.length > 1 ? 's' : ''} to go today.`, 4500);
}

// ---------- detail dialog ----------
let detailId = null;
function openDetail(id) {
  detailId = id;
  renderDetail();
  $('detail-dialog').showModal();
}
function renderDetail() {
  const h = state.habits.find(x => x.id === detailId);
  if (!h) return $('detail-dialog').close();
  const set = doneSet(h.id);
  const t = today();
  $('d-emoji').textContent = h.emoji || '✅';
  $('d-name').textContent = h.name;
  $('d-schedule').textContent = scheduleLabel(h) || 'Every day';
  $('d-current').textContent = currentStreak(h);
  $('d-best').textContent = bestStreak(h);
  $('d-total').textContent = set.size;
  $('d-rate').textContent = `${pct(tally(h, addDays(t, -29), t)) ?? 0}%`;
  $('d-archive').textContent = h.archived ? 'Unarchive' : 'Archive';
  $('detail-dialog').style.setProperty('--c', colorOf(h));
  $('d-heatmap').replaceChildren(...gridCells(h, 16, 'button', k => toggle(h.id, k)));
}

// ---------- insights ----------
const fmtPct = v => (v == null ? '—' : `${v}%`);
function delta(now, before, unit = 'pts') {
  if (now == null || before == null) return el('span', { className: 'delta flat', textContent: 'no data to compare' });
  const d = now - before;
  if (d === 0) return el('span', { className: 'delta flat', textContent: `same as before` });
  return el('span', { className: `delta ${d > 0 ? 'up' : 'down'}`, textContent: `${d > 0 ? '▲' : '▼'} ${Math.abs(d)} ${unit}` });
}

function renderInsights() {
  const t = today(), y = t.getFullYear(), m = t.getMonth();
  const habits = activeHabits();
  const monthStart = new Date(y, m, 1), lastMonthStart = new Date(y, m - 1, 1), lastMonthEnd = new Date(y, m, 0);
  // Year over year compares the same stretch of the calendar: Jan 1 → today vs Jan 1 → same date last year.
  const yearStart = new Date(y, 0, 1), lastYearStart = new Date(y - 1, 0, 1), lastYearSameDay = new Date(y - 1, m, t.getDate());

  const thisMonth = pct(tallyAll(habits, monthStart, t));
  const lastMonth = pct(tallyAll(habits, lastMonthStart, lastMonthEnd));
  const thisYear = pct(tallyAll(habits, yearStart, t));
  const lastYear = pct(tallyAll(habits, lastYearStart, lastYearSameDay));

  let checkinsThisMonth = 0;
  for (const h of habits) for (const k of doneSet(h.id)) if (fromKey(k) >= monthStart) checkinsThisMonth++;

  let perfectDays = 0;
  for (let d = monthStart; d <= t; d = addDays(d, 1)) {
    const due = habits.filter(h => isDue(h, d) && createdDay(h) <= d);
    if (due.length && due.every(h => doneSet(h.id).has(keyOf(d)))) perfectDays++;
  }

  $('i-month').textContent = fmtPct(thisMonth);
  $('i-month-delta').replaceChildren(delta(thisMonth, lastMonth), ` vs ${monthName(lastMonthStart.getMonth(), 'long')}`);
  $('i-year').textContent = fmtPct(thisYear);
  $('i-year-delta').replaceChildren(delta(thisYear, lastYear), ` vs ${y - 1} so far`);
  $('i-checkins').textContent = checkinsThisMonth;
  $('i-perfect').textContent = perfectDays;
  $('i-month-label').textContent = monthName(m, 'long');

  // Month by month, this year vs last year.
  $('i-legend-now').textContent = y;
  $('i-legend-prev').textContent = y - 1;
  const months = Array.from({ length: 12 }, (_, i) => ({
    i,
    now: i <= m ? pct(tallyAll(habits, new Date(y, i, 1), new Date(y, i + 1, 0))) : null,
    prev: pct(tallyAll(habits, new Date(y - 1, i, 1), new Date(y - 1, i + 1, 0))),
  }));
  const readout = $('i-readout');
  const showMonth = mo => {
    readout.textContent = `${monthName(mo.i, 'long')}: ${y} ${fmtPct(mo.now)} · ${y - 1} ${fmtPct(mo.prev)}`;
    $('i-chart').querySelectorAll('.col').forEach((c, i) => c.classList.toggle('sel', i === mo.i));
  };
  $('i-chart').replaceChildren(...months.map(mo => el('button', {
    className: `col${mo.i === m ? ' current' : ''}`,
    ariaLabel: `${monthName(mo.i, 'long')}: ${fmtPct(mo.now)} this year, ${fmtPct(mo.prev)} last year`,
    onclick: () => showMonth(mo),
  },
    el('span', { className: 'bars' },
      Object.assign(el('i', { className: 'prev' }), { style: `height:${mo.prev ?? 0}%` }),
      Object.assign(el('i', { className: 'now' }), { style: `height:${mo.now ?? 0}%` }),
    ),
    el('span', { className: 'lbl', textContent: monthName(mo.i, 'narrow') }),
  )));
  showMonth(months[m]);

  // Per habit: this month vs last month.
  $('i-habits').replaceChildren(...(habits.length ? habits.map(h => {
    const now = pct(tally(h, monthStart, t)), before = pct(tally(h, lastMonthStart, lastMonthEnd));
    const row = el('div', { className: 'h-row' },
      el('span', { className: 'h-name' }, el('span', { textContent: `${h.emoji || '✅'} ` }), el('span', { textContent: h.name })),
      el('span', { className: 'h-bar' }, Object.assign(el('i'), { style: `width:${now ?? 0}%` })),
      el('span', { className: 'h-val', textContent: fmtPct(now) }),
      delta(now, before),
    );
    row.style.setProperty('--c', colorOf(h));
    return row;
  }) : [el('p', { className: 'hint', textContent: 'Add a habit to see insights.' })]));

  // Weekday strength over the last 12 weeks.
  const from = addDays(t, -83);
  const byDay = Array.from({ length: 7 }, () => ({ due: 0, hits: 0 }));
  for (const h of habits) for (let d = from; d <= t; d = addDays(d, 1)) {
    if (!isDue(h, d) || d < createdDay(h)) continue;
    const w = byDay[weekdayIdx(d)];
    w.due++; if (doneSet(h.id).has(keyOf(d))) w.hits++;
  }
  const rates = byDay.map(pct);
  const top = Math.max(...rates.filter(v => v != null));
  $('i-weekdays').replaceChildren(...rates.map((v, i) => el('div', { className: `wd${v === top && v != null ? ' best' : ''}` },
    el('span', { className: 'wd-val', textContent: fmtPct(v) }),
    el('span', { className: 'wd-track' }, Object.assign(el('i'), { style: `height:${v ?? 0}%` })),
    el('span', { className: 'lbl', textContent: DAY_NAMES[i].slice(0, 2) }),
  )));
}

// ---------- add / edit dialog ----------
let editingId = null;
let pickedColor = COLORS[0];
let pickedDays = EVERY_DAY;
function renderSwatches() {
  $('swatches').replaceChildren(...COLORS.map(c => {
    const b = el('button', { type: 'button', role: 'radio', ariaChecked: String(c === pickedColor), ariaLabel: c, onclick: () => { pickedColor = c; renderSwatches(); } });
    b.style.setProperty('--c', c);
    return b;
  }));
}
function renderDays() {
  $('day-picker').replaceChildren(...DAY_NAMES.map((name, i) => el('button', {
    type: 'button', textContent: name[0], ariaLabel: name, ariaPressed: String(pickedDays[i] === '1'),
    onclick: () => {
      const next = [...pickedDays]; next[i] = next[i] === '1' ? '0' : '1';
      if (next.includes('1')) { pickedDays = next.join(''); renderDays(); }
    },
  })));
  document.querySelectorAll('[data-days]').forEach(b => b.classList.toggle('sel', b.dataset.days === pickedDays));
}
document.querySelectorAll('[data-days]').forEach(b => (b.onclick = () => { pickedDays = b.dataset.days; renderDays(); }));

function openEdit(id = null) {
  editingId = id;
  const h = state.habits.find(x => x.id === id);
  const f = $('edit-form');
  $('edit-title').textContent = h ? 'Edit habit' : 'New habit';
  f.name.value = h?.name ?? '';
  f.emoji.value = h?.emoji ?? '';
  pickedColor = h ? colorOf(h) : COLORS[state.habits.length % COLORS.length];
  pickedDays = h ? daysOf(h) : EVERY_DAY;
  renderSwatches(); renderDays();
  $('edit-dialog').showModal();
  f.name.focus();
}
$('edit-dialog').addEventListener('close', async () => {
  if ($('edit-dialog').returnValue !== 'save') return;
  const f = $('edit-form');
  const name = f.name.value.trim(), emoji = f.emoji.value.trim() || '✅', color = pickedColor, days = pickedDays;
  if (!name) return;
  try {
    if (editingId) {
      await store.updateHabit(editingId, { name, emoji, color, days });
      Object.assign(state.habits.find(h => h.id === editingId), { name, emoji, color, days });
    } else {
      state.habits.push(await store.addHabit({ name, emoji, color, days }));
    }
    saveCache(); render();
  } catch (e) { toast(`Couldn't save: ${e.message}`); }
});

// ---------- wiring ----------
$('add-btn').onclick = () => openEdit();
$('edit-cancel').onclick = () => $('edit-dialog').close('cancel');
$('insights-btn').onclick = () => { renderInsights(); $('insights-dialog').showModal(); };
$('i-close').onclick = () => $('insights-dialog').close();
$('d-close').onclick = () => $('detail-dialog').close();
$('d-edit').onclick = () => { $('detail-dialog').close(); openEdit(detailId); };
$('d-archive').onclick = async () => {
  const h = state.habits.find(x => x.id === detailId);
  try {
    await store.updateHabit(h.id, { archived: !h.archived });
    h.archived = !h.archived;
    saveCache(); render();
    $('detail-dialog').close();
  } catch (e) { toast(`Couldn't save: ${e.message}`); }
};
$('d-delete').onclick = async () => {
  const h = state.habits.find(x => x.id === detailId);
  if (!confirm(`Delete "${h.name}" and all its history? (Archive keeps the history.)`)) return;
  try {
    await store.deleteHabit(h.id);
    state.habits = state.habits.filter(x => x.id !== h.id);
    state.done.delete(h.id);
    saveCache(); render();
    $('detail-dialog').close();
  } catch (e) { toast(`Couldn't delete: ${e.message}`); }
};

$('menu-btn').onclick = async () => {
  const user = await store.getUser();
  $('m-account').textContent = store.isCloud ? `Signed in as ${user?.email}` : 'Local mode — data lives on this device only.';
  $('m-signout').hidden = !store.isCloud;
  $('m-refresh').hidden = !store.isCloud;
  $('menu-dialog').showModal();
};
$('m-close').onclick = () => $('menu-dialog').close();
$('m-refresh').onclick = async () => { $('menu-dialog').close(); await refresh(); toast('Reloaded'); };
$('m-export').onclick = () => {
  const blob = new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' });
  el('a', { href: URL.createObjectURL(blob), download: `habits-${keyOf(today())}.json` }).click();
};
$('m-signout').onclick = async () => {
  await store.signOut();
  localStorage.removeItem(CACHE_KEY);
  location.reload();
};

$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  $('login-error').textContent = '';
  try {
    await store.signIn(f.email.value, f.password.value);
    showApp();
  } catch (err) { $('login-error').textContent = err.message; }
});

// Re-sync and roll over to a new day when you come back to the app.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && !$('app').hidden) { await refresh(); greet(); }
});

let toastTimer;
function toast(msg, ms = 3000) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

async function showApp() {
  $('login').hidden = true;
  $('app').hidden = false;
  $('local-banner').hidden = store.isCloud;
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) { applyData(JSON.parse(cached)); render(); }
  await refresh();
  greet();
}

async function start() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
  try {
    await store.init();
  } catch {
    // No network on first load of the Supabase library: fall back to the cached data.
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) { $('app').hidden = false; applyData(JSON.parse(cached)); render(); toast('Offline — read-only'); return; }
  }
  if (await store.getUser()) showApp();
  else $('login').hidden = false;
}
start();

import * as store from './store.js';

const $ = id => document.getElementById(id);
const CACHE_KEY = 'habits.cache.v1'; // last data seen, so the app opens instantly / offline

// habits: array; done: Map<habitId, Set<'YYYY-MM-DD'>>
const state = { habits: [], done: new Map() };

// ---------- dates (always local time) ----------
const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };

// ---------- streaks ----------
const doneSet = id => state.done.get(id) ?? state.done.set(id, new Set()).get(id);

// A streak stays alive until the end of today: if today isn't done yet, count from yesterday.
function currentStreak(set) {
  let d = today();
  if (!set.has(keyOf(d))) d = addDays(d, -1);
  let n = 0;
  while (set.has(keyOf(d))) { n++; d = addDays(d, -1); }
  return n;
}
function bestStreak(set) {
  let best = 0, run = 0, prev = null;
  for (const k of [...set].sort()) {
    run = prev && keyOf(addDays(prev, 1)) === k ? run + 1 : 1;
    best = Math.max(best, run);
    prev = fromKey(k);
  }
  return best;
}
function last30Rate(set, habit) {
  const t = today();
  const created = habit.created_at ? fromKey(keyOf(new Date(habit.created_at))) : t;
  let days = 0, hits = 0;
  for (let i = 0; i < 30; i++) {
    const d = addDays(t, -i);
    if (d < created && !set.has(keyOf(d))) continue; // don't penalise days before the habit existed
    days++;
    if (set.has(keyOf(d))) hits++;
  }
  return days ? Math.round((hits / days) * 100) : 0;
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

function render() {
  const t = today(), tk = keyOf(t);
  $('date').textContent = t.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const active = state.habits.filter(h => !h.archived);
  const archived = state.habits.filter(h => h.archived);
  const doneCount = active.filter(h => doneSet(h.id).has(tk)).length;

  $('summary').textContent = active.length
    ? (doneCount === active.length ? `All ${active.length} done today 🎉` : `${doneCount} of ${active.length} done today`)
    : '';
  $('progress-bar').style.width = active.length ? `${(doneCount / active.length) * 100}%` : '0';

  $('list').replaceChildren(...(active.length ? active.map(card) : [el('p', { className: 'empty', textContent: 'No habits yet. Tap + to add one.' })]));
  $('archived').hidden = !archived.length;
  $('archived').querySelector('summary').textContent = `Archived (${archived.length})`;
  $('archived-list').replaceChildren(...archived.map(card));

  if ($('detail-dialog').open) renderDetail();
}

const COLORS = ['#34c77b', '#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#eab308', '#14b8a6', '#ef4444'];
const colorOf = h => h.color || COLORS[0];
const CARD_WEEKS = 26;

// Monday-first weeks ending with the current week; future days are hidden.
function gridCells(set, weeks, cellTag, onCell) {
  const t = today(), tk = keyOf(t);
  const start = addDays(t, -((t.getDay() + 6) % 7) - 7 * (weeks - 1));
  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i), k = keyOf(d);
    const future = d > t;
    cells.push(el(cellTag, {
      className: [set.has(k) && 'on', k === tk && 'today', future && 'future'].filter(Boolean).join(' '),
      title: d.toDateString(),
      ...(onCell && { disabled: future, onclick: () => onCell(k) }),
    }));
  }
  return cells;
}

function card(h) {
  const set = doneSet(h.id);
  const tk = keyOf(today());
  const cur = currentStreak(set), best = bestStreak(set);

  const grid = el('div', { className: 'grid', onclick: () => openDetail(h.id) });
  grid.style.setProperty('--weeks', CARD_WEEKS);
  grid.append(...gridCells(set, CARD_WEEKS, 'i'));

  const node = el('article', { className: `habit${set.has(tk) ? ' done' : ''}` },
    el('div', { className: 'habit-top' },
      el('button', { className: 'info', onclick: () => openDetail(h.id) },
        el('span', { className: 'tile', textContent: h.emoji || '✅' }),
        el('span', { className: 'text' },
          el('span', { className: 'name', textContent: h.name }),
          el('span', { className: 'meta', textContent: cur ? `🔥 ${cur} day streak · best ${best}` : `best ${best}` }),
        ),
      ),
      el('button', { className: 'check', textContent: '✓', ariaLabel: `Mark ${h.name} done today`, ariaPressed: String(set.has(tk)), onclick: () => toggle(h.id, tk) }),
    ),
    grid,
  );
  node.style.setProperty('--c', colorOf(h));
  return node;
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
  $('d-emoji').textContent = h.emoji || '✅';
  $('d-name').textContent = h.name;
  $('d-current').textContent = currentStreak(set);
  $('d-best').textContent = bestStreak(set);
  $('d-total').textContent = set.size;
  $('d-rate').textContent = `${last30Rate(set, h)}%`;
  $('d-archive').textContent = h.archived ? 'Unarchive' : 'Archive';
  $('detail-dialog').style.setProperty('--c', colorOf(h));
  $('d-heatmap').replaceChildren(...gridCells(set, 16, 'button', k => toggle(h.id, k)));
}

// ---------- add / edit dialog ----------
let editingId = null;
let pickedColor = COLORS[0];
function renderSwatches() {
  $('swatches').replaceChildren(...COLORS.map(c => {
    const b = el('button', { type: 'button', role: 'radio', ariaChecked: String(c === pickedColor), ariaLabel: c, onclick: () => { pickedColor = c; renderSwatches(); } });
    b.style.setProperty('--c', c);
    return b;
  }));
}
function openEdit(id = null) {
  editingId = id;
  const h = state.habits.find(x => x.id === id);
  const f = $('edit-form');
  $('edit-title').textContent = h ? 'Edit habit' : 'New habit';
  f.name.value = h?.name ?? '';
  f.emoji.value = h?.emoji ?? '';
  pickedColor = h ? colorOf(h) : COLORS[state.habits.length % COLORS.length];
  renderSwatches();
  $('edit-dialog').showModal();
  f.name.focus();
}
$('edit-dialog').addEventListener('close', async () => {
  if ($('edit-dialog').returnValue !== 'save') return;
  const f = $('edit-form');
  const name = f.name.value.trim(), emoji = f.emoji.value.trim() || '✅', color = pickedColor;
  if (!name) return;
  try {
    if (editingId) {
      await store.updateHabit(editingId, { name, emoji, color });
      Object.assign(state.habits.find(h => h.id === editingId), { name, emoji, color });
    } else {
      state.habits.push(await store.addHabit({ name, emoji, color }));
    }
    saveCache(); render();
  } catch (e) { toast(`Couldn't save: ${e.message}`); }
});

// ---------- wiring ----------
$('add-btn').onclick = () => openEdit();
$('edit-cancel').onclick = () => $('edit-dialog').close('cancel');
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
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('app').hidden) refresh();
});

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3000);
}

async function showApp() {
  $('login').hidden = true;
  $('app').hidden = false;
  $('local-banner').hidden = store.isCloud;
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) { applyData(JSON.parse(cached)); render(); }
  await refresh();
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

// Data layer. Two backends with the same API:
//  - cloud: Supabase (when config.js has keys)
//  - local: localStorage (handy for testing, or if you never want a cloud)
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const isCloud = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
let sb = null;

export async function init() {
  if (!isCloud) return;
  const { createClient } = await import(SUPABASE_JS);
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// ---------- auth ----------
export async function getUser() {
  if (!isCloud) return { email: 'local device' };
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}
export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
export async function signOut() {
  if (isCloud) await sb.auth.signOut();
}

// ---------- local backend ----------
const LOCAL_KEY = 'habits.local.v1';
const readLocal = () => JSON.parse(localStorage.getItem(LOCAL_KEY) || '{"habits":[],"checkins":[]}');
const writeLocal = db => localStorage.setItem(LOCAL_KEY, JSON.stringify(db));

// ---------- API ----------
// Returns { habits: [{id, name, emoji, color, days, archived, created_at}], checkins: [{habit_id, day}] }
export async function loadAll() {
  if (!isCloud) return readLocal();
  const habits = await must(sb.from('habits').select('*').order('created_at'));
  // Supabase caps responses at 1000 rows, so page through check-ins.
  const checkins = [];
  for (let from = 0; ; from += 1000) {
    const page = await must(sb.from('checkins').select('habit_id,day').order('day').range(from, from + 999));
    checkins.push(...page);
    if (page.length < 1000) break;
  }
  return { habits, checkins };
}

export async function addHabit({ name, emoji, color, days }) {
  if (!isCloud) {
    const db = readLocal();
    const habit = { id: crypto.randomUUID(), name, emoji, color, days, archived: false, created_at: new Date().toISOString() };
    db.habits.push(habit);
    writeLocal(db);
    return habit;
  }
  return must(sb.from('habits').insert({ name, emoji, color, days }).select('*').single());
}

export async function updateHabit(id, patch) {
  if (!isCloud) {
    const db = readLocal();
    Object.assign(db.habits.find(h => h.id === id), patch);
    return writeLocal(db);
  }
  await must(sb.from('habits').update(patch).eq('id', id));
}

export async function deleteHabit(id) {
  if (!isCloud) {
    const db = readLocal();
    db.habits = db.habits.filter(h => h.id !== id);
    db.checkins = db.checkins.filter(c => c.habit_id !== id);
    return writeLocal(db);
  }
  await must(sb.from('habits').delete().eq('id', id)); // check-ins cascade
}

export async function setCheckin(habitId, day, done) {
  if (!isCloud) {
    const db = readLocal();
    db.checkins = db.checkins.filter(c => !(c.habit_id === habitId && c.day === day));
    if (done) db.checkins.push({ habit_id: habitId, day });
    return writeLocal(db);
  }
  if (done) {
    await must(sb.from('checkins').upsert({ habit_id: habitId, day }, { onConflict: 'habit_id,day', ignoreDuplicates: true }));
  } else {
    await must(sb.from('checkins').delete().eq('habit_id', habitId).eq('day', day));
  }
}

async function must(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

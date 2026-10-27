# Habits — personal habit tracker (PWA + Supabase)

A tiny web app you install on your phone's home screen. No build step, no framework.

- HabitKit-style cards: each habit has its own colour and a 6-month contribution grid
- Schedules: pick which weekdays a habit is due (e.g. weekdays only). Days off never break a streak
- Streak celebrations when you check in, plus confetti on milestones and "perfect days", and a daily nudge when a streak is on the line
- Insights (📊 button): this month vs last month, this year vs last year so far, a 12-month chart against last year, a per-habit breakdown, and your best weekdays
- Tap ✓ to mark today done
- Tap a habit to see its current and best streak, total, and the last 30 days, plus a 16-week grid where you can tap any day to fill in or fix the past
- Add, edit, archive or delete habits; export everything as JSON from ⋯

Files: `index.html`, `styles.css`, `app.js` (UI and streaks), `store.js` (data), `config.js` (your keys), `sw.js` (offline), `supabase.sql` (database).

---

## 1. Create the free database (Supabase), about 5 min

1. Sign up at https://supabase.com and click **New project** (Free plan). Choose a region near you.
2. Go to **SQL Editor → New query**, paste the contents of `supabase.sql`, and click **Run**.
3. Create your login: **Authentication → Users → Add user → Create new user**. Enter your email and a password, and tick **Auto Confirm User**.
4. Stop anyone else from signing up: **Authentication → Sign In / Providers**, then turn **off** "Allow new users to sign up".
5. Get your keys from **Project Settings → API** (or **API Keys**):
   - Project URL → `https://xxxx.supabase.co`
   - the **anon** key, or the **publishable** key (`sb_publishable_…`)
6. Paste both into `config.js`.

> The anon or publishable key is meant to be public. Your data is protected by your password and by the row-level security rules in `supabase.sql`. **Never** put the `service_role` or secret key in this app.

## 2. Host it for free (GitHub Pages), about 5 min

A PWA must be served over HTTPS. GitHub Pages provides HTTPS for free:

1. Create a new repository on GitHub, for example `habits`. It can be public, because your data lives in Supabase and not in the code.
2. Upload all the files in this folder, including `icons/`. You can drag them into "Add file → Upload files", or run:
   ```
   git init && git add . && git commit -m "habits app"
   git branch -M main
   git remote add origin https://github.com/<you>/habits.git
   git push -u origin main
   ```
3. In the repository, open **Settings → Pages → Source: Deploy from a branch → main / (root)** and save.
4. After about a minute the app is live at `https://<you>.github.io/habits/`.

Other hosts work just as well: Netlify (drag the folder onto app.netlify.com/drop) or Cloudflare Pages.

## 3. Put it on your phone

Open the URL on your phone and sign in once. You stay signed in after that.

- **iPhone (Safari):** Share button → **Add to Home Screen**. This must be done in Safari.
- **Android (Chrome):** ⋮ menu → **Add to Home screen** / **Install app**.

It then opens full-screen like a normal app, with its own icon.

## Database migrations

If you set up the database before a feature was added, run the matching file from `migrations/` once in the Supabase SQL Editor:

- `002_schedule.sql`: weekday schedules (the `days` column)

## Updating the app later

Edit the files and push them again. The app always fetches the latest files when it's online. If an update doesn't appear, close the app fully and reopen it. You can also bump `VERSION` in `sw.js`.

## Good to know

- **Supabase pauses free projects after about 7 days without use.** Using the app daily keeps it awake. If it ever pauses, open the Supabase dashboard and click **Restore**. Your data is kept.
- **Offline:** the app opens and shows your last-synced data. Check-ins need a connection to save; if one fails, you'll see a message and the tap is undone.
- **Local mode:** with `config.js` left empty, the app works fully but stores data only on that device. This is useful for trying it out.
- **Try it on your computer:** run `python3 -m http.server 8765` in this folder and open http://localhost:8765.

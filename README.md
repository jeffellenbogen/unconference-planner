# Unconference Planner

A small web app for running an unconference-style PD day. Participants join from their laptops or phones, help shape the agenda, vote on sessions, and get a personal schedule. It's a static site (GitHub Pages) with Firebase for live shared data. There's no build step.

| Page | Who | What |
|---|---|---|
| `index.html` | Participants | Join with a code + name. Rank topics, suggest ideas, vote, see "My day" |
| `admin.html` | Organizer | Create events, move between phases, merge ideas, build and publish the schedule |
| `display.html?code=…` | Projector | Join QR code, live topic ranking, idea wall, vote tallies, final schedule |

## How a day flows

Participants see three plain steps — **① Share ideas → ② Vote → ③ Your schedule** — plus a "Now" card that always says what to do. The organizer moves everyone along from the phase bar in the admin console.

| Organizer phase | Participants see |
|---|---|
| **Waiting room** | "Welcome!" — what's coming. Check topics, rooms, times, and voting style in **Settings**. |
| **Share ideas** | Step 1, in three guided parts: **Rank topics** → **Back ideas** (▲, comment, "I could lead") → **Suggest** your own. While someone types, similar ideas pop up with **"Back it + add my angle"** so ideas don't splinter. |
| **Build sessions** | "Hang tight" while sessions appear. You merge ideas in **Ideas & merging** (tick ideas → **Merge into new session** or **Each → own session**; **Possible duplicates** flags look-alikes; **More tools → Export ideas for AI** gives a prompt to paste into Claude, then **Import AI groups**). |
| **Vote** | Step 2: **Must attend / Interested / Skip**, or **dot voting** (set in Settings), plus "I can lead". Confirm leaders on the **Sessions** tab. |
| **Schedule** | Step 3 once you **Publish**: "Your day" (best pick per block) and the full grid. |

**⚡ Generate from votes** picks the most-wanted sessions, spreads them so people's "must" picks don't clash, never double-books a leader, and puts the biggest crowds in the biggest rooms. Change any cell from its dropdown, 🔒 lock cells to keep them, and regenerate the rest. **More** has copy-as-text, CSV, print, and clear.

The projector (`display.html?code=…`) always shows the join QR code, link, and code, a big "Now" banner for the current step, and live results.

Nothing is locked in — you can jump to any phase from the phase bar at any time.

## Try it now (demo mode)

With `js/config.js` left empty, the app runs in **demo mode**. All data stays in your browser's localStorage, and each browser tab acts as a separate participant.

```bash
python3 -m http.server 8000
# organizer:   http://localhost:8000/admin.html
# participant: http://localhost:8000/index.html   (open several tabs)
# projector:   http://localhost:8000/display.html?code=YOURCODE
```

## Go live: Firebase (about 10 minutes, free tier)

1. Go to <https://console.firebase.google.com> → **Add project**. You can turn Analytics off.
2. In the left sidebar, open **Security → Authentication → Get started**, then the **Sign-in method** tab. (Can't find it? Type "Authentication" in **Search for products**.) Enable:
   - **Anonymous**, for participants
   - **Google**, for you as the organizer
   - optionally **Email/Password**, as a fallback if your school's Google Workspace blocks third-party sign-in
3. Open **Authentication → Settings → Authorized domains** and add `YOUR-GITHUB-USERNAME.github.io`.
4. Open **Databases & Storage → Firestore → Create database** and choose **production mode** in a US location. On the **Rules** tab, paste the contents of [`firestore.rules`](firestore.rules) and click **Publish**.
   - Only the emails listed in the rules can create events (currently `jellenbogen@dawsonschool.org`). To change that, edit the list in `firestore.rules` and `ORGANIZER_EMAILS` in `js/config.js`, then republish the rules.
5. Open **Project settings** (gear icon) → **Your apps** → **Web `</>`**. Register the app, then copy the `firebaseConfig` values into [`js/config.js`](js/config.js).
   - These values are not secrets. The Firestore rules are what protect the data.
6. Commit and push.

## Host on GitHub Pages

Repo **Settings → Pages → Build and deployment**: set *Deploy from a branch*, choose `main`, and set the folder to `/ (root)`. The site appears at `https://USERNAME.github.io/REPO/`. Participants go to that URL, or scan the QR code on the projector page.

## Day-of checklist

- [ ] Create the event the day before. Check rooms, capacities, and agenda times.
- [ ] Do a test run on your phone, then use **Settings → Reset event** to clear the test data.
- [ ] Put `display.html?code=…` on the projector and press *Full screen*.
- [ ] Share ideas: about 15–20 min. Build sessions: about 10 min (Export for AI makes this fast). Vote: about 5–10 min. Generate, review clashes, publish.

## Notes and limits

- Participant identity is anonymous and tied to the browser. Someone who switches devices rejoins as a new person (organizers can remove duplicates on the Overview tab).
- Participants can't edit or delete their own ideas after posting. Organizers can edit titles or hide ideas.
- About 25 people is far below Firebase's free-tier limits.

## Branding

Dawson School logo and colors from the 2023 brand manual (`assets/`, `css/style.css`). Fonts are the manual's web substitutes, vendored in `vendor/fonts/`: Crimson Pro for Minion Pro and Nunito Sans for Avenir. Topic colors default to the brand palette.

## Development

- Plain ES modules with [Preact + htm](https://github.com/developit/htm), vendored in `vendor/` so school web filters can't block a CDN. The QR code uses vendored `qrcode-generator`.
- `js/model.js` holds all the pure logic: ranking, similarity, scheduling, and the personal agenda. Unit tests: `npm test` (Node 18+).
- `js/backend.js` switches between `backend-firebase.js` and `backend-local.js` (demo mode).

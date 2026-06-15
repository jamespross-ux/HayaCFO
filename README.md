# Personal CFO — standalone

A standalone version of your Personal CFO dashboard, ready to deploy to Vercel
and add to your iPhone home screen.

This is a **separate copy** — it does not affect the artifact you use day to
day in Claude. Your data here starts from the same seed values, but the two
live independently (each stores its data separately: this one in your
browser's `localStorage`, the Claude one in the artifact's storage).

## What's different from the Claude artifact

1. **Storage**: uses `localStorage` instead of Claude's `window.storage`.
   Your data stays on this device/browser. Use the existing "Export" button
   (Setup tab) periodically to copy a JSON backup somewhere safe — clearing
   Safari's site data would otherwise wipe it.
2. **CFO Chat**: instead of calling Anthropic's API directly (which only
   works inside Claude.ai), requests go to `/api/chat`, a small serverless
   function that holds your API key and forwards the request. Your key is
   never sent to the browser.

## 1. Get an Anthropic API key

If you don't already have one:
1. Go to https://console.anthropic.com
2. Create an API key (Settings -> API Keys)
3. Note: this is billed separately from any Claude.ai subscription —
   API usage is pay-as-you-go. CFO Chat messages are small (capped history +
   one system prompt), so cost should be minimal for personal use, but it's
   worth keeping an eye on usage in the console.

## 2. Push this folder to GitHub

```bash
cd personal-cfo-standalone
git init
git add .
git commit -m "Personal CFO standalone"
```

Create a new (private!) repo on GitHub and push:

```bash
git remote add origin https://github.com/<you>/personal-cfo.git
git branch -M main
git push -u origin main
```

Keep the repo **private** — while your API key itself isn't in the code,
this is your personal finance dashboard.

## 3. Deploy to Vercel

1. Go to https://vercel.com and sign in (GitHub login is easiest)
2. "Add New" -> "Project" -> import the repo you just pushed
3. Vercel auto-detects Vite — leave the default build settings
4. Before deploying (or after, then redeploy), go to
   **Project Settings -> Environment Variables** and add:
   - Name: `ANTHROPIC_API_KEY`
   - Value: the key from step 1
5. Deploy. You'll get a URL like `https://personal-cfo-xxxx.vercel.app`

## 4. Add to iPhone home screen

1. Open your Vercel URL in **Safari** on your iPhone
2. Tap the Share icon -> **Add to Home Screen**
3. Name it "Personal CFO" and tap Add

It'll now open full-screen, like a native app, with no Safari address bar.

## 5. First run

The app loads with the same seed data as your Claude artifact. Go to
Update/Setup and re-enter your current real numbers, or paste in your data
via the Setup tab if you've previously used Export to get a JSON copy.

## Local development (optional)

```bash
npm install
npm run dev
```

`/api/chat` only works once deployed to Vercel (or via `vercel dev`), since
it's a serverless function — locally with plain `npm run dev` the CFO Chat
tab will show a connection error, but the dashboard, Update, and Setup tabs
work fine.

## Keeping it updated

If you ask Claude to make further changes to your Claude artifact, those
won't automatically appear here. Bring the updated `.tsx` code over to
`src/App.tsx` in this repo (keeping the two adaptations above — the
`localStorage` calls and the `/api/chat` endpoint), commit, and push; Vercel
redeploys automatically.
# PersonalCFO

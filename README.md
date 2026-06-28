# Personal CFO

A personal finance dashboard with an AI CFO built in. Track your net worth, manage cash flow, monitor investments, and have real financial conversations with an AI that knows your full picture.

Built for people who care about their finances but don't want to live in a spreadsheet.

---

## Features

- **Live dashboard** — net worth, cash, liquid portfolio, and illiquid assets at a glance
- **Multi-currency** — display in GBP, AED, USD, or any currency; toggle secondary figures on/off
- **CFO Score** — weighted financial health score across surplus, liquidity, goals, and portfolio
- **CFO Chat** — AI CFO with full context of your financial picture; asks smart questions, gives direct answers
- **Life log** — capture key financial moments; the CFO proactively offers to log things for you
- **Goals tracker** — visual progress dials per goal
- **Recurring cash flow** — income and outflow tracking with trend charts
- **Portfolio risk allocation** — Low, Balanced, High breakdown with visual bar
- **Illiquid asset tracking** — property equity, pension etc. kept separate from liquid net worth
- **Auto FX rate refresh** — rates update daily on login, dashboard recalculates immediately
- **Login streak** — tracks daily engagement with contextual messages
- **Snapshot history** — net worth over time chart from saved updates
- **Export / import** — full JSON backup and restore
- **Secure** — Supabase auth with RLS; each user can only access their own data

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Vite |
| Auth + Database | Supabase (email/password auth, PostgreSQL with RLS) |
| Hosting | Vercel |
| AI | Anthropic Claude API (claude-sonnet-4-6) via Vercel edge function |
| FX Rates | ExchangeRate-API |

---

## Deploying Your Own Instance

### 1. Clone the repo

```bash
git clone https://github.com/jamespross-ux/PersonalCFO.git
cd PersonalCFO
npm install
```

### 2. Set up Supabase

Create a project at [supabase.com](https://supabase.com) and run this SQL in the editor:

```sql
create table cfo_data (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null unique,
  data jsonb not null default '{}',
  updated_at timestamptz default now()
);

alter table cfo_data enable row level security;

create policy "Users can only access their own data"
  on cfo_data for all
  using (auth.uid() = user_id);
```

### 3. Environment variables

Create a `.env` file:

```
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_EXCHANGERATE_API_KEY=your_exchangerate_api_key
```

Get a free ExchangeRate-API key at [exchangerate-api.com](https://www.exchangerate-api.com).

### 4. Vercel edge function

The AI chat proxies through `/api/chat.ts` to keep your Anthropic API key server-side. Add these to your Vercel project environment variables:

```
ANTHROPIC_API_KEY=your_anthropic_api_key
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_EXCHANGERATE_API_KEY=your_exchangerate_api_key
```

### 5. Deploy

```bash
npm install -g vercel
vercel
```

Or connect your GitHub repo to Vercel for automatic deployments on push.

### 6. Run locally

```bash
npm run dev
```

---

## Project Structure

```
/src
  App.tsx       — main application
/api
  chat.ts       — Vercel edge function (Anthropic API proxy)
```

---

## Notes

- All data is stored per-user in Supabase with row-level security
- The Anthropic API key is never exposed to the client
- Base currency is set per user (default AED); display currency is cosmetic
- CFO Score is calculated client-side — no AI call needed for the score itself

---

## License

MIT

---

## Get in Touch

If you find this useful, have ideas, or want to connect — I'd love to hear from you.

**James Ross**
- 💼 [LinkedIn](https://www.linkedin.com/in/jamesr19/)
- 📧 jamespross@hotmail.com
- 💬 WhatsApp: +971 58 528 1208

If this project helped you, a ⭐ on the repo is always appreciated.

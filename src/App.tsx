import React, { useState, useEffect, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  LayoutDashboard, MessageCircle, NotebookPen, Settings2, Send, Plus, Trash2,
  ChevronDown, ChevronUp, Sparkles, Copy, Check, Paperclip, X, FileText,
} from 'lucide-react';

const STORAGE_KEY = 'personal-cfo-data';
// Cap on messages sent to the API per request (full history is always kept in storage/UI)
const MAX_HISTORY_MESSAGES = 24;

// NOTE: this seed is a generic starting template only. It contains no real
// personal data — your actual figures live in your browser's localStorage
// once you enter them via Update/Setup (or paste an exported JSON backup).
const seed = {
  baseCurrency: 'AED',
  fxRates: { GBP: 4.924, USD: 3.6725 },

  accounts: [
    { id: 'acc1', name: 'UK current account', type: 'asset', currency: 'GBP' },
    { id: 'acc2', name: 'Everyday account', type: 'asset', currency: 'AED' },
    { id: 'acc3', name: 'Savings account', type: 'asset', currency: 'AED' },
  ],

  portfolio: [
    { id: 'p1', product: 'Investment account 1', country: 'UK', currency: 'GBP', risk: 'Balanced' },
    { id: 'p2', product: 'Investment account 2', country: 'UAE', currency: 'USD', risk: 'Balanced' },
    { id: 'p3', product: 'Savings / bonds', country: 'UK', currency: 'GBP', risk: 'Low' },
    { id: 'p4', product: 'Local savings account', country: 'UAE', currency: 'AED', risk: 'Low' },
    { id: 'mqe58qbczh2do', product: 'Property', country: 'UK', currency: 'GBP', risk: 'Low', illiquid: true },
  ],

  goals: [
    { id: 'g1', name: 'Emergency fund', target: 0, current: 0, targetDate: '' },
  ],

  recurringItems: [
    { id: 'r1', name: 'Salary', amount: 0, currency: 'AED', frequency: 'monthly', direction: 'in', account: 'Everyday account', category: 'Income' },
    { id: 'r6', name: 'Rent', amount: 0, currency: 'AED', frequency: 'monthly', direction: 'out', account: 'Everyday account', category: 'Housing' },
    { id: 'r10', name: 'Subscriptions', amount: 0, currency: 'AED', frequency: 'monthly', direction: 'out', account: 'Everyday account', category: 'Subscriptions' },
  ],

  knownGaps: [],

  snapshots: [
    {
      id: 's1',
      date: new Date().toISOString().slice(0, 10),
      balances: { acc1: 0, acc2: 0, acc3: 0 },
      portfolioValues: { p1: 0, p2: 0, p3: 0, p4: 0, mqe58qbczh2do: 0 },
      fxRates: { GBP: 4.924, USD: 3.6725 },
      note: 'Starter template — enter your real balances via Update, or paste an exported JSON backup via Setup.',
      netRecurring: { in: 0, out: 0 },
    },
  ],

  lifeLog: [],

  chat: [
    {
      role: 'assistant',
      content:
        "## Welcome to your Personal CFO\n\nThis is a starter template — no real data is loaded yet.\n\nGo to **Update** to enter your account balances, portfolio values, and recurring income/outflows, or use **Setup** to paste in a previously exported JSON backup.\n\nOnce your numbers are in, ask me anything — I can review your position, talk through your risk allocation, or help with planning.",
    },
  ],
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const fmt = (n, currency) =>
  `${currency} ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

// Display a base-currency (AED) amount as GBP primary, AED in brackets —
// for headline dashboard figures only; underlying calculations stay in AED.
const fmtGBP = (amountAED, fxRates) => {
  const gbpRate = fxRates?.GBP || 1;
  const gbp = Number(amountAED || 0) / gbpRate;
  return `£${gbp.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};
const fmtGBPAED = (amountAED, fxRates) => `${fmtGBP(amountAED, fxRates)} (${fmt(amountAED, 'AED')})`;

const rateFor = (currency, snapFx, dataFx, base) => {
  if (currency === base) return 1;
  const fromSnap = snapFx?.[currency];
  if (fromSnap !== undefined && fromSnap !== '' && !Number.isNaN(Number(fromSnap))) return Number(fromSnap);
  const fromDefaults = dataFx?.[currency];
  if (fromDefaults !== undefined) return Number(fromDefaults);
  return 1;
};

const accountsTotal = (snap, accounts, dataFx, base) =>
  accounts.reduce((sum, a) => {
    const bal = Number(snap?.balances?.[a.id]) || 0;
    const rate = rateFor(a.currency || base, snap?.fxRates, dataFx, base);
    return sum + bal * rate * (a.type === 'liability' ? -1 : 1);
  }, 0);

// opts.excludeIlliquid: skip holdings flagged illiquid (e.g. property equity)
// opts.illiquidOnly: sum only holdings flagged illiquid
const portfolioTotal = (snap, portfolio, dataFx, base, opts = {}) =>
  portfolio
    .filter((h) => (opts.illiquidOnly ? !!h.illiquid : opts.excludeIlliquid ? !h.illiquid : true))
    .reduce(
      (sum, h) => sum + (Number(snap?.portfolioValues?.[h.id]) || 0) * rateFor(h.currency, snap?.fxRates, dataFx, base),
      0
    );

// net worth excluding illiquid holdings (e.g. property equity) — the "spendable" picture
const liquidNetWorth = (snap, accounts, portfolio, dataFx, base) =>
  accountsTotal(snap, accounts, dataFx, base) + portfolioTotal(snap, portfolio, dataFx, base, { excludeIlliquid: true });

const riskBreakdown = (snap, portfolio, dataFx, base) => {
  const result = { Low: 0, Balanced: 0, High: 0 };
  portfolio.filter((h) => !h.illiquid).forEach((h) => {
    const val = (Number(snap?.portfolioValues?.[h.id]) || 0) * rateFor(h.currency, snap?.fxRates, dataFx, base);
    result[h.risk] = (result[h.risk] || 0) + val;
  });
  return result;
};

// convert a recurring item's amount into base currency / month
const monthlyInBase = (item, dataFx, base) => {
  const rate = rateFor(item.currency, null, dataFx, base);
  const mult = item.frequency === 'monthly' ? 1 : item.frequency === 'weekly' ? 4.333 : item.frequency === 'yearly' ? 1 / 12 : 1;
  return Number(item.amount || 0) * rate * mult;
};

function buildSystemPrompt(data) {
  const { baseCurrency, accounts, portfolio, goals, recurringItems, knownGaps, snapshots, lifeLog, fxRates } = data;
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];

  const cash = latest ? accountsTotal(latest, accounts, fxRates, baseCurrency) : 0;
  const liquidPort = latest ? portfolioTotal(latest, portfolio, fxRates, baseCurrency, { excludeIlliquid: true }) : 0;
  const illiquidPort = latest ? portfolioTotal(latest, portfolio, fxRates, baseCurrency, { illiquidOnly: true }) : 0;
  const port = liquidPort + illiquidPort;
  const liquidNw = cash + liquidPort;
  const nw = liquidNw + illiquidPort;
  const risk = latest ? riskBreakdown(latest, portfolio, fxRates, baseCurrency) : { Low: 0, Balanced: 0, High: 0 };

  const lines = [];
  lines.push(
    `You are James's Personal CFO — an ongoing financial advisor with full visibility of his accounts, investments, recurring cash flows, goals, and life context. He'll talk to you periodically (roughly monthly) and update balances and life events over time.`
  );
  lines.push('');
  lines.push(
    `Be direct, concise, and specific to his actual numbers. Surface patterns, risks, and trade-offs honestly, including uncomfortable ones (concentration, FX exposure, a goal becoming unrealistic, a recurring outflow growing, etc.). For decisions, present 2-3 concrete options with trade-offs in neutral language ("Option A would mean..."), not "you should". This is not regulated financial advice and he knows that — don't add disclaimers. Use short paragraphs, ## headers and bullet lists only where they aid clarity. No filler or generic platitudes.`
  );
  lines.push(
    `Note: only recent chat history is sent with each request (older turns are trimmed). Durable facts — decisions, plans, new goals, life events — won't persist in chat memory, so when something important like that comes up, suggest he note it via Update or the life log so it's retained.`
  );
  lines.push(
    `Note: James prefers GBP as the primary currency for headline figures, with AED shown alongside for reference (the dashboard now displays figures this way: "£X (AED Y)"). Follow this convention in conversation too — lead with GBP, AED in brackets — using the FX rate above.`
  );
  lines.push('');
  lines.push(`=== CURRENT FINANCIAL POSITION (as of ${latest?.date || 'no snapshot yet'}) ===`);
  lines.push(`Base currency: ${baseCurrency}. FX: 1 GBP = ${fxRates.GBP} AED, 1 USD = ${fxRates.USD} AED.`);
  lines.push(`Liquid net worth: ${fmt(liquidNw, baseCurrency)} (cash/accounts ${fmt(cash, baseCurrency)}, liquid portfolio ${fmt(liquidPort, baseCurrency)}) — this is the headline figure on the dashboard.`);
  if (illiquidPort > 0) {
    lines.push(`Illiquid assets (excluded from the headline figure): ${fmt(illiquidPort, baseCurrency)}. Total net worth including these: ${fmt(nw, baseCurrency)}.`);
  }
  lines.push('');
  lines.push('Accounts:');
  accounts.forEach((a) => {
    const bal = Number(latest?.balances?.[a.id]) || 0;
    const converted = bal * rateFor(a.currency, latest?.fxRates, fxRates, baseCurrency);
    lines.push(
      `- ${a.name} (${a.type}, ${a.currency}): ${a.currency} ${bal.toLocaleString()}${
        a.currency !== baseCurrency ? ` (≈ ${fmt(converted, baseCurrency)})` : ''
      }`
    );
  });
  lines.push('');
  lines.push('Portfolio holdings:');
  portfolio.forEach((h) => {
    const val = Number(latest?.portfolioValues?.[h.id]) || 0;
    const converted = val * rateFor(h.currency, latest?.fxRates, fxRates, baseCurrency);
    lines.push(
      `- ${h.product} (${h.country}, ${h.currency}, risk: ${h.risk}${h.illiquid ? ', ILLIQUID — excluded from headline figure' : ''}): ${h.currency} ${val.toLocaleString()}${
        h.currency !== baseCurrency ? ` (≈ ${fmt(converted, baseCurrency)})` : ''
      }`
    );
  });
  lines.push(
    `Risk allocation (liquid portfolio only): Low ${fmt(risk.Low, baseCurrency)}, Balanced ${fmt(risk.Balanced, baseCurrency)}, High ${fmt(
      risk.High,
      baseCurrency
    )} (of ${fmt(liquidPort, baseCurrency)} total)`
  );
  lines.push('');
  lines.push('=== RECURRING MONTHLY CASH FLOWS (from statement analysis) ===');
  const incomes = recurringItems.filter((r) => r.direction === 'in');
  const outflows = recurringItems.filter((r) => r.direction === 'out');
  const totalIn = incomes.reduce((s, r) => s + monthlyInBase(r, fxRates, baseCurrency), 0);
  const totalOut = outflows.reduce((s, r) => s + monthlyInBase(r, fxRates, baseCurrency), 0);
  lines.push('Income:');
  incomes.forEach((r) =>
    lines.push(`- ${r.name}: ${r.currency} ${Number(r.amount).toLocaleString()}/${r.frequency} (${r.account})${r.notes ? ` — ${r.notes}` : ''}`)
  );
  lines.push('Outflows:');
  outflows.forEach((r) =>
    lines.push(`- ${r.name}: ${r.currency} ${Number(r.amount).toLocaleString()}/${r.frequency} (${r.account}, ${r.category})${r.notes ? ` — ${r.notes}` : ''}`)
  );
  lines.push(`Net recurring position: ${fmt(totalIn - totalOut, baseCurrency)}/month (income ${fmt(totalIn, baseCurrency)}, outflows ${fmt(totalOut, baseCurrency)})`);
  if (knownGaps?.length) {
    lines.push('');
    lines.push('Known gaps / things not yet tracked:');
    knownGaps.forEach((g) => lines.push(`- ${g}`));
  }
  lines.push('');
  lines.push('=== GOALS ===');
  goals.forEach((g) =>
    lines.push(
      `- ${g.name}: ${fmt(g.current, baseCurrency)} of ${fmt(g.target, baseCurrency)} target${g.targetDate ? `, target date ${g.targetDate}` : ''}`
    )
  );
  lines.push('');
  lines.push('=== SNAPSHOT HISTORY ===');
  sorted.forEach((s) => {
    const c = accountsTotal(s, accounts, fxRates, baseCurrency);
    const liqP = portfolioTotal(s, portfolio, fxRates, baseCurrency, { excludeIlliquid: true });
    const illiqP = portfolioTotal(s, portfolio, fxRates, baseCurrency, { illiquidOnly: true });
    const liqNw = c + liqP;
    const summary = illiqP > 0
      ? `liquid net worth ${fmt(liqNw, baseCurrency)} (cash ${fmt(c, baseCurrency)}, liquid portfolio ${fmt(liqP, baseCurrency)}; plus ${fmt(illiqP, baseCurrency)} illiquid)`
      : `net worth ${fmt(liqNw, baseCurrency)} (cash ${fmt(c, baseCurrency)}, portfolio ${fmt(liqP, baseCurrency)})`;
    lines.push(`- ${s.date}: ${summary}${s.note ? ` — ${s.note}` : ''}`);
  });
  if (lifeLog?.length) {
    lines.push('');
    lines.push('=== LIFE CONTEXT LOG (most recent first) ===');
    [...lifeLog].reverse().forEach((l) => lines.push(`- ${l.date}: ${l.text}`));
  }
  return lines.join('\n');
}

// ---- file attachment helpers ----
const readAsDataURL = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

const readAsText = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsText(file);
  });

// Minimal CSV parser (handles quoted fields with embedded commas) — avoids
// relying on external libraries that aren't supported in this environment.
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const splitLine = (line) => {
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        result.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    result.push(cur);
    return result;
  };
  const headers = splitLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = splitLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (values[i] ?? '').trim(); });
    return obj;
  });
}

// Summarize parsed rows (array of objects) into a compact text block for the CFO,
// rather than dumping potentially large raw data into the prompt.
function summarizeRows(rows) {
  if (!rows || rows.length === 0) return 'No rows found in file.';
  const columns = Object.keys(rows[0]);
  const numericTotals = {};
  columns.forEach((col) => {
    const nums = rows
      .map((r) => Number(String(r[col]).replace(/,/g, '')))
      .filter((n, i) => !Number.isNaN(n) && rows[i][col] !== '' && rows[i][col] !== undefined && rows[i][col] !== null);
    if (nums.length > rows.length * 0.5) {
      numericTotals[col] = nums.reduce((a, b) => a + b, 0);
    }
  });
  let out = `Rows: ${rows.length}\nColumns: ${columns.join(', ')}\n`;
  if (Object.keys(numericTotals).length) {
    out += `Column totals: ${Object.entries(numericTotals)
      .map(([k, v]) => `${k}=${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`)
      .join(', ')}\n`;
  }
  out += `First rows (sample): ${JSON.stringify(rows.slice(0, 5))}\n`;
  out += `Last rows (sample): ${JSON.stringify(rows.slice(-5))}`;
  return out.slice(0, 4000);
}

function renderMarkdown(text) {
  const blocks = [];
  let listBuffer = [];
  const flushList = (key) => {
    if (listBuffer.length) {
      blocks.push(
        <ul className="md-list" key={`l-${key}`}>
          {listBuffer.map((item, i) => (
            <li key={i}>{boldify(item)}</li>
          ))}
        </ul>
      );
      listBuffer = [];
    }
  };
  (text || '').split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line) {
      flushList(i);
      return;
    }
    if (line.startsWith('## ') || line.startsWith('### ')) {
      flushList(i);
      blocks.push(
        <h4 className="md-h" key={i}>
          {line.replace(/^#+\s*/, '')}
        </h4>
      );
    } else if (/^[-*]\s/.test(line)) {
      listBuffer.push(line.replace(/^[-*]\s/, ''));
    } else {
      flushList(i);
      blocks.push(
        <p className="md-p" key={i}>
          {boldify(line)}
        </p>
      );
    }
  });
  flushList('end');
  return blocks;
}

function boldify(line) {
  const parts = line.split(/\*\*(.*?)\*\*/g);
  return parts.map((p, i) => (i % 2 === 1 ? <strong key={i}>{p}</strong> : p));
}

function WatchDial({ percent, label, sub, accent }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent || 0));
  return (
    <div className="dial">
      <svg viewBox="0 0 100 100" width="100" height="100">
        {Array.from({ length: 12 }).map((_, i) => (
          <line key={i} x1="50" y1="6" x2="50" y2="12" stroke="#1B2430" strokeWidth="1.5" opacity="0.25" transform={`rotate(${i * 30} 50 50)`} />
        ))}
        <circle cx="50" cy="50" r={r} fill="none" stroke="#E4DCC8" strokeWidth="6" />
        <circle
          cx="50" cy="50" r={r} fill="none" stroke={accent} strokeWidth="6"
          strokeDasharray={`${(clamped / 100) * c} ${c}`}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
        />
        <text x="50" y="47" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="16" fontWeight="600" fill="#1B2430">
          {Math.round(clamped)}%
        </text>
        <text x="50" y="61" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="6" fill="#7A8699">
          {sub}
        </text>
      </svg>
      <div className="dial-label">{label}</div>
    </div>
  );
}

const RISK_COLORS = { Low: '#5E8C7C', Balanced: '#C9A24A', High: '#BD5B3A' };

function RiskBar({ breakdown, total, currency }) {
  const order = ['Low', 'Balanced', 'High'];
  return (
    <div>
      <div className="risk-bar">
        {order.map((r) => {
          const val = breakdown[r] || 0;
          const pct = total > 0 ? (val / total) * 100 : 0;
          if (pct <= 0) return null;
          return <div key={r} className="risk-bar-segment" style={{ width: `${pct}%`, background: RISK_COLORS[r] }} title={`${r}: ${fmt(val, currency)}`} />;
        })}
      </div>
      <div className="risk-bar-legend">
        {order.map((r) => (
          <span className="risk-legend-item" key={r}>
            <span className="risk-dot" style={{ background: RISK_COLORS[r] }} />
            {r} {total > 0 ? Math.round(((breakdown[r] || 0) / total) * 100) : 0}% · {fmt(breakdown[r] || 0, currency)}
          </span>
        ))}
      </div>
    </div>
  );
}

function makeUpdateForm(data) {
  const sorted = [...data.snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];
  return {
    date: new Date().toISOString().slice(0, 10),
    balances: latest ? { ...latest.balances } : {},
    portfolioValues: latest ? { ...latest.portfolioValues } : {},
    fxRates: { ...(data.fxRates || {}), ...(latest?.fxRates || {}) },
    lifeUpdate: '',
  };
}

const QUICK_PROMPTS = [
  'Review my current position and flag anything important.',
  'What should I do about my emergency fund?',
  'How exposed am I to GBP/USD vs my AED income?',
  "What's worth asking about the Caroline Ross / household bills flow?",
];

const INTERVIEW_PROMPT =
  "Based on everything you currently know about my accounts, portfolio, recurring cash flows, goals, and the known gaps — interview me with around 10 specific questions that would help you understand my situation better and give sharper recommendations going forward. Ground the questions in my actual numbers and items where relevant (e.g. specific holdings, the Caroline Ross flow, NS&I, my goals) rather than generic finance questions. List them all now, numbered, and I'll answer through as many as I can.";

export default function App() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('dashboard');
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState(null);
  const [updateForm, setUpdateForm] = useState(null);
  const [lifeNoteDraft, setLifeNoteDraft] = useState('');
  const [exportCopied, setExportCopied] = useState(false);
  const [attachment, setAttachment] = useState(null);
  const [attachError, setAttachError] = useState(null);
  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const loaded = JSON.parse(raw);
        setData({ ...seed, ...loaded });
      } else {
        setData(seed);
      }
    } catch (e) {
      setData(seed);
    }
  }, []);

  useEffect(() => {
    if (data && !updateForm) setUpdateForm(makeUpdateForm(data));
  }, [data, updateForm]);

  useEffect(() => {
    if (tab === 'chat' && chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [tab, data?.chat?.length, chatLoading]);

  async function persist(newData) {
    setData(newData);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
    } catch (e) {
      console.error('Storage error', e);
    }
  }

  if (!data || !updateForm) {
    return (
      <div className="loading-screen">
        <style>{baseCSS}</style>
        Loading your CFO…
      </div>
    );
  }

  const { baseCurrency, accounts, portfolio, goals, recurringItems, knownGaps, snapshots, lifeLog, fxRates, chat } = data;
  const sortedSnaps = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sortedSnaps[sortedSnaps.length - 1];
  const previous = sortedSnaps[sortedSnaps.length - 2];

  const cashNow = latest ? accountsTotal(latest, accounts, fxRates, baseCurrency) : 0;
  const liquidPortNow = latest ? portfolioTotal(latest, portfolio, fxRates, baseCurrency, { excludeIlliquid: true }) : 0;
  const illiquidNow = latest ? portfolioTotal(latest, portfolio, fxRates, baseCurrency, { illiquidOnly: true }) : 0;
  const liquidNwNow = cashNow + liquidPortNow;
  const nwNow = liquidNwNow + illiquidNow;
  const nwPrev = previous ? liquidNetWorth(previous, accounts, portfolio, fxRates, baseCurrency) : null;
  const delta = nwPrev !== null ? liquidNwNow - nwPrev : null;
  const riskNow = latest ? riskBreakdown(latest, portfolio, fxRates, baseCurrency) : { Low: 0, Balanced: 0, High: 0 };

  const chartData = sortedSnaps.map((s) => ({
    date: s.date.slice(5),
    netWorth: liquidNetWorth(s, accounts, portfolio, fxRates, baseCurrency),
  }));

  const recurringChartData = sortedSnaps
    .filter((s) => s.netRecurring)
    .map((s) => ({
      date: s.date.slice(5),
      income: s.netRecurring.in,
      outflows: s.netRecurring.out,
      net: s.netRecurring.in - s.netRecurring.out,
    }));

  const fxCurrencies = [...new Set([...accounts.map((a) => a.currency), ...portfolio.map((h) => h.currency)])].filter((c) => c && c !== baseCurrency);

  const incomeItems = recurringItems.filter((r) => r.direction === 'in');
  const outflowItems = recurringItems.filter((r) => r.direction === 'out');
  const totalIn = incomeItems.reduce((s, r) => s + monthlyInBase(r, fxRates, baseCurrency), 0);
  const totalOut = outflowItems.reduce((s, r) => s + monthlyInBase(r, fxRates, baseCurrency), 0);

  // ---- mutation helpers ----
  const updateAccount = (id, field, value) => persist({ ...data, accounts: accounts.map((a) => (a.id === id ? { ...a, [field]: value } : a)) });
  const addAccount = () => persist({ ...data, accounts: [...accounts, { id: uid(), name: 'New account', type: 'asset', currency: baseCurrency }] });
  const removeAccount = (id) => persist({ ...data, accounts: accounts.filter((a) => a.id !== id) });

  const updateHolding = (id, field, value) => persist({ ...data, portfolio: portfolio.map((h) => (h.id === id ? { ...h, [field]: value } : h)) });
  const addHolding = () => persist({ ...data, portfolio: [...portfolio, { id: uid(), product: 'New holding', country: '', currency: baseCurrency, risk: 'Balanced' }] });
  const removeHolding = (id) => persist({ ...data, portfolio: portfolio.filter((h) => h.id !== id) });

  const updateGoal = (id, field, value) => persist({ ...data, goals: goals.map((g) => (g.id === id ? { ...g, [field]: value } : g)) });
  const addGoal = () => persist({ ...data, goals: [...goals, { id: uid(), name: 'New goal', target: 0, current: 0, targetDate: '' }] });
  const removeGoal = (id) => persist({ ...data, goals: goals.filter((g) => g.id !== id) });

  const updateRecurring = (id, field, value) => persist({ ...data, recurringItems: recurringItems.map((r) => (r.id === id ? { ...r, [field]: value } : r)) });
  const addRecurring = () =>
    persist({ ...data, recurringItems: [...recurringItems, { id: uid(), name: 'New item', amount: 0, currency: baseCurrency, frequency: 'monthly', direction: 'out', account: accounts[0]?.name || '', category: '' }] });
  const removeRecurring = (id) => persist({ ...data, recurringItems: recurringItems.filter((r) => r.id !== id) });

  const removeLifeLogEntry = (id) => persist({ ...data, lifeLog: lifeLog.filter((l) => l.id !== id) });

  const updateKnownGap = (index, value) => persist({ ...data, knownGaps: knownGaps.map((g, i) => (i === index ? value : g)) });
  const removeKnownGap = (index) => persist({ ...data, knownGaps: knownGaps.filter((_, i) => i !== index) });
  const addKnownGap = () => persist({ ...data, knownGaps: [...knownGaps, ''] });


  const exportData = async () => {
    const json = JSON.stringify(data, null, 2);
    try {
      await navigator.clipboard.writeText(json);
    } catch (e) {
      // fallback for sandboxed contexts without clipboard API
      const ta = document.createElement('textarea');
      ta.value = json;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { document.execCommand('copy'); } catch (e2) {}
      document.body.removeChild(ta);
    }
    setExportCopied(true);
    setTimeout(() => setExportCopied(false), 2000);
  };

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAttachError(null);
    const MAX_BYTES = 4 * 1024 * 1024; // ~4MB raw; base64 inflates ~33%
    try {
      if (file.type.startsWith('image/')) {
        const dataUrl = await readAsDataURL(file);
        const base64 = dataUrl.split(',')[1];
        setAttachment({ kind: 'image', name: file.name, mediaType: file.type, base64, dataUrl });
      } else if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        if (file.size > MAX_BYTES) {
          setAttachError(`That PDF is ${(file.size / 1024 / 1024).toFixed(1)}MB — please use one under ~4MB, or paste the content into the main chat instead.`);
          return;
        }
        const dataUrl = await readAsDataURL(file);
        const base64 = dataUrl.split(',')[1];
        setAttachment({ kind: 'pdf', name: file.name, mediaType: 'application/pdf', base64 });
      } else if (file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv') {
        const text = await readAsText(file);
        const rows = parseCSV(text);
        setAttachment({ kind: 'data', name: file.name, summary: summarizeRows(rows) });
      } else if (/\.(xlsx|xls)$/i.test(file.name)) {
        setAttachError('Excel files aren\u2019t supported directly here — export as CSV (File \u2192 Export \u2192 CSV) and upload that instead.');
      } else {
        setAttachError('Unsupported file type — try an image, PDF, or CSV file.');
      }
    } catch (err) {
      setAttachError('Could not read that file.');
    }
  }

  const addStandaloneLifeNote = () => {
    if (!lifeNoteDraft.trim()) return;
    const entry = { id: uid(), date: new Date().toISOString().slice(0, 10), text: lifeNoteDraft.trim() };
    persist({ ...data, lifeLog: [...lifeLog, entry] });
    setLifeNoteDraft('');
  };

  const saveSnapshot = () => {
    const nextFx = { ...fxRates, ...Object.fromEntries(fxCurrencies.map((c) => [c, Number(updateForm.fxRates[c]) || 0])) };
    const cleanedSnap = {
      id: uid(),
      date: updateForm.date,
      balances: Object.fromEntries(accounts.map((a) => [a.id, Number(updateForm.balances[a.id]) || 0])),
      portfolioValues: Object.fromEntries(portfolio.map((h) => [h.id, Number(updateForm.portfolioValues[h.id]) || 0])),
      fxRates: Object.fromEntries(fxCurrencies.map((c) => [c, Number(updateForm.fxRates[c]) || 0])),
      note: updateForm.lifeUpdate || '',
      netRecurring: {
        in: incomeItems.reduce((s, r) => s + monthlyInBase(r, nextFx, baseCurrency), 0),
        out: outflowItems.reduce((s, r) => s + monthlyInBase(r, nextFx, baseCurrency), 0),
      },
    };
    const existingIdx = snapshots.findIndex((s) => s.date === cleanedSnap.date);
    let nextSnaps;
    if (existingIdx >= 0) {
      nextSnaps = [...snapshots];
      nextSnaps[existingIdx] = { ...nextSnaps[existingIdx], ...cleanedSnap, id: nextSnaps[existingIdx].id };
    } else {
      nextSnaps = [...snapshots, cleanedSnap];
    }
    let nextLifeLog = lifeLog;
    if (updateForm.lifeUpdate?.trim()) {
      nextLifeLog = [...lifeLog, { id: uid(), date: updateForm.date, text: updateForm.lifeUpdate.trim() }];
    }
    const nextData = { ...data, snapshots: nextSnaps, lifeLog: nextLifeLog, fxRates: nextFx };
    persist(nextData);
    setUpdateForm(makeUpdateForm(nextData));
    setTab('dashboard');
  };

  async function sendChat(presetText) {
    const text = (presetText ?? chatInput).trim();
    if ((!text && !attachment) || chatLoading) return;

    let userContent;
    if (attachment?.kind === 'image') {
      userContent = [
        { type: 'image', source: { type: 'base64', media_type: attachment.mediaType, data: attachment.base64 } },
        { type: 'text', text: text || `I've attached an image (${attachment.name}). Please look at it and extract any relevant balance/account information.` },
      ];
    } else if (attachment?.kind === 'pdf') {
      userContent = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: attachment.base64 } },
        { type: 'text', text: text || `I've attached a PDF (${attachment.name}). Please review it and let me know what's relevant.` },
      ];
    } else if (attachment?.kind === 'data') {
      userContent = `${text ? text + '\n\n' : ''}[Attached file: ${attachment.name}]\n${attachment.summary}`;
    } else {
      userContent = text;
    }

    const nextChat = [...chat, { role: 'user', content: userContent }];
    persist({ ...data, chat: nextChat });
    setChatInput('');
    setAttachment(null);
    setChatLoading(true);
    setChatError(null);
    try {
      // The API requires the conversation to start with a 'user' message —
      // drop any leading assistant message(s) (e.g. the seed welcome note)
      // before sending, while still showing them in the UI.
      const firstUserIdx = nextChat.findIndex((m) => m.role === 'user');
      let apiMessages = nextChat.slice(firstUserIdx);

      // Cap how much history is sent per request. Full history stays in
      // storage/UI regardless — this only trims what's sent to the API,
      // since durable facts (accounts, goals, recurring items, snapshots,
      // life log) are already included in full via the system prompt on
      // every request.
      if (apiMessages.length > MAX_HISTORY_MESSAGES) {
        apiMessages = apiMessages.slice(-MAX_HISTORY_MESSAGES);
        if (apiMessages[0]?.role !== 'user') apiMessages = apiMessages.slice(1);
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          stream: true,
          system: [{ type: 'text', text: buildSystemPrompt(data), cache_control: { type: 'ephemeral' } }],
          messages: apiMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`status ${response.status}: ${errText.slice(0, 200)}`);
      }
      if (!response.body) {
        throw new Error('no response body (streaming not supported here)');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let replyText = '';
      let streamErr = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const dataStr = line.slice(6).trim();
          if (!dataStr) continue;
          let evt;
          try { evt = JSON.parse(dataStr); } catch { continue; }
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
            replyText += evt.delta.text;
          } else if (evt.type === 'error') {
            streamErr = evt.error?.message || 'stream error';
          }
        }
      }
      if (streamErr) throw new Error(streamErr);
      if (!replyText) throw new Error('empty response');
      persist({ ...data, chat: [...nextChat, { role: 'assistant', content: replyText }] });
    } catch (e) {
      setChatError(`Could not reach the CFO just now (${e.message || 'unknown error'}). Try again in a moment.`);
      persist({ ...data, chat: nextChat });
    } finally {
      setChatLoading(false);
    }
  }

  const TABS = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'chat', label: 'CFO Chat', icon: MessageCircle },
    { id: 'update', label: 'Update', icon: NotebookPen },
    { id: 'data', label: 'Setup', icon: Settings2 },
  ];

  return (
    <div className="cfo">
      <style>{baseCSS}</style>

      <header className="masthead">
        <div className="masthead-eyebrow">Personal CFO</div>
        <div className="masthead-main">
          <div>
            <div className="masthead-figure">
              {fmtGBP(liquidNwNow, fxRates)}
              <span className="masthead-figure-secondary"> ({fmt(liquidNwNow, 'AED')})</span>
            </div>
            <div className="masthead-sub">
              {delta !== null ? (
                <span className={delta >= 0 ? 'pos' : 'neg'}>
                  {delta >= 0 ? '▲' : '▼'} {fmtGBPAED(Math.abs(delta), fxRates)} since last update
                </span>
              ) : (
                'Liquid net worth'
              )}
            </div>
            <div className="masthead-split">Cash {fmtGBPAED(cashNow, fxRates)} · Portfolio {fmtGBPAED(liquidPortNow, fxRates)}</div>
            {illiquidNow > 0 && (
              <div className="masthead-split">
                + {fmtGBPAED(illiquidNow, fxRates)} illiquid (property) · total {fmtGBPAED(nwNow, fxRates)}
              </div>
            )}
          </div>
          <div className="masthead-date">{latest ? `As of ${latest.date}` : 'No data yet'}</div>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              <Icon size={15} />
              {t.label}
            </button>
          );
        })}
      </nav>

      <main className="content">
        {tab === 'dashboard' && (
          <div className="stack">
            {sortedSnaps.length > 1 && (
              <div className="card">
                <div className="card-title">Liquid net worth over time</div>
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={chartData}>
                    <CartesianGrid stroke="#E4DCC8" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono' }} stroke="#7A8699" />
                    <YAxis tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono' }} stroke="#7A8699" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} width={48} />
                    <Tooltip formatter={(v) => fmt(v, baseCurrency)} contentStyle={{ fontFamily: 'IBM Plex Sans', fontSize: 12, borderRadius: 4 }} />
                    <Line type="monotone" dataKey="netWorth" stroke="#C9A24A" strokeWidth={2.5} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="stat-row">
              <div className="stat-card">
                <div className="stat-label">Cash &amp; buffer</div>
                <div className="stat-value">{fmtGBP(cashNow, fxRates)}</div>
                <div className="stat-sub">{fmt(cashNow, 'AED')}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Portfolio (liquid)</div>
                <div className="stat-value">{fmtGBP(liquidPortNow, fxRates)}</div>
                <div className="stat-sub">{fmt(liquidPortNow, 'AED')}</div>
              </div>
              {illiquidNow > 0 && (
                <div className="stat-card">
                  <div className="stat-label">Property (illiquid)</div>
                  <div className="stat-value">{fmtGBP(illiquidNow, fxRates)}</div>
                  <div className="stat-sub">{fmt(illiquidNow, 'AED')}</div>
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-title">Accounts</div>
              <div className="kv-table">
                {accounts.map((a) => {
                  const bal = Number(latest?.balances?.[a.id]) || 0;
                  return (
                    <div className="kv" key={a.id}>
                      <span>{a.name}</span>
                      <span className="mono">{a.currency} {bal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card">
              <div className="card-title">Portfolio — risk allocation</div>
              <RiskBar breakdown={riskNow} total={liquidPortNow} currency={baseCurrency} />
              <div className="kv-table">
                {portfolio.map((h) => {
                  const native = Number(latest?.portfolioValues?.[h.id]) || 0;
                  return (
                    <div className="kv" key={h.id}>
                      <span>
                        {h.product}{' '}
                        {!h.illiquid && (
                          <span className="tag" style={{ borderColor: RISK_COLORS[h.risk], color: RISK_COLORS[h.risk] }}>{h.risk}</span>
                        )}
                        {h.illiquid && <span className="tag" style={{ borderColor: '#7A8699', color: '#7A8699' }}>Illiquid</span>}
                      </span>
                      <span className="mono">{h.currency} {native.toLocaleString()}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card">
              <div className="card-title">Recurring monthly cash flow</div>
              <div className="stat-row">
                <div className="stat-card">
                  <div className="stat-label">Income</div>
                  <div className="stat-value pos">{fmtGBP(totalIn, fxRates)}</div>
                  <div className="stat-sub">{fmt(totalIn, 'AED')}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Outflows</div>
                  <div className="stat-value neg">{fmtGBP(totalOut, fxRates)}</div>
                  <div className="stat-sub">{fmt(totalOut, 'AED')}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Net</div>
                  <div className={`stat-value ${totalIn - totalOut >= 0 ? 'pos' : 'neg'}`}>{fmtGBP(totalIn - totalOut, fxRates)}</div>
                  <div className="stat-sub">{fmt(totalIn - totalOut, 'AED')}</div>
                </div>
              </div>
              {recurringChartData.length > 1 && (
                <>
                  <div className="section-label">Net recurring cash flow over time</div>
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={recurringChartData}>
                      <CartesianGrid stroke="#E4DCC8" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono' }} stroke="#7A8699" />
                      <YAxis tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono' }} stroke="#7A8699" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} width={48} />
                      <Tooltip formatter={(v) => fmt(v, baseCurrency)} contentStyle={{ fontFamily: 'IBM Plex Sans', fontSize: 12, borderRadius: 4 }} />
                      <Legend wrapperStyle={{ fontFamily: 'IBM Plex Sans', fontSize: 11 }} />
                      <Line type="monotone" dataKey="income" name="Income" stroke="#5E8C7C" strokeWidth={2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="outflows" name="Outflows" stroke="#BD5B3A" strokeWidth={2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="net" name="Net" stroke="#C9A24A" strokeWidth={2.5} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </>
              )}
              <div className="recurring-list">
                {recurringItems.map((r) => (
                  <div className="recurring-row" key={r.id}>
                    <span className={`flow-dot ${r.direction === 'in' ? 'flow-in' : 'flow-out'}`} />
                    <span className="recurring-name">{r.name}</span>
                    <span className="mono recurring-amount">{r.currency} {Number(r.amount).toLocaleString()}/{r.frequency}</span>
                  </div>
                ))}
              </div>
            </div>

            {knownGaps?.length > 0 && (
              <div className="card gap-card">
                <div className="card-title">Known gaps</div>
                {knownGaps.map((g, i) => (
                  <p className="muted-text" key={i}>{g}</p>
                ))}
              </div>
            )}

            {goals.length > 0 && (
              <div className="card">
                <div className="card-title">Goals</div>
                <div className="dial-row">
                  {goals.map((g) => (
                    <WatchDial key={g.id} percent={g.target > 0 ? (g.current / g.target) * 100 : 0} label={g.name} sub={`${fmt(g.current, baseCurrency)} / ${fmt(g.target, baseCurrency)}`} accent="#C9A24A" />
                  ))}
                </div>
              </div>
            )}

            <button className="btn-primary" onClick={() => { setTab('chat'); sendChat(INTERVIEW_PROMPT); }}>
              <Sparkles size={15} /> Start interview (10 questions)
            </button>
            <button className="btn-secondary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setTab('chat')}>
              <MessageCircle size={15} /> Open CFO Chat
            </button>
          </div>
        )}

        {tab === 'chat' && (
          <div className="chat-wrap">
            <div className="chat-thread">
              {chat.map((m, i) => (
                <div className={`chat-bubble ${m.role === 'user' ? 'chat-user' : 'chat-assistant'}`} key={i}>
                  {Array.isArray(m.content)
                    ? m.content.map((block, j) =>
                        block.type === 'image' ? (
                          <img key={j} src={`data:${block.source.media_type};base64,${block.source.data}`} className="chat-image" alt="attachment" />
                        ) : block.type === 'document' ? (
                          <div className="file-chip" key={j}><FileText size={13} /> PDF attached</div>
                        ) : (
                          <p className="md-p" key={j}>{block.text}</p>
                        )
                      )
                    : m.role === 'assistant'
                    ? renderMarkdown(m.content)
                    : <p className="md-p">{m.content}</p>}
                </div>
              ))}
              {chatLoading && <div className="chat-bubble chat-assistant chat-loading">Thinking…</div>}
              {chatError && <div className="error-text">{chatError}</div>}
              <div ref={chatEndRef} />
            </div>

            {chat.length <= 1 && (
              <div className="quick-prompts">
                {QUICK_PROMPTS.map((p) => (
                  <button key={p} className="chip" onClick={() => sendChat(p)}>{p}</button>
                ))}
              </div>
            )}

            {attachment && (
              <div className="attachment-chip">
                {attachment.kind === 'image' ? (
                  <img src={attachment.dataUrl} alt="" className="attachment-thumb" />
                ) : attachment.kind === 'pdf' ? (
                  <FileText size={13} />
                ) : (
                  <Paperclip size={13} />
                )}
                <span>{attachment.name}</span>
                <button className="icon-btn" onClick={() => setAttachment(null)}><X size={13} /></button>
              </div>
            )}
            {attachError && <div className="error-text">{attachError}</div>}

            <div className="chat-input-row">
              <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="image/*,application/pdf,.csv,.xlsx,.xls" onChange={handleFileSelect} />
              <button className="attach-btn" onClick={() => fileInputRef.current?.click()} title="Attach image, CSV, or Excel file">
                <Paperclip size={16} />
              </button>
              <textarea
                className="input chat-textarea"
                placeholder="Ask your CFO anything, or share what's going on…"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendChat();
                  }
                }}
              />
              <button className="send-btn" onClick={() => sendChat()} disabled={chatLoading || (!chatInput.trim() && !attachment)}>
                <Send size={16} />
              </button>

            </div>
          </div>
        )}

        {tab === 'update' && (
          <div className="stack">
            <div className="card">
              <div className="card-title">Monthly update</div>
              <p className="muted-text">Enter current balances and tell your CFO what's happening — both feed into the next conversation.</p>
              <div className="field">
                <label>Date</label>
                <input type="date" className="input" value={updateForm.date} onChange={(e) => setUpdateForm({ ...updateForm, date: e.target.value })} />
              </div>

              <div className="section-label">Account balances (own currency)</div>
              <div className="grid-2">
                {accounts.map((a) => (
                  <div className="field" key={a.id}>
                    <label>{a.name} <span className="tag">{a.currency}</span></label>
                    <input
                      type="number" className="input mono" placeholder="0"
                      value={updateForm.balances[a.id] ?? ''}
                      onChange={(e) => setUpdateForm({ ...updateForm, balances: { ...updateForm.balances, [a.id]: e.target.value } })}
                    />
                  </div>
                ))}
              </div>

              <div className="section-label">Portfolio values (own currency)</div>
              <div className="grid-2">
                {portfolio.map((h) => (
                  <div className="field" key={h.id}>
                    <label>{h.product} <span className="tag">{h.currency}</span></label>
                    <input
                      type="number" className="input mono" placeholder="0"
                      value={updateForm.portfolioValues[h.id] ?? ''}
                      onChange={(e) => setUpdateForm({ ...updateForm, portfolioValues: { ...updateForm.portfolioValues, [h.id]: e.target.value } })}
                    />
                  </div>
                ))}
              </div>

              {fxCurrencies.length > 0 && (
                <>
                  <div className="section-label">FX rates (1 unit → {baseCurrency})</div>
                  <div className="grid-2">
                    {fxCurrencies.map((c) => (
                      <div className="field" key={c}>
                        <label>{c} → {baseCurrency}</label>
                        <input
                          type="number" step="0.0001" className="input mono"
                          value={updateForm.fxRates[c] ?? ''}
                          onChange={(e) => setUpdateForm({ ...updateForm, fxRates: { ...updateForm.fxRates, [c]: e.target.value } })}
                        />
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="section-label">What's going on?</div>
              <div className="field">
                <label>Life update (optional, gets added to your CFO's context)</label>
                <textarea
                  className="input" rows={4}
                  placeholder="e.g. started a new role, big expense coming up, changed plans on a goal…"
                  value={updateForm.lifeUpdate}
                  onChange={(e) => setUpdateForm({ ...updateForm, lifeUpdate: e.target.value })}
                />
              </div>

              <button className="btn-primary" onClick={saveSnapshot}>
                <Plus size={15} /> Save update
              </button>
            </div>
          </div>
        )}

        {tab === 'data' && (
          <div className="stack">
            <div className="card">
              <div className="card-title">Export / backup</div>
              <p className="muted-text">
                Copies your complete current data — accounts, portfolio, recurring items, goals, all snapshots, life
                log and chat history — as JSON to your clipboard. Paste it into a new chat (e.g. for a deep-dive
                review with a different model) to give it full, up-to-date context.
              </p>
              <button className="btn-primary" onClick={exportData}>
                {exportCopied ? <Check size={15} /> : <Copy size={15} />}
                {exportCopied ? 'Copied to clipboard' : 'Copy full data as JSON'}
              </button>
            </div>

            <div className="card">
              <div className="card-title">Accounts</div>
              {accounts.map((a) => (
                <div className="row" key={a.id}>
                  <input className="input" value={a.name} onChange={(e) => updateAccount(a.id, 'name', e.target.value)} />
                  <select className="input select" value={a.type} onChange={(e) => updateAccount(a.id, 'type', e.target.value)}>
                    <option value="asset">asset</option>
                    <option value="liability">liability</option>
                  </select>
                  <input className="input select mono" value={a.currency} onChange={(e) => updateAccount(a.id, 'currency', e.target.value)} />
                  <button className="icon-btn" onClick={() => removeAccount(a.id)}><Trash2 size={14} /></button>
                </div>
              ))}
              <button className="btn-secondary" onClick={addAccount}><Plus size={14} /> Add account</button>
            </div>

            <div className="card">
              <div className="card-title">Portfolio holdings</div>
              {portfolio.map((h) => (
                <div key={h.id} className="goal-row">
                  <input className="input" value={h.product} onChange={(e) => updateHolding(h.id, 'product', e.target.value)} />
                  <div className="goal-row-numbers">
                    <input className="input" placeholder="Country" value={h.country} onChange={(e) => updateHolding(h.id, 'country', e.target.value)} />
                    <input className="input mono" placeholder="Currency" value={h.currency} onChange={(e) => updateHolding(h.id, 'currency', e.target.value)} />
                    <select className="input select" value={h.risk} disabled={!!h.illiquid} title={h.illiquid ? 'Not used for illiquid holdings' : undefined} onChange={(e) => updateHolding(h.id, 'risk', e.target.value)}>
                      <option value="Low">Low</option>
                      <option value="Balanced">Balanced</option>
                      <option value="High">High</option>
                    </select>
                    <button className="icon-btn" onClick={() => removeHolding(h.id)}><Trash2 size={14} /></button>
                  </div>
                  <label className="checkbox-label">
                    <input type="checkbox" checked={!!h.illiquid} onChange={(e) => updateHolding(h.id, 'illiquid', e.target.checked)} />
                    Illiquid (excluded from headline liquid net worth)
                  </label>
                </div>
              ))}
              <button className="btn-secondary" onClick={addHolding}><Plus size={14} /> Add holding</button>
            </div>

            <div className="card">
              <div className="card-title">Goals</div>
              {goals.map((g) => (
                <div key={g.id} className="goal-row">
                  <input className="input" value={g.name} onChange={(e) => updateGoal(g.id, 'name', e.target.value)} />
                  <div className="goal-row-numbers">
                    <input type="number" className="input mono" placeholder="Current" value={g.current} onChange={(e) => updateGoal(g.id, 'current', Number(e.target.value))} />
                    <input type="number" className="input mono" placeholder="Target" value={g.target} onChange={(e) => updateGoal(g.id, 'target', Number(e.target.value))} />
                    <input type="date" className="input" value={g.targetDate} onChange={(e) => updateGoal(g.id, 'targetDate', e.target.value)} />
                    <button className="icon-btn" onClick={() => removeGoal(g.id)}><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
              <button className="btn-secondary" onClick={addGoal}><Plus size={14} /> Add goal</button>
            </div>

            <div className="card">
              <div className="card-title">Recurring items</div>
              {recurringItems.map((r) => (
                <div key={r.id} className="goal-row">
                  <input className="input" value={r.name} onChange={(e) => updateRecurring(r.id, 'name', e.target.value)} />
                  <div className="goal-row-numbers">
                    <input type="number" className="input mono" placeholder="Amount" value={r.amount} onChange={(e) => updateRecurring(r.id, 'amount', Number(e.target.value))} />
                    <input className="input mono" placeholder="Currency" value={r.currency} onChange={(e) => updateRecurring(r.id, 'currency', e.target.value)} />
                    <select className="input select" value={r.frequency} onChange={(e) => updateRecurring(r.id, 'frequency', e.target.value)}>
                      <option value="monthly">monthly</option>
                      <option value="weekly">weekly</option>
                      <option value="yearly">yearly</option>
                    </select>
                    <select className="input select" value={r.direction} onChange={(e) => updateRecurring(r.id, 'direction', e.target.value)}>
                      <option value="in">in</option>
                      <option value="out">out</option>
                    </select>
                    <button className="icon-btn" onClick={() => removeRecurring(r.id)}><Trash2 size={14} /></button>
                  </div>
                  <input className="input" placeholder="Category" value={r.category || ''} onChange={(e) => updateRecurring(r.id, 'category', e.target.value)} style={{ marginTop: 6 }} />
                </div>
              ))}
              <button className="btn-secondary" onClick={addRecurring}><Plus size={14} /> Add recurring item</button>
            </div>

            <div className="card">
              <div className="card-title">Life log</div>
              <div className="row">
                <input className="input" placeholder="Add a note for your CFO…" value={lifeNoteDraft} onChange={(e) => setLifeNoteDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addStandaloneLifeNote(); }} />
                <button className="btn-secondary" onClick={addStandaloneLifeNote}><Plus size={14} /></button>
              </div>
              {[...lifeLog].reverse().map((l) => (
                <div className="kv" key={l.id}>
                  <span><span className="mono" style={{ marginRight: 8 }}>{l.date}</span>{l.text}</span>
                  <button className="icon-btn" onClick={() => removeLifeLogEntry(l.id)}><Trash2 size={14} /></button>
                </div>
              ))}
              {lifeLog.length === 0 && <p className="muted-text">Nothing logged yet — add context here or via Update.</p>}
            </div>

            <div className="card">
              <div className="card-title">Known gaps</div>
              {knownGaps.map((g, i) => (
                <div className="row" key={i}>
                  <textarea className="input" rows={2} value={g} onChange={(e) => updateKnownGap(i, e.target.value)} />
                  <button className="icon-btn" onClick={() => removeKnownGap(i)}><Trash2 size={14} /></button>
                </div>
              ))}
              <button className="btn-secondary" onClick={addKnownGap}><Plus size={14} /> Add known gap</button>
              {knownGaps.length === 0 && <p className="muted-text">No open gaps — nice and tidy.</p>}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

const baseCSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

* { box-sizing: border-box; }

.loading-screen {
  font-family: 'IBM Plex Mono', monospace;
  color: #7A8699;
  padding: 40px;
  text-align: center;
}

.cfo {
  font-family: 'IBM Plex Sans', sans-serif;
  background: #F7F3EA;
  color: #1B2430;
  min-height: 100%;
  max-width: 720px;
  margin: 0 auto;
}

.masthead {
  background: #101C2E;
  color: #F7F3EA;
  padding: 22px 20px;
}
.masthead-eyebrow {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #C9A24A;
  margin-bottom: 10px;
}
.masthead-main {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}
.masthead-figure {
  font-family: 'Fraunces', serif;
  font-size: 32px;
  font-weight: 600;
}
.masthead-figure-secondary {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 14px;
  font-weight: 400;
  color: rgba(247,243,234,0.55);
}
.masthead-sub { font-size: 13px; margin-top: 4px; }
.masthead-split {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11.5px;
  color: rgba(247,243,234,0.6);
  margin-top: 4px;
}
.masthead-date {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  color: rgba(247,243,234,0.55);
}

.tabs {
  display: flex;
  background: #FFFFFF;
  border-bottom: 1px solid rgba(27,36,48,0.08);
  position: sticky;
  top: 0;
  z-index: 5;
  overflow-x: auto;
}
.tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px 8px;
  font-size: 12px;
  font-weight: 500;
  color: #7A8699;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  white-space: nowrap;
}
.tab.active { color: #101C2E; border-bottom-color: #C9A24A; }

.content { padding: 16px; }
.stack { display: flex; flex-direction: column; gap: 14px; }

.card {
  background: #FFFFFF;
  border: 1px solid rgba(27,36,48,0.08);
  border-radius: 8px;
  padding: 14px;
}
.card-title {
  font-family: 'Fraunces', serif;
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 10px;
}
.gap-card { border-color: rgba(201,162,74,0.4); background: #FBF6E8; }

.stat-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.stat-card {
  background: #FFFFFF;
  border: 1px solid rgba(27,36,48,0.10);
  border-radius: 6px;
  padding: 12px;
}
.stat-label {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #7A8699;
  margin-bottom: 4px;
}
.stat-value {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 16px;
  font-weight: 600;
}
.stat-sub {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10.5px;
  color: #7A8699;
  margin-top: 2px;
}
.pos { color: #5E8C7C; }
.neg { color: #BD5B3A; }

.kv-table { display: flex; flex-direction: column; gap: 2px; }
.kv {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12.5px;
  padding: 6px 0;
  border-bottom: 1px solid rgba(27,36,48,0.06);
  gap: 10px;
}
.kv:last-child { border-bottom: none; }
.mono { font-family: 'IBM Plex Mono', monospace; }

.tag {
  font-size: 9px;
  text-transform: uppercase;
  color: #C9A24A;
  border: 1px solid #C9A24A;
  border-radius: 3px;
  padding: 1px 4px;
  margin-left: 4px;
}

.risk-bar {
  display: flex;
  height: 10px;
  border-radius: 5px;
  overflow: hidden;
  background: #E4DCC8;
  margin-bottom: 10px;
}
.risk-bar-segment { height: 100%; }
.risk-bar-legend { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 12px; }
.risk-legend-item {
  display: flex; align-items: center; gap: 5px;
  font-size: 11.5px; font-family: 'IBM Plex Mono', monospace; color: #5A6677;
}
.risk-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }

.recurring-list { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
.recurring-row {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; padding: 5px 0;
  border-bottom: 1px solid rgba(27,36,48,0.06);
}
.recurring-row:last-child { border-bottom: none; }
.recurring-name { flex: 1; }
.recurring-amount { color: #5A6677; }
.flow-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.flow-in { background: #5E8C7C; }
.flow-out { background: #BD5B3A; }

.dial-row { display: flex; flex-wrap: wrap; gap: 14px; justify-content: flex-start; }
.dial { display: flex; flex-direction: column; align-items: center; width: 110px; }
.dial-label { font-size: 12px; font-weight: 500; text-align: center; margin-top: 4px; }

.field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
.field label {
  font-size: 11px; color: #7A8699; font-family: 'IBM Plex Mono', monospace;
}
.input {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 13px;
  padding: 8px 10px;
  border: 1px solid rgba(27,36,48,0.18);
  border-radius: 4px;
  background: #FBF9F4;
  color: #1B2430;
  width: 100%;
}
.input.mono { font-family: 'IBM Plex Mono', monospace; }
.input.select { max-width: 110px; }
textarea.input { resize: vertical; }

.grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
@media (max-width: 480px) {
  .grid-2 { grid-template-columns: 1fr; }
  .stat-row { grid-template-columns: 1fr 1fr; }
}

.section-label {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #C9A24A;
  margin: 14px 0 8px;
  border-top: 1px solid rgba(27,36,48,0.10);
  padding-top: 10px;
}

.btn-primary {
  display: inline-flex; align-items: center; gap: 6px;
  background: #101C2E; color: #F7F3EA;
  border: none; border-radius: 4px;
  padding: 10px 18px; font-size: 13px; font-weight: 500;
  cursor: pointer; margin-top: 6px;
  width: 100%; justify-content: center;
}
.btn-primary:disabled { opacity: 0.5; cursor: default; }

.btn-secondary {
  display: inline-flex; align-items: center; gap: 6px;
  background: none; border: 1px solid rgba(27,36,48,0.2);
  border-radius: 4px; padding: 7px 12px; font-size: 12.5px;
  color: #1B2430; cursor: pointer; margin-top: 4px;
}

.row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
.row .input:first-child { flex: 1; }

.goal-row { border-bottom: 1px solid rgba(27,36,48,0.08); padding-bottom: 10px; margin-bottom: 10px; }
.goal-row > .input { margin-bottom: 8px; }
.goal-row-numbers { display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 8px; align-items: end; }

.checkbox-label {
  display: flex; align-items: center; gap: 6px;
  font-size: 11.5px; color: #7A8699;
  margin-top: 8px; cursor: pointer;
}
.checkbox-label input { cursor: pointer; }

.icon-btn { background: none; border: none; color: #BD5B3A; cursor: pointer; padding: 6px; display: flex; }

.muted-text { font-size: 12.5px; color: #7A8699; line-height: 1.5; }
.error-text { font-size: 12.5px; color: #BD5B3A; margin-top: 8px; }

/* Chat */
.chat-wrap { display: flex; flex-direction: column; gap: 10px; height: calc(100vh - 200px); min-height: 420px; }
.chat-thread { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding-right: 2px; }
.chat-bubble {
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.55;
  max-width: 92%;
}
.chat-assistant { background: #FFFFFF; border: 1px solid rgba(27,36,48,0.08); align-self: flex-start; }
.chat-user { background: #101C2E; color: #F7F3EA; align-self: flex-end; }
.chat-loading { color: #7A8699; font-style: italic; }
.md-h { font-family: 'Fraunces', serif; font-size: 14.5px; font-weight: 600; margin: 8px 0 4px; }
.md-h:first-child { margin-top: 0; }
.md-p { margin: 0 0 6px; }
.md-list { margin: 0 0 6px; padding-left: 18px; }
.chat-user .md-p { color: #F7F3EA; }

.quick-prompts { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  font-size: 11.5px;
  border: 1px solid rgba(27,36,48,0.18);
  background: #FFFFFF;
  border-radius: 14px;
  padding: 6px 12px;
  cursor: pointer;
  color: #1B2430;
}

.chat-input-row { display: flex; gap: 8px; align-items: flex-end; }
.chat-textarea { min-height: 44px; max-height: 120px; }
.send-btn {
  background: #101C2E; color: #F7F3EA;
  border: none; border-radius: 4px;
  width: 44px; height: 44px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0;
}
.send-btn:disabled { opacity: 0.4; cursor: default; }
.attach-btn {
  background: none; color: #1B2430;
  border: 1px solid rgba(27,36,48,0.18); border-radius: 4px;
  width: 44px; height: 44px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0;
}
.attachment-chip {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; background: #FFFFFF;
  border: 1px solid rgba(27,36,48,0.15); border-radius: 14px;
  padding: 4px 10px; align-self: flex-start;
}
.attachment-thumb { width: 20px; height: 20px; object-fit: cover; border-radius: 3px; }
.chat-image { max-width: 100%; border-radius: 6px; margin-bottom: 6px; display: block; }
.file-chip {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; background: rgba(27,36,48,0.06);
  border-radius: 12px; padding: 4px 10px; margin-bottom: 6px;
}
`;

# Expense Tracker

A free expense tracker with WeChat Pay and Alipay bill import.
Offline-first: works instantly with zero setup (data in your browser),
and optionally syncs across devices with a free Supabase backend —
no paid APIs, no subscriptions.

## Run it

No install, no server. Unzip and double-click **index.html** —
or host the folder anywhere static (GitHub Pages, Vercel).
On your phone: open the hosted link → Share → Add to Home Screen
for a full-screen app icon (PWA).

## Backend (optional, free)

The app is offline-first: everything works without any setup.
To sync across devices:

1. Create a free project at **supabase.com** —
   no credit card needed.
2. **SQL Editor → New query** → paste `supabase-setup.sql` → Run.
3. **Authentication → Sign In / Providers** → turn OFF "Confirm email"
   (under User Signups) → Save.
4. **Project Settings → Data API / API Keys** → copy the **Project URL**
   and the **publishable key** (`sb_publishable_…`) into `config.js`.
   Never use the secret key.

Then open the app, create an account, and sign in — existing local data
syncs up automatically, and every change syncs in the background
(last-write-wins). Sign-in is only needed once per device.

## What it does

- **Dashboard** — this month's spend with % vs last month, category donut
  chart, 30-day spending bars, per-category breakdown (tap a category to
  filter the expense list)
- **Expenses** — searchable/filterable list, add + edit, category pills
  with icons, "Needs review" inbox for uncategorized imports
- **Budgets** — monthly budget per category with progress bars and
  overspend warnings
- **Import** — upload WeChat Pay or Alipay bill exports (.csv / .xlsx);
  platform auto-detected, income and refunds filtered, duplicates skipped.
  **Review screen before anything is saved**: each row shows its proposed
  category, you can fix them inline, then confirm.
- **Auto-categorization** — deterministic engine, no AI needed:
  your rules → merchant memory (learns from every correction you make) →
  HK-savvy keyword defaults (bilingual) → review inbox for the rest
- **Multi-currency** — per-transaction currency kept; toggle display
  between CNY and HKD with your own conversion rate
- **Settings** — display currency, backup (export JSON) / restore,
  backend status + manual sync + sign out, delete-all-data
  (also deletes the cloud copy when signed in)

## Importing WeChat / Alipay bills

There is no free API for personal WeChat/Alipay data, so the flow is
export-then-upload (steps are also shown in the app). Note: the WeChat
export below is verified for the **mainland RMB wallet** only — we could
not verify a file-export option on WeChat Pay HK.

**WeChat Pay (mainland RMB wallet):** 我 (Me) → 服务 (Services) →
钱包 (Wallet) → 账单 (Bill, top-right) → ··· → 下载账单 (Download Bill) →
用于个人对账 (For Personal Reconciliation, not 用作证明材料) →
face-verify → the bill arrives in the 微信支付 chat → 查看详情 →
download. If it's a zip, unzip it first, then upload the .csv/.xlsx here.

**Alipay (mainland):** 我的 (Me) → 账单 (Bill) → ··· →
开具交易流水证明 → 用于个人对账 (For Personal Reconciliation) →
wait for the message → download the file → upload the .csv/.xlsx here.

The parser skips WeChat's leading metadata lines, handles GBK/UTF-8
encodings, and reads .xlsx in the browser via SheetJS (CDN).

## Files

- `index.html` — all views (dashboard, expenses, budgets, import, auth)
- `app.js` — UI logic, charts (inline SVG, no chart library), auth + boot
- `db.js` — data layer (expenses, merchant memory, rules,
  budgets, settings, backup/restore) + sync dirty-queue
- `sync.js` — offline-first sync engine (push/pull, last-write-wins)
- `sb.js` — Supabase client wrapper (auth + table ops)
- `config.js` — paste your Supabase URL + publishable key here
- `supabase-setup.sql` — backend schema + row-level security (run once)
- `categorize.js` — auto-categorization engine + bilingual category
  metadata (icons, colors) + HK keyword set
- `importers.js` — WeChat/Alipay CSV/XLSX parsing and dedupe
- `style.css` — all styling, mobile-first, no frameworks
- `manifest.json` / `sw.js` / `icon-*.png` — PWA install + offline shell
- `build_preview.py` — builds the single-file in-chat preview

## Notes

- Amounts convert for display only, using your own CNY→HKD rate —
  no live FX API needed.
- Old v1 data migrates automatically (existing rows keep their
  categories and won't flood the review inbox).

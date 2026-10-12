# Expense Tracker

A free, self-hosted expense tracker with WeChat Pay and Alipay bill import.
No paid APIs, no subscriptions — everything runs locally.

## Stack (all free)

- **Flask** — web framework (open source)
- **SQLite** — database via Python stdlib (no server, no cost)
- **Vanilla HTML/CSS/JS** — no frontend framework, no build step

## Quick start

```bash
cd expense-tracker
pip install -r requirements.txt
python app.py
```

Open http://localhost:5001

## What it does

- **Dashboard** — total spend, breakdown by category and by platform,
  monthly trend, month filter
- **Expenses** — searchable/filterable list, manual add, delete
- **Import** — upload WeChat Pay or Alipay bill exports (.csv / .xlsx);
  platform auto-detected, income and refunds auto-filtered,
  duplicates skipped by transaction ID

## Importing WeChat / Alipay bills

There is no free API for personal WeChat/Alipay data, so the flow is
export-then-upload:

**WeChat Pay:** Me → Services → Wallet → Bills → FAQ → Download Bill →
"For Personal Reconciliation" → enter email → unzip the emailed file →
upload the .csv/.xlsx here.

**Alipay:** My → Settings → Bills → ··· → Get Transaction Statement →
"For Personal Reconciliation" → tick "Show Counterparty Info" and
"Show Product Description Info" → enter email → upload the file here.

The parser skips WeChat's leading metadata lines, handles GBK/UTF-8
encodings, and reads .xlsx with only the stdlib (no extra dependencies).

## Deploying to Render (free)

1. Push this folder to a GitHub repo
2. In Render: New → Blueprint → point at the repo (`render.yaml`)
3. The 1GB persistent disk keeps `expenses.db` across deploys

Why not Vercel: serverless filesystems are ephemeral — SQLite data
would be wiped. Render's free tier includes a persistent disk.

## Notes

- Data lives in `expenses.db` (created automatically; `DB_PATH` env var
  overrides the location).
- Amounts are stored as entered — no live FX conversion (would need a
  paid API).

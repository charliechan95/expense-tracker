"""Database models for the Expense Tracker.

SQLite via stdlib — no paid APIs, no external services.
"""
import os
import sqlite3
from datetime import datetime

DB_PATH = os.environ.get("DB_PATH", "expenses.db")

PLATFORMS = [
    ("wechat", "WeChat Pay"),
    ("alipay", "Alipay"),
    ("cash", "Cash"),
    ("bank", "Bank Card"),
    ("other", "Other"),
]
PLATFORM_LABELS = dict(PLATFORMS)

DEFAULT_CATEGORIES = [
    "Food & Drink",
    "Transport",
    "Shopping",
    "Housing",
    "Utilities",
    "Health",
    "Entertainment",
    "Travel",
    "Education",
    "Other",
]


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            amount REAL NOT NULL,
            currency TEXT NOT NULL DEFAULT 'CNY',
            category TEXT NOT NULL DEFAULT 'Other',
            platform TEXT NOT NULL DEFAULT 'other',
            merchant TEXT,
            description TEXT,
            expense_date TEXT NOT NULL,
            external_id TEXT,
            source TEXT DEFAULT 'manual',
            created_at TEXT NOT NULL
        )
        """
    )
    cur.execute(
        """CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_external
           ON expenses(external_id) WHERE external_id IS NOT NULL"""
    )
    conn.commit()
    conn.close()


def now_iso():
    return datetime.utcnow().isoformat(timespec="seconds")


def create_expense(data):
    """Insert one expense. Returns id, or None if duplicate external_id."""
    conn = get_db()
    cur = conn.cursor()
    try:
        cur.execute(
            """INSERT INTO expenses
               (amount, currency, category, platform, merchant, description,
                expense_date, external_id, source, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                data["amount"],
                data.get("currency", "CNY"),
                data.get("category", "Other"),
                data.get("platform", "other"),
                data.get("merchant"),
                data.get("description"),
                data["expense_date"],
                data.get("external_id"),
                data.get("source", "manual"),
                now_iso(),
            ),
        )
    except sqlite3.IntegrityError:
        conn.close()
        return None  # duplicate
    eid = cur.lastrowid
    conn.commit()
    conn.close()
    return eid


def list_expenses(platform=None, category=None, month=None, search=None,
                  limit=200):
    conn = get_db()
    cur = conn.cursor()
    clauses, params = [], []
    if platform:
        clauses.append("platform = ?")
        params.append(platform)
    if category:
        clauses.append("category = ?")
        params.append(category)
    if month:
        clauses.append("substr(expense_date, 1, 7) = ?")
        params.append(month)
    if search:
        like = f"%{search}%"
        clauses.append("(merchant LIKE ? OR description LIKE ?)")
        params.extend([like, like])
    q = "SELECT * FROM expenses"
    if clauses:
        q += " WHERE " + " AND ".join(clauses)
    q += " ORDER BY expense_date DESC, id DESC LIMIT ?"
    params.append(limit)
    cur.execute(q, params)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


def delete_expense(expense_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM expenses WHERE id = ?", (expense_id,))
    conn.commit()
    ok = cur.rowcount > 0
    conn.close()
    return ok


def summary_by_category(month=None):
    conn = get_db()
    cur = conn.cursor()
    q = "SELECT category, SUM(amount) AS total, COUNT(*) AS n FROM expenses"
    params = []
    if month:
        q += " WHERE substr(expense_date, 1, 7) = ?"
        params.append(month)
    q += " GROUP BY category ORDER BY total DESC"
    cur.execute(q, params)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


def summary_by_platform(month=None):
    conn = get_db()
    cur = conn.cursor()
    q = "SELECT platform, SUM(amount) AS total, COUNT(*) AS n FROM expenses"
    params = []
    if month:
        q += " WHERE substr(expense_date, 1, 7) = ?"
        params.append(month)
    q += " GROUP BY platform ORDER BY total DESC"
    cur.execute(q, params)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


def monthly_totals(limit=12):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """SELECT substr(expense_date, 1, 7) AS month,
                  SUM(amount) AS total, COUNT(*) AS n
           FROM expenses
           GROUP BY month ORDER BY month DESC LIMIT ?""",
        (limit,),
    )
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return list(reversed(rows))


def grand_total(month=None):
    conn = get_db()
    cur = conn.cursor()
    q = "SELECT SUM(amount) AS total, COUNT(*) AS n FROM expenses"
    params = []
    if month:
        q += " WHERE substr(expense_date, 1, 7) = ?"
        params.append(month)
    cur.execute(q, params)
    row = cur.fetchone()
    conn.close()
    return {"total": row["total"] or 0, "count": row["n"]}

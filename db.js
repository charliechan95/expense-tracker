/* Expense Tracker — static data layer.
   localStorage-backed, no backend. Mirrors the Flask models.py API. */
"use strict";

const PLATFORMS = [
  ["wechat", "WeChat Pay"],
  ["alipay", "Alipay"],
  ["cash", "Cash"],
  ["bank", "Bank Card"],
  ["other", "Other"],
];
const PLATFORM_LABELS = Object.fromEntries(PLATFORMS);

const DEFAULT_CATEGORIES = [
  "Food & Drink", "Transport", "Shopping", "Housing", "Utilities",
  "Health", "Entertainment", "Travel", "Education", "Other",
];

const DB = {
  _read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  _write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },
  _nextId() {
    const n = (parseInt(localStorage.getItem("exp_seq") || "0", 10) || 0) + 1;
    localStorage.setItem("exp_seq", String(n));
    return n;
  },
  nowIso() {
    return new Date().toISOString().slice(0, 19);
  },

  create(data) {
    const list = this._read("exp_expenses", []);
    // Deduplicate by external_id
    if (data.external_id && list.some((e) => e.external_id === data.external_id)) {
      return null;
    }
    const exp = {
      id: this._nextId(),
      amount: parseFloat(data.amount),
      currency: data.currency || "CNY",
      category: data.category || "Other",
      platform: data.platform || "other",
      merchant: data.merchant || null,
      description: data.description || null,
      expense_date: data.expense_date,
      external_id: data.external_id || null,
      source: data.source || "manual",
      created_at: this.nowIso(),
    };
    list.push(exp);
    this._write("exp_expenses", list);
    return exp.id;
  },

  list({ platform, category, month, search, limit = 200 } = {}) {
    let list = this._read("exp_expenses", []);
    if (platform) list = list.filter((e) => e.platform === platform);
    if (category) list = list.filter((e) => e.category === category);
    if (month) list = list.filter((e) => (e.expense_date || "").startsWith(month));
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((e) =>
        ((e.merchant || "") + " " + (e.description || "")).toLowerCase().includes(q)
      );
    }
    list.sort((a, b) =>
      (b.expense_date || "").localeCompare(a.expense_date || "") || b.id - a.id
    );
    return list.slice(0, limit);
  },

  remove(id) {
    const list = this._read("exp_expenses", []);
    const i = list.findIndex((e) => String(e.id) === String(id));
    if (i < 0) return false;
    list.splice(i, 1);
    this._write("exp_expenses", list);
    return true;
  },

  _inMonth(list, month) {
    return month ? list.filter((e) => (e.expense_date || "").startsWith(month)) : list;
  },

  byCategory(month) {
    const map = {};
    for (const e of this._inMonth(this._read("exp_expenses", []), month)) {
      const c = e.category || "Other";
      map[c] = map[c] || { category: c, total: 0, n: 0 };
      map[c].total += e.amount;
      map[c].n++;
    }
    return Object.values(map).sort((a, b) => b.total - a.total);
  },

  byPlatform(month) {
    const map = {};
    for (const e of this._inMonth(this._read("exp_expenses", []), month)) {
      const p = e.platform || "other";
      map[p] = map[p] || { platform: p, total: 0, n: 0 };
      map[p].total += e.amount;
      map[p].n++;
    }
    return Object.values(map).sort((a, b) => b.total - a.total);
  },

  monthlyTotals(limit = 12) {
    const map = {};
    for (const e of this._read("exp_expenses", [])) {
      const m = (e.expense_date || "").slice(0, 7);
      if (!m) continue;
      map[m] = map[m] || { month: m, total: 0, n: 0 };
      map[m].total += e.amount;
      map[m].n++;
    }
    return Object.values(map)
      .sort((a, b) => b.month.localeCompare(a.month))
      .slice(0, limit)
      .reverse();
  },

  grandTotal(month) {
    let total = 0, n = 0;
    for (const e of this._inMonth(this._read("exp_expenses", []), month)) {
      total += e.amount;
      n++;
    }
    return { total, count: n };
  },

  months() {
    return this.monthlyTotals(60).map((m) => m.month).reverse();
  },
};

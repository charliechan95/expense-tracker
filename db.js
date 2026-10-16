/* Expense Tracker — static data layer.
   localStorage-backed, no backend. Mirrors the Flask models.py API. */
"use strict";

/* Storage shim: prefers localStorage, falls back to in-memory storage when
   the page runs somewhere localStorage is blocked (e.g. a sandboxed preview
   iframe). The app keeps working; data just doesn't persist across reloads. */
const _memStore = Object.create(null);
const storage = (() => {
  try {
    localStorage.setItem("__exp_probe__", "1");
    localStorage.removeItem("__exp_probe__");
    return localStorage;
  } catch {
    return {
      getItem: (k) => (k in _memStore ? _memStore[k] : null),
      setItem: (k, v) => { _memStore[k] = String(v); },
      removeItem: (k) => { delete _memStore[k]; },
    };
  }
})();

const PLATFORMS = [
  ["wechat", "WeChat Pay"],
  ["alipay", "Alipay"],
  ["cash", "Cash"],
  ["bank", "Bank Card"],
  ["other", "Other"],
];
const PLATFORM_LABELS = Object.fromEntries(PLATFORMS);

const DEFAULT_CATEGORIES = [
  "Food & Drink", "Groceries", "Transport", "Shopping", "Housing", "Utilities",
  "Health", "Entertainment", "Travel", "Education", "Personal", "Other",
];

const DB = {
  _read(key, fallback) {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  _write(key, value) {
    storage.setItem(key, JSON.stringify(value));
  },
  _nextId() {
    const n = (parseInt(storage.getItem("exp_seq") || "0", 10) || 0) + 1;
    storage.setItem("exp_seq", String(n));
    return n;
  },
  nowIso() {
    return new Date().toISOString().slice(0, 19);
  },

  /* ---- Cloud sync bookkeeping (offline-first) ---------------------------
     Every mutation queues a dirty entry; Sync pushes them in the background.
     Guarded so the data layer works with or without sync.js loaded. */
  _syncQueue() {
    return this._read("exp_sync_queue", []);
  },
  markSyncDirty(table, op, ref, extra) {
    const q = this._syncQueue();
    q.push(Object.assign({ table, op, ref, at: this.nowIso() }, extra || {}));
    this._write("exp_sync_queue", q);
    if (typeof Sync !== "undefined") Sync.schedule();
  },
  takeSyncQueue() {
    const q = this._syncQueue();
    this._write("exp_sync_queue", []);
    return q;
  },
  lastPull(table) {
    return (this._read("exp_last_pull", {}))[table] || null;
  },
  setLastPull(table, iso) {
    const m = this._read("exp_last_pull", {});
    m[table] = iso;
    this._write("exp_last_pull", m);
  },

  create(data) {
    const list = this._read("exp_expenses", []);
    // Deduplicate by external_id
    if (data.external_id && list.some((e) => e.external_id === data.external_id)) {
      return null;
    }
    const exp = {
      id: this._nextId(),
      cloud_id: null,
      amount: parseFloat(data.amount),
      currency: data.currency || "CNY",
      category: data.category || "Other",
      platform: data.platform || "other",
      merchant: data.merchant || null,
      description: data.description || null,
      expense_date: data.expense_date,
      external_id: data.external_id || null,
      source: data.source || "manual",
      cat_source: data.cat_source || "manual",
      created_at: this.nowIso(),
      updated_at: this.nowIso(),
    };
    list.push(exp);
    this._write("exp_expenses", list);
    this.markSyncDirty("expenses", "upsert", exp.id);
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
    const [gone] = list.splice(i, 1);
    this._write("exp_expenses", list);
    this.markSyncDirty("expenses", "delete", id, { cloud_id: gone.cloud_id || null });
    return true;
  },

  /* ---- Import batch history -------------------------------------------
     Local-only records of completed bill imports. Each batch remembers the
     expense ids it created so a mistaken import can be undone. */
  importBatches() {
    return this._read("exp_import_batches", []);
  },
  recordImportBatch(batch) {
    const list = this.importBatches();
    list.unshift(batch);
    this._write("exp_import_batches", list.slice(0, 20));
  },
  removeImportBatch(id) {
    this._write(
      "exp_import_batches",
      this.importBatches().filter((b) => String(b.id) !== String(id))
    );
  },

  _inMonth(list, month) {
    return month ? list.filter((e) => (e.expense_date || "").startsWith(month)) : list;
  },

  /* Amount converted to the user's display currency. */
  _disp(e) {
    return this.toDisplay(e.amount, e.currency);
  },

  byCategory(month) {
    const map = {};
    for (const e of this._inMonth(this._read("exp_expenses", []), month)) {
      const c = e.category || "Other";
      map[c] = map[c] || { category: c, total: 0, n: 0 };
      map[c].total += this._disp(e);
      map[c].n++;
    }
    const out = Object.values(map).sort((a, b) => b.total - a.total);
    // Rows show cents-rounded values; round the summed total the same way
    // so the rows always add up to the total.
    for (const r of out) r.total = this._toCents(r.total);
    return out;
  },

  byPlatform(month) {
    const map = {};
    for (const e of this._inMonth(this._read("exp_expenses", []), month)) {
      const p = e.platform || "other";
      map[p] = map[p] || { platform: p, total: 0, n: 0 };
      map[p].total += this._disp(e);
      map[p].n++;
    }
    const out = Object.values(map).sort((a, b) => b.total - a.total);
    for (const r of out) r.total = this._toCents(r.total);
    return out;
  },

  monthlyTotals(limit = 12) {
    const map = {};
    for (const e of this._read("exp_expenses", [])) {
      const m = (e.expense_date || "").slice(0, 7);
      if (!m) continue;
      map[m] = map[m] || { month: m, total: 0, n: 0 };
      map[m].total += this._disp(e);
      map[m].n++;
    }
    const out = Object.values(map)
      .sort((a, b) => b.month.localeCompare(a.month))
      .slice(0, limit)
      .reverse();
    for (const r of out) r.total = this._toCents(r.total);
    return out;
  },

  grandTotal(month) {
    let total = 0, n = 0;
    for (const e of this._inMonth(this._read("exp_expenses", []), month)) {
      total += this._disp(e);
      n++;
    }
    return { total: this._toCents(total), count: n };
  },

  months() {
    return this.monthlyTotals(60).map((m) => m.month).reverse();
  },

  /* ---- v2 additions: edit, categorization memory, budgets, settings ---- */

  update(id, data) {
    const list = this._read("exp_expenses", []);
    const e = list.find((x) => String(x.id) === String(id));
    if (!e) return false;
    for (const k of ["currency", "platform", "merchant", "description", "expense_date"]) {
      if (data[k] !== undefined) e[k] = data[k];
    }
    if (data.amount !== undefined && data.amount !== "") e.amount = parseFloat(data.amount);
    if (data.category && data.category !== e.category) {
      this.setCategory(id, data.category, true);
      return true;
    }
    e.updated_at = this.nowIso();
    this._write("exp_expenses", list);
    this.markSyncDirty("expenses", "upsert", e.id);
    return true;
  },

  /* Recategorize + teach the merchant memory. Every manual correction
     makes the next import smarter. */
  setCategory(id, category, learn = true) {
    const list = this._read("exp_expenses", []);
    const e = list.find((x) => String(x.id) === String(id));
    if (!e || !category) return false;
    e.category = category;
    e.cat_source = "manual";
    e.updated_at = this.nowIso();
    this._write("exp_expenses", list);
    this.markSyncDirty("expenses", "upsert", e.id);
    if (learn && e.merchant) this.learnMerchant(e.merchant, category);
    return true;
  },

  bulkSetCategory(ids, category) {
    const idset = new Set(ids.map(String));
    const list = this._read("exp_expenses", []);
    let n = 0;
    for (const e of list) {
      if (idset.has(String(e.id))) {
        e.category = category;
        e.cat_source = "manual";
        e.updated_at = this.nowIso();
        n++;
        this.markSyncDirty("expenses", "upsert", e.id);
        if (e.merchant) this.learnMerchant(e.merchant, category);
      }
    }
    this._write("exp_expenses", list);
    return n;
  },

  getMerchantMemory() {
    return this._read("exp_merchant_memory", {});
  },

  learnMerchant(merchant, category) {
    const key = String(merchant || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || !category || category === "Other") return;
    const mem = this.getMerchantMemory();
    mem[key] = category;
    this._write("exp_merchant_memory", mem);
    this.markSyncDirty("memory", "upsert", key);
  },

  getUserRules() {
    return this._read("exp_user_rules", []);
  },

  addUserRule(pattern, category) {
    const rules = this.getUserRules();
    const rule = { id: Date.now(), cloud_id: null, pattern: String(pattern).trim(), category };
    rules.push(rule);
    this._write("exp_user_rules", rules);
    this.markSyncDirty("rules", "upsert", rule.id);
  },

  removeUserRule(id) {
    const rules = this.getUserRules();
    const gone = rules.find((r) => String(r.id) === String(id));
    this._write("exp_user_rules",
      rules.filter((r) => String(r.id) !== String(id)));
    if (gone) this.markSyncDirty("rules", "delete", id, { cloud_id: gone.cloud_id || null });
  },

  getBudgets(month) {
    return (this._read("exp_budgets", {}))[month] || {};
  },

  setBudget(month, category, amount) {
    const all = this._read("exp_budgets", {});
    const m = all[month] || {};
    const v = parseFloat(amount);
    if (v > 0) {
      m[category] = v;
      this.markSyncDirty("budgets", "upsert", month + "|" + category);
    } else {
      delete m[category];
      this.markSyncDirty("budgets", "delete", month + "|" + category);
    }
    all[month] = m;
    this._write("exp_budgets", all);
  },

  getSettings() {
    return Object.assign(
      { display_currency: "CNY", cny_to_hkd: 1.08 },
      this._read("exp_settings", {})
    );
  },

  saveSettings(patch) {
    this._write("exp_settings", Object.assign(this.getSettings(), patch));
    this.markSyncDirty("settings", "upsert", "settings");
  },

  toDisplay(amount, currency) {
    const s = this.getSettings();
    const from = String(currency || "CNY").toUpperCase();
    const to = String(s.display_currency || "CNY").toUpperCase();
    // Rows and totals both go through here: always round to cents so a
    // converted row shows exactly what the totals sum up.
    if (from === to) return this._toCents(amount);
    const rate = parseFloat(s.cny_to_hkd) || 1;
    if (from === "CNY" && to === "HKD") return this._toCents(amount * rate);
    if (from === "HKD" && to === "CNY") return this._toCents(amount / rate);
    return this._toCents(amount);
  },

  _toCents(n) {
    return Math.round((parseFloat(n) || 0) * 100) / 100;
  },

  displaySymbol() {
    return (this.getSettings().display_currency || "CNY").toUpperCase() === "HKD"
      ? "HK$" : "¥";
  },

  needsReview() {
    return this._read("exp_expenses", [])
      .filter((e) => e.cat_source === "unreviewed")
      .sort((a, b) => (b.expense_date || "").localeCompare(a.expense_date || ""));
  },

  exportAll() {
    return {
      app: "expense-tracker",
      version: 3,
      exported_at: this.nowIso(),
      expenses: this._read("exp_expenses", []),
      merchant_memory: this.getMerchantMemory(),
      user_rules: this.getUserRules(),
      budgets: this._read("exp_budgets", {}),
      settings: this.getSettings(),
      import_batches: this.importBatches(),
    };
  },

  importAll(data) {
    if (!data || data.app !== "expense-tracker" || !Array.isArray(data.expenses)) {
      const err = new Error("Not a valid expense-tracker backup file.");
      err.code = "invalid_backup";
      throw err;
    }
    this._write("exp_expenses", data.expenses);
    this._write("exp_merchant_memory", data.merchant_memory || {});
    this._write("exp_user_rules", data.user_rules || []);
    this._write("exp_budgets", data.budgets || {});
    if (data.settings) this._write("exp_settings", data.settings);
    this._write("exp_import_batches", data.import_batches || []);
    const maxId = data.expenses.reduce((m, e) => Math.max(m, parseInt(e.id, 10) || 0), 0);
    storage.setItem("exp_seq", String(maxId));
    // Restored data needs a full push on next sync.
    storage.setItem("exp_sync_reseed", "1");
    if (typeof Sync !== "undefined") Sync.schedule();
  },

  /* Remove every local app-data key (used by "Delete all data" and by
     sign-out). Cloud rows are never touched here. The guest-mode flag
     (exp_guest) is session state and is cleared separately. */
  wipeLocal() {
    for (const k of ["exp_expenses", "exp_merchant_memory", "exp_user_rules",
                     "exp_budgets", "exp_settings", "exp_seq", "exp_migrated_v2",
                     "exp_import_batches", "exp_sync_queue", "exp_last_pull",
                     "exp_sync_reseed"]) {
      storage.removeItem(k);
    }
  },

  /* One-time: old rows (v1) have no cat_source — treat as user-confirmed
     so they don't flood the review inbox. Also backfills the sync fields. */
  migrate() {
    if (storage.getItem("exp_migrated_v2")) return;
    const list = this._read("exp_expenses", []);
    let changed = false;
    for (const e of list) {
      if (!e.cat_source) { e.cat_source = "manual"; changed = true; }
      if (!e.updated_at) { e.updated_at = e.created_at || this.nowIso(); changed = true; }
      if (!("cloud_id" in e)) { e.cloud_id = null; changed = true; }
    }
    if (changed) this._write("exp_expenses", list);
    const rules = this._read("exp_user_rules", []);
    let rChanged = false;
    for (const r of rules) {
      if (!("cloud_id" in r)) { r.cloud_id = null; rChanged = true; }
    }
    if (rChanged) this._write("exp_user_rules", rules);
    storage.setItem("exp_migrated_v2", "1");
  },
};

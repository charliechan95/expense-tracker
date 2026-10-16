/* Expense Tracker — offline-first sync engine.
   Local storage stays the UI's source of truth (instant, works offline).
   This mirrors changes to Supabase in the background:
     - every local mutation queues a dirty entry (see DB.markSyncDirty)
     - push: upserts/deletes by cloud key (idempotent — safe to retry)
     - pull: last-write-wins on updated_at; detects remote deletes
   Single-user scale; no conflict UI — newest timestamp wins. */
"use strict";

const Sync = {
  status: "local", // local | ready | syncing | synced | error
  lastError: null,
  _running: false,
  _timer: null,

  _setStatus(s, detail) {
    this.status = s;
    if (typeof renderSyncStatus === "function") renderSyncStatus(detail);
  },

  /* Debounced push after local edits. */
  schedule() {
    if (!Cloud.signedIn()) return;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.syncNow(), 2500);
  },

  async syncNow() {
    if (!Cloud.signedIn() || this._running) return;
    this._running = true;
    this._setStatus("syncing");
    try {
      if (storage.getItem("exp_sync_reseed")) {
        this._enqueueAll();
        storage.removeItem("exp_sync_reseed");
      }
      await this._pushQueue();
      await this._pullAll();
      this.lastError = null;
      this._setStatus("synced");
      if (typeof renderAll === "function") renderAll();
    } catch (e) {
      this.lastError = (e && e.message) || String(e);
      this._setStatus("error");
    }
    this._running = false;
  },

  /* ---- push ---------------------------------------------------------- */
  async _pushQueue() {
    const q = DB.takeSyncQueue();
    if (!q.length) return;
    try {
      for (const item of q) await this._pushItem(item);
    } catch (e) {
      // Upserts/deletes are idempotent: re-queue the whole batch safely.
      DB._write("exp_sync_queue", q.concat(DB._read("exp_sync_queue", [])));
      throw e;
    }
  },

  /* UUID for cloud rows, assigned client-side before the first push so every
     upsert carries a real id (Postgres rejects an explicit NULL id). */
  _newUuid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  },

  async _pushItem(item) {
    const uid = Cloud.user().id;
    switch (item.table) {
      case "expenses": {
        if (item.op === "delete") {
          if (item.cloud_id) return Cloud.remove("expenses", "id", [item.cloud_id]);
          return null;
        }
        const list = DB._read("exp_expenses", []);
        const e = list.find((x) => String(x.id) === String(item.ref));
        if (!e) return null;
        if (!e.cloud_id) {
          e.cloud_id = this._newUuid();
          DB._write("exp_expenses", list);
        }
        const row = {
          id: e.cloud_id,
          user_id: uid,
          amount: e.amount, currency: e.currency, category: e.category,
          merchant: e.merchant, description: e.description, platform: e.platform,
          expense_date: e.expense_date || null, external_id: e.external_id,
          source: e.source, cat_source: e.cat_source,
          created_at: e.created_at, updated_at: e.updated_at,
        };
        // Imported rows carry external_id: dedupe against the
        // (user_id, external_id) unique index so a re-push of the same bill
        // (e.g. imported on two devices) becomes an update, never a
        // unique-violation that would poison the queue. Manual rows have no
        // external_id and keep deduping on their stable cloud id.
        const conflict = e.external_id ? "user_id,external_id" : "id";
        const saved = await Cloud.upsert("expenses", [row], conflict);
        const savedId = saved && saved[0] && saved[0].id;
        if (savedId && savedId !== e.cloud_id) {
          // Another device pushed this bill first: adopt the surviving
          // cloud id so the local ↔ cloud mapping stays correct.
          e.cloud_id = savedId;
          DB._write("exp_expenses", list);
        }
        return saved;
      }
      case "memory": {
        const mem = DB.getMerchantMemory();
        const cat = mem[item.ref];
        if (!cat) return null;
        return Cloud.upsert("merchant_memory",
          [{ user_id: uid, merchant: item.ref, category: cat, updated_at: DB.nowIso() }],
          "user_id,merchant");
      }
      case "rules": {
        if (item.op === "delete") {
          if (item.cloud_id) return Cloud.remove("user_rules", "id", [item.cloud_id]);
          return null;
        }
        const list = DB.getUserRules();
        const r = list.find((x) => String(x.id) === String(item.ref));
        if (!r) return null;
        if (!r.cloud_id) {
          r.cloud_id = this._newUuid();
          DB._write("exp_user_rules", list);
        }
        const row = { id: r.cloud_id, user_id: uid,
                      pattern: r.pattern, category: r.category };
        return Cloud.upsert("user_rules", [row], "id");
      }
      case "budgets": {
        const [month, category] = String(item.ref).split("|");
        if (item.op === "delete") {
          return Cloud.removeWhere("budgets", { user_id: uid, category, month });
        }
        const amt = (DB.getBudgets(month))[category];
        if (!amt) return null;
        return Cloud.upsert("budgets",
          [{ user_id: uid, category, month, amount: amt, updated_at: DB.nowIso() }],
          "user_id,category,month");
      }
      case "settings": {
        const s = DB.getSettings();
        return Cloud.upsert("app_settings",
          [{ user_id: uid, display_currency: s.display_currency,
             cny_hkd_rate: s.cny_to_hkd || null, updated_at: DB.nowIso() }],
          "user_id");
      }
      default:
        return null;
    }
  },

  /* Queue everything (first sign-in with existing local data). */
  _enqueueAll() {
    for (const e of DB._read("exp_expenses", []))
      DB.markSyncDirty("expenses", "upsert", e.id);
    for (const k of Object.keys(DB.getMerchantMemory()))
      DB.markSyncDirty("memory", "upsert", k);
    for (const r of DB.getUserRules())
      DB.markSyncDirty("rules", "upsert", r.id);
    const all = DB._read("exp_budgets", {});
    for (const month of Object.keys(all))
      for (const cat of Object.keys(all[month]))
        DB.markSyncDirty("budgets", "upsert", month + "|" + cat);
    DB.markSyncDirty("settings", "upsert", "settings");
  },

  /* ---- pull ----------------------------------------------------------- */
  async _pullAll() {
    await this._pullExpenses();
    await this._pullRules();
    await this._pullMemory();
    await this._pullBudgets();
    await this._pullSettings();
  },

  _pullExpenses() {
    return Cloud.fetchAll("expenses").then((rows) => {
      const local = DB._read("exp_expenses", []);
      const byCloud = new Map(local.filter((e) => e.cloud_id).map((e) => [e.cloud_id, e]));
      const byExternal = new Map(
        local.filter((e) => e.external_id).map((e) => [e.external_id, e]));
      const seen = new Set();
      let changed = false;
      for (const r of rows) {
        seen.add(r.id);
        let e = byCloud.get(r.id);
        if (!e && r.external_id && byExternal.has(r.external_id)) {
          // Same bill arrived under a cloud id this device doesn't know
          // (another device pushed it first): adopt the id instead of
          // creating a duplicate local row.
          e = byExternal.get(r.external_id);
          e.cloud_id = r.id;
          byCloud.set(r.id, e);
          changed = true;
        }
        if (!e) {
          local.push({
            id: DB._nextId(), cloud_id: r.id,
            amount: parseFloat(r.amount), currency: r.currency, category: r.category,
            merchant: r.merchant, description: r.description, platform: r.platform,
            expense_date: r.expense_date, external_id: r.external_id,
            source: r.source, cat_source: r.cat_source,
            created_at: r.created_at, updated_at: r.updated_at,
          });
          changed = true;
        } else if ((r.updated_at || "") > (e.updated_at || "")) {
          Object.assign(e, {
            amount: parseFloat(r.amount), currency: r.currency, category: r.category,
            merchant: r.merchant, description: r.description, platform: r.platform,
            expense_date: r.expense_date, external_id: r.external_id,
            source: r.source, cat_source: r.cat_source, updated_at: r.updated_at,
          });
          changed = true;
        }
      }
      // Remote deletes: had a cloud id, gone from cloud, not edited since last pull.
      const lastPull = DB.lastPull("expenses");
      for (let i = local.length - 1; i >= 0; i--) {
        const e = local[i];
        if (e.cloud_id && !seen.has(e.cloud_id) && lastPull && (e.updated_at || "") <= lastPull) {
          local.splice(i, 1);
          changed = true;
        }
      }
      if (changed) DB._write("exp_expenses", local);
      DB.setLastPull("expenses", new Date().toISOString());
    });
  },

  _pullRules() {
    return Cloud.fetchAll("user_rules").then((rows) => {
      const local = DB.getUserRules();
      const byCloud = new Map(local.filter((r) => r.cloud_id).map((r) => [r.cloud_id, r]));
      const seen = new Set();
      let changed = false;
      for (const r of rows) {
        seen.add(r.id);
        const l = byCloud.get(r.id);
        if (!l) {
          local.push({ id: Date.now() + Math.floor(Math.random() * 1000),
                       cloud_id: r.id, pattern: r.pattern, category: r.category });
          changed = true;
        }
      }
      const lastPull = DB.lastPull("rules");
      for (let i = local.length - 1; i >= 0; i--) {
        const l = local[i];
        if (l.cloud_id && !seen.has(l.cloud_id) && lastPull) {
          local.splice(i, 1);
          changed = true;
        }
      }
      if (changed) DB._write("exp_user_rules", local);
      DB.setLastPull("rules", new Date().toISOString());
    });
  },

  _pullMemory() {
    return Cloud.fetchAll("merchant_memory").then((rows) => {
      const lastPull = DB.lastPull("memory");
      const mem = DB.getMerchantMemory();
      let changed = false;
      for (const r of rows) {
        const key = String(r.merchant || "").toLowerCase().trim();
        if (key && (!lastPull || (r.updated_at || "") > lastPull) && mem[key] !== r.category) {
          mem[key] = r.category;
          changed = true;
        }
      }
      if (changed) DB._write("exp_merchant_memory", mem);
      DB.setLastPull("memory", new Date().toISOString());
    });
  },

  _pullBudgets() {
    return Cloud.fetchAll("budgets").then((rows) => {
      const lastPull = DB.lastPull("budgets");
      const all = DB._read("exp_budgets", {});
      let changed = false;
      for (const r of rows) {
        if (!lastPull || (r.updated_at || "") > lastPull) {
          all[r.month] = all[r.month] || {};
          if (all[r.month][r.category] !== parseFloat(r.amount)) {
            all[r.month][r.category] = parseFloat(r.amount);
            changed = true;
          }
        }
      }
      if (changed) DB._write("exp_budgets", all);
      DB.setLastPull("budgets", new Date().toISOString());
    });
  },

  _pullSettings() {
    return Cloud.fetchAll("app_settings").then((rows) => {
      const lastPull = DB.lastPull("settings");
      const r = rows[0];
      if (r && (!lastPull || (r.updated_at || "") > lastPull)) {
        const cur = DB.getSettings();
        const next = Object.assign({}, cur, {
          display_currency: r.display_currency || cur.display_currency,
          cny_to_hkd: r.cny_hkd_rate != null ? parseFloat(r.cny_hkd_rate) : cur.cny_to_hkd,
        });
        DB._write("exp_settings", next);
      }
      DB.setLastPull("settings", new Date().toISOString());
    });
  },

  /* Delete all cloud rows for this user (used by "Delete all data"). */
  async wipeCloud() {
    const uid = Cloud.user().id;
    for (const t of ["expenses", "merchant_memory", "user_rules", "budgets", "app_settings"]) {
      await Cloud.removeWhere(t, { user_id: uid });
    }
  },
};

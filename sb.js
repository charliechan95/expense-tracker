/* Expense Tracker — cloud adapter (Supabase).
   Thin wrapper around supabase-js. All data access goes through Sync;
   nothing else in the app talks to this directly except the auth UI. */
"use strict";

const Cloud = {
  client: null,
  _user: null,

  configured() {
    return typeof BACKEND !== "undefined" && !!(BACKEND.url && BACKEND.key);
  },
  ready() {
    return this.configured() && typeof supabase !== "undefined";
  },
  signedIn() {
    return !!this._user;
  },
  user() {
    return this._user;
  },

  /* Guest mode: fully local use while the backend is configured. The flag
     lives in localStorage so it survives reloads; sign-out clears it.
     Sync stays off because signedIn() is false. */
  guest() {
    return typeof storage !== "undefined" && storage.getItem("exp_guest") === "1";
  },
  enterGuest() {
    if (typeof storage !== "undefined") storage.setItem("exp_guest", "1");
    this._user = null;
  },
  exitGuest() {
    if (typeof storage !== "undefined") storage.removeItem("exp_guest");
  },

  async init() {
    if (!this.ready()) return false;
    this.client = supabase.createClient(BACKEND.url, BACKEND.key);
    try {
      const { data } = await this.client.auth.getSession();
      this._user = data.session ? data.session.user : null;
    } catch {
      this._user = null;
    }
    this.client.auth.onAuthStateChange((_event, session) => {
      const wasIn = !!this._user;
      this._user = session ? session.user : null;
      if (typeof onCloudAuthChange === "function") onCloudAuthChange(this._user, wasIn);
    });
    return true;
  },

  async signUp(email, password) {
    const { data, error } = await this.client.auth.signUp({ email, password });
    if (error) throw error;
    this._user = data.user;
    return data.user;
  },

  async signIn(email, password) {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this._user = data.user;
    return data.user;
  },

  async signOut() {
    await this.client.auth.signOut();
    const wasIn = !!this._user;
    this._user = null;
    // Update the UI directly — don't rely solely on the auth event round-trip.
    if (typeof onCloudAuthChange === "function") onCloudAuthChange(null, wasIn);
  },

  /* Generic table ops used by the sync engine. Rows must already include
     user_id and (for upserts) the key columns. Returns the saved rows. */
  async upsert(table, rows, onConflict) {
    if (!rows.length) return [];
    const { data, error } = await this.client
      .from(table).upsert(rows, { onConflict }).select();
    if (error) throw error;
    return data || [];
  },

  async remove(table, keyCol, ids) {
    if (!ids.length) return;
    const { error } = await this.client.from(table).delete().in(keyCol, ids);
    if (error) throw error;
  },

  async removeWhere(table, match) {
    const { error } = await this.client.from(table).delete().match(match);
    if (error) throw error;
  },

  async fetchAll(table) {
    const { data, error } = await this.client.from(table).select("*");
    if (error) throw error;
    return data || [];
  },
};

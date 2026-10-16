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

  /* Password recovery: set when this page load arrived from a reset
     email link (the URL hash carries type=recovery before supabase-js
     consumes it, and the auth listener fires PASSWORD_RECOVERY). While
     set, the app must show the set-new-password form instead of
     entering the app on the recovery session. */
  _recovery: false,
  recoveryPending() {
    return !!this._recovery;
  },
  clearRecovery() {
    this._recovery = false;
  },

  async init() {
    if (!this.ready()) return false;
    if (typeof location !== "undefined" && /type=recovery/.test(location.hash || "")) {
      this._recovery = true;
    }
    this.client = supabase.createClient(BACKEND.url, BACKEND.key);
    try {
      const { data } = await this.client.auth.getSession();
      this._user = data.session ? data.session.user : null;
    } catch {
      this._user = null;
    }
    this.client.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") this._recovery = true;
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

  /* Google sign-in (OAuth). Needs the Google provider enabled in the
     Supabase dashboard with this page as an allowed redirect; when it
     isn't, supabase-js returns an "Unsupported provider" error and the
     UI shows a plain-language message instead of failing silently.
     Signing in with the same email as an existing password account
     lands in that same account (Supabase links by verified email). */
  async signInWithGoogle() {
    const redirectTo = location.origin + location.pathname;
    const { data, error } = await this.client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) throw error;
    return data;
  },

  /* Sends the password-reset email; the link lands back on this page
     with a recovery session (see _recovery above). */
  /* Passwordless sign-in: Supabase emails a one-time link; opening it
     on this device signs the user in (a new email creates the account). */
  async signInWithMagicLink(email) {
    const redirectTo = location.origin + location.pathname;
    const { error } = await this.client.auth.signInWithOtp({
      email, options: { emailRedirectTo: redirectTo },
    });
    if (error) throw error;
  },

  async resetPassword(email) {
    const redirectTo = location.origin + location.pathname;
    const { error } = await this.client.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
  },

  /* Completes the recovery flow: sets the new password on the
     recovery session's account. */
  async updatePassword(newPassword) {
    const { data, error } = await this.client.auth.updateUser({ password: newPassword });
    if (error) throw error;
    if (data && data.user) this._user = data.user;
    return data ? data.user : null;
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

/* Backend config — Supabase.
   1. Create a free project at supabase.com (sign in with GitHub).
   2. SQL Editor → paste supabase-setup.sql → Run.
   3. Authentication → Providers → Email → turn OFF "Confirm email".
   4. Settings → API → copy Project URL + publishable key below.
   Leave both empty to run in local-only mode (data stays in this browser). */
const BACKEND = {
  url: "https://cgbtthjtnznedyxwtmuo.supabase.co",
  key: "sb_publishable_Oyf_FJz-UyfpH6maO-nDhg_d4-wAaRv", // publishable key — safe to ship in the app. NEVER the secret key.
};

/* Expense Tracker — static UI. Renders from db.js, no backend. */
"use strict";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fmt(n) { return (n || 0).toFixed(2); }

/* ---- Tabs --------------------------------------------------------------- */
document.querySelectorAll("[data-tab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-tab]").forEach((b) =>
      b.classList.toggle("active", b === btn));
    document.querySelectorAll(".view").forEach((v) =>
      v.classList.toggle("active", v.id === "view-" + btn.dataset.tab));
  });
});

/* ---- Dashboard ----------------------------------------------------------- */
function renderDashboard() {
  const month = document.getElementById("dash-month").value || null;
  const total = DB.grandTotal(month);
  document.getElementById("dash-total").textContent = fmt(total.total);
  document.getElementById("dash-count").textContent = total.count;
  document.getElementById("dash-month-label").textContent = month ? `(${month})` : "";

  document.getElementById("by-cat").innerHTML =
    DB.byCategory(month).map((r) =>
      `<tr><td>${esc(r.category)}</td><td>${fmt(r.total)}</td><td>${r.n}</td></tr>`
    ).join("") || `<tr><td colspan="3" class="muted">No data yet.</td></tr>`;

  document.getElementById("by-plat").innerHTML =
    DB.byPlatform(month).map((r) =>
      `<tr><td>${esc(PLATFORM_LABELS[r.platform] || r.platform)}</td>
       <td>${fmt(r.total)}</td><td>${r.n}</td></tr>`
    ).join("") || `<tr><td colspan="3" class="muted">No data yet.</td></tr>`;

  document.getElementById("monthly").innerHTML =
    DB.monthlyTotals().map((m) =>
      `<tr><td><a href="#" data-month="${m.month}">${m.month}</a></td>
       <td>${fmt(m.total)}</td><td>${m.n}</td></tr>`
    ).join("") || `<tr><td colspan="3" class="muted">No data yet.</td></tr>`;

  document.querySelectorAll("[data-month]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      document.getElementById("dash-month").value = a.dataset.month;
      renderDashboard();
    });
  });
}

function refreshMonthOptions() {
  const sel = document.getElementById("dash-month");
  const cur = sel.value;
  sel.innerHTML = `<option value="">All time</option>` +
    DB.months().map((m) => `<option value="${m}">${m}</option>`).join("");
  sel.value = cur;
}
document.getElementById("dash-month").addEventListener("change", renderDashboard);

/* ---- Expenses list -------------------------------------------------------- */
const filters = { q: "", platform: "", category: "", month: "" };

function renderExpenses() {
  const list = DB.list({
    platform: filters.platform || null,
    category: filters.category || null,
    month: filters.month || null,
    search: filters.q || null,
  });
  document.getElementById("expense-rows").innerHTML = list.length
    ? list.map((e) => `
      <tr>
        <td>${esc(e.expense_date)}</td>
        <td><strong>${esc(e.merchant || "—")}</strong>
          ${e.description ? `<div class="muted">${esc(e.description)}</div>` : ""}</td>
        <td>${esc(e.category)}</td>
        <td>${esc(PLATFORM_LABELS[e.platform] || e.platform)}</td>
        <td>${fmt(e.amount)} ${esc(e.currency)}</td>
        <td><button data-del="${e.id}">Delete</button></td>
      </tr>`).join("")
    : `<tr><td colspan="6" class="muted">No expenses yet.</td></tr>`;

  document.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (confirm("Delete this expense?")) {
        DB.remove(btn.dataset.del);
        renderAll();
      }
    });
  });
}

document.getElementById("f-apply").addEventListener("click", () => {
  filters.q = document.getElementById("f-q").value.trim();
  filters.platform = document.getElementById("f-platform").value;
  filters.category = document.getElementById("f-category").value;
  filters.month = document.getElementById("f-month").value;
  renderExpenses();
});

/* ---- New expense dialog ---------------------------------------------------- */
document.getElementById("f-plat").innerHTML =
  PLATFORMS.map(([p, l]) => `<option value="${p}">${esc(l)}</option>`).join("");
document.getElementById("f-platform").innerHTML =
  `<option value="">All platforms</option>` +
  PLATFORMS.map(([p, l]) => `<option value="${p}">${esc(l)}</option>`).join("");
document.getElementById("f-cat").innerHTML =
  DEFAULT_CATEGORIES.map((c) => `<option>${esc(c)}</option>`).join("");
document.getElementById("f-category").innerHTML =
  `<option value="">All categories</option>` +
  DEFAULT_CATEGORIES.map((c) => `<option>${esc(c)}</option>`).join("");
document.getElementById("f-date").value =
  new Date().toISOString().slice(0, 10);

const dlg = document.getElementById("dlg-expense");
document.getElementById("btn-new-expense").addEventListener("click", () =>
  dlg.showModal());
document.getElementById("btn-cancel-expense").addEventListener("click", () =>
  dlg.close());
document.getElementById("frm-expense").addEventListener("submit", (e) => {
  e.preventDefault();
  const data = {};
  new FormData(e.target).forEach((v, k) => { data[k] = v === "" ? null : v; });
  DB.create(data);
  e.target.reset();
  document.getElementById("f-date").value = new Date().toISOString().slice(0, 10);
  dlg.close();
  renderAll();
});

/* ---- Import ----------------------------------------------------------------- */
document.getElementById("btn-import").addEventListener("click", async () => {
  const file = document.getElementById("f-file").files[0];
  const out = document.getElementById("import-result");
  if (!file) { out.textContent = "Choose a file first."; return; }
  out.textContent = "Parsing…";
  try {
    const { platform, expenses } = await Importers.parseFile(file);
    if (!platform) {
      out.textContent = "Could not detect WeChat or Alipay format in this file.";
      return;
    }
    let added = 0, dupes = 0;
    for (const exp of expenses) {
      if (DB.create(exp)) added++;
      else dupes++;
    }
    out.textContent =
      `Detected ${platform === "wechat" ? "WeChat Pay" : "Alipay"}: ` +
      `${expenses.length} expense rows found, ${added} imported` +
      (dupes ? `, ${dupes} duplicates skipped` : "") + ".";
    renderAll();
  } catch (err) {
    out.textContent = "Import failed: " + err.message;
  }
});

/* ---- Boot -------------------------------------------------------------------- */
function renderAll() {
  refreshMonthOptions();
  renderDashboard();
  renderExpenses();
}
renderAll();

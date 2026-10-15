/* Expense Tracker v2 — static UI.
   Builds on the v1 foundation (tabs, filters, dialogs, import parsing)
   adding: auto-categorization, import review, visual dashboard, budgets,
   multi-currency, edit + review inbox, settings/backup. */
"use strict";

/* ---- Helpers -------------------------------------------------------------- */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fmt(n) { return (n || 0).toFixed(2); }
function money(n) { return DB.displaySymbol() + fmt(n); }

let toastTimer;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

function curMonth() {
  return new Date().toISOString().slice(0, 7);
}

/* ---- Tabs ------------------------------------------------------------------ */
function switchTab(name) {
  document.querySelectorAll("[data-tab]").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".view").forEach((v) =>
    v.classList.toggle("active", v.id === "view-" + name));
}
document.querySelectorAll("[data-tab]").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

/* ---- Dashboard -------------------------------------------------------------- */
function donutSVG(segs) {
  const R = 54, C = 2 * Math.PI * R;
  const total = segs.reduce((s, x) => s + x.total, 0);
  if (!total) {
    return `<circle cx="70" cy="70" r="${R}" fill="none" stroke="#e6e1d5" stroke-width="22"/>`;
  }
  let off = 0;
  return segs.map((s) => {
    const len = Math.max((s.total / total) * C, 0.5);
    const el =
      `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${s.color}" ` +
      `stroke-width="22" stroke-dasharray="${len.toFixed(1)} ${C.toFixed(1)}" ` +
      `stroke-dashoffset="${(-off).toFixed(1)}" transform="rotate(-90 70 70)"/>`;
    off += len;
    return el;
  }).join("");
}

function renderDashboard() {
  const month = document.getElementById("dash-month").value || null;
  const effMonth = month || curMonth();
  const total = DB.grandTotal(month);
  const sym = DB.displaySymbol();

  document.getElementById("dash-total").textContent = sym + fmt(total.total);
  document.getElementById("dash-count").textContent = total.count;
  document.getElementById("dash-month-label").textContent =
    month ? t("dash_in_month").replace("{m}", month) : t("dash_all_time");

  // Delta vs previous month (only when a month is selected)
  const deltaEl = document.getElementById("dash-delta");
  if (month) {
    const ms = DB.monthlyTotals(24);
    const i = ms.findIndex((m) => m.month === month);
    const prev = i >= 0 && i + 1 < ms.length ? ms[i + 1].total : null;
    if (prev != null && prev > 0) {
      const pct = ((total.total - prev) / prev) * 100;
      const up = pct > 0.5, down = pct < -0.5;
      deltaEl.textContent =
        (up ? "▲ +" : down ? "▼ " : "– ") + t("dash_vs_last").replace("{p}", Math.abs(pct).toFixed(0));
      deltaEl.className = "delta " + (up ? "up" : down ? "down" : "");
    } else {
      deltaEl.textContent = t("dash_first_month");
      deltaEl.className = "delta";
    }
  } else {
    deltaEl.textContent = "";
    deltaEl.className = "delta";
  }

  const cats = DB.byCategory(month);
  const top = cats[0];
  document.getElementById("dash-topcat").textContent =
    top ? `${catMeta(top.category).icon} ${top.category}` : "—";

  // Donut
  const segs = cats.slice(0, 8).map((r) => ({
    ...r, color: catMeta(r.category).color,
  }));
  document.getElementById("donut").innerHTML = donutSVG(segs);
  document.getElementById("donut-total").textContent = sym + fmt(total.total);
  document.getElementById("donut-ccy").textContent = DB.getSettings().display_currency;

  document.getElementById("cat-legend").innerHTML = segs.map((r) => {
    const m = catMeta(r.category);
    const pct = total.total ? ((r.total / total.total) * 100).toFixed(0) : 0;
    return `<div class="legend-row"><span class="dot" style="background:${m.color}"></span>` +
      `${m.icon} ${esc(r.category)} <span class="muted">${pct}%</span></div>`;
  }).join("") || `<div class="muted">${t("lbl_no_data")}</div>`;

  // Last-30-days bars
  const days = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const daySet = new Set(days);
  const perDay = {};
  for (const e of DB.list({ limit: 100000 })) {
    const day = (e.expense_date || "").slice(0, 10);
    if (daySet.has(day)) perDay[day] = (perDay[day] || 0) + DB.toDisplay(e.amount, e.currency);
  }
  const max = Math.max(1, ...days.map((d) => perDay[d] || 0));
  document.getElementById("bars").innerHTML = days.map((d) => {
    const v = perDay[d] || 0;
    const h = Math.max(v > 0 ? 4 : 0, (v / max) * 110);
    const peak = v > 0 && v === max ? " peak" : "";
    return `<div class="bar${peak}" style="height:${h.toFixed(0)}px" title="${d}: ${sym}${fmt(v)}"></div>`;
  }).join("");

  // Category rows (clickable -> filtered expenses)
  const maxCat = Math.max(1, ...cats.map((r) => r.total));
  document.getElementById("cat-rows").innerHTML = cats.map((r) => {
    const m = catMeta(r.category);
    return `<div class="cat-row" data-cat="${esc(r.category)}">
      <span class="cat-ico" style="--cat:${m.color}">${m.icon}</span>
      <span class="cat-name">${esc(r.category)} <span class="muted">${m.zh}</span></span>
      <div class="cat-bar"><i style="width:${((r.total / maxCat) * 100).toFixed(0)}%;background:${m.color}"></i></div>
      <span class="amount"><strong>${sym}${fmt(r.total)}</strong></span>
      <span class="muted">${r.n}</span>
    </div>`;
  }).join("") || `<div class="muted">${t("lbl_no_data_hint")}</div>`;

  document.querySelectorAll(".cat-row").forEach((row) => {
    row.addEventListener("click", () => {
      document.getElementById("f-category").value = row.dataset.cat;
      filters.category = row.dataset.cat;
      setChip("all");
      switchTab("expenses");
      renderExpenses();
    });
  });

  // Review banner
  const n = DB.needsReview().length;
  const banner = document.getElementById("review-banner");
  banner.style.display = n ? "flex" : "none";
  if (n) {
    document.getElementById("review-banner-text").textContent =
      (n > 1 ? t("review_banner_p") : t("review_banner_s")).replace("{n}", String(n));
  }
}
document.getElementById("review-banner-go").addEventListener("click", () => {
  setChip("review");
  switchTab("expenses");
  renderExpenses();
});

function refreshMonthOptions() {
  for (const id of ["dash-month", "budget-month"]) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    const cur = sel.value || curMonth();
    sel.innerHTML = (id === "dash-month" ? `<option value="">${t("opt_all_time")}</option>` : "") +
      DB.months().map((m) => `<option value="${m}">${m}</option>`).join("");
    sel.value = [...sel.options].some((o) => o.value === cur) ? cur : (sel.options[0] ? sel.options[0].value : "");
  }
}
document.getElementById("dash-month").addEventListener("change", renderDashboard);
document.getElementById("budget-month").addEventListener("change", renderBudgets);

/* ---- Expenses list ----------------------------------------------------------- */
const filters = { q: "", platform: "", category: "", month: "" };
let chip = "all";

function setChip(name) {
  chip = name;
  document.querySelectorAll("#expense-chips .chip").forEach((c) =>
    c.classList.toggle("active", c.dataset.chip === name));
  document.getElementById("bulk-bar").style.display = name === "review" ? "flex" : "none";
  document.querySelectorAll(".bulk-col").forEach((th) => {
    th.style.display = name === "review" ? "" : "none";
  });
}
document.querySelectorAll("#expense-chips .chip").forEach((c) => {
  c.addEventListener("click", () => { setChip(c.dataset.chip); renderExpenses(); });
});

function catPill(category) {
  const m = catMeta(category);
  return `<span class="cat-pill" style="--cat:${m.color}">${m.icon} ${esc(category)}</span>`;
}

function renderExpenses() {
  const n = DB.needsReview().length;
  document.getElementById("chip-review-n").textContent = n ? `(${n})` : "";

  let list;
  if (chip === "review") {
    list = DB.needsReview().filter((e) => {
      if (filters.q) {
        const q = filters.q.toLowerCase();
        const hay = ((e.merchant || "") + " " + (e.description || "")).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filters.platform && e.platform !== filters.platform) return false;
      if (filters.month && !(e.expense_date || "").startsWith(filters.month)) return false;
      return true;
    });
  } else {
    list = DB.list({
      platform: filters.platform || null,
      category: filters.category || null,
      month: filters.month || null,
      search: filters.q || null,
    });
  }

  const sym = DB.displaySymbol();
  const dispCcy = DB.getSettings().display_currency;
  document.getElementById("expense-rows").innerHTML = list.length
    ? list.map((e) => {
      const shown = DB.toDisplay(e.amount, e.currency);
      const orig = String(e.currency || "CNY").toUpperCase() !== dispCcy.toUpperCase()
        ? ` <span class="muted">(${esc(e.currency)} ${fmt(e.amount)})</span>` : "";
      return `<tr${e.cat_source === "unreviewed" ? ' class="needs-review"' : ""}>
        ${chip === "review" ? `<td class="bulk-col"><input type="checkbox" data-bulk="${e.id}"></td>` : ""}
        <td>${esc(e.expense_date)}</td>
        <td><strong>${esc(e.merchant || "—")}</strong>
          ${e.description ? `<div class="muted">${esc(e.description)}</div>` : ""}</td>
        <td>${catPill(e.category)}</td>
        <td>${esc(tPlat(e.platform) || e.platform)}</td>
        <td class="amount">${sym}${fmt(shown)}${orig}</td>
        <td class="row-actions">
          <button data-edit="${e.id}" title="${t("tt_edit")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l1-4.2L16.6 4.2a2.1 2.1 0 0 1 3 3L8 18.8 4 20z"/><path d="M14.8 6l3.2 3.2"/></svg></button>
          <button data-del="${e.id}" title="${t("tt_delete")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 7h15M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7"/><path d="M6.8 7l.9 12.2a1.5 1.5 0 0 0 1.5 1.4h5.6a1.5 1.5 0 0 0 1.5-1.4L17.2 7"/><path d="M10 11.2v5.4M14 11.2v5.4"/></svg></button>
        </td>
      </tr>`;
    }).join("")
    : `<tr><td colspan="7" class="muted">${chip === "review" ? t("review_empty") : t("exp_empty")}</td></tr>`;

  document.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (confirm(t("confirm_del"))) {
        DB.remove(btn.dataset.del);
        renderAll();
      }
    });
  });
  document.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => openExpenseDialog(btn.dataset.edit));
  });

  const bulkAll = document.getElementById("bulk-all");
  if (bulkAll) {
    bulkAll.checked = false;
    bulkAll.addEventListener("change", () => {
      document.querySelectorAll("[data-bulk]").forEach((cb) => { cb.checked = bulkAll.checked; });
      updateBulkCount();
    });
  }
  document.querySelectorAll("[data-bulk]").forEach((cb) => {
    cb.addEventListener("change", updateBulkCount);
  });
  updateBulkCount();
}

function updateBulkCount() {
  const n = document.querySelectorAll("[data-bulk]:checked").length;
  document.getElementById("bulk-count").textContent =
    t("bulk_selected").replace("{n}", String(n));
}
document.getElementById("bulk-apply").addEventListener("click", () => {
  const ids = [...document.querySelectorAll("[data-bulk]:checked")].map((cb) => cb.dataset.bulk);
  const cat = document.getElementById("bulk-cat").value;
  if (!ids.length || !cat) return;
  const done = DB.bulkSetCategory(ids, cat);
  toast(t("bulk_done").replace("{n}", String(done)));
  renderAll();
});

document.getElementById("f-apply").addEventListener("click", () => {
  filters.q = document.getElementById("f-q").value.trim();
  filters.platform = document.getElementById("f-platform").value;
  filters.category = document.getElementById("f-category").value;
  filters.month = document.getElementById("f-month").value;
  renderExpenses();
});

/* ---- Expense dialog (add + edit) ---------------------------------------------- */
let editingId = null;
const dlg = document.getElementById("dlg-expense");

function catOptions(selected) {
  return CATEGORY_IDS.map((c) =>
    `<option value="${esc(c)}"${c === selected ? " selected" : ""}>${catLabel(c)}</option>`
  ).join("");
}

function openExpenseDialog(id) {
  editingId = id || null;
  const form = document.getElementById("frm-expense");
  form.reset();
  document.getElementById("dlg-expense-title").textContent =
    editingId ? t("dlg_exp_edit") : t("dlg_exp_new");
  document.getElementById("f-cat").innerHTML = catOptions("Other");
  document.getElementById("f-currency").value = DB.getSettings().display_currency;
  document.getElementById("f-date").value = new Date().toISOString().slice(0, 10);
  document.getElementById("cat-hint").style.display = "none";
  if (editingId) {
    const e = DB.list({ limit: 100000 }).find((x) => String(x.id) === String(id));
    if (!e) return;
    document.getElementById("f-amount").value = e.amount;
    document.getElementById("f-currency").value = e.currency || "CNY";
    document.getElementById("f-date").value = e.expense_date || "";
    document.getElementById("f-cat").value = e.category || "Other";
    document.getElementById("f-plat").value = e.platform || "other";
    document.getElementById("f-merchant").value = e.merchant || "";
    form.elements.description.value = e.description || "";
  }
  dlg.showModal();
}

document.getElementById("btn-new-expense").addEventListener("click", () => openExpenseDialog(null));
document.getElementById("fab").addEventListener("click", () => openExpenseDialog(null));
document.getElementById("btn-cancel-expense").addEventListener("click", () => dlg.close());

/* Suggest a category as the merchant is typed — learned memory first. */
document.getElementById("f-merchant").addEventListener("blur", () => {
  if (editingId) return;
  const m = document.getElementById("f-merchant").value.trim();
  if (!m) return;
  const p = Categorizer.propose(m, "");
  const hint = document.getElementById("cat-hint");
  if (p.category) {
    document.getElementById("f-cat").value = p.category;
    hint.textContent = p.via === "memory"
      ? t("hint_memory").replace("{m}", m)
      : t("hint_keyword").replace("{cat}", catLabel(p.category));
    hint.style.display = "block";
  } else {
    hint.style.display = "none";
  }
});

document.getElementById("frm-expense").addEventListener("submit", (e) => {
  e.preventDefault();
  const data = {};
  new FormData(e.target).forEach((v, k) => { data[k] = v === "" ? null : v; });
  if (editingId) {
    DB.update(editingId, data);
    if (data.merchant && data.category) Categorizer.learn(data.merchant, data.category);
  } else {
    data.cat_source = "manual";
    DB.create(data);
    if (data.merchant && data.category && data.category !== "Other") {
      Categorizer.learn(data.merchant, data.category);
    }
  }
  editingId = null;
  dlg.close();
  renderAll();
  toast(t("saved"));
});

/* ---- Import: parse -> review -> commit ----------------------------------------- */
let reviewBatch = null;

document.getElementById("btn-import").addEventListener("click", async () => {
  const file = document.getElementById("f-file").files[0];
  const out = document.getElementById("import-result");
  if (!file) { out.textContent = t("imp_choose_first"); return; }
  out.textContent = t("imp_parsing");
  try {
    const { platform, expenses } = await Importers.parseFile(file);
    if (!platform) {
      out.textContent = t("imp_no_detect");
      return;
    }
    const existing = new Set(
      DB.list({ limit: 100000 }).map((x) => x.external_id).filter(Boolean)
    );
    const seen = new Set();
    reviewBatch = {
      platform,
      rows: expenses.map((exp) => {
        const p = Categorizer.propose(exp.merchant, exp.description);
        const dupe = (exp.external_id && (existing.has(exp.external_id) || seen.has(exp.external_id)));
        if (exp.external_id) seen.add(exp.external_id);
        return { ...exp, proposed: p.category, via: p.via,
                 initial: p.category || "Other", checked: !dupe, dupe: !!dupe };
      }),
    };
    out.textContent = "";
    renderReview();
    document.getElementById("review-card").style.display = "block";
    document.getElementById("review-card").scrollIntoView({ behavior: "smooth" });
  } catch (err) {
    out.textContent = t("imp_failed") + (err && err.code === "xlsx_missing" ? t("imp_xlsx_missing") : err.message);
  }
});

function renderReview() {
  if (!reviewBatch) return;
  const rows = reviewBatch.rows;
  const dupes = rows.filter((r) => r.dupe).length;
  const auto = rows.filter((r) => !r.dupe && r.proposed).length;
  const needEye = rows.filter((r) => !r.dupe && !r.proposed).length;
  const platLabel = reviewBatch.platform === "wechat" ? "WeChat Pay" : "Alipay";
  document.getElementById("review-summary").textContent =
    t("rev_summary").replace("{plat}", platLabel)
      .replace("{n}", String(rows.length))
      .replace("{d}", String(dupes))
      .replace("{a}", String(auto))
      .replace("{e}", String(needEye));

  document.getElementById("review-rows").innerHTML = rows.map((r, i) => `
    <tr class="${r.dupe ? "dupe" : ""}${!r.dupe && !r.proposed ? "needs-review" : ""}">
      <td><input type="checkbox" data-review="${i}"${r.checked ? " checked" : ""}${r.dupe ? " disabled" : ""}></td>
      <td>${esc(r.expense_date)}</td>
      <td><strong>${esc(r.merchant || "—")}</strong>
        ${r.description && r.description !== r.merchant ? `<div class="muted">${esc(r.description)}</div>` : ""}</td>
      <td class="amount">${fmt(r.amount)}</td>
      <td><select data-review-cat="${i}">
        ${CATEGORY_IDS.map((c) =>
          `<option value="${esc(c)}"${(r.proposed || "Other") === c ? " selected" : ""}>${catLabel(c)}</option>`
        ).join("")}
      </select>
      ${!r.dupe && !r.proposed ? `<div class="muted">${t("lbl_needs_review")}</div>` : ""}</td>
      <td>${r.dupe ? `<span class="muted">${t("lbl_duplicate")}</span>` : ""}</td>
    </tr>`).join("");

  document.getElementById("review-all").checked =
    rows.filter((r) => !r.dupe).every((r) => r.checked);
  document.querySelectorAll("[data-review]").forEach((cb) => {
    cb.addEventListener("change", () => {
      reviewBatch.rows[+cb.dataset.review].checked = cb.checked;
    });
  });
}

document.getElementById("review-all").addEventListener("change", (e) => {
  reviewBatch.rows.forEach((r, i) => {
    if (!r.dupe) {
      r.checked = e.target.checked;
      const cb = document.querySelector(`[data-review="${i}"]`);
      if (cb) cb.checked = r.checked;
    }
  });
});

document.getElementById("btn-review-cancel").addEventListener("click", () => {
  reviewBatch = null;
  document.getElementById("review-card").style.display = "none";
  document.getElementById("f-file").value = "";
});

document.getElementById("btn-review-confirm").addEventListener("click", () => {
  if (!reviewBatch) return;
  let added = 0;
  reviewBatch.rows.forEach((r, i) => {
    if (!r.checked || r.dupe) return;
    const sel = document.querySelector(`[data-review-cat="${i}"]`);
    const chosen = sel ? sel.value : r.initial;
    let cat_source;
    if (chosen !== r.initial) {
      // User overrode the proposal (or picked a category for an unknown row)
      cat_source = "manual";
      if (r.merchant && chosen !== "Other") Categorizer.learn(r.merchant, chosen);
    } else if (r.proposed) {
      cat_source = r.via;
    } else {
      // Left untouched and the engine had no proposal -> review inbox
      cat_source = "unreviewed";
    }
    if (DB.create({ ...r, category: chosen, cat_source })) added++;
  });
  const eye = DB.needsReview().length;
  reviewBatch = null;
  document.getElementById("review-card").style.display = "none";
  document.getElementById("f-file").value = "";
  renderAll();
  toast(t("import_done").replace("{n}", String(added)) +
    (eye ? t("import_done_review").replace("{e}", String(eye)) : ""));
});

/* ---- Budgets -------------------------------------------------------------------- */
function renderBudgets() {
  const sel = document.getElementById("budget-month");
  const month = (sel && sel.value) || curMonth();
  const spent = {};
  for (const r of DB.byCategory(month)) spent[r.category] = r.total;
  const budgets = DB.getBudgets(month);
  const sym = DB.displaySymbol();

  let totSpent = 0, totBudget = 0;
  const rows = CATEGORY_IDS.filter((c) => c !== "Other").map((c) => {
    const m = catMeta(c);
    const s = spent[c] || 0;
    const b = budgets[c] || 0;
    totSpent += s; totBudget += b;
    const pct = b > 0 ? Math.min((s / b) * 100, 100) : 0;
    const over = b > 0 && s > b;
    return `<div class="budget-row${over ? " over" : ""}">
      <span class="cat-ico" style="--cat:${m.color}">${m.icon}</span>
      <div class="budget-main">
        <div class="budget-top">
          <span><strong>${esc(c)}</strong> <span class="muted">${m.zh}</span></span>
          <span class="amount">${sym}${fmt(s)}${b > 0 ? ` <span class="muted">/ ${sym}${fmt(b)}</span>` : ""}</span>
        </div>
        <div class="progress"><i style="width:${pct.toFixed(0)}%;background:${over ? "#dc2626" : m.color}"></i></div>
        ${over ? `<div class="over-warn">${t("bud_over").replace("{a}", sym + fmt(s - b))}</div>` : ""}
      </div>
      <input type="number" min="0" step="1" class="budget-input" data-budget="${esc(c)}"
        placeholder="${t("ph_set_budget")}" value="${b > 0 ? b : ""}">
    </div>`;
  }).join("");

  document.getElementById("budget-rows").innerHTML =
    `<div class="card budget-summary">
       <span>${t("bud_spent")} <strong>${sym}${fmt(totSpent)}</strong></span>
       <span class="muted">${t("bud_of")}</span>
       <span>${t("bud_budget")} <strong>${sym}${fmt(totBudget)}</strong></span>
     </div>` + rows;

  document.querySelectorAll("[data-budget]").forEach((inp) => {
    inp.addEventListener("change", () => {
      DB.setBudget(month, inp.dataset.budget, inp.value);
      renderBudgets();
    });
  });
}

/* ---- Settings -------------------------------------------------------------------- */
document.getElementById("btn-settings").addEventListener("click", () => {
  openSettings();
});
document.getElementById("acct-chip").addEventListener("click", () => {
  openSettings();
  const s = document.getElementById("backend-status");
  if (s) s.scrollIntoView({ block: "center" });
});
function openSettings() {
  const s = DB.getSettings();
  document.getElementById("set-ccy").value = s.display_currency;
  document.getElementById("set-rate").value = s.cny_to_hkd;
  document.getElementById("dlg-settings").showModal();
}
document.getElementById("set-ccy").addEventListener("change", (e) => {
  DB.saveSettings({ display_currency: e.target.value });
  renderAll();
});
document.getElementById("set-rate").addEventListener("change", (e) => {
  const v = parseFloat(e.target.value);
  if (v > 0) {
    DB.saveSettings({ cny_to_hkd: v });
    renderAll();
  }
});
document.getElementById("btn-export-json").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(DB.exportAll(), null, 2)],
    { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `expense-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(t("backup_dl"));
});
document.getElementById("f-restore").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      DB.importAll(JSON.parse(rd.result));
      renderAll();
      toast(t("backup_restored"));
    } catch (err) {
      alert(t("restore_failed") + (err && err.code === "invalid_backup" ? t("backup_invalid") : err.message));
    }
  };
  rd.readAsText(f);
  e.target.value = "";
});
document.getElementById("btn-wipe").addEventListener("click", async () => {
  const cloudNote = Cloud.signedIn() ? t("wipe_cloud_note") : "";
  if (!confirm(t("wipe_confirm").replace("{note}", cloudNote))) return;
  if (Cloud.signedIn()) {
    try { await Sync.wipeCloud(); } catch (e) { toast(t("cloud_del_failed") + e.message); return; }
  }
  for (const k of ["exp_expenses", "exp_merchant_memory", "exp_user_rules",
                   "exp_budgets", "exp_settings", "exp_seq", "exp_migrated_v2",
                   "exp_sync_queue", "exp_last_pull", "exp_sync_reseed"]) {
    storage.removeItem(k);
  }
  renderAll();
  toast(t("wiped"));
});

/* ---- Selects ----------------------------------------------------------------------- */
function fillSelects() {
  document.getElementById("f-plat").innerHTML =
    PLATFORMS.map(([p]) => `<option value="${p}">${esc(tPlat(p))}</option>`).join("");
  document.getElementById("f-platform").innerHTML =
    `<option value="">${t("opt_all_platforms")}</option>` +
    PLATFORMS.map(([p]) => `<option value="${p}">${esc(tPlat(p))}</option>`).join("");
  document.getElementById("f-category").innerHTML =
    `<option value="">${t("opt_all_categories")}</option>` +
    CATEGORY_IDS.map((c) => `<option value="${esc(c)}">${catLabel(c)}</option>`).join("");
  document.getElementById("bulk-cat").innerHTML =
    CATEGORY_IDS.filter((c) => c !== "Other").map((c) =>
      `<option value="${esc(c)}">${catLabel(c)}</option>`).join("");
}

/* ---- Boot --------------------------------------------------------------------------- */
function renderAll() {
  DB.migrate();
  refreshMonthOptions();
  fillSelects();
  renderDashboard();
  renderExpenses();
  renderBudgets();
}

/* ---- Backend: auth + sync -------------------------------------------------------- */
function showApp() {
  document.body.classList.remove("signed-out");
  document.getElementById("view-auth").classList.remove("active");
}

function showAuthView() {
  document.body.classList.add("signed-out");
  document.getElementById("view-auth").classList.add("active");
}

/* Called by sb.js when the auth state changes. */
function onCloudAuthChange(user, wasIn) {
  if (user && !wasIn) {
    showApp();
    toast(t("signed_in"));
    Sync.syncNow();
  } else if (!user && wasIn) {
    showAuthView();
    toast(t("signed_out"));
  }
  renderSyncStatus();
}

function renderSyncStatus() {
  const pill = document.getElementById("backend-status");
  const detail = document.getElementById("backend-detail");
  const signout = document.getElementById("btn-signout");
  if (!pill) return;
  let label = t("sync_local"), cls = "";
  let det = t("sync_det_local");
  let showSignout = false;
  if (Cloud.configured()) {
    if (!Cloud.ready()) {
      label = t("sync_lib");
      det = t("sync_det_lib");
    } else if (!Cloud.signedIn()) {
      label = t("sync_out");
      det = t("sync_det_out");
    } else {
      showSignout = true;
      const email = (Cloud.user() && Cloud.user().email) || "";
      if (Sync.status === "syncing") {
        label = t("sync_ing");
        det = t("sync_det_ing").replace("{email}", email);
      } else if (Sync.status === "error") {
        label = t("sync_err"); cls = "err";
        det = t("sync_det_err").replace("{email}", email).replace("{err}", Sync.lastError || "unknown error");
      } else {
        label = t("sync_ok"); cls = "ok";
        det = t("sync_det_ok").replace("{email}", email);
      }
    }
  }
  pill.textContent = label;
  pill.className = "status-pill " + cls;
  detail.textContent = det;
  signout.style.display = showSignout ? "" : "none";
  const chip = document.getElementById("acct-chip");
  if (chip) {
    if (showSignout) {
      const email = (Cloud.user() && Cloud.user().email) || "?";
      chip.hidden = false;
      chip.textContent = email.trim().charAt(0).toUpperCase() || "?";
      chip.title = t("acct_title").replace("{email}", email);
    } else {
      chip.hidden = true;
    }
  }
}

function friendlyAuthError(e, mode) {
  const m = (e && e.message) || "Something went wrong";
  if (/invalid login credentials/i.test(m))
    return mode === "signup" ? t("auth_err_badcreds_signup") : t("auth_err_badcreds_signin");
  if (/already registered|already exists|duplicate/i.test(m))
    return t("auth_err_exists");
  if (/password.*(6|short|length)/i.test(m)) return t("auth_err_pw");
  if (/email/i.test(m) && /confirm/i.test(m))
    return t("auth_err_confirm");
  return m;
}

async function handleAuth(mode) {
  const email = document.getElementById("auth-email").value.trim();
  const pw = document.getElementById("auth-password").value;
  const err = document.getElementById("auth-error");
  err.style.display = "none";
  err.textContent = "";
  if (!email || !pw) {
    err.textContent = t("auth_err_empty");
    err.style.display = "block";
    return;
  }
  try {
    if (mode === "signup") await Cloud.signUp(email, pw);
    else await Cloud.signIn(email, pw);
    // onCloudAuthChange fires from sb.js → shows the app + syncs.
  } catch (e) {
    err.textContent = friendlyAuthError(e, mode);
    err.style.display = "block";
  }
}

document.getElementById("btn-signin").addEventListener("click", () => handleAuth("signin"));
document.getElementById("btn-signup").addEventListener("click", () => handleAuth("signup"));
document.getElementById("btn-signout").addEventListener("click", async () => {
  await Cloud.signOut();
});
document.getElementById("btn-sync-now").addEventListener("click", () => {
  if (!Cloud.signedIn()) {
    toast(Cloud.configured() ? t("signin_first") : t("backend_not_configured"));
    return;
  }
  Sync.syncNow();
  toast(t("sync_ing"));
});

function registerServiceWorker() {
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

/* Re-render language-sensitive dynamic UI on a language change. */
window.onLangChange = function () {
  renderSyncStatus();
  if (reviewBatch) renderReview();
};

async function boot() {
  fillSelects();
  document.getElementById("dash-month").value = curMonth();
  if (![...document.getElementById("dash-month").options].some((o) => o.value === curMonth())) {
    document.getElementById("dash-month").value = "";
  }
  renderAll();
  const backend = await Cloud.init();
  renderSyncStatus();
  if (backend && !Cloud.signedIn()) {
    showAuthView();
  } else {
    showApp();
    if (backend) Sync.syncNow();
  }
  registerServiceWorker();
}
boot();

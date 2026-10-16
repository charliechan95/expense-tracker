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
/* Symbol for a per-record currency code (imports are always CNY). */
function ccySym(code) { return String(code || "").toUpperCase() === "CNY" ? "¥" : "HK$"; }

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
  // Rows in currencies we cannot convert are excluded from the total above;
  // surface them as their own per-currency figures so nothing is hidden.
  const uncEl = document.getElementById("dash-unconverted");
  if (uncEl) {
    const unc = DB.unconvertedTotals(month);
    uncEl.textContent = unc.length
      ? t("dash_unconverted").replace("{list}", unc.map((u) => `${u.currency} ${fmt(u.total)}`).join(" · "))
      : "";
  }
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
    top ? top.category : "—";

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
      `<span class="legend-ico" style="--cat:${m.color}">${m.icon}</span> ${esc(r.category)} <span class="muted">${pct}%</span></div>`;
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
      // Browsing all time must not silently stop at the default cap;
      // a chosen month keeps the usual page size.
      limit: filters.month ? 200 : 100000,
    });
  }

  const sym = DB.displaySymbol();
  const dispCcy = DB.getSettings().display_currency;
  document.getElementById("expense-rows").innerHTML = list.length
    ? list.map((e) => {
      // Unconvertible rows (e.g. USD from a restored backup) are shown in
      // their own currency — never as a display-currency figure.
      const conv = DB.canConvert(e.currency);
      const orig = conv && String(e.currency || "CNY").toUpperCase() !== dispCcy.toUpperCase()
        ? ` <span class="muted">(${esc(e.currency)} ${fmt(e.amount)})</span>` : "";
      const shown = conv ? sym + fmt(DB.toDisplay(e.amount, e.currency)) + orig
                         : `${esc(e.currency)} ${fmt(e.amount)}`;
      return `<tr${e.cat_source === "unreviewed" ? ' class="needs-review"' : ""}>
        ${chip === "review" ? `<td class="bulk-col"><input type="checkbox" data-bulk="${e.id}"></td>` : ""}
        <td>${esc(e.expense_date)}</td>
        <td><strong>${esc(e.merchant || "—")}</strong>
          ${e.description ? `<div class="muted">${esc(e.description)}</div>` : ""}</td>
        <td>${catPill(e.category)}</td>
        <td>${esc(tPlat(e.platform) || e.platform)}</td>
        <td class="amount">${shown}</td>
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

// All-time browse: clear the month filter so every expense shows at once.
document.getElementById("f-all-time").addEventListener("click", () => {
  document.getElementById("f-month").value = "";
  filters.month = "";
  renderExpenses();
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

/* Shared review builder: takes parsed {platform, expenses} from the file
   path or the paste path and stages the pre-commit preview. */
function startReview(platform, expenses) {
  const existingByExt = new Map(
    DB.list({ limit: 100000 }).filter((x) => x.external_id)
      .map((x) => [x.external_id, x])
  );
  const seen = new Set();
  reviewBatch = {
    platform,
    rows: expenses.map((exp) => {
      const p = Categorizer.propose(exp.merchant,
        ((exp.description || "") + " " + (exp.txtype || "")).trim());
      const stored = exp.external_id ? existingByExt.get(exp.external_id) : null;
      // Enrichment upgrade: the stored row came from an earlier, poorer
      // parse (e.g. a statement read before its CJK names decoded) and
      // this parse has the merchant it lacks. Not a duplicate: on
      // confirm, the stored row is filled in — amount, date and any
      // user-set category are never overwritten.
      const upgrade = !!(stored && !(stored.merchant || "").trim() && (exp.merchant || "").trim());
      // exp.dupe: pre-set by callers that do their own best-effort dedupe
      // (screenshot rows carry no transaction number). Untouched otherwise.
      const dupe = !upgrade &&
        ((exp.external_id && (!!stored || seen.has(exp.external_id))) || !!exp.dupe);
      if (exp.external_id) seen.add(exp.external_id);
      return { ...exp, proposed: p.category, via: p.via,
               initial: p.category || "Other", checked: !dupe, dupe: !!dupe,
               upgradeId: upgrade ? stored.id : null,
               storedCatSource: upgrade ? stored.cat_source : null };
    }),
  };
  renderReview();
  document.getElementById("review-card").style.display = "block";
  document.getElementById("review-card").scrollIntoView({ behavior: "smooth" });
}

/* Lazy CDN loader: same pattern as the eager SheetJS script tag (CDN,
   global check, honest "not loaded" error), but only fetched when needed
   so the first page load stays light. */
function loadScriptCDN(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error("cdn"));
    document.head.appendChild(s);
  });
}

/* zip.js: handles plain AND password-protected Alipay packages (JSZip
   cannot open encrypted zips, which is why it isn't used here). */
async function ensureZipLib() {
  if (typeof zip !== "undefined" && zip.ZipReader) return;
  await loadScriptCDN("https://cdn.jsdelivr.net/npm/@zip.js/zip.js@2.23.0/dist/zip.min.js");
  if (typeof zip === "undefined" || !zip.ZipReader) {
    const err = new Error("zip library not loaded — check internet connection.");
    err.code = "zip_missing";
    throw err;
  }
}

/* Tesseract.js: on-device OCR for the screenshot capture route. */
async function ensureTesseract() {
  if (typeof Tesseract !== "undefined" && Tesseract.recognize) return Tesseract;
  await loadScriptCDN("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js");
  if (typeof Tesseract === "undefined" || !Tesseract.recognize) {
    const err = new Error("OCR library not loaded — check internet connection.");
    err.code = "ocr_missing";
    throw err;
  }
  return Tesseract;
}

/* Screenshot OCR prep. Wallet apps print the date/time line in pale
   grey; Tesseract's own thresholding discards it entirely — on a real
   WeChat Pay HK list every date vanished, and undated rows are dropped,
   so the import read zero rows. Force the issue before OCR: greyscale,
   invert when the shot is dark-mode, then a hard curve (anything not
   near-white becomes black). Verified against that real screenshot:
   every row, date and amount reads. Any failure falls back to the
   original file — never worse than no prep. */
async function preprocessShotForOcr(file) {
  try {
    if (typeof createImageBitmap !== "function") return file;
    const bmp = await createImageBitmap(file);
    const scale = bmp.width > 0 && bmp.width < 1000 ? 2 : 1;
    const c = document.createElement("canvas");
    c.width = bmp.width * scale;
    c.height = bmp.height * scale;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
    const invert = sum / (d.length / 4) < 110; // dark-mode shot
    for (let i = 0; i < d.length; i += 4) {
      let v = (d[i] + d[i + 1] + d[i + 2]) / 3;
      if (invert) v = 255 - v;
      const o = v < 235 ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = o;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  } catch (e) {
    return file;
  }
}

/* pdf.js (ESM build): reads AlipayHK statement PDFs on-device.
   Stored on window.__pdfjsLib — the seam Importers._parsePdfBytes uses. */
async function ensurePdfJs() {
  if (window.__pdfjsLib && window.__pdfjsLib.getDocument) return window.__pdfjsLib;
  try {
    const lib = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.2.67/build/pdf.min.mjs");
    lib.GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.2.67/build/pdf.worker.min.mjs";
    // Without the CMap pack, pdf.js silently drops CJK glyphs — Chinese
    // merchant names on statements would vanish. The maps ship WITH the
    // app (cmaps/ folder, from the same pinned pdfjs-dist package) and
    // load from the app's own origin: no CDN fetch can break them.
    window.__pdfjsOptions = {
      cMapUrl: location.origin + location.pathname.replace(/[^/]*$/, "") + "cmaps/",
      cMapPacked: true,
    };
    window.__pdfjsLib = lib;
    return lib;
  } catch (e) {
    const err = new Error("PDF library not loaded — check internet connection.");
    err.code = "pdf_missing";
    throw err;
  }
}

let zipPendingFile = null;

async function parseSelectedFile(fileOverride, zipCode) {
  const input = document.getElementById("f-file");
  const file = fileOverride || input.files[0];
  const out = document.getElementById("import-result");
  if (!file) { out.textContent = t("imp_choose_first"); return; }
  out.textContent = t("imp_parsing");
  try {
    if (file.name.toLowerCase().endsWith(".zip")) await ensureZipLib();
    if (file.name.toLowerCase().endsWith(".pdf")) await ensurePdfJs();
    const { platform, expenses } = await Importers.parseFile(file, zipCode);
    if (!platform) {
      out.textContent = t("imp_no_detect");
      return;
    }
    if (!expenses.length) {
      out.textContent = t("imp_no_rows");
      return;
    }
    out.textContent = "";
    startReview(platform, expenses);
  } catch (err) {
    if (err && err.code === "zip_locked") {
      // Alipay's package needs the code from its delivery message.
      zipPendingFile = file;
      out.textContent = "";
      const form = document.getElementById("zip-code-form");
      if (form) {
        form.style.display = "block";
        const codeInput = document.getElementById("f-zip-code");
        if (codeInput) { codeInput.value = ""; codeInput.focus(); }
      }
      return;
    }
    out.textContent = t("imp_failed") + (
      err && err.code === "xlsx_missing" ? t("imp_xlsx_missing") :
      err && err.code === "zip_missing" ? t("imp_zip_missing") :
      err && err.code === "pdf_missing" ? t("imp_pdf_missing") :
      err && err.code === "zip_badcode" ? t("imp_zip_badcode") : err.message);
  } finally {
    // Always reset the input so choosing the same file again re-parses.
    input.value = "";
  }
}

/* Alipay package code prompt: generic wording, no assumed convention. */
const btnZipOpen = document.getElementById("btn-zip-open");
if (btnZipOpen) btnZipOpen.addEventListener("click", () => {
  const code = (document.getElementById("f-zip-code") || {}).value || "";
  document.getElementById("zip-code-form").style.display = "none";
  if (zipPendingFile) parseSelectedFile(zipPendingFile, code.trim());
  zipPendingFile = null;
});
const btnZipCancel = document.getElementById("btn-zip-cancel");
if (btnZipCancel) btnZipCancel.addEventListener("click", () => {
  document.getElementById("zip-code-form").style.display = "none";
  zipPendingFile = null;
});

/* Single upload entry: pick a file, then press "Parse file" (or drop the
   file onto the card). Note: wrapped so the click Event never lands in
   parseSelectedFile's fileOverride. */
document.getElementById("btn-import").addEventListener("click", () => parseSelectedFile());

/* Sum of checked, non-duplicate rows in the staged review. */
function updateReviewTotal() {
  const el = document.getElementById("review-total");
  if (!el || !reviewBatch) return;
  const sum = reviewBatch.rows.reduce(
    (s, r) => s + (r.checked && !r.dupe ? parseFloat(r.amount) || 0 : 0), 0);
  const ccy = reviewBatch.rows.length ? reviewBatch.rows[0].currency : "CNY";
  el.textContent = t("rev_total").replace("{a}", ccySym(ccy) + fmt(sum));
}

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
        ${r.description && r.description !== r.merchant && r.description !== r.txtype ? `<div class="muted">${esc(r.description)}</div>` : ""}
        ${r.txtype ? `<div class="muted">${esc(r.txtype)}</div>` : ""}</td>
      <td class="amount">${fmt(r.amount)}</td>
      <td><select data-review-cat="${i}">
        ${CATEGORY_IDS.map((c) =>
          `<option value="${esc(c)}"${(r.proposed || "Other") === c ? " selected" : ""}>${catLabel(c)}</option>`
        ).join("")}
      </select>
      ${!r.dupe && !r.proposed ? `<div class="muted">${t("lbl_needs_review")}</div>` : ""}</td>
      <td>${r.dupe ? `<span class="muted">${t("lbl_duplicate")}</span>` : r.upgradeId ? `<span class="muted">${t("lbl_will_update")}</span>` : ""}</td>
    </tr>`).join("");

  const adEl = document.getElementById("review-alldupes");
  if (adEl) adEl.style.display = rows.length && dupes === rows.length ? "block" : "none";
  document.getElementById("review-all").checked =
    rows.filter((r) => !r.dupe).every((r) => r.checked);
  document.querySelectorAll("[data-review]").forEach((cb) => {
    cb.addEventListener("change", () => {
      reviewBatch.rows[+cb.dataset.review].checked = cb.checked;
      updateReviewTotal();
    });
  });
  updateReviewTotal();
}

document.getElementById("review-all").addEventListener("change", (e) => {
  reviewBatch.rows.forEach((r, i) => {
    if (!r.dupe) {
      r.checked = e.target.checked;
      const cb = document.querySelector(`[data-review="${i}"]`);
      if (cb) cb.checked = r.checked;
    }
  });
  updateReviewTotal();
});

document.getElementById("btn-review-cancel").addEventListener("click", () => {
  reviewBatch = null;
  document.getElementById("review-card").style.display = "none";
  document.getElementById("f-file").value = "";
});

document.getElementById("btn-review-confirm").addEventListener("click", () => {
  if (!reviewBatch) return;
  const ids = [];
  const updatedIds = [];
  let total = 0;
  const dupes = reviewBatch.rows.filter((r) => r.dupe).length;
  reviewBatch.rows.forEach((r, i) => {
    if (!r.checked || r.dupe) return;
    const sel = document.querySelector(`[data-review-cat="${i}"]`);
    const chosen = sel ? sel.value : r.initial;
    if (r.upgradeId) {
      // Fill in the stored row; only merchant/description, plus the
      // category when the user changed it here or the stored row was
      // never categorised and the engine now has a proposal.
      const patch = { merchant: r.merchant, description: r.description || r.merchant };
      if (chosen !== r.initial) patch.category = chosen;
      else if (r.storedCatSource === "unreviewed" && r.proposed) patch.category = r.proposed;
      if (DB.update(r.upgradeId, patch)) updatedIds.push(r.upgradeId);
      return;
    }
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
    const newId = DB.create({ ...r, category: chosen, cat_source });
    if (newId) {
      ids.push(newId);
      total += parseFloat(r.amount) || 0;
    }
  });
  const added = ids.length + updatedIds.length;
  if (added) {
    DB.recordImportBatch({
      id: "imp-" + Date.now().toString(36),
      ts: new Date().toISOString(),
      platform: reviewBatch.platform,
      expenseIds: ids,
      updatedIds,
      count: added,
      total,
      currency: reviewBatch.rows.length ? reviewBatch.rows[0].currency : "CNY",
      dupes,
    });
  }
  const eye = DB.needsReview().length;
  reviewBatch = null;
  document.getElementById("review-card").style.display = "none";
  document.getElementById("f-file").value = "";
  renderAll();
  renderImportHistory();
  toast(t("import_done").replace("{n}", String(added)) +
    (eye ? t("import_done_review").replace("{e}", String(eye)) : ""));
});

/* ---- Import history + undo ------------------------------------------------
   The latest batches sit on the Import view so a wrong file can be reversed. */
function renderImportHistory() {
  const box = document.getElementById("import-history");
  if (!box) return;
  const batches = DB.importBatches();
  if (!batches.length) {
    box.innerHTML = `<p class="muted">${esc(t("hist_empty"))}</p>`;
    return;
  }
  box.innerHTML = batches.map((b) => {
    const when = new Date(b.ts).toLocaleString();
    const row = t("hist_row")
      .replace("{n}", String(b.count))
      .replace("{a}", ccySym(b.currency) + fmt(b.total));
    const dup = b.dupes ? ` <span class="muted">${esc(t("hist_dupes").replace("{d}", String(b.dupes)))}</span>` : "";
    return `<div class="hist-row"><div class="grow"><strong>${esc(tPlat(b.platform))}</strong>` +
      ` <span class="muted">${esc(when)}</span><br>${esc(row)}${dup}</div>` +
      `<button data-batch-undo="${esc(b.id)}">${esc(t("btn_undo"))}</button></div>`;
  }).join("");
  box.querySelectorAll("[data-batch-undo]").forEach((btn) => {
    btn.addEventListener("click", () => undoImportBatch(btn.dataset.batchUndo));
  });
}

function undoImportBatch(id) {
  const batch = DB.importBatches().find((b) => String(b.id) === String(id));
  if (!batch) return;
  if (!confirm(t("hist_undo_confirm").replace("{n}", String(batch.count)))) return;
  let removed = 0;
  (batch.expenseIds || []).forEach((eid) => { if (DB.remove(eid)) removed++; });
  DB.removeImportBatch(id);
  renderAll();
  renderImportHistory();
  toast(t("hist_undone").replace("{n}", String(removed)));
}

/* ---- Paste-text import (mainland bills, CSV text) ------------------------- */
document.getElementById("btn-paste-parse").addEventListener("click", () => {
  const ta = document.getElementById("paste-text");
  const out = document.getElementById("paste-result");
  const text = (ta.value || "").trim();
  if (!text) { out.textContent = t("paste_empty"); return; }
  out.textContent = t("imp_parsing");
  try {
    const { platform, expenses } = Importers.parseText(text);
    if (!platform) { out.textContent = t("imp_no_detect"); return; }
    if (!expenses.length) { out.textContent = t("paste_no_rows"); return; }
    out.textContent = "";
    startReview(platform, expenses);
  } catch (err) {
    out.textContent = t("imp_failed") + (err && err.message);
  }
});

/* ---- Screenshot capture import (HK wallets: no bill-file export) ----
   The user picks the wallet shown, uploads screenshots of the in-app
   transaction list (WeChat: 我 → 服务 → ··· → 交易记录）, and Tesseract.js
   reads them ON-DEVICE — images never leave the browser. The OCR text
   goes through Importers.parseShotText and the rows enter the SAME
   review -> commit pipeline as file imports. */
const SHOT_WALLETS = {
  wechat_hk: { platform: "wechat", currency: "HKD" },
  alipay_hk: { platform: "alipay", currency: "HKD" },
  wechat: { platform: "wechat", currency: "CNY" },
  alipay: { platform: "alipay", currency: "CNY" },
};

async function readScreenshots() {
  const input = document.getElementById("f-shots");
  const out = document.getElementById("shot-result");
  const prog = document.getElementById("shot-progress");
  const files = input.files;
  if (!files || !files.length) { out.textContent = t("shot_empty"); return; }
  const wallet = (document.getElementById("shot-wallet") || {}).value || "wechat_hk";
  const map = SHOT_WALLETS[wallet] || SHOT_WALLETS.wechat_hk;
  out.textContent = "";
  try {
    const Tess = await ensureTesseract();
    let allText = "";
    for (let i = 0; i < files.length; i++) {
      prog.textContent = t("shot_reading").replace("{i}", String(i + 1)).replace("{n}", String(files.length));
      const { data } = await Tess.recognize(await preprocessShotForOcr(files[i]), "chi_tra+chi_sim+eng", {
        logger: (m) => {
          if (m && m.status === "recognizing text" && m.progress != null)
            prog.textContent = t("shot_reading_pct").replace("{p}", String(Math.round(m.progress * 100)));
        },
      });
      allText += "\n" + ((data && data.text) || "");
    }
    prog.textContent = "";
    const rows = Importers.parseShotText(allText, wallet);
    if (!rows.length) { out.textContent = t("shot_no_rows"); return; }
    // Best-effort dedupe: screenshot rows have no transaction number, so
    // match against identical date/amount/description/currency already stored.
    const key = (r) => [r.expense_date, Number(r.amount).toFixed(2),
      (r.merchant || "").trim(), (r.description || "").trim(), r.currency].join("|");
    const stored = new Set(DB.list({ limit: 100000 }).map(key));
    let dupes = 0;
    rows.forEach((r) => {
      // Only rows already in the records count as duplicates. Identical
      // rows inside one batch are kept: two equal payments in a single
      // screenshot (same merchant, amount, same minute) are real spends.
      if (stored.has(key(r))) { r.dupe = true; dupes++; }
    });
    out.textContent = dupes ? t("shot_dupes").replace("{n}", String(dupes)) : "";
    startReview(map.platform, rows);
  } catch (err) {
    prog.textContent = "";
    out.textContent = t("imp_failed") + (err && err.code === "ocr_missing" ? t("imp_ocr_missing") : err.message);
  } finally {
    input.value = "";
  }
}

/* Guarded like everything else on this view. */
const btnShotRead = document.getElementById("btn-shot-read");
if (btnShotRead) btnShotRead.addEventListener("click", readScreenshots);

/* Guarded: if index.html and app.js ever deploy out of step, a missing
   button must not stop the rest of the app from booting. */
const hkQuickAdd = document.getElementById("btn-hk-quickadd");
if (hkQuickAdd) hkQuickAdd.addEventListener("click", () => openExpenseDialog(null));

/* Drag & drop onto the upload card feeds the same parse flow. */
const uploadCard = document.getElementById("upload-card");
if (uploadCard) {
  ["dragover", "dragenter"].forEach((ev) =>
    uploadCard.addEventListener(ev, (e) => {
      e.preventDefault();
      uploadCard.classList.add("drag");
    }));
  uploadCard.addEventListener("dragleave", () => uploadCard.classList.remove("drag"));
  uploadCard.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadCard.classList.remove("drag");
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    try {
      const dt = new DataTransfer();
      dt.items.add(f);
      document.getElementById("f-file").files = dt;
    } catch { /* older browsers: keep the input untouched */ }
    parseSelectedFile(f);
  });
}

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
  DB.wipeLocal();
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
  renderImportHistory();
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
  // A password-recovery landing carries a session, but the user must set
  // a new password before entering the app — never auto-enter here.
  if (Cloud.recoveryPending && Cloud.recoveryPending()) {
    showAuthView();
    showResetBlock();
    renderSyncStatus();
    return;
  }
  if (user && !wasIn) {
    // Guest → sign-in: the guest's queued edits go up through the normal
    // sync path below. Say so explicitly, once — never a silent merge.
    const wasGuest = Cloud.guest();
    const hadGuestData = wasGuest &&
      (DB.list({}).length > 0 || DB._syncQueue().length > 0);
    Cloud.exitGuest();
    showApp();
    toast(hadGuestData ? t("guest_merged") : t("signed_in"));
    Sync.syncNow();
  } else if (!user && wasIn) {
    // Sign-out must not leak data into the next account on this browser:
    // clear all local data + the pending sync queue (cloud untouched).
    DB.wipeLocal();
    Cloud.exitGuest();
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
      if (Cloud.guest()) {
        // Guest mode: local only, sync disabled — the pill + chip below are
        // the persistent visible indicator, and Sign out exits guest mode.
        showSignout = true;
        label = t("guest_badge");
        det = t("guest_det");
      } else {
        label = t("sync_out");
        det = t("sync_det_out");
      }
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
  // In guest mode the "Sync now" button is meaningless (sync is off) —
  // offer "Sign in to sync" instead.
  const isGuest = Cloud.configured() && Cloud.guest() && !Cloud.signedIn();
  const syncnow = document.getElementById("btn-sync-now");
  if (syncnow) syncnow.style.display = isGuest ? "none" : "";
  const gsignin = document.getElementById("btn-guest-signin");
  if (gsignin) gsignin.style.display = isGuest ? "" : "none";
  const chip = document.getElementById("acct-chip");
  if (chip) {
    if (showSignout) {
      if (isGuest) {
        chip.hidden = false;
        chip.textContent = t("guest_chip");
        chip.title = t("guest_chip_title");
      } else {
        const email = (Cloud.user() && Cloud.user().email) || "?";
        chip.hidden = false;
        chip.textContent = email.trim().charAt(0).toUpperCase() || "?";
        chip.title = t("acct_title").replace("{email}", email);
      }
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

/* Auth message box (shared by sign-in errors and the reset flow). */
function authMsg(text) {
  const err = document.getElementById("auth-error");
  err.textContent = text;
  err.style.display = "block";
}

function showResetBlock() {
  const block = document.getElementById("auth-reset-block");
  if (block) block.style.display = "block";
}

/* Continue with Google. If the provider isn't enabled in the backend
   yet, say so plainly instead of leaving the user on a dead screen. */
document.getElementById("btn-google").addEventListener("click", async () => {
  try {
    await Cloud.signInWithGoogle();
    // Success navigates away to Google; the session returns via the
    // redirect and onCloudAuthChange takes it from there.
  } catch (e) {
    const m = (e && e.message) || "";
    authMsg(/provider is not enabled|unsupported provider/i.test(m) ? t("auth_google_off") : m);
  }
});

/* Forgot password: email a reset link for the address typed above. */
document.getElementById("btn-magic").addEventListener("click", async () => {
  const email = document.getElementById("auth-email").value.trim();
  if (!email) { authMsg(t("auth_email_needed")); return; }
  try {
    await Cloud.signInWithMagicLink(email);
    authMsg(t("auth_magic_sent"));
  } catch (e) { authMsg(friendlyAuthError(e, "signin")); }
});
document.getElementById("btn-forgot").addEventListener("click", async () => {
  const email = document.getElementById("auth-email").value.trim();
  if (!email) {
    authMsg(t("auth_email_first"));
    return;
  }
  try {
    await Cloud.resetPassword(email);
    authMsg(t("auth_reset_sent"));
  } catch (e) {
    authMsg(friendlyAuthError(e, "signin"));
  }
});

/* Set-new-password submit (recovery landing). */
document.getElementById("btn-setpw").addEventListener("click", async () => {
  const pw = document.getElementById("auth-newpw").value;
  if (!pw || pw.length < 6) {
    authMsg(t("auth_err_pw"));
    return;
  }
  try {
    await Cloud.updatePassword(pw);
    Cloud.clearRecovery();
    document.getElementById("auth-reset-block").style.display = "none";
    document.getElementById("auth-error").style.display = "none";
    showApp();
    toast(t("auth_pw_updated"));
    Sync.syncNow();
    renderSyncStatus();
  } catch (e) {
    authMsg(friendlyAuthError(e, "signin"));
  }
});
document.getElementById("btn-signout").addEventListener("click", async () => {
  if (Cloud.guest() && !Cloud.signedIn()) {
    // Exiting guest mode: same guarantee as sign-out — local data + queue
    // cleared, back to the auth screen (cloud untouched).
    DB.wipeLocal();
    Cloud.exitGuest();
    showAuthView();
    toast(t("signed_out"));
    renderSyncStatus();
    return;
  }
  await Cloud.signOut();
});
/* Auth screen: skip the sign-in wall, use the app with local data only. */
document.getElementById("btn-guest").addEventListener("click", () => {
  Cloud.enterGuest();
  showApp();
  renderAll();
  renderSyncStatus();
  toast(t("guest_welcome"));
});
/* Settings (guest mode): go to the auth screen to sign in WITHOUT clearing
   the guest's local data, so it can merge into their account. */
document.getElementById("btn-guest-signin").addEventListener("click", () => {
  showAuthView();
  renderSyncStatus();
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
  renderImportHistory();
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
  if (backend && Cloud.recoveryPending && Cloud.recoveryPending()) {
    // Arrived from a password-reset email: set a new password first.
    showAuthView();
    showResetBlock();
  } else if (backend && !Cloud.signedIn() && !Cloud.guest()) {
    showAuthView();
  } else {
    showApp();
    if (backend) Sync.syncNow();
  }
  registerServiceWorker();
}
boot();

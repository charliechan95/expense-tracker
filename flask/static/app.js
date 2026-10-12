/* Expense Tracker — small helpers, no frameworks. */
"use strict";

async function api(path, method, body, isForm) {
  const opts = { method: method || "GET" };
  if (isForm) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || ("HTTP " + res.status));
  }
  return res.json();
}

function formToJson(form) {
  const data = {};
  new FormData(form).forEach((v, k) => {
    data[k] = v === "" ? null : v;
  });
  return data;
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const PLATFORM_LABELS = {
  wechat: "WeChat Pay", alipay: "Alipay", cash: "Cash",
  bank: "Bank Card", other: "Other",
};

document.addEventListener("DOMContentLoaded", () => {
  // ---- Expense list --------------------------------------------------------
  const rowsEl = document.getElementById("expense-rows");
  const filterForm = document.getElementById("filter-form");

  async function loadExpenses() {
    if (!rowsEl) return;
    const q = new URLSearchParams();
    const v = (id) => document.getElementById(id).value.trim();
    if (v("f-q")) q.set("q", v("f-q"));
    if (v("f-platform")) q.set("platform", v("f-platform"));
    if (v("f-category")) q.set("category", v("f-category"));
    if (v("f-month")) q.set("month", v("f-month"));
    try {
      const items = await api("/api/expenses?" + q.toString());
      if (!items.length) {
        rowsEl.innerHTML =
          '<tr><td colspan="6" class="muted">No expenses found.</td></tr>';
        return;
      }
      rowsEl.innerHTML = items.map((e) => (
        "<tr>" +
        "<td>" + esc(e.expense_date) + "</td>" +
        "<td><strong>" + esc(e.merchant || "—") + "</strong>" +
        (e.description ? '<div class="muted">' + esc(e.description) + "</div>" : "") +
        "</td>" +
        "<td>" + esc(e.category) + "</td>" +
        "<td>" + esc(PLATFORM_LABELS[e.platform] || e.platform) + "</td>" +
        '<td class="amount">' + Number(e.amount).toFixed(2) + " " +
        esc(e.currency) + "</td>" +
        '<td><button class="danger" data-del="' + e.id + '">Delete</button></td>' +
        "</tr>"
      )).join("");
      rowsEl.querySelectorAll("[data-del]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("Delete this expense?")) return;
          try {
            await api("/api/expenses/" + btn.getAttribute("data-del"),
              "DELETE");
            loadExpenses();
          } catch (err) {
            alert("Could not delete: " + err.message);
          }
        });
      });
    } catch (err) {
      rowsEl.innerHTML =
        '<tr><td colspan="6" class="muted">Error: ' + esc(err.message) +
        "</td></tr>";
    }
  }

  if (filterForm) {
    filterForm.addEventListener("submit", (e) => {
      e.preventDefault();
      loadExpenses();
    });
    loadExpenses();
  }

  // ---- New expense dialog ---------------------------------------------------
  const dlg = document.getElementById("dlg-expense");
  const frm = document.getElementById("frm-expense");
  const btnNew = document.getElementById("btn-new-expense");
  const btnCancel = document.getElementById("btn-cancel-expense");

  if (btnNew) {
    btnNew.addEventListener("click", () => {
      document.getElementById("f-date").value =
        new Date().toISOString().slice(0, 10);
      dlg.showModal();
    });
  }
  if (btnCancel) btnCancel.addEventListener("click", () => dlg.close());
  if (frm) {
    frm.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api("/api/expenses", "POST", formToJson(frm));
        dlg.close();
        frm.reset();
        loadExpenses();
      } catch (err) {
        alert("Could not save: " + err.message);
      }
    });
  }

  // ---- Import ---------------------------------------------------------------
  const frmImport = document.getElementById("frm-import");
  const importResult = document.getElementById("import-result");
  if (frmImport) {
    frmImport.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fileInput = document.getElementById("f-file");
      if (!fileInput.files.length) return;
      const fd = new FormData();
      fd.append("file", fileInput.files[0]);
      importResult.textContent = "Importing…";
      try {
        const r = await api("/api/import", "POST", fd, true);
        const label = r.platform === "wechat" ? "WeChat Pay" : "Alipay";
        importResult.textContent =
          "Done — " + label + ": imported " + r.imported +
          ", skipped " + r.skipped + " (duplicates).";
      } catch (err) {
        importResult.textContent = "Import failed: " + err.message;
      }
    });
  }
});

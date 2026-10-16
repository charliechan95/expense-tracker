/* WeChat Pay / Alipay bill import — ported from importers.py.
   Parses CSV text in the browser. xlsx is handled via SheetJS (CDN). */
"use strict";

const Importers = {
  // --- Column markers ------------------------------------------------------
  WECHAT_ID: "交易单号",
  WECHAT_EXPENSE: ["支出", "Expense"],
  WECHAT_OK_STATUS: ["支付成功", "已支付", "交易成功", "完成", "已转账", "对方已收钱", ""],
  WECHAT_REFUND: ["退款", "退还", "Refund"],
  WECHAT_TYPE_EXPENSE: ["商户消费", "扫二维码付款", "二维码付款", "付款", "消费"],
  ALIPAY_ID: "交易订单号",

  _findHeader(rows, marker) {
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].some((c) => (c || "").includes(marker))) return i;
    }
    return -1;
  },

  _col(row, header, name) {
    for (let i = 0; i < header.length; i++) {
      if ((header[i] || "").includes(name)) {
        return ((row[i] || "").trim());
      }
    }
    return "";
  },

  _parseCSV(text) {
    // Minimal CSV parser handling quoted fields
    const rows = [];
    let row = [], field = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.some((f) => f.trim())) rows.push(row);
        row = [];
      } else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
  },

  parseWechat(rows) {
    const hi = this._findHeader(rows, this.WECHAT_ID);
    if (hi < 0) return [];
    const header = rows[hi];
    const out = [];
    const hasDirCol = header.some((h) => (h || "").includes("收/支"));
    for (const row of rows.slice(hi + 1)) {
      if (!row.some((c) => (c || "").trim())) continue;
      const txtype0 = this._col(row, header, "交易类型");
      const direction = this._col(row, header, "收/支");
      if (hasDirCol) {
        if (!this.WECHAT_EXPENSE.some((m) => direction.includes(m))) continue;
      } else if (!this.WECHAT_TYPE_EXPENSE.some((m) => txtype0.includes(m))) {
        // No 收/支 column in this export variant: only types that are
        // payments-out by construction (merchant / QR payments). Anything
        // ambiguous (red packets, transfers) is skipped, never guessed.
        continue;
      }
      const status = this._col(row, header, "当前状态") || this._col(row, header, "交易状态") || this._col(row, header, "状态");
      if (status && !this.WECHAT_OK_STATUS.some((s) => status.includes(s))) continue;
      if (this.WECHAT_REFUND.some((m) => status.includes(m))) continue;
      const txid = this._col(row, header, this.WECHAT_ID);
      // Strip everything except digits/dot/minus — survives ¥, ￥, commas,
      // spaces, or a mojibake currency symbol from a mis-decoded file.
      const amountRaw = this._col(row, header, "金额").replace(/[^\d.\-]/g, "");
      const amount = Math.abs(parseFloat(amountRaw));
      if (!amount || !txid) continue;
      const timeRaw = this._col(row, header, "交易时间");
      const date = timeRaw ? timeRaw.split(" ")[0] : "";
      const merchant = this._col(row, header, "交易对方");
      const product = this._col(row, header, "商品") || merchant;
      out.push({
        amount, currency: "CNY", category: "Other", platform: "wechat",
        merchant, description: product, expense_date: date,
        external_id: "wechat:" + txid, source: "wechat_import",
        txtype: txtype0,
      });
    }
    return out;
  },

  parseAlipay(rows) {
    const hi = this._findHeader(rows, this.ALIPAY_ID);
    if (hi < 0) return [];
    const header = rows[hi];
    const out = [];
    for (const row of rows.slice(hi + 1)) {
      if (!row.some((c) => (c || "").trim())) continue;
      const txid = this._col(row, header, this.ALIPAY_ID);
      const amountRaw = (this._col(row, header, "金额") ||
        this._col(row, header, "交易金额")).replace(/[^\d.\-]/g, "");
      const direction = this._col(row, header, "收/支") || this._col(row, header, "资金流向");
      const status = this._col(row, header, "交易状态") || this._col(row, header, "状态");
      let amount = parseFloat(amountRaw);
      if (!amount || !txid) continue;
      const isExpense = amount < 0 ||
        ["支出", "Expense", "流出"].some((m) => direction.includes(m));
      if (!isExpense && direction) continue;
      amount = Math.abs(amount);
      if (["退款", "关闭", "失败"].some((m) => status.includes(m))) continue;
      const timeRaw = this._col(row, header, "交易创建时间") || this._col(row, header, "交易时间");
      const date = timeRaw ? timeRaw.split(" ")[0] : "";
      const merchant = this._col(row, header, "交易对方") || this._col(row, header, "对方");
      const product = this._col(row, header, "商品名称") ||
        this._col(row, header, "商品说明") || merchant;
      out.push({
        amount, currency: "CNY", category: "Other", platform: "alipay",
        merchant, description: product, expense_date: date,
        external_id: "alipay:" + txid, source: "alipay_import",
        txtype: this._col(row, header, "交易类型") || this._col(row, header, "类型"),
      });
    }
    return out;
  },

  detectAndParseRows(rows) {
    if (!rows || !rows.length) return { platform: null, expenses: [] };
    const flat = rows.slice(0, 30).map((r) => r.join(" ")).join(" ");
    if (flat.includes(this.WECHAT_ID)) return { platform: "wechat", expenses: this.parseWechat(rows) };
    if (flat.includes(this.ALIPAY_ID)) return { platform: "alipay", expenses: this.parseAlipay(rows) };
    return { platform: null, expenses: [] };
  },

  /* Paste-text path: same row parsing as parseFile, without the file or
     xlsx branches. Returns the same {platform, expenses} shape. */
  parseText(text) {
    if (text == null) return { platform: null, expenses: [] };
    let t = String(text);
    if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
    return this.detectAndParseRows(this._parseCSV(t));
  },

  /* AlipayHK Transaction Statement (PDF). pdf.js supplies positioned
     text items per page ({str, x, y}); this parser is pure over those
     items so it is testable without a real PDF. Column bands are read
     from the statement's own header row. A date item starts a row;
     items up to 16 units below it on the page belong to it. Negative
     amounts are payments out (expense candidates); positive amounts
     are money in and are skipped (same policy as bill imports). The
     transaction number dedupes re-imports of overlapping statements. */
  _MONTHS: { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" },

  parseAlipayHkItems(pages) {
    const all = [];
    (pages || []).forEach((items) => (items || []).forEach((it) => all.push(it.str || "")));
    const joined = all.join(" ");
    if (!joined.includes("Transaction Statement") || !joined.includes("ALIPAY FINANCIAL SERVICES (HK)")) return null;
    let bands = null;
    for (const items of pages || []) {
      // The header is a ROW: all five labels share one y level. (The
      // summary block also prints "Transaction Type" as a lone label —
      // matching labels independently would pick that one and break
      // every band.)
      for (const d of items || []) {
        if (!(d.str || "").trim().startsWith("Transaction Date")) continue;
        const row = (items || []).filter((it) => Math.abs(it.y - d.y) <= 2);
        const at = (label) => row.find((it) => (it.str || "").trim().startsWith(label));
        const n = at("Transaction Number"), ty = at("Transaction Type"),
              m = at("Recipient / Merchant"), a = at("Transaction Amount");
        if (n && ty && m && a) { bands = { d: d.x, n: n.x, ty: ty.x, m: m.x, a: a.x, y: d.y }; break; }
      }
      if (bands) break;
    }
    if (!bands) return null;
    const bandOf = (x) => x < bands.n ? "date" : x < bands.ty ? "num" : x < bands.m ? "type" : x < bands.a ? "merchant" : "amount";
    const dateRe = /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})$/;
    const out = [];
    for (const items of pages || []) {
      const starts = (items || []).filter((it) => it.y < bands.y - 2 && bandOf(it.x) === "date" && dateRe.test((it.str || "").trim()));
      for (const st of starts) {
        const dm = (st.str || "").trim().match(dateRe);
        const rowItems = (items || []).filter((it) => it !== st && it.y <= st.y + 2 && it.y >= st.y - 16);
        const by = { num: [], type: [], merchant: [], amount: [] };
        for (const it of rowItems) {
          const b = bandOf(it.x);
          if (b in by) by[b].push(it);
        }
        const txm = by.num.map((i) => i.str).join(" ").match(/\d{16,}/);
        if (!txm) continue;
        const amtText = by.amount.sort((p, q) => p.x - q.x).map((i) => i.str).join(" ");
        const am = amtText.match(/([+\-])?\s*(HKD|CNY|USD|EUR|GBP|JPY|MOP)?\s*([\d,]+\.\d{2})/);
        if (!am) continue;
        const signed = (am[1] === "+" ? 1 : -1) * parseFloat(am[3].replace(/,/g, ""));
        if (!(signed < 0)) continue; // money in / zero: not an expense row
        const merchant = by.merchant.sort((p, q) => p.x - q.x).map((i) => (i.str || "").trim())
          .filter((x) => x && x !== "Confidential" && x !== "保密").join(" ").trim();
        const type = by.type.map((i) => (i.str || "").trim()).filter(Boolean).join(" ");
        out.push({
          amount: Math.abs(signed), currency: am[2] || "HKD", category: "Other", platform: "alipay",
          merchant, description: merchant,
          expense_date: dm[3] + "-" + this._MONTHS[dm[2]] + "-" + dm[1].padStart(2, "0"),
          external_id: "alipayhk:" + txm[0], source: "alipayhk_pdf",
          txtype: type,
        });
      }
    }
    return { platform: "alipay", expenses: out };
  },

  /* pdf.js is lazy-loaded by the app (window.__pdfjsLib) — never fetched
     unless the user actually picks a PDF. */
  async _parsePdfBytes(buf) {
    const lib = (typeof window !== "undefined" && window.__pdfjsLib) || null;
    if (!lib || !lib.getDocument) {
      const err = new Error("PDF library not loaded — check internet connection.");
      err.code = "pdf_missing";
      throw err;
    }
    const opts = (typeof window !== "undefined" && window.__pdfjsOptions) || {};
    const pdf = await lib.getDocument(Object.assign({}, opts, { data: new Uint8Array(buf) })).promise;
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      pages.push((tc.items || []).map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] })));
    }
    return this.parseAlipayHkItems(pages) || { platform: null, expenses: [] };
  },

  async parseFile(file, password) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".pdf")) return this._parsePdfBytes(await file.arrayBuffer());
    if (name.endsWith(".zip")) return this._parseZip(file, password);
    if (name.endsWith(".xlsx")) {
      // SheetJS from CDN
      if (typeof XLSX === "undefined") {
        const err = new Error("xlsx library not loaded — check internet connection.");
        err.code = "xlsx_missing";
        throw err;
      }
      return this._parseXlsxBytes(await file.arrayBuffer());
    }
    return this._parseCsvBytes(new Uint8Array(await file.arrayBuffer()));
  },

  _parseXlsxBytes(buf) {
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
    return this.detectAndParseRows(rows.map((r) => r.map(String)));
  },

  _parseCsvBytes(bytes) {
    // CSV — try encodings
    let text = null;
    for (const enc of ["utf-8", "gb18030", "gbk"]) {
      try {
        text = new TextDecoder(enc, { fatal: true }).decode(bytes);
        // Heuristic: must contain CJK or be plausible
        if (text.includes("�")) continue;
        break;
      } catch { continue; }
    }
    if (text == null) {
      // Last resort (non-fatal): a stray undecodable byte (e.g. a GBK-encoded
      // ¥) shouldn't sink the whole file. Prefer the decode that keeps CJK.
      const gb = new TextDecoder("gb18030").decode(bytes);
      const utf = new TextDecoder("utf-8").decode(bytes);
      text = (gb.includes(this.WECHAT_ID) || gb.includes(this.ALIPAY_ID)) ? gb : utf;
    }
    // Strip BOM
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return this.detectAndParseRows(this._parseCSV(text));
  },

  /* Alipay emailed packages may arrive as a (possibly password-protected)
     .zip. zip.js is lazy-loaded from CDN by the caller with the same
     pattern as SheetJS (checked global + honest "not loaded" error).
     NOTE: JSZip was considered but cannot open password-protected zips at
     all, so @zip.js/zip.js is used here — it handles both plain and
     encrypted archives through one API. */
  async _parseZip(file, password) {
    if (typeof zip === "undefined" || !zip.ZipReader) {
      const err = new Error("zip library not loaded — check internet connection.");
      err.code = "zip_missing";
      throw err;
    }
    const reader = new zip.ZipReader(new zip.BlobReader(file));
    let entries;
    try {
      entries = await reader.getEntries();
    } catch (err) {
      try { await reader.close(); } catch { /* ignore */ }
      throw err;
    }
    const bill = entries
      .filter((e) => !e.directory)
      .find((e) => /\.(csv|xlsx?)$/i.test(e.filename || ""));
    if (!bill) {
      await reader.close();
      // No bill file inside: let the caller show the usual "no format" message.
      return { platform: null, expenses: [] };
    }
    let data;
    try {
      data = await bill.getData(new zip.BlobWriter(), password ? { password } : undefined);
    } catch (err) {
      await reader.close();
      // zip.js throws for encrypted entries without (or with a wrong) password.
      const e = new Error(password ? "zip_badcode" : "zip_locked");
      e.code = password ? "zip_badcode" : "zip_locked";
      throw e;
    }
    await reader.close();
    const buf = await data.arrayBuffer();
    return /\.xlsx?$/i.test(bill.filename)
      ? this._parseXlsxBytes(buf)
      : this._parseCsvBytes(new Uint8Array(buf));
  },

  /* Screenshot capture import (HK route): parse OCR text from a wallet
     transaction-list screenshot into expense rows. Pure function —
     no DOM, no network. Rows carry no transaction number, so the
     external_id is a synthetic key (deterministic per row) which still
     dedupes exact repeat imports. */
  parseShotText(text, wallet) {
    const w = String(wallet || "wechat_hk");
    const platform = w.startsWith("wechat") ? "wechat" : "alipay";
    const currency = w.endsWith("_hk") ? "HKD" : "CNY";
    const rows = this._extractShotRows(String(text || ""), currency);
    return rows.map((r) => ({
      amount: r.amount, currency, category: "Other", platform,
      merchant: r.merchant, description: r.merchant, expense_date: r.date,
      external_id: "shot:" + w + "|" + r.date + "|" + r.amount.toFixed(2) + "|" +
        (r.merchant || "").replace(/[|\s]+/g, " ").trim(),
      source: "screenshot",
    }));
  },

  /* OCR digit confusions (0<->O, 1<->l, 5<->S ...). Applied ONLY to
     matched digit groups inside date/amount tokens — never to free text,
     so merchant names like "BOSS" are never altered. */
  _shotCleanDigits(s) {
    const map = { O: "0", o: "0", D: "0", l: "1", I: "1", i: "1", S: "5", s: "5", B: "8", Z: "2", z: "2" };
    return String(s).replace(/[OolIiSsBZzDd]/g, (c) => map[c] || c);
  },

  _normShotText(text) {
    // Full-width forms -> half-width, before anything else.
    return String(text)
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 48))
      .replace(/\u3000/g, " ")
      .replace(/（/g, "(").replace(/）/g, ")")
      .replace(/：/g, ":").replace(/，/g, ",").replace(/．/g, ".")
      .replace(/－/g, "-").replace(/＋/g, "+")
      .replace(/HKS(?=\s*[0-9OolIi])/gi, "HK$"); // OCR misread of HK$
  },

  _shotIsChrome(line) {
    return /^(交易记录|我的账单|账单|全部|筛选|搜索|返回|完成|我的|设置|帮助|常见问题|客服)/.test(line) ||
      /余额|剩餘|剩馀/.test(line) ||
      /^共?\d+筆?$/.test(line) ||
      /^\(?\d{4}\)?$/.test(line) ||
      /^\d{1,2}:\d{2}(:\d{2})?$/.test(line) || // bare time, no date
      /^(支付成功|交易成功|已支付|已完成|待支付|付款成功)$/.test(line) ||
      line.length <= 1;
  },

  _shotIsNoise(line) {
    return this._shotIsChrome(line) ||
      /^[()·….\s\-–—]+$/.test(line) ||
      /^(查看|更多|详情|詳情)$/.test(line);
  },

  _shotDateToken(s) {
    // Digit classes admit OCR confusions; groups are cleaned before use.
    // (DG is the bare char range — never nest brackets inside a class.)
    const DG = "0-9OolIiSsBZzDd";
    const cl = (x) => this._shotCleanDigits(x);
    let m;
    const iso = (y, mo, d) =>
      y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0");
    if ((m = s.match(new RegExp("([" + DG + "]{4})\\s*年\\s*([" + DG + "]{1,2})\\s*月\\s*([" + DG + "]{1,2})\\s*日"))))
      return { full: iso(cl(m[1]), +cl(m[2]), +cl(m[3])), raw: m[0] };
    if ((m = s.match(new RegExp("([" + DG + "]{4})[-/]([" + DG + "]{1,2})[-/]([" + DG + "]{1,2})"))))
      return { full: iso(cl(m[1]), +cl(m[2]), +cl(m[3])), raw: m[0] };
    if ((m = s.match(new RegExp("([" + DG + "]{1,2})\\s*月\\s*([" + DG + "]{1,2})\\s*日"))))
      return { full: this._inferShotYear(+cl(m[1]), +cl(m[2])), raw: m[0] };
    if ((m = s.match(new RegExp("([" + DG + "]{1,2})[-/]([" + DG + "]{1,2})\\s+[" + DG + "]{1,2}:[" + DG + "]{2}"))))
      return { full: this._inferShotYear(+cl(m[1]), +cl(m[2])), raw: m[0] };
    if ((m = s.match(new RegExp("([" + DG + "]{4})\\s*年\\s*([" + DG + "]{1,2})\\s*月(?![0-9OolIiSsBZzDd月])"))))
      return { ym: iso(cl(m[1]), +cl(m[2]), 1).slice(0, 7), raw: m[0] };
    return null;
  },

  _inferShotYear(mo, d) {
    // Wallet lists show "10月15日" without a year: assume current year,
    // unless that date is still in the future — then last year.
    const now = new Date();
    let y = now.getFullYear();
    if (new Date(y, mo - 1, d) > now) y -= 1;
    return y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  },

  /* One amount token per line, at most. A bare integer with no currency
     marker, no sign and no decimal is NOT an amount (it's a date part,
     a count, or a year). Tokens glued to 年/月/日/时/: are date/time
     fragments, not money. */
  _shotAmountToken(s) {
    // Sign may sit before the marker ("-HK$38.00") or after it ("HK$-38.00").
    // DG is the bare char range — never nest brackets inside a class.
    const DG = "0-9OolIiSsBZzDd";
    const MARK = "(HK\\$|HKD|¥|￥|CNY|港币|人民币|\\$)";
    const NUM = "([" + DG + "][" + DG + ",]*\\.?[" + DG + "]{0,2})";
    const re = new RegExp(
      "([+-]?)\\s*" + MARK + "\\s*([+-]?)\\s*" + NUM +
      "|([+-])\\s*([" + DG + "][" + DG + ",]*\\.[" + DG + "]{1,2})", "g");
    let m;
    while ((m = re.exec(s))) {
      const sign = m[1] || m[3] || m[5];
      const digits = this._shotCleanDigits(m[4] || m[6]);
      const tail = s.slice(m.index + m[0].length, m.index + m[0].length + 1);
      if (/[年月日時分秒:/]/.test(tail)) continue;
      const value = parseFloat(digits.replace(/,/g, ""));
      if (!value) continue;
      return { value, signed: sign === "-", raw: m[0] };
    }
    return null;
  },

  _shotRowKind(rest, merchant, signed) {
    const t = rest + " " + merchant;
    if (/退款|退还|入账|收款|红包|充值|提现|到账|收益|refund|received|top[\s-]?up|cashback/i.test(t)) return "income";
    if (/转账|transfer/i.test(t) && !signed) return "income"; // direction unknown: skip
    return "expense";
  },

  _extractShotRows(text) {
    const lines = this._normShotText(text).split("\n")
      .map((l) => l.trim()).filter(Boolean);
    const out = [];
    const emit = (rowData, date) => {
      out.push({ amount: Math.round(rowData.amount * 100) / 100,
                 merchant: rowData.merchant, date });
    };
    let ctxDate = "";
    let pendingMerchant = "";
    // OCR reads a two-column list in visual blocks, so the date for a row
    // may come BEFORE its amount line ("merchant / date / amount") or AFTER
    // it ("merchant amount" / date). Rows without a date on their own line
    // therefore wait in a queue; the next date-bearing line dates them all.
    let queue = [];
    const flushQueue = (date) => {
      if (date) for (const q of queue) emit(q, date);
      queue = [];
    };
    for (const line of lines) {
      if (this._shotIsChrome(line)) continue;
      let rest = line;
      let lineDate = null;
      const d = this._shotDateToken(rest);
      if (d) {
        if (d.full) { ctxDate = d.full; lineDate = d.full; }
        rest = rest.replace(d.raw, " ").trim();
        if (!rest || this._shotIsNoise(rest)) {
          // Date-only line: dates every row waiting for one.
          flushQueue(lineDate);
          continue;
        }
      }
      const amt = this._shotAmountToken(rest);
      if (!amt) {
        // A new text line resolves waiting rows against the last full date.
        flushQueue(ctxDate || null);
        if (!this._shotIsNoise(rest)) pendingMerchant = rest;
        continue;
      }
      // Leftover text on the amount line is the merchant (single-line rows).
      let merchant = pendingMerchant;
      const leftover = rest.replace(amt.raw, " ").replace(/[()·….\s\-–—,]+$/g, "").trim();
      if (/[\u4e00-\u9fffA-Za-z]/.test(leftover)) merchant = leftover;
      if (this._shotRowKind(rest, merchant, amt.signed) !== "expense") {
        pendingMerchant = "";
        continue;
      }
      const rowData = { amount: amt.value, merchant };
      if (lineDate) emit(rowData, lineDate);
      else queue.push(rowData); // wait for the date to arrive
      pendingMerchant = "";
    }
    // End of text: anything still waiting takes the last full date (best
    // effort — the review list is the final check), else it is dropped.
    flushQueue(ctxDate || null);
    return out;
  },
};

/* Node/test harness: allow require("../importers.js") without a browser. */
if (typeof module !== "undefined" && module.exports) module.exports = Importers;

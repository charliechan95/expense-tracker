/* WeChat Pay / Alipay bill import — ported from importers.py.
   Parses CSV text in the browser. xlsx is handled via SheetJS (CDN). */
"use strict";

const Importers = {
  // --- Column markers ------------------------------------------------------
  WECHAT_ID: "交易单号",
  WECHAT_EXPENSE: ["支出", "Expense"],
  WECHAT_OK_STATUS: ["支付成功", "已支付", "交易成功", "完成", "已转账", "对方已收钱", ""],
  WECHAT_REFUND: ["退款", "退还", "Refund"],
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
    for (const row of rows.slice(hi + 1)) {
      if (!row.some((c) => (c || "").trim())) continue;
      const direction = this._col(row, header, "收/支");
      if (!this.WECHAT_EXPENSE.some((m) => direction.includes(m))) continue;
      const status = this._col(row, header, "当前状态");
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

  async parseFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".xlsx")) {
      // SheetJS from CDN
      if (typeof XLSX === "undefined") {
        const err = new Error("xlsx library not loaded — check internet connection.");
        err.code = "xlsx_missing";
        throw err;
      }
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
      return this.detectAndParseRows(rows.map((r) => r.map(String)));
    }
    // CSV — try encodings
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
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
};

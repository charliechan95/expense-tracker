"""CSV/Excel import parsers for WeChat Pay and Alipay bill exports.

Both apps export from inside the phone app (no API needed):
- WeChat: Me → Services → Wallet → Bills → FAQ → Download Bill
- Alipay: My → Settings → Bills → ··· → Get Transaction Statement

Files arrive as .csv or .xlsx (sometimes zipped — unzip first).
Only expense records are imported; income and refunds are skipped.
Deduplication is by transaction ID.
"""
import csv
import io
import re

# --- WeChat ---
# Real header row appears after ~a dozen metadata lines. Key columns:
WECHAT_ID_COL = "交易单号"
WECHAT_TIME_COL = "交易时间"
WECHAT_MERCHANT_COL = "交易对方"
WECHAT_PRODUCT_COL = "商品"
WECHAT_DIRECTION_COL = "收/支"
WECHAT_AMOUNT_COL = "金额(元)"
WECHAT_STATUS_COL = "当前状态"

WECHAT_EXPENSE_MARKERS = ("支出", "Expense")
WECHAT_OK_STATUSES = (
    "支付成功", "已支付", "交易成功", "完成", "已转账",
    "对方已收钱", "",
)
WECHAT_REFUND_MARKERS = ("退款", "退还", "Refund")


def _find_header(rows, marker):
    """Return index of first row containing the marker column."""
    for i, row in enumerate(rows):
        if any(marker in (c or "") for c in row):
            return i
    return -1


def _col(row, header, name):
    for i, h in enumerate(header):
        if name in (h or ""):
            return (row[i] if i < len(row) else "" or "").strip()
    return ""


def parse_wechat(rows):
    """Parse WeChat bill rows (list of lists). Returns list of expense dicts."""
    hi = _find_header(rows, WECHAT_ID_COL)
    if hi < 0:
        return []
    header = rows[hi]
    out = []
    for row in rows[hi + 1:]:
        if not any((c or "").strip() for c in row):
            continue
        direction = _col(row, header, WECHAT_DIRECTION_COL)
        if not any(m in direction for m in WECHAT_EXPENSE_MARKERS):
            continue
        status = _col(row, header, WECHAT_STATUS_COL)
        if status and not any(s in status for s in WECHAT_OK_STATUSES):
            continue
        if any(m in status for m in WECHAT_REFUND_MARKERS):
            continue
        txid = _col(row, header, WECHAT_ID_COL)
        amount_raw = _col(row, header, WECHAT_AMOUNT_COL).replace("¥", "")
        try:
            amount = abs(float(amount_raw))
        except ValueError:
            continue
        if amount <= 0 or not txid:
            continue
        time_raw = _col(row, header, WECHAT_TIME_COL)
        date = time_raw.split(" ")[0] if time_raw else ""
        merchant = _col(row, header, WECHAT_MERCHANT_COL)
        product = _col(row, header, WECHAT_PRODUCT_COL) or merchant
        out.append({
            "amount": amount,
            "currency": "CNY",
            "category": "Other",
            "platform": "wechat",
            "merchant": merchant,
            "description": product,
            "expense_date": date,
            "external_id": "wechat:" + txid,
            "source": "wechat_import",
        })
    return out


# --- Alipay ---
# Detected by the 交易订单号 column.
ALIPAY_ID_COL = "交易订单号"


def parse_alipay(rows):
    hi = _find_header(rows, ALIPAY_ID_COL)
    if hi < 0:
        return []
    header = rows[hi]
    out = []
    for row in rows[hi + 1:]:
        if not any((c or "").strip() for c in row):
            continue
        txid = _col(row, header, ALIPAY_ID_COL)
        # Common Alipay export columns (Chinese headers vary by version)
        amount_raw = (
            _col(row, header, "金额") or _col(row, header, "交易金额")
        ).replace("¥", "").replace(",", "")
        direction = _col(row, header, "收/支") or _col(row, header, "资金流向")
        status = _col(row, header, "交易状态") or _col(row, header, "状态")
        # Keep expenses only
        if direction and not any(
            m in direction for m in ("支出", "Expense", "流出")
        ):
            # If direction column is absent/unclear, fall back to sign
            pass
        try:
            amount = float(amount_raw)
        except ValueError:
            continue
        if amount == 0 or not txid:
            continue
        # Negative or explicit expense markers → expense
        is_expense = amount < 0 or any(
            m in direction for m in ("支出", "Expense", "流出")
        )
        if not is_expense and direction:
            continue
        amount = abs(amount)
        if any(m in status for m in ("退款", "关闭", "失败")):
            continue
        time_raw = _col(row, header, "交易创建时间") or _col(
            row, header, "交易时间"
        )
        date = time_raw.split(" ")[0] if time_raw else ""
        merchant = _col(row, header, "交易对方") or _col(
            row, header, "对方"
        )
        product = _col(row, header, "商品名称") or _col(
            row, header, "商品说明"
        ) or merchant
        out.append({
            "amount": amount,
            "currency": "CNY",
            "category": "Other",
            "platform": "alipay",
            "merchant": merchant,
            "description": product,
            "expense_date": date,
            "external_id": "alipay:" + txid,
            "source": "alipay_import",
        })
    return out


def detect_and_parse(content_bytes, filename=""):
    """Detect platform from content/filename, parse, return (platform, rows).

    Supports .csv (tries utf-8-sig, gbk, gb18030) and .xlsx.
    """
    name = (filename or "").lower()
    rows = None

    if name.endswith(".xlsx"):
        rows = _read_xlsx(content_bytes)
    else:
        text = None
        for enc in ("utf-8-sig", "gb18030", "gbk", "utf-8"):
            try:
                text = content_bytes.decode(enc)
                break
            except (UnicodeDecodeError, ValueError):
                continue
        if text is None:
            return None, []
        rows = list(csv.reader(io.StringIO(text)))

    if not rows:
        return None, []

    flat = " ".join(" ".join(r) for r in rows[:30])
    if WECHAT_ID_COL in flat:
        return "wechat", parse_wechat(rows)
    if ALIPAY_ID_COL in flat:
        return "alipay", parse_alipay(rows)
    return None, []


def _read_xlsx(content_bytes):
    """Minimal xlsx reader using only stdlib (zip + xml)."""
    import zipfile
    import xml.etree.ElementTree as ET

    rows = []
    try:
        zf = zipfile.ZipFile(io.BytesIO(content_bytes))
    except zipfile.BadZipFile:
        return []
    # Shared strings
    strings = []
    try:
        ss_root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
        ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        for si in ss_root.findall("m:si", ns):
            t = "".join(
                n.text or "" for n in si.findall(".//m:t", ns)
            )
            strings.append(t)
    except KeyError:
        pass
    # First sheet
    try:
        sheet = zf.read("xl/worksheets/sheet1.xml")
    except KeyError:
        return []
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    root = ET.fromstring(sheet)
    for row_el in root.findall(".//m:row", ns):
        cells = {}
        max_col = 0
        for c in row_el.findall("m:c", ns):
            ref = c.get("r", "A1")
            col_letters = re.sub(r"[^A-Z]", "", ref)
            col_idx = 0
            for ch in col_letters:
                col_idx = col_idx * 26 + (ord(ch) - 64)
            col_idx -= 1
            max_col = max(max_col, col_idx)
            t = c.get("t")
            v_el = c.find("m:v", ns)
            inline = c.find("m:is", ns)
            if t == "s" and v_el is not None:
                try:
                    cells[col_idx] = strings[int(v_el.text)]
                except (IndexError, ValueError):
                    cells[col_idx] = ""
            elif inline is not None:
                cells[col_idx] = "".join(
                    n.text or "" for n in inline.findall(".//m:t", ns)
                )
            elif v_el is not None:
                cells[col_idx] = v_el.text or ""
            else:
                cells[col_idx] = ""
        rows.append([cells.get(i, "") for i in range(max_col + 1)])
    return rows

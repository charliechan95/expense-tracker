"""Expense Tracker — Flask backend.

Free stack: Flask + SQLite (stdlib). No paid APIs, no external services.
WeChat/Alipay data comes from user-exported CSV/XLSX files, parsed locally.
Run with:  python app.py   →  http://localhost:5001
"""
from flask import Flask, jsonify, render_template, request

import importers
import models

app = Flask(__name__)

ALLOWED_EXTENSIONS = {".csv", ".xlsx"}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


@app.before_request
def _ensure_db():
    models.init_db()


# ---- Pages -----------------------------------------------------------------

@app.route("/")
def dashboard():
    month = request.args.get("month", "").strip() or None
    total = models.grand_total(month=month)
    by_cat = models.summary_by_category(month=month)
    by_plat = models.summary_by_platform(month=month)
    months = models.monthly_totals()
    return render_template(
        "dashboard.html",
        total=total,
        by_cat=by_cat,
        by_plat=by_plat,
        months=months,
        month=month or "",
        platforms=models.PLATFORM_LABELS,
    )


@app.route("/expenses")
def expenses_page():
    return render_template(
        "expenses.html",
        platforms=models.PLATFORMS,
        categories=models.DEFAULT_CATEGORIES,
    )


@app.route("/import")
def import_page():
    return render_template("import.html")


# ---- JSON API ---------------------------------------------------------------

@app.route("/api/expenses", methods=["GET", "POST"])
def api_expenses():
    if request.method == "POST":
        data = request.get_json(force=True)
        if not data.get("amount") or not data.get("expense_date"):
            return jsonify(
                {"error": "amount and expense_date are required"}
            ), 400
        try:
            amount = float(data["amount"])
        except (TypeError, ValueError):
            return jsonify({"error": "amount must be a number"}), 400
        data["amount"] = abs(amount)
        eid = models.create_expense(data)
        if eid is None:
            return jsonify({"error": "duplicate"}), 409
        return jsonify({"id": eid}), 201
    return jsonify(
        models.list_expenses(
            platform=request.args.get("platform") or None,
            category=request.args.get("category") or None,
            month=request.args.get("month", "").strip() or None,
            search=request.args.get("q", "").strip() or None,
        )
    )


@app.route("/api/expenses/<int:expense_id>", methods=["DELETE"])
def api_expense_delete(expense_id):
    ok = models.delete_expense(expense_id)
    if not ok:
        return jsonify({"error": "not found"}), 404
    return jsonify({"ok": True})


@app.route("/api/summary")
def api_summary():
    month = request.args.get("month", "").strip() or None
    return jsonify(
        {
            "total": models.grand_total(month=month),
            "by_category": models.summary_by_category(month=month),
            "by_platform": models.summary_by_platform(month=month),
            "monthly": models.monthly_totals(),
        }
    )


@app.route("/api/import", methods=["POST"])
def api_import():
    if "file" not in request.files:
        return jsonify({"error": "no file uploaded"}), 400
    f = request.files["file"]
    filename = (f.filename or "").lower()
    if not any(filename.endswith(ext) for ext in ALLOWED_EXTENSIONS):
        return jsonify(
            {"error": "only .csv and .xlsx files are supported"}
        ), 400
    content = f.read()
    if len(content) > MAX_UPLOAD_BYTES:
        return jsonify({"error": "file too large (max 10MB)"}), 400
    platform, parsed = importers.detect_and_parse(content, filename)
    if platform is None:
        return jsonify(
            {"error": "could not detect WeChat or Alipay format"}
        ), 400
    imported, skipped = 0, 0
    for row in parsed:
        eid = models.create_expense(row)
        if eid is None:
            skipped += 1
        else:
            imported += 1
    return jsonify(
        {"platform": platform, "imported": imported, "skipped": skipped}
    )


if __name__ == "__main__":
    import os
    models.init_db()
    port = int(os.environ.get("PORT", 5001))
    app.run(host="0.0.0.0", port=port)

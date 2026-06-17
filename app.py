#!/usr/bin/env python3
# ════════════════════════════════════════════════════════════════════
#  HELIX · MaxEnt vs ABCD dashboard · Flask server                mk_1
# --------------------------------------------------------------------
#  Just run:  python app.py
#  Finds a free port (smart-select: tries 5000, walks up if busy),
#  opens the browser, serves the iframe shell + pages + analysis API.
# ════════════════════════════════════════════════════════════════════
import os, json, socket, threading, webbrowser
import numpy as np
from flask import Flask, render_template, jsonify, request, send_from_directory

import sys
sys.path.insert(0, os.path.dirname(__file__))
from core import helix_mi

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)                       # so relative data/ + static/out paths resolve
app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["TEMPLATES_AUTO_RELOAD"] = True      # pick up template edits without a restart
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0     # don't let the browser cache static files


@app.after_request
def _no_cache(resp):
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp

DATA = {
    "signal": os.path.join("data", "sample_signal.csv"),
    "background": os.path.join("data", "sample_background.csv"),
}


# ── smart port select (same mechanism as the BEARDOWN repo) ─────────
def find_free_port(start=5000, tries=200):
    for port in range(start, start + tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:   # nothing listening
                return port
    raise RuntimeError("no free port found in range")


# ── pages (loaded inside the iframe) ────────────────────────────────
@app.route("/")
def shell():
    return render_template("index.html")

@app.route("/main")
def page_main():
    return render_template("main.html")

@app.route("/data")
def page_data():
    return render_template("data.html")

@app.route("/references")
def page_references():
    return render_template("references.html")

@app.route("/glossary")
def page_glossary():
    return render_template("glossary.html")

@app.route("/qa")
def page_qa():
    return render_template("qa.html")

@app.route("/favicon.ico")
def favicon():
    return send_from_directory("static", "favicon.ico")


# ── data view-frame: CSV preview + summary stats ────────────────────
@app.route("/api/files")
def api_files():
    """Synopsis of every CSV in data/: rows, columns, region breakdown, size."""
    import glob, csv as _csv
    paths, seen = [], set()
    for p in list(DATA.values()) + sorted(glob.glob(os.path.join("data", "*.csv"))):
        ap = os.path.abspath(p)
        if os.path.exists(p) and ap not in seen:
            seen.add(ap); paths.append(p)
    files = []
    for p in paths:
        try:
            with open(p, newline="") as f:
                rd = _csv.reader(f)
                header = next(rd, [])
                ridx = header.index("region") if "region" in header else -1
                rows = 0; regions = {}
                for row in rd:
                    rows += 1
                    if 0 <= ridx < len(row):
                        regions[row[ridx]] = regions.get(row[ridx], 0) + 1
            role = next((k for k, v in DATA.items()
                         if os.path.abspath(v) == os.path.abspath(p)), "")
            files.append(dict(name=os.path.basename(p), role=role, rows=rows,
                              n_cols=len(header), columns=header, regions=regions,
                              size_kb=round(os.path.getsize(p) / 1024, 1)))
        except Exception as e:
            files.append(dict(name=os.path.basename(p), error=str(e)))
    return jsonify(files=files)


@app.route("/api/data")
def api_data():
    which = request.args.get("file", "background")
    region = request.args.get("region") or None
    path = DATA.get(which)
    if not path or not os.path.exists(path):
        return jsonify(error=f"missing file: {which}"), 404
    d, n = helix_mi.load_csv(path, region)
    cols = list(d.keys())
    isnum = {c: np.issubdtype(d[c].dtype, np.number) for c in cols}
    preview = []
    for i in range(min(n, 12)):
        preview.append({c: (round(float(d[c][i]), 4) if isnum[c]
                            else str(d[c][i])) for c in cols})
    stats = {}
    for c in cols:
        if isnum[c]:
            v = d[c]
            stats[c] = dict(mean=round(float(v.mean()), 3),
                            std=round(float(v.std()), 3),
                            min=round(float(v.min()), 3),
                            max=round(float(v.max()), 3))
    return jsonify(file=which, region=region or "all", n_rows=n,
                   columns=cols, preview=preview, stats=stats)


# ── run the analysis engine ─────────────────────────────────────────
@app.route("/api/categorize", methods=["POST"])
def api_categorize():
    try:
        res = helix_mi.categorize(DATA["signal"], DATA["background"],
                                  outdir=os.path.join("static", "out"))
        return jsonify(res)
    except Exception as e:
        return jsonify(error=str(e)), 200


@app.route("/api/run_both", methods=["POST"])
def api_run_both():
    body = request.get_json(silent=True) or {}
    ag = body.get("agreement_sample", "signal")
    out = {}
    try:
        for region in ("barrel", "endcap"):
            out[region] = helix_mi.analyze(DATA["signal"], DATA["background"],
                                           region=region, outdir=os.path.join("static", "out"),
                                           agreement_sample=ag)
        return jsonify(out)
    except Exception as e:
        return jsonify(error=str(e)), 200


@app.route("/api/run", methods=["POST"])
def api_run():
    body = request.get_json(silent=True) or {}
    region = body.get("region", "barrel")
    agreement_sample = body.get("agreement_sample", "signal")
    try:
        res = helix_mi.analyze(DATA["signal"], DATA["background"],
                               region=region, outdir=os.path.join("static", "out"),
                               agreement_sample=agreement_sample)
        return jsonify(res)
    except Exception as e:
        return jsonify(error=str(e)), 500


def open_browser(port):
    webbrowser.open(f"http://127.0.0.1:{port}/")


if __name__ == "__main__":
    port = find_free_port()
    print("=" * 56)
    print("  HELIX · MaxEnt vs ABCD dashboard")
    print(f"  serving at  http://127.0.0.1:{port}/")
    print("  Ctrl-C to stop")
    print("=" * 56)
    if os.environ.get("WERKZEUG_RUN_MAIN") != "true":
        threading.Timer(1.0, open_browser, args=(port,)).start()
    app.run(port=port, debug=False)

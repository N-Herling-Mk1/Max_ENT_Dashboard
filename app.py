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

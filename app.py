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
from core import helix_stats
from core import sec2_figs
from core import config as hxconfig

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)                       # so relative data/ + static/out paths resolve
app = Flask(__name__, static_folder="static", template_folder="templates")

# JSON-safe encoder: NaN / Infinity -> null (Flask's default emits bare NaN,
# which is invalid JSON and crashes JSON.parse on the client).
import math as _math
from flask.json.provider import DefaultJSONProvider

def _clean(o):
    if isinstance(o, float):
        return o if _math.isfinite(o) else None
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    return o

class SafeJSON(DefaultJSONProvider):
    def dumps(self, obj, **kw):
        return super().dumps(_clean(obj), **kw)

app.json = SafeJSON(app)
app.json.ensure_ascii = False
# Emit valid JSON: NaN/Infinity -> null (browsers' JSON.parse rejects bare NaN)
import math as _math
class _SafeJSON(app.json.__class__):
    def dumps(self, obj, **kw):
        def clean(o):
            if isinstance(o, float):
                return o if _math.isfinite(o) else None
            if isinstance(o, dict):
                return {k: clean(v) for k, v in o.items()}
            if isinstance(o, (list, tuple)):
                return [clean(v) for v in o]
            return o
        return super().dumps(clean(obj), **kw)
app.json = _SafeJSON(app)
app.config["TEMPLATES_AUTO_RELOAD"] = True      # pick up template edits without a restart
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0     # don't let the browser cache static files


@app.after_request
def _no_cache(resp):
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp

# ── data library (merged per-region tables produced by data/build_data.py) ──
MERGED = os.path.join("data", "merged")
DATA = {
    "background": os.path.join(MERGED, "background.csv"),
    "signal": {
        "mS5":  os.path.join(MERGED, "signal_mS5.csv"),
        "mS16": os.path.join(MERGED, "signal_mS16.csv"),
        "mS35": os.path.join(MERGED, "signal_mS35.csv"),
        "mS55": os.path.join(MERGED, "signal_mS55.csv"),
        "ALL":  os.path.join(MERGED, "signal_ALL.csv"),
    },
}
SIGNAL_POINTS = ["mS5", "mS16", "mS35", "mS55"]   # individual points
SIGNAL_ALL = "ALL"                                 # pooled combined sample
REGIONS = ["barrel", "endcap"]
CUT_MODES = ["absolute", "quantile"]

# server-side cache: results of the last full run, keyed for instant view slices
CACHE = {"results": {}, "meta": None}

def _all_csv_paths():
    paths = [DATA["background"]] + list(DATA["signal"].values())
    return [p for p in paths if os.path.exists(p)]


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

@app.route("/pyfiles")
def page_pyfiles():
    return render_template("pyfiles.html")

@app.route("/theory")
def page_theory():
    return render_template("theory.html")

@app.route("/sec2")
def page_sec2():
    return render_template("sec2.html")

@app.route("/twiki")
def twiki():
    return render_template("twiki.html")

@app.route("/sources")
def sources():
    return render_template("sources.html")

@app.route("/topology")
def page_topology():
    return render_template("topology.html")

@app.route("/favicon.ico")
def favicon():
    return send_from_directory("static", "favicon.ico")


@app.route("/assets/<path:fname>")
def assets(fname):
    return send_from_directory("assets", fname)


# ── data view-frame: CSV preview + summary stats ────────────────────
@app.route("/api/files")
def api_files():
    """Synopsis of every CSV in data/: rows, columns, region breakdown, size."""
    import csv as _csv
    paths, seen = [], set()
    for p in _all_csv_paths():
        ap = os.path.abspath(p)
        if ap not in seen:
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
            ap = os.path.abspath(p)
            if ap == os.path.abspath(DATA["background"]):
                role = "background"
            else:
                role = next((f"signal:{k}" for k, v in DATA["signal"].items()
                             if os.path.abspath(v) == ap), "")
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
    if which == "background":
        path = DATA["background"]
    elif which in DATA["signal"]:
        path = DATA["signal"][which]
    else:
        path = None
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


# ── compute-once / display-many analysis ────────────────────────────
def _compute_all(agreement_sample="signal"):
    """Run the full engine over background x every signal point x both regions
    x both cut modes. Returns a nested dict cached server-side; the UI then
    just selects slices to display (no recompute on toggle)."""
    out = {"category": {}, "analyze": {}}
    odir = os.path.join("static", "out")

    for cut_mode in CUT_MODES:
        out["category"][cut_mode] = {}
        out["analyze"][cut_mode] = {}
        for sp in SIGNAL_POINTS + [SIGNAL_ALL]:
            sig = DATA["signal"].get(sp)
            if not sig or not os.path.exists(sig):
                continue
            # category test (background classification, both regions)
            try:
                out["category"][cut_mode][sp] = helix_mi.categorize(
                    sig, DATA["background"], outdir=odir, cut_mode=cut_mode,
                    prefix=f"{sp}_{cut_mode}_")
            except Exception as e:
                out["category"][cut_mode][sp] = {"error": str(e)}
            # full analyze per region
            out["analyze"][cut_mode][sp] = {}
            for region in REGIONS:
                try:
                    out["analyze"][cut_mode][sp][region] = helix_mi.analyze(
                        sig, DATA["background"], region=region, outdir=odir,
                        agreement_sample=agreement_sample, cut_mode=cut_mode,
                        prefix=f"{sp}_{cut_mode}_")
                except Exception as e:
                    out["analyze"][cut_mode][sp][region] = {"error": str(e)}
    return out


@app.route("/api/run_all", methods=["POST"])
def api_run_all():
    """Compute everything once, cache it. UI calls /api/view afterwards."""
    body = request.get_json(silent=True) or {}
    ag = body.get("agreement_sample", "signal")
    try:
        import time as _t
        t0 = _t.time()
        CACHE["results"] = _compute_all(agreement_sample=ag)
        try:
            CACHE["full"] = helix_stats.run_full(DATA["background"])
        except Exception as _e:
            CACHE["full"] = {"error": str(_e)}
        CACHE["meta"] = {
            "agreement_sample": ag,
            "signal_points": SIGNAL_POINTS,
            "regions": REGIONS,
            "cut_modes": CUT_MODES,
            "elapsed_s": round(_t.time() - t0, 2),
            "generated": _t.strftime("%Y-%m-%d %H:%M:%S"),
        }
        return jsonify(ok=True, meta=CACHE["meta"])
    except Exception as e:
        return jsonify(ok=False, error=str(e)), 200


@app.route("/api/score_stats")
def api_score_stats():
    """min / median / max per NN score column (background). Feeds ABCD panel."""
    import numpy as np
    bg, _ = helix_mi.load_csv(DATA["background"])
    cols = {"barrel": ["scoreNN1b", "scoreNN2b"], "endcap": ["scoreNN1e", "scoreNN2e"]}
    out = {}
    for reg, cs in cols.items():
        out[reg] = {}
        for c in cs:
            v = np.asarray(bg.get(c, []), float)
            v = v[np.isfinite(v)]
            if v.size:
                out[reg][c] = {"min": float(v.min()), "max": float(v.max()),
                               "median": float(np.median(v)), "n": int(v.size)}
    return jsonify(data=out)


@app.route("/api/config", methods=["GET", "POST"])
def api_config():
    if request.method == "POST":
        patch = request.get_json(silent=True) or {}
        return jsonify(data=hxconfig.update(patch))
    return jsonify(data=hxconfig.load())


@app.route("/api/sec2")
def api_sec2():
    """ABCDisCo §II reconstruction on HELIX data/signal at the live config cut.
    ?region=endcap|barrel (default endcap). Returns the two-requirement
    decomposition: bg odds-ratio/closure + debiased MI (req-1), and per-mass
    normalized contamination r (req-2)."""
    region = request.args.get("region", "endcap")
    if region not in REGIONS:
        return jsonify(error=f"unknown region '{region}'"), 400
    cfg = hxconfig.load()
    cut = cfg["cuts"].get(region, [0.8, 0.8])
    sig = {m: DATA["signal"][m] for m in SIGNAL_POINTS
           if os.path.exists(DATA["signal"].get(m, ""))}
    try:
        data = helix_stats.sec2_reconstruction(DATA["background"], sig, region, cut)
        return jsonify(data=data, regions=REGIONS)
    except Exception as e:
        return jsonify(error=str(e)), 200


def _region_cut(region):
    cfg = hxconfig.load()
    return cfg["cuts"].get(region, [0.8, 0.8])


@app.route("/api/sec2_plane")
def api_sec2_plane():
    """Run-2 Fig 10 analogue: binned NN1×NN2 background plane + cut + cells."""
    region = request.args.get("region", "endcap")
    if region not in REGIONS:
        return jsonify(error=f"unknown region '{region}'"), 400
    bins = max(8, min(40, int(request.args.get("bins", 20))))
    overlay = request.args.get("signal")  # optional mS.. scatter overlay
    sample = DATA["signal"].get(overlay) if overlay else None
    try:
        d = sec2_figs.plane_histogram(DATA["background"], region,
                                      _region_cut(region), bins=bins, sample=sample)
        return jsonify(data=d)
    except Exception as e:
        return jsonify(error=str(e)), 200


@app.route("/api/sec2_splane")
def api_sec2_splane():
    """Run-2 Fig 8b analogue: signal-MC NN1×NN2 plane (normalised units)."""
    region = request.args.get("region", "endcap")
    if region not in REGIONS:
        return jsonify(error=f"unknown region '{region}'"), 400
    bins = max(8, min(40, int(request.args.get("bins", 20))))
    mass = request.args.get("signal", "mS35")
    sig = DATA["signal"].get(mass)
    if not sig or not os.path.exists(sig):
        return jsonify(error=f"no signal sample '{mass}'"), 200
    try:
        d = sec2_figs.signal_plane(sig, region, _region_cut(region), bins=bins)
        return jsonify(data=d)
    except Exception as e:
        return jsonify(error=str(e)), 200


@app.route("/api/sec2_card")
def api_sec2_card():
    """Single-cut dashboard card: match%/κ, N_A, agreement 2×2, shared U,
    co-info, I(X,Y;L), per-axis I(·;L). All live at the configured cut."""
    region = request.args.get("region", "endcap")
    if region not in REGIONS:
        return jsonify(error=f"unknown region '{region}'"), 400
    mass = request.args.get("signal", "mS35")
    sig = DATA["signal"].get(mass) or DATA["signal"].get("mS35")
    try:
        d = helix_stats.sec2_card(DATA["background"], sig, region, _region_cut(region))
        return jsonify(data=d)
    except Exception as e:
        return jsonify(error=str(e)), 200


@app.route("/api/sec2_pvalue")
def api_sec2_pvalue():
    """ABCDisCo Fig 2 (faithful two-panel): p vs δ_A [N_A×r family] and
    p vs N_A [r×σ_syst family]. ?dA sets the right-panel fixed δ_A."""
    try:
        dA = float(request.args.get("dA", 0.10))
        d = sec2_figs.pvalue_fig2(dA_right=dA)
        return jsonify(data=d)
    except Exception as e:
        return jsonify(error=str(e)), 200


@app.route("/api/sec2_rejr")
def api_sec2_rejr():
    """ABCDisCo Figs 5/7/8/12: background-rejection vs normalized r scatter."""
    region = request.args.get("region", "endcap")
    if region not in REGIONS:
        return jsonify(error=f"unknown region '{region}'"), 400
    mass = request.args.get("signal", "mS35")
    sig = DATA["signal"].get(mass)
    if not sig or not os.path.exists(sig):
        return jsonify(error=f"no signal sample '{mass}'"), 200
    try:
        d = sec2_figs.rejection_vs_r(DATA["background"], sig, region,
                                     _region_cut(region))
        return jsonify(data=d)
    except Exception as e:
        return jsonify(error=str(e)), 200


@app.route("/api/sec2_inject")
def api_sec2_inject():
    """Signal-injection curve: N_A obs vs ABCD pred vs injected N_S."""
    region = request.args.get("region", "endcap")
    if region not in REGIONS:
        return jsonify(error=f"unknown region '{region}'"), 400
    mass = request.args.get("signal", "mS35")
    sig = DATA["signal"].get(mass)
    if not sig or not os.path.exists(sig):
        return jsonify(error=f"no signal sample '{mass}'"), 200
    try:
        d = sec2_figs.injection_curve(DATA["background"], sig, region,
                                      _region_cut(region))
        return jsonify(data=d)
    except Exception as e:
        return jsonify(error=str(e)), 200


@app.route("/api/run", methods=["POST"])
def api_run():
    """Run the background-tier analysis with the CURRENT config (cuts+tau).
    Returns {full, maxent, cuts, tau_pct}. full keyed region:cutmode."""
    import numpy as np
    cfg = hxconfig.load()
    full = helix_stats.run_full(DATA["background"], cfg=hxconfig.engine_cfg())
    CACHE["full"] = full
    # optional: TRUE numerical max-ent (raw Pearson constraint), separate module
    if cfg.get("maxent_numeric"):
        from core import maxent_solver as msolver
        for region in REGIONS:
            key = region + ":absolute"
            if key not in full:
                continue
            xcol, ycol = helix_mi.resolve_axes(helix_mi.DEFAULTS, region)
            bg, _ = helix_mi.load_csv(DATA["background"], region)
            mm = np.isfinite(bg[xcol]) & np.isfinite(bg[ycol])
            xv = np.clip(bg[xcol][mm], 0, 1); yv = np.clip(bg[ycol][mm], 0, 1)
            cx, cy = cfg["cuts"][region]
            try:
                num = msolver.predict_na(xv, yv, float(cx), float(cy))
                full[key]["predictor"].update(
                    na_maxent_num=num["na_maxent_num"], na_maxent_num_err=num["na_maxent_num_err"],
                    rho_pearson=num["rho_pearson"], theta=num["theta"])
            except Exception as exc:
                full[key]["predictor"]["maxent_num_error"] = str(exc)
    maxent = {}
    for region in REGIONS:
        xcol, ycol = helix_mi.resolve_axes(helix_mi.DEFAULTS, region)
        bg, _ = helix_mi.load_csv(DATA["background"], region)
        m = np.isfinite(bg[xcol]) & np.isfinite(bg[ycol])
        bgs = {k: (v[m] if hasattr(v, "__len__") and len(v) == len(m) else v)
               for k, v in bg.items()}
        model = helix_mi.fit_maxent(bgs, helix_mi.present(bgs, helix_mi.DEFAULTS["count_features"]),
                                    helix_mi.present(bgs, helix_mi.DEFAULTS["cont_features"]))
        S, _ = helix_mi.surprise(bgs, model)
        tp = cfg["tau_pct"]
        maxent[region] = {"tau_pct": tp, "tau": float(np.percentile(S, tp)),
                          "S_bg_mean": float(S.mean())}
    return jsonify(data={"full": full, "maxent": maxent,
                         "cuts": cfg["cuts"], "tau_pct": cfg["tau_pct"]})


@app.route("/api/sweep")
def api_sweep():
    """Overlap (% match + κ) over the (cut_x, cut_y) grid, both regions.
    Fast: MaxEnt flag computed once, grid via matmul."""
    g = int(request.args.get("grid", 25))
    return jsonify(data=helix_stats.sweep_overlap(DATA["background"], grid_n=g))


@app.route("/api/sweep_label")
def api_sweep_label():
    """Label-aware sweep: co-information (redundancy/synergy of the two NN cuts
    against signal) + per-axis and joint I(NN;label), over the cut grid.
    Needs the signal MC; ?signal=mS35 (default) and ?prior=equal|mc."""
    g = int(request.args.get("grid", 25))
    sp = request.args.get("signal", "mS35")
    prior = request.args.get("prior", "equal")
    sig = DATA["signal"].get(sp)
    if not sig or not os.path.exists(sig):
        return jsonify(error=f"signal sample '{sp}' not found", data={}), 404
    data = helix_stats.sweep_label(DATA["background"], sig, grid_n=g, prior=prior)
    return jsonify(data=data, signal=sp, prior=prior)


@app.route("/api/topology")
def api_topology():
    """Per-cut feature cloud + 2-D PCA embedding + composite good-score.
    The 'data cloud' diagnostic for the topology view. ?signal=mS35 ?grid=25."""
    g = int(request.args.get("grid", 25))
    sp = request.args.get("signal", "mS35")
    sig = DATA["signal"].get(sp)
    if not sig or not os.path.exists(sig):
        return jsonify(error=f"signal sample '{sp}' not found", data={}), 404
    data = helix_stats.topology_cloud(DATA["background"], sig, grid_n=g)
    return jsonify(data=data, signal=sp)


@app.route("/api/full")
def api_full():
    """Redesigned background-tier (kappa, compatibility, predictor, PMI).
    Computed during /api/run_all; signal-independent, keyed region:cutmode."""
    return jsonify(data=CACHE.get("full") or {})


@app.route("/api/view")
def api_view():
    """Return a cached slice. Params: signal=mS35, cutmode=absolute,
    region=barrel|endcap|both, kind=analyze|category."""
    if not CACHE.get("results"):
        return jsonify(error="no results cached; POST /api/run_all first"), 200
    sp = request.args.get("signal", SIGNAL_POINTS[0])
    cut_mode = request.args.get("cutmode", "absolute")
    region = request.args.get("region", "both")
    kind = request.args.get("kind", "analyze")
    res = CACHE["results"]
    try:
        if kind == "category":
            return jsonify(meta=CACHE["meta"], data=res["category"][cut_mode][sp])
        block = res["analyze"][cut_mode][sp]
        if region in ("barrel", "endcap"):
            return jsonify(meta=CACHE["meta"], region=region, data=block[region])
        return jsonify(meta=CACHE["meta"], region="both", data=block)
    except KeyError as e:
        return jsonify(error=f"slice not in cache: {e}"), 200


@app.route("/api/pyfiles")
def api_pyfiles():
    """List the project's python files with a one-line purpose + line count."""
    desc = {
        "app.py": "Flask server. Smart-port launch, page routes, the analysis API "
                  "(/api/run_all computes everything once and caches; /api/view returns "
                  "cached slices instantly; /api/meta, /api/files, /api/data, /api/pyfiles).",
        "core/helix_mi.py": "The engine. Dependence ladder (Pearson, distance-corr, binned MI "
                  "with a permutation null), ABCD closure, MaxEnt surprise (Poisson+Gaussian per "
                  "feature), Case A/B classifier, agreement matrix, and all matplotlib plots. "
                  "Region-aware NN-score axes; absolute & quantile cut modes.",
        "core/__init__.py": "Marks core/ as a python package.",
        "data/build_data.py": "Joins the raw nn1+nn2 lane CSVs per region on eventNumber into "
                  "merged per-sample tables (data/merged/), tagging barrel/endcap. Run once after "
                  "new cutflow exports.",
    }
    files = []
    for rel, d in desc.items():
        p = os.path.join(ROOT, rel)
        if os.path.exists(p):
            try:
                with open(p) as fh:
                    lines = sum(1 for _ in fh)
            except Exception:
                lines = None
            files.append(dict(path=rel, desc=d, lines=lines,
                              size_kb=round(os.path.getsize(p)/1024, 1)))
    return jsonify(files=files)


@app.route("/api/meta")
def api_meta():
    """Library description for the UI (what to offer in selectors)."""
    return jsonify(
        signal_points=[sp for sp in SIGNAL_POINTS if os.path.exists(DATA["signal"].get(sp, ""))],
        signal_all=os.path.exists(DATA["signal"].get("ALL","")),
        regions=REGIONS, cut_modes=CUT_MODES,
        has_cache=bool(CACHE.get("results")),
        cache_meta=CACHE.get("meta"),
    )


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

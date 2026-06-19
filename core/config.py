#!/usr/bin/env python3
# ════════════════════════════════════════════════════════════════════
#  HELIX · config — single source of truth for cuts + MaxEnt tau.
#  Persisted to config.json (repo root). Edited via the UI (/api/config)
#  or the CLI:  python -m core.config --barrel 0.7 0.7 --endcap 0.8 0.8
#                                      --tau-pct 95
# ════════════════════════════════════════════════════════════════════
import os, json, argparse

CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config.json")

DEFAULTS = {
    "cuts": {"barrel": [0.7, 0.7], "endcap": [0.8, 0.8]},
    "tau_pct": 95.0,
    "maxent_numeric": False,
}


def load():
    cfg = {"cuts": dict(DEFAULTS["cuts"]), "tau_pct": DEFAULTS["tau_pct"], "maxent_numeric": DEFAULTS["maxent_numeric"]}
    if os.path.exists(CONFIG_PATH):
        try:
            d = json.load(open(CONFIG_PATH))
            if isinstance(d.get("cuts"), dict):
                for r, v in d["cuts"].items():
                    cfg["cuts"][r] = [float(v[0]), float(v[1])]
            if "tau_pct" in d:
                cfg["tau_pct"] = float(d["tau_pct"])
            if "maxent_numeric" in d:
                cfg["maxent_numeric"] = bool(d["maxent_numeric"])
        except Exception:
            pass
    return cfg


def save(cfg):
    json.dump(cfg, open(CONFIG_PATH, "w"), indent=2)
    return cfg


def update(patch):
    cfg = load()
    if isinstance(patch.get("cuts"), dict):
        for r, v in patch["cuts"].items():
            if r in cfg["cuts"] and v and len(v) == 2:
                cfg["cuts"][r] = [float(v[0]), float(v[1])]
    if "tau_pct" in patch:
        cfg["tau_pct"] = max(50.0, min(99.9, float(patch["tau_pct"])))
    if "maxent_numeric" in patch:
        cfg["maxent_numeric"] = bool(patch["maxent_numeric"])
    return save(cfg)


def engine_cfg():
    """Shape the cuts for helix_stats.run_full(cfg=...)."""
    c = load()
    return {"cuts": {r: tuple(v) for r, v in c["cuts"].items()}}


def _cli():
    ap = argparse.ArgumentParser(description="HELIX cut/tau config")
    ap.add_argument("--barrel", nargs=2, type=float, metavar=("X", "Y"))
    ap.add_argument("--endcap", nargs=2, type=float, metavar=("X", "Y"))
    ap.add_argument("--tau-pct", type=float, dest="tau_pct")
    ap.add_argument("--show", action="store_true")
    a = ap.parse_args()
    patch = {}
    if a.barrel or a.endcap:
        patch["cuts"] = {}
        if a.barrel:
            patch["cuts"]["barrel"] = a.barrel
        if a.endcap:
            patch["cuts"]["endcap"] = a.endcap
    if a.tau_pct is not None:
        patch["tau_pct"] = a.tau_pct
    cfg = update(patch) if patch else load()
    print(json.dumps(cfg, indent=2), "\n->", CONFIG_PATH)


if __name__ == "__main__":
    _cli()

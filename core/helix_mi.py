#!/usr/bin/env python3
# ════════════════════════════════════════════════════════════════════
#  HELIX · MaxEnt vs ABCD · analysis engine                       mk_1
# --------------------------------------------------------------------
#  numpy + matplotlib only (no scipy / no sklearn) — runs on ng02.
#  One entry point: analyze(...) -> JSON-able dict, writes PNGs.
#  Also runnable as a CLI:  python core/helix_mi.py --help
#
#  Dependence ladder (per class):  Pearson r  ⊂  distance corr dCor
#    ⊂  ABCD closure (2-bin MI)  ⊂  I(NN1;NN2) full MI  (+ perm null)
#  MaxEnt surprise S = Σ −log p_feature  (Gaussian cont / Poisson count),
#    reference fit on a NN-free background sample.
#  Agreement: per-event ABCD flag (region A) × MaxEnt flag (S>τ),
#    cross-tabbed; jumpers (the off-diagonal cells) profiled by feature.
# ════════════════════════════════════════════════════════════════════
import os, csv, json, time, argparse
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

VIRIDIS = "viridis"
SIG_C, BG_C = "#1D9E75", "#D85A30"     # plots only; chrome is themed in CSS


# ───────────────────────────── io ──────────────────────────────────
def load_csv(path, region=None, region_col="region"):
    rows = {}
    with open(path, newline="") as f:
        rd = csv.DictReader(f)
        cols = rd.fieldnames
        for c in cols:
            rows[c] = []
        for r in rd:
            if region and region_col in r and r[region_col] != region:
                continue
            for c in cols:
                rows[c].append(r[c])
    out = {}
    for c, v in rows.items():
        try:
            out[c] = np.asarray([float(x) for x in v])
        except ValueError:
            out[c] = np.asarray(v)           # non-numeric (e.g. region tag)
    n = len(next(iter(out.values()))) if out else 0
    return out, n


# ──────────────────────── dependence ladder ────────────────────────
def pearson_r(x, y):
    xc, yc = x - x.mean(), y - y.mean()
    d = np.sqrt((xc @ xc) * (yc @ yc))
    return float((xc @ yc) / d) if d > 0 else 0.0


def distance_correlation(x, y, cap=2000, seed=0):
    """dCor in [0,1]; 0 iff independent. O(n^2) -> subsample above cap."""
    x = np.asarray(x, float); y = np.asarray(y, float)
    n = len(x)
    if n > cap:
        idx = np.random.default_rng(seed).choice(n, cap, replace=False)
        x, y = x[idx], y[idx]
    a = np.abs(x[:, None] - x[None, :])
    b = np.abs(y[:, None] - y[None, :])
    A = a - a.mean(0)[None, :] - a.mean(1)[:, None] + a.mean()
    B = b - b.mean(0)[None, :] - b.mean(1)[:, None] + b.mean()
    dcov2 = (A * B).mean()
    vx, vy = (A * A).mean(), (B * B).mean()
    denom = np.sqrt(vx * vy)
    return float(np.sqrt(max(dcov2, 0.0) / denom)) if denom > 0 else 0.0


def binned_mi(x, y, bins, edges=None):
    if edges is None:
        edges = (np.histogram_bin_edges(x, bins), np.histogram_bin_edges(y, bins))
    pij, _, _ = np.histogram2d(x, y, bins=edges)
    pij = pij / pij.sum()
    pi = pij.sum(1, keepdims=True); pj = pij.sum(0, keepdims=True)
    nz = pij > 0
    mi = float(np.sum(pij[nz] * np.log(pij[nz] / (pi @ pj)[nz])))
    return mi, edges


def mi_permutation_null(x, y, bins, n_perm=200, seed=0):
    """Permutation null for I and dCor -> a significance, not a bare number."""
    rng = np.random.default_rng(seed)
    I_obs, edges = binned_mi(x, y, bins)
    null = np.empty(n_perm)
    for k in range(n_perm):
        null[k], _ = binned_mi(x, rng.permutation(y), bins, edges)
    mu, sd = null.mean(), null.std() + 1e-12
    return dict(I=I_obs, null_mean=float(mu), null_std=float(sd),
                sigma=float((I_obs - mu) / sd),
                margin=float(I_obs / mu) if mu > 0 else float("inf"))


def abcd_closure(x, y, cut_x, cut_y):
    hx, hy = x > cut_x, y > cut_y
    NA = int(np.sum(hx & hy));  NB = int(np.sum(hx & ~hy))
    NC = int(np.sum(~hx & hy)); ND = int(np.sum(~hx & ~hy))
    pred = (NB * NC / ND) if ND > 0 else float("nan")
    ratio = (NA / pred) if pred and pred == pred and pred > 0 else float("nan")
    tab = np.array([[ND, NC], [NB, NA]], float)
    if tab.sum() > 0:
        tab /= tab.sum()
        pi = tab.sum(1, keepdims=True); pj = tab.sum(0, keepdims=True)
        nz = tab > 0
        mi2 = float(np.sum(tab[nz] * np.log(tab[nz] / (pi @ pj)[nz])))
    else:
        mi2 = float("nan")
    return dict(NA=NA, NB=NB, NC=NC, ND=ND, pred=pred, ratio=ratio, mi_2bin=mi2)


# ───────────────────────── MaxEnt surprise ─────────────────────────
def _logfact_table(kmax):
    return np.concatenate([[0.0], np.cumsum(np.log(np.arange(1, kmax + 1)))])


def fit_maxent(bg, count_features, cont_features):
    """Fit per-feature MaxEnt laws on the (NN-free) background sample.
    Poisson for counts (mean), Gaussian for continuous (mean+var)."""
    model = {"count": {}, "cont": {}}
    for c in count_features:
        if c in bg:
            model["count"][c] = max(float(np.mean(bg[c])), 1e-6)
    for c in cont_features:
        if c in bg:
            v = bg[c]
            model["cont"][c] = (float(np.mean(v)), max(float(np.var(v)), 1e-9))
    return model


def surprise(sample, model):
    """S(x) = Σ_features −log p_feature(x).  Per-feature contributions kept."""
    n = len(next(iter(sample.values())))
    S = np.zeros(n)
    contrib = {}
    for c, mu in model["count"].items():
        if c not in sample:
            continue
        k = np.clip(np.round(sample[c]).astype(int), 0, None)
        lf = _logfact_table(int(k.max()) if k.size else 0)
        s = -(k * np.log(mu) - mu - lf[k])      # −log Poisson
        contrib[c] = s; S += s
    for c, (mu, var) in model["cont"].items():
        if c not in sample:
            continue
        s = 0.5 * np.log(2 * np.pi * var) + (sample[c] - mu) ** 2 / (2 * var)
        contrib[c] = s; S += s
    return S, contrib


# ──────────────────────── agreement + jumpers ──────────────────────
def agreement(x, y, S, cut_x, cut_y, tau):
    abcd = (x > cut_x) & (y > cut_y)          # in region A
    maxe = S > tau                            # MaxEnt-anomalous
    both = abcd & maxe
    abcd_only = abcd & ~maxe
    maxe_only = ~abcd & maxe
    neither = ~abcd & ~maxe
    idx = lambda m: np.nonzero(m)[0].tolist()
    cells = dict(
        both=dict(n=int(both.sum()), ids=idx(both)),
        abcd_only=dict(n=int(abcd_only.sum()), ids=idx(abcd_only)),
        maxent_only=dict(n=int(maxe_only.sum()), ids=idx(maxe_only)),
        neither=dict(n=int(neither.sum()), ids=idx(neither)),
    )
    same = cells["both"]["n"] + cells["neither"]["n"]
    diff = cells["abcd_only"]["n"] + cells["maxent_only"]["n"]
    return dict(cells=cells, same=same, different=diff,
                masks=dict(abcd_only=abcd_only, maxent_only=maxe_only,
                           agree=both | neither))


def jumper_profile(sample, masks, features):
    """For each off-diagonal (jumper) cell, rank features by standardized
    shift vs the agreeing population. The 'specific type' that crosses."""
    agree = masks["agree"]
    prof = {}
    for cell in ("abcd_only", "maxent_only"):
        m = masks[cell]
        feats = []
        if m.sum() >= 2 and agree.sum() >= 2:
            for c in features:
                if c not in sample:
                    continue
                base = sample[c][agree]
                jump = sample[c][m]
                sd = base.std() + 1e-9
                z = float((jump.mean() - base.mean()) / sd)
                feats.append(dict(feature=c, z=z,
                                  jump_mean=float(jump.mean()),
                                  base_mean=float(base.mean())))
        feats.sort(key=lambda d: -abs(d["z"]))
        prof[cell] = feats
    return prof


# ─────────────────────────── plots ─────────────────────────────────
def _plane(ax, x, y, cut_x, cut_y, title):
    ax.set_facecolor("white")
    lim_x = np.quantile(x, [0.001, 0.999]); lim_y = np.quantile(y, [0.001, 0.999])
    ax.hist2d(x, y, bins=110, cmap=VIRIDIS,
              range=[lim_x, lim_y] if lim_x[0] < lim_x[1] else None)
    ax.axvline(cut_x, color="w", lw=1.1, ls="--")
    ax.axhline(cut_y, color="w", lw=1.1, ls="--")
    ax.set_title(title, fontsize=11, fontweight="bold")
    ax.set_xlabel("NN1"); ax.set_ylabel("NN2")


def make_plots(sig, bg, xcol, ycol, cut_x, cut_y, outdir, tag):
    paths = {}
    # planes
    fig, ax = plt.subplots(figsize=(5.0, 4.2)); fig.patch.set_facecolor("white")
    _plane(ax, sig[xcol], sig[ycol], cut_x, cut_y, "signal plane")
    p = os.path.join(outdir, f"{tag}_signal_plane.png"); fig.tight_layout()
    fig.savefig(p, dpi=120, facecolor="white"); plt.close(fig); paths["signal_plane"] = p

    fig, ax = plt.subplots(figsize=(5.0, 4.2)); fig.patch.set_facecolor("white")
    _plane(ax, bg[xcol], bg[ycol], cut_x, cut_y, "background plane")
    p = os.path.join(outdir, f"{tag}_background_plane.png"); fig.tight_layout()
    fig.savefig(p, dpi=120, facecolor="white"); plt.close(fig); paths["background_plane"] = p

    # pmi field (signal): log[ p(x,y) / pX pY ]
    fig, ax = plt.subplots(figsize=(5.0, 4.2)); fig.patch.set_facecolor("white")
    ax.set_facecolor("white")
    pij, ex, ey = np.histogram2d(sig[xcol], sig[ycol], bins=40)
    pij = pij / pij.sum(); pi = pij.sum(1, keepdims=True); pj = pij.sum(0, keepdims=True)
    with np.errstate(divide="ignore", invalid="ignore"):
        pmi = np.log(pij / (pi @ pj))
    pmi[~np.isfinite(pmi)] = 0.0
    im = ax.imshow(pmi.T, origin="lower", aspect="auto", cmap=VIRIDIS,
                   extent=[ex[0], ex[-1], ey[0], ey[-1]])
    fig.colorbar(im, ax=ax, label="pmi (nats)")
    ax.set_title("pmi field — where I lives (signal)", fontsize=11, fontweight="bold")
    ax.set_xlabel("NN1"); ax.set_ylabel("NN2")
    p = os.path.join(outdir, f"{tag}_pmi_field.png"); fig.tight_layout()
    fig.savefig(p, dpi=120, facecolor="white"); plt.close(fig); paths["pmi_field"] = p
    return paths


# ─────────────────────────── driver ────────────────────────────────
DEFAULTS = dict(
    xcol="scoreNN1b", ycol="scoreNN2b",
    count_features=["nMDT", "nRPC", "nTGC", "nBOL"],
    cont_features=["clusE", "rms_clustime", "mindR", "isolation", "MET_dphi"],
    cuts={"barrel": (0.5, 0.5), "endcap": (0.8, 0.8)},
    n_bins=24, tau_pct=95.0, n_perm=200,
)


def analyze(signal_csv, background_csv, region="barrel", outdir="static/out",
            agreement_sample="signal", **kw):
    cfg = {**DEFAULTS, **kw}
    os.makedirs(outdir, exist_ok=True)
    t0 = time.time()
    xcol, ycol = cfg["xcol"], cfg["ycol"]
    cut_x, cut_y = cfg["cuts"].get(region, (0.5, 0.5))
    feats = cfg["count_features"] + cfg["cont_features"]

    sig, n_sig = load_csv(signal_csv, region)
    bg, n_bg = load_csv(background_csv, region)
    if n_sig == 0 or n_bg == 0:
        raise ValueError(f"empty sample for region={region}: n_sig={n_sig} n_bg={n_bg}")

    def ladder(d):
        r = pearson_r(d[xcol], d[ycol])
        dc = distance_correlation(d[xcol], d[ycol])
        nulls = mi_permutation_null(d[xcol], d[ycol], cfg["n_bins"], cfg["n_perm"])
        clo = abcd_closure(d[xcol], d[ycol], cut_x, cut_y)
        return dict(pearson_r=r, dcor=dc, mi=nulls, closure=clo, n=len(d[xcol]))

    res = {"region": region, "cuts": {"NN1": cut_x, "NN2": cut_y},
           "ladder": {"signal": ladder(sig), "background": ladder(bg)}}

    # MaxEnt: fit reference on background, score both
    model = fit_maxent(bg, cfg["count_features"], cfg["cont_features"])
    S_bg, _ = surprise(bg, model)
    S_sig, contrib = surprise(sig, model)
    tau = float(np.percentile(S_bg, cfg["tau_pct"]))
    res["maxent"] = {"tau": tau, "tau_pct": cfg["tau_pct"],
                     "S_bg_mean": float(S_bg.mean()), "S_sig_mean": float(S_sig.mean()),
                     "features": {"poisson": list(model["count"]), "gaussian": list(model["cont"])}}

    # agreement + jumpers on the chosen sample
    tgt, S_tgt = (sig, S_sig) if agreement_sample == "signal" else (bg, S_bg)
    agr = agreement(tgt[xcol], tgt[ycol], S_tgt, cut_x, cut_y, tau)
    prof = jumper_profile(tgt, agr["masks"], feats)
    res["agreement"] = {"sample": agreement_sample,
                        "cells": agr["cells"], "same": agr["same"],
                        "different": agr["different"], "jumpers": prof}

    paths = make_plots(sig, bg, xcol, ycol, cut_x, cut_y, outdir, region)
    res["plots"] = {k: os.path.relpath(v, "static").replace(os.sep, "/")
                    for k, v in paths.items()}
    res["meta"] = {"n_signal": n_sig, "n_background": n_bg,
                   "elapsed_s": round(time.time() - t0, 2),
                   "generated": time.strftime("%Y-%m-%d %H:%M:%S")}
    return res


def main():
    ap = argparse.ArgumentParser(description="HELIX MaxEnt vs ABCD engine")
    ap.add_argument("--signal", default="data/sample_signal.csv")
    ap.add_argument("--background", default="data/sample_background.csv")
    ap.add_argument("--region", default="barrel", choices=["barrel", "endcap"])
    ap.add_argument("--outdir", default="static/out")
    ap.add_argument("--agreement-sample", default="signal", choices=["signal", "background"])
    a = ap.parse_args()
    res = analyze(a.signal, a.background, region=a.region, outdir=a.outdir,
                  agreement_sample=a.agreement_sample)
    print(json.dumps({k: v for k, v in res.items() if k != "agreement"}, indent=2))
    ag = res["agreement"]
    print(f"\nagreement ({ag['sample']}): same={ag['same']} different={ag['different']} "
          f"| both={ag['cells']['both']['n']} abcd_only={ag['cells']['abcd_only']['n']} "
          f"maxent_only={ag['cells']['maxent_only']['n']} neither={ag['cells']['neither']['n']}")


if __name__ == "__main__":
    main()

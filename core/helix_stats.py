#!/usr/bin/env python3
# ════════════════════════════════════════════════════════════════════
#  HELIX · corrected statistics layer                            mk_1
# --------------------------------------------------------------------
#  Additive module. Leaves core/helix_mi.py (analyze + plots) intact.
#  Fixes / adds, all numpy-only:
#    closure_ci         ABCD closure with Poisson-propagated CI + dev σ
#    kappa_agreement    Cohen's κ + chance baseline (replaces raw %)
#    mi_debiased        permutation-debiased MI + mean|pmi| vs null
#    count_regime       events/filled-cell → Poisson (sparse)/Gaussian
#    abcd_compatibility graded 0–100% score (replaces hard Case A/B)
#    maxent_predict_na  Gaussian-copula MaxEnt N_A predictor + bootstrap CI
#                       (marginals + ONE correlation constraint; ρ→0 = ABCD)
#    pmi_jumpers        per-event PMI, sign class, shuffle null, ML payload
#    run_full           one-shot dict for region×cutmode; selectors read it
# ════════════════════════════════════════════════════════════════════
import numpy as np
from core import helix_mi as H


# ─────────────────────────── closure + CI ──────────────────────────
def closure_ci(x, y, cut_x, cut_y):
    hx, hy = x > cut_x, y > cut_y
    NA = int(np.sum(hx & hy)); NB = int(np.sum(hx & ~hy))
    NC = int(np.sum(~hx & hy)); ND = int(np.sum(~hx & ~hy))
    if ND > 0 and NB > 0 and NC > 0:
        pred = NB * NC / ND
        pred_err = pred * np.sqrt(1/NB + 1/NC + 1/ND)
        ratio = NA / pred if pred > 0 else float("nan")
        ratio_err = ratio * np.sqrt(1/max(NA, 1) + 1/NB + 1/NC + 1/ND)
        dev_sigma = abs(NA - pred) / np.sqrt(NA + pred_err**2) if (NA + pred_err**2) > 0 else 0.0
    else:
        pred = pred_err = ratio = ratio_err = dev_sigma = float("nan")
    return dict(NA=NA, NB=NB, NC=NC, ND=ND,
                pred=_f(pred), pred_err=_f(pred_err),
                ratio=_f(ratio), ratio_err=_f(ratio_err),
                dev_sigma=_f(dev_sigma))


# ───────────────────── Cohen's κ agreement ─────────────────────────
def kappa_agreement(abcd_flag, maxent_flag):
    a = np.asarray(abcd_flag, bool); b = np.asarray(maxent_flag, bool)
    n = len(a)
    both = int(np.sum(a & b)); ao = int(np.sum(a & ~b))
    mo = int(np.sum(~a & b)); ne = int(np.sum(~a & ~b))
    po = (both + ne) / n
    pa, pb = a.mean(), b.mean()
    pe = pa * pb + (1 - pa) * (1 - pb)
    kappa = (po - pe) / (1 - pe) if (1 - pe) > 0 else float("nan")
    lab = ("none" if kappa < 0.0 else "slight" if kappa < 0.2 else "fair"
           if kappa < 0.4 else "moderate" if kappa < 0.6 else "substantial")
    return dict(raw=_f(100 * po), chance=_f(100 * pe), kappa=_f(kappa), label=lab,
                cells=dict(both=both, abcd_only=ao, maxent_only=mo, neither=ne))


# ──────────────────────── debiased MI ──────────────────────────────
def mi_debiased(x, y, bins=16, n_perm=200, seed=0):
    I_obs, edges = H.binned_mi(x, y, bins)
    rng = np.random.default_rng(seed)
    null = np.empty(n_perm)
    for k in range(n_perm):
        null[k], _ = H.binned_mi(x, rng.permutation(y), bins, edges)
    mu, sd = float(null.mean()), float(null.std() + 1e-12)
    # mean |pmi| observed vs null, the honest "is there structure" readout
    joint = H.build_joint({"x": x, "y": y}, "x", "y", bins)
    _, pmi = H.detector_eval({"x": x, "y": y}, joint, "x", "y")
    return dict(I_plugin=_f(I_obs), null_mean=_f(mu), null_std=_f(sd),
                I_debiased=_f(max(I_obs - mu, 0.0)),
                sigma=_f((I_obs - mu) / sd),
                mean_abs_pmi=_f(float(np.abs(pmi).mean())))


# ───────────────────── count-statistics regime ─────────────────────
def count_regime(x, y, bins=16, poisson_max=10.0):
    pij, _, _ = np.histogram2d(x, y, bins=bins, range=[[0, 1], [0, 1]])
    filled = pij[pij > 0]
    occ = float(100 * (pij > 0).mean())
    per_cell = float(filled.mean()) if filled.size else 0.0
    fit = "Poisson" if per_cell < poisson_max else "Gaussian"
    return dict(occupancy=_f(occ), per_cell=_f(per_cell), fit=fit,
                rationale=("sparse cells, counting statistics / Bernoulli-sum class"
                           if fit == "Poisson" else "dense cells, Normal limit"))


# ─────────────── graded ABCD-compatibility (no hard A/B) ────────────
def abcd_compatibility(closure, dcor, mi):
    dev = closure["dev_sigma"]
    dterm = min(abs(dev) / 3.0, 1.0) * 0.5 if np.isfinite(dev) else 0.5
    cterm = min(float(dcor) / 0.30, 1.0) * 0.5
    score = 100.0 * (1.0 - dterm - cterm)
    score = max(0.0, min(100.0, score))
    binding = ("closure fails at %.1fσ" % dev if (np.isfinite(dev) and dev > 2.0)
               else "dependence dCor=%.3f" % dcor if dcor > 0.15
               else "closure consistent, dependence small")
    # honest contradiction flag: significant MI but tiny magnitude
    contradiction = (abs(mi["sigma"]) > 5.0 and mi["mean_abs_pmi"] < 0.15
                     and (not np.isfinite(closure["dev_sigma"]) or closure["dev_sigma"] < 2.0))
    return dict(score=_f(score), binding=binding,
                note=("MI σ=%.1f is N-inflated (mean|pmi|=%.2f); closure governs"
                      % (mi["sigma"], mi["mean_abs_pmi"]) if contradiction else binding))


# ─────────── MaxEnt N_A predictor: marginals + 1 correlation ────────
def _normal_scores(v, ref):
    """Map values to normal scores via empirical rank against a (pre-sorted)
    normal ref grid. np.interp is far faster than np.quantile for large v."""
    order = np.argsort(np.argsort(v))
    q = (order + 0.5) / len(v)
    cdf = (np.arange(len(ref)) + 0.5) / len(ref)
    return np.interp(q, cdf, ref)


def maxent_predict_na(x, y, cut_x, cut_y, n_mc=20000, n_boot=40, seed=0):
    """Gaussian-copula MaxEnt: fixed empirical marginals + ONE correlation ρ,
    ρ measured in the CONTROL regions (not A) so it is non-circular. The
    maximum-entropy joint for fixed marginals + given correlation is the
    Gaussian copula. ρ→0 reproduces the independence (ABCD) prediction.
    Returns predicted N_A with a bootstrap CI; ABCD pred for reference."""
    rng = np.random.default_rng(seed)
    N = len(x)
    ref = rng.standard_normal(20000); ref.sort()
    ctrl = ~((x > cut_x) & (y > cut_y))

    def rho_ctrl(xc, yc):
        if len(xc) < 8:
            return 0.0
        zx = _normal_scores(xc, ref); zy = _normal_scores(yc, ref)
        r = np.corrcoef(zx, zy)[0, 1]
        return float(np.clip(r if np.isfinite(r) else 0.0, -0.95, 0.95))

    sx = np.sort(x); sy = np.sort(y)
    cdf = (np.arange(N) + 0.5) / N           # empirical CDF grid for inverse-sampling

    def p_A(rho, rs, _sx=sx, _sy=sy, _cdf=cdf):
        z1 = rs.standard_normal(n_mc)
        z2 = rho * z1 + np.sqrt(max(1 - rho * rho, 0)) * rs.standard_normal(n_mc)
        u = 0.5 * (1 + _erf(z1 / np.sqrt(2)))
        v = 0.5 * (1 + _erf(z2 / np.sqrt(2)))
        xx = np.interp(u, _cdf, _sx); yy = np.interp(v, _cdf, _sy)   # C-fast inverse-CDF
        return float(np.mean((xx > cut_x) & (yy > cut_y)))

    rho_hat = rho_ctrl(x[ctrl], y[ctrl])
    na_me = N * p_A(rho_hat, np.random.default_rng(seed + 1))
    na_indep = N * p_A(0.0, np.random.default_rng(seed + 2))

    # bootstrap CI over events (resample, refit ρ on control, repredict)
    boot = np.empty(n_boot)
    for k in range(n_boot):
        idx = rng.integers(0, N, N)
        xb, yb = x[idx], y[idx]
        cb = ~((xb > cut_x) & (yb > cut_y))
        rb = rho_ctrl(xb[cb], yb[cb])
        boot[k] = len(xb) * p_A(rb, np.random.default_rng(seed + 100 + k))
    lo, hi = np.percentile(boot, [16, 84])

    clo = closure_ci(x, y, cut_x, cut_y)
    return dict(rho_ctrl=_f(rho_hat),
                na_maxent=_f(na_me), na_maxent_err=_f(0.5 * (hi - lo)),
                na_indep_check=_f(na_indep),
                na_abcd=clo["pred"], na_abcd_err=clo["pred_err"],
                na_observed=clo["NA"])


# ───────────────── per-event PMI jumpers + null band ───────────────
def pmi_jumpers(x, y, bins=16, top_q=0.90, seed=0):
    d = {"x": np.asarray(x, float), "y": np.asarray(y, float)}
    joint = H.build_joint(d, "x", "y", bins)
    _, pmi = H.detector_eval(d, joint, "x", "y")
    N = len(pmi)
    thr = float(np.quantile(np.abs(pmi), top_q))
    is_j = np.abs(pmi) >= thr
    pos = is_j & (pmi > 0)   # MaxEnt adds density here
    neg = is_j & (pmi < 0)   # ABCD over-counts here
    NI = float(np.sum(pmi))
    # shuffle null: enforce independence, recompute mean|pmi|
    rng = np.random.default_rng(seed)
    d2 = {"x": d["x"], "y": rng.permutation(d["y"])}
    _, pmi0 = H.detector_eval(d2, H.build_joint(d2, "x", "y", bins), "x", "y")
    payload = dict(pmi=pmi.tolist())  # per-event ML feature
    return dict(threshold=_f(thr), n_jumpers=int(is_j.sum()),
                n_pos=int(pos.sum()), n_neg=int(neg.sum()),
                mi_capture_pct=_f(100 * np.sum(pmi[is_j]) / NI if NI else 0.0),
                agree_mean_pmi=_f(float(pmi[~is_j].mean())),
                mean_abs_pmi=_f(float(np.abs(pmi).mean())),
                null_mean_abs_pmi=_f(float(np.abs(pmi0).mean())),
                masks=dict(jumper=is_j, pos=pos, neg=neg),
                _payload=payload)


# ──────────────────────── one-shot driver ──────────────────────────
def run_full(background_csv, cfg=None, bins=16, modes=("absolute",)):
    """Compute the full background tier for every region × cutmode, once.
    Returns a dict the dashboard selectors index by region+cutmode.
    modes defaults to ('absolute',) — the dashboard only shows that; pass
    ('absolute','quantile') for both."""
    base = {**H.DEFAULTS, **(cfg or {})}
    out = {}
    for region in ("barrel", "endcap"):
        xcol, ycol = H.resolve_axes(base, region)
        try:
            bg, _ = H.load_csv(background_csv, region)
        except Exception:
            continue
        m = np.isfinite(bg[xcol]) & np.isfinite(bg[ycol])
        x = np.clip(bg[xcol][m], 0, 1); y = np.clip(bg[ycol][m], 0, 1)
        if len(x) == 0:
            continue
        bgslice = {k: (v[m] if hasattr(v, "__len__") and len(v) == len(m) else v)
                   for k, v in bg.items()}
        regime = count_regime(x, y, bins)
        for mode in modes:
            if mode == "quantile":
                qx, qy = base["quantile"]
                cx, cy = float(np.quantile(x, qx)), float(np.quantile(y, qy))
            else:
                cx, cy = base["cuts"][region]
            clo = closure_ci(x, y, cx, cy)
            dcor = H.distance_correlation(x, y)
            mi = mi_debiased(x, y, bins)
            # MaxEnt-flag for the agreement crosstab: PMI-based (thesis-correct)
            jm = pmi_jumpers(x, y, bins)
            abcd_flag = (x > cx) & (y > cy)
            maxent_flag = jm["masks"]["jumper"] & (
                H.detector_eval({"x": x, "y": y},
                                H.build_joint({"x": x, "y": y}, "x", "y", bins),
                                "x", "y")[1] > 0)
            agr = kappa_agreement(abcd_flag, maxent_flag)
            compat = abcd_compatibility(clo, dcor, mi)
            pred = maxent_predict_na(x, y, cx, cy)
            out[f"{region}:{mode}"] = dict(
                region=region, cutmode=mode, N=int(len(x)), cut=[_f(cx), _f(cy)],
                closure=clo, dcor=_f(dcor), mi=mi, regime=regime,
                agreement=agr, compatibility=compat, predictor=pred,
                jumpers={k: v for k, v in jm.items() if not k.startswith("_") and k != "masks"})
    return out


# ─────────────────────────── helpers ───────────────────────────────
def _f(v):
    try:
        v = float(v)
        return None if (np.isnan(v) or np.isinf(v)) else round(v, 6)
    except (TypeError, ValueError):
        return None


def _erf(z):
    # Abramowitz-Stegun 7.1.26 (numpy-only, no scipy)
    t = 1.0 / (1.0 + 0.3275911 * np.abs(z))
    y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
                - 0.284496736) * t + 0.254829592) * t * np.exp(-z * z)
    return np.sign(z) * y


if __name__ == "__main__":
    import json, sys
    bgc = sys.argv[1] if len(sys.argv) > 1 else "data/merged/background.csv"
    res = run_full(bgc)
    for k, v in res.items():
        print(k, "→ κ=%.3f compat=%.0f%% closure ratio=%s±%s MaxEnt N_A=%s±%s vs ABCD %s±%s (obs %s)" % (
            v["agreement"]["kappa"], v["compatibility"]["score"],
            v["closure"]["ratio"], v["closure"]["ratio_err"],
            v["predictor"]["na_maxent"], v["predictor"]["na_maxent_err"],
            v["predictor"]["na_abcd"], v["predictor"]["na_abcd_err"],
            v["predictor"]["na_observed"]))


# ───────────── threshold sweep (overlap over the cut grid) ──────────
def sweep_overlap(background_csv, grid_n=25, bins=16, cfg=None):
    """Overlap (% match + κ) between ABCD-in-A and the MaxEnt PMI flag,
    over a grid_n × grid_n grid of (cut_x, cut_y) per region.
    SPEED: the MaxEnt flag is cut-independent → computed ONCE; the whole
    cut grid is then two matrix multiplications, not a per-cut loop."""
    import numpy as np
    base = {**H.DEFAULTS, **(cfg or {})}
    grid = np.linspace(0.05, 0.95, grid_n)
    out = {}
    for region in ("barrel", "endcap"):
        xcol, ycol = H.resolve_axes(base, region)
        bg, _ = H.load_csv(background_csv, region)
        m = np.isfinite(bg[xcol]) & np.isfinite(bg[ycol])
        x = np.clip(bg[xcol][m], 0, 1); y = np.clip(bg[ycol][m], 0, 1)
        N = len(x)
        if N == 0:
            continue
        d = {"x": x, "y": y}
        jm = pmi_jumpers(x, y, bins)
        _, pmi = H.detector_eval(d, H.build_joint(d, "x", "y", bins), "x", "y")
        maxe = (jm["masks"]["jumper"] & (pmi > 0)).astype(float)   # cut-independent
        me_tot = float(maxe.sum())
        Gx = (x[:, None] > grid[None, :]).astype(float)           # N × K
        Gy = (y[:, None] > grid[None, :]).astype(float)           # N × K
        A = Gx.T @ Gy                                             # K × K : N_A(cx,cy)
        both = (Gx * maxe[:, None]).T @ Gy                       # K × K
        neither = N - A - (me_tot - both)
        raw = (both + neither) / N
        pa = A / N; pb = me_tot / N
        pe = pa * pb + (1 - pa) * (1 - pb)
        with np.errstate(divide="ignore", invalid="ignore"):
            kappa = np.where((1 - pe) > 1e-9, (raw - pe) / (1 - pe), 0.0)
        out[region] = dict(
            grid=[round(float(g), 3) for g in grid], N=N, maxe_n=int(me_tot),
            raw=[[round(float(v) * 100, 1) for v in row] for row in raw],
            kappa=[[round(float(v), 3) for v in row] for row in kappa],
            A=[[int(v) for v in row] for row in A],
            both=[[int(v) for v in row] for row in both],
        )
    return out

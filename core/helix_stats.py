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
            nx=[int(v) for v in Gx.sum(0)],   # N(x>grid[i]) per cut_x
            ny=[int(v) for v in Gy.sum(0)],   # N(y>grid[j]) per cut_y
        )
    return out


def _xlog2(p):
    import numpy as np
    p = np.asarray(p, float)
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(p > 0, -p * np.log2(p), 0.0)


# ════════════════════════════════════════════════════════════════════
#  Section II reconstruction (ABCDisCo PRD 103.035021, §II) on HELIX
#  data/signal. Decomposes the ABCD prediction error into the two
#  ORTHOGONAL requirements the paper isolates, with our real counts:
#    REQ-1  independence/closure   — bg cell odds ratio OR_bg (Eq 2.3-2.5)
#           exact identity: kappa_need = N_A,obs / N_A,pred = OR_bg.
#           Threshold-independent necessary condition: debiased MI = 0.
#           >> this is the ONLY axis MaxEnt/copula touches <<
#    REQ-2  normalized contamination r = δ_A⁻¹(δ_B+δ_C−δ_D)  (Eq 2.8-2.9)
#           per signal mass; |r|≪1 required. r is METHOD-INVARIANT
#           (same plane, same signal) → identical for ABCD and MaxEnt.
#    Eq 2.10 bias expansion: N_A,pred = N_A,b·(1+δ_A·r); the signal
#           excess surviving ABCD's own background prediction is ∝ (1−r).
# ════════════════════════════════════════════════════════════════════
def sec2_reconstruction(background_csv, signal_paths, region, cut, bins=16):
    """signal_paths: {mass_label: csv_path}. cut: (cx, cy). Returns a JSON-
    ready dict mirroring ABCDisCo §II, all numbers from the real samples."""
    cx, cy = float(cut[0]), float(cut[1])
    xcol, ycol = H.resolve_axes(H.DEFAULTS, region)

    def load_xy(path):
        d, _ = H.load_csv(path, region)
        m = np.isfinite(d[xcol]) & np.isfinite(d[ycol])
        return np.clip(d[xcol][m], 0, 1), np.clip(d[ycol][m], 0, 1)

    def cells(x, y):
        hx, hy = x > cx, y > cy
        return (int(np.sum(hx & hy)), int(np.sum(hx & ~hy)),
                int(np.sum(~hx & hy)), int(np.sum(~hx & ~hy)))

    xb, yb = load_xy(background_csv)
    A, B, Cc, D = cells(xb, yb)

    # REQ-1 : closure / independence
    clo = closure_ci(xb, yb, cx, cy)
    OR_bg = (A * D) / (B * Cc) if (B * Cc) > 0 else float("nan")   # == kappa_need
    mi = mi_debiased(xb, yb, bins)

    # REQ-2 : normalized signal contamination, per mass (Eq 2.8)
    masses = []
    for label, path in signal_paths.items():
        try:
            xs, ys = load_xy(path)
        except Exception as exc:
            masses.append(dict(mass=label, error=str(exc)))
            continue
        sA, sB, sC, sD = cells(xs, ys)

        def dlt(ns, nb):
            return (ns / nb) if nb > 0 else float("nan")
        dA, dB, dC, dD = dlt(sA, A), dlt(sB, B), dlt(sC, Cc), dlt(sD, D)
        r = (dB + dC - dD) / dA if (dA and np.isfinite(dA)) else float("nan")
        # Eq 2.10 readouts: bg over-prediction factor and surviving-excess frac
        bias_factor = (1.0 + dA * r) if np.isfinite(r) else float("nan")   # N_A,pred/N_A,b
        surviving = (1.0 - r) if np.isfinite(r) else float("nan")          # ∝ apparent/true excess
        naive_ok = bool(np.isfinite(max(dB, dC)) and max(dB, dC) < 0.10)   # δ_i≪1 (Eq 2.7)
        norm_ok = bool(np.isfinite(r) and abs(r) < 0.10)                   # |r|≪1 (Eq 2.9)
        masses.append(dict(
            mass=label, cells=dict(A=sA, B=sB, C=sC, D=sD),
            dA=_f(dA), dB=_f(dB), dC=_f(dC), dD=_f(dD), r=_f(r),
            bias_factor=_f(bias_factor), surviving=_f(surviving),
            naive_ok=naive_ok, norm_ok=norm_ok,
            absorbed_pct=_f(100 * r) if np.isfinite(r) else None))

    return dict(
        region=region, cut=[_f(cx), _f(cy)], N_bg=int(len(xb)),
        axes=dict(x=xcol, y=ycol),
        bg=dict(A=A, B=B, C=Cc, D=D,
                abcd_pred=clo["pred"], abcd_pred_err=clo["pred_err"],
                dev_sigma=clo["dev_sigma"],
                OR_bg=_f(OR_bg), kappa_need=_f(OR_bg)),   # identity, surfaced twice on purpose
        mi=dict(I_plugin=mi["I_plugin"], I_debiased=mi["I_debiased"],
                sigma=mi["sigma"], mean_abs_pmi=mi["mean_abs_pmi"]),
        masses=masses,
        # published reference point (ABCDisCo Fig 2 worked example) for the p-value card
        ref=dict(dA_pct=10, NA=1000, p_true=0.0015, p_4pct=0.03, p_6pct=0.10))


def sec2_card(background_csv, signal_csv, region, cut, bins=16, prior="equal"):
    """Single-cut readout for the Section II dashboard card. Every number
    reproduced live at the configured operating cut (cx, cy):

      match      Cohen-κ agreement of ABCD-flag vs PMI-MaxEnt-flag (raw %),
                 with κ, label, chance, and the 2×2 crosstab cells.
      N_A        observed background events in region A.
      shared U   I(NN1-flag ; NN2-flag) on background — the inter-axis
                 dependence ABCD throws away (in millibits + % of min flag H).
      co-info    I(X;L)+I(Y;L)−I(X,Y;L) at this cell (>0 redundant axes,
                 <0 synergistic), bits — same definition as sweep_label.
      I(X,Y;L)   joint A/B/C/D signal separation at this cell, bits.
      I(X;L),I(Y;L)  per-axis separations at this cut, bits.
    """
    cx, cy = float(cut[0]), float(cut[1])
    xcol, ycol = H.resolve_axes(H.DEFAULTS, region)

    def xy(path):
        d, _ = H.load_csv(path, region)
        m = np.isfinite(d[xcol]) & np.isfinite(d[ycol])
        return np.clip(d[xcol][m], 0, 1), np.clip(d[ycol][m], 0, 1)

    xb, yb = xy(background_csv)
    Nb = len(xb)
    Xb = xb > cx
    Yb = yb > cy
    A = int(np.sum(Xb & Yb)); B = int(np.sum(Xb & ~Yb))
    Cc = int(np.sum(~Xb & Yb)); D = int(np.sum(~Xb & ~Yb))

    # ── agreement crosstab: ABCD-flag vs PMI-MaxEnt-flag (same as run_full) ──
    abcd_flag = Xb & Yb
    jm = pmi_jumpers(xb, yb, bins)
    _, pmi = H.detector_eval({"x": xb, "y": yb},
                             H.build_joint({"x": xb, "y": yb}, "x", "y", bins),
                             "x", "y")
    maxent_flag = jm["masks"]["jumper"] & (pmi > 0)
    agr = kappa_agreement(abcd_flag, maxent_flag)

    # ── shared U : inter-axis MI of the two binary flags on background ──
    def _bern_H(p):
        return _bent(float(p))
    pX, pY = float(Xb.mean()), float(Yb.mean())
    pXY = float((Xb & Yb).mean())
    # I(X;Y) for two Bernoullis from the 2×2 flag table (bits)
    cellsf = [(pXY, pX, pY), ((pX - pXY), pX, 1 - pY),
              ((pY - pXY), 1 - pX, pY), ((1 - pX - pY + pXY), 1 - pX, 1 - pY)]
    Uxy = 0.0
    for joint, mx, my in cellsf:
        if joint > 0 and mx > 0 and my > 0:
            Uxy += joint * np.log2(joint / (mx * my))
    Uxy = max(float(Uxy), 0.0)
    Hmin = min(_bern_H(pX), _bern_H(pY))
    U_frac = (Uxy / Hmin) if Hmin > 1e-9 else float("nan")

    # ── label-aware info at this single cell (sweep_label definitions) ──
    info = dict(coinfo=None, sep=None, ixl=None, iyl=None, n_sig=None)
    try:
        xs, ys = xy(signal_csv)
        Ns = len(xs)
        if Ns and Nb:
            ws, wb = (0.5, 0.5) if prior == "equal" else (Ns / (Ns + Nb), Nb / (Ns + Nb))
            Xs = xs > cx; Ys = ys > cy

            def quad(X, Y, N):
                a = np.mean(X & Y); b = np.mean(X & ~Y)
                c = np.mean(~X & Y); d = np.mean(~X & ~Y)
                return a, b, c, d
            sa, sb, sc, sd = quad(Xs, Ys, Ns)
            ba, bb, bc, bd = quad(Xb, Yb, Nb)

            def xl(p):  # -p log2 p
                return 0.0 if p <= 0 else -p * np.log2(p)
            Hs = xl(sa) + xl(sb) + xl(sc) + xl(sd)
            Hb = xl(ba) + xl(bb) + xl(bc) + xl(bd)
            Hm = (xl(ws * sa + wb * ba) + xl(ws * sb + wb * bb)
                  + xl(ws * sc + wb * bc) + xl(ws * sd + wb * bd))
            sep = max(Hm - ws * Hs - wb * Hb, 0.0)

            def axis_mi(ps, pb):
                Hsb = xl(ps) + xl(1 - ps)
                Hbb = xl(pb) + xl(1 - pb)
                mm = ws * ps + wb * pb
                Hmb = xl(mm) + xl(1 - mm)
                return max(Hmb - ws * Hsb - wb * Hbb, 0.0)
            ixl = axis_mi(float(Xs.mean()), float(Xb.mean()))
            iyl = axis_mi(float(Ys.mean()), float(Yb.mean()))
            info = dict(coinfo=_f(ixl + iyl - sep), sep=_f(sep),
                        ixl=_f(ixl), iyl=_f(iyl), n_sig=int(Ns))
    except Exception:
        pass

    return dict(
        region=region, cut=[_f(cx), _f(cy)], N_bg=int(Nb),
        axes=dict(x=xcol, y=ycol),
        match=dict(raw=agr["raw"], kappa=agr["kappa"], label=agr["label"],
                   chance=agr["chance"]),
        cells=dict(A=A, B=B, C=Cc, D=D),
        agreement=agr["cells"],
        shared_U=dict(bits=_f(Uxy), mbits=_f(1000.0 * Uxy), frac_pct=_f(100.0 * U_frac)),
        label_info=info)


def sweep_label(background_csv, signal_csv, grid_n=25, cfg=None, prior="equal"):
    """Label-aware sweep over the (cut_x, cut_y) grid.

    For binarized X = 1[x>cut_x], Y = 1[y>cut_y] and class label L (signal vs
    background), computes per cut:
      ixl[i]      = I(X;L)        — how well the NN1 cut alone separates signal
      iyl[j]      = I(Y;L)        — how well the NN2 cut alone separates signal
      sep[i][j]   = I(X,Y;L)      — separation of the joint A/B/C/D partition
      coinfo[i][j]= I(X;L)+I(Y;L)-I(X,Y;L)   — co-information:
                    > 0 the two cuts are REDUNDANT (second axis duplicates the first
                        against signal — the 'duplication worth avoiding')
                    < 0 the two cuts are SYNERGISTIC (complementary — the ideal)
    All in bits. Each MI with the label is a (weighted) Jensen-Shannon divergence
    between the signal and background cell distributions:
      I(Z;L) = H(w_s p_s + w_b p_b) - w_s H(p_s) - w_b H(p_b).

    prior: 'equal' -> w_s = w_b = 0.5 (default; removes the arbitrary signal-MC
                      sample size, measuring intrinsic separability/redundancy)
           'mc'    -> weight by the raw signal/background event counts.
    """
    import numpy as np
    base = {**H.DEFAULTS, **(cfg or {})}
    grid = np.linspace(0.05, 0.95, grid_n)
    out = {}
    for region in ("barrel", "endcap"):
        xcol, ycol = H.resolve_axes(base, region)
        bg, _ = H.load_csv(background_csv, region)
        sg, _ = H.load_csv(signal_csv, region)

        def xy(df):
            m = np.isfinite(df[xcol]) & np.isfinite(df[ycol])
            return np.clip(df[xcol][m], 0, 1), np.clip(df[ycol][m], 0, 1)
        xb, yb = xy(bg); xs, ys = xy(sg)
        Nb, Ns = len(xb), len(xs)
        if Nb == 0 or Ns == 0:
            continue
        ws, wb = (0.5, 0.5) if prior == "equal" else (Ns / (Ns + Nb), Nb / (Ns + Nb))

        def cells(x, y):
            Gx = (x[:, None] > grid[None, :]).astype(float)
            Gy = (y[:, None] > grid[None, :]).astype(float)
            A = Gx.T @ Gy                       # K×K  N(x>cx & y>cy)
            nx = Gx.sum(0); ny = Gy.sum(0)      # K
            return A, nx, ny
        Ab, nxb, nyb = cells(xb, yb)
        As, nxs, nys = cells(xs, ys)

        # 4-cell class-conditional probabilities, K×K
        def quad(A, nx, ny, Ntot):
            a = A / Ntot
            c = (nx[:, None] - A) / Ntot
            b = (ny[None, :] - A) / Ntot
            d = 1.0 - a - b - c
            return a, b, c, d
        sa, sb, sc, sd = quad(As, nxs, nys, Ns)
        ba, bb, bc, bd = quad(Ab, nxb, nyb, Nb)
        Hs = _xlog2(sa) + _xlog2(sb) + _xlog2(sc) + _xlog2(sd)
        Hb = _xlog2(ba) + _xlog2(bb) + _xlog2(bc) + _xlog2(bd)
        Hm = (_xlog2(ws * sa + wb * ba) + _xlog2(ws * sb + wb * bb)
              + _xlog2(ws * sc + wb * bc) + _xlog2(ws * sd + wb * bd))
        sep = np.clip(Hm - ws * Hs - wb * Hb, 0, None)   # I(X,Y;L)

        # per-axis I(X;L), I(Y;L) via Bernoulli JSD
        def axis_mi(ns, Ns_, nb, Nb_):
            ps = ns / Ns_; pb = nb / Nb_
            Hsb = _xlog2(ps) + _xlog2(1 - ps)
            Hbb = _xlog2(pb) + _xlog2(1 - pb)
            mm = ws * ps + wb * pb
            Hmb = _xlog2(mm) + _xlog2(1 - mm)
            return np.clip(Hmb - ws * Hsb - wb * Hbb, 0, None)
        ixl = axis_mi(nxs, Ns, nxb, Nb)   # K, function of cut_x
        iyl = axis_mi(nys, Ns, nyb, Nb)   # K, function of cut_y

        coinfo = ixl[:, None] + iyl[None, :] - sep   # K×K, signed

        out[region] = dict(
            grid=[round(float(g), 3) for g in grid], n_bg=Nb, n_sig=Ns, prior=prior,
            sep=[[round(float(v), 5) for v in row] for row in sep],
            coinfo=[[round(float(v), 5) for v in row] for row in coinfo],
            ixl=[round(float(v), 5) for v in ixl],
            iyl=[round(float(v), 5) for v in iyl],
        )
    return out


def _bent(p):
    import numpy as np
    return 0.0 if (p <= 0 or p >= 1) else float(-p * np.log2(p) - (1 - p) * np.log2(1 - p))


def _pca2(M, whiten=False):
    import numpy as np
    Mc = M - M.mean(0)
    _, S, Vt = np.linalg.svd(Mc, full_matrices=False)
    coords = Mc @ Vt[:2].T
    if whiten:
        sdc = coords.std(0); sdc[sdc < 1e-9] = 1.0
        coords = coords / sdc
    ev = (S ** 2) / (S ** 2).sum()
    return coords, ev, Vt


def topology_cloud(background_csv, signal_csv, grid_n=25, cfg=None):
    """ONE point per cut (cut_x, cut_y); both regions' metrics are concatenated
    into a single feature vector, so each point is a realizable shared selection
    scored jointly across barrel and endcap. Returns the cloud plus several PCA
    embeddings (standard / whitened / robust) to compare."""
    import numpy as np
    sw = sweep_overlap(background_csv, grid_n=grid_n, cfg=cfg)
    lb = sweep_label(background_csv, signal_csv, grid_n=grid_n, cfg=cfg)
    regions = [r for r in ("barrel", "endcap") if r in sw and r in lb]
    if len(regions) < 2:
        return dict(points=[], feat_names=[], embeddings={})
    grid = sw[regions[0]]["grid"]; K = len(grid)

    # per-region U(i,j) map
    Umap = {}
    for region in regions:
        D = sw[region]; N = D["N"]
        A = np.array(D["A"], float); nx = np.array(D["nx"], float); ny = np.array(D["ny"], float)
        Um = np.zeros((K, K))
        for i in range(K):
            for j in range(K):
                a = A[i][j]; c = nx[i] - a; b = ny[j] - a; d = N - a - b - c
                px1 = (a + c) / N; py1 = (a + b) / N
                mi = 0.0
                for cnt, pxk, pyk in [(a, px1, py1), (b, 1 - px1, py1), (c, px1, 1 - py1), (d, 1 - px1, 1 - py1)]:
                    if cnt > 0 and pxk > 0 and pyk > 0:
                        pr = cnt / N; mi += pr * np.log2(pr / (pxk * pyk))
                hx = _bent(px1); hy = _bent(py1)
                Um[i][j] = max(0.0, (2 * mi / (hx + hy)) if (hx + hy) > 1e-12 else 0.0)
        Umap[region] = Um

    per = ["kappa", "U", "co", "sep", "ixl", "iyl"]
    feat_names = [("b:" if r == "barrel" else "e:") + f for r in regions for f in per]
    pts = []
    for i in range(K):
        for j in range(K):
            rec = dict(cx=float(grid[i]), cy=float(grid[j]))
            vec = []
            for region in regions:
                D = sw[region]; L = lb[region]; tag = "b" if region == "barrel" else "e"
                kap = float(D["kappa"][i][j]); U = float(Umap[region][i][j])
                co = float(L["coinfo"][i][j]); sep = float(L["sep"][i][j])
                ixl = float(L["ixl"][i]); iyl = float(L["iyl"][j]); NA = int(D["A"][i][j])
                rec["sep_" + tag] = sep; rec["U_" + tag] = U; rec["co_" + tag] = co
                rec["kap_" + tag] = kap; rec["NA_" + tag] = NA
                vec += [kap, U, co, sep, ixl, iyl]
            rec["_vec"] = vec
            pts.append(rec)

    X = np.array([p["_vec"] for p in pts], float)
    mu = X.mean(0); sd = X.std(0); sd[sd < 1e-9] = 1.0
    Z = (X - mu) / sd
    med = np.median(X, 0); mad = np.median(np.abs(X - med), 0) * 1.4826; mad[mad < 1e-9] = 1.0
    Zr = (X - med) / mad

    embeddings = {}
    for name, M, wh in (("standard", Z, False), ("whitened", Z, True), ("robust", Zr, False)):
        coords, ev, Vt = _pca2(M, whiten=wh)
        embeddings[name] = dict(coords=[[float(a), float(b)] for a, b in coords],
                                ev=[float(e) for e in ev[:4]],
                                load=[[float(v) for v in Vt[0]], [float(v) for v in Vt[1]]])

    idx = {f: k for k, f in enumerate(feat_names)}
    def col(f): return Z[:, idx[f]]
    good = col("b:sep") + col("e:sep") - col("b:U") - col("e:U") - col("b:co") - col("e:co")
    good = (good - good.min()) / (good.max() - good.min() + 1e-9)
    for k, p in enumerate(pts):
        p["good"] = float(good[k]); del p["_vec"]
    return dict(points=pts, feat_names=feat_names, embeddings=embeddings)

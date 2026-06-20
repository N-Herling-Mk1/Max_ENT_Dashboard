#!/usr/bin/env python3
# ════════════════════════════════════════════════════════════════════
#  HELIX · Section II — figure data layer.
#
#  Pure-numeric reconstructions of the diagnostic graphs from
#    • Kasieczka, Nachman, Schwartz & Shih, PRD 103, 035021 (2021)
#      [ABCDisCo]  — Fig 1 (schematic), Fig 2 (p-value vs contamination),
#                    Figs 5/7/8/12 (background-rejection vs r scatter)
#    • ATLAS, PRD 112, 092001 (2025) [one-DV MS search]
#      — Figs 8-11 (ABCD planes), Fig 10b (run-2 endcap data plane),
#        Tables VI/VIII (cell counts).
#
#  Every number is computed live from the HELIX data24 VR background +
#  HSS signal samples at the configured cut. No matplotlib here — this
#  returns JSON-ready arrays; the front-end draws SVG/canvas so the
#  figures stay interactive (sliders) and match the dashboard aesthetic.
#  Physics-plot convention: viridis / white background (NOT TRON).
# ════════════════════════════════════════════════════════════════════
import numpy as np
from . import helix_mi as H


# ── shared loaders ──────────────────────────────────────────────────
def _axes(region):
    return H.resolve_axes(H.DEFAULTS, region)


def _load_xy(path, region):
    xcol, ycol = _axes(region)
    d, _ = H.load_csv(path, region)
    m = np.isfinite(d[xcol]) & np.isfinite(d[ycol])
    return np.clip(d[xcol][m], 0.0, 1.0), np.clip(d[ycol][m], 0.0, 1.0)


def _cells(x, y, cx, cy):
    """HELIX convention: A=hi/hi, B=hi/lo, C=lo/hi, D=lo/lo."""
    hx, hy = x > cx, y > cy
    return (int(np.sum(hx & hy)), int(np.sum(hx & ~hy)),
            int(np.sum(~hx & hy)), int(np.sum(~hx & ~hy)))


def _f(v):
    try:
        v = float(v)
        return None if not np.isfinite(v) else v
    except Exception:
        return None


# ════════════════════════════════════════════════════════════════════
#  (1) DATA PLANE  — run-2 paper Fig 10b analogue.
#  2D histogram of the background NN1×NN2 plane with the cut overlaid.
#  Don't KDE: point masses at 0/1 + boundary at the cut corner + 3-4
#  orders dynamic range. Plain 2D histogram, matching PRD 112 Fig 10.
# ════════════════════════════════════════════════════════════════════
def plane_histogram(background_csv, region, cut, bins=20, sample=None):
    cx, cy = float(cut[0]), float(cut[1])
    xb, yb = _load_xy(background_csv, region)
    if sample:  # optional overlay of a signal sample's scatter
        xs, ys = _load_xy(sample, region)
    edges = np.linspace(0.0, 1.0, bins + 1)
    Hc, _, _ = np.histogram2d(xb, yb, bins=[edges, edges])
    # Hc[i,j] : i over NN1 (x), j over NN2 (y). transpose for row=y display.
    A, B, C, D = _cells(xb, yb, cx, cy)
    out = dict(
        region=region, cut=[cx, cy], bins=bins,
        edges=[round(e, 4) for e in edges.tolist()],
        counts=Hc.T.astype(int).tolist(),          # rows = NN2, cols = NN1
        max_count=int(Hc.max()),
        cells=dict(A=A, B=B, C=C, D=D),
        axes=dict(x=_axes(region)[0], y=_axes(region)[1]),
        N_bg=int(len(xb)),
        point_mass=dict(  # the pathologies that forbid KDE
            nn1_eq0=_f(np.mean(xb == 0.0)), nn1_eq1=_f(np.mean(xb == 1.0)),
            nn2_eq0=_f(np.mean(yb == 0.0)), nn2_eq1=_f(np.mean(yb == 1.0))),
    )
    if sample:
        out["signal_pts"] = [[round(float(a), 4), round(float(b), 4)]
                             for a, b in zip(xs[:1500], ys[:1500])]
    return out


# ════════════════════════════════════════════════════════════════════
#  (1b) SIGNAL-MC PLANE — run-2 paper Fig 8b analogue.
#  Signal MC's OWN NN1×NN2 density, normalised units (Simulation), drawn
#  separately from the background-data plane (different normalisation —
#  the paper never sums them). Same cut overlaid so A/B/C/D line up.
# ════════════════════════════════════════════════════════════════════
def signal_plane(signal_csv, region, cut, bins=20):
    cx, cy = float(cut[0]), float(cut[1])
    xs, ys = _load_xy(signal_csv, region)
    edges = np.linspace(0.0, 1.0, bins + 1)
    Hc, _, _ = np.histogram2d(xs, ys, bins=[edges, edges])
    tot = max(Hc.sum(), 1.0)
    A, B, C, D = _cells(xs, ys, cx, cy)
    N = len(xs)
    return dict(
        region=region, cut=[cx, cy], bins=bins, kind="signal",
        signal=signal_csv.split("/")[-1].replace(".csv", ""),
        edges=[round(e, 4) for e in edges.tolist()],
        counts=Hc.T.astype(int).tolist(),       # rows = NN2, cols = NN1
        norm=(Hc.T / tot).tolist(),              # normalised units
        max_count=int(Hc.max()),
        max_norm=_f(float(Hc.max() / tot)),
        cells=dict(A=A, B=B, C=C, D=D),
        frac=dict(A=_f(A / N), B=_f(B / N), C=_f(C / N), D=_f(D / N)) if N else None,
        axes=dict(x=_axes(region)[0], y=_axes(region)[1]),
        N_sig=int(N),
    )


# ════════════════════════════════════════════════════════════════════
#  (2) p-VALUE vs CONTAMINATION  — ABCDisCo Fig 2.
#
#  Faithful to Eq 2.10: with closure exact but signal leaking into the
#  control regions, the predicted background is inflated,
#     N_A,pred = N_A,b (1 + δ_B + δ_C − δ_D) = N_A,b (1 + r·δ_A),
#  while the observed is N_A,a = N_A,b (1 + δ_A). The apparent excess is
#     S_app = N_A,b (δ_A − r·δ_A) = N_A,b·δ_A·(1 − r).
#  Gaussian-significance model (paper assumes no C/D uncertainty):
#     Z = S_app / sqrt(N_A,pred + σ_syst²),  p = 1 − Φ(Z)  [one-sided].
#  The δ_C, δ_D terms are doubly suppressed (diagonally opposite), so the
#  contamination knob is δ_B and r ≈ δ_B/δ_A here.
#
#  Anchored to the paper's three worked points (Fig 2): at δ_A=10%,
#  N_A=1000 → p_true≈0.0015, p(δ_B=4%)≈0.03, p(δ_B=6%)≈0.10.
# ════════════════════════════════════════════════════════════════════
def _phi(z):  # standard-normal CDF via erf
    return 0.5 * (1.0 + _erf(z / np.sqrt(2.0)))


def _erf(x):
    x = np.asarray(x, float)
    t = 1.0 / (1.0 + 0.3275911 * np.abs(x))
    y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
                - 0.284496736) * t + 0.254829592) * t * np.exp(-x * x)
    return np.sign(x) * y


def _Z_asimov(n, m, syst_frac=0.0, NA_ref=None):
    """Asimov discovery significance (Cowan et al. 2011). syst_frac>0 uses the
    background-uncertainty form (Eq 20) with an ABSOLUTE σ = syst_frac·N_A
    applied to the events in region A, matching ABCDisCo Fig 2's convention."""
    if n <= m:
        return 0.0
    if syst_frac <= 0.0:
        return float(np.sqrt(max(2.0 * (n * np.log(n / m) - (n - m)), 0.0)))
    s2 = (syst_frac * (NA_ref if NA_ref is not None else n)) ** 2
    if s2 <= 0:
        return float(np.sqrt(max(2.0 * (n * np.log(n / m) - (n - m)), 0.0)))
    term = (n * np.log(n * (m + s2) / (m * m + n * s2))
            - (m * m / s2) * np.log(1.0 + s2 * (n - m) / (m * (m + s2))))
    return float(np.sqrt(max(2.0 * term, 0.0)))


def _p_from(NA, dA, r, syst_frac=0.0):
    """p-value (CL_{s+b}) for the ABCD method. n = events in region A,
    m = ABCD-predicted background = N_A,b(1+r·δ_A)  (Eq 2.10 with N_{B,C,D}=∞)."""
    n = float(NA)
    m = NA * (1.0 + r * dA) / (1.0 + dA)
    Z = _Z_asimov(n, m, syst_frac, NA_ref=NA)
    return float(np.clip(1.0 - _phi(Z), 1e-5, 1.0))


# ── faithful ABCDisCo Fig 2 (two panels) ────────────────────────────
# Left  : p vs δ_A (log), family = N_A∈{100,1000,10000} × r∈{0,0.4,0.6},
#         σ_syst=0, N_{B,C,D}=∞.   Right : p vs N_A (log), family =
#         r∈{0,0.4,0.6} × σ_syst∈{0,1%,3%}, δ_A=10%, N_{B,C,D}=∞.
_NA_COL = {100: "#d23b3b", 1000: "#3a6fd6", 10000: "#2a9d4a"}   # red/blue/green
_R_COL = {0.0: "#d23b3b", 0.4: "#3a6fd6", 0.6: "#2a9d4a"}
_R_DASH = {0.0: [], 0.4: [2, 3], 0.6: [7, 4]}                    # solid/dotted/dashed
_SYST_DASH = {0.0: [], 0.01: [7, 4], 0.03: [2, 3]}


def pvalue_fig2(dA_right=0.10, n=140):
    # LEFT: x = δ_A (log 1e-3 .. 3)
    dA = np.logspace(-3, np.log10(3.0), n)
    left_curves = []
    for NA in (100, 1000, 10000):
        for r in (0.0, 0.4, 0.6):
            p = [_p_from(NA, float(d), r, 0.0) for d in dA]
            left_curves.append(dict(
                NA=NA, r=r, color=_NA_COL[NA], dash=_R_DASH[r],
                label=f"N_A={NA}, r={r:g}", p=[float(v) for v in p]))
    # RIGHT: x = N_A (log 1e2 .. 1e4), δ_A fixed
    NAg = np.logspace(2, 4, n)
    right_curves = []
    for r in (0.0, 0.4, 0.6):
        for syst in (0.0, 0.01, 0.03):
            p = [_p_from(float(na), dA_right, r, syst) for na in NAg]
            right_curves.append(dict(
                r=r, syst=syst, color=_R_COL[r], dash=_SYST_DASH[syst],
                label=f"r={r:g}, σ_syst={int(syst*100)}%", p=[float(v) for v in p]))
    # σ reference lines (p = 1−Φ(Z)) within the 1e-5..1 window
    sig = [dict(z=z, p=float(np.clip(1.0 - _phi(z), 1e-5, 1.0))) for z in (3, 4, 5)]
    return dict(
        left=dict(dA=[float(v) for v in dA], curves=left_curves,
                  na_colors=_NA_COL, r_dash={str(k): v for k, v in _R_DASH.items()}),
        right=dict(NA=[float(v) for v in NAg], dA_fixed=dA_right, curves=right_curves,
                   r_colors={str(k): v for k, v in _R_COL.items()},
                   syst_dash={str(k): v for k, v in _SYST_DASH.items()}),
        sigma_lines=sig,
        anchors=[  # worked example in the text beside Fig 2 (δ_A=10%, N_A=1000)
            dict(panel="left", dA=0.10, p=_p_from(1000, 0.10, 0.0), label="true"),
            dict(panel="left", dA=0.10, p=_p_from(1000, 0.10, 0.4), label="r=0.4"),
            dict(panel="left", dA=0.10, p=_p_from(1000, 0.10, 0.6), label="r=0.6")],
    )


def pvalue_curve(NA=1000, dA=0.10, sigma_syst_pct=0.0, dB_max=0.10, n=80):
    """p-value vs δ_B (control-region contamination) at fixed δ_A, N_A.
    Returns the curve + the published anchor points for overlay."""
    NAb = NA / (1.0 + dA)               # background level in A
    S0 = NAb * dA                       # true signal in A
    dB = np.linspace(0.0, dB_max, n)
    r = dB / dA                         # δ_C,δ_D ≈ 0  → r ≈ δ_B/δ_A
    S_app = S0 * (1.0 - r)              # apparent excess after inflation
    NA_pred = NAb * (1.0 + r * dA)
    sig = sigma_syst_pct / 100.0 * NA_pred
    denom = np.sqrt(NA_pred + sig * sig)
    Z = np.clip(S_app / np.where(denom > 0, denom, np.nan), -10, 10)
    p = np.clip(1.0 - _phi(Z), 1e-6, 1.0)
    return dict(
        NA=NA, dA=dA, sigma_syst_pct=sigma_syst_pct,
        dB=[round(float(v), 4) for v in dB],
        r=[round(float(v), 4) for v in r],
        p=[float(v) for v in p],
        Z=[round(float(v), 3) for v in Z],
        anchors=[  # ABCDisCo Fig 2 worked example (δ_A=10%, N_A=1000)
            dict(dB=0.00, p=0.0015, label="true"),
            dict(dB=0.04, p=0.03,  label="δ_B=4%"),
            dict(dB=0.06, p=0.10,  label="δ_B=6%")],
    )


# ════════════════════════════════════════════════════════════════════
#  (3) BACKGROUND-REJECTION vs NORMALIZED CONTAMINATION  (r)
#      — ABCDisCo Figs 5 / 7 / 8 / 12, the money plot.
#
#  Sweep a grid of rectangular cuts (cx, cy). For each, on the REAL plane:
#    ε_s = signal frac in A,  ε_b = bg frac in A,  rejection = 1/ε_b,
#    r   = δ_A^{-1}(δ_B + δ_C − δ_D)   (Eq 2.8, per signal mass),
#    closure = |N_A,b − N_B N_C/N_D| / N_A,b.
#  Keep points whose signal efficiency is near a target band and whose
#  background ABCD closure is within tol — exactly the ABCDisCo filter.
#  The HELIX operating cut is marked separately.
# ════════════════════════════════════════════════════════════════════
def rejection_vs_r(background_csv, signal_csv, region, cut,
                   grid_n=22, eff_lo=0.20, eff_hi=0.45,
                   closure_tol=0.20, bins=16):
    xb, yb = _load_xy(background_csv, region)
    xs, ys = _load_xy(signal_csv, region)
    Nb, Ns = len(xb), len(xs)
    grid = np.linspace(0.02, 0.98, grid_n)

    pts = []
    for cx in grid:
        for cy in grid:
            Ab, Bb, Cb, Db = _cells(xb, yb, cx, cy)
            As, Bs, Cs, Ds = _cells(xs, ys, cx, cy)
            if Ab == 0 or Bb == 0 or Cb == 0 or Db == 0:
                continue
            eps_s = As / Ns
            eps_b = Ab / Nb
            if eps_s < eff_lo or eps_s > eff_hi or eps_b <= 0:
                continue
            pred = Bb * Cb / Db
            closure = abs(Ab - pred) / Ab
            if closure > closure_tol:
                continue
            dA = (As / Ab) if Ab else np.nan
            dB = (Bs / Bb) if Bb else np.nan
            dC = (Cs / Cb) if Cb else np.nan
            dD = (Ds / Db) if Db else np.nan
            if not np.isfinite(dA) or dA == 0:
                continue
            r = (dB + dC - dD) / dA
            pts.append(dict(
                cx=round(float(cx), 3), cy=round(float(cy), 3),
                rej=_f(1.0 / eps_b), r=_f(r),
                eps_s=_f(eps_s), closure=_f(closure)))

    # HELIX operating point (the configured cut), reported even if it
    # falls outside the efficiency band so the user always sees it.
    cx, cy = float(cut[0]), float(cut[1])
    Ab, Bb, Cb, Db = _cells(xb, yb, cx, cy)
    As, Bs, Cs, Ds = _cells(xs, ys, cx, cy)
    op = None
    if Ab and Bb and Cb and Db:
        dA = As / Ab if Ab else np.nan
        dB = Bs / Bb if Bb else np.nan
        dC = Cs / Cb if Cb else np.nan
        dD = Ds / Db if Db else np.nan
        r = (dB + dC - dD) / dA if (dA and np.isfinite(dA)) else np.nan
        pred = Bb * Cb / Db
        op = dict(cx=cx, cy=cy, rej=_f(Nb / Ab), r=_f(r),
                  eps_s=_f(As / Ns), closure=_f(abs(Ab - pred) / Ab))

    return dict(region=region, signal=signal_csv.split("/")[-1],
                N_bg=Nb, N_sig=Ns, eff_band=[eff_lo, eff_hi],
                closure_tol=closure_tol, points=pts, operating=op)


# ════════════════════════════════════════════════════════════════════
#  (4) SIGNAL-INJECTION CURVE — the Prof-Johns "inject signal in A" test.
#  N_A,obs and N_A,pred as functions of injected signal N_S, with the
#  region-occupancy f-vector from a real signal MC sample (test plane).
#  r is the leading-order slope of N_A,pred; r>1 ⇒ prediction outruns
#  observation ⇒ total absorption (no separation).
# ════════════════════════════════════════════════════════════════════
def injection_curve(background_csv, signal_csv, region, cut, NS_max=None, n=40):
    cx, cy = float(cut[0]), float(cut[1])
    xb, yb = _load_xy(background_csv, region)
    xs, ys = _load_xy(signal_csv, region)
    A, B, C, D = _cells(xb, yb, cx, cy)
    sA, sB, sC, sD = _cells(xs, ys, cx, cy)
    nS = sA + sB + sC + sD
    if nS == 0:
        return dict(error="signal sample empty in plane")
    fA, fB, fC, fD = sA / nS, sB / nS, sC / nS, sD / nS
    if NS_max is None:
        NS_max = max(40, int(3 * A / max(fA, 1e-6)))
        NS_max = min(NS_max, 4000)
    NS = np.linspace(0, NS_max, n)
    obs = A + NS * fA
    Bn, Cn, Dn = B + NS * fB, C + NS * fC, D + NS * fD
    pred = Bn * Cn / np.where(Dn > 0, Dn, np.nan)
    excess = obs - pred
    # leading-order r at this cut/sample
    dA = fA * nS / A if A else np.nan
    r = ((sB / B if B else 0) + (sC / C if C else 0) - (sD / D if D else 0)) / \
        (sA / A) if (A and sA) else np.nan
    return dict(
        region=region, cut=[cx, cy], signal=signal_csv.split("/")[-1],
        f=dict(A=_f(fA), B=_f(fB), C=_f(fC), D=_f(fD)),
        bg=dict(A=A, B=B, C=C, D=D),
        NS=[float(v) for v in NS],
        obs=[float(v) for v in obs],
        pred=[_f(v) for v in pred],
        excess=[_f(v) for v in excess],
        r=_f(r), absorbs=bool(np.isfinite(r) and r >= 1.0))


# ── self-test ───────────────────────────────────────────────────────
if __name__ == "__main__":
    import os, json
    bg = "data/merged/background.csv"
    s35 = "data/merged/signal_mS35.csv"
    print("plane:", {k: v for k, v in plane_histogram(bg, "endcap", (0.8, 0.8), 20).items()
                      if k in ("cells", "max_count", "N_bg", "point_mass")})
    pv = pvalue_curve()
    print("pvalue p[0]=%.4f p[-1]=%.4f anchors=%s" %
          (pv["p"][0], pv["p"][-1], [a["p"] for a in pv["anchors"]]))
    rr = rejection_vs_r(bg, s35, "endcap", (0.8, 0.8))
    print("rej_vs_r: %d cut-points, operating r=%.3f rej=%.1f" %
          (len(rr["points"]), rr["operating"]["r"], rr["operating"]["rej"]))
    ic = injection_curve(bg, s35, "endcap", (0.8, 0.8))
    print("injection: r=%.3f absorbs=%s f_A=%.3f NS_max=%.0f" %
          (ic["r"], ic["absorbs"], ic["f"]["A"], ic["NS"][-1]))

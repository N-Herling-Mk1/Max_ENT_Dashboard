#!/usr/bin/env python3
# ════════════════════════════════════════════════════════════════════
#  HELIX · maxent_solver — TRUE numerical maximum-entropy joint.
#
#  Unlike the Gaussian-copula predictor (which uses the closed-form
#  max-ent solution for fixed marginals + a *rank* correlation), this
#  module SOLVES the max-ent problem numerically and fixes the RAW
#  Pearson cross-moment E[xy] directly.
#
#  Max-ent joint with fixed marginals p(x), p(y) and fixed E[xy]:
#       p_ij ∝ a_i · b_j · exp(θ · x_i · y_j)
#  a_i, b_j enforce the marginals (iterative proportional fitting);
#  θ is the single Lagrange multiplier tuned so E_p[xy] = target.
#  θ = 0  ⇒  p_ij = p(x_i)p(y_j)  ⇒  the ABCD (independence) prediction.
#
#  Pure numpy. No optimizer library. Self-test: `python -m core.maxent_solver`.
# ════════════════════════════════════════════════════════════════════
import numpy as np


def _ipf(M, px, py, iters=400, tol=1e-12):
    """Scale rows/cols of M (Sinkhorn / iterative proportional fitting)
    so the resulting joint has row marginal px and column marginal py."""
    a = np.ones(M.shape[0]); b = np.ones(M.shape[1])
    for _ in range(iters):
        rs = (M * b[None, :]).sum(1); rs[rs < 1e-300] = 1e-300
        a = px / rs
        cs = (a[:, None] * M).sum(0); cs[cs < 1e-300] = 1e-300
        b = py / cs
        P = a[:, None] * M * b[None, :]
        if (np.max(np.abs(P.sum(1) - px)) < tol and
                np.max(np.abs(P.sum(0) - py)) < tol):
            break
    return a[:, None] * M * b[None, :]


def fit_joint(px, py, xc, yc, target_Exy):
    """Return (P, theta): the max-ent joint with marginals px,py whose
    cross-moment E[xy] matches target_Exy, found by bisection on θ."""
    XY = np.outer(xc, yc)

    def joint(theta):
        E = theta * XY
        M = np.exp(E - E.max())          # global shift: IPF is scale-invariant
        return _ipf(M, px, py)

    def Exy(P):
        return float((P * XY).sum())

    lo, hi = -60.0, 60.0
    Plo, Phi = joint(lo), joint(hi)
    flo, fhi = Exy(Plo) - target_Exy, Exy(Phi) - target_Exy
    if flo > 0:            # target below achievable min  → clamp
        return Plo, lo
    if fhi < 0:            # target above achievable max  → clamp
        return Phi, hi
    P = None; mid = 0.0
    for _ in range(80):
        mid = 0.5 * (lo + hi); P = joint(mid); fm = Exy(P) - target_Exy
        if abs(fm) < 1e-10 * max(abs(target_Exy), 1.0):
            break
        if fm > 0:
            hi = mid
        else:
            lo = mid
    return P, mid


def predict_na(x, y, cut_x, cut_y, bins=24, n_boot=30, seed=0):
    """Numerical max-ent N_A prediction. ρ (raw Pearson) is measured in the
    CONTROL regions (non-circular) and imposed on the full-plane max-ent joint."""
    x = np.asarray(x, float); y = np.asarray(y, float)
    N = len(x)
    pij, ex, ey = np.histogram2d(x, y, bins=bins)
    xc = 0.5 * (ex[:-1] + ex[1:]); yc = 0.5 * (ey[:-1] + ey[1:])
    s = pij.sum()
    px = pij.sum(1) / s; py = pij.sum(0) / s
    # model-consistent marginal moments (from the binned marginals)
    mux = float((xc * px).sum()); muy = float((yc * py).sum())
    sx = float(np.sqrt(max((xc * xc * px).sum() - mux * mux, 1e-12)))
    sy = float(np.sqrt(max((yc * yc * py).sum() - muy * muy, 1e-12)))
    Amask = (xc[:, None] > cut_x) & (yc[None, :] > cut_y)

    def rho_ctrl(xx, yy):
        c = ~((xx > cut_x) & (yy > cut_y))
        if c.sum() < 8:
            return 0.0
        r = np.corrcoef(xx[c], yy[c])[0, 1]
        return float(np.clip(r if np.isfinite(r) else 0.0, -0.95, 0.95))

    rho = rho_ctrl(x, y)
    target = rho * sx * sy + mux * muy
    P, theta = fit_joint(px, py, xc, yc, target)
    na = N * float(P[Amask].sum())
    na_indep = N * float(np.outer(px, py)[Amask].sum())

    boot = np.empty(n_boot)
    rng = np.random.default_rng(seed)
    for k in range(n_boot):
        idx = rng.integers(0, N, N); xb, yb = x[idx], y[idx]
        pb, _, _ = np.histogram2d(xb, yb, bins=[ex, ey])
        sb = pb.sum(); pxb = pb.sum(1) / sb; pyb = pb.sum(0) / sb
        muxb = (xc * pxb).sum(); muyb = (yc * pyb).sum()
        sxb = np.sqrt(max((xc * xc * pxb).sum() - muxb ** 2, 1e-12))
        syb = np.sqrt(max((yc * yc * pyb).sum() - muyb ** 2, 1e-12))
        tb = rho_ctrl(xb, yb) * sxb * syb + muxb * muyb
        Pb, _ = fit_joint(pxb, pyb, xc, yc, tb)
        boot[k] = len(xb) * float(Pb[Amask].sum())
    lo, hi = np.percentile(boot, [16, 84])

    return dict(rho_pearson=round(rho, 4), theta=round(float(theta), 4),
                na_maxent_num=round(na, 4), na_maxent_num_err=round(0.5 * (hi - lo), 4),
                na_indep_num=round(na_indep, 4),
                na_observed=int(((x > cut_x) & (y > cut_y)).sum()), bins=bins)


if __name__ == "__main__":
    # self-test: independent data → θ≈0, na≈independence
    rng = np.random.default_rng(0)
    x = rng.random(8000); y = rng.random(8000)
    print("independent:", predict_na(x, y, 0.7, 0.7, n_boot=10))
    # correlated data → θ≠0, na > independence
    z = rng.standard_normal(8000)
    xc = 0.5 * (1 + np.tanh(z)); yc = 0.5 * (1 + np.tanh(0.8 * z + 0.4 * rng.standard_normal(8000)))
    print("correlated :", predict_na(xc, yc, 0.6, 0.6, n_boot=10))

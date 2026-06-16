#!/usr/bin/env python3
# Generates stand-in signal/background CSVs so the dashboard runs out of the
# box. SCHEMA MATCHES what the engine expects — replace these two files with
# real ng02 exports (same columns) and nothing else changes.
#
#   columns: region, scoreNN1b, scoreNN2b, nMDT, nRPC, nTGC, nBOL,
#            clusE, rms_clustime, mindR, isolation, MET_dphi
import csv, numpy as np

rng = np.random.default_rng(1729)
COLS = ["region", "scoreNN1b", "scoreNN2b", "nMDT", "nRPC", "nTGC", "nBOL",
        "clusE", "rms_clustime", "mindR", "isolation", "MET_dphi"]


def block(region, n, kind):
    # NN plane: signal corners (dependent); background independent
    if kind == "signal":
        base = rng.beta(5, 2, n)               # pushed high
        nn1 = np.clip(base + rng.normal(0, 0.08, n), 0, 1)
        nn2 = np.clip(base + rng.normal(0, 0.10, n), 0, 1)   # correlated
        hit_scale = 2.2                         # anomalous hit counts
    else:
        nn1 = np.clip(rng.beta(2, 3, n) + rng.normal(0, 0.05, n), 0, 1)
        nn2 = np.clip(rng.beta(2, 3, n) + rng.normal(0, 0.05, n), 0, 1)  # independent
        hit_scale = 1.0
    bump = 1.5 if region == "barrel" else 1.0   # barrel = heavier hit counts
    rows = []
    for i in range(n):
        rows.append([
            region, round(float(nn1[i]), 4), round(float(nn2[i]), 4),
            int(rng.poisson(18 * bump * hit_scale)),    # nMDT
            int(rng.poisson(9 * bump * hit_scale)),     # nRPC
            int(rng.poisson(6 * bump)),                 # nTGC
            int(rng.poisson(4 * bump)),                 # nBOL
            round(float(rng.gamma(3, 2)), 3),           # clusE
            round(float(abs(rng.normal(1.5, 0.6))), 3), # rms_clustime
            round(float(abs(rng.normal(0.3, 0.1))), 3), # mindR
            round(float(abs(rng.normal(0.2, 0.08))), 3),# isolation
            round(float(rng.uniform(-np.pi, np.pi)), 3),# MET_dphi
        ])
    return rows


def write(path, kind):
    rows = (block("barrel", 800, kind) + block("endcap", 1200, kind))
    with open(path, "w", newline="") as f:
        w = csv.writer(f); w.writerow(COLS); w.writerows(rows)
    print(f"wrote {path}: {len(rows)} rows ({kind})")


write("data/sample_signal.csv", "signal")
write("data/sample_background.csv", "background")

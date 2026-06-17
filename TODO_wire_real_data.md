# TODO — wire real data into the dashboard

Everything (category test, ABCD, MaxEnt, agreement, jumpers) is **built and
tested**. It is currently running on throwaway synthetic stand-in CSVs, so all
numbers are plumbing-correct but physics-meaningless (both regions read Case A).
The remaining work is swapping in the real inputs.

## Data roles (locked)

| Dashboard slot | Source | What it is | Used for |
| --- | --- | --- | --- |
| **background** | `data24VR_*` lanes | **real data**, validation region, signal-depleted | MaxEnt fit + ABCD closure + the **category test** (Case A/B is a verdict on the *background*) |
| **signal** | `mc_mS35_all_*` lanes | **MC** (simulated) — the *real signal hypothesis* | overlay for the agreement matrix |

Note: "synthetic" has two meanings here. The MC signal is simulated but it is a
**real analysis input**. The only *fake* data is the two placeholder files in
`data/` (`sample_signal.csv`, `sample_background.csv`) — those are what get
replaced. Both real lane sets are already local in `data/raw/`:

```
data/raw/data24VR_nn1_barrel.csv      data/raw/mc_mS35_all_nn1_barrel.csv
data/raw/data24VR_nn1_endcap.csv      data/raw/mc_mS35_all_nn1_endcap.csv
data/raw/data24VR_nn2_barrel.csv      data/raw/mc_mS35_all_nn2_barrel.csv
data/raw/data24VR_nn2_endcap.csv      data/raw/mc_mS35_all_nn2_endcap.csv
```

## The remaining step

### 0. BLOCKER — confirm where the scores live
The lane files are raw-feature subsets. The dashboard needs the `(NN1, NN2)`
score plane (`scoreNN1b`, `scoreNN2b`). Check one header:

```powershell
Get-Content data/raw/data24VR_nn1_barrel.csv -TotalCount 1
```

- If `scoreNN1b` / `scoreNN2b` are **in** the lane header → the builder just
  merges and tags; no ROOT needed.
- If they are **not** there → pull them from `events.root` (tree `analysis`)
  via uproot and join on `eventNumber`.

### 1. Build the two dashboard CSVs
Per region, merge `nn1` + `nn2` lanes on `eventNumber` (union of feature
columns), attach `scoreNN1b` / `scoreNN2b`, tag a `region` column, then stack
barrel + endcap into one file per role:

```
data/raw/data24VR_nn1_{barrel,endcap} + nn2_{...}  ->  data/data24VR.csv   (background)
data/raw/mc_mS35_all_nn1_{...}        + nn2_{...}  ->  data/mS35.csv        (signal)
```

Point `DATA` in `app.py` at them (or rename to
`sample_background.csv` / `sample_signal.csv`).

### 2. Remap DEFAULTS to real branch names
In `core/helix_mi.py`, `DEFAULTS`:
- `xcol` / `ycol`  -> the real score branches (`scoreNN1b` / `scoreNN2b`).
- `count_features` -> the integer hit-count branches: `msvtx_nRPC_s…`,
  `muSeg_nBOL`, `msegUnAssoc_n*`, etc. **These drive the Poisson / tail signals
  that flip a region to Case B.**
- `cont_features`  -> the continuous `*_raw` branches: `MS1Vtx_clusE_raw`,
  `MS1Vtx_rms_clusE_raw`, `MS1Vtx_mindR_jetcut_raw`, `met_met_NOSYS`, …
- Keep `cuts = {barrel: (0.5, 0.5), endcap: (0.8, 0.8)}`.

### 3. Run + sanity-check
- Category test: **barrel (VR) should now classify Case B** (Poisson tail,
  broken closure); endcap stays Case A. That asymmetry is the result.
- Agreement: flip "agreement on" to **signal** and check whether MaxEnt-only
  recovers signal events sitting outside ABCD's region A.

## Optional — prove the A→B flip *before* real data
A ~20-line generator can write a Case-B-shaped synthetic background (Poisson
counts + injected NN1–NN2 dependence so closure breaks). Drop in `data/`, run
the category test, watch barrel come back Case B. Isolates "is the code right?"
from "is the physics right?" — debug them separately.

## One-line summary
No new method or code path is needed for Case B — it is a verdict the classifier
returns when the data has the structure. The single remaining task is feeding it
the real VR(background) + mS35(signal), starting with the header check in step 0.

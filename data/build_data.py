#!/usr/bin/env python3
"""build_data.py — join nn1+nn2 lanes per region into merged tables.

Reads the raw lane CSVs (data/raw/<role>/.../raw_nn{1,2}_{barrel,endcap}.csv),
joins nn1+nn2 on eventNumber per region (both carry the scores; shared columns
deduped), tags region, and writes merged per-sample tables to data/merged/.

Output:
  data/merged/background.csv                 (barrel+endcap stacked, region col)
  data/merged/signal_mS5.csv  ... mS55.csv
Each row = one event with BOTH scores for its region + all features.
"""
import os, glob
import pandas as pd

RAW = os.path.join(os.path.dirname(__file__), "raw")
OUT = os.path.join(os.path.dirname(__file__), "merged")

def merge_region(folder, region):
    a = pd.read_csv(os.path.join(folder, f"raw_nn1_{region}.csv"))
    b = pd.read_csv(os.path.join(folder, f"raw_nn2_{region}.csv"))
    shared = [c for c in b.columns if c in a.columns and c != "eventNumber"]
    m = a.merge(b.drop(columns=shared), on="eventNumber", how="inner")
    m["region"] = region
    return m

def build_sample(folder, out_name):
    frames = [merge_region(folder, r) for r in ("barrel", "endcap")]
    df = pd.concat(frames, ignore_index=True)
    os.makedirs(OUT, exist_ok=True)
    df.to_csv(os.path.join(OUT, out_name), index=False)
    nb = (df.region == "barrel").sum(); ne = (df.region == "endcap").sum()
    print(f"  {out_name:22s} {len(df):6d} rows  (barrel {nb}, endcap {ne})  {df.shape[1]} cols")
    return df

def main():
    print("[build_data] background:")
    build_sample(os.path.join(RAW, "background"), "background.csv")
    print("[build_data] signal:")
    for m in sorted(glob.glob(os.path.join(RAW, "signal", "mS*"))):
        name = os.path.basename(m)
        build_sample(m, f"signal_{name}.csv")
    print("[build_data] done -> data/merged/")

if __name__ == "__main__":
    main()

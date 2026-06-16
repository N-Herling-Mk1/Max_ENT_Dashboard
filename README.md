# HELIX · MaxEnt vs ABCD dashboard

Local Flask dashboard for the MaxEnt-vs-ABCD diagnostic on the MSVtx LLP search.
Numpy + matplotlib engine (no scipy/sklearn) — runs on ng02. Chrome is TRON Ares;
scientific plots stay white + viridis.

## Run
```bash
pip install -r requirements.txt
python app.py            # smart-selects a free port from 5000 and opens the browser
```
Prints the URL and opens the browser; the port walks up from 5000 if busy. Ctrl-C to stop.
Runs against the bundled synthetic CSVs out of the box — hit **▶ GENERATE / RUN TEST**.

### On atlng02
Load the scientific Python env first so numpy/matplotlib resolve:
```bash
setupATLAS && lsetup "scikit 26.05.13-snapshot-x86_64-el9"
python app.py
```
Flask may not be in that env — if `import flask` fails: `pip install --user flask`
(or just run the dashboard on your laptop; it only needs the CSVs, not the cluster).

### Headless / over SSH (no browser on the box)
Forward the port, then open the URL on your local machine:
```bash
ssh -L 5000:127.0.0.1:5000 naherlin@atlng02
# match the number on both sides if it grabbed a port other than 5000
```

## Use your own data
Replace the two CSVs in `data/` with ng02 exports using the **same columns**:
`region, scoreNN1b, scoreNN2b, nMDT, nRPC, nTGC, nBOL, clusE, rms_clustime, mindR, isolation, MET_dphi`.
Adjust the count/continuous feature lists in `core/helix_mi.py` (`DEFAULTS`) if your schema differs.
(The bundled CSVs are synthetic stand-ins so the app runs out of the box.)

## Layout
- `app.py` — Flask server, smart-port select, `/api/run` + `/api/data`
- `core/helix_mi.py` — analysis engine (also a CLI: `python core/helix_mi.py --help`)
- `templates/` — iframe shell + main / references / glossary / q&a pages
- `static/data/*.json` — references / glossary / q&a content (json-backed)
- `data/` — input CSVs

## Pages
- **Dashboard** — data view-frame, generate/test, dependence ladder, planes + pmi, agreement matrix, jumpers
- **References** — vetted maximum-entropy law citations
- **Glossary** / **Q&A** — json-backed

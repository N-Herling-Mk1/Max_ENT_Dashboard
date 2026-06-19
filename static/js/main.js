// HELIX dashboard — two-region (barrel + endcap) runner
const $ = s => document.querySelector(s);
const fmt = (v, n = 3) => (v === null || v === undefined || Number.isNaN(v)) ? "—" : (+v).toFixed(n);
const img = (p, key) => (p && p[key]) ? `<div class="plot"><img src="/static/${p[key]}?t=${Date.now()}"></div>` : "";
let cached = false;  // becomes true after /api/run_all succeeds
const MASS = ["mS5","mS16","mS35","mS55"];
const MCOL = { mS5:"var(--m5)", mS16:"var(--m16)", mS35:"var(--m35)", mS55:"var(--m55)" };
const massLegend = () => `<div class="mlegend">` +
  MASS.map(m=>`<span class="mc"><span class="sw" style="background:${MCOL[m]}"></span>${m}</span>`).join("") +
  `</div>`;

// ── two-region helpers ──
function rcols(a, b) {
  return `<div class="rcols">
    <div class="rcol"><div class="rtag barrel">BARREL</div>${a}</div>
    <div class="rcol"><div class="rtag endcap">ENDCAP</div>${b}</div></div>`;
}

// ② ABCD vs MaxEnt (per region)
function abcdCol(r) {
  return `<h3>ABCD plane · background</h3>${img(r.plots, "abcd_background")}
    <h3 style="margin-top:12px">MaxEnt detectors</h3>${img(r.plots, "detectors")}
    <div class="muted" style="font-size:11px;margin-top:6px">closure obs/pred <b>${fmt(r.ladder.background.closure.ratio, 2)}</b>
      · τ ${r.maxent.tau_pct}th pct · I(NN1;NN2) <b>${fmt(r.ladder.background.mi.I)}</b> (${fmt(r.ladder.background.mi.sigma, 1)}σ)</div>`;
}
function renderABCD(d) { $("#abcd").innerHTML = rcols(abcdCol(d.barrel), abcdCol(d.endcap)); }

// ③ agreement (per region)
function matrixHTML(ag) {
  const c = ag.cells;
  return `<div class="cm">
    <div></div><div class="hd">ABCD: in A</div><div class="hd">ABCD: not A</div>
    <div class="hd">MaxEnt S&gt;τ</div>
      <div class="cmcell agree"><div class="t" style="color:var(--cyan)">agree · signal-like</div><div class="n">${c.both.n}</div></div>
      <div class="cmcell jump-m"><div class="t" style="color:var(--purple)">MaxEnt-only</div><div class="n">${c.maxent_only.n}</div></div>
    <div class="hd">MaxEnt S&le;τ</div>
      <div class="cmcell jump-a"><div class="t" style="color:var(--amber)">ABCD-only</div><div class="n">${c.abcd_only.n}</div></div>
      <div class="cmcell bg"><div class="t muted">agree · background</div><div class="n">${c.neither.n}</div></div>
  </div>
  <div class="muted" style="font-size:11px;margin-top:8px">same <b style="color:var(--sig)">${ag.same}</b>
    · different <b style="color:var(--amber)">${ag.different}</b> · on ${ag.sample}</div>`;
}
function renderAgreement(d) { $("#matrix").innerHTML = rcols(matrixHTML(d.barrel.agreement), matrixHTML(d.endcap.agreement)); }

// dependence ladder (compact, both regions)
function renderLadder(d) {
  const row = (name, fn, sub) => `<tr><td>${name}<div class="rsub">${sub || ""}</div></td>
    <td class="num">${fn(d.barrel.ladder.signal)}</td><td class="num">${fn(d.barrel.ladder.background)}</td>
    <td class="num">${fn(d.endcap.ladder.signal)}</td><td class="num">${fn(d.endcap.ladder.background)}</td></tr>`;
  $("#ladder").innerHTML = `<table><thead><tr><th>metric</th><th>barrel·sig</th><th>barrel·bg</th><th>endcap·sig</th><th>endcap·bg</th></tr></thead><tbody>
    ${row("Pearson r", x => fmt(x.pearson_r), "linear shadow")}
    ${row("distance corr", x => fmt(x.dcor), "any dependence")}
    ${row("ABCD closure", x => fmt(x.closure.ratio, 2), "2-bin MI · =1 closes")}
    ${row("I(NN1;NN2)", x => fmt(x.mi.I), "full MI")}
    ${row("MI significance σ", x => fmt(x.mi.sigma, 1), "vs permutation null")}
  </tbody></table>`;
}

// information theory — entropy per region
function entCol(r) {
  const erow = (lbl, o) => `<div class="ecard"><div class="et">${lbl}</div>
    <div class="erow"><span>H(X)</span><b>${o.HX.toFixed(3)}</b></div>
    <div class="erow"><span>H(Y)</span><b>${o.HY.toFixed(3)}</b></div>
    <div class="erow"><span>H(X,Y)</span><b>${o.HXY.toFixed(3)}</b></div>
    <div class="erow hi"><span>I = HX+HY−HXY</span><b>${o.I.toFixed(3)}</b></div>
    <div class="erow"><span>I / min(HX,HY)</span><b>${o.I_norm.toFixed(3)}</b></div></div>`;
  return `<div class="egrid">${erow("signal", r.entropy.signal)}${erow("background", r.entropy.background)}</div>`;
}
function renderIT(d) { $("#entropy").innerHTML = rcols(entCol(d.barrel), entCol(d.endcap)); }

// boundary jumpers per region
function jbar(f) {
  const w = Math.min(Math.abs(f.z) / 2, 1) * 100, col = f.z >= 0 ? "var(--purple)" : "var(--amber)";
  return `<div class="bar"><span class="fn">${f.feature}</span>
    <span class="track"><span class="fill" style="width:${w}%;background:${col}"></span></span>
    <span class="z">${(f.z >= 0 ? "+" : "") + f.z.toFixed(2)}σ</span></div>`;
}
function jumpCol(r) {
  const j = r.agreement.jumpers, bl = r.agreement.borderline;
  const block = (set, title, color) => {
    const feats = (j[set] || []).slice(0, 6);
    const body = feats.length ? feats.map(jbar).join("") : `<div class="empty">no events</div>`;
    const b = bl && bl[set];
    const bnote = (b && b.n) ? `<div class="border-note">borderline: ${b.n} pts · median |S−τ|/τ <b>${b.median_rel.toFixed(3)}</b> · ${(b.frac_within_25pct * 100).toFixed(0)}% within 25% of τ</div>` : "";
    return `<div style="margin-bottom:12px"><h3 style="color:${color}">${title}</h3>
      <div class="muted" style="font-size:11px;margin-bottom:6px">feature shift vs the agreeing set (z)</div>${body}${bnote}</div>`;
  };
  return block("maxent_only", "MaxEnt-only", "var(--purple)") + block("abcd_only", "ABCD-only", "var(--amber)");
}
function renderJumpers(d) { $("#jumpers").innerHTML = rcols(jumpCol(d.barrel), jumpCol(d.endcap)); }

// ① category test (both regions)
function renderCategory(d) {
  if (d.error) { $("#category").innerHTML = `<div class="empty">${d.error}</div>`; return; }
  const card = (v) => {
    const cls = v.classify, caseCol = cls.case === "B" ? "var(--purple)" : "var(--cyan)";
    // per-criterion margin bar: positive (cyan) = meets A, negative (purple) = leans B
    const rows = cls.signals.map(s => {
      const m = s.margin || 0;                       // -1.5..+1.5
      const w = Math.min(Math.abs(m)/1.5,1)*50;      // half-width %
      const col = m>=0 ? "var(--cyan)" : "var(--purple)";
      const side = m>=0 ? `left:50%;width:${w}%` : `right:50%;width:${w}%`;
      return `<div class="crow">
        <span class="cn">${s.name}</span><span class="cv">${s.value}</span>
        <span class="cmargin"><span class="cmtrack"><span class="cmmid"></span>
          <span class="cmfill" style="${side};background:${col}"></span></span></span>
        <span class="cl ${s.leans === "B" ? "lb" : "la"}">${s.leans}</span></div>`;
    }).join("");
    const meet = cls.a_criteria_pct, mm = cls.mean_margin;
    const meetTxt = cls.case==="A"
      ? `meets Case A on ${meet}% of criteria`
      : `meets only ${meet}% of Case-A criteria strictly — not all are violated, see margins`;
    return `<div class="catcard" style="border-color:${caseCol}">
      <div class="cathead"><span class="reg">${v.region}</span>
        <span class="verdict" style="background:${caseCol}">CASE ${cls.case}</span></div>
      <div class="catlabel">${cls.label}</div>
      <div class="catmeet">${meetTxt} · mean margin <b>${mm>=0?"+":""}${mm.toFixed(2)}</b></div>
      <div class="catlaw">${cls.b_signals}/${cls.n_signals} criteria lean B · dominant law <b>${cls.dominant_law}</b></div>
      <div class="cmhead"><span>criterion</span><span>value</span><span>← B &nbsp; meets A →</span><span></span></div>
      <div class="crows">${rows}</div></div>`;
  };
  const cards = Object.values(d.verdicts).map(card).join("");
  const plot = d.plot ? `<div class="plot" style="margin-top:14px"><img src="/static/${d.plot}?t=${Date.now()}"></div>` : "";
  $("#category").innerHTML = `<div class="catgrid">${cards}</div>${plot}`;
}

// ── selectors ──
const getSig = () => document.querySelector('#sigsrc input:checked')?.value || "all";
const getCut = () => document.querySelector('#cutmode input:checked')?.value || "absolute";
const getAg  = () => document.querySelector('#agsample input:checked')?.value || "signal";

// enable all selectors once a run is cached (inert until then)
function enableControls(){
  document.querySelectorAll('#sigsrc input, #cutmode input, #agsample input')
    .forEach(el => el.disabled = false);
}
// big thinking dial
const dial = on => document.getElementById('thinking')?.classList.toggle('on', on);

// pull a cached slice and paint every panel (no recompute)
async function fetchAnalyze(sig, cut){
  return (await fetch(`/api/view?signal=${sig}&cutmode=${cut}&region=both&kind=analyze`)).json();
}
async function fetchCategory(sig, cut){
  return (await fetch(`/api/view?signal=${sig}&cutmode=${cut}&kind=category`)).json();
}

async function renderView(){
  if(!cached) return;
  const sig=getSig(), cut=getCut();
  $("#status").innerHTML = `<span class="spin"></span> loading ${sig} · ${cut}…`;
  try{
    if(sig === "all"){ await renderAll(cut); }
    else { await renderSingle(sig, cut); }
  }catch(e){ $("#status").textContent="error: "+e; }
}

// single mass point — original per-region rendering
async function renderSingle(sig, cut){
  const a = await fetchAnalyze(sig, cut);
  const c = await fetchCategory(sig, cut);
  if(a.error){ $("#status").textContent="error: "+a.error; return; }
  const d = a.data;
  renderCategory(c.data);
  renderABCD(d); renderLadder(d); renderIT(d); renderJumpers(d);  // agreement panel is driven by its own mass tabs
  document.querySelectorAll(".chip").forEach(x=>x.classList.add("done"));
  const m=a.meta||{};
  $("#status").innerHTML = `${sig} · ${cut} cuts · agreement on ${m.agreement_sample||getAg()} · cached ${m.generated||""}`;
}

// ALL — overlay 4 mass points. HTML panels = multi-series; plane panels = small multiples.
async function renderAll(cut){
  const slices = {};
  for(const m of MASS){ slices[m] = (await fetchAnalyze(m, cut)).data; }
  // category: identical across signal (it classifies background) — use mS35
  const c = await fetchCategory("mS35", cut);
  renderCategory(c.data);

  // ABCD plane: background once + 4 signal small-multiples per region
  renderABCD_all(slices, cut);
  // ladder / IT: multi-series across the 4 masses  (agreement has its own tab window)
  renderLadder_all(slices);
  renderIT_all(slices);
  renderJumpers_all(slices);
  document.querySelectorAll(".chip").forEach(x=>x.classList.add("done"));
  $("#status").innerHTML = `ALL signal points · ${cut} cuts · ${MASS.length} overlaid`;
}

// ABCD: show background plane once, signal planes as a 2-col small-multiples grid
function renderABCD_all(slices, cut){
  const region = (reg) => {
    const bgPlot = slices.mS35[reg].plots.abcd_background;  // background identical
    const bgImg = bgPlot ? `<h3>ABCD plane · background</h3><div class="plot"><img src="/static/${bgPlot}?t=${Date.now()}"></div>` : "";
    const sm = MASS.map(m=>{
      const p = slices[m][reg].plots.abcd_signal;
      return `<div class="smcard ${m.toLowerCase()==='ms5'?'m5':m.toLowerCase()==='ms16'?'m16':m.toLowerCase()==='ms35'?'m35':'m55'}">
        <span class="smtag">${m}</span>${p?`<img src="/static/${p}?t=${Date.now()}">`:'<div class="empty">—</div>'}</div>`;
    }).join("");
    return `${bgImg}<h3 style="margin-top:12px">signal planes (per mass)</h3><div class="smgrid">${sm}</div>`;
  };
  $("#abcd").innerHTML = rcols(region("barrel"), region("endcap"));
}

// agreement: 4 mini matrices per region, color-tagged
function renderAgreement_all(slices){
  const region = (reg) => MASS.map(m=>{
    const ag = slices[m][reg].agreement;
    return `<div style="margin-bottom:10px"><div class="smtag" style="background:${MCOL[m]};color:#fff;display:inline-block;padding:2px 8px;border-radius:3px;font-size:11px;margin-bottom:4px">${m}</div>${matrixHTML(ag)}</div>`;
  }).join("");
  $("#matrix").innerHTML = massLegend() + rcols(region("barrel"), region("endcap"));
}

// ladder: one table, 4 signal columns per region (background shared)
function renderLadder_all(slices){
  const row = (name, fn, sub) => {
    const cells = ["barrel","endcap"].map(reg =>
      MASS.map(m=>`<td class="num" style="color:${MCOL[m]}">${fn(slices[m][reg].ladder.signal)}</td>`).join("")
    ).join("");
    return `<tr><td>${name}<div class="rsub">${sub||""}</div></td>${cells}</tr>`;
  };
  const head = ["barrel","endcap"].map(reg =>
    MASS.map(m=>`<th style="color:${MCOL[m]}">${reg.slice(0,3)}·${m}</th>`).join("")
  ).join("");
  $("#ladder").innerHTML = massLegend() + `<table><thead><tr><th>metric (signal)</th>${head}</tr></thead><tbody>
    ${row("Pearson r", x=>fmt(x.pearson_r),"linear")}
    ${row("distance corr", x=>fmt(x.dcor),"any dependence")}
    ${row("ABCD closure", x=>fmt(x.closure.ratio,2),"=1 closes")}
    ${row("I(NN1;NN2)", x=>fmt(x.mi.I),"full MI")}
    ${row("MI σ", x=>fmt(x.mi.sigma,1),"vs null")}
  </tbody></table>`;
}

// info theory: 4 signal entropy cards per region
function renderIT_all(slices){
  const region = (reg) => {
    const erow = (m,o)=>`<div class="ecard" style="border-color:${MCOL[m]}"><div class="et" style="color:${MCOL[m]}">${m}</div>
      <div class="erow"><span>H(X)</span><b>${o.HX.toFixed(3)}</b></div>
      <div class="erow"><span>H(Y)</span><b>${o.HY.toFixed(3)}</b></div>
      <div class="erow hi"><span>I</span><b>${o.I.toFixed(3)}</b></div></div>`;
    return `<div class="egrid">${MASS.map(m=>erow(m, slices[m][reg].entropy.signal)).join("")}</div>`;
  };
  $("#entropy").innerHTML = massLegend() + rcols(region("barrel"), region("endcap"));
}

// jumpers: per mass, the maxent-only feature shifts (compact)
function renderJumpers_all(slices){
  const region = (reg) => MASS.map(m=>{
    const j = slices[m][reg].agreement.jumpers;
    const feats = (j.maxent_only||[]).slice(0,4);
    const body = feats.length ? feats.map(jbar).join("") : `<div class="empty">no events</div>`;
    return `<div style="margin-bottom:10px"><h3 style="color:${MCOL[m]}">${m} · MaxEnt-only</h3>${body}</div>`;
  }).join("");
  $("#jumpers").innerHTML = massLegend() + rcols(region("barrel"), region("endcap"));
}

// compute EVERYTHING once, cache server-side, then show the current selection
async function runAll(){
  const btn=$("#run"); btn.disabled=true; dial(true);
  $("#status").innerHTML = `<span class="spin"></span> computing all points × regions × cut modes…`;
  try{
    const r = await (await fetch("/api/run_all",{
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ agreement_sample: getAg() })
    })).json();
    if(!r.ok){ $("#status").textContent="error: "+(r.error||"run failed"); btn.disabled=false; dial(false); return; }
    cached=true; enableControls();
    $("#status").innerHTML = `computed in ${r.meta.elapsed_s}s · selectors live · toggling is instant`;
    await renderView();
    await loadAgreementSlices();
    renderTakehome();
    renderAgreementTab(document.querySelector('.masstabs .mtab.active')?.dataset.mass || 'all');
  }catch(e){ $("#status").textContent="error: "+e; }
  btn.disabled=false; dial(false);
}

// python files panel
async function loadPyFiles(){
  try{
    const d = await (await fetch("/api/pyfiles")).json();
    const rows = (d.files||[]).map(f=>`<div class="pyrow">
      <div class="pyname">${f.path}<span class="pymeta">${f.lines} lines · ${f.size_kb} KB</span></div>
      <div class="pydesc">${f.desc}</div></div>`).join("");
    if($("#pyfiles")) $("#pyfiles").innerHTML = rows || `<div class="empty">no files</div>`;
  }catch(e){ $("#pyfiles").innerHTML = `<div class="empty">${e}</div>`; }
}

// ── wiring ──
$("#run").addEventListener("click", runAll);

// selector changes: re-pill, and (if a run is cached) re-render instantly.
// agreement-sample change requires a recompute (it changes what the engine measured).
document.querySelectorAll('#sigsrc input, #cutmode input').forEach(el=>
  el.addEventListener('change', async ()=>{
    await renderView();
    if(el.name==='cm'){ await loadAgreementSlices(); renderTakehome(); renderAgreementTab(document.querySelector('.masstabs .mtab.active')?.dataset.mass || 'all'); }
  }));
document.querySelectorAll('#agsample input').forEach(el=>
  el.addEventListener('change', ()=>{ if(cached){ $("#status").innerHTML='agreement target changed — re-run to recompute'; } }));

document.querySelectorAll(".chip, .step").forEach(el => el.addEventListener("click",
  () => document.getElementById(el.dataset.jump)?.scrollIntoView({ behavior: "smooth", block: "start" })));

// ── takehome: headline ABCD vs MaxEnt agreement ──
function agPct(ag){ const t=ag.same+ag.different; return t? 100*ag.same/t : 0; }
function renderTakehome(){
  if(!AGslices) return;
  const all = AGslices["ALL"];
  // background agreement is identical across signals; pull it from any slice's bg-run is not stored,
  // so we report signal-pooled agreement + the per-region maxent-only sensitivity.
  const card = (reg) => {
    const ag = all[reg].agreement;
    const pct = agPct(ag).toFixed(1);
    const c = ag.cells;
    const mo = c.maxent_only.n, ao = c.abcd_only.n, both = c.both.n, neither = c.neither.n;
    const tot = ag.same+ag.different;
    const moPct = tot? (100*mo/tot).toFixed(1) : "0";
    return `<div class="thcard">
      <div class="threg">${reg}</div>
      <div class="thbig">${pct}<span class="thpct">%</span></div>
      <div class="thlbl">methods agree (pooled signal)</div>
      <div class="thbreak">
        <span class="thb both">both ${both}</span>
        <span class="thb mo">MaxEnt-only ${mo}</span>
        <span class="thb ao">ABCD-only ${ao}</span>
        <span class="thb neither">neither ${neither}</span>
      </div>
      <div class="thnote">MaxEnt-only = <b>${moPct}%</b> &mdash; events MaxEnt flags that ABCD's box misses</div>
    </div>`;
  };
  $("#takehome").innerHTML = `<div class="thgrid">${card("barrel")}${card("endcap")}</div>`;
}

// ── panel guide: button grid -> shared alert box ──
const GUIDE = {
  theory: ["Theory — ABCD ⊂ MaxEnt",
    "The framing for everything below. ABCD's N_A = N_B·N_C/N_D is the MaxEnt background estimate when the only constraints are the two marginals (independence). Add the measured NN1–NN2 dependence and you get a coupled joint that reduces to ABCD when the scores are independent and corrects it when they are not. ABCD is the special case, not a rival."],
  agreement: ["Method agreement — ABCD × MaxEnt",
    "Per-event crosstab. MaxEnt flags events whose location carries mutual information ABCD discards (pmi ≠ 0). The headline is Cohen's κ, not raw agreement — raw % is pinned near chance by the empty corner, so it looks high even when the methods share almost nothing."],
  jumpers: ["Boundary jumpers — what crosses",
    "Takes the disagreement events and asks which input features are most shifted (z-score vs the agreeing set). Tall purple bars = features driving MaxEnt-only flags. This is where the physics lives: which detector quantities make MaxEnt see signal ABCD can't."],
  abcd: ["ABCD vs MaxEnt — the plane",
    "The 2-D NN-score plane (scoreNN1 vs scoreNN2), cut into A/B/C/D. ABCD predicts the region-A background as B·C/D (independence). MaxEnt predicts the same N_A from the marginals plus the measured correlation — equal to ABCD when ρ=0, corrected when not. Compare both predictions against the observed count."],
  ladder: ["Dependence ladder",
    "Four escalating tests of whether the two NN scores are independent: Pearson r (linear only) ⊂ distance correlation (any dependence) ⊂ ABCD closure (2-bin) ⊂ full mutual information with a permutation-null significance. ABCD's validity requires all of these ≈ 0; nonzero = the bias ABCD ignores."],
  it: ["Information theory — entropy",
    "Mutual information computed directly: I = H(X) + H(Y) − H(X,Y), in bits, per class and region. This is the exact quantity ABCD throws away. A positive I on background means the two scores carry shared information the ABCD factorization assumes doesn't exist."],
  category: ["ABCD-compatibility",
    "Graded 0–100% per region: how trustworthy is ABCD here? Driven by closure deviation (with CI) and effect-size dependence (dCor / debiased MI). Replaces the old hard Case A / Case B verdict, which was internally inconsistent — it could call a region 'incompatible' on an N-inflated MI even when its closure was fine."],
};
function showGuide(key, btn){
  const g = GUIDE[key]; if(!g) return;
  document.querySelectorAll('.gbtn').forEach(b=>b.classList.toggle('active', b===btn));
  const ab = document.getElementById('alertbox');
  ab.querySelector('.ab-title').innerHTML = "▸ " + g[0];
  ab.querySelector('.ab-body').innerHTML = g[1];
}
document.querySelectorAll('.gbtn').forEach(b=>b.addEventListener('click', ()=>{
  showGuide(b.dataset.info, b);
  document.getElementById(b.dataset.jump)?.scrollIntoView({behavior:"smooth",block:"start"});
}));

// ── agreement mass-toggle window (independent of global signal radio) ──
let AGslices = null;   // cache of per-mass analyze slices for the agreement window
async function loadAgreementSlices(){
  const cut = getCut();
  AGslices = {};
  for(const m of MASS){ AGslices[m] = (await fetchAnalyze(m, cut)).data; }
  AGslices["ALL"] = (await fetchAnalyze("ALL", cut)).data;
}
function renderAgreementTab(mass){
  if(!AGslices) return;
  document.querySelectorAll('.masstabs .mtab').forEach(t=>t.classList.toggle('active', t.dataset.mass===mass));
  if(mass === "all"){
    // pooled combined sample (all 4 mass points stacked, one matrix per region)
    const d = AGslices["ALL"];
    $("#matrix").innerHTML = `<div class="masslabel" style="color:var(--m35);font-weight:700;margin-bottom:8px">ALL signal pooled (combined) vs background</div>`
      + rcols(matrixHTML(d.barrel.agreement), matrixHTML(d.endcap.agreement));
  } else {
    const d = AGslices[mass];
    $("#matrix").innerHTML = `<div class="masslabel" style="color:${MCOL[mass]};font-weight:700;margin-bottom:8px">${mass} vs background</div>`
      + rcols(matrixHTML(d.barrel.agreement), matrixHTML(d.endcap.agreement));
  }
}
document.querySelectorAll('.masstabs .mtab').forEach(t=>t.addEventListener('click', ()=>{
  if(!cached) return;
  renderAgreementTab(t.dataset.mass);
}));

// ── TOC scroll-spy + stepper sync ──
(function () {
  const toc = document.querySelector(".toc"); if (!toc) return;
  const links = [...toc.querySelectorAll("a")];
  const steps = [...document.querySelectorAll(".stepper .step")];
  links.forEach(a => a.addEventListener("click",
    () => document.getElementById(a.dataset.target)?.scrollIntoView({ behavior: "smooth", block: "start" })));
  const io = new IntersectionObserver(es => {
    es.forEach(e => {
      if (!e.isIntersecting) return;
      links.forEach(l => l.classList.toggle("active", l.dataset.target === e.target.id));
      steps.forEach(s => s.classList.toggle("active", s.dataset.jump === e.target.id));
    });
  }, { rootMargin: "-15% 0px -75% 0px" });
  links.forEach(l => { const el = document.getElementById(l.dataset.target); if (el) io.observe(el); });
})();

/* ════════════════════════════════════════════════════════════════════
   REDESIGN LAYER (additive) — background-tier panels driven by
   /api/full (helix_stats.run_full). Signal-independent, keyed reg:cut.
   Overrides three renders by re-declaration (last decl wins, non-module):
     renderCategory    -> ABCD-compatibility meter
     renderTakehome    -> N_A predictor (observed / ABCD / MaxEnt)
     renderAgreementTab + renderAgreement_all -> Cohen's κ matrix
   ════════════════════════════════════════════════════════════════════ */
let FULL = null;
async function ensureFull(){
  if (FULL) return FULL;
  try { FULL = (await (await fetch('/api/full')).json()).data || {}; }
  catch(_) { FULL = {}; }
  return FULL;
}
document.getElementById('run')?.addEventListener('click', ()=>{ FULL = null; });
const FK = (reg, cut) => `${reg}:${cut}`;
const num = (v,n=1)=> (v===null||v===undefined||Number.isNaN(v)) ? "—" : (+v).toFixed(n);

function bar(label, val, err, col, maxv, pending){
  const w = Math.max(0, Math.min(100, 100*val/maxv));
  const whisk = err ? `<span style="position:absolute;top:50%;left:${Math.max(0,w-100*err/maxv)}%;width:${200*err/maxv}%;height:1px;background:#fff;opacity:.7"></span>` : "";
  return `<div style="display:flex;align-items:center;gap:8px;margin:3px 0">
    <span style="width:118px;font-size:11px;color:var(--muted)">${label}</span>
    <div style="flex:1;height:15px;background:#0c1018;border-radius:3px;position:relative">
      <div style="height:100%;width:${w}%;background:${col};border-radius:3px;${pending?'opacity:.35':''}"></div>${whisk}</div>
    <span style="width:96px;text-align:right;font-family:'Share Tech Mono',monospace;font-size:11px">${pending?'pending':num(val,0)+(err?' ± '+num(err,0):'')}</span></div>`;
}

function compatCol(reg, cut){
  const F = (FULL||{})[FK(reg,cut)]; if(!F) return `<div class="empty">run full analysis</div>`;
  const c = F.compatibility, score = c.score, reg_ = F.regime;
  const col = score>=60?'var(--cyan)':score>=40?'#ffb020':'var(--amber)';
  const fit = reg_.fit;
  return `<div style="margin-bottom:6px"><span style="font-size:26px;font-weight:700;color:${col};font-family:'Share Tech Mono',monospace">${num(score,0)}%</span>
      <span style="font-size:11px;color:var(--muted)"> ABCD-compatible</span></div>
    <div style="height:7px;background:#0c1018;border-radius:4px;overflow:hidden;margin-bottom:6px"><div style="height:100%;width:${score}%;background:${col}"></div></div>
    <div style="font-size:11px;color:${col};margin-bottom:8px">${c.note}</div>
    <div style="font-size:11px;color:var(--muted)">count regime · <b style="color:${fit==='Poisson'?'var(--purple)':'var(--cyan)'}">${fit}</b>
      (~${num(reg_.per_cell,1)} events/cell, ${num(reg_.occupancy,0)}% filled)</div>`;
}
function renderCategory(_){ ensureFull().then(()=>{ const cut=getCut();
  document.querySelector("#category").innerHTML = rcols(compatCol("barrel",cut), compatCol("endcap",cut)); }); }

function kappaCol(reg, cut){
  const F = (FULL||{})[FK(reg,cut)]; if(!F) return `<div class="empty">run full analysis</div>`;
  const a = F.agreement, c = a.cells;
  const lab = a.label;
  return `<div class="cm">
    <div></div><div class="hd">MaxEnt +</div><div class="hd">MaxEnt −</div>
    <div class="hd">in A</div>
      <div class="cmcell agree"><div class="t" style="color:var(--cyan)">both</div><div class="n">${c.both}</div></div>
      <div class="cmcell jump-a"><div class="t" style="color:var(--amber)">ABCD-only ◆</div><div class="n">${c.abcd_only}</div></div>
    <div class="hd">not A</div>
      <div class="cmcell jump-m"><div class="t" style="color:var(--purple)">MaxEnt-only ◆</div><div class="n">${c.maxent_only}</div></div>
      <div class="cmcell bg"><div class="t muted">neither</div><div class="n">${c.neither}</div></div>
  </div>
  <div class="muted" style="font-size:11px;margin-top:8px">raw <b>${num(a.raw,1)}%</b> · chance <b>${num(a.chance,1)}%</b>
    · <b style="color:var(--cyan)">κ = ${num(a.kappa,2)}</b> <span style="opacity:.7">(${lab})</span></div>`;
}
function renderAgreement_all(_){ ensureFull().then(()=>{ const cut=getCut();
  document.querySelector("#matrix").innerHTML = rcols(kappaCol("barrel",cut), kappaCol("endcap",cut)); }); }
function renderAgreementTab(_){ renderAgreement_all(); }

function predCol(reg, cut){
  const F = (FULL||{})[FK(reg,cut)]; if(!F) return `<div class="empty">run full analysis</div>`;
  const p = F.predictor;
  const obs=p.na_observed, abcd=p.na_abcd, me=p.na_maxent;
  const mx = Math.max(obs, abcd, me, p.na_indep_check)*1.15 || 1;
  return bar("observed N_A", obs, Math.sqrt(obs), "#fff", mx, false)
    + bar("ABCD (B·C/D)", abcd, p.na_abcd_err, "var(--amber)", mx, false)
    + bar("MaxEnt ρ=0", p.na_indep_check, 0, "#5a6b88", mx, false)
    + bar("MaxEnt ρ̂="+num(p.rho_ctrl,2), me, p.na_maxent_err, "var(--purple)", mx, false)
    + `<div class="muted" style="font-size:10px;margin-top:5px">ρ̂ shifts ρ=0 → ρ̂; gap vs ABCD is mostly the marginal construction, not correlation.</div>`;
}
function renderTakehome(){ ensureFull().then(()=>{ const cut=getCut();
  document.querySelector("#takehome").innerHTML = rcols(predCol("barrel",cut), predCol("endcap",cut)); }); }

document.querySelectorAll('#cutmode input').forEach(el=>el.addEventListener('change', ()=>{
  if(!cached) return; renderCategory(); renderAgreement_all(); renderTakehome();
}));

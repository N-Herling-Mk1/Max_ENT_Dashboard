// HELIX dashboard — two-region (barrel + endcap) runner
const $ = s => document.querySelector(s);
const fmt = (v, n = 3) => (v === null || v === undefined || Number.isNaN(v)) ? "—" : (+v).toFixed(n);
const img = (p, key) => (p && p[key]) ? `<div class="plot"><img src="/static/${p[key]}?t=${Date.now()}"></div>` : "";
let hasRun = false, catDone = false;

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
    const rows = cls.signals.map(s => `<div class="crow">
      <span class="cn">${s.name}</span><span class="cv">${s.value}</span>
      <span class="cl ${s.leans === "B" ? "lb" : "la"}">→ ${s.leans}</span></div>`).join("");
    return `<div class="catcard" style="border-color:${caseCol}">
      <div class="cathead"><span class="reg">${v.region}</span>
        <span class="verdict" style="background:${caseCol}">CASE ${cls.case}</span></div>
      <div class="catlabel">${cls.label}</div>
      <div class="catlaw">dominant law: <b>${cls.dominant_law}</b> · ${cls.b_signals}/${cls.n_signals} signals lean B</div>
      <div class="crows">${rows}</div></div>`;
  };
  const cards = Object.values(d.verdicts).map(card).join("");
  const plot = d.plot ? `<div class="plot" style="margin-top:14px"><img src="/static/${d.plot}?t=${Date.now()}"></div>` : "";
  $("#category").innerHTML = `<div class="catgrid">${cards}</div>${plot}`;
}

// ── runners ──
async function runCategory() {
  const b = $("#run-cat"); b.disabled = true; b.textContent = "running…";
  try {
    const d = await (await fetch("/api/categorize", { method: "POST" })).json();
    renderCategory(d);
    catDone = true;
    const run = $("#run"); run.disabled = false; run.title = "";
  } catch (e) { $("#category").innerHTML = `<div class="empty">${e}</div>`; }
  b.disabled = false; b.innerHTML = "&#9312; RUN CATEGORY TEST";
}

async function runAll() {
  if (!catDone) return;
  const btn = $("#run"); btn.disabled = true;
  $("#status").innerHTML = `<span class="spin"></span> running both regions…`;
  try {
    const d = await (await fetch("/api/run_both", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agreement_sample: $("#agsample").value })
    })).json();
    if (d.error) { $("#status").textContent = "error: " + d.error; btn.disabled = false; return; }
    renderABCD(d); renderAgreement(d); renderLadder(d); renderIT(d); renderJumpers(d);
    hasRun = true;
    document.querySelectorAll(".chip").forEach(c => c.classList.add("done"));
    const m = d.barrel.meta;
    $("#status").innerHTML = `done · barrel + endcap · ${m.elapsed_s}s/region · ${m.generated}`;
  } catch (e) { $("#status").textContent = "error: " + e; }
  btn.disabled = false;
}

// ── wiring ──
$("#run-cat").addEventListener("click", runCategory);
$("#run").addEventListener("click", runAll);

document.querySelectorAll(".chip, .step").forEach(el => el.addEventListener("click",
  () => document.getElementById(el.dataset.jump)?.scrollIntoView({ behavior: "smooth", block: "start" })));


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

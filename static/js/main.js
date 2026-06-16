// HELIX dashboard — talks to Flask /api/data and /api/run
const $ = s => document.querySelector(s);
const fmt = (v, n = 3) => (v === null || v === undefined || Number.isNaN(v)) ? "—" : (+v).toFixed(n);

async function loadData() {
  const file = $("#dfile").value, region = $("#region").value;
  try {
    const r = await fetch(`/api/data?file=${file}&region=${region}`);
    const d = await r.json();
    if (d.error) { $("#stats").innerHTML = `<div class="empty">${d.error}</div>`; return; }
    // stats
    let s = `<table><thead><tr><th>feature</th><th>mean</th><th>std</th><th>min</th><th>max</th></tr></thead><tbody>`;
    for (const c of d.columns) {
      const st = d.stats[c]; if (!st) continue;
      s += `<tr><td>${c}</td><td class="num">${st.mean}</td><td class="num">${st.std}</td><td class="num">${st.min}</td><td class="num">${st.max}</td></tr>`;
    }
    s += `</tbody></table>`;
    $("#stats").innerHTML = `<div class="muted" style="font-size:11px;margin-bottom:6px">${d.n_rows} rows · region ${d.region}</div>` + s;
    // preview
    const cols = d.columns;
    let p = `<table><thead><tr>${cols.map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>`;
    for (const row of d.preview) p += `<tr>${cols.map(c => `<td>${row[c]}</td>`).join("")}</tr>`;
    p += `</tbody></table>`;
    $("#preview").innerHTML = p;
  } catch (e) { $("#stats").innerHTML = `<div class="empty">${e}</div>`; }
}

function card(lab, sig, bg, sub, hero) {
  return `<div class="card ${hero ? "hero" : ""}"><div class="lab">${lab}</div>
    <div class="val"><span class="sig">${sig}</span> <span class="bg">${bg}</span></div>
    <div class="sub">${sub}</div></div>`;
}

function renderLadder(L) {
  const s = L.signal, b = L.background;
  const sgn = v => (v >= 0 ? "+" : "") + fmt(v);
  $("#ladder").innerHTML =
    card("Pearson r", sgn(s.pearson_r), sgn(b.pearson_r), "linear shadow") +
    card("distance corr", fmt(s.dcor), fmt(b.dcor), "any dependence · [0,1]") +
    card("ABCD closure", fmt(s.closure.ratio, 2), fmt(b.closure.ratio, 2), "2-bin MI · =1 closes") +
    card("I(NN1;NN2)", `${fmt(s.mi.I)} <span class="faint">${fmt(s.mi.sigma, 1)}σ</span>`,
         `${fmt(b.mi.I)} <span class="faint">${fmt(b.mi.sigma, 1)}σ</span>`, "full MI · vs perm null", true);
}

function renderPlots(p) {
  const cell = (key, title) => p[key]
    ? `<div><h3>${title}</h3><div class="plot"><img src="/static/${p[key]}?t=${Date.now()}"></div></div>` : "";
  $("#plots").innerHTML = cell("signal_plane", "signal plane") +
    cell("background_plane", "background plane") + cell("pmi_field", "pmi field");
}

function renderMatrix(ag) {
  const c = ag.cells;
  $("#ag-meta").innerHTML = `sample: <b>${ag.sample}</b> · same <b style="color:var(--sig)">${ag.same}</b> · different <b style="color:var(--amber)">${ag.different}</b>`;
  $("#matrix").innerHTML = `
    <div class="cm">
      <div></div><div class="hd">ABCD: in A</div><div class="hd">ABCD: not A</div>
      <div class="hd">MaxEnt: S&gt;τ</div>
        <div class="cmcell agree"><div class="t" style="color:var(--cyan)">agree · signal-like</div><div class="n">${c.both.n}</div></div>
        <div class="cmcell jump-m"><div class="t" style="color:var(--purple)">MaxEnt-only · jumper</div><div class="n">${c.maxent_only.n}</div></div>
      <div class="hd">MaxEnt: S&le;τ</div>
        <div class="cmcell jump-a"><div class="t" style="color:var(--amber)">ABCD-only · jumper</div><div class="n">${c.abcd_only.n}</div></div>
        <div class="cmcell bg"><div class="t muted">agree · background</div><div class="n">${c.neither.n}</div></div>
    </div>
    <div class="muted" style="font-size:11px;margin-top:8px">cells carry event IDs (e.g. ${c.maxent_only.n} MaxEnt-only ids tracked for export)</div>`;
}

function jbar(f) {
  const w = Math.min(Math.abs(f.z) / 2, 1) * 100;
  const col = f.z >= 0 ? "var(--purple)" : "var(--amber)";
  return `<div class="bar"><span class="fn">${f.feature}</span>
    <span class="track"><span class="fill" style="width:${w}%;background:${col}"></span></span>
    <span class="z">${(f.z >= 0 ? "+" : "") + f.z.toFixed(2)}σ</span></div>`;
}

function renderJumpers(j) {
  const block = (set, title, color) => {
    const feats = (j[set] || []).slice(0, 6);
    const body = feats.length ? feats.map(jbar).join("")
      : `<div class="empty">no events in this cell</div>`;
    return `<div class="panel" style="margin:0"><h3 style="color:${color}">${title}</h3>
      <div class="muted" style="font-size:11px;margin-bottom:8px">feature shift vs the agreeing set (z)</div>${body}</div>`;
  };
  $("#jumpers").innerHTML =
    block("maxent_only", "MaxEnt-only set", "var(--purple)") +
    block("abcd_only", "ABCD-only set", "var(--amber)");
}

async function run() {
  const btn = $("#run"); btn.disabled = true;
  $("#status").innerHTML = `<span class="spin"></span> running engine…`;
  try {
    const r = await fetch("/api/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ region: $("#region").value, agreement_sample: $("#agsample").value })
    });
    const d = await r.json();
    if (d.error) { $("#status").textContent = "error: " + d.error; btn.disabled = false; return; }
    renderLadder(d.ladder); renderPlots(d.plots); renderMatrix(d.agreement); renderJumpers(d.agreement.jumpers);
    $("#status").innerHTML = `done · ${d.meta.n_signal} sig / ${d.meta.n_background} bg · ${d.meta.elapsed_s}s · ${d.meta.generated}`;
  } catch (e) { $("#status").textContent = "error: " + e; }
  btn.disabled = false;
}

$("#run").addEventListener("click", run);
$("#reload-data").addEventListener("click", loadData);
$("#dfile").addEventListener("change", loadData);
$("#region").addEventListener("change", loadData);
loadData();

// ── on-this-page TOC: smooth scroll + scroll-spy ──
(function(){
  const toc = document.querySelector(".toc"); if(!toc) return;
  const links = [...toc.querySelectorAll("a")];
  links.forEach(a=>a.addEventListener("click",()=>{
    document.getElementById(a.dataset.target)?.scrollIntoView({behavior:"smooth",block:"start"});
  }));
  const io = new IntersectionObserver(es=>{
    es.forEach(e=>{ if(e.isIntersecting)
      links.forEach(l=>l.classList.toggle("active", l.dataset.target===e.target.id)); });
  },{rootMargin:"-15% 0px -75% 0px"});
  links.forEach(l=>{const el=document.getElementById(l.dataset.target); if(el) io.observe(el);});
})();

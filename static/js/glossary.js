let TERMS=[];
function render(q=""){
  const f = TERMS.filter(t=>(t.term+t.def+t.cat).toLowerCase().includes(q.toLowerCase()));
  const cats=[...new Set(f.map(t=>t.cat))];
  document.getElementById("terms").innerHTML = cats.map(c=>
    `<div class="lp-cat-head">${c}</div><div class="lp-grid">` +
    f.filter(t=>t.cat===c).map(t=>
      `<div class="lp-card"><span class="term">${t.term}</span><p>${t.def}</p></div>`).join("") +
    `</div>`
  ).join("") || `<div class="empty">no match</div>`;
}
fetch("/static/data/glossary.json?v=2").then(r=>r.json()).then(d=>{TERMS=d.terms;render();});
document.getElementById("search").addEventListener("input",e=>render(e.target.value));

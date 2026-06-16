let QA=[];
function render(q=""){
  const f = QA.filter(x=>(x.q+x.a+x.cat).toLowerCase().includes(q.toLowerCase()));
  const cats=[...new Set(f.map(x=>x.cat))];
  document.getElementById("qa").innerHTML = cats.map(c=>
    `<div class="cat">${c}</div>` + f.filter(x=>x.cat===c).map(x=>
      `<div class="qitem"><div class="q">▸ ${x.q}</div><div class="a">${x.a}</div></div>`).join("")
  ).join("") || `<div class="empty">no match</div>`;
  document.querySelectorAll(".qitem .q").forEach(el=>el.addEventListener("click",()=>el.parentElement.classList.toggle("open")));
}
fetch("/static/data/qa.json").then(r=>r.json()).then(d=>{QA=d.qa;render();});
document.getElementById("search").addEventListener("input",e=>render(e.target.value));

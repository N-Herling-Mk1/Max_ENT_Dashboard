const TAG = s => s==="solid" ? '<span class="tag ok">✓ solid</span>'
  : s==="corrective" ? '<span class="tag warn">⚠ corrective</span>'
  : '<span class="tag warn">⚠ qualifier</span>';
fetch("/static/data/references.json").then(r=>r.json()).then(d=>{
  document.getElementById("foundation").innerHTML =
    `<table><thead><tr><th>claim</th><th>source</th><th>status</th></tr></thead><tbody>` +
    d.foundation.map(x=>`<tr><td>${x.claim}</td><td class="muted">${x.source}</td><td>${TAG(x.status)}</td></tr>`).join("") +
    `</tbody></table>`;
  document.getElementById("laws").innerHTML =
    `<table><thead><tr><th>support</th><th>constraint</th><th>law</th><th>source</th><th>status</th></tr></thead><tbody>` +
    d.laws.map(x=>`<tr><td>${x.support}</td><td class="muted">${x.constraint}</td><td class="law">${x.law}</td><td class="muted">${x.source}</td><td>${TAG(x.status)}</td></tr>`).join("") +
    `</tbody></table>`;
  document.getElementById("note").textContent = d.note;
});

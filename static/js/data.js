// data view page — files synopsis + per-file inspect
const $ = s => document.querySelector(s);

async function loadFiles() {
  const el = $("#files-overview");
  try {
    const d = await (await fetch("/api/files")).json();
    if (!d.files || !d.files.length) { el.innerHTML = `<div class="empty">no CSVs in data/</div>`; return; }
    el.innerHTML = `<div class="files-grid">` + d.files.map((f, i) => {
      if (f.error) return `<div class="file-row"><span class="fname">${f.name}</span> <span class="muted">${f.error}</span></div>`;
      const role = f.role ? `<span class="role ${f.role}">${f.role}</span>` : "";
      const regions = Object.keys(f.regions || {}).length
        ? `<div class="regions">regions: ${Object.entries(f.regions).map(([k, v]) => `<span>${k}</span> ${v}`).join(" · ")}</div>` : "";
      const cols = `<div class="cols-toggle" data-i="${i}">▸ ${f.n_cols} columns</div>
        <div class="cols">${f.columns.map(c => `<span class="col">${c}</span>`).join("")}</div>`;
      return `<div class="file-row" id="fr-${i}">
        <div class="fr-top"><span class="fname">${f.name}</span>${role}
          <span class="meta"><span><b>${f.rows.toLocaleString()}</b> rows</span><span><b>${f.n_cols}</b> cols</span><span><b>${f.size_kb}</b> kb</span></span></div>
        ${regions}${cols}</div>`;
    }).join("") + `</div>`;
    el.querySelectorAll(".cols-toggle").forEach(t => t.addEventListener("click",
      () => document.getElementById("fr-" + t.dataset.i).classList.toggle("open")));
  } catch (e) { el.innerHTML = `<div class="empty">${e}</div>`; }
}

async function loadData() {
  const file = $("#dfile").value, region = $("#dregion").value;
  try {
    const r = await fetch(`/api/data?file=${file}&region=${region}`);
    const d = await r.json();
    if (d.error) { $("#stats").innerHTML = `<div class="empty">${d.error}</div>`; return; }
    let s = `<table><thead><tr><th>feature</th><th>mean</th><th>std</th><th>min</th><th>max</th></tr></thead><tbody>`;
    for (const c of d.columns) {
      const st = d.stats[c]; if (!st) continue;
      s += `<tr><td>${c}</td><td class="num">${st.mean}</td><td class="num">${st.std}</td><td class="num">${st.min}</td><td class="num">${st.max}</td></tr>`;
    }
    s += `</tbody></table>`;
    $("#stats").innerHTML = `<div class="muted" style="font-size:11px;margin:6px 8px">${d.n_rows} rows · region ${d.region}</div>` + s;
    const cols = d.columns;
    let p = `<table><thead><tr>${cols.map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>`;
    for (const row of d.preview) p += `<tr>${cols.map(c => `<td>${row[c]}</td>`).join("")}</tr>`;
    p += `</tbody></table>`;
    $("#preview").innerHTML = p;
  } catch (e) { $("#stats").innerHTML = `<div class="empty">${e}</div>`; }
}

$("#files-refresh").addEventListener("click", loadFiles);
$("#dfile").addEventListener("change", loadData);
$("#dregion").addEventListener("change", loadData);
loadFiles();
loadData();

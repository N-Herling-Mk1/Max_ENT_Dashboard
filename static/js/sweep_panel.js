/* sweep_panel.js — cut-space explorer.
   Per region: heatmap (graph) beside its match matrix, equal size, large
   axes/titles. Below: a sortable κ/% table of every cut outcome + CSV export.
   Click a heatmap cell (or a table row) to set the cut; metrics reconstruct
   from cached grid arrays (no server round-trip). */
window.SweepPanel = (function () {
  const VIR = ['#440154', '#46327e', '#365c8d', '#277f8e', '#1fa187', '#4ac16d', '#a0da39', '#fde725'];
  const RDBU = ['#b2182b', '#ef8a62', '#fddbc7', '#f7f7f7', '#d1e5f0', '#67a9cf', '#2166ac'];
  const RC = { barrel: '#185fa5', endcap: '#534ab7' };
  const CAT = { both: '#0f6e56', abcd_only: '#854f0b', maxent_only: '#3c3489', neither: '#6b6b86' };
  const num = (v, n = 1) => (v === null || v === undefined || Number.isNaN(v)) ? '—' : (+v).toFixed(n);

  let root, DATA, metric = 'raw', sel = null, rows = [], sortKey = 'kappa', sortDir = -1;

  function hex(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  function ramp(stops, t) {
    t = Math.max(0, Math.min(1, t)); const s = t * (stops.length - 1); const i = Math.floor(s); const f = s - i;
    if (i >= stops.length - 1) return 'rgb(' + hex(stops[stops.length - 1]).join(',') + ')';
    const a = hex(stops[i]), b = hex(stops[i + 1]);
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ',' + Math.round(a[1] + (b[1] - a[1]) * f) + ',' + Math.round(a[2] + (b[2] - a[2]) * f) + ')';
  }
  function colorFor(reg, i, j) {
    const D = DATA[reg];
    if (metric === 'raw') return ramp(VIR, (D.raw[i][j] - 40) / 60);
    return ramp(RDBU, 0.5 + 0.5 * Math.max(-1, Math.min(1, D.kappa[i][j] / 0.45)));
  }

  function drawHeat(reg) {
    const D = DATA[reg]; if (!D) return;
    const cv = root.querySelector('#heat-' + reg); if (!cv) return;
    const K = D.grid.length, dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth || 300, H = 300;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const m = { l: 50, r: 12, t: 30, b: 48 }; const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const cw = pw / K, chh = ph / K;
    for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) {
      ctx.fillStyle = colorFor(reg, i, j);
      ctx.fillRect(m.l + i * cw, m.t + (K - 1 - j) * chh, cw + 0.6, chh + 0.6);
    }
    // titles + axis labels
    ctx.fillStyle = RC[reg]; ctx.font = '700 13px Orbitron, sans-serif';
    ctx.fillText(reg.toUpperCase() + ' · ' + (metric === 'raw' ? '% match' : 'κ'), m.l, 20);
    ctx.fillStyle = '#9aa3b8'; ctx.font = '12px "Share Tech Mono", monospace';
    ctx.fillText('cut_x →', m.l + pw / 2 - 24, H - 8);
    ctx.save(); ctx.translate(14, m.t + ph / 2 + 22); ctx.rotate(-Math.PI / 2); ctx.fillText('cut_y →', 0, 0); ctx.restore();
    [0, 0.25, 0.5, 0.75, 0.95].forEach(g => {
      const xi = (g - D.grid[0]) / (D.grid[K - 1] - D.grid[0]);
      ctx.fillText(g.toFixed(2), m.l + xi * pw - 11, H - 24);
      ctx.fillText(g.toFixed(2), 18, m.t + (1 - xi) * ph + 4);
    });
    // selected cell: crosshair connectors from both axes + value chips
    if (sel) {
      const bx = m.l + sel.i * cw, by = m.t + (K - 1 - sel.j) * chh;
      const ccx = bx + cw / 2, ccy = by + chh / 2;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.55)';
      ctx.beginPath(); ctx.moveTo(m.l, ccy); ctx.lineTo(ccx, ccy); ctx.moveTo(ccx, m.t + ph); ctx.lineTo(ccx, ccy); ctx.stroke();
      ctx.lineWidth = 1.4; ctx.strokeStyle = '#000';
      ctx.beginPath(); ctx.moveTo(m.l, ccy); ctx.lineTo(ccx, ccy); ctx.moveTo(ccx, m.t + ph); ctx.lineTo(ccx, ccy); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.strokeRect(bx, by, cw, chh);
      const chip = (cx, cy, txt) => {
        ctx.font = '700 11px "Share Tech Mono", monospace';
        const w = ctx.measureText(txt).width + 10;
        ctx.fillStyle = '#000'; ctx.fillRect(cx - w / 2, cy - 8, w, 16);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(txt, cx, cy + 1); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      };
      chip(ccx, m.t + ph + 12, 'x=' + D.grid[sel.i].toFixed(2));
      chip(25, ccy, 'y=' + D.grid[sel.j].toFixed(2));
    }
    cv._geom = { m, cw, chh, K };
  }

  function metricsCol(reg) {
    const D = DATA[reg]; if (!D || !sel) return '';
    const i = sel.i, j = sel.j;
    const raw = D.raw[i][j], kap = D.kappa[i][j];
    const A = D.A[i][j], both = D.both[i][j], me = D.maxe_n, N = D.N;
    const abcd_only = A - both, maxent_only = me - both, neither = N - A - maxent_only;
    const label = kap < 0 ? 'none' : kap < 0.2 ? 'slight' : kap < 0.4 ? 'fair' : kap < 0.6 ? 'moderate' : 'substantial';
    const cell = (lbl, n, key) => '<div style="background:#fff;border:1px solid #e3e3ec;border-radius:8px;min-height:84px;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:3px">' +
      '<div style="font-size:11px;color:' + CAT[key] + '">' + lbl + '</div>' +
      '<div style="font-size:30px;font-weight:700;font-family:Share Tech Mono,monospace;color:#111">' + n + '</div></div>';
    return '<div style="background:#fbfbfd;border:1px solid #e3e3ec;border-radius:10px;padding:14px;color:#1b1b24;height:100%;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center">' +
      '<div style="font-size:13px;letter-spacing:.12em;color:' + RC[reg] + ';font-family:Orbitron,sans-serif">' + reg.toUpperCase() + '</div>' +
      '<div style="font-size:11px;color:#787890;font-family:Share Tech Mono,monospace;margin-top:1px">cut · x=' + DATA[reg].grid[i].toFixed(2) + ' · y=' + DATA[reg].grid[j].toFixed(2) + '</div>' +
      '<div style="text-align:center;margin:4px 0 10px"><span style="font-size:46px;font-weight:700;color:#0f6e56;font-family:Share Tech Mono,monospace">' + num(raw, 1) + '%</span>' +
      '<div style="font-size:12px;color:#787890">match · κ <b style="color:#1b1b24">' + num(kap, 2) + '</b> (' + label + ') · N_A=' + A + '</div></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
      cell('both', both, 'both') + cell('ABCD-only', abcd_only, 'abcd_only') +
      cell('MaxEnt-only', maxent_only, 'maxent_only') + cell('neither', neither, 'neither') + '</div></div>';
  }

  function selText() { if (!sel || !DATA.barrel) return ''; const g = DATA.barrel.grid; return 'selected cut · x=' + g[sel.i].toFixed(2) + ' · y=' + g[sel.j].toFixed(2); }

  function buildRows() {
    rows = [];
    ['barrel', 'endcap'].forEach(reg => {
      const D = DATA[reg]; if (!D) return; const g = D.grid;
      for (let i = 0; i < g.length; i++) for (let j = 0; j < g.length; j++)
        rows.push({ region: reg, i, j, cx: g[i], cy: g[j], NA: D.A[i][j], match: D.raw[i][j], kappa: D.kappa[i][j] });
    });
  }
  function sortRows() {
    const k = sortKey, d = sortDir;
    rows.sort((a, b) => {
      if (k === 'region') { const va = a.region + a.cx + a.cy, vb = b.region + b.cx + b.cy; return va < vb ? -d : va > vb ? d : 0; }
      return (a[k] - b[k]) * d;
    });
  }
  function tableHTML() {
    sortRows();
    const arrow = key => sortKey === key ? (sortDir < 0 ? ' ▾' : ' ▴') : '';
    const th = (key, lbl, al) => '<th data-k="' + key + '" style="position:sticky;top:0;background:#0c1018;cursor:pointer;text-align:' + (al || 'right') + ';padding:7px 10px;color:var(--cyan);font-family:Orbitron,sans-serif;font-size:10px;letter-spacing:.06em">' + lbl + arrow(key) + '</th>';
    const body = rows.map(r => {
      const isSel = sel && r.i === sel.i && r.j === sel.j;
      const kcol = r.kappa < 0 ? '#e07a7a' : r.kappa < 0.2 ? '#9aa3b8' : r.kappa < 0.4 ? '#7ec9a6' : '#5dca7a';
      return '<tr data-reg="' + r.region + '" data-i="' + r.i + '" data-j="' + r.j + '" style="cursor:pointer;background:' + (isSel ? 'rgba(40,224,208,.12)' : 'transparent') + '">' +
        '<td style="padding:5px 10px;color:' + RC[r.region] + '">' + r.region + '</td>' +
        '<td style="padding:5px 10px;text-align:right;font-family:Share Tech Mono,monospace">' + r.cx.toFixed(2) + '</td>' +
        '<td style="padding:5px 10px;text-align:right;font-family:Share Tech Mono,monospace">' + r.cy.toFixed(2) + '</td>' +
        '<td style="padding:5px 10px;text-align:right;font-family:Share Tech Mono,monospace">' + r.NA + '</td>' +
        '<td style="padding:5px 10px;text-align:right;font-family:Share Tech Mono,monospace">' + r.match.toFixed(1) + '</td>' +
        '<td style="padding:5px 10px;text-align:right;font-family:Share Tech Mono,monospace;color:' + kcol + '">' + r.kappa.toFixed(3) + '</td></tr>';
    }).join('');
    return '<table style="width:100%;border-collapse:collapse;font-size:12px;color:#cfeefe"><thead><tr>' +
      th('region', 'region', 'left') + th('cx', 'cut_x') + th('cy', 'cut_y') + th('NA', 'N_A') + th('match', 'match %') + th('kappa', 'κ') +
      '</tr></thead><tbody>' + body + '</tbody></table>';
  }

  function refreshRight() { ['barrel', 'endcap'].forEach(reg => { const el = root.querySelector('#m-' + reg); if (el) el.innerHTML = metricsCol(reg); }); }
  function refreshTable() { const el = root.querySelector('#sweep-table'); if (el) { el.innerHTML = tableHTML(); wireTable(); } }

  function wireTable() {
    root.querySelectorAll('#sweep-table th').forEach(h => h.onclick = () => {
      const k = h.dataset.k; if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = (k === 'region') ? 1 : -1; }
      refreshTable();
    });
    root.querySelectorAll('#sweep-table tr[data-reg]').forEach(tr => tr.onclick = () => {
      sel = { i: +tr.dataset.i, j: +tr.dataset.j };
      refreshRight(); drawHeat('barrel'); drawHeat('endcap'); refreshTable();
      const s = root.querySelector('#sweep-sel'); if (s) s.textContent = selText();
    });
  }
  function downloadCSV() {
    sortRows();
    const head = 'region,cut_x,cut_y,N_A,match_pct,kappa\n';
    const body = rows.map(r => [r.region, r.cx.toFixed(3), r.cy.toFixed(3), r.NA, r.match.toFixed(2), r.kappa.toFixed(4)].join(',')).join('\n');
    const blob = new Blob([head + body], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'helix_sweep_overlap.csv'; a.click(); URL.revokeObjectURL(a.href);
  }
  function wireClick(reg) {
    const cv = root.querySelector('#heat-' + reg); cv.style.cursor = 'crosshair';
    cv.addEventListener('click', e => {
      const r = cv.getBoundingClientRect(), G = cv._geom; if (!G) return;
      const i = Math.floor((e.clientX - r.left - G.m.l) / G.cw), jr = Math.floor((e.clientY - r.top - G.m.t) / G.chh), j = G.K - 1 - jr;
      if (i < 0 || i >= G.K || j < 0 || j >= G.K) return;
      sel = { i, j }; refreshRight(); drawHeat('barrel'); drawHeat('endcap'); refreshTable();
      const s = root.querySelector('#sweep-sel'); if (s) s.textContent = selText();
    });
  }
  function regionRow(reg) {
    if (!DATA[reg]) return '';
    return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:stretch;margin-bottom:16px">' +
      '<canvas id="heat-' + reg + '" style="width:100%;display:block;border:1px solid #e3e3ec;border-radius:10px;background:#fff"></canvas>' +
      '<div id="m-' + reg + '" style="height:100%"></div></div>';
  }

  function render(el, data, opts) {
    root = el; DATA = data || {};
    if (!DATA.barrel && !DATA.endcap) { el.innerHTML = ''; return; }
    const g = (DATA.barrel || DATA.endcap).grid;
    if (!sel) {
      const near = v => { let bi = 0, bd = 9; g.forEach((gg, k) => { if (Math.abs(gg - v) < bd) { bd = Math.abs(gg - v); bi = k; } }); return bi; };
      const c = (opts && opts.cuts && opts.cuts.endcap) || [0.7, 0.7];
      sel = { i: near(c[0]), j: near(c[1]) };
    }
    buildRows();
    el.innerHTML =
      '<div class="panel"><div class="ph"><span class="dot"></span><h2>threshold sweep — click to set the cut</h2>' +
      '<span style="margin-left:auto;display:inline-flex;gap:4px">' +
      '<button id="m-raw" class="btn-ghost" style="padding:5px 12px">% match</button>' +
      '<button id="m-kappa" class="btn-ghost" style="padding:5px 12px">κ</button></span></div>' +
      '<div id="sweep-sel" class="muted" style="font-size:12px;margin-bottom:10px">' + selText() + '</div>' +
      regionRow('barrel') + regionRow('endcap') +
      '<div class="muted" style="font-size:11px;margin-bottom:14px">left = heatmap over the cut grid · white box = selected cut · right = matrix at that cut</div>' +
      '<div class="ph" style="border-top:1px solid var(--line2);padding-top:12px"><span class="dot"></span><h2>all outcomes — sortable</h2>' +
      '<button id="csv-dl" class="btn-ghost" style="margin-left:auto;padding:5px 12px">⤓ download .csv</button></div>' +
      '<div id="sweep-table" style="max-height:340px;overflow:auto;border:1px solid var(--line2);border-radius:8px"></div>' +
      '</div>';

    refreshRight();
    const setM = mm => {
      metric = mm;
      const a = root.querySelector('#m-raw'), b = root.querySelector('#m-kappa');
      a.style.background = mm === 'raw' ? 'var(--cyan)' : '#000'; a.style.color = mm === 'raw' ? '#001014' : 'var(--cyan)';
      b.style.background = mm === 'kappa' ? 'var(--cyan)' : '#000'; b.style.color = mm === 'kappa' ? '#001014' : 'var(--cyan)';
      drawHeat('barrel'); drawHeat('endcap');
    };
    root.querySelector('#m-raw').onclick = () => setM('raw');
    root.querySelector('#m-kappa').onclick = () => setM('kappa');
    root.querySelector('#csv-dl').onclick = downloadCSV;
    ['barrel', 'endcap'].forEach(r => { if (DATA[r]) { drawHeat(r); wireClick(r); } });
    refreshTable(); setM(metric);
  }
  return { render };
})();

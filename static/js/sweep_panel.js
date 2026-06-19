/* sweep_panel.js — cut-space explorer.
   Per region: heatmap (graph) beside its match matrix, equal size, large
   axes/titles. Below: a sortable κ/% table of every cut outcome + CSV export.
   Click a heatmap cell (or a table row) to set the cut; metrics reconstruct
   from cached grid arrays (no server round-trip). */
window.SweepPanel = (function () {
  const VIR = ['#440154', '#46327e', '#365c8d', '#277f8e', '#1fa187', '#4ac16d', '#a0da39', '#fde725'];
  const RDBU = ['#b2182b', '#ef8a62', '#fddbc7', '#f7f7f7', '#d1e5f0', '#67a9cf', '#2166ac'];
  const TEAL = ['#E1F5EE', '#9FE1CB', '#5DCAA5', '#1D9E75', '#0F6E56', '#04342C'];
  const CO = ['#0d7a5f', '#56c39c', '#bfe8db', '#f4f4f6', '#f7dcb6', '#e3994a', '#b56516']; // teal(synergy −) ↔ amber(redundant +)
  const SEP = ['#EAF2FB', '#C3DBF2', '#8FBCE6', '#5A97D6', '#2f6fb5', '#1b4470'];           // sequential signal separation (blue)
  const RC = { barrel: '#185fa5', endcap: '#534ab7' };
  const CAT = { both: '#0f6e56', abcd_only: '#854f0b', maxent_only: '#3c3489', neither: '#6b6b86' };
  const num = (v, n = 1) => (v === null || v === undefined || Number.isNaN(v)) ? '—' : (+v).toFixed(n);

  let root, DATA, metric = 'raw', sel = null, rows = [], sortKey = 'kappa', sortDir = -1;
  let suMaxGlobal = 1e-9;   // max symmetric-uncertainty across both regions, for colour
  let coMax = 1e-9, sepMax = 1e-9;        // global colour scales for label-aware maps
  let curSignal = 'mS35', gridN = 25;     // active signal hypothesis + grid size

  function H2(p) { return (p <= 0 || p >= 1) ? 0 : (-p * Math.log2(p) - (1 - p) * Math.log2(1 - p)); }

  // binarized-plane info at a cut: raw MI (bits) and symmetric uncertainty U∈[0,1].
  // U = 2·I / (H_X + H_Y) — fraction of the obtainable shared information present.
  function infoAt(reg, i, j) {
    const D = DATA[reg]; const N = D.N;
    if (!D || !D.nx || !D.ny) return { mi: 0, su: 0 };
    const a = D.A[i][j], c = D.nx[i] - a, b = D.ny[j] - a, d = N - a - b - c;
    const px1 = (a + c) / N, py1 = (a + b) / N;
    let mi = 0;
    const T = [[a, px1, py1], [b, 1 - px1, py1], [c, px1, 1 - py1], [d, 1 - px1, 1 - py1]];
    for (let t = 0; t < 4; t++) {
      const cnt = T[t][0], pxk = T[t][1], pyk = T[t][2];
      if (cnt > 0 && pxk > 0 && pyk > 0) { const p = cnt / N; mi += p * Math.log2(p / (pxk * pyk)); }
    }
    mi = Math.max(0, mi);
    const denom = H2(px1) + H2(py1);
    const su = denom > 1e-12 ? Math.max(0, Math.min(1, 2 * mi / denom)) : 0;
    return { mi: mi, su: su };
  }
  function miAt(reg, i, j) { return infoAt(reg, i, j).mi; }
  function suAt(reg, i, j) { return infoAt(reg, i, j).su; }
  function computeSuMax() {
    suMaxGlobal = 1e-9;
    ['barrel', 'endcap'].forEach(reg => {
      const D = DATA[reg]; if (!D) return; const K = D.grid.length;
      for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) suMaxGlobal = Math.max(suMaxGlobal, suAt(reg, i, j));
    });
  }
  function hasLabel() { return !!((DATA.barrel && DATA.barrel.coinfo) || (DATA.endcap && DATA.endcap.coinfo)); }
  function coAt(reg, i, j) { const D = DATA[reg]; return (D && D.coinfo) ? D.coinfo[i][j] : null; }
  function sepAt(reg, i, j) { const D = DATA[reg]; return (D && D.sep) ? D.sep[i][j] : null; }
  function computeLabelMax() {
    coMax = 1e-9; sepMax = 1e-9;
    ['barrel', 'endcap'].forEach(reg => {
      const D = DATA[reg]; if (!D || !D.coinfo) return; const K = D.grid.length;
      for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) {
        coMax = Math.max(coMax, Math.abs(D.coinfo[i][j])); sepMax = Math.max(sepMax, D.sep[i][j]);
      }
    });
  }

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
    if (metric === 'mi') return ramp(TEAL, suAt(reg, i, j) / suMaxGlobal);   // normalized, global scale
    if (metric === 'coinfo') {
      const v = coAt(reg, i, j); if (v === null) return '#f0f0f0';
      const t = Math.max(-1, Math.min(1, v / coMax));
      return t >= 0 ? ramp(['#F0F0F0', '#000000'], t) : ramp(['#F4D7D5', '#C0140E'], -t);   // black=redundant(+), red=synergy(−)
    }
    if (metric === 'sep') { const v = sepAt(reg, i, j); return v === null ? '#f4f4f6' : ramp(SEP, v / sepMax); }
    return ramp(RDBU, 0.5 + 0.5 * Math.max(-1, Math.min(1, D.kappa[i][j] / 0.45)));
  }

  function drawHeat(reg) {
    const D = DATA[reg]; if (!D) return;
    const cv = root.querySelector('#heat-' + reg); if (!cv) return;
    const K = D.grid.length, dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth || 300, H = 260;
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
    ctx.fillText(reg.toUpperCase() + ' · ' + (metric === 'raw' ? '% match' : metric === 'mi' ? 'shared info U' : metric === 'coinfo' ? 'co-info (red +/syn −)' : metric === 'sep' ? 'I(X,Y;L) sep' : 'κ'), m.l, 20);
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
    const inf = infoAt(reg, i, j);
    const coV = D.coinfo ? D.coinfo[i][j] : null, sepV = D.sep ? D.sep[i][j] : null;
    const ixV = D.ixl ? D.ixl[i] : null, iyV = D.iyl ? D.iyl[j] : null;

    const line = (lbl, val) => '<div style="display:flex;justify-content:space-between;gap:8px;padding:2px 0;border-bottom:1px solid #eef0f4">' +
      '<span style="font-size:11px;color:#787890">' + lbl + '</span>' +
      '<span style="font-size:11px;font-family:Share Tech Mono,monospace;color:#1b1b24;text-align:right">' + val + '</span></div>';
    // 2×2 agreement matrix cell (the important part)
    const mcell = (lbl, n, key) => '<div style="background:#fff;border:1px solid #e6e6ee;border-top:3px solid ' + CAT[key] + ';border-radius:7px;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:2px;padding:4px 2px">' +
      '<div style="font-size:10px;color:' + CAT[key] + '">' + lbl + '</div>' +
      '<div style="font-size:24px;font-weight:700;font-family:Share Tech Mono,monospace;color:#111">' + n + '</div></div>';

    const leftCol = '<div style="flex:1.3;display:flex;flex-direction:column;min-width:0">' +
      '<div style="font-size:12px;letter-spacing:.12em;color:' + RC[reg] + ';font-family:Orbitron,sans-serif">' + reg.toUpperCase() + '</div>' +
      '<div style="text-align:center;margin:1px 0 6px">' +
        '<div style="font-size:52px;line-height:.92;font-weight:700;color:#0f6e56;font-family:Share Tech Mono,monospace">' + num(raw, 1) +
          '<span style="font-size:20px">%</span></div>' +
        '<div style="font-size:10px;color:#787890;letter-spacing:.14em">MATCH · cut x=' + D.grid[i].toFixed(2) + ' y=' + D.grid[j].toFixed(2) + '</div>' +
      '</div>' +
      line('κ', num(kap, 2) + ' <span style="color:#787890">(' + label + ')</span>') +
      line('N_A', A) +
      line('shared U', '<b>' + (inf.su * 100).toFixed(2) + '%</b> · ' + (inf.mi * 1000).toFixed(2) + ' mbits') +
      (coV !== null ? line('co-info', '<b style="color:' + (coV >= 0 ? '#000' : '#c0140e') + '">' + (coV >= 0 ? 'redundant' : 'synergy') + '</b> ' + coV.toFixed(4)) : '') +
      (sepV !== null ? line('I(X,Y;L)', sepV.toFixed(4) + ' bits') : '') +
      (ixV !== null ? line('I(X;L) · I(Y;L)', ixV.toFixed(3) + ' · ' + iyV.toFixed(3)) : '') +
      '</div>';

    const matrix = '<div style="flex:1;display:flex;flex-direction:column;min-width:0">' +
      '<div style="font-size:10px;color:#787890;text-align:center;margin-bottom:5px;line-height:1.25">agreement matrix<br>ABCD∈A (rows) × MaxEnt flag (cols)</div>' +
      '<div style="flex:1;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:5px">' +
        mcell('both', both, 'both') + mcell('ABCD-only', abcd_only, 'abcd_only') +
        mcell('MaxEnt-only', maxent_only, 'maxent_only') + mcell('neither', neither, 'neither') +
      '</div></div>';

    return '<div style="background:#fbfbfd;border:1px solid #e3e3ec;border-radius:10px;padding:12px;color:#1b1b24;height:100%;box-sizing:border-box;display:flex;flex-direction:row;gap:14px;align-items:stretch">' +
      leftCol + matrix + '</div>';
  }

  function selText() { if (!sel || !DATA.barrel) return ''; const g = DATA.barrel.grid; return 'selected cut · x=' + g[sel.i].toFixed(2) + ' · y=' + g[sel.j].toFixed(2); }

  function legendHTML(mm) {
    const lab = t => '<span style="color:#9aa3b8;font-size:12px;font-family:Share Tech Mono,monospace">' + t + '</span>';
    const bar = grad => '<span style="display:inline-block;width:240px;height:16px;border:1px solid #cfd3dc;border-radius:3px;background:' + grad + ';vertical-align:middle"></span>';
    const cap = t => '<span style="color:#787890;font-size:12px">' + t + '</span>';
    const row = inner => '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:center">' + inner + '</div>';
    const note = '<div style="font-size:11px;color:#787890;margin-top:5px;text-align:center">white box = selected cut · right panel = matrix at that cut</div>';
    let r;
    if (mm === 'raw') r = row(lab('40%') + bar('linear-gradient(to right,' + VIR.join(',') + ')') + lab('100%') + cap('· % agreement (viridis)'));
    else if (mm === 'kappa') r = row(lab('−0.45') + bar('linear-gradient(to right,' + RDBU.join(',') + ')') + lab('+0.45') + cap('· Cohen κ (red − / blue +)'));
    else if (mm === 'mi') r = row(lab('0') + bar('linear-gradient(to right,' + TEAL.join(',') + ')') + lab((suMaxGlobal * 100).toFixed(2) + '%') + cap('· shared info U — fraction of obtainable'));
    else if (mm === 'coinfo') r = row(lab('−' + coMax.toFixed(3)) + cap('synergy') + bar('linear-gradient(to right,#C0140E,#F4D7D5,#F0F0F0,#000000)') + cap('redundant') + lab('+' + coMax.toFixed(3)) + cap('· co-info vs ' + curSignal + ' (bits): red = complementary, black = duplicate'));
    else if (mm === 'sep') r = row(lab('0') + bar('linear-gradient(to right,' + SEP.join(',') + ')') + lab(sepMax.toFixed(3)) + cap('bits · I(X,Y;L) separation of ' + curSignal + ' (more = better)'));
    else r = '';
    return '<div style="background:#fbfbfd;border:1px solid #e3e3ec;border-radius:10px;padding:9px 16px;display:inline-block">' + r + note + '</div>';
  }

  function buildRows() {
    rows = [];
    ['barrel', 'endcap'].forEach(reg => {
      const D = DATA[reg]; if (!D) return; const g = D.grid;
      for (let i = 0; i < g.length; i++) for (let j = 0; j < g.length; j++) {
        const inf = infoAt(reg, i, j);
        rows.push({ region: reg, i, j, cx: g[i], cy: g[j], NA: D.A[i][j], match: D.raw[i][j], kappa: D.kappa[i][j], mi: inf.mi, su: inf.su, co: D.coinfo ? D.coinfo[i][j] : null, sep: D.sep ? D.sep[i][j] : null });
      }
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
    const L = hasLabel();
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
        '<td style="padding:5px 10px;text-align:right;font-family:Share Tech Mono,monospace;color:' + kcol + '">' + r.kappa.toFixed(3) + '</td>' +
        '<td style="padding:5px 10px;text-align:right;font-family:Share Tech Mono,monospace;color:#5dca7a">' + (r.su * 100).toFixed(2) + '%</td>' +
        (L ? '<td style="padding:5px 10px;text-align:right;font-family:Share Tech Mono,monospace;color:' + (r.co >= 0 ? '#e3994a' : '#56c39c') + '">' + (r.co === null ? '—' : r.co.toFixed(4)) + '</td>' +
             '<td style="padding:5px 10px;text-align:right;font-family:Share Tech Mono,monospace;color:#b197d6">' + (r.sep === null ? '—' : r.sep.toFixed(4)) + '</td>' : '') +
        '</tr>';
    }).join('');
    return '<table style="width:100%;border-collapse:collapse;font-size:12px;color:#cfeefe"><thead><tr>' +
      th('region', 'region', 'left') + th('cx', 'cut_x') + th('cy', 'cut_y') + th('NA', 'N_A') + th('match', 'match %') + th('kappa', 'κ') + th('su', 'shared U') +
      (L ? th('co', 'co-info') + th('sep', 'I(X,Y;L)') : '') +
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
    const L = hasLabel();
    const head = 'region,cut_x,cut_y,N_A,match_pct,kappa,plane_mi_bits,shared_info_U' + (L ? ',coinfo_bits,sep_IXYL_bits' : '') + '\n';
    const body = rows.map(r => [r.region, r.cx.toFixed(3), r.cy.toFixed(3), r.NA, r.match.toFixed(2), r.kappa.toFixed(4), r.mi.toFixed(6), r.su.toFixed(5)]
      .concat(L ? [r.co === null ? '' : r.co.toFixed(6), r.sep === null ? '' : r.sep.toFixed(6)] : []).join(',')).join('\n');
    const blob = new Blob([head + body], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'helix_sweep_overlap.csv'; a.click(); URL.revokeObjectURL(a.href);
  }
  function markSig() {
    root.querySelectorAll('.sig-opt').forEach(b => { const on = b.dataset.sig === curSignal;
      b.style.background = on ? 'var(--cyan)' : '#000'; b.style.color = on ? '#001014' : 'var(--cyan)'; });
    const D = DATA.endcap || DATA.barrel; const info = root.querySelector('#sig-info');
    if (info && D) info.textContent = 'N_sig=' + (D.n_sig != null ? D.n_sig : '?') + ' · prior=' + (D.prior || 'equal');
  }
  async function loadLabel(sig) {
    const info = root.querySelector('#sig-info'); if (info) info.textContent = 'loading ' + sig + '…';
    try {
      const lr = await (await fetch('/api/sweep_label?grid=' + gridN + '&signal=' + sig)).json();
      const lab = lr.data || {};
      ['barrel', 'endcap'].forEach(r => { if (DATA[r] && lab[r]) Object.assign(DATA[r], {
        coinfo: lab[r].coinfo, sep: lab[r].sep, ixl: lab[r].ixl, iyl: lab[r].iyl, n_sig: lab[r].n_sig, prior: lab[r].prior }); });
      curSignal = sig; computeLabelMax(); buildRows();
      refreshRight(); drawHeat('barrel'); drawHeat('endcap'); refreshTable(); markSig();
      const lg = root.querySelector('#sweep-legend'); if (lg) lg.innerHTML = legendHTML(metric);
    } catch (e) { if (info) info.textContent = 'failed: ' + e; }
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
    return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:stretch;margin-bottom:12px">' +
      '<canvas id="heat-' + reg + '" style="width:100%;display:block;border:1px solid #e3e3ec;border-radius:10px;background:#fff"></canvas>' +
      '<div id="m-' + reg + '" style="height:100%"></div></div>';
  }

  function render(el, data, opts) {
    root = el; DATA = data || {};
    if (!DATA.barrel && !DATA.endcap) { el.innerHTML = ''; return; }
    const g = (DATA.barrel || DATA.endcap).grid;
    gridN = g.length; if (opts && opts.signal) curSignal = opts.signal;
    if (!sel) {
      const near = v => { let bi = 0, bd = 9; g.forEach((gg, k) => { if (Math.abs(gg - v) < bd) { bd = Math.abs(gg - v); bi = k; } }); return bi; };
      const c = (opts && opts.cuts && opts.cuts.endcap) || [0.7, 0.7];
      sel = { i: near(c[0]), j: near(c[1]) };
    }
    buildRows();
    const LBL = hasLabel();
    el.innerHTML =
      '<div class="panel"><div class="ph"><span class="dot"></span><h2>threshold sweep — click to set the cut</h2>' +
      '<span style="margin-left:auto;display:inline-flex;gap:4px;flex-wrap:wrap">' +
      '<button id="m-raw" class="btn-ghost" style="padding:5px 12px">% match</button>' +
      '<button id="m-kappa" class="btn-ghost" style="padding:5px 12px">κ</button>' +
      '<button id="m-mi" class="btn-ghost" style="padding:5px 12px">shared info</button>' +
      (LBL ? '<button id="m-coinfo" class="btn-ghost" style="padding:5px 12px">co-info</button><button id="m-sep" class="btn-ghost" style="padding:5px 12px">signal sep</button>' : '') +
      '</span></div>' +
      '<div id="sweep-legend" style="display:flex;justify-content:center;margin:2px 0 12px"></div>' +
      '<div id="sweep-sel" class="muted" style="font-size:12px;margin-bottom:10px">' + selText() + '</div>' +
      (LBL ? '<div id="sig-radio" style="display:flex;gap:6px;align-items:center;margin:0 0 12px;font-size:12px;flex-wrap:wrap">' +
        '<span class="muted">signal hypothesis:</span>' +
        ['mS5', 'mS16', 'mS35', 'mS55', 'ALL'].map(sg => '<button class="btn-ghost sig-opt" data-sig="' + sg + '" style="padding:3px 9px">' + sg + '</button>').join('') +
        '<span id="sig-info" class="muted" style="margin-left:6px"></span>' +
        '<span id="sig-hint" class="muted" style="margin-left:6px;font-style:italic"></span></div>' : '') +
      regionRow('barrel') + regionRow('endcap') +
      '<div class="ph" style="border-top:1px solid var(--line2);padding-top:12px"><span class="dot"></span><h2>all outcomes — sortable</h2>' +
      '<button id="csv-dl" class="btn-ghost" style="margin-left:auto;padding:5px 12px">⤓ download .csv</button></div>' +
      '<div id="sweep-table" style="max-height:340px;overflow:auto;border:1px solid var(--line2);border-radius:8px"></div>' +
      '</div>';

    refreshRight();
    computeSuMax(); computeLabelMax();
    const BTN = { raw: '#m-raw', kappa: '#m-kappa', mi: '#m-mi', coinfo: '#m-coinfo', sep: '#m-sep' };
    const setM = mm => {
      metric = mm;
      Object.keys(BTN).forEach(k => {
        const el = root.querySelector(BTN[k]); if (!el) return;
        el.style.background = (mm === k) ? 'var(--cyan)' : '#000';
        el.style.color = (mm === k) ? '#001014' : 'var(--cyan)';
      });
      const lg = root.querySelector('#sweep-legend'); if (lg) lg.innerHTML = legendHTML(mm);
      const rad = root.querySelector('#sig-radio');
      if (rad) {
        const relevant = (mm === 'coinfo' || mm === 'sep');
        rad.style.opacity = relevant ? '1' : '0.4';
        rad.style.pointerEvents = relevant ? 'auto' : 'none';
        const hint = root.querySelector('#sig-hint');
        if (hint) hint.textContent = relevant ? '' : '— only affects co-info / signal sep';
      }
      drawHeat('barrel'); drawHeat('endcap');
    };
    root.querySelector('#m-raw').onclick = () => setM('raw');
    root.querySelector('#m-kappa').onclick = () => setM('kappa');
    root.querySelector('#m-mi').onclick = () => setM('mi');
    if (root.querySelector('#m-coinfo')) root.querySelector('#m-coinfo').onclick = () => setM('coinfo');
    if (root.querySelector('#m-sep')) root.querySelector('#m-sep').onclick = () => setM('sep');
    root.querySelectorAll('.sig-opt').forEach(b => b.onclick = () => loadLabel(b.dataset.sig));
    root.querySelector('#csv-dl').onclick = downloadCSV;
    ['barrel', 'endcap'].forEach(r => { if (DATA[r]) { drawHeat(r); wireClick(r); } });
    refreshTable(); markSig(); setM(metric);
  }
  return { render };
})();

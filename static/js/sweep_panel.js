/* sweep_panel.js — explore the (cut_x, cut_y) space.
   LEFT: clickable heatmaps (barrel, endcap), % match or κ.
   RIGHT: metrics for the selected cut, reconstructed from cached grid
   arrays (no server round-trip). A single selected (i,j) drives both. */
window.SweepPanel = (function () {
  const VIR = ['#440154', '#46327e', '#365c8d', '#277f8e', '#1fa187', '#4ac16d', '#a0da39', '#fde725'];
  const RDBU = ['#b2182b', '#ef8a62', '#fddbc7', '#f7f7f7', '#d1e5f0', '#67a9cf', '#2166ac']; // neg..pos
  const RC = { barrel: '#185fa5', endcap: '#534ab7' };
  const CAT = { both: '#0f6e56', abcd_only: '#854f0b', maxent_only: '#3c3489', neither: '#6b6b86' };
  const num = (v, n = 1) => (v === null || v === undefined || Number.isNaN(v)) ? '—' : (+v).toFixed(n);

  let root, DATA, metric = 'raw', sel = null;  // sel = {i, j} grid indices

  function hex(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  function ramp(stops, t) {
    t = Math.max(0, Math.min(1, t)); const s = t * (stops.length - 1); const i = Math.floor(s); const f = s - i;
    if (i >= stops.length - 1) return 'rgb(' + hex(stops[stops.length - 1]).join(',') + ')';
    const a = hex(stops[i]), b = hex(stops[i + 1]);
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ',' + Math.round(a[1] + (b[1] - a[1]) * f) + ',' + Math.round(a[2] + (b[2] - a[2]) * f) + ')';
  }

  function colorFor(reg, i, j) {
    const D = DATA[reg];
    if (metric === 'raw') { return ramp(VIR, (D.raw[i][j] - 40) / 60); }      // ~40–100% range
    const k = D.kappa[i][j]; const mx = 0.45; return ramp(RDBU, 0.5 + 0.5 * Math.max(-1, Math.min(1, k / mx)));
  }

  function drawHeat(reg) {
    const D = DATA[reg]; if (!D) return;
    const cv = root.querySelector('#heat-' + reg); if (!cv) return;
    const K = D.grid.length, dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth || 230, H = 200;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const m = { l: 30, r: 8, t: 8, b: 22 }; const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const cw = pw / K, chh = ph / K;
    for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) {
      ctx.fillStyle = colorFor(reg, i, j);
      ctx.fillRect(m.l + i * cw, m.t + (K - 1 - j) * chh, cw + 0.6, chh + 0.6);
    }
    if (sel) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.strokeRect(m.l + sel.i * cw, m.t + (K - 1 - sel.j) * chh, cw, chh);
    }
    ctx.fillStyle = '#787890'; ctx.font = '9px monospace';
    ctx.fillText('cut_x →', m.l + pw / 2 - 16, H - 6);
    ctx.save(); ctx.translate(9, m.t + ph / 2 + 16); ctx.rotate(-Math.PI / 2); ctx.fillText('cut_y →', 0, 0); ctx.restore();
    [0, 0.5, 0.95].forEach(g => {
      const xi = (g - D.grid[0]) / (D.grid[K - 1] - D.grid[0]);
      ctx.fillText(g.toFixed(1), m.l + xi * pw - 6, H - 13);
      ctx.fillText(g.toFixed(1), 12, m.t + (1 - xi) * ph + 3);
    });
    cv._geom = { m, cw, chh, K };
  }

  function metricsCol(reg) {
    const D = DATA[reg]; if (!D || !sel) return '';
    const i = sel.i, j = sel.j;
    const raw = D.raw[i][j], kap = D.kappa[i][j];
    const A = D.A[i][j], both = D.both[i][j], me = D.maxe_n, N = D.N;
    const abcd_only = A - both, maxent_only = me - both, neither = N - A - maxent_only;
    const label = kap < 0 ? 'none' : kap < 0.2 ? 'slight' : kap < 0.4 ? 'fair' : kap < 0.6 ? 'moderate' : 'substantial';
    const cell = (lbl, n, key) => '<div style="background:#fff;border:1px solid #e3e3ec;border-radius:7px;min-height:58px;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:2px">' +
      '<div style="font-size:9px;color:' + CAT[key] + '">' + lbl + '</div>' +
      '<div style="font-size:21px;font-weight:700;font-family:Share Tech Mono,monospace;color:#111">' + n + '</div></div>';
    return '<div style="background:#fbfbfd;border:1px solid #e3e3ec;border-radius:10px;padding:12px;color:#1b1b24;margin-bottom:12px">' +
      '<div style="font-size:11px;letter-spacing:.12em;color:' + RC[reg] + ';font-family:Orbitron,sans-serif">' + reg.toUpperCase() + '</div>' +
      '<div style="text-align:center;margin:2px 0 8px"><span style="font-size:40px;font-weight:700;color:#0f6e56;font-family:Share Tech Mono,monospace">' + num(raw, 1) + '%</span>' +
      '<div style="font-size:11px;color:#787890">match · κ <b style="color:#1b1b24">' + num(kap, 2) + '</b> (' + label + ') · N_A=' + A + '</div></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">' +
      cell('both', both, 'both') + cell('ABCD-only', abcd_only, 'abcd_only') +
      cell('MaxEnt-only', maxent_only, 'maxent_only') + cell('neither', neither, 'neither') + '</div></div>';
  }

  function refreshRight() { root.querySelector('#sweep-metrics').innerHTML = metricsCol('barrel') + metricsCol('endcap'); }

  function selText() {
    if (!sel || !DATA.barrel) return '';
    const g = DATA.barrel.grid;
    return 'selected cut · x=' + g[sel.i].toFixed(2) + ' y=' + g[sel.j].toFixed(2);
  }

  function wireClick(reg) {
    const cv = root.querySelector('#heat-' + reg);
    cv.style.cursor = 'crosshair';
    cv.addEventListener('click', e => {
      const r = cv.getBoundingClientRect(), G = cv._geom; if (!G) return;
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const i = Math.floor((x - G.m.l) / G.cw), jr = Math.floor((y - G.m.t) / G.chh);
      const j = G.K - 1 - jr;
      if (i < 0 || i >= G.K || j < 0 || j >= G.K) return;
      sel = { i, j };
      refreshRight(); drawHeat('barrel'); drawHeat('endcap');
      root.querySelector('#sweep-sel').textContent = selText();
    });
  }

  function render(el, data, opts) {
    root = el; DATA = data || {};
    if (!DATA.barrel && !DATA.endcap) { el.innerHTML = ''; return; }
    const K = (DATA.barrel || DATA.endcap).grid.length;
    if (!sel) {
      const g = (DATA.barrel || DATA.endcap).grid;
      const near = v => { let bi = 0, bd = 9; g.forEach((gg, k) => { if (Math.abs(gg - v) < bd) { bd = Math.abs(gg - v); bi = k; } }); return bi; };
      const c = (opts && opts.cuts && opts.cuts.endcap) || [0.7, 0.7];
      sel = { i: near(c[0]), j: near(c[1]) };
    }
    const heat = reg => DATA[reg] ? '<div style="margin-bottom:10px"><div style="font-size:11px;color:' + RC[reg] + ';font-family:Orbitron,sans-serif;margin-bottom:3px">' + reg.toUpperCase() + '</div>' +
      '<canvas id="heat-' + reg + '" style="width:100%;display:block;border:1px solid #e3e3ec;border-radius:8px;background:#fff"></canvas></div>' : '';
    el.innerHTML =
      '<div class="panel"><div class="ph"><span class="dot"></span><h2>threshold sweep &mdash; click to set the cut</h2>' +
      '<span style="margin-left:auto;display:inline-flex;gap:4px">' +
      '<button id="m-raw" class="btn-ghost" style="padding:4px 10px">% match</button>' +
      '<button id="m-kappa" class="btn-ghost" style="padding:4px 10px">κ</button></span></div>' +
      '<div id="sweep-sel" class="muted" style="font-size:11px;margin-bottom:8px">' + selText() + '</div>' +
      '<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start">' +
      '<div>' + heat('barrel') + heat('endcap') +
      '<div class="muted" style="font-size:10px">color = ' + (metric === 'raw' ? '% match (viridis)' : 'κ (red − / blue +)') + ' · white box = selected cut</div></div>' +
      '<div id="sweep-metrics"></div>' +
      '</div></div>';

    const setM = mm => { metric = mm; root.querySelector('#m-raw').style.background = mm === 'raw' ? 'var(--cyan)' : '#000'; root.querySelector('#m-raw').style.color = mm === 'raw' ? '#001014' : 'var(--cyan)'; root.querySelector('#m-kappa').style.background = mm === 'kappa' ? 'var(--cyan)' : '#000'; root.querySelector('#m-kappa').style.color = mm === 'kappa' ? '#001014' : 'var(--cyan)'; drawHeat('barrel'); drawHeat('endcap'); root.querySelector('.muted').textContent = 'color = ' + (mm === 'raw' ? '% match (viridis)' : 'κ (red − / blue +)') + ' · white box = selected cut'; };
    root.querySelector('#m-raw').onclick = () => setM('raw');
    root.querySelector('#m-kappa').onclick = () => setM('kappa');
    ['barrel', 'endcap'].forEach(r => { if (DATA[r]) { drawHeat(r); wireClick(r); } });
    refreshRight(); setM(metric);
  }
  return { render };
})();

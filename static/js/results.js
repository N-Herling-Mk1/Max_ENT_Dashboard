/* results.js — SINGLE-mode results at the chosen cut: % match + matrix
   (top) and predictor + compatibility (below). White cards, centered. */
window.Results = (function () {
  const CUT = 'absolute';
  const num = (v, n = 1) => (v === null || v === undefined || Number.isNaN(v)) ? '—' : (+v).toFixed(n);
  const FK = (reg) => reg + ':' + CUT;
  const RC = { barrel: '#185fa5', endcap: '#534ab7' };
  const CAT = { both: '#0f6e56', abcd_only: '#854f0b', maxent_only: '#3c3489', neither: '#6b6b86' };
  const sheet = inner => '<div style="background:#fbfbfd;border:1px solid #e3e3ec;border-radius:10px;padding:14px;color:#1b1b24">' + inner + '</div>';

  function matchSheet(full, reg) {
    const F = full[FK(reg)]; if (!F) return ''; const a = F.agreement;
    const empty = (a.cells.both + a.cells.abcd_only) === 0;
    return sheet('<div style="text-align:center">' +
      '<div style="font-size:11px;letter-spacing:.12em;color:' + RC[reg] + ';font-family:Orbitron,sans-serif">' + reg.toUpperCase() + '</div>' +
      '<div style="font-size:50px;font-weight:700;color:#0f6e56;font-family:Share Tech Mono,monospace;line-height:1.05">' + num(a.raw, 1) + '%</div>' +
      '<div style="font-size:11px;color:#787890">match · κ <b style="color:#1b1b24">' + num(a.kappa, 2) + '</b> (' + a.label + ') · chance ' + num(a.chance, 1) + '%</div>' +
      (empty ? '<div style="font-size:10px;color:#b3261e;margin-top:4px">region A empty — diagnostics degenerate</div>' : '') +
      '</div>');
  }
  function mcell(label, n, key) {
    return '<div style="background:#fff;border:1px solid #e3e3ec;border-radius:8px;min-height:74px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:3px">' +
      '<div style="font-size:10px;color:' + CAT[key] + '">' + label + '</div>' +
      '<div style="font-size:26px;font-weight:700;font-family:Share Tech Mono,monospace;color:#111">' + n + '</div></div>';
  }
  function matrixSheet(full, reg) {
    const F = full[FK(reg)]; if (!F) return ''; const c = F.agreement.cells;
    const hd = t => '<div style="font-size:10px;color:#787890;text-align:center;align-self:center">' + t + '</div>';
    return sheet('<div style="font-size:11px;letter-spacing:.12em;color:' + RC[reg] + ';font-family:Orbitron,sans-serif;margin-bottom:8px">' + reg.toUpperCase() + '</div>' +
      '<div style="display:grid;grid-template-columns:40px 1fr 1fr;gap:7px">' +
      '<div></div>' + hd('MaxEnt +') + hd('MaxEnt −') +
      hd('in A') + mcell('both', c.both, 'both') + mcell('ABCD-only ◆', c.abcd_only, 'abcd_only') +
      hd('not A') + mcell('MaxEnt-only ◆', c.maxent_only, 'maxent_only') + mcell('neither', c.neither, 'neither') +
      '</div>');
  }
  function bar(label, val, err, col, mx, pending) {
    const w = Math.max(0, Math.min(100, 100 * val / mx));
    const whisk = err ? '<span style="position:absolute;top:50%;left:' + Math.max(0, w - 100 * err / mx) + '%;width:' + (200 * err / mx) + '%;height:1px;background:#333;opacity:.6"></span>' : '';
    return '<div style="display:flex;align-items:center;gap:8px;margin:5px 0">' +
      '<span style="width:120px;font-size:11px;color:#787890">' + label + '</span>' +
      '<div style="flex:1;height:15px;background:#edeef3;border-radius:3px;position:relative">' +
      '<div style="height:100%;width:' + w + '%;background:' + col + ';border-radius:3px;' + (pending ? 'opacity:.35' : '') + '"></div>' + whisk + '</div>' +
      '<span style="width:92px;text-align:right;font-family:Share Tech Mono,monospace;font-size:11px;color:#1b1b24">' + (pending ? 'pending' : num(val, 0) + (err ? ' ± ' + num(err, 0) : '')) + '</span></div>';
  }
  function predSheet(full, reg) {
    const F = full[FK(reg)]; if (!F) return sheet('<div style="text-align:center;color:#999">—</div>');
    const p = F.predictor, mx = (Math.max(p.na_observed, p.na_abcd, p.na_maxent, p.na_indep_check) * 1.15) || 1;
    return sheet('<div style="font-size:11px;letter-spacing:.12em;color:' + RC[reg] + ';font-family:Orbitron,sans-serif;margin-bottom:4px">' + reg.toUpperCase() + '</div>' +
      bar('observed N_A', p.na_observed, Math.sqrt(p.na_observed), '#444', mx, false) +
      bar('ABCD (B·C/D)', p.na_abcd, p.na_abcd_err, '#ba7517', mx, false) +
      bar('MaxEnt ρ=0', p.na_indep_check, 0, '#9aa3b8', mx, false) +
      bar('MaxEnt ρ̂=' + num(p.rho_ctrl, 2), p.na_maxent, p.na_maxent_err, '#534ab7', mx, false));
  }
  function compatSheet(full, reg) {
    const F = full[FK(reg)]; if (!F) return sheet('<div style="text-align:center;color:#999">—</div>');
    const c = F.compatibility, rg = F.regime, s = c.score;
    const col = s >= 60 ? '#0f6e56' : s >= 40 ? '#a05a00' : '#993c1d';
    return sheet('<div style="text-align:center">' +
      '<div style="font-size:11px;letter-spacing:.12em;color:' + RC[reg] + ';font-family:Orbitron,sans-serif">' + reg.toUpperCase() + '</div>' +
      '<div style="font-size:30px;font-weight:700;color:' + col + ';font-family:Share Tech Mono,monospace">' + num(s, 0) + '%</div>' +
      '<div style="font-size:11px;color:#787890">compatible</div></div>' +
      '<div style="height:6px;background:#edeef3;border-radius:4px;overflow:hidden;margin:8px 0"><div style="height:100%;width:' + s + '%;background:' + col + '"></div></div>' +
      '<div style="font-size:11px;color:' + col + ';text-align:center">' + c.note + '</div>' +
      '<div style="font-size:11px;color:#787890;text-align:center;margin-top:3px">' + rg.fit + ' regime · ~' + num(rg.per_cell, 1) + ' evt/cell</div>');
  }
  function panel(title, sub, body) {
    return '<div class="panel"><div class="ph"><span class="dot"></span><h2>' + title + '</h2></div>' + (sub ? '<div class="psub">' + sub + '</div>' : '') + body + '</div>';
  }
  function two(a, b) { return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' + a + b + '</div>'; }

  function renderSingle(el, data) {
    const full = (data && data.full) || {};
    if (!Object.keys(full).length) { el.innerHTML = '<div class="empty">no results</div>'; return; }
    el.innerHTML =
      '<div style="display:grid;grid-template-columns:minmax(0,0.85fr) minmax(0,1.15fr);gap:16px">' +
        panel('% match · ABCD ↔ MaxEnt', '', '<div style="display:grid;gap:12px">' + matchSheet(full, 'barrel') + matchSheet(full, 'endcap') + '</div>') +
        panel('agreement matrix', '', '<div style="display:grid;gap:12px">' + matrixSheet(full, 'barrel') + matrixSheet(full, 'endcap') + '</div>') +
      '</div>' +
      panel('★ N_A predictor — observed / ABCD / MaxEnt', '', two(predSheet(full, 'barrel'), predSheet(full, 'endcap'))) +
      panel('ABCD-compatibility', '', two(compatSheet(full, 'barrel'), compatSheet(full, 'endcap')));
  }
  return { renderSingle, render: renderSingle };
})();

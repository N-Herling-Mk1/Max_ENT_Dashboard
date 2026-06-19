/* abcd_panel.js — ABCD stats + settings. Self-contained: pulls its own
   score stats and config, writes thresholds back via /api/config. */
window.ABCDPanel = (function () {
  const f = (v, n = 3) => (v === null || v === undefined || Number.isNaN(v)) ? '—' : (+v).toFixed(n);

  function statRows(stats) {
    const order = [
      ['barrel', 'scoreNN1b', 'NN1 · barrel x'],
      ['barrel', 'scoreNN2b', 'NN2 · barrel y'],
      ['endcap', 'scoreNN1e', 'NN1 · endcap x'],
      ['endcap', 'scoreNN2e', 'NN2 · endcap y'],
    ];
    return order.map(([reg, col, lbl]) => {
      const o = (stats[reg] || {})[col];
      if (!o) return '';
      return '<tr><td>' + lbl + '</td><td class="num">' + f(o.min) +
        '</td><td class="num">' + f(o.median) + '</td><td class="num">' + f(o.max) + '</td></tr>';
    }).join('');
  }

  function inputRow(id, label, val) {
    return '<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted)">' +
      '<span style="width:74px">' + label + '</span>' +
      '<input id="' + id + '" type="number" step="0.01" min="0" max="1" value="' + val +
      '" style="width:72px;background:#0c1018;border:1px solid var(--line2);color:var(--cyan);' +
      'font-family:Share Tech Mono,monospace;padding:4px 6px;border-radius:4px"></label>';
  }

  async function mount(el) {
    let stats = {}, cfg = { cuts: { barrel: [0.7, 0.7], endcap: [0.8, 0.8] } };
    try {
      stats = (await (await fetch('/api/score_stats')).json()).data || {};
      cfg = (await (await fetch('/api/config')).json()).data || cfg;
    } catch (e) {}
    const b = cfg.cuts.barrel, e = cfg.cuts.endcap;
    el.innerHTML =
      '<div class="ph"><span class="dot"></span><h2>ABCD &mdash; settings</h2></div>' +
      '<div class="muted" style="font-size:11px;margin-bottom:6px">NN score range (background)</div>' +
      '<table style="width:100%;font-size:11px;margin-bottom:10px"><thead><tr>' +
      '<th style="text-align:left">score</th><th class="num">min</th><th class="num">median</th><th class="num">max</th>' +
      '</tr></thead><tbody>' + statRows(stats) + '</tbody></table>' +
      '<div class="muted" style="font-size:11px;margin-bottom:6px">cut thresholds (region A = both &gt; cut)</div>' +
      '<div style="display:flex;flex-direction:column;gap:6px">' +
      inputRow('bx', 'barrel x', b[0]) + inputRow('by', 'barrel y', b[1]) +
      inputRow('ex', 'endcap x', e[0]) + inputRow('ey', 'endcap y', e[1]) +
      '</div>' +
      '<button id="abcd-apply" class="btn-ghost" style="margin-top:10px;width:100%">save thresholds</button>' +
      '<div id="abcd-msg" class="muted" style="font-size:10px;margin-top:6px;text-align:center"></div>';

    function setMode(m){
      const sweep = (m === 'sweep');
      ['bx','by','ex','ey'].forEach(id => { const i = el.querySelector('#'+id); if (i) i.disabled = sweep; });
      const ap = el.querySelector('#abcd-apply'); if (ap) ap.disabled = sweep;
      const msg = el.querySelector('#abcd-msg');
      if (msg) msg.textContent = sweep ? 'thresholds inactive · sweep sets the cut' : '';
      el.style.opacity = sweep ? '0.55' : '1';
    }
    document.addEventListener('hx-mode', e => setMode(e.detail));

    el.querySelector('#abcd-apply').onclick = async () => {
      const g = id => parseFloat(el.querySelector('#' + id).value);
      const patch = { cuts: { barrel: [g('bx'), g('by')], endcap: [g('ex'), g('ey')] } };
      try {
        await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
        el.querySelector('#abcd-msg').textContent = 'saved · press RUN to apply';
      } catch (e) { el.querySelector('#abcd-msg').textContent = 'save failed'; }
    };
  }
  return { mount };
})();

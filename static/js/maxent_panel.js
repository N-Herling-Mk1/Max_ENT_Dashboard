/* maxent_panel.js — MaxEnt settings (tau). Self-contained: reads/writes
   tau_pct via /api/config; onRun() fills the per-region tau readout. */
window.MaxEntPanel = (function () {
  let root;

  async function mount(el) {
    root = el;
    let cfg = { tau_pct: 95 };
    try { cfg = (await (await fetch('/api/config')).json()).data || cfg; } catch (e) {}
    el.innerHTML =
      '<div class="ph"><span class="dot"></span><h2>MaxEnt &mdash; settings</h2></div>' +
      '<label style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--muted)">' +
      '<span style="width:54px">&tau; pct</span>' +
      '<input id="tau-pct" type="range" min="80" max="99.5" step="0.5" value="' + cfg.tau_pct + '" style="flex:1">' +
      '<span id="tau-pct-out" style="width:38px;text-align:right;font-family:Share Tech Mono,monospace;color:var(--cyan)">' +
      (+cfg.tau_pct).toFixed(1) + '</span></label>' +
      '<div class="muted" style="font-size:10px;margin-top:4px">surprise quantile that defines the MaxEnt anomaly threshold &tau;.</div>' +
      '<button id="tau-apply" class="btn-ghost" style="margin-top:10px;width:100%">save &tau;</button>' +
      '<div id="tau-msg" class="muted" style="font-size:10px;margin-top:6px;text-align:center"></div>' +
      '<div id="tau-display" class="muted" style="font-size:11px;margin-top:10px;border-top:1px solid var(--line2);padding-top:8px;line-height:1.7">τ values appear after RUN</div>';

    const slider = el.querySelector('#tau-pct'), out = el.querySelector('#tau-pct-out');
    slider.oninput = () => { out.textContent = (+slider.value).toFixed(1); };
    el.querySelector('#tau-apply').onclick = async () => {
      try {
        await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tau_pct: parseFloat(slider.value) }) });
        el.querySelector('#tau-msg').textContent = 'saved · press RUN to apply';
      } catch (e) { el.querySelector('#tau-msg').textContent = 'save failed'; }
    };
  }

  function onRun(data) {
    if (!root) return;
    const m = data.maxent || {};
    const line = r => m[r] ? '<b style="color:var(--cyan)">' + r + '</b> · τ=' + m[r].tau.toFixed(1) +
      ' (P' + (+m[r].tau_pct).toFixed(0) + ') · S̄=' + m[r].S_bg_mean.toFixed(1) : '';
    root.querySelector('#tau-display').innerHTML = ['barrel', 'endcap'].map(line).filter(Boolean).join('<br>');
  }
  return { mount, onRun };
})();

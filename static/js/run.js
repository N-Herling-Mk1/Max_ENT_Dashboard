/* run.js — mode toggle [single | sweep] + RUN. Emits the chosen mode to
   onRun(mode); broadcasts 'hx-mode' so the ABCD panel can disable its
   thresholds in sweep mode (where a single cut is meaningless). */
window.RunPanel = (function () {
  let mode = 'single';
  function mount(el, onRun) {
    el.innerHTML =
      '<div class="ph"><span class="dot"></span><h2>run</h2></div>' +
      '<div class="modeseg" id="modeseg">' +
        '<button data-m="single" class="mseg on">single analysis</button>' +
        '<button data-m="sweep" class="mseg">sweep</button>' +
      '</div>' +
      '<button id="hx-run" class="btn-primary" style="width:100%;justify-content:center">&#9656; RUN ANALYSIS</button>' +
      '<div id="hx-run-status" class="muted" style="font-size:11px;margin-top:8px;text-align:center">idle · single mode</div>';

    const btn = el.querySelector('#hx-run');
    const st = el.querySelector('#hx-run-status');

    el.querySelectorAll('.mseg').forEach(b => {
      b.onclick = () => {
        mode = b.dataset.m;
        el.querySelectorAll('.mseg').forEach(x => x.classList.toggle('on', x === b));
        st.textContent = 'idle · ' + (mode === 'single' ? 'single mode' : 'sweep mode');
        document.dispatchEvent(new CustomEvent('hx-mode', { detail: mode }));
      };
    });

    btn.onclick = async () => {
      btn.disabled = true;
      st.innerHTML = '<span class="spin"></span> running ' + mode + ' …';
      try { await onRun(mode); st.textContent = 'done · ' + mode + ' · ' + new Date().toLocaleTimeString(); }
      catch (e) { st.textContent = 'error: ' + e; }
      btn.disabled = false;
    };
  }
  return { mount };
})();

/* terminal.js — faux engine console. Boots with a typewriter animation,
   reports what will be graphed, then *generates* the % match / κ metric
   reference, and logs each run. */
window.TerminalPanel = (function () {
  let body;
  function line(html, cls) {
    const d = document.createElement('div');
    d.className = 'tl ' + (cls || '');
    d.innerHTML = html;
    body.appendChild(d); body.scrollTop = body.scrollHeight;
    return d;
  }
  function type(text, cls, done) {
    const d = document.createElement('div');
    d.className = 'tl ' + (cls || '');
    body.appendChild(d);
    let i = 0;
    (function step() {
      d.textContent = text.slice(0, i);
      body.scrollTop = body.scrollHeight;
      if (i++ <= text.length) setTimeout(step, 7);
      else if (done) done();
    })();
  }
  async function mount(el) {
    el.innerHTML =
      '<div class="term"><div class="term-head"><span class="dot"></span>HELIX // engine console</div>' +
      '<div class="term-body" id="term-body"></div></div>';
    body = el.querySelector('#term-body');
    const boot = ['> initializing HELIX engine …', '> loading background sample …'];
    let k = 0;
    (function next() { if (k < boot.length) type(boot[k++], 'tcyan', next); else info(); })();
  }
  async function info() {
    try {
      const s = (await (await fetch('/api/score_stats')).json()).data || {};
      const bn = (s.barrel && s.barrel.scoreNN1b && s.barrel.scoreNN1b.n) || '?';
      const en = (s.endcap && s.endcap.scoreNN1e && s.endcap.scoreNN1e.n) || '?';
      line('> background ready · <span class="tgrn">barrel N=' + bn + '</span> · <span class="tgrn">endcap N=' + en + '</span>');
      line('> plane · scoreNN1 × scoreNN2 per region');
      line('> sweep grid · 25×25 = <b>625</b> cuts × 2 regions = <b>1250</b> overlaps');
      line('> MaxEnt flag · PMI top-decile (cut-independent)');
      line('<span class="tmut">ready · choose a mode and press RUN</span><span class="cursor"></span>');
    } catch (e) { line('<span class="tmut">engine offline · press RUN to retry</span>'); }
  }
  function runStart(mode, cuts) {
    const last = body.querySelector('.cursor'); if (last) last.remove();
    if (mode === 'single')
      line('> <span class="tcyan">[single]</span> running at cut · barrel ' + cuts.barrel.join('/') + ' · endcap ' + cuts.endcap.join('/') + ' …');
    else
      line('> <span class="tcyan">[sweep]</span> evaluating 1250 overlaps across the cut grid …');
  }
  function runDone(summary) { line('> <span class="tgrn">done</span> · ' + summary + '<span class="cursor"></span>'); }
  function fail(msg) { line('> <span style="color:#e05a5a">error</span> · ' + msg); }
  return { mount, runStart, runDone, fail, line };
})();

/* dashboard.js — orchestrator. Terminal in the main area; mode drives RUN:
   single -> /api/run -> Results.renderSingle ; sweep -> /api/sweep -> SweepPanel. */
document.addEventListener('DOMContentLoaded', function () {
  const resultsMount = document.getElementById('results-mount');
  TerminalPanel.mount(document.getElementById('terminal-mount'));
  ABCDPanel.mount(document.getElementById('abcd-mount'));
  MaxEntPanel.mount(document.getElementById('maxent-mount'));

  RunPanel.mount(document.getElementById('run-mount'), async function (mode) {
    const cfg = (await (await fetch('/api/config')).json()).data || { cuts: { barrel: [0, 0], endcap: [0, 0] } };
    TerminalPanel.runStart(mode, cfg.cuts);
    try {
      if (mode === 'single') {
        const j = (await (await fetch('/api/run', { method: 'POST' })).json()).data;
        Results.renderSingle(resultsMount, j);
        MaxEntPanel.onRun(j);
        const b = j.full['barrel:absolute'], e = j.full['endcap:absolute'];
        TerminalPanel.runDone('barrel ' + (b ? b.agreement.raw.toFixed(1) : '?') + '% · endcap ' + (e ? e.agreement.raw.toFixed(1) : '?') + '% match');
      } else {
        const sw = (await (await fetch('/api/sweep?grid=25')).json()).data || {};
        SweepPanel.render(resultsMount, sw, { cuts: cfg.cuts });
        TerminalPanel.runDone('sweep ready · click a heatmap cell to set the cut');
      }
    } catch (e) { TerminalPanel.fail(String(e)); throw e; }
  });
});

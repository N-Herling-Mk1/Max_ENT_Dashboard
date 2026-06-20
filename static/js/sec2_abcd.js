/* ════════════════════════════════════════════════════════════════════
   HELIX · Section II · [ABCD] screen — live diagnostic graphs + card.
   On the real data24 VR plane:
     · Fig 8b  signal-MC plane (normalised)   · Fig 10b background data plane
     · Fig 1   factorization schematic (SVG)  · Fig 2  p-value vs contamination
     · Figs 5/7/8/12  rejection vs r          · "inject signal in A" test
     · dashboard metric card (match% / κ / N_A / shared U / co-info /
       I(X,Y;L) / per-axis I + agreement 2×2)
   Physics-plot convention: viridis / dark canvas.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const fmt = (v, d) => (v == null || !isFinite(v)) ? "\u2014" : Number(v).toFixed(d == null ? 3 : d);

  const VIRIDIS = [
    [68,1,84],[72,40,120],[62,74,137],[49,104,142],[38,130,142],
    [31,158,137],[53,183,121],[110,206,88],[181,222,43],[253,231,37]];
  function viridis(t) {
    t = Math.max(0, Math.min(1, t));
    const x = t * (VIRIDIS.length - 1), i = Math.floor(x), f = x - i;
    const a = VIRIDIS[i], b = VIRIDIS[Math.min(i + 1, VIRIDIS.length - 1)];
    return `rgb(${Math.round(a[0]+(b[0]-a[0])*f)},${Math.round(a[1]+(b[1]-a[1])*f)},${Math.round(a[2]+(b[2]-a[2])*f)})`;
  }

  // shared axis helpers (fonts bumped) --------------------------------
  const PAD = { l: 58, r: 18, t: 18, b: 46 };
  const BG = "#0d0f15", PANEL = "#11131b", AXIS = "#3a3d49",
        GRID = "#1d2029", FG = "#c8ccd6", FAINT = "#7a7f8c";
  const FA = "14px 'Share Tech Mono',monospace";   // axis labels
  const FT = "12px 'Share Tech Mono',monospace";   // ticks
  function frame(ctx, W, H, xlab, ylab) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = PANEL;
    ctx.fillRect(PAD.l, PAD.t, W - PAD.l - PAD.r, H - PAD.t - PAD.b);
    ctx.strokeStyle = AXIS; ctx.lineWidth = 1;
    ctx.strokeRect(PAD.l, PAD.t, W - PAD.l - PAD.r, H - PAD.t - PAD.b);
    ctx.fillStyle = FG; ctx.font = FA; ctx.textAlign = "center";
    ctx.fillText(xlab, PAD.l + (W - PAD.l - PAD.r) / 2, H - 10);
    ctx.save();
    ctx.translate(16, PAD.t + (H - PAD.t - PAD.b) / 2);
    ctx.rotate(-Math.PI / 2); ctx.fillText(ylab, 0, 0); ctx.restore();
  }
  const sx = (W) => (t) => PAD.l + t * (W - PAD.l - PAD.r);
  const syL = (H) => (t) => H - PAD.b - t * (H - PAD.t - PAD.b);

  function regionLetters(ctx, W, H, cx, cy) {
    const X = sx(W), Y = syL(H);
    ctx.strokeStyle = "#e23"; ctx.lineWidth = 1.8; ctx.setLineDash([6, 3]);
    ctx.beginPath(); ctx.moveTo(X(cx), PAD.t); ctx.lineTo(X(cx), H - PAD.b);
    ctx.moveTo(PAD.l, Y(cy)); ctx.lineTo(W - PAD.r, Y(cy)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = "bold 19px Georgia,serif"; ctx.textAlign = "center";
    const lab = (t, lx, ly) => {
      ctx.strokeStyle = "rgba(0,0,0,.7)"; ctx.lineWidth = 3.5;
      ctx.strokeText(t, lx, ly); ctx.fillStyle = "#fff"; ctx.fillText(t, lx, ly); };
    lab("A", X((cx + 1) / 2), Y((cy + 1) / 2));
    lab("B", X((cx + 1) / 2), Y(cy / 2));
    lab("C", X(cx / 2), Y((cy + 1) / 2));
    lab("D", X(cx / 2), Y(cy / 2));
    ctx.fillStyle = FAINT; ctx.font = FT;
    for (let k = 0; k <= 5; k++) {
      const t = k / 5;
      ctx.textAlign = "center"; ctx.fillText(t.toFixed(1), X(t), H - PAD.b + 16);
      ctx.textAlign = "right"; ctx.fillText(t.toFixed(1), PAD.l - 7, Y(t) + 4);
    }
  }

  // ─── (1a) SIGNAL PLANE  (Fig 8b, normalised) ─────────────────────────
  function drawSignalPlane(d) {
    const cv = $("#g-splane"); if (!cv || d.error) { if (d && d.error) $("#splane-cells").textContent = d.error; return; }
    const W = cv.width, H = cv.height, ctx = cv.getContext("2d");
    frame(ctx, W, H, d.axes.x + "  (NN1)", d.axes.y + "  (NN2)");
    const n = d.bins, mx = Math.max(1e-9, d.max_norm);
    const cw = (W - PAD.l - PAD.r) / n, ch = (H - PAD.t - PAD.b) / n;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const v = d.norm[r][c]; if (v <= 0) continue;
      ctx.fillStyle = viridis(Math.sqrt(v / mx));     // linear-ish, normalised
      ctx.fillRect(PAD.l + c * cw, H - PAD.b - (r + 1) * ch, cw + 0.6, ch + 0.6);
    }
    regionLetters(ctx, W, H, d.cut[0], d.cut[1]);
    $("#splane-tag").textContent = "· " + d.signal + " · " + d.N_sig + " evt";
    const f = d.frac || {};
    $("#splane-cells").innerHTML =
      `A=<b>${d.cells.A}</b> B=<b>${d.cells.B}</b> C=<b>${d.cells.C}</b> D=<b>${d.cells.D}</b>` +
      (f.A != null ? ` &nbsp;&middot;&nbsp; f_A=<b>${fmt(f.A,3)}</b> (signal localises in A)` : "");
  }

  // ─── (1b) BACKGROUND PLANE  (Fig 10b, log counts) ────────────────────
  function drawPlane(d) {
    const cv = $("#g-plane"); if (!cv) return;
    const W = cv.width, H = cv.height, ctx = cv.getContext("2d");
    frame(ctx, W, H, d.axes.x + "  (NN1)", d.axes.y + "  (NN2)");
    const n = d.bins, mx = Math.max(1, d.max_count);
    const cw = (W - PAD.l - PAD.r) / n, ch = (H - PAD.t - PAD.b) / n;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const v = d.counts[r][c]; if (v <= 0) continue;
      ctx.fillStyle = viridis(Math.log1p(v) / Math.log1p(mx));
      ctx.fillRect(PAD.l + c * cw, H - PAD.b - (r + 1) * ch, cw + 0.6, ch + 0.6);
    }
    regionLetters(ctx, W, H, d.cut[0], d.cut[1]);
    $("#plane-cells").innerHTML =
      `A=<b>${d.cells.A}</b> B=<b>${d.cells.B}</b> C=<b>${d.cells.C}</b> D=<b>${d.cells.D}</b>`;
    $("#plane-pm").innerHTML =
      `NN1 spikes: P(=0)=<b>${fmt(100*d.point_mass.nn1_eq0,1)}%</b>, ` +
      `P(=1)=<b>${fmt(100*d.point_mass.nn1_eq1,2)}%</b> &mdash; why KDE is forbidden`;
  }

  // ─── (2) p-VALUE — faithful ABCDisCo Fig 2 (two log-log panels) ───────
  // Generic log-x / log-y panel.
  function logLog(ctx, ox, oy, w, h, xlog, ylog, xlab, ylab) {
    ctx.fillStyle = PANEL; ctx.fillRect(ox, oy, w, h);
    ctx.strokeStyle = AXIS; ctx.lineWidth = 1; ctx.strokeRect(ox, oy, w, h);
    const X = (v) => ox + (Math.log10(v) - xlog[0]) / (xlog[1] - xlog[0]) * w;
    const Y = (v) => oy + h - (Math.log10(v) - ylog[0]) / (ylog[1] - ylog[0]) * h;
    // decade grid
    ctx.font = FT; ctx.fillStyle = FAINT;
    for (let e = Math.ceil(ylog[0]); e <= ylog[1]; e++) {
      const y = Y(Math.pow(10, e));
      ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(ox, y); ctx.lineTo(ox + w, y); ctx.stroke();
      ctx.textAlign = "right"; ctx.fillText(e === -5 ? "1e-5" : (e === 0 ? "1" : "1e" + e), ox - 6, y + 4);
    }
    for (let e = Math.ceil(xlog[0]); e <= Math.floor(xlog[1]); e++) {
      const x = X(Math.pow(10, e));
      ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(x, oy); ctx.lineTo(x, oy + h); ctx.stroke();
      ctx.textAlign = "center"; ctx.fillStyle = FAINT;
      ctx.fillText(e === 0 ? "1" : (e >= 1 && e <= 4 ? Math.pow(10, e).toString() : "1e" + e), x, oy + h + 16);
    }
    ctx.fillStyle = FG; ctx.font = FA; ctx.textAlign = "center";
    ctx.fillText(xlab, ox + w / 2, oy + h + 38);
    ctx.save(); ctx.translate(ox - 42, oy + h / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText(ylab, 0, 0); ctx.restore();
    return { X, Y };
  }

  function plotCurve(ctx, M, xs, ps, col, dash) {
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash(dash || []);
    ctx.beginPath(); let started = false;
    for (let i = 0; i < xs.length; i++) {
      const p = ps[i]; if (p == null || !isFinite(p)) continue;
      const px = M.X(xs[i]), py = M.Y(p);
      started ? ctx.lineTo(px, py) : (ctx.moveTo(px, py), started = true);
    }
    ctx.stroke(); ctx.setLineDash([]);
  }

  function sigmaLines(ctx, M, ox, w, lines) {
    ctx.font = FT; ctx.textAlign = "left";
    lines.forEach(s => {
      if (s.p <= 1e-5) return;
      const y = M.Y(s.p);
      ctx.strokeStyle = "#56606e"; ctx.setLineDash([2, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ox, y); ctx.lineTo(ox + w, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "#8a94a2"; ctx.fillText(s.z + "\u03c3", ox + w - 22, y - 4);
    });
  }

  function drawPvalueFig2(d) {
    const cvL = $("#g-pval-left"), cvR = $("#g-pval-right");
    // LEFT panel
    if (cvL) {
      const W = cvL.width, H = cvL.height, ctx = cvL.getContext("2d");
      ctx.clearRect(0, 0, W, H); ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
      const ox = 56, oy = 16, w = W - ox - 14, h = H - oy - 50;
      const M = logLog(ctx, ox, oy, w, h, [-3, Math.log10(3)], [-5, 0],
                       "Signal Fraction in Region A  (\u03b4_A)", "p-value  (CL_{s+b})");
      sigmaLines(ctx, M, ox, w, d.sigma_lines);
      d.left.curves.forEach(c => plotCurve(ctx, M, d.left.dA, c.p, c.color, c.dash));
      // legends: colour=N_A, dash=r
      legend(ctx, ox + 10, oy + 12, [
        ["N_A=100", "#d23b3b", null], ["N_A=1000", "#3a6fd6", null], ["N_A=10000", "#2a9d4a", null]]);
      legend(ctx, ox + 10, oy + 64, [
        ["r=0", "#c8ccd6", []], ["r=0.4", "#c8ccd6", [2, 3]], ["r=0.6", "#c8ccd6", [7, 4]]], true);
      tag(ctx, ox + w - 12, oy + 12, ["N_{B,C,D}=\u221e", "\u03c3_syst=0%"]);
    }
    // RIGHT panel
    if (cvR) {
      const W = cvR.width, H = cvR.height, ctx = cvR.getContext("2d");
      ctx.clearRect(0, 0, W, H); ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
      const ox = 56, oy = 16, w = W - ox - 14, h = H - oy - 50;
      const M = logLog(ctx, ox, oy, w, h, [2, 4], [-5, 0],
                       "Number of events in region A", "p-value  (CL_{s+b})");
      sigmaLines(ctx, M, ox, w, d.sigma_lines);
      d.right.curves.forEach(c => plotCurve(ctx, M, d.right.NA, c.p, c.color, c.dash));
      legend(ctx, ox + 10, oy + 12, [
        ["r=0", "#d23b3b", null], ["r=0.4", "#3a6fd6", null], ["r=0.6", "#2a9d4a", null]]);
      legend(ctx, ox + 10, oy + 64, [
        ["\u03c3_syst=0%", "#c8ccd6", []], ["\u03c3_syst=1%", "#c8ccd6", [7, 4]], ["\u03c3_syst=3%", "#c8ccd6", [2, 3]]], true);
      tag(ctx, ox + w - 12, oy + 12, ["N_{B,C,D}=\u221e", "\u03b4_A=" + Math.round(d.right.dA_fixed * 100) + "%"]);
    }
    $("#pval-note").innerHTML =
      `Faithful ABCDisCo Fig 2. <b>Left</b>: p vs signal fraction \u03b4_A, family = N_A\u00d7r. ` +
      `<b>Right</b>: p vs events-in-A, family = r\u00d7\u03c3_syst at \u03b4_A=<b>${Math.round(d.right.dA_fixed*100)}%</b>. ` +
      `p = 1\u2212\u03a6(Z_Asimov), m = N_A(1+r\u03b4_A)/(1+\u03b4_A) (Eq 2.10). ` +
      `r=0,N_A=1000,\u03b4_A=10% \u2192 p=<b>0.0015</b> (matches the paper's worked example).`;
  }

  function legend(ctx, x, y, rows, dashMode) {
    ctx.font = FT; ctx.textAlign = "left";
    rows.forEach((r, i) => {
      const yy = y + i * 15;
      ctx.strokeStyle = r[1]; ctx.lineWidth = 2.4; ctx.setLineDash(dashMode ? (r[2] || []) : []);
      ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + 20, yy); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "#c8ccd6"; ctx.fillText(r[0], x + 25, yy + 4);
    });
  }
  function tag(ctx, x, y, lines) {
    ctx.font = FT; ctx.textAlign = "right"; ctx.fillStyle = "#9aa0ad";
    lines.forEach((t, i) => ctx.fillText(t, x, y + 4 + i * 15));
  }

  // ─── (3) REJECTION vs r  (Figs 5/7/8/12) ─────────────────────────────
  function drawRejR(d) {
    const cv = $("#g-rejr"); if (!cv) return;
    const W = cv.width, H = cv.height, ctx = cv.getContext("2d");
    frame(ctx, W, H, "normalized signal contamination  r", "background rejection  1/\u03b5_b");
    const pts = d.points.concat(d.operating ? [Object.assign({ op: 1 }, d.operating)] : []);
    if (!pts.length) { ctx.fillStyle = FAINT; ctx.textAlign = "center"; ctx.font = FA;
      ctx.fillText("no cut-points pass the closure+efficiency filter", W / 2, H / 2); return; }
    const rs = pts.map(p => p.r).filter(isFinite), rejs = pts.map(p => p.rej).filter(isFinite);
    const rMax = Math.max(1.2, Math.max.apply(null, rs) * 1.05), rMin = Math.min(0, Math.min.apply(null, rs));
    const jMax = Math.max.apply(null, rejs) * 1.08, jMin = 0;
    const X = (r) => sx(W)((r - rMin) / (rMax - rMin)), Y = (j) => syL(H)((j - jMin) / (jMax - jMin));
    [[0.1, "#1f9d57", "r=0.1 (target)"], [1.0, "#c2384e", "r=1 absorption"]].forEach(([rv, col, t]) => {
      if (rv < rMin || rv > rMax) return;
      ctx.strokeStyle = col; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(X(rv), PAD.t); ctx.lineTo(X(rv), H - PAD.b); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = col; ctx.font = FT;
      ctx.save(); ctx.translate(X(rv) + 4, PAD.t + 72); ctx.rotate(Math.PI / 2);
      ctx.textAlign = "left"; ctx.fillText(t, 0, 0); ctx.restore();
    });
    pts.forEach(p => {
      if (!isFinite(p.r) || !isFinite(p.rej)) return;
      const px = X(p.r), py = Y(p.rej);
      if (p.op) {
        ctx.fillStyle = "#fff"; ctx.font = "bold 20px Georgia"; ctx.textAlign = "center";
        ctx.fillText("\u2605", px, py + 6);
        ctx.font = FT; ctx.fillText("HELIX cut", px, py - 13);
      } else {
        ctx.fillStyle = viridis(1 - Math.min(1, p.closure / d.closure_tol));
        ctx.beginPath(); ctx.arc(px, py, 3.6, 0, 7); ctx.fill();
      }
    });
    ctx.fillStyle = FAINT; ctx.font = FT;
    for (let k = 0; k <= 5; k++) {
      const t = k / 5; ctx.textAlign = "center";
      ctx.fillText((rMin + t * (rMax - rMin)).toFixed(2), sx(W)(t), H - PAD.b + 16);
      ctx.textAlign = "right"; ctx.fillText(Math.round(jMin + t * (jMax - jMin)), PAD.l - 7, syL(H)(t) + 4);
    }
    const op = d.operating || {};
    $("#rejr-note").innerHTML =
      `${d.signal}: <b>${d.points.length}</b> alt-cuts pass closure\u2264${d.closure_tol} ` +
      `& \u03b5_s\u2208[${d.eff_band[0]},${d.eff_band[1]}]. HELIX operating cut \u2605 ` +
      `r=<b>${fmt(op.r,3)}</b>, rejection=<b>${fmt(op.rej,0)}</b>, \u03b5_s=<b>${fmt(op.eps_s,3)}</b>. ` +
      `Color = closure (bright=better). Up-and-left is the goal.`;
  }

  // ─── (4) INJECTION CURVE ─────────────────────────────────────────────
  function drawInject(d) {
    const cv = $("#g-inject"); if (!cv) return;
    const W = cv.width, H = cv.height, ctx = cv.getContext("2d");
    frame(ctx, W, H, "injected signal  N_S", "events in region A");
    const X = sx(W), Y = syL(H);
    const xmax = d.NS[d.NS.length - 1] || 1;
    const all = d.obs.concat(d.pred.filter(isFinite));
    const ymax = Math.max.apply(null, all) * 1.06;
    const line = (arr, col, w) => {
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); let started = false;
      d.NS.forEach((ns, i) => {
        const v = arr[i]; if (v == null || !isFinite(v)) return;
        const px = X(ns / xmax), py = Y(v / ymax);
        started ? ctx.lineTo(px, py) : (ctx.moveTo(px, py), started = true);
      });
      ctx.stroke();
    };
    line(d.obs, "#16a394", 2.6); line(d.pred, "#c2691a", 2.6);
    ctx.font = FT; ctx.textAlign = "left";
    ctx.fillStyle = "#16a394"; ctx.fillText("\u25fc  N_A observed", PAD.l + 10, PAD.t + 18);
    ctx.fillStyle = "#c2691a"; ctx.fillText("\u25fc  N_A ABCD-predicted", PAD.l + 10, PAD.t + 36);
    ctx.fillStyle = FAINT;
    for (let k = 0; k <= 5; k++) {
      const t = k / 5; ctx.textAlign = "center";
      ctx.fillText(Math.round(t * xmax), X(t), H - PAD.b + 16);
      ctx.textAlign = "right"; ctx.fillText(Math.round(t * ymax), PAD.l - 7, Y(t) + 4);
    }
    $("#inject-note").innerHTML =
      `${d.signal}: occupancy f = (A ${fmt(d.f.A,2)}, B ${fmt(d.f.B,2)}, C ${fmt(d.f.C,2)}, D ${fmt(d.f.D,2)}). ` +
      `r=<b>${fmt(d.r,3)}</b>. ` + (d.absorbs
        ? `<b style="color:#c2384e">r\u22651 \u2014 prediction outruns observation: injected signal is absorbed, no excess opens.</b>`
        : `<b style="color:#1f9d57">r&lt;1 \u2014 the curves separate: an injected excess survives.</b>`);
  }

  // ─── DASHBOARD METRIC CARD ───────────────────────────────────────────
  function renderCard(d) {
    const el = $("#abcd-card"); if (!el) return;
    if (d.error) { el.innerHTML = `<div class="dcard"><div style="color:#c2384e">err: ${d.error}</div></div>`; return; }
    const m = d.match, c = d.cells, ag = d.agreement, U = d.shared_U, li = d.label_info || {};
    const co = li.coinfo;
    const coTag = (co == null) ? "" :
      (co > 0 ? '<span class="tag tag-red">redundant</span>'
              : co < 0 ? '<span class="tag tag-grn">synergistic</span>'
                       : '<span class="tag tag-amb">independent</span>');
    const row = (k, v) => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
    const left =
      `<div class="dleft">
        <div class="eyebrow">${d.region.toUpperCase()}</div>
        <div class="headline">${fmt(m.raw,1)}<small style="font-size:34px">%</small></div>
        <div class="hsub">match &middot; cut x=<b>${fmt(d.cut[0],2)}</b> y=<b>${fmt(d.cut[1],2)}</b></div>
        <div class="rows">
          ${row("&kappa;", `${fmt(m.kappa,3)} <small>${m.label}</small>`)}
          ${row("N_A (obs bg)", `<b>${c.A}</b> <small>B ${c.B} / C ${c.C} / D ${c.D}</small>`)}
          ${row("shared U &middot; I(NN1;NN2)", `${fmt(U.frac_pct,2)}% <small>${fmt(U.mbits,2)} mbits</small>`)}
          ${row("co-info", `${coTag}${co==null?"\u2014":fmt(co,4)}`)}
          ${row("I(X,Y;L)", `${li.sep==null?"\u2014":fmt(li.sep,4)} <small>bits</small>`)}
          ${row("I(X;L) &middot; I(Y;L)", `${li.ixl==null?"\u2014":fmt(li.ixl,3)} &middot; ${li.iyl==null?"\u2014":fmt(li.iyl,3)}`)}
        </div>
      </div>`;
    const quad = (cls, lab, n) => `<div class="quad ${cls}"><div class="ql">${lab}</div><div class="qv">${n}</div></div>`;
    const right =
      `<div class="dmatrix">
        <div class="mtitle">agreement matrix<br><b>ABCD&cap;A</b> (rows) &times; <b>MaxEnt flag</b> (cols)</div>
        <div class="dgrid">
          ${quad("both","both",ag.both)}
          ${quad("abcd","ABCD-only",ag.abcd_only)}
          ${quad("maxent","MaxEnt-only",ag.maxent_only)}
          ${quad("neither","neither",ag.neither)}
        </div>
      </div>`;
    el.innerHTML = `<div class="dcard">${left}${right}</div>`;
    $("#abcd-cutpill").innerHTML = "cut &middot; (" + fmt(d.cut[0],2) + ", " + fmt(d.cut[1],2) + ") &middot; N_bg " + d.N_bg;
  }

  // ─── orchestration ───────────────────────────────────────────────────
  function get(url) { return fetch(url).then(r => r.json()); }
  function fail(sel, e) { const n = $(sel); if (n) n.innerHTML = `<span style="color:#c2384e">err: ${e}</span>`; }

  window.__drawPlane = drawPlane;
  window.__drawSignalPlane = drawSignalPlane;
  window.__drawPval = drawPvalueFig2;
  window.__drawRejR = drawRejR;
  window.__drawInject = drawInject;
  window.__renderCard = renderCard;

  window.SEC2_ABCD = {
    region: "endcap", signal: "mS35", bins: 20, dA: 0.10,
    reloadPlanes() {
      const R = this.region, S = this.signal, B = this.bins;
      get(`/api/sec2_splane?region=${R}&signal=${S}&bins=${B}`)
        .then(j => j.data ? drawSignalPlane(j.data) : fail("#splane-cells", j.error)).catch(e => fail("#splane-cells", e));
      get(`/api/sec2_plane?region=${R}&bins=${B}`)
        .then(j => j.data ? drawPlane(j.data) : fail("#plane-cells", j.error)).catch(e => fail("#plane-cells", e));
    },
    loadAll() {
      const R = this.region, S = this.signal;
      this.reloadPlanes();
      get(`/api/sec2_card?region=${R}&signal=${S}`)
        .then(j => j.data ? renderCard(j.data) : fail("#abcd-card", j.error)).catch(e => fail("#abcd-card", e));
      get(`/api/sec2_pvalue?dA=${this.dA}`)
        .then(j => j.data ? drawPvalueFig2(j.data) : fail("#pval-note", j.error)).catch(e => fail("#pval-note", e));
      get(`/api/sec2_rejr?region=${R}&signal=${S}`)
        .then(j => j.data ? drawRejR(j.data) : fail("#rejr-note", j.error)).catch(e => fail("#rejr-note", e));
      get(`/api/sec2_inject?region=${R}&signal=${S}`)
        .then(j => j.data ? drawInject(j.data) : fail("#inject-note", j.error)).catch(e => fail("#inject-note", e));
    }
  };
})();

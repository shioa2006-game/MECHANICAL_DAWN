/* MECHANICAL DAWN — input.js : keyboard, mouse and touch */
(function (root) {
  'use strict';
  const MD = root.MD;
  const IN = MD.Input = { mouse: { x: -1, y: -1, inside: false } };
  let H = {};

  const KEYS = {
    ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
    ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
  };

  IN.init = function (canvas, handlers) {
    H = handlers;

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (H.blocked && H.blocked()) {
        if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Space') H.screenKey && H.screenKey(e.code);
        return;
      }
      const d = KEYS[e.code];
      if (d) { e.preventDefault(); H.step(d[0], d[1], e.repeat); return; }
      switch (e.code) {
        case 'KeyR': H.returnHome(); break;
        case 'KeyB': H.toggleRelayMode(); break;
        case 'Space': e.preventDefault(); H.centerExplorer(); break;
        case 'KeyQ': case 'Minus': case 'NumpadSubtract': H.zoom(-1); break;
        case 'KeyE': case 'Equal': case 'NumpadAdd': case 'Semicolon': H.zoom(1); break;
        case 'KeyM': H.toggleSound(); break;
        case 'KeyH': H.showHelp(); break;
        case 'KeyF': H.cycleSpeed(); break;
        case 'Escape': H.escape(); break;
      }
    });

    // ---- mouse
    let down = null;
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 2) return;
      down = { x: e.clientX, y: e.clientY, cx: MD.Render.cam.x, cy: MD.Render.cam.y, drag: false };
    });
    window.addEventListener('mousemove', (e) => {
      IN.mouse.x = e.clientX; IN.mouse.y = e.clientY;
      IN.mouse.inside = e.target === canvas;
      if (down) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (!down.drag && Math.hypot(dx, dy) > 6) down.drag = true;
        if (down.drag) H.panTo(down.cx - dx / MD.Render.cam.zoom, down.cy - dy / MD.Render.cam.zoom);
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (down && !down.drag && e.target === canvas && e.button === 0) H.click(e.clientX, e.clientY, false);
      down = null;
    });
    canvas.addEventListener('mouseleave', () => { IN.mouse.inside = false; });
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); H.cancel(); });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      H.zoom(e.deltaY < 0 ? 1 : -1, e.clientX, e.clientY);
    }, { passive: false });

    // ---- touch: one finger = tap / pan, two fingers = pinch zoom
    let t0 = null, pinch = null;
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        const t = e.touches[0];
        t0 = { x: t.clientX, y: t.clientY, cx: MD.Render.cam.x, cy: MD.Render.cam.y, drag: false };
        IN.mouse.x = t.clientX; IN.mouse.y = t.clientY;
      } else if (e.touches.length === 2) {
        const [a, b] = e.touches;
        pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), acc: 0 };
        t0 = null;
      }
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (pinch && e.touches.length === 2) {
        const [a, b] = e.touches;
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (d / pinch.d > 1.25) { H.zoom(1); pinch.d = d; }
        else if (d / pinch.d < 0.8) { H.zoom(-1); pinch.d = d; }
        return;
      }
      if (t0 && e.touches.length === 1) {
        const t = e.touches[0];
        const dx = t.clientX - t0.x, dy = t.clientY - t0.y;
        if (!t0.drag && Math.hypot(dx, dy) > 10) t0.drag = true;
        if (t0.drag) H.panTo(t0.cx - dx / MD.Render.cam.zoom, t0.cy - dy / MD.Render.cam.zoom);
      }
    }, { passive: false });
    canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (t0 && !t0.drag && e.touches.length === 0) H.click(t0.x, t0.y, true);
      if (e.touches.length < 2) pinch = null;
      if (e.touches.length === 0) t0 = null;
    }, { passive: false });
  };
})(typeof window !== 'undefined' ? window : globalThis);

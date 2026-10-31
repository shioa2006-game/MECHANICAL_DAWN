/* MECHANICAL DAWN — util.js : small shared helpers (no DOM) */
(function (root) {
  'use strict';
  const MD = root.MD = root.MD || {};
  const U = MD.U = {};

  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // Deterministic hash -> [0,1). Used for visual variety and stable per-tile choices.
  U.hash = function (x, y, s) {
    let h = (x * 374761393 + y * 668265263 + (s || 0) * 982451653) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };

  U.easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  U.easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
  U.easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

  U.costText = function (cost) {
    if (!cost) return '';
    const parts = [];
    if (cost.scrap) parts.push('⚙' + cost.scrap);
    if (cost.crystal) parts.push('◆' + cost.crystal);
    return parts.join(' ');
  };

  U.canAfford = (res, cost) => !cost || ((res.scrap >= (cost.scrap || 0)) && (res.crystal >= (cost.crystal || 0)));

  U.pay = function (res, cost) {
    if (!cost) return;
    res.scrap -= cost.scrap || 0;
    res.crystal -= cost.crystal || 0;
  };

  U.fmtTime = function (sec) {
    sec = Math.max(0, Math.floor(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  };
})(typeof window !== 'undefined' ? window : globalThis);

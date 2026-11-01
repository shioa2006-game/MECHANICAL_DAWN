/* MECHANICAL DAWN — render.js : pixel world, lighting, fog, camera and effects */
(function (root) {
  'use strict';
  const MD = root.MD, U = MD.U;
  const RV = MD.Render = {};
  const TS = 16;
  const T = () => MD.G.T;

  let canvas, ctx, dpr = 1;
  let world, wctx, terrain, tctx, light, lctx, fog, fctx;
  let S = null;               // attached game state
  let terrainDirty = true, fogCount = -1;
  let blocks = null, windows = [];
  const disp = { sw: 0, ind: 0, nw: 0, core: 0 };
  const fx = {
    particles: [], texts: [], rings: [], marks: [], shake: 0,
    powerOn: new Map(), facPower: new Map(), highlight: null, ending: null,
  };
  RV.fx = fx;
  RV.cam = { x: 0, y: 0, zoom: 3 };

  const C = {
    void: '#04050a', street: '#1a1d2b', street2: '#1e2233', street3: '#161925', curb: '#272b3e', curb2: '#2f3449',
    line: '#2c3149', crack: '#111320', wall: '#121521', win: '#0b0d16',
    pad: '#232634', pad2: '#2a2e3e',
    rubble: ['#4a4444', '#5f5651', '#3a3434', '#6d6560', '#2c2828'], rebar: '#8a5340',
    canal: '#0a2a31', canal2: '#0f3d45', canalHi: '#1d6b70', bank: '#2b3040',
    oldDead: '#3a332f', oldDead2: '#4a423c', cableDark: '#5a3a14', cableMid: '#c77a22',
    corePlayer: '#ffb347', coreOld: '#ffe08a', plank: '#3f3226', plank2: '#54432f',
    winLit: ['#ffd27a', '#ffc35a', '#ffe3a3', '#ffb84d', '#fff1c9'],
  };
  const ROOFS = ['#2b3149', '#2f2b44', '#28354a', '#34303f', '#2b3042', '#30344a'];

  // ---------------------------------------------------------------- setup

  RV.init = function (cv) {
    canvas = cv;
    ctx = canvas.getContext('2d');
    MD.Sprites.init();
    RV.resize();
  };

  RV.resize = function () {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
  };

  RV.attach = function (s) {
    S = s;
    const W = s.W * TS, H = s.H * TS;
    world = mk(W, H); wctx = world.getContext('2d');
    terrain = mk(W, H); tctx = terrain.getContext('2d');
    light = mk(W / 2, H / 2); lctx = light.getContext('2d');
    fog = mk(s.W, s.H); fctx = fog.getContext('2d');
    terrainDirty = true; fogCount = -1;
    fx.particles.length = 0; fx.texts.length = 0; fx.rings.length = 0; fx.marks.length = 0;
    fx.powerOn.clear(); fx.facPower.clear(); fx.ending = null; fx.highlight = null;
    for (const k in disp) disp[k] = s.districtLight[k];
    analyseBuildings(s);
    const e = s.ex;
    RV.cam.x = (e.fx + 0.5) * TS; RV.cam.y = (e.fy + 0.5) * TS;
  };

  function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  // ---------------------------------------------------------------- coordinates

  RV.worldSize = () => (S ? { w: S.W * TS, h: S.H * TS } : { w: 1, h: 1 });
  RV.viewSize = () => ({ w: canvas.width / dpr, h: canvas.height / dpr });

  RV.screenToWorld = function (sx, sy) {
    const z = RV.cam.zoom;
    return { x: (sx - window.innerWidth / 2) / z + RV.cam.x, y: (sy - window.innerHeight / 2) / z + RV.cam.y };
  };
  RV.screenToTile = function (sx, sy) {
    const w = RV.screenToWorld(sx, sy);
    return { x: Math.floor(w.x / TS), y: Math.floor(w.y / TS) };
  };
  RV.worldToScreen = function (wx, wy) {
    const z = RV.cam.zoom;
    return { x: (wx - RV.cam.x) * z + window.innerWidth / 2, y: (wy - RV.cam.y) * z + window.innerHeight / 2 };
  };

  RV.clampCam = function () {
    if (!S) return;
    const ws = RV.worldSize(), z = RV.cam.zoom;
    const hw = window.innerWidth / 2 / z, hh = window.innerHeight / 2 / z;
    const mx = Math.max(0, hw - 40), my = Math.max(0, hh - 40);
    RV.cam.x = ws.w < hw * 2 ? ws.w / 2 : U.clamp(RV.cam.x, hw - mx * 0.6, ws.w - hw + mx * 0.6);
    RV.cam.y = ws.h < hh * 2 ? ws.h / 2 : U.clamp(RV.cam.y, hh - my * 0.6, ws.h - hh + my * 0.6);
  };

  // ---------------------------------------------------------------- static analysis

  function isB(s, x, y) { return x < 0 || y < 0 || x >= s.W || y >= s.H || s.tile[y * s.W + x] === T().BUILDING; }

  function analyseBuildings(s) {
    blocks = new Array(s.W * s.H).fill(-1);
    let n = 0;
    for (let i = 0; i < blocks.length; i++) {
      if (s.tile[i] !== T().BUILDING || blocks[i] >= 0) continue;
      const q = [i]; blocks[i] = n;
      while (q.length) {
        const c = q.pop(), cx = c % s.W, cy = (c / s.W) | 0;
        for (const [dx, dy] of U.DIRS) {
          const nx = cx + dx, ny = cy + dy, ni = ny * s.W + nx;
          if (nx < 0 || ny < 0 || nx >= s.W || ny >= s.H) continue;
          if (s.tile[ni] === T().BUILDING && blocks[ni] < 0) { blocks[ni] = n; q.push(ni); }
        }
      }
      n++;
    }
    windows = [];
    for (let y = 0; y < s.H; y++) for (let x = 0; x < s.W; x++) {
      const i = y * s.W + x;
      if (s.tile[i] !== T().BUILDING) continue;
      const border = x === 0 || y === 0 || x === s.W - 1 || y === s.H - 1;
      if (border) continue;
      const d = MD.districtOf(x, y);
      if (!isB(s, x, y + 1)) {
        for (const ox of [3, 10]) windows.push({ x: x * TS + ox, y: y * TS + 11, w: 3, h: 3, d, thr: 0.03 + U.hash(x, y, ox) * 0.95, c: (U.hash(x, ox, y) * 5) | 0 });
      } else if (U.hash(x, y, 77) < 0.22) {
        windows.push({ x: x * TS + 5 + ((U.hash(x, y, 78) * 6) | 0), y: y * TS + 4 + ((U.hash(x, y, 79) * 6) | 0), w: 2, h: 2, d, thr: 0.05 + U.hash(x, y, 80) * 0.95, c: (U.hash(y, x, 81) * 5) | 0, sky: true });
      }
    }
  }

  // ---------------------------------------------------------------- terrain

  function px(c, x, y, w, h, col) { c.fillStyle = col; c.fillRect(x, y, w, h); }

  function shade(hex, f) {
    const m = /^#(..)(..)(..)$/.exec(hex);
    const r = U.clamp(Math.round(parseInt(m[1], 16) * f), 0, 255), g = U.clamp(Math.round(parseInt(m[2], 16) * f), 0, 255), b = U.clamp(Math.round(parseInt(m[3], 16) * f), 0, 255);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function drawStreetTile(c, s, x, y) {
    const X = x * TS, Y = y * TS;
    px(c, X, Y, TS, TS, C.street);
    for (let k = 0; k < 7; k++) {
      const h = U.hash(x, y, k);
      px(c, X + ((U.hash(x, y, k + 11) * 15) | 0), Y + ((U.hash(x, y, k + 23) * 15) | 0), h > 0.85 ? 2 : 1, 1, h < 0.5 ? C.street2 : C.street3);
    }
    const hb = U.hash(x, y, 5);
    if (hb < 0.08) { // crack
      let cx = X + 3 + ((hb * 100) % 9), cy = Y + 4;
      for (let k = 0; k < 6; k++) { px(c, cx, cy, 1, 1, C.crack); cx += U.hash(x, k, y) < 0.5 ? 1 : 0; cy += 1; }
    } else if (hb > 0.965) { // manhole
      px(c, X + 5, Y + 6, 6, 4, '#20243a'); px(c, X + 6, Y + 5, 4, 6, '#20243a'); px(c, X + 6, Y + 7, 4, 1, '#151826');
    }
    // lane dashes on long horizontal / vertical streets
    const up = isB(s, x, y - 1), dn = isB(s, x, y + 1), lf = isB(s, x - 1, y), rt = isB(s, x + 1, y);
    if (up && dn && !lf && !rt && x % 2 === 0) px(c, X + 4, Y + 8, 8, 1, C.line);
    if (lf && rt && !up && !dn && y % 2 === 0) px(c, X + 8, Y + 4, 1, 8, C.line);
    // curbs next to buildings
    if (up) { px(c, X, Y, TS, 2, C.curb); px(c, X, Y + 2, TS, 1, C.street3); }
    if (dn) px(c, X, Y + 14, TS, 2, C.curb);
    if (lf) px(c, X, Y, 2, TS, C.curb);
    if (rt) px(c, X + 14, Y, 2, TS, C.curb);
    // concrete bank next to canals
    const isC = (dx, dy) => { const nx = x + dx, ny = y + dy; return nx >= 0 && ny >= 0 && nx < s.W && ny < s.H && s.tile[ny * s.W + nx] === T().CANAL; };
    if (isC(0, -1)) px(c, X, Y, TS, 2, C.curb2);
    if (isC(0, 1)) px(c, X, Y + 14, TS, 2, C.curb2);
    if (isC(-1, 0)) px(c, X, Y, 2, TS, C.curb2);
    if (isC(1, 0)) px(c, X + 14, Y, 2, TS, C.curb2);
  }

  function drawBuildingTile(c, s, x, y) {
    const X = x * TS, Y = y * TS, i = y * s.W + x;
    const border = x === 0 || y === 0 || x === s.W - 1 || y === s.H - 1;
    if (border) { px(c, X, Y, TS, TS, '#0d0f18'); return; }
    const roof = ROOFS[(U.hash(blocks[i], 3, 7) * ROOFS.length) | 0];
    px(c, X, Y, TS, TS, roof);
    // subtle roof plates
    if (U.hash(x, y, 31) < 0.5) px(c, X + 1, Y + 1, 14, 1, shade(roof, 1.08));
    px(c, X + ((U.hash(x, y, 32) * 12) | 0), Y + ((U.hash(x, y, 33) * 7) | 0), 3, 1, shade(roof, 0.86));
    if (!isB(s, x, y - 1)) px(c, X, Y, TS, 1, shade(roof, 1.35));
    if (!isB(s, x - 1, y)) px(c, X, Y, 1, TS, shade(roof, 1.2));
    if (!isB(s, x + 1, y)) px(c, X + TS - 1, Y, 1, TS, shade(roof, 0.7));
    const face = !isB(s, x, y + 1);
    const hh = U.hash(x, y, 34);
    if (!face) {
      if (hh < 0.12) { // vent
        px(c, X + 4, Y + 4, 6, 5, shade(roof, 0.75)); px(c, X + 5, Y + 5, 4, 1, shade(roof, 0.55)); px(c, X + 5, Y + 7, 4, 1, shade(roof, 0.55));
      } else if (hh < 0.2) { // water tank
        px(c, X + 5, Y + 3, 6, 6, '#3d3a46'); px(c, X + 6, Y + 2, 4, 1, '#4a4654'); px(c, X + 6, Y + 9, 1, 2, '#2a2833'); px(c, X + 9, Y + 9, 1, 2, '#2a2833');
      } else if (hh < 0.26) { // antenna
        px(c, X + 9, Y + 1, 1, 9, '#4e5568'); px(c, X + 7, Y + 3, 5, 1, '#4e5568'); px(c, X + 8, Y + 10, 3, 1, '#20243a');
      } else if (hh < 0.33) { // AC unit
        px(c, X + 3, Y + 6, 7, 5, '#3c4256'); px(c, X + 4, Y + 7, 3, 3, '#2a2f40');
      }
    } else {
      px(c, X, Y + 9, TS, 7, C.wall);
      px(c, X, Y + 9, TS, 1, shade(roof, 0.55));
      px(c, X, Y + 15, TS, 1, '#0b0c14');
      px(c, X + 3, Y + 11, 3, 3, C.win); px(c, X + 10, Y + 11, 3, 3, C.win);
    }
  }

  function drawRubble(c, s, x, y) {
    drawStreetTile(c, s, x, y);
    const X = x * TS, Y = y * TS;
    px(c, X + 1, Y + 9, 14, 6, '#2a2626');
    for (let k = 0; k < 9; k++) {
      const rx = X + 1 + ((U.hash(x, y, k + 40) * 11) | 0), ry = Y + 2 + ((U.hash(x, y, k + 50) * 10) | 0);
      const w = 3 + ((U.hash(x, y, k + 60) * 4) | 0), h = 2 + ((U.hash(x, y, k + 70) * 3) | 0);
      px(c, rx, ry, w, h, C.rubble[(U.hash(x, y, k + 80) * 4) | 0]);
      px(c, rx, ry, w, 1, C.rubble[3]);
    }
    px(c, X + 4, Y + 3, 1, 6, C.rebar); px(c, X + 11, Y + 5, 4, 1, C.rebar);
  }

  function drawCanal(c, s, x, y) {
    const X = x * TS, Y = y * TS;
    px(c, X, Y, TS, TS, C.canal);
    const isW = (dx, dy) => { const nx = x + dx, ny = y + dy; return nx < 0 || ny < 0 || nx >= s.W || ny >= s.H || s.tile[ny * s.W + nx] === T().CANAL; };
    if (!isW(0, -1)) px(c, X, Y, TS, 2, C.bank);
    if (!isW(0, 1)) px(c, X, Y + 14, TS, 2, '#1b2030');
    if (!isW(-1, 0)) px(c, X, Y, 2, TS, C.bank);
    if (!isW(1, 0)) px(c, X + 14, Y, 2, TS, C.bank);
  }

  function drawPad(c, s, x, y) {
    const X = x * TS, Y = y * TS;
    px(c, X, Y, TS, TS, C.pad);
    if ((x + y) % 2 === 0) px(c, X + 1, Y + 1, 14, 14, C.pad2);
  }

  function drawDepositBase(c, s, d) {
    const X = d.x * TS, Y = d.y * TS;
    drawPad(c, s, d.x, d.y);
    if (d.kind === 'scrap') {
      const cols = ['#5d5650', '#7a6f63', '#8f8273', '#4a4440', '#a0522d', '#6c7686'];
      px(c, X + 1, Y + 10, 14, 5, '#2c2826');
      for (let k = 0; k < 16; k++) {
        const rx = X + 1 + ((U.hash(d.x, d.y, k) * 12) | 0), ry = Y + 3 + ((U.hash(d.y, d.x, k) * 10) | 0) + (k < 6 ? 3 : 0);
        px(c, rx, ry, 2 + ((U.hash(k, d.x, d.y) * 3) | 0), 2, cols[(U.hash(d.x + k, d.y, 9) * cols.length) | 0]);
      }
      px(c, X + 6, Y + 2, 4, 1, '#9a8b7a'); px(c, X + 5, Y + 3, 6, 1, '#7a6f63');
      px(c, X + 9, Y + 6, 3, 3, '#3a3d48'); px(c, X + 10, Y + 7, 1, 1, '#6c7686'); // gear
    } else {
      px(c, X + 1, Y + 9, 14, 6, '#24222c');
      for (let k = 0; k < 7; k++) {
        const rx = X + 1 + ((U.hash(d.x, d.y, k) * 12) | 0), ry = Y + 8 + ((U.hash(d.y, d.x, k) * 5) | 0);
        px(c, rx, ry, 3, 2, ['#3a3644', '#4a4654', '#2c2a34'][k % 3]);
      }
    }
  }

  function buildTerrain(s) {
    const c = tctx;
    c.clearRect(0, 0, terrain.width, terrain.height);
    for (let y = 0; y < s.H; y++) for (let x = 0; x < s.W; x++) {
      const t = s.tile[y * s.W + x];
      if (t === T().BUILDING) drawBuildingTile(c, s, x, y);
      else if (t === T().RUBBLE) drawRubble(c, s, x, y);
      else if (t === T().CANAL) drawCanal(c, s, x, y);
      else if (t === T().FACILITY || t === T().CONVEYOR) drawPad(c, s, x, y);
      else if (t === T().DEPOSIT) { /* drawn below */ } else drawStreetTile(c, s, x, y);
    }
    for (const d of s.deposits) drawDepositBase(c, s, d);
    terrainDirty = false;
  }

  RV.markTerrainDirty = () => { terrainDirty = true; };

  // ---------------------------------------------------------------- cables

  function conductive(s, i) { return s.cable[i] === 1 || s.old[i] >= 1; }

  function visOn(s, i, now) {
    if (!s.powered[i]) return false;
    const t = fx.powerOn.get(i);
    return t == null || now >= t;
  }

  function cableMask(s, x, y) {
    let m = 0;
    const W = s.W;
    const chk = (nx, ny, bit) => {
      if (nx < 0 || ny < 0 || nx >= W || ny >= s.H) return;
      const n = ny * W + nx;
      if (conductive(s, n)) m |= bit;
      else if (s.facAt[n] >= 0) { const f = s.facilities[s.facAt[n]]; if (f.connected) m |= bit; }
    };
    chk(x + 1, y, 1); chk(x - 1, y, 2); chk(x, y + 1, 4); chk(x, y - 1, 8);
    return m;
  }

  function drawCableShape(c, X, Y, m, col, wide) {
    const a = wide ? 7 : 7, b = wide ? 3 : 2;
    px(c, X + a, Y + a, b, b, col);
    if (m & 1) px(c, X + a, Y + a, TS - a, b, col);
    if (m & 2) px(c, X, Y + a, a + b, b, col);
    if (m & 4) px(c, X + a, Y + a, b, TS - a, col);
    if (m & 8) px(c, X + a, Y, b, a + b, col);
  }

  // Provisional cable joins anything it touches: other cable, old lines, the dock or a facility.
  function tempMask(s, x, y) {
    let m = 0;
    const chk = (nx, ny, bit) => {
      if (nx < 0 || ny < 0 || nx >= s.W || ny >= s.H) return;
      const n = ny * s.W + nx;
      if (s.cable[n] || s.old[n] >= 1 || s.facAt[n] === 0) m |= bit;
    };
    chk(x + 1, y, 1); chk(x - 1, y, 2); chk(x, y + 1, 4); chk(x, y - 1, 8);
    return m;
  }

  function drawTempCable(c, s, i, now, emit) {
    const x = i % s.W, y = (i / s.W) | 0, X = x * TS, Y = y * TS;
    const m = tempMask(s, x, y);
    const burning = s.ex.mode === 'shorted';
    if (!emit) {
      drawCableShape(c, X - 1, Y - 1, m, '#1a1008', true);
      // dashed: the line is only tacked down for now
      const seg = (sx, sy, w, h) => px(c, sx, sy, w, h, '#8a5a24');
      if (m & 1) for (let k = 9; k < TS; k += 3) seg(X + k, Y + 7, 2, 2);
      if (m & 2) for (let k = 0; k < 7; k += 3) seg(X + k, Y + 7, 2, 2);
      if (m & 4) for (let k = 9; k < TS; k += 3) seg(X + 7, Y + k, 2, 2);
      if (m & 8) for (let k = 0; k < 7; k += 3) seg(X + 7, Y + k, 2, 2);
      px(c, X + 7, Y + 7, 2, 2, '#8a5a24');
      return;
    }
    const tw = 0.5 + 0.5 * Math.sin(now * 5 + x * 0.9 + y * 1.3);
    c.globalAlpha = burning ? (Math.random() < 0.5 ? 1 : 0.2) : 0.35 + 0.35 * tw;
    px(c, X + 7, Y + 7, 2, 2, burning ? (Math.random() < 0.5 ? '#ffffff' : '#ff5a4c') : '#ffb347');
    c.globalAlpha = 1;
  }

  function drawCablesBase(c, s, now) {
    const W = s.W;
    for (let i = 0; i < s.cable.length; i++) {
      if (!s.revealed[i]) continue;
      if (s.cable[i] === 2) { drawTempCable(c, s, i, now, false); continue; }
      const pc = s.cable[i] === 1, ol = s.old[i];
      if (!pc && !ol) continue;
      if (ol && s.buried[i] && !pc && !s.powered[i] && !s.upgrades.scanner) continue;
      const x = i % W, y = (i / W) | 0, X = x * TS, Y = y * TS;
      const m = cableMask(s, x, y);
      if (s.tile[i] === T().CANAL && pc) { // bridge planks
        const horiz = (m & 3) && !(m & 12);
        for (let k = 0; k < 4; k++) {
          if (horiz) px(c, X + k * 4, Y + 3, 3, 10, k % 2 ? C.plank : C.plank2);
          else px(c, X + 3, Y + k * 4, 10, 3, k % 2 ? C.plank : C.plank2);
        }
      }
      const on = visOn(s, i, now);
      if (ol === 2) {
        // broken line: two stubs with a gap
        const mm = m & ~0;
        px(c, X + 7, Y + 7, 2, 2, '#552a22');
        if (mm & 1) px(c, X + 11, Y + 7, 5, 2, C.oldDead);
        if (mm & 2) px(c, X, Y + 7, 5, 2, C.oldDead);
        if (mm & 4) px(c, X + 7, Y + 11, 2, 5, C.oldDead);
        if (mm & 8) px(c, X + 7, Y, 2, 5, C.oldDead);
        continue;
      }
      if (pc) {
        drawCableShape(c, X - 1, Y - 1, m, '#1a1008', true);
        drawCableShape(c, X, Y, m, on ? C.cableMid : '#6b4a22', false);
      } else {
        const dashed = s.buried[i] && !on;
        if (dashed) {
          for (let k = 0; k < 16; k += 4) {
            if (m & 3) px(c, X + k, Y + 7, 2, 1, '#5c4f3a');
            if (m & 12) px(c, X + 7, Y + k, 1, 2, '#5c4f3a');
          }
        } else {
          drawCableShape(c, X, Y, m, on ? '#8a6a2a' : C.oldDead, false);
          if (!on && (x + y) % 3 === 0) px(c, X + 6, Y + 6, 4, 4, C.oldDead2);
        }
      }
    }
  }

  function drawCablesEmit(c, s, now) {
    const W = s.W;
    for (let i = 0; i < s.cable.length; i++) {
      if (s.cable[i] === 2 && s.revealed[i]) { drawTempCable(c, s, i, now, true); continue; }
      if (!s.revealed[i] || !s.powered[i]) continue;
      if (!visOn(s, i, now)) continue;
      const pc = s.cable[i] === 1;
      const x = i % W, y = (i / W) | 0, X = x * TS, Y = y * TS;
      const m = cableMask(s, x, y);
      const d = s.pdist[i];
      const t0 = fx.powerOn.get(i);
      const flash = t0 != null ? U.clamp(1 - (now - t0) / 0.5, 0, 1) : 0;
      const pulse = 0.55 + 0.45 * Math.sin(now * 3.2 - d * 0.55);
      // the light fades out towards the end of a source's reach
      const reach = U.clamp(0.3 + s.volt[i] * 0.16, 0.3, 1);
      c.globalAlpha = U.clamp((0.45 + 0.4 * pulse) * reach + flash, 0, 1);
      const core = flash > 0.2 ? '#ffffff' : pc ? C.corePlayer : C.coreOld;
      const a = 7;
      px(c, X + a, Y + a, 1, 1, core);
      if (m & 1) px(c, X + a, Y + a, TS - a, 1, core);
      if (m & 2) px(c, X, Y + a, a + 1, 1, core);
      if (m & 4) px(c, X + a, Y + a, 1, TS - a, core);
      if (m & 8) px(c, X + a, Y, 1, a + 1, core);
      // energy packets travelling outward from the dock
      const ph = (now * 7 - d) % 14;
      if (ph >= 0 && ph < 1) { c.globalAlpha = 1; px(c, X + 6, Y + 6, 3, 3, '#fff3c4'); }
      c.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------- objects

  function drawLamps(c, s, now, emit) {
    for (let li = 0; li < s.lamps.length; li++) {
      const L = s.lamps[li];
      if (!s.revealed[L.i]) continue;
      const X = L.x * TS, Y = L.y * TS;
      const lit = L.lit && visOn(s, L.i, now);
      if (!emit) {
        px(c, X + 2, Y + 2, 1, 10, '#2c3040'); px(c, X + 3, Y + 2, 1, 10, '#4a5068');
        px(c, X + 1, Y + 11, 4, 2, '#2c3040');
        px(c, X + 3, Y + 1, 5, 2, '#3c4258');
        px(c, X + 5, Y + 3, 3, 1, L.broken ? '#3a2a2a' : '#5a5e70');
      } else if (lit) {
        const t0 = fx.powerOn.get(L.i);
        const fl = t0 != null && now - t0 < 0.6 ? (Math.sin((now - t0) * 60) > 0 ? 1 : 0.3) : 1;
        c.globalAlpha = fl;
        px(c, X + 5, Y + 3, 3, 1, '#fff2c0'); px(c, X + 4, Y + 4, 5, 1, '#ffd77a');
        c.globalAlpha = 1;
      } else if (L.broken && s.powered[L.i] && Math.sin(now * 9 + li) > 0.85) {
        px(c, X + 5, Y + 3, 3, 1, '#ff6b5b');
      }
    }
  }

  function drawBreaks(c, s, now, emit) {
    for (const k in s.breaks) {
      const i = +k;
      if (!s.revealed[i]) continue;
      const x = i % s.W, y = (i / s.W) | 0, X = x * TS, Y = y * TS;
      if (!emit) {
        px(c, X + 5, Y + 11, 6, 2, '#2a1f1f');
        continue;
      }
      const live = G_touchesPower(s, i);
      if (!live) continue;
      for (let k2 = 0; k2 < 4; k2++) {
        if (Math.random() < 0.55) {
          const sx = X + 5 + ((Math.random() * 6) | 0), sy = Y + 5 + ((Math.random() * 6) | 0);
          px(c, sx, sy, 1, 1, Math.random() < 0.5 ? '#ffffff' : '#ff9a4a');
        }
      }
    }
  }
  function G_touchesPower(s, i) { return MD.G.neighborsOf(s, i).some((n) => s.powered[n]); }

  // Live floors (once known) and the spark hints around them: one glint per live floor nearby.
  const SPARK_MAX = 4;
  function drawHazards(c, s, now, emit) {
    const W = s.W;
    for (let i = 0; i < s.hz.length; i++) {
      if (!s.revealed[i]) continue;
      const x = i % W, y = (i / W) | 0, X = x * TS, Y = y * TS;
      if (s.hz[i] && s.hzKnown[i]) {
        const insulated = !!s.cable[i];
        if (!emit) {
          px(c, X + 2, Y + 2, 12, 12, insulated ? '#23262e' : '#151a2a');
          for (let k = 0; k < 4; k++) px(c, X + 3, Y + 4 + k * 3, 10, 1, insulated ? '#3a3e48' : '#2c3a5c');
        } else if (!insulated) {
          for (let k = 0; k < 3; k++) {
            if (Math.random() < 0.5) continue;
            let ax = X + 3 + ((Math.random() * 10) | 0), ay = Y + 3 + ((Math.random() * 10) | 0);
            for (let n = 0; n < 4; n++) {
              px(c, ax, ay, 1, 1, Math.random() < 0.5 ? '#ffffff' : '#7fd8ff');
              ax += Math.random() < 0.5 ? 1 : -1; ay += Math.random() < 0.5 ? 1 : -1;
            }
          }
        }
        continue;
      }
      const n = s.hzN[i];
      if (!emit || !n || s.tile[i] === T().BUILDING) continue;
      // a short row of embers along the bottom of the tile: count them like minesweeper digits
      const x0 = X + 8 - Math.round(n * 1.5);
      for (let k = 0; k < Math.min(n, SPARK_MAX); k++) {
        const ph = now * 3 + U.hash(x, y, k) * 9;
        c.globalAlpha = 0.7 + 0.3 * Math.sin(ph);
        px(c, x0 + k * 3, Y + 12, 2, 2, Math.sin(ph * 1.7) > 0.8 ? '#ffffff' : '#ff8a3c');
      }
      c.globalAlpha = 1;
    }
  }

  function drawRelays(c, s, now, emit) {
    for (const i of s.relays) {
      if (!s.revealed[i]) continue;
      const X = (i % s.W) * TS, Y = ((i / s.W) | 0) * TS;
      if (!emit) {
        px(c, X + 3, Y + 12, 10, 3, '#1c2030');
        px(c, X + 5, Y + 2, 6, 11, '#2c3448');
        px(c, X + 2, Y + 4, 12, 2, '#3c4660');
      } else {
        // a lattice mast in teal so it reads apart from the amber cable it stands on
        const on = Math.sin(now * 3 + i) > -0.3;
        px(c, X + 5, Y + 3, 1, 10, '#4fb8d8'); px(c, X + 10, Y + 3, 1, 10, '#4fb8d8');
        for (let k = 0; k < 3; k++) px(c, X + 6, Y + 5 + k * 3, 4, 1, '#3a90b0');
        px(c, X + 2, Y + 4, 12, 1, '#8ff8ff');
        px(c, X + 7, Y + 0, 2, 3, on ? '#e8ffff' : '#4aa8c8');
        px(c, X + 2, Y + 3, 1, 1, '#ffe08a'); px(c, X + 13, Y + 3, 1, 1, '#ffe08a');
      }
    }
  }

  function drawItems(c, s, now, emit) {
    const SP = MD.Sprites;
    for (const k in s.items) {
      const i = +k;
      if (!s.revealed[i]) continue;
      const it = s.items[k];
      const x = i % s.W, y = (i / s.W) | 0;
      const bob = (it.kind === 'scrap' || it.kind === 'crystal' || it.kind === 'cell') ? Math.round(Math.sin(now * 2.5 + x + y) * 1) : 0;
      const sp = SP.items[it.kind];
      if (!emit) c.drawImage(sp.c, x * TS, y * TS + bob);
      else {
        if (sp.e) c.drawImage(sp.e, x * TS, y * TS + bob);
        const g = (now * 0.8 + U.hash(x, y, 3) * 7) % 3;
        if (g < 0.25) { // glint
          const gx = x * TS + 9, gy = y * TS + 6 + bob;
          px(c, gx, gy - 1, 1, 3, '#ffffff'); px(c, gx - 1, gy, 3, 1, '#ffffff');
        }
        if (it.kind === 'bot' && Math.floor(now * 1.2 + x) % 3 === 0) px(c, x * TS + 7, y * TS + 9, 2, 1, '#ff6b5b');
      }
    }
  }

  function drawDeposits(c, s, now, emit) {
    for (const d of s.deposits) {
      if (!s.revealed[d.i]) continue;
      const X = d.x * TS, Y = d.y * TS;
      if (d.kind === 'crystal' && emit) {
        const shards = [[3, 4, 3, 8], [7, 1, 3, 11], [11, 5, 2, 7], [5, 8, 2, 5], [10, 3, 2, 4]];
        for (let k = 0; k < shards.length; k++) {
          const [sx, sy, w, h] = shards[k];
          px(c, X + sx, Y + sy, w, h, '#2f9fd8');
          px(c, X + sx, Y + sy, 1, h, '#8ff0ff');
          px(c, X + sx + w - 1, Y + sy + 1, 1, h - 1, '#1f6f99');
        }
        const tw = (now * 1.5 + d.x) % 2.5;
        if (tw < 0.2) px(c, X + 8, Y + 2, 1, 1, '#ffffff');
      }
      if (!emit && d.buffer > 0) { // stockpile next to the deposit
        const n = Math.min(4, Math.ceil(d.buffer / 3));
        for (let k = 0; k < n; k++) {
          const bx = X + 1 + k * 4, by = Y + 12;
          px(c, bx, by, 4, 4, '#1a1612');
          px(c, bx, by, 3, 3, d.kind === 'scrap' ? '#8a7a6a' : '#3fb6e6');
          px(c, bx, by, 3, 1, d.kind === 'scrap' ? '#b8a68e' : '#9ff0ff');
        }
      }
      if (emit && d.buffer >= d.cap && d.connected) { // full: warning blink
        if (Math.sin(now * 6) > 0) { px(c, X + 7, Y - 6, 2, 5, '#ffcc33'); px(c, X + 7, Y, 2, 2, '#ffcc33'); }
      }
    }
  }

  // ---------------------------------------------------------------- facilities

  function facLevel(f, now) {
    // 0 = dark, 1 = fully powered; flickers during the power-up moment
    if (f.state !== 'active' && f.state !== 'ignited' && f.state !== 'ready') return 0;
    const t0 = fx.facPower.get(f.id);
    if (t0 == null) return 1;
    const k = now - t0;
    if (k > 1.6) return 1;
    return Math.sin(k * 40) > (1 - k / 1.6) * 0.8 ? 1 : 0.15;
  }

  function drawFacility(c, s, f, now, emit) {
    if (!f.seen && !s.revealed[f.tiles[0]] && f.kind !== 'reactor') {
      if (!f.tiles.some((t) => s.revealed[t])) return;
    }
    const X = f.x * TS, Y = f.y * TS, W = f.w * TS, H = f.h * TS;
    const lv = facLevel(f, now);
    switch (f.kind) {
      case 'dock': drawDock(c, X, Y, W, H, now, emit, s); break;
      case 'factory': drawFactory(c, X, Y, W, H, now, emit, lv, f); break;
      case 'radar': drawRadar(c, X, Y, W, H, now, emit, lv, f); break;
      case 'depot': drawDepot(c, X, Y, W, H, now, emit, lv, f); break;
      case 'substation': drawSubstation(c, X, Y, W, H, now, emit, lv, f); break;
      case 'conveyor': drawConveyor(c, s, f, now, emit, lv); break;
      case 'reactor': drawReactor(c, X, Y, W, H, now, emit, lv, f); break;
    }
    if (f.state === 'restoring' && !emit) {
      // scaffolding
      for (let k = 0; k < f.w * 2; k++) px(c, X + k * 8 + 2, Y + 1, 1, H - 2, '#6a5530');
      px(c, X + 1, Y + 4, W - 2, 1, '#6a5530'); px(c, X + 1, Y + H - 6, W - 2, 1, '#6a5530');
    }
  }

  function drawDock(c, X, Y, W, H, now, emit, s) {
    if (!emit) {
      px(c, X + 1, Y + 1, W - 2, H - 2, '#2c3142');
      px(c, X + 2, Y + 2, W - 4, H - 4, '#353b4f');
      // landing ring
      for (let a = 0; a < 32; a++) {
        const ang = a / 32 * Math.PI * 2;
        px(c, Math.round(X + 24 + Math.cos(ang) * 14), Math.round(Y + 26 + Math.sin(ang) * 12), 2, 2, '#4d5670');
      }
      px(c, X + 16, Y + 20, 16, 12, '#2a2f40');
      // control mast
      px(c, X + 3, Y + 3, 8, 12, '#444c64'); px(c, X + 4, Y + 4, 6, 3, '#1c2030');
      px(c, X + 40, Y + 2, 2, 14, '#4c5470'); px(c, X + 37, Y + 4, 8, 1, '#4c5470');
      // hazard stripes
      for (let k = 0; k < W - 4; k += 4) { px(c, X + 2 + k, Y + H - 4, 2, 2, '#c9a227'); px(c, X + 4 + k, Y + H - 4, 2, 2, '#1a1a1a'); }
    } else {
      // pad lights chase while away, glow green while HOTARU is docked and charged
      const home = s.ex.mode === 'home';
      for (let a = 0; a < 8; a++) {
        const ang = a / 8 * Math.PI * 2;
        const on = (Math.floor(now * 4) % 8) === a;
        const col = home ? (Math.sin(now * 3 + a * 0.8) > 0 ? '#7dff9a' : '#2e8b4a') : on ? '#fff2c0' : '#ffb347';
        px(c, Math.round(X + 24 + Math.cos(ang) * 14), Math.round(Y + 26 + Math.sin(ang) * 12), 2, 2, col);
      }
      px(c, X + 4, Y + 4, 6, 3, '#ffd27a');
      if (Math.sin(now * 3) > 0) px(c, X + 40, Y + 1, 2, 2, '#ff6b5b');
    }
  }

  function drawFactory(c, X, Y, W, H, now, emit, lv, f) {
    if (!emit) {
      px(c, X + 1, Y + 14, W - 2, H - 15, lv ? '#4a4152' : '#352f3b');
      px(c, X + 1, Y + 14, W - 2, 2, '#5a5064');
      for (let k = 0; k < 3; k++) { // saw-tooth roof
        const bx = X + 2 + k * 14;
        for (let r = 0; r < 12; r++) px(c, bx, Y + 2 + r, 1 + r, 1, lv ? '#5d5470' : '#3e3848');
        px(c, bx + 12, Y + 2, 2, 12, '#2a2532');
      }
      px(c, X + 38, Y + 1, 6, 14, '#3b3640'); px(c, X + 37, Y + 1, 8, 2, '#4b4552'); // chimney
      px(c, X + 15, Y + 33, 18, 14, '#1d1a22'); // door frame
      for (let k = 0; k < 4; k++) px(c, X + 16, Y + 34 + k * 3, 16, 1, lv ? '#3a3440' : '#2a262f');
      // gear sign
      const g = lv ? now * 2 : 0.3;
      for (let a = 0; a < 8; a++) {
        const ang = g + a / 8 * Math.PI * 2;
        px(c, Math.round(X + 8 + Math.cos(ang) * 4), Math.round(Y + 26 + Math.sin(ang) * 4), 2, 2, '#8a8f9e');
      }
      px(c, X + 7, Y + 25, 3, 3, '#5a5e6c');
    } else {
      if (lv) {
        c.globalAlpha = lv;
        for (let k = 0; k < 3; k++) px(c, X + 14 + k * 14, Y + 4, 2, 9, '#ffd27a');
        px(c, X + 16, Y + 34, 16, 2, '#fff1c9');
        c.globalAlpha = 0.5 * lv; px(c, X + 16, Y + 36, 16, 10, '#ffb347'); c.globalAlpha = 1;
        px(c, X + 23, Y + 18, 2, 2, Math.sin(now * 5) > 0 ? '#7dff9a' : '#2e8b4a');
      } else if (f.state === 'dormant' && Math.sin(now * 5) > 0.2) {
        px(c, X + 39, Y, 4, 2, '#ff4a3c'); // SOS light on the chimney
      }
    }
  }

  function drawRadar(c, X, Y, W, H, now, emit, lv) {
    const cx = X + 16;
    if (!emit) {
      for (let r = 0; r < 20; r++) {
        const half = 3 + r * 0.45;
        px(c, Math.round(cx - half), Y + 11 + r, 1, 1, '#5a6178');
        px(c, Math.round(cx + half), Y + 11 + r, 1, 1, '#5a6178');
        if (r % 5 === 0) px(c, Math.round(cx - half), Y + 11 + r, Math.round(half * 2), 1, '#454b60');
      }
      px(c, X + 4, Y + 30, 24, 2, '#3a3f52');
      const rot = lv ? now * 1.6 : 0.6;
      const w = Math.round(Math.abs(Math.cos(rot)) * 9) + 2;
      px(c, cx - w, Y + 5, w * 2, 2, '#9aa2b8');
      px(c, cx - w + 1, Y + 7, w * 2 - 2, 2, '#6c7388');
      px(c, cx, Y + 3, 1, 8, '#7a8196');
    } else if (lv) {
      if (Math.sin(now * 4) > 0) px(c, cx - 1, Y + 1, 3, 2, '#ff6b5b');
      const r = ((now * 14) % 18);
      c.globalAlpha = 0.6 * (1 - r / 18);
      c.strokeStyle = '#8fd3ff'; c.lineWidth = 1;
      c.beginPath(); c.arc(cx + 0.5, Y + 6.5, r + 2, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
      c.globalAlpha = 1;
    }
  }

  function drawDepot(c, X, Y, W, H, now, emit, lv) {
    if (!emit) {
      px(c, X + 2, Y + 4, W - 4, H - 6, lv ? '#4a463a' : '#38352d');
      for (let k = 0; k < 7; k++) px(c, X + 2, Y + 4 + k * 2, W - 4, 1, lv ? '#5a5546' : '#423e34');
      px(c, X + 8, Y + 17, 16, 13, '#1e1c18');
      for (let k = 0; k < 6; k++) px(c, X + 8, Y + 17 + k * 2, 16, 1, '#2e2b24');
      px(c, X + 26, Y + 22, 5, 5, '#a07a4a'); px(c, X + 26, Y + 22, 5, 1, '#c09a6a');
      px(c, X + 1, Y + 24, 5, 5, '#a07a4a'); px(c, X + 1, Y + 24, 5, 1, '#c09a6a');
    } else if (lv) {
      c.globalAlpha = lv;
      px(c, X + 8, Y + 26, 16, 4, '#ffd27a');
      px(c, X + 13, Y + 8, 6, 3, Math.sin(now * 2) > -0.5 ? '#7dff9a' : '#2e8b4a');
      c.globalAlpha = 1;
    }
  }

  function drawSubstation(c, X, Y, W, H, now, emit, lv) {
    if (!emit) {
      px(c, X + 1, Y + 1, W - 2, H - 2, '#1f222c');
      for (let k = 0; k < W; k += 3) { px(c, X + k, Y + 1, 1, 1, '#4a5064'); px(c, X + k, Y + H - 2, 1, 1, '#4a5064'); }
      for (let k = 0; k < H; k += 3) { px(c, X + 1, Y + k, 1, 1, '#4a5064'); px(c, X + W - 2, Y + k, 1, 1, '#4a5064'); }
      px(c, X + 4, Y + 14, 10, 12, lv ? '#5a6278' : '#454b5c');
      px(c, X + 18, Y + 14, 10, 12, lv ? '#5a6278' : '#454b5c');
      for (let k = 0; k < 4; k++) { px(c, X + 5, Y + 16 + k * 3, 8, 1, '#30353f'); px(c, X + 19, Y + 16 + k * 3, 8, 1, '#30353f'); }
      for (const ix of [6, 15, 24]) {
        px(c, X + ix, Y + 4, 3, 10, '#8a8f9e');
        for (let k = 0; k < 4; k++) px(c, X + ix - 1, Y + 5 + k * 2, 5, 1, '#c6cad6');
      }
      px(c, X + 7, Y + 4, 18, 1, '#3a3f4f');
    } else if (lv) {
      c.globalAlpha = lv;
      for (const ix of [6, 15, 24]) px(c, X + ix, Y + 3, 3, 2, Math.sin(now * 6 + ix) > 0 ? '#8ff8ff' : '#ffe08a');
      px(c, X + 7, Y + 18, 4, 2, '#7dff9a'); px(c, X + 21, Y + 18, 4, 2, '#7dff9a');
      if (Math.sin(now * 2.7) > 0.93 || Math.sin(now * 4.1 + 1) > 0.97) { // arc
        let ax = X + 8, ay = Y + 4;
        c.fillStyle = '#e8fbff';
        for (let k = 0; k < 8; k++) { c.fillRect(ax, ay + ((Math.random() * 3) | 0) - 1, 1, 1); ax += 2; }
      }
      c.globalAlpha = 1;
    }
  }

  function drawConveyor(c, s, f, now, emit, lv) {
    const run = lv && s.conveyor && s.facilities[s.conveyor.sink].state === 'active';
    for (let k = 0; k < f.tiles.length; k++) {
      const i = f.tiles[k], x = i % s.W, y = (i / s.W) | 0, X = x * TS, Y = y * TS;
      if (!s.revealed[i]) continue;
      if (!emit) {
        px(c, X, Y + 3, TS, 10, '#2e2f36');
        px(c, X, Y + 4, TS, 8, '#1b1c22');
        const off = run ? Math.floor(now * MD.BAL.conveyorSpeed * TS) % 4 : 0;
        for (let j = 0; j < TS; j += 4) px(c, X + ((j - off + 16) % 16), Y + 5, 1, 6, run ? '#3c3e48' : '#2a2b32');
        px(c, X, Y + 3, TS, 1, '#55575f'); px(c, X, Y + 12, TS, 1, '#55575f');
        if (k % 2 === 0) { px(c, X + 7, Y + 13, 2, 3, '#3a3b42'); }
      } else if (run && k === 0 && Math.sin(now * 5) > 0) px(c, X + 14, Y + 2, 2, 1, '#7dff9a');
    }
    if (s.conveyor && f.state === 'active') {
      const sp = MD.Sprites.items.crystal;
      for (const it of s.conveyor.items) {
        const p = it.p, k = Math.min(f.tiles.length - 1, Math.floor(p));
        const a = f.tiles[k], ax = a % s.W, ay = (a / s.W) | 0;
        const fr = p - k;
        const wx = (ax + f.dir[0] * fr) * TS, wy = (ay + f.dir[1] * fr) * TS - 3;
        if (!emit) c.drawImage(sp.c, Math.round(wx), Math.round(wy));
        else if (sp.e) c.drawImage(sp.e, Math.round(wx), Math.round(wy));
      }
    }
  }

  function drawReactor(c, X, Y, W, H, now, emit, lv, f) {
    const cx = X + W / 2, cy = Y + H / 2;
    const ig = f.state === 'ignited', rd = f.state === 'ready' || ig;
    if (!emit) {
      ring(c, cx, cy, 38, 4, '#2e2a3e');
      ring(c, cx, cy, 33, 2, '#3e3852');
      for (let a = 0; a < 12; a++) {
        const ang = a / 12 * Math.PI * 2 + (rd ? now * (ig ? 0.8 : 0.25) : 0);
        px(c, Math.round(cx + Math.cos(ang) * 30) - 2, Math.round(cy + Math.sin(ang) * 30) - 2, 4, 4, '#4f4866');
      }
      ring(c, cx, cy, 24, 3, '#3a3450');
      disc(c, cx, cy, 18, '#211a30');
      for (const [ox, oy] of [[-34, -34], [30, -34], [-34, 30], [30, 30]]) { px(c, cx + ox, cy + oy, 4, 4, '#4a4560'); px(c, cx + ox + 1, cy + oy + 1, 2, 2, '#2a2638'); }
    } else {
      const base = ig ? 1 : rd ? 0.75 + 0.25 * Math.sin(now * 4) : f.state === 'restoring' ? 0.25 + 0.6 * (f.work / f.need) : 0.12 + 0.08 * Math.sin(now * 1.3);
      c.globalAlpha = U.clamp(base, 0, 1);
      disc(c, cx, cy, ig ? 16 : 13, ig ? '#fff6d8' : '#b48cff');
      disc(c, cx, cy, ig ? 10 : 7, ig ? '#ffffff' : '#e6d8ff');
      if (rd) {
        for (let a = 0; a < (ig ? 16 : 6); a++) {
          const ang = a / (ig ? 16 : 6) * Math.PI * 2 + now * (ig ? 1.2 : 0.6);
          px(c, Math.round(cx + Math.cos(ang) * 24), Math.round(cy + Math.sin(ang) * 24), 2, 2, ig ? '#ffe08a' : '#c9b0ff');
        }
      }
      c.globalAlpha = 1;
    }
  }

  function ring(c, cx, cy, r, w, col) {
    c.strokeStyle = col; c.lineWidth = w;
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
  }
  function disc(c, cx, cy, r, col) { c.fillStyle = col; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill(); }

  // ---------------------------------------------------------------- actors

  function drawRobots(c, s, now, emit) {
    const SP = MD.Sprites;
    const list = s.robots.slice().sort((a, b) => a.y - b.y);
    for (const r of list) {
      if (r.role === 'parade' && r.delay > 0) continue;
      const sp = SP.robots[r.role] || SP.robots.idle;
      const v = r.face < 0 ? sp.l : sp.r;
      const jit = ((r.id * 7) % 5) - 2;
      let bx = Math.round(r.x * TS + 2 + jit), by = Math.round(r.y * TS + 1 + (((r.id * 3) % 3) - 1));
      if (r.state === 'move') by -= Math.floor(now * 8 + r.id) % 2;
      if (r.state === 'mine' && (now * 3 + r.id) % 1 < 0.25) bx += r.face;
      if (r.state === 'load' || r.state === 'unload') by -= 1;
      if (!emit) {
        c.drawImage(v.c, bx, by);
        if (r.role === 'haul' && r.carry > 0) {
          const col = r.carryKind === 'crystal' ? '#59dcff' : '#b8a68e';
          px(c, bx + 3, by - 1, 5, 2, col); px(c, bx + 4, by - 2, 3, 1, col);
        }
      } else {
        if (v.e && r.state !== 'sleep') c.drawImage(v.e, bx, by);
        if (r.state === 'full' && Math.sin(now * 6 + r.id) > 0) { px(c, bx + 5, by - 6, 2, 3, '#ffcc33'); px(c, bx + 5, by - 2, 2, 1, '#ffcc33'); }
        if (r.state === 'sleep' && (now + r.id) % 3 < 1.5) px(c, bx + 9, by - 2 - Math.floor(((now + r.id) % 1.5) * 3), 2, 2, '#8b90a8');
      }
    }
  }

  function drawExplorer(c, s, now, emit) {
    const e = s.ex, SP = MD.Sprites;
    const X = e.fx * TS, Y = e.fy * TS;
    if (e.mode === 'returning') {
      if (emit) {
        disc(c, X + 8, Y + 8, 4, '#fff2c0'); disc(c, X + 8, Y + 8, 2, '#ffffff');
      }
      return;
    }
    const moving = e.moving;
    const frame = moving ? Math.floor(now * 10) % 2 : 0;
    const sp = SP.hotaru[frame];
    const v = e.facing < 0 ? sp.l : sp.r;
    const bob = moving ? (frame ? -1 : 0) : Math.round(Math.sin(now * 2.2) * 0.6);
    const bx = Math.round(X + 2), by = Math.round(Y + 2 + bob);
    if (!emit) {
      px(c, bx + 2, Math.round(Y) + 14, 8, 1, 'rgba(0,0,0,0.35)');
      c.drawImage(v.c, bx, by);
    } else if (e.mode === 'shorted') {
      // overdrawn: the lamp sputters and arcs crawl over the shell
      if (Math.random() < 0.4 && v.e) c.drawImage(v.e, bx, by);
      for (let k = 0; k < 4; k++) {
        let ax = bx + ((Math.random() * 12) | 0), ay = by + ((Math.random() * 12) | 0);
        for (let n = 0; n < 5; n++) {
          px(c, ax, ay, 1, 1, Math.random() < 0.5 ? '#ffffff' : '#7fd8ff');
          ax += Math.random() < 0.5 ? 1 : -1; ay += Math.random() < 0.5 ? 1 : -1;
        }
      }
    } else if (v.e) {
      const low = e.mode === 'out' && e.battery <= 2;
      if (!(low && Math.sin(now * 12) > 0.4)) c.drawImage(v.e, bx, by);
    }
  }

  // ---------------------------------------------------------------- particles & rings

  RV.burst = function (wx, wy, opt) {
    const n = opt.n || 10;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, sp = (opt.speed || 30) * (0.4 + Math.random() * 0.8);
      fx.particles.push({
        x: wx, y: wy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (opt.up || 0),
        life: 0, max: (opt.life || 0.6) * (0.6 + Math.random() * 0.7),
        col: opt.cols ? opt.cols[(Math.random() * opt.cols.length) | 0] : (opt.col || '#ffffff'),
        g: opt.g != null ? opt.g : 40, emit: opt.emit !== false, size: opt.size || 1, drag: opt.drag || 0.9,
      });
    }
  };
  RV.ring = function (wx, wy, opt) {
    fx.rings.push({ x: wx, y: wy, r0: opt.r0 || 2, r1: opt.r1 || 30, life: 0, max: opt.life || 0.7, col: opt.col || '#ffe08a', w: opt.w || 1 });
  };
  RV.floatText = function (wx, wy, text, col, opt) {
    opt = opt || {};
    fx.texts.push({ x: wx, y: wy, text, col: col || '#ffffff', life: 0, max: opt.life || 1.4, big: !!opt.big, dy: opt.dy || -18 });
  };
  RV.mark = function (x, y, col, life) { fx.marks.push({ x, y, col, life: 0, max: life || 0.8 }); };
  RV.shake = function (a) { fx.shake = Math.max(fx.shake, a); };
  RV.powerFlash = function (i, at) { fx.powerOn.set(i, at); };
  RV.facPowerUp = function (fid, at) { fx.facPower.set(fid, at); };
  RV.highlight = function (kind, until) { fx.highlight = { kind, until }; };

  function stepFx(dt) {
    for (const p of fx.particles) {
      p.life += dt;
      p.vx *= Math.pow(p.drag, dt * 10); p.vy *= Math.pow(p.drag, dt * 10);
      p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    fx.particles = fx.particles.filter((p) => p.life < p.max);
    for (const r of fx.rings) r.life += dt;
    fx.rings = fx.rings.filter((r) => r.life < r.max);
    for (const t of fx.texts) t.life += dt;
    fx.texts = fx.texts.filter((t) => t.life < t.max);
    for (const m of fx.marks) m.life += dt;
    fx.marks = fx.marks.filter((m) => m.life < m.max);
    fx.shake = Math.max(0, fx.shake - dt * 10);
  }

  function drawParticles(c, emit) {
    for (const p of fx.particles) {
      if (p.emit !== emit) continue;
      c.globalAlpha = U.clamp(1 - p.life / p.max, 0, 1);
      px(c, Math.round(p.x), Math.round(p.y), p.size, p.size, p.col);
    }
    c.globalAlpha = 1;
  }

  function drawRings(c) {
    for (const r of fx.rings) {
      const k = r.life / r.max;
      c.globalAlpha = (1 - k) * 0.9;
      c.strokeStyle = r.col; c.lineWidth = r.w;
      c.beginPath(); c.arc(r.x, r.y, U.lerp(r.r0, r.r1, U.easeOutCubic(k)), 0, Math.PI * 2); c.stroke();
    }
    c.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- lighting

  function ambient(s, now) {
    const r = s.restoration / 100;
    let a = U.lerp(0.76, 0.42, Math.pow(r, 0.9));
    // the night slowly turns into a violet pre-dawn as the city recovers
    let col = [Math.round(U.lerp(6, 26, r)), Math.round(U.lerp(9, 12, r)), Math.round(U.lerp(22, 38, r))];
    if (fx.ending) {
      const k = U.clamp((now - fx.ending.t0 - 1.2) / 6, 0, 1);
      a = U.lerp(a, 0.0, U.easeInOutSine(k));
      col = [Math.round(U.lerp(6, 70, k)), Math.round(U.lerp(9, 30, k)), Math.round(U.lerp(22, 40, k))];
    }
    return { a, col };
  }

  function drawLighting(s, now) {
    const L = lctx, sc = 0.5;
    const amb = ambient(s, now);
    L.globalCompositeOperation = 'source-over';
    L.clearRect(0, 0, light.width, light.height);
    L.fillStyle = 'rgba(' + amb.col[0] + ',' + amb.col[1] + ',' + amb.col[2] + ',' + amb.a + ')';
    L.fillRect(0, 0, light.width, light.height);
    L.globalCompositeOperation = 'destination-out';
    const spr = MD.Sprites.light;
    const add = (wx, wy, rTiles, inten) => {
      const r = rTiles * TS * sc;
      L.globalAlpha = U.clamp(inten, 0, 1);
      L.drawImage(spr, wx * sc - r, wy * sc - r, r * 2, r * 2);
    };
    const e = s.ex;
    add((e.fx + 0.5) * TS, (e.fy + 0.5) * TS, s.upgrades.scanner ? 4.4 : 3.6, 1);
    for (let i = 0; i < s.powered.length; i++) {
      if (!s.powered[i] || !s.revealed[i] || !visOn(s, i, now)) continue;
      add((i % s.W + 0.5) * TS, (((i / s.W) | 0) + 0.5) * TS, 1.5, 0.42);
    }
    for (const i of s.relays) if (s.revealed[i]) add((i % s.W + 0.5) * TS, (((i / s.W) | 0) + 0.2) * TS, 2.4, 0.8);
    for (let i = 0; i < s.hz.length; i++) {
      if (s.hz[i] && s.hzKnown[i] && !s.cable[i] && s.revealed[i]) add((i % s.W + 0.5) * TS, (((i / s.W) | 0) + 0.5) * TS, 1.3, 0.35 + 0.2 * Math.random());
    }
    if (e.mode === 'shorted') add((e.fx + 0.5) * TS, (e.fy + 0.5) * TS, 2.2, Math.random());
    for (const Lp of s.lamps) if (Lp.lit && visOn(s, Lp.i, now) && s.revealed[Lp.i]) add((Lp.x + 0.35) * TS, (Lp.y + 0.3) * TS, 3.8, 1);
    for (const f of s.facilities) {
      const lv = facLevel(f, now);
      if (lv > 0) {
        if (f.kind === 'conveyor') { for (const t of f.tiles) add((t % s.W + 0.5) * TS, (((t / s.W) | 0) + 0.5) * TS, 1.4, 0.5); continue; }
        add((f.x + f.w / 2) * TS, (f.y + f.h / 2) * TS, Math.max(f.w, f.h) / 2 + (f.kind === 'reactor' ? 5 : 2.4), lv);
      } else if (f.seen && f.kind !== 'conveyor') {
        // dormant buildings stay faintly visible as landmarks in the dark
        add((f.x + f.w / 2) * TS, (f.y + f.h / 2) * TS, Math.max(f.w, f.h) / 2 + 1.2, f.state === 'restoring' ? 0.6 : 0.4);
        if (f.kind === 'factory' && f.state === 'dormant') add((f.x + 2.6) * TS, (f.y + 0.2) * TS, 1.6, Math.sin(now * 5) > 0.2 ? 0.7 : 0.15);
      }
    }
    for (const d of s.deposits) if (d.kind === 'crystal' && s.revealed[d.i]) add((d.x + 0.5) * TS, (d.y + 0.5) * TS, 1.8, 0.5);
    for (const k in s.items) {
      const i = +k;
      if (s.revealed[i] && (s.items[k].kind === 'crystal' || s.items[k].kind === 'cell')) add((i % s.W + 0.5) * TS, (((i / s.W) | 0) + 0.5) * TS, 1.2, 0.4);
    }
    for (const r of s.robots) if (!(r.role === 'parade' && r.delay > 0)) add((r.x + 0.5) * TS, (r.y + 0.5) * TS, 1.3, 0.5);
    for (const w of windows) {
      const lv = winLevel(w);
      if (lv > 0.5) add(w.x + 1, w.y + 1, w.sky ? 0.7 : 1.1, 0.35);
    }
    if (fx.ending) {
      const k = now - fx.ending.t0;
      const X = MD.G.reactor(s);
      add((X.x + 2.5) * TS, (X.y + 2.5) * TS, Math.min(60, k * 9), 1);
    }
    L.globalAlpha = 1;
    L.globalCompositeOperation = 'source-over';
    wctx.imageSmoothingEnabled = true;
    wctx.drawImage(light, 0, 0, world.width, world.height);
  }

  function winLevel(w) { return U.clamp((disp[w.d] - w.thr) * 12, 0, 1); }

  // Colour grade: a hint of warmth on the horizon as restoration rises, full sunrise in the ending.
  function drawGrade(s, now) {
    const r = s.restoration / 100;
    let warm = U.clamp((r - 0.4) / 0.6, 0, 1) * 0.16;
    if (fx.ending) warm = U.lerp(warm, 0.6, U.clamp((now - fx.ending.t0 - 1.6) / 5, 0, 1));
    if (warm < 0.01) return;
    const c = wctx, W = world.width, H = world.height;
    c.globalCompositeOperation = 'soft-light';
    c.globalAlpha = warm;
    c.fillStyle = '#ff9a5a';
    c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'screen';
    c.globalAlpha = warm * 0.75;
    const g = c.createLinearGradient(W, 0, W * 0.25, H);
    g.addColorStop(0, 'rgba(255,214,150,1)');
    g.addColorStop(0.45, 'rgba(255,140,100,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  function drawWindows(c) {
    for (const w of windows) {
      const lv = winLevel(w);
      if (lv <= 0) continue;
      c.globalAlpha = lv;
      px(c, w.x, w.y, w.w, w.h, C.winLit[w.c]);
      if (!w.sky) px(c, w.x, w.y + w.h - 1, w.w, 1, '#c9862e');
    }
    c.globalAlpha = 1;
  }

  function drawBloom(c, s, now) {
    c.globalCompositeOperation = 'lighter';
    const g = (wx, wy, r, col, a) => {
      c.globalAlpha = a;
      c.drawImage(MD.Sprites.glowSprite(col), wx - r, wy - r, r * 2, r * 2);
    };
    const e = s.ex;
    if (e.mode !== 'returning') g((e.fx + 0.6) * TS, (e.fy + 0.25) * TS, 10, '#ffe680', 0.55);
    else g((e.fx + 0.5) * TS, (e.fy + 0.5) * TS, 18, '#fff2c0', 0.9);
    for (const L of s.lamps) if (L.lit && visOn(s, L.i, now) && s.revealed[L.i]) g(L.x * TS + 6, L.y * TS + 4, 14, '#ffc35a', 0.35);
    for (const f of s.facilities) {
      const lv = facLevel(f, now);
      if (lv > 0 && f.kind !== 'conveyor' && f.kind !== 'dock') {
        const col = f.kind === 'substation' ? '#8ff8ff' : f.kind === 'reactor' ? (f.state === 'ignited' ? '#fff2c0' : '#b48cff') : '#ffb347';
        g((f.x + f.w / 2) * TS, (f.y + f.h / 2) * TS, Math.max(f.w, f.h) * TS * 0.8, col, 0.22 * lv);
      }
    }
    for (const d of s.deposits) if (d.kind === 'crystal' && s.revealed[d.i]) g((d.x + 0.5) * TS, (d.y + 0.4) * TS, 14, '#59dcff', 0.35);
    for (const k in s.breaks) {
      const i = +k;
      if (s.revealed[i] && G_touchesPower(s, i)) g((i % s.W + 0.5) * TS, (((i / s.W) | 0) + 0.5) * TS, 12, '#ff6b4a', 0.25 + Math.random() * 0.25);
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  // ---------------------------------------------------------------- fog & beacons

  function updateFog(s) {
    let n = 0;
    for (let i = 0; i < s.revealed.length; i++) n += s.revealed[i];
    if (n === fogCount) return;
    fogCount = n;
    const img = fctx.createImageData(s.W, s.H);
    for (let i = 0; i < s.revealed.length; i++) {
      img.data[i * 4] = 3; img.data[i * 4 + 1] = 4; img.data[i * 4 + 2] = 9;
      img.data[i * 4 + 3] = s.revealed[i] ? 0 : 255;
    }
    fctx.putImageData(img, 0, 0);
  }

  function drawFog(s, now) {
    if (fx.ending) {
      const k = U.clamp((now - fx.ending.t0 - 2) / 5, 0, 1);
      if (k >= 1) return;
      wctx.globalAlpha = 1 - k;
    }
    wctx.imageSmoothingEnabled = true;
    wctx.drawImage(fog, 0, 0, world.width, world.height);
    wctx.globalAlpha = 1;
  }

  function drawOverFog(c, s, now, view) {
    // the reactor silhouette is always visible: the goal on the horizon
    const X = MD.G.reactor(s);
    if (X && !X.tiles.some((t) => s.revealed[t])) {
      const cx = (X.x + X.w / 2) * TS, cy = (X.y + X.h / 2) * TS;
      c.globalAlpha = 0.5 + 0.15 * Math.sin(now * 1.3);
      ring(c, cx, cy, 36, 1, '#5b4a8a');
      ring(c, cx, cy, 24, 1, '#4a3c74');
      c.globalAlpha = 0.25 + 0.2 * Math.sin(now * 1.3);
      disc(c, cx, cy, 10, '#8a6cff');
      c.globalAlpha = 1;
    }
    for (const f of s.facilities) {
      if (f.kind === 'dock' || f.kind === 'reactor' || !f.known) continue;
      if (f.tiles.some((t) => s.revealed[t])) continue;
      const cx = (f.x + f.w / 2) * TS, cy = (f.y + f.h / 2) * TS;
      const sos = f.kind === 'factory';
      const col = sos ? '#ff4a3c' : '#ffcf6b';
      const k = (now * (sos ? 1.4 : 0.8) + f.id * 0.37) % 1;
      c.globalAlpha = (1 - k) * 0.8;
      ring(c, cx, cy, 3 + k * 16, 1, col);
      c.globalAlpha = Math.sin(now * (sos ? 6 : 3)) > 0 ? 1 : 0.4;
      px(c, Math.round(cx) - 1, Math.round(cy) - 1, 3, 3, col);
      c.globalAlpha = 1;
    }
    if (s.upgrades.scanner) {
      const e = s.ex, R = MD.BAL.detectRadius;
      const glint = (x, y, col) => {
        if (s.revealed[y * s.W + x]) return;
        if (Math.hypot(x - e.x, y - e.y) > R) return;
        const k = (now * 1.1 + U.hash(x, y, 9) * 3) % 1.6;
        c.globalAlpha = k < 0.8 ? 0.9 : 0.35;
        px(c, x * TS + 7, y * TS + 6, 2, 4, col); px(c, x * TS + 6, y * TS + 7, 4, 2, col);
        c.globalAlpha = 1;
      };
      for (const d of s.deposits) glint(d.x, d.y, d.kind === 'crystal' ? '#59dcff' : '#d8c3a0');
      for (const k in s.items) { const i = +k; glint(i % s.W, (i / s.W) | 0, s.items[k].kind === 'cell' ? '#7dff9a' : '#ffe9a0'); }
    }
  }

  // ---------------------------------------------------------------- overlays: plan, hover, selection

  function drawPlan(c, s, view, now) {
    const plan = view.plan;
    if (!plan || !plan.path.length) return;
    let cost = 0;
    for (let k = 0; k < plan.path.length; k++) {
      const i = plan.path[k], x = i % s.W, y = (i / s.W) | 0, X = x * TS, Y = y * TS;
      const info = s.revealed[i] ? MD.G.exStepInfo(s, i) : { cost: 1 };
      cost += info.cost || 0;
      const reach = k < plan.reach;
      const risky = plan.risky && plan.risky.has(k);
      const col = !reach ? '#ff5a4c' : risky ? '#ff9a4a' : info.cost ? '#8ff8ff' : '#ffe08a';
      c.globalAlpha = 0.75 + 0.25 * Math.sin(now * 6 - k * 0.5);
      if (info.cost) {
        px(c, X + 2, Y + 2, 12, 1, col); px(c, X + 2, Y + 13, 12, 1, col);
        px(c, X + 2, Y + 2, 1, 12, col); px(c, X + 13, Y + 2, 1, 12, col);
        if (info.cost === 2) { px(c, X + 5, Y + 5, 6, 6, col); }
        if (risky) { // lightning mark: a live floor here would overdraw the battery
          px(c, X + 8, Y + 4, 2, 1, col); px(c, X + 7, Y + 5, 2, 1, col); px(c, X + 6, Y + 6, 4, 1, col);
          px(c, X + 7, Y + 7, 2, 1, col); px(c, X + 6, Y + 8, 2, 1, col); px(c, X + 5, Y + 9, 2, 1, col);
        }
      } else px(c, X + 7, Y + 7, 2, 2, col);
    }
    c.globalAlpha = 1;
  }

  function drawHover(c, s, view, now) {
    const h = view.hover;
    if (!h || h.x < 0 || h.y < 0 || h.x >= s.W || h.y >= s.H) return;
    const X = h.x * TS, Y = h.y * TS;
    const col = view.hoverOk === false ? '#ff5a4c' : '#ffffff';
    c.globalAlpha = 0.85;
    px(c, X, Y, 4, 1, col); px(c, X, Y, 1, 4, col);
    px(c, X + 12, Y, 4, 1, col); px(c, X + 15, Y, 1, 4, col);
    px(c, X, Y + 15, 4, 1, col); px(c, X, Y + 12, 1, 4, col);
    px(c, X + 12, Y + 15, 4, 1, col); px(c, X + 15, Y + 12, 1, 4, col);
    c.globalAlpha = 1;
  }

  function drawSelection(c, s, view, now) {
    const sel = view.selection;
    if (!sel) return;
    let x0, y0, w, h;
    if (sel.fac != null) { const f = s.facilities[sel.fac]; x0 = f.x; y0 = f.y; w = f.w; h = f.h; }
    else if (sel.dep != null) { const d = s.deposits[sel.dep]; x0 = d.x; y0 = d.y; w = 1; h = 1; }
    else if (sel.robot != null) {
      const r = s.robots.find((o) => o.id === sel.robot);
      if (!r) return;
      x0 = r.x; y0 = r.y; w = 1; h = 1;
    } else return;
    const X = Math.round(x0 * TS) - 2, Y = Math.round(y0 * TS) - 2, W = w * TS + 4, H = h * TS + 4;
    const o = Math.floor(now * 4) % 2;
    c.globalAlpha = 0.9;
    c.strokeStyle = '#8ff8ff'; c.lineWidth = 1;
    c.setLineDash([3, 2]); c.lineDashOffset = o * 2;
    c.strokeRect(X + 0.5, Y + 0.5, W - 1, H - 1);
    c.setLineDash([]);
    c.globalAlpha = 1;
  }

  function drawAttention(c, s, now) {
    // bouncing arrows over things the player can act on right now
    for (const f of s.facilities) {
      if (f.state !== 'dormant' || !f.connected) continue;
      if (!MD.G.canRestore(s, f).ok) continue;
      const cx = Math.round((f.x + f.w / 2) * TS), y = f.y * TS - 6 + Math.round(Math.sin(now * 5) * 2);
      px(c, cx - 3, y, 7, 1, '#7dff9a'); px(c, cx - 2, y + 1, 5, 1, '#7dff9a'); px(c, cx - 1, y + 2, 3, 1, '#7dff9a'); px(c, cx, y + 3, 1, 1, '#7dff9a');
    }
    if (fx.highlight && now < fx.highlight.until) {
      const want = fx.highlight.kind === 'drill' ? T().RUBBLE : fx.highlight.kind === 'hover' ? T().CANAL : -1;
      c.globalAlpha = 0.5 + 0.4 * Math.sin(now * 8);
      for (let i = 0; i < s.tile.length; i++) {
        if (!s.revealed[i]) continue;
        const bur = fx.highlight.kind === 'scanner' && s.buried[i] && s.old[i];
        if (s.tile[i] !== want && !bur) continue;
        const x = i % s.W, y = (i / s.W) | 0;
        c.strokeStyle = '#8ff8ff'; c.lineWidth = 1;
        c.strokeRect(x * TS + 1.5, y * TS + 1.5, TS - 3, TS - 3);
      }
      c.globalAlpha = 1;
    }
    for (const m of fx.marks) {
      const k = m.life / m.max;
      c.globalAlpha = 1 - k;
      const X = m.x * TS, Y = m.y * TS;
      for (let d = 0; d < 10; d++) { px(c, X + 3 + d, Y + 3 + d, 1, 1, m.col); px(c, X + 12 - d, Y + 3 + d, 1, 1, m.col); }
      c.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------- main draw

  RV.draw = function (s, view, now, dt) {
    if (!S || S !== s) RV.attach(s);
    stepFx(dt);
    for (const k in disp) disp[k] = disp[k] + U.clamp(s.districtLight[k] - disp[k], -dt * 0.3, dt * 0.22);
    if (terrainDirty) buildTerrain(s);
    updateFog(s);

    const c = wctx;
    c.imageSmoothingEnabled = false;
    c.drawImage(terrain, 0, 0);
    // animated coolant
    for (let i = 0; i < s.tile.length; i++) {
      if (s.tile[i] !== T().CANAL || !s.revealed[i]) continue;
      const x = i % s.W, y = (i / s.W) | 0, X = x * TS, Y = y * TS;
      for (let k = 0; k < 3; k++) {
        const ox = Math.floor((now * 6 + U.hash(x, y, k) * 16 + k * 5) % 14) + 1;
        px(c, X + ox, Y + 3 + k * 4, 3, 1, k === 1 ? C.canalHi : C.canal2);
      }
    }
    drawHazards(c, s, now, false);
    drawCablesBase(c, s, now);
    drawRelays(c, s, now, false);
    drawLamps(c, s, now, false);
    drawBreaks(c, s, now, false);
    drawDeposits(c, s, now, false);
    for (const f of s.facilities) drawFacility(c, s, f, now, false);
    drawItems(c, s, now, false);
    drawRobots(c, s, now, false);
    drawExplorer(c, s, now, false);
    drawParticles(c, false);

    drawLighting(s, now);

    c.imageSmoothingEnabled = false;
    drawWindows(c);
    drawCablesEmit(c, s, now);
    drawHazards(c, s, now, true);
    drawRelays(c, s, now, true);
    drawLamps(c, s, now, true);
    drawBreaks(c, s, now, true);
    drawDeposits(c, s, now, true);
    for (const f of s.facilities) drawFacility(c, s, f, now, true);
    drawItems(c, s, now, true);
    drawRobots(c, s, now, true);
    drawExplorer(c, s, now, true);
    drawParticles(c, true);
    drawRings(c);
    drawBloom(c, s, now);
    drawGrade(s, now);

    drawFog(s, now);
    c.imageSmoothingEnabled = false;
    drawOverFog(c, s, now, view);
    drawAttention(c, s, now);
    drawPlan(c, s, view, now);
    drawHover(c, s, view, now);
    drawSelection(c, s, view, now);

    // ---- blit to screen
    const z = RV.cam.zoom * dpr;
    let ox = canvas.width / 2 - RV.cam.x * z, oy = canvas.height / 2 - RV.cam.y * z;
    if (fx.shake > 0) { ox += (Math.random() - 0.5) * fx.shake * 4 * dpr; oy += (Math.random() - 0.5) * fx.shake * 4 * dpr; }
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = C.void;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(world, Math.round(ox), Math.round(oy), Math.round(world.width * z), Math.round(world.height * z));

    // ---- screen-space text
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.textAlign = 'center';
    for (const t of fx.texts) {
      const k = t.life / t.max;
      const p = RV.worldToScreen(t.x, t.y + t.dy * U.easeOutCubic(Math.min(1, k * 1.6)));
      ctx.globalAlpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      ctx.font = (t.big ? '22px' : '14px') + ' "DotGothic16", "MS Gothic", monospace';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(5,6,12,0.9)';
      ctx.strokeText(t.text, p.x, p.y);
      ctx.fillStyle = t.col;
      ctx.fillText(t.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
    if (view.planLabel) {
      const L = view.planLabel;
      const p = RV.worldToScreen((L.x + 0.5) * TS, L.y * TS - 2);
      ctx.font = '14px "DotGothic16", "MS Gothic", monospace';
      const w = ctx.measureText(L.text).width + 12;
      ctx.fillStyle = 'rgba(8,10,20,0.88)';
      ctx.fillRect(p.x - w / 2, p.y - 24, w, 20);
      ctx.strokeStyle = L.col; ctx.lineWidth = 1;
      ctx.strokeRect(p.x - w / 2 + 0.5, p.y - 23.5, w - 1, 19);
      ctx.fillStyle = L.col;
      ctx.fillText(L.text, p.x, p.y - 9);
    }
    // off-screen pointer to the current objective
    if (view.pointer) {
      const P = view.pointer;
      const p = RV.worldToScreen(P.x, P.y);
      const vw = window.innerWidth, vh = window.innerHeight, m = 46;
      if (p.x < m || p.y < m || p.x > vw - m || p.y > vh - m) {
        const cx = vw / 2, cy = vh / 2, ang = Math.atan2(p.y - cy, p.x - cx);
        const ex = U.clamp(p.x, m + 200, vw - m - 300), ey = U.clamp(p.y, m + 60, vh - m - 40);
        ctx.save(); ctx.translate(ex, ey); ctx.rotate(ang);
        ctx.globalAlpha = 0.75 + 0.25 * Math.sin(now * 5);
        ctx.fillStyle = P.col || '#ffcf6b';
        ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-6, -9); ctx.lineTo(-2, 0); ctx.lineTo(-6, 9); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();
  };

  RV.TS = TS;
})(typeof window !== 'undefined' ? window : globalThis);

/* MECHANICAL DAWN — sprites.js : hand-made pixel sprites rendered to offscreen canvases */
(function (root) {
  'use strict';
  const MD = root.MD;
  const SP = MD.Sprites = {};

  const PAL = {
    k: '#120f1a', K: '#26222f',
    g: '#b4b9c8', G: '#7b8294', d: '#4c5262', D: '#343846',
    Y: '#ffcc33', y: '#b8860f',
    N: '#5fd477', n: '#2e8b4a',
    B: '#5fa9ff', b: '#2d5fa6',
    O: '#ff8a3d', o: '#b5531c',
    W: '#f3e7c9', w: '#c4b48f',
    R: '#ff5a4c', r: '#8c2a24',
    C: '#a77b49', c: '#6e4f2c',
    T: '#3a3644', t: '#5d5868',
    S: '#9a9eab', s: '#5e6270',
    P: '#c08bff',
    // emissive pixels (also copied to the glow layer)
    E: '#8ff8ff', V: '#ffe9a0', L: '#fff6d8', Z: '#ff6b5b', X: '#7dff9a', Q: '#8fd3ff',
  };
  const EMISSIVE = 'EVLZXQ';

  function make(rows, pal) {
    pal = pal || PAL;
    const h = rows.length, w = rows[0].length;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const e = document.createElement('canvas'); e.width = w; e.height = h;
    const cx = c.getContext('2d'), ex = e.getContext('2d');
    let hasE = false;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (ch === '.' || ch === ' ') continue;
      const col = pal[ch];
      if (!col) continue;
      cx.fillStyle = col; cx.fillRect(x, y, 1, 1);
      if (EMISSIVE.indexOf(ch) >= 0) { ex.fillStyle = col; ex.fillRect(x, y, 1, 1); hasE = true; }
    }
    return { c, e: hasE ? e : null, w, h };
  }

  function flip(sp) {
    const f = (src) => {
      if (!src) return null;
      const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
      const x = c.getContext('2d'); x.translate(src.width, 0); x.scale(-1, 1); x.drawImage(src, 0, 0);
      return c;
    };
    return { c: f(sp.c), e: f(sp.e), w: sp.w, h: sp.h };
  }

  function pair(rows, pal) { const r = make(rows, pal); return { r, l: flip(r) }; }

  // ---------------------------------------------------------------- explorer "HOTARU"
  const HOTARU_A = [
    '......LL....',
    '......t.....',
    '...kkkkkk...',
    '..kWWWWWWk..',
    '.kWWWWkkkWk.',
    '.kWWWkEEEkk.',
    '.kwWWkEEEkk.',
    '.kwWWWkkkWk.',
    '.kooOOOOOOk.',
    '.kwwWWWWWwk.',
    '..kTtTtTtk..',
    '..kkkkkkkk..',
  ];
  const HOTARU_B = HOTARU_A.slice(0, 10).concat(['..ktTtTtTk..', '..kkkkkkkk..']);

  // ---------------------------------------------------------------- NPC robots
  function robotRows(main, dark, visor, top, side) {
    const base = [
      '............',
      '............',
      '............',
      '...kkkkkk...',
      '..kMMMMMMk..',
      '..kMMMkVVk..',
      '..kMMMkVVk..',
      '..kmmmmmmk..',
      '..kmMMMMmk..',
      '...kkkkkk...',
      '...kTk.kTk..',
      '....k...k...',
    ].map((r) => r.replace(/M/g, main).replace(/m/g, dark).replace(/V/g, visor));
    const out = base.map((r) => r.split(''));
    const overlay = (rows) => rows.forEach((r, y) => r.split('').forEach((ch, x) => { if (ch !== '.') out[y][x] = ch; }));
    if (top) overlay(top);
    if (side) overlay(side);
    return out.map((r) => r.join(''));
  }

  const ROBOT_DEF = {
    scrap: robotRows('S', 's', 'V',
      ['............', '...YYYYYY...', '..yYYYYYYYL.', '..kyyyyyyk..'],
      ['............', '............', '............', '............', '............', '............', '............',
        '..........k.', '.........dGd', '..........k.']),
    crystal: robotRows('S', 's', 'Q',
      ['............', '...YYYYYY...', '..yYYYYYYYL.', '..kyyyyyyk..'],
      ['............', '............', '............', '............', '............', '............', '............',
        '..........k.', '.........dQd', '..........k.']),
    haul: robotRows('N', 'n', 'V',
      ['..kkkkkkk...', '..kCCCCCk...', '..kcCCCck...', '..kkkkkkk...']),
    repair: robotRows('B', 'b', 'V',
      ['......Z.....', '......k.....', '......k.....', '............'],
      ['............', '............', '............', '............', '............', '..........G.',
        '.........GkG', '..........G.']),
    idle: robotRows('G', 'd', 'K', null),
    parade: robotRows('W', 'w', 'E', ['.....L......', '.....k......', '............', '............']),
  };

  // ---------------------------------------------------------------- items & icons
  const ITEM_ROWS = {
    scrap: [
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '.......kk.......',
      '......kgGk......',
      '....kkGddGkk....',
      '...kSgGkkGgSk...',
      '...kSSgGGgSSk...',
      '....kkSSSSkk....',
      '......kkkk......',
      '................',
      '................',
      '................',
    ],
    crystal: [
      '................',
      '................',
      '................',
      '................',
      '................',
      '........k.......',
      '.......kQk......',
      '......kQEQk.....',
      '.....kQEQbk.k...',
      '.....kQQbbkkQk..',
      '.....kbQbbkQbk..',
      '.....kkbbkkkk...',
      '......kkkk......',
      '................',
      '................',
      '................',
    ],
    cell: [
      '................',
      '................',
      '................',
      '................',
      '.......kk.......',
      '......kddk......',
      '.....kddddk.....',
      '.....kXXXXk.....',
      '.....kXXXXk.....',
      '.....kdddddk....',
      '.....kXXXXk.....',
      '.....kXXXXk.....',
      '.....kkkkkk.....',
      '................',
      '................',
      '................',
    ],
    log: [
      '................',
      '................',
      '................',
      '................',
      '................',
      '....kkkkkkkk....',
      '...kddddddddk...',
      '...kdQQQQQQdk...',
      '...kdQkkkkQdk...',
      '...kdQQQQQQdk...',
      '...kddddddVdk...',
      '....kkkkkkkk....',
      '....k......k....',
      '................',
      '................',
      '................',
    ],
    bot: [
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '....kkkkkk......',
      '...kGGGGGGk.....',
      '...kGGGkKKk.....',
      '...kddddddk.....',
      '...kdGGGGdkk....',
      '....kkkkkkTk....',
      '....kTk..kk.....',
      '................',
      '................',
    ],
  };

  SP.init = function () {
    SP.hotaru = [pair(HOTARU_A), pair(HOTARU_B)];
    SP.robots = {};
    for (const k in ROBOT_DEF) SP.robots[k] = pair(ROBOT_DEF[k]);
    SP.items = {};
    for (const k in ITEM_ROWS) SP.items[k] = make(ITEM_ROWS[k]);
    SP.glow = {};
    SP.light = radial(64, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.85)'], [0.7, 'rgba(255,255,255,0.3)'], [1, 'rgba(255,255,255,0)']]);
  };

  function radial(size, stops) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const [o, col] of stops) g.addColorStop(o, col);
    x.fillStyle = g; x.fillRect(0, 0, size, size);
    return c;
  }

  // Coloured soft glow sprite, cached per colour.
  SP.glowSprite = function (color) {
    let g = SP.glow[color];
    if (!g) {
      const m = /^#(..)(..)(..)$/.exec(color);
      const r = parseInt(m[1], 16), gg = parseInt(m[2], 16), b = parseInt(m[3], 16);
      g = radial(64, [[0, `rgba(${r},${gg},${b},0.9)`], [0.3, `rgba(${r},${gg},${b},0.45)`], [1, `rgba(${r},${gg},${b},0)`]]);
      SP.glow[color] = g;
    }
    return g;
  };

  SP.PAL = PAL;
})(typeof window !== 'undefined' ? window : globalThis);

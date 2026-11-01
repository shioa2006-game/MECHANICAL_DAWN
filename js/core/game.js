/* MECHANICAL DAWN — game.js : rules, explorer, power grid, facilities (no DOM) */
(function (root) {
  'use strict';
  const MD = root.MD;
  const U = MD.U, BAL = MD.BAL;
  const G = MD.G = {};
  const T = G.T = { BUILDING: 0, STREET: 1, RUBBLE: 2, CANAL: 3, DEPOSIT: 4, FACILITY: 5, CONVEYOR: 6 };

  // ------------------------------------------------------------------ creation

  // cable[i]: 0 none, 1 permanent, 2 provisional (laid this sortie, not yet conducting)
  G.newGame = function (opts) {
    opts = opts || {};
    const rows = MD.MAP, H = rows.length, W = rows[0].length, N = W * H;
    const fill = (v) => new Array(N).fill(v);
    const s = {
      v: 3, W, H, time: 0, seed: opts.seed != null ? opts.seed : (Math.random() * 1e9) | 0,
      tile: fill(T.BUILDING), old: fill(0), buried: fill(0), cable: fill(0),
      powered: fill(0), pdist: fill(-1), volt: fill(-99), revealed: fill(0),
      hz: fill(0), hzKnown: fill(0), hzN: fill(0), relays: [],
      lampAt: fill(-1), facAt: fill(-1), depAt: fill(-1),
      items: {}, lamps: [], breaks: {}, facilities: [], deposits: [], conveyor: null,
      robots: [], nextRobotId: 1, buildQueue: [], reserve: 0,
      res: { scrap: 0, crystal: 0 },
      upgrades: {},
      ex: null,
      stats: {
        sorties: 0, cables: 0, robotsBuilt: 0, robotsFound: 0, pickups: 0,
        delivered: { scrap: 0, crystal: 0 }, recent: [], cascades: 0, recalls: 0, lostTiles: 0,
      },
      flags: {},
      districtLight: { sw: 0.06, ind: 0, nw: 0, core: 0 },
      restoration: 0,
      trickleT: 0,
      gridVersion: 0,
      oldTotal: 0,
      logsRead: [],
      events: [],
      won: false, wonAt: 0,
      sat: 1, tripT: 0,
    };

    const facBounds = {};
    const conveyorTiles = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const ch = rows[y][x], i = y * W + x;
        let t = T.STREET;
        switch (ch) {
          case '#': t = T.BUILDING; break;
          case '.': break;
          case 'r': t = T.RUBBLE; break;
          case '~': t = T.CANAL; break;
          case '=': s.old[i] = 1; break;
          case 'u': s.old[i] = 1; s.buried[i] = 1; break;
          case 'l': case 'L':
            s.old[i] = 1;
            s.lampAt[i] = s.lamps.length;
            s.lamps.push({ i, x, y, broken: ch === 'L', work: 0, lit: false });
            break;
          case 'x': s.old[i] = 2; s.breaks[i] = { work: 0 }; break;
          case 'o': s.items[i] = { kind: 'scrap', amount: BAL.scrapPile }; break;
          case 'c': s.items[i] = { kind: 'crystal', amount: BAL.crystalPile }; break;
          case '+': s.items[i] = { kind: 'cell' }; break;
          case 'z': s.items[i] = { kind: 'bot' }; break;
          case '?': {
            const li = MD.LOGS.findIndex((l) => l.x === x && l.y === y);
            s.items[i] = { kind: 'log', log: li };
            break;
          }
          case 'S': case 'C':
            t = T.DEPOSIT;
            s.depAt[i] = s.deposits.length;
            s.deposits.push({
              id: s.deposits.length, kind: ch === 'S' ? 'scrap' : 'crystal', i, x, y,
              buffer: 0, reserved: 0, cap: BAL.depositCap, slots: BAL.depositSlots,
              connected: false, known: false, mined: 0,
            });
            break;
          case '<': case '>': case '^': case 'v':
            t = T.CONVEYOR; conveyorTiles.push({ x, y, ch }); break;
          default:
            if (MD.FAC[ch]) {
              t = T.FACILITY;
              const b = facBounds[ch] || (facBounds[ch] = { x0: x, y0: y, x1: x, y1: y });
              b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y);
              b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y);
            }
        }
        s.tile[i] = t;
        if (s.old[i]) s.oldTotal++;
      }
    }

    // Facilities (dock first so it has id 0)
    const order = Object.keys(facBounds).sort((a, b) => (a === 'D' ? -1 : b === 'D' ? 1 : 0));
    for (const ch of order) {
      const b = facBounds[ch], def = MD.FAC[ch];
      const f = {
        id: s.facilities.length, ch, kind: def.kind, name: def.name,
        x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1,
        state: def.startActive ? 'active' : 'dormant', work: 0, need: def.work || 0,
        connected: !!def.startActive, known: !!(def.startActive || def.beaconAtStart || def.kind === 'reactor'),
        seen: !!def.startActive, activatedAt: 0,
      };
      f.tiles = [];
      for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) {
        const i = y * W + x; f.tiles.push(i); s.facAt[i] = f.id;
      }
      s.facilities.push(f);
    }

    // Conveyor (one in this map): order tiles from source to sink
    if (conveyorTiles.length) {
      const dir = { '<': [-1, 0], '>': [1, 0], '^': [0, -1], 'v': [0, 1] }[conveyorTiles[0].ch];
      const set = new Set(conveyorTiles.map((c) => c.y * W + c.x));
      let start = conveyorTiles.find((c) => !set.has((c.y - dir[1]) * W + (c.x - dir[0])));
      const path = [];
      let cx = start.x, cy = start.y;
      while (set.has(cy * W + cx)) { path.push(cy * W + cx); cx += dir[0]; cy += dir[1]; }
      const def = MD.CONVEYOR_DEF;
      const f = {
        id: s.facilities.length, ch: 'conveyor', kind: 'conveyor', name: def.name,
        x: Math.min(...conveyorTiles.map((c) => c.x)), y: Math.min(...conveyorTiles.map((c) => c.y)),
        w: 0, h: 0, state: 'dormant', work: 0, need: def.work, connected: false, known: false, seen: false,
        tiles: path.slice(), activatedAt: 0, dir,
      };
      f.w = Math.max(...conveyorTiles.map((c) => c.x)) - f.x + 1;
      f.h = Math.max(...conveyorTiles.map((c) => c.y)) - f.y + 1;
      for (const i of path) s.facAt[i] = f.id;
      s.facilities.push(f);
      const srcI = (start.y - dir[1]) * W + (start.x - dir[0]);
      const endI = path[path.length - 1];
      const sinkI = endI + dir[1] * W + dir[0];
      s.conveyor = { fac: f.id, path, src: s.depAt[srcI], sink: s.facAt[sinkI], items: [], t: 0 };
    }

    const dock = G.dock(s);
    s.ex = {
      x: dock.x + 1, y: dock.y + 1, fx: dock.x + 1, fy: dock.y + 1,
      path: [], keyq: [], goal: null, moving: false, from: null, to: null, stepT: 0, stepDur: 0, stepInfo: null,
      battery: BAL.startBattery, mode: 'home', facing: 1, idleT: 0, ret: null,
      cells: 0, batBonus: 0, sortie: G.freshSortie(), temp: [], undo: [], shortT: 0,
    };
    if (opts.hazards !== false) placeHazards(s);
    for (const i of dock.tiles) G.revealTile(s, i);
    G.revealAround(s, s.ex.x, s.ex.y, BAL.revealRadius + 1.6);
    G.recomputeGrid(s, true);
    s.restoration = G.computeRestoration(s);
    return s;
  };

  G.freshSortie = () => ({ newTiles: 0, scrap: 0, crystal: 0, found: [], lost: 0 });

  // Live floors: hidden on plain streets, kept away from the dock and from anything worth reaching
  // so that the hazard is always a choice about the route, never about the goal itself.
  function placeHazards(s) {
    const W = s.W, H = s.H, d = G.dock(s);
    const dcx = d.x + 1, dcy = d.y + 1;
    const near8 = (i, pred) => {
      const x = i % W, y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (G.inb(s, nx, ny) && pred(ny * W + nx)) return true;
      }
      return false;
    };
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (s.tile[i] !== T.STREET || s.old[i] || s.items[i]) continue;
      if (Math.abs(x - dcx) + Math.abs(y - dcy) <= BAL.hazardSafeRadius) continue;
      if (near8(i, (n) => s.facAt[n] >= 0 || s.depAt[n] >= 0 || !!s.items[n] || s.hz[n])) continue;
      if (G.rand(s) < BAL.hazardRate) s.hz[i] = 1;
    }
    for (let i = 0; i < W * H; i++) {
      let n = 0;
      near8(i, (k) => { n += s.hz[k]; return false; });
      s.hzN[i] = n;
    }
  }

  // ------------------------------------------------------------------ queries

  G.idx = (s, x, y) => y * s.W + x;
  G.inb = (s, x, y) => x >= 0 && y >= 0 && x < s.W && y < s.H;
  G.dock = (s) => s.facilities[0];
  G.facByCh = (s, ch) => s.facilities.find((f) => f.ch === ch);
  G.factory = (s) => G.facByCh(s, 'F');
  G.reactor = (s) => G.facByCh(s, 'X');
  G.def = (f) => (f.kind === 'conveyor' ? MD.CONVEYOR_DEF : MD.FAC[f.ch]);
  G.isConductive = (s, i) => s.cable[i] === 1 || s.old[i] === 1;
  G.isDockTile = (s, i) => s.facAt[i] === 0;
  G.rand = function (s) { // mulberry32 on state
    s.seed = (s.seed + 0x6D2B79F5) | 0;
    let t = s.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  G.substations = (s) => s.facilities.filter((f) => f.kind === 'substation');
  G.activeSubs = (s) => G.substations(s).filter((f) => f.state === 'active').length;

  G.maxBattery = (s) => BAL.startBattery + s.ex.batBonus + s.ex.cells * BAL.cellBonus +
    G.substations(s).reduce((a, f) => a + (f.state === 'active' ? MD.FAC[f.ch].battery : 0), 0);

  // ---- power economy: generation is a rate, not a stock. Everything that runs draws from it at
  // once; when the draw exceeds the generation the whole city slows to supply / demand.
  G.genBonus = (s) => (s.upgrades.gen1 ? 1 : 0) + (s.upgrades.gen2 ? 1 : 0);
  G.supplyOf = (s, f) => (f.state === 'active' && G.def(f).power ? G.def(f).power + G.genBonus(s) : 0);
  G.supply = (s) => s.facilities.reduce((a, f) => a + G.supplyOf(s, f), 0);
  G.demandParts = function (s) {
    const parts = { scrap: 0, crystal: 0, haul: 0, repair: 0, relay: 0, conveyor: 0 };
    for (const r of s.robots) if (BAL.upkeep[r.role]) parts[r.role] += BAL.upkeep[r.role];
    parts.relay = s.relays.length * BAL.relayUpkeep;
    const c = s.conveyor && s.facilities[s.conveyor.fac];
    if (c && c.state === 'active') parts.conveyor = BAL.conveyorUpkeep;
    return parts;
  };
  G.demand = (s) => { const p = G.demandParts(s); let n = 0; for (const k in p) n += p[k]; return n; };
  // Share of the demand the generators cover, and the work speed that follows from it: machines
  // lose efficiency faster than the supply drops (speed = cover²), so running more than the grid
  // carries is a net loss rather than a free way to queue work. 0 while the breakers are tripped.
  G.coverage = function (s) {
    const d = G.demand(s);
    return d <= 0 ? 1 : Math.min(1, G.supply(s) / d);
  };
  G.satisfaction = function (s) {
    if (s.tripT > 0) return 0;
    const c = G.coverage(s);
    return c * c;
  };
  G.robotTotal = (s) => s.robots.filter((r) => r.role !== 'parade').length + s.buildQueue.length;

  G.neighborsOf = function (s, i) {
    const x = i % s.W, y = (i / s.W) | 0, out = [];
    for (const [dx, dy] of U.DIRS) {
      const nx = x + dx, ny = y + dy;
      if (G.inb(s, nx, ny)) out.push(ny * s.W + nx);
    }
    return out;
  };

  // Powered tiles adjacent to the given tiles (robot work spots).
  G.spotsAround = function (s, tiles) {
    const set = new Set(tiles), out = [];
    for (const t of tiles) for (const n of G.neighborsOf(s, t)) {
      if (!set.has(n) && s.powered[n] && out.indexOf(n) < 0) out.push(n);
    }
    return out;
  };

  G.touchesPower = (s, tiles) => tiles.some((t) => G.neighborsOf(s, t).some((n) => s.powered[n]));

  G.adjacentTo = function (s, tiles, x, y) {
    const i = y * s.W + x;
    return G.neighborsOf(s, i).some((n) => tiles.indexOf(n) >= 0);
  };

  // ------------------------------------------------------------------ fog of war

  G.revealTile = function (s, i) {
    if (s.revealed[i]) return;
    s.revealed[i] = 1;
    const fi = s.facAt[i];
    if (fi >= 0) {
      const f = s.facilities[fi];
      if (!f.seen) {
        f.seen = true;
        for (const t of f.tiles) s.revealed[t] = 1; // seeing part of a building reveals all of it
        const wasKnown = f.known;
        f.known = true;
        if (f.kind !== 'dock') {
          s.events.push({ type: 'discover', fac: f.id, wasKnown });
          if (s.ex && s.ex.sortie) s.ex.sortie.found.push(f.name);
        }
      }
    }
    const di = s.depAt[i];
    if (di >= 0 && !s.deposits[di].known) {
      s.deposits[di].known = true;
      s.events.push({ type: 'discoverDep', dep: di });
      if (s.ex && s.ex.sortie) s.ex.sortie.found.push(s.deposits[di].kind === 'scrap' ? 'スクラップ山' : '結晶鉱脈');
    }
  };

  G.revealAround = function (s, cx, cy, r) {
    const scan = r == null && s.upgrades.scanner; // the explorer's own scanner also exposes live floors
    if (r == null) r = s.upgrades.scanner ? BAL.scannerRadius : BAL.revealRadius;
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const x = cx + dx, y = cy + dy;
      if (!G.inb(s, x, y)) continue;
      const i = y * s.W + x;
      G.revealTile(s, i);
      if (scan && s.hz[i] && !s.hzKnown[i]) s.hzKnown[i] = 1;
    }
    // distant facilities start broadcasting a beacon when the explorer comes close
    for (const f of s.facilities) {
      if (f.known) continue;
      const fx = f.x + f.w / 2, fy = f.y + f.h / 2;
      if (Math.hypot(fx - cx, fy - cy) <= BAL.signalRadius) {
        f.known = true;
        s.events.push({ type: 'signal', fac: f.id });
      }
    }
  };

  // ------------------------------------------------------------------ power grid

  // Power sources: the dock, active substations and relay towers each push power a limited number
  // of tiles of new cable (their reach); the old city lines carry it without loss.
  // volt[i] is the reach left at tile i: powered when >= 0, NO_VOLT when no source reaches it at all.
  const NO_VOLT = -99;
  G.NO_VOLT = NO_VOLT;
  // A surge-damaged substation keeps carrying power along the grid; it only stops generating.
  G.sourceReach = (f) => ((f.state === 'active' || f.damaged) && G.def(f).reach) || 0;
  const lossOf = (s, i) => (s.old[i] === 1 ? 0 : 1);

  function computeVolt(s, relays) {
    const N = s.W * s.H;
    const volt = new Array(N).fill(NO_VOLT);
    const seeds = [];
    const seed = (i, v) => {
      if (G.isConductive(s, i) && v > volt[i]) { volt[i] = v; seeds.push(i); }
    };
    for (const f of s.facilities) {
      const r = G.sourceReach(f);
      if (!r) continue;
      for (const t of f.tiles) for (const n of G.neighborsOf(s, t)) seed(n, r - lossOf(s, n));
    }
    for (const r of relays) seed(r, BAL.relayReach);
    const q = seeds.slice();
    for (let h = 0; h < q.length; h++) {
      const c = q[h];
      for (const n of G.neighborsOf(s, c)) {
        if (!G.isConductive(s, n)) continue;
        const v = volt[c] - lossOf(s, n);
        if (v > volt[n]) { volt[n] = v; q.push(n); }
      }
    }
    return { volt, seeds };
  }

  G.recomputeGrid = function (s, silent) {
    const W = s.W, N = W * s.H;
    const prev = s.powered;
    const { volt, seeds } = computeVolt(s, s.relays);
    const pw = new Array(N).fill(0), pd = new Array(N).fill(-1);
    for (let i = 0; i < N; i++) if (volt[i] >= 0) pw[i] = 1;
    // hop distance from the nearest source, only for the travelling-light animation
    const hq = [];
    for (const i of seeds) if (pw[i] && pd[i] < 0) { pd[i] = 1; hq.push(i); }
    for (let h = 0; h < hq.length; h++) {
      const c = hq[h];
      for (const n of G.neighborsOf(s, c)) if (pw[n] && pd[n] < 0) { pd[n] = pd[c] + 1; hq.push(n); }
    }
    s.volt = volt;
    const newly = [];
    for (let i = 0; i < N; i++) if (pw[i] && !prev[i]) newly.push(i);
    s.powered = pw;
    s.pdist = pd;
    s.gridVersion++;

    if (!silent && newly.length) {
      const oldNew = newly.filter((i) => s.old[i] === 1 && !s.cable[i]);
      if (oldNew.length) {
        let base = Infinity;
        for (const i of oldNew) base = Math.min(base, pd[i]);
        // the cascade animation starts at the tile closest to where the connection was made
        s.events.push({ type: 'energize', tiles: oldNew.map((i) => [i, pd[i] - base]) });
        s.stats.cascades++;
      }
    }
    for (const L of s.lamps) {
      const lit = !L.broken && !!pw[L.i];
      if (lit && !L.lit && !silent) s.events.push({ type: 'lampOn', lamp: s.lampAt[L.i] });
      L.lit = lit;
    }
    G.updateConnections(s, silent);
  };

  G.updateConnections = function (s, silent) {
    for (const f of s.facilities) {
      if (f.connected) continue;
      if (G.touchesPower(s, f.tiles)) {
        f.connected = true;
        f.known = true;
        if (!silent) s.events.push({ type: 'connect', fac: f.id });
      }
    }
    for (const d of s.deposits) {
      if (d.connected) continue;
      if (G.touchesPower(s, [d.i])) {
        d.connected = true;
        d.known = true;
        if (!silent) s.events.push({ type: 'connectDep', dep: d.id });
      }
    }
  };

  // ------------------------------------------------------------------ explorer

  // What happens if the explorer enters tile i.
  G.exStepInfo = function (s, i) {
    if (G.isDockTile(s, i)) return { ok: true, cost: 0, kind: 'dock' };
    if (s.old[i] === 2) return { ok: false, why: 'break' };
    if (G.isConductive(s, i) || s.cable[i] === 2) return { ok: true, cost: 0, kind: 'grid' };
    const t = s.tile[i];
    if (t === T.STREET) {
      return s.hz[i] && s.hzKnown[i] ? { ok: true, cost: 1 + BAL.hazardDrain, kind: 'hazard' } : { ok: true, cost: 1, kind: 'new' };
    }
    if (t === T.RUBBLE) return s.upgrades.drill ? { ok: true, cost: 2, kind: 'rubble' } : { ok: false, why: 'rubble' };
    if (t === T.CANAL) return s.upgrades.hover ? { ok: true, cost: 1, kind: 'canal' } : { ok: false, why: 'canal' };
    return { ok: false, why: t === T.DEPOSIT ? 'deposit' : t === T.FACILITY ? 'facility' : t === T.CONVEYOR ? 'conveyor' : 'wall' };
  };

  // Planning view of a tile: unknown tiles are treated optimistically as plain ground.
  function planInfo(s, i) {
    if (!s.revealed[i]) {
      const x = i % s.W, y = (i / s.W) | 0;
      if (x <= 0 || y <= 0 || x >= s.W - 1 || y >= s.H - 1) return { ok: false };
      return { ok: true, cost: 1, kind: 'unknown' };
    }
    return G.exStepInfo(s, i);
  }

  // Dijkstra: minimise battery first, then steps. Returns null if unreachable.
  G.planPath = function (s, tx, ty, fromX, fromY) {
    const e = s.ex;
    const sx = fromX != null ? fromX : e.x, sy = fromY != null ? fromY : e.y;
    if (!G.inb(s, tx, ty)) return null;
    const W = s.W, N = W * s.H, start = sy * W + sx, goal = ty * W + tx;
    if (start === goal) return { path: [], cost: 0, steps: 0, reach: 0, unknown: 0 };
    const gi = planInfo(s, goal);
    if (!gi.ok) return null;
    const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
    const heap = [];
    const push = (i, d) => {
      heap.push([d, i]);
      let k = heap.length - 1;
      while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1, r = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
        }
      }
      return top;
    };
    dist[start] = 0;
    push(start, 0);
    while (heap.length) {
      const [d, c] = pop();
      if (d > dist[c]) continue;
      if (c === goal) break;
      for (const n of G.neighborsOf(s, c)) {
        const info = planInfo(s, n);
        if (!info.ok) continue;
        const w = info.cost * 1000 + 1 + (info.kind === 'unknown' ? 0.4 : 0);
        const nd = d + w;
        if (nd < dist[n]) { dist[n] = nd; prev[n] = c; push(n, nd); }
      }
    }
    if (dist[goal] === Infinity) return null;
    const path = [];
    for (let c = goal; c !== start; c = prev[c]) path.push(c);
    path.reverse();
    let cost = 0, reach = path.length, unknown = 0;
    for (let k = 0; k < path.length; k++) {
      const info = planInfo(s, path[k]);
      if (info.kind === 'unknown') unknown++;
      cost += info.cost;
      if (cost > e.battery && reach === path.length) reach = k;
    }
    return { path, cost, steps: path.length, reach, unknown };
  };

  // Cheapest plan to stand next to any of the given tiles (facility / deposit "go there").
  G.planAdjacent = function (s, tiles) {
    const e = s.ex, fx = e.moving ? e.to.x : e.x, fy = e.moving ? e.to.y : e.y;
    const seen = new Set();
    let best = null;
    for (const t of tiles) for (const n of G.neighborsOf(s, t)) {
      if (tiles.indexOf(n) >= 0 || seen.has(n)) continue;
      seen.add(n);
      const p = G.planPath(s, n % s.W, (n / s.W) | 0, fx, fy);
      if (p && (!best || p.cost < best.cost || (p.cost === best.cost && p.steps < best.steps))) best = p;
    }
    return best;
  };

  G.cmdGoAdjacent = function (s, tiles) {
    if (!G.canCommand(s)) return false;
    const p = G.planAdjacent(s, tiles);
    if (!p) return false;
    s.ex.path = p.path;
    s.ex.keyq = [];
    s.ex.goal = { tiles: tiles.slice(), tries: 0 };
    return true;
  };

  G.canCommand = (s) => !s.won && s.ex.mode !== 'returning' && s.ex.mode !== 'shorted';

  // A tile the explorer has not proven safe and that a spark hint (or darkness) leaves in doubt.
  G.maybeHazard = function (s, i) {
    if (s.cable[i] || s.old[i] || s.hzKnown[i] || s.tile[i] !== T.STREET && s.revealed[i]) return false;
    if (!s.revealed[i]) return true;
    const x = i % s.W, y = (i / s.W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if ((dx || dy) && G.inb(s, nx, ny) && s.revealed[ny * s.W + nx] && s.hzN[ny * s.W + nx]) return true;
    }
    return false;
  };

  G.cmdMoveTo = function (s, tx, ty) {
    if (!G.canCommand(s)) return false;
    const e = s.ex;
    const fx = e.moving ? e.to.x : e.x, fy = e.moving ? e.to.y : e.y;
    const plan = G.planPath(s, tx, ty, fx, fy);
    if (!plan || !plan.path.length) return false;
    e.path = plan.path;
    e.keyq = [];
    e.goal = { x: tx, y: ty, tries: 0 };
    return true;
  };

  // Keyboard step. Up to two presses are buffered; auto-repeat only refills an empty buffer
  // so that holding a key never overshoots (every step can cost battery).
  G.cmdStep = function (s, dx, dy, repeat) {
    if (!G.canCommand(s)) return false;
    const e = s.ex;
    if (!e.keyq) e.keyq = [];
    if (repeat && e.keyq.length) return false;
    if (e.path.length) e.path = [];
    e.goal = null;
    if (e.keyq.length >= 2) e.keyq.shift();
    e.keyq.push([dx, dy]);
    return true;
  };

  G.cmdStop = function (s) { s.ex.path = []; s.ex.keyq = []; s.ex.goal = null; };

  // A click-path planned through unexplored tiles may hit a wall once it is revealed:
  // re-plan towards the same goal a few times before giving up.
  function reroute(s) {
    const e = s.ex, g = e.goal;
    if (!g || g.tries >= 4) return false;
    g.tries++;
    const p = g.tiles ? G.planAdjacent(s, g.tiles) : G.planPath(s, g.x, g.y);
    if (!p || !p.path.length) return false;
    e.path = p.path;
    return true;
  }

  // Path over the grid back to the dock (BFS).
  function gridPathToDock(s, x, y) {
    const W = s.W, N = W * s.H, start = y * W + x;
    const prev = new Int32Array(N).fill(-2);
    prev[start] = -1;
    const q = [start];
    let goal = -1;
    for (let h = 0; h < q.length; h++) {
      const c = q[h];
      if (G.isDockTile(s, c)) { goal = c; break; }
      for (const n of G.neighborsOf(s, c)) {
        if (prev[n] !== -2) continue;
        if (!(G.isConductive(s, n) || s.cable[n] === 2 || G.isDockTile(s, n))) continue;
        prev[n] = c; q.push(n);
      }
    }
    const pts = [];
    if (goal >= 0) for (let c = goal; c !== -1; c = prev[c]) pts.push({ x: c % W, y: (c / W) | 0 });
    pts.reverse();
    const d = G.dock(s);
    pts.push({ x: d.x + 1, y: d.y + 1 });
    if (!pts.length || pts[0].x !== x || pts[0].y !== y) pts.unshift({ x, y });
    return pts;
  }

  G.cmdReturn = function (s) {
    const e = s.ex;
    if (!G.canCommand(s) || e.mode !== 'out' || e.moving) return false;
    const pts = gridPathToDock(s, e.x, e.y);
    const len = pts.length - 1;
    e.ret = { pts, t: 0, dur: U.clamp(len * BAL.returnPerTile, BAL.returnMin, BAL.returnMax) };
    e.mode = 'returning';
    e.path = []; e.keyq = []; e.idleT = 0; e.goal = null;
    s.events.push({ type: 'return', from: { x: e.x, y: e.y } });
    return true;
  };

  // Provisional cable becomes permanent once the explorer gets home, or as soon as it reaches
  // something that holds it in place: a facility, a deposit or an old city line.
  function commitTemp(s) {
    const e = s.ex;
    if (!e.temp.length) return;
    for (const i of e.temp) if (s.cable[i] === 2) s.cable[i] = 1;
    s.events.push({ type: 'commit', tiles: e.temp.slice() });
    e.temp = [];
    e.undo = [];
    G.recomputeGrid(s);
    G.releaseReserve(s);
  }

  G.anchorAt = function (s, i) {
    for (const n of [i].concat(G.neighborsOf(s, i))) {
      if (s.depAt[n] >= 0 || s.old[n] === 1) return true;
      if (s.facAt[n] >= 0 && s.facAt[n] !== 0) return true;
    }
    return false;
  };

  // Overdrawn on a live floor: the provisional cable burns out and what was picked up
  // since the last anchor is dropped where it was found. What was seen stays known.
  // The surge also trips the city's breakers: every robot stands still until they reset.
  function shortOut(s, i) {
    const e = s.ex;
    e.battery = 0;
    e.mode = 'shorted';
    e.shortT = 0;
    e.path = []; e.keyq = []; e.goal = null;
    s.tripT = BAL.tripTime;
    s.stats.trips = (s.stats.trips || 0) + 1;
    s.events.push({ type: 'short', x: i % s.W, y: (i / s.W) | 0, tiles: e.temp.slice() });
    surge(s, i);
  }

  // The surge runs back up the grid and knocks out the closest working generator or substation:
  // it stops generating until repair robots fix it, so the mistake stays on the map.
  function surge(s, i) {
    const x = i % s.W, y = (i / s.W) | 0;
    let best = null, bd = Infinity;
    for (const f of s.facilities) {
      if (f.state !== 'active' || (f.kind !== 'generator' && f.kind !== 'substation')) continue;
      const d = Math.hypot(f.x + f.w / 2 - x, f.y + f.h / 2 - y);
      if (d < bd) { bd = d; best = f; }
    }
    if (!best) return;
    const lost = G.supplyOf(s, best);
    best.state = 'restoring';
    best.damaged = true;
    best.work = 0;
    best.need = BAL.surgeRepair;
    s.stats.damaged = (s.stats.damaged || 0) + 1;
    s.events.push({ type: 'surge', fac: best.id, lost });
    s.restoration = G.computeRestoration(s);
  }

  function recall(s) {
    const e = s.ex;
    const lost = e.temp.length;
    for (const i of e.temp) if (s.cable[i] === 2) s.cable[i] = 0;
    for (const u of e.undo) {
      if (u.item) s.items[u.i] = u.item;
      if (u.scrap) s.res.scrap = Math.max(0, s.res.scrap - u.scrap);
      if (u.crystal) s.res.crystal = Math.max(0, s.res.crystal - u.crystal);
      if (u.cell) e.cells = Math.max(0, e.cells - 1);
    }
    s.stats.cables -= lost;
    s.stats.lostTiles += lost;
    s.stats.recalls++;
    e.sortie.lost = lost;
    e.sortie.newTiles = Math.max(0, e.sortie.newTiles - lost);
    e.sortie.scrap = 0; e.sortie.crystal = 0;
    const from = { x: e.x, y: e.y };
    e.temp = []; e.undo = [];
    const d = G.dock(s);
    e.x = d.x + 1; e.y = d.y + 1; e.fx = e.x; e.fy = e.y;
    e.moving = false;
    s.events.push({ type: 'recalled', from, lost });
    arriveHome(s);
  }

  function arriveHome(s) {
    const e = s.ex;
    commitTemp(s);
    const max = G.maxBattery(s);
    s.events.push({ type: 'recharge', summary: e.sortie, from: e.battery, to: max });
    e.battery = max;
    e.mode = 'home';
    e.ret = null;
    e.path = [];
    e.sortie = G.freshSortie();
  }

  function beginStep(s) {
    const e = s.ex;
    const ni = e.path[0];
    const nx = ni % s.W, ny = (ni / s.W) | 0;
    if (Math.abs(nx - e.x) + Math.abs(ny - e.y) !== 1) { e.path = []; return; }
    const info = G.exStepInfo(s, ni);
    if (!info.ok) {
      e.path = [];
      if (reroute(s)) return;
      e.goal = null;
      s.events.push({ type: 'blocked', x: nx, y: ny, why: info.why });
      return;
    }
    if (info.cost > e.battery) { e.path = []; e.goal = null; s.events.push({ type: 'noBattery', x: nx, y: ny, need: info.cost }); return; }
    e.path.shift();
    e.moving = true;
    e.from = { x: e.x, y: e.y };
    e.to = { x: nx, y: ny };
    e.stepT = 0;
    e.stepInfo = info;
    e.stepDur = info.kind === 'grid' || info.kind === 'dock' ? BAL.stepTimeCable
      : info.kind === 'rubble' ? BAL.stepTimeRubble
      : info.kind === 'canal' ? BAL.stepTimeCanal : BAL.stepTimeNew;
    if (nx !== e.x) e.facing = nx > e.x ? 1 : -1;
    if (info.kind === 'rubble') s.events.push({ type: 'drill', x: nx, y: ny });
    if (e.mode === 'home' && !G.isDockTile(s, ni)) {
      e.mode = 'out';
      s.stats.sorties++;
      e.sortie = G.freshSortie();
      s.events.push({ type: 'sortie', n: s.stats.sorties });
    }
  }

  function finishStep(s) {
    const e = s.ex, info = e.stepInfo;
    e.x = e.to.x; e.y = e.to.y;
    e.moving = false;
    const i = e.y * s.W + e.x;
    if (info.cost > 0) {
      let cost = info.cost;
      if (s.hz[i] && !s.hzKnown[i]) {
        s.hzKnown[i] = 1;
        cost += BAL.hazardDrain;
        s.stats.shocks = (s.stats.shocks || 0) + 1;
        s.events.push({ type: 'shock', x: e.x, y: e.y, drain: BAL.hazardDrain });
      }
      G.revealAround(s, e.x, e.y);
      if (cost > e.battery) { shortOut(s, i); return; }
      e.battery -= cost;
      if (info.kind === 'rubble') {
        s.tile[i] = T.STREET;
        s.res.scrap += BAL.rubbleScrap;
        e.undo.push({ scrap: BAL.rubbleScrap });
        s.events.push({ type: 'rubble', x: e.x, y: e.y, amount: BAL.rubbleScrap });
      }
      s.cable[i] = 2;
      e.temp.push(i);
      s.stats.cables++;
      e.sortie.newTiles++;
      s.events.push({ type: 'lay', x: e.x, y: e.y, kind: info.kind, battery: e.battery });
      if (e.battery <= 0) s.events.push({ type: 'batteryEmpty', x: e.x, y: e.y });
    } else {
      s.events.push({ type: 'glide', x: e.x, y: e.y });
      G.revealAround(s, e.x, e.y);
    }
    pickup(s, i);
    if (G.isDockTile(s, i) && e.mode === 'out') arriveHome(s);
    else if (e.temp.length && G.anchorAt(s, i)) commitTemp(s);
  }

  function pickup(s, i) {
    const it = s.items[i];
    if (!it) return;
    delete s.items[i];
    const e = s.ex, x = i % s.W, y = (i / s.W) | 0;
    s.stats.pickups++;
    switch (it.kind) {
      case 'scrap':
        s.res.scrap += it.amount; e.sortie.scrap += it.amount;
        if (e.temp.length) e.undo.push({ i, item: it, scrap: it.amount });
        s.events.push({ type: 'pickup', kind: 'scrap', amount: it.amount, x, y });
        break;
      case 'crystal':
        s.res.crystal += it.amount; e.sortie.crystal += it.amount;
        if (e.temp.length) e.undo.push({ i, item: it, crystal: it.amount });
        s.events.push({ type: 'pickup', kind: 'crystal', amount: it.amount, x, y });
        break;
      case 'cell':
        if (e.temp.length) e.undo.push({ i, item: it, cell: true });
        e.cells++;
        e.battery += BAL.cellBonus;
        s.events.push({ type: 'cell', x, y });
        break;
      case 'log':
        if (s.logsRead.indexOf(it.log) < 0) s.logsRead.push(it.log);
        s.events.push({ type: 'log', log: it.log, x, y });
        break;
      case 'bot':
        s.stats.robotsFound++;
        if (!s.powered[i]) {
          // found at the end of a provisional line: it heads for the base once the line holds
          s.reserve++;
          s.events.push({ type: 'rescueWait', x, y });
        } else {
          const r = MD.Robots.spawn(s, i, 'idle');
          s.events.push({ type: 'rescue', rid: r.id, x, y });
        }
        break;
    }
  }

  function updateExplorer(s, dt) {
    const e = s.ex;
    if (e.mode === 'shorted') {
      e.shortT += dt;
      if (e.shortT >= BAL.shortDelay) recall(s);
      return;
    }
    if (e.mode === 'returning') {
      const r = e.ret;
      r.t += dt;
      const p = U.clamp(r.t / r.dur, 0, 1);
      const k = U.easeInOutSine(p) * (r.pts.length - 1);
      const a = Math.floor(k), b = Math.min(a + 1, r.pts.length - 1), f = k - a;
      e.fx = U.lerp(r.pts[a].x, r.pts[b].x, f);
      e.fy = U.lerp(r.pts[a].y, r.pts[b].y, f);
      if (p >= 1) {
        const d = G.dock(s);
        e.x = d.x + 1; e.y = d.y + 1; e.fx = e.x; e.fy = e.y;
        arriveHome(s);
      }
      return;
    }
    if (e.moving) {
      e.stepT += dt;
      if (e.stepT >= e.stepDur) finishStep(s);
    }
    if (!e.moving) {
      if (!e.path.length && e.keyq && e.keyq.length) {
        const [dx, dy] = e.keyq.shift();
        const nx = e.x + dx, ny = e.y + dy;
        if (G.inb(s, nx, ny)) e.path = [ny * s.W + nx];
      }
      if (e.path.length) beginStep(s);
    }
    if (e.moving) {
      const t = U.clamp(e.stepT / e.stepDur, 0, 1);
      e.fx = U.lerp(e.from.x, e.to.x, t);
      e.fy = U.lerp(e.from.y, e.to.y, t);
    } else { e.fx = e.x; e.fy = e.y; }

    if (!e.moving && !e.path.length && e.mode === 'out' && e.battery <= 0 && !s.won) {
      e.idleT += dt;
      if (e.idleT >= BAL.autoReturnDelay) G.cmdReturn(s);
    } else e.idleT = 0;
  }

  // ------------------------------------------------------------------ facilities

  G.canRestore = function (s, f) {
    const def = G.def(f);
    if (f.state !== 'dormant') return { ok: false, why: '' };
    if (!f.connected) return { ok: false, why: '送電網につながっていない' };
    if (def.requires) {
      const missing = def.requires.map((ch) => G.facByCh(s, ch)).filter((x) => x.state !== 'active');
      if (missing.length) return { ok: false, why: '必要: ' + missing.map((x) => x.name).join('・') + 'の復旧' };
    }
    if (!U.canAfford(s.res, def.cost)) return { ok: false, why: '資源が足りない（' + U.costText(def.cost) + '）' };
    return { ok: true };
  };

  G.orderRestore = function (s, fid) {
    const f = s.facilities[fid];
    const chk = G.canRestore(s, f);
    if (!chk.ok) return chk;
    U.pay(s.res, G.def(f).cost);
    if (f.need > 0) {
      f.state = 'restoring';
      f.work = 0;
      s.events.push({ type: 'restoreStart', fac: f.id });
    } else G.activate(s, f);
    return { ok: true };
  };

  G.addWork = function (s, f, amount) {
    if (f.state !== 'restoring') return;
    f.work = Math.min(f.need, f.work + amount);
    if (f.work >= f.need) {
      if (f.kind === 'reactor') {
        f.state = 'ready';
        s.events.push({ type: 'reactorReady', fac: f.id });
      } else G.activate(s, f);
    }
  };

  G.activate = function (s, f) {
    const def = G.def(f);
    const repaired = !!f.damaged; // back from surge damage: only the generation returns
    f.damaged = false;
    f.state = 'active';
    f.activatedAt = s.time;
    if (repaired) {
      s.events.push({ type: 'repaired', fac: f.id });
      s.restoration = G.computeRestoration(s);
      return;
    }
    if (def.light) for (const k in def.light) s.districtLight[k] = Math.min(1, s.districtLight[k] + def.light[k]);
    const e = s.ex;
    if (def.battery) {
      if (e.mode === 'home') e.battery = G.maxBattery(s);
      else e.battery += def.battery;
    }
    if (f.kind === 'factory') {
      const spot = G.doorSpot(s, f);
      if (spot >= 0) {
        const r = MD.Robots.spawn(s, spot, 'idle');
        s.stats.robotsFound++;
        s.events.push({ type: 'rescue', rid: r.id, x: spot % s.W, y: (spot / s.W) | 0, factory: true });
      }
    }
    if (f.kind === 'radar') {
      G.revealAround(s, Math.floor(f.x + f.w / 2), Math.floor(f.y + f.h / 2), def.reveal);
      for (const o of s.facilities) o.known = true;
    }
    G.releaseReserve(s);
    s.events.push({ type: 'restored', fac: f.id });
    if (def.reach) G.recomputeGrid(s); // a new power source
    s.restoration = G.computeRestoration(s);
  };

  G.releaseReserve = function (s) {
    while (s.reserve > 0) {
      const home = G.homeSpot(s);
      if (home < 0) break;
      s.reserve--;
      const r = MD.Robots.spawn(s, home, 'idle');
      s.events.push({ type: 'rescue', rid: r.id, x: home % s.W, y: (home / s.W) | 0, reserve: true });
    }
  };

  // Powered tile next to a facility, closest to its centre.
  G.doorSpot = function (s, f) {
    const spots = G.spotsAround(s, f.tiles);
    if (!spots.length) return -1;
    const cx = f.x + f.w / 2 - 0.5, cy = f.y + f.h / 2 - 0.5;
    let best = spots[0], bd = Infinity;
    for (const i of spots) {
      const d = Math.hypot(i % s.W - cx, ((i / s.W) | 0) - cy) + (((i / s.W) | 0) > cy ? 0 : 0.3);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };

  G.homeSpot = function (s) {
    const F = G.factory(s);
    if (F && F.state === 'active') { const d = G.doorSpot(s, F); if (d >= 0) return d; }
    return G.doorSpot(s, G.dock(s));
  };

  G.repairBreak = function (s, i) {
    if (s.old[i] !== 2) return;
    s.old[i] = 1;
    delete s.breaks[i];
    s.events.push({ type: 'breakFixed', x: i % s.W, y: (i / s.W) | 0 });
    G.recomputeGrid(s);
    s.restoration = G.computeRestoration(s);
  };

  G.repairLamp = function (s, lampIndex) {
    const L = s.lamps[lampIndex];
    if (!L.broken) return;
    L.broken = false;
    L.lit = !!s.powered[L.i];
    s.events.push({ type: 'lampFixed', lamp: lampIndex });
    if (L.lit) s.events.push({ type: 'lampOn', lamp: lampIndex });
    s.restoration = G.computeRestoration(s);
  };

  function checkIgnite(s) {
    const X = G.reactor(s), e = s.ex;
    if (!X || X.state !== 'ready' || s.won || e.mode === 'returning' || e.mode === 'shorted' || e.moving) return;
    if (!G.adjacentTo(s, X.tiles, e.x, e.y)) return;
    X.state = 'ignited';
    s.won = true;
    s.wonAt = s.time;
    for (const k in s.districtLight) s.districtLight[k] = 1;
    for (const L of s.lamps) { L.broken = false; L.lit = true; }
    s.restoration = 100;
    s.events.push({ type: 'ignite', fac: X.id });
    MD.Robots.spawnParade(s, 28);
  }

  // ------------------------------------------------------------------ upgrades & robots

  G.upgradeState = function (s, u) {
    if (s.upgrades[u.id]) return 'owned';
    if (u.requires && !s.upgrades[u.requires]) return 'locked';
    return U.canAfford(s.res, u.cost) ? 'available' : 'expensive';
  };

  G.buyUpgrade = function (s, id) {
    const u = MD.UPGRADES.find((x) => x.id === id);
    if (!u) return { ok: false };
    const st = G.upgradeState(s, u);
    if (st !== 'available') return { ok: false, why: st };
    U.pay(s.res, u.cost);
    s.upgrades[id] = true;
    if (u.battery) { s.ex.batBonus += u.battery; s.ex.battery += u.battery; }
    if (id === 'scanner') G.revealAround(s, s.ex.x, s.ex.y);
    s.events.push({ type: 'upgrade', id });
    return { ok: true };
  };

  // Relay tower: placed by the explorer on a live, permanent line; power restarts at full reach.
  G.relayCost = (s) => ({ scrap: BAL.relayCost + BAL.relayStep * s.relays.length });

  G.relayCheck = function (s, i) {
    if (s.won || i == null || i < 0) return { ok: false, why: '' };
    if (s.relays.indexOf(i) >= 0) return { ok: false, why: 'ここにはもう中継塔がある' };
    if (s.cable[i] === 2) return { ok: false, why: '仮設ケーブルの上には置けない（確定させてから）' };
    if (!G.isConductive(s, i)) return { ok: false, why: '送電網（ケーブルか古い送電線）の上に置く' };
    if (!s.powered[i]) return { ok: false, why: 'ここは電気が届いていない（届いている所に置く）' };
    if (s.volt[i] >= BAL.relayReach) return { ok: false, why: '電気が十分に届いている（電圧の低い所に置こう）' };
    const cost = G.relayCost(s);
    if (!U.canAfford(s.res, cost)) return { ok: false, why: 'スクラップが足りない（' + U.costText(cost) + '）' };
    return { ok: true, cost };
  };

  G.buildRelay = function (s, i) {
    const chk = G.relayCheck(s, i);
    if (!chk.ok) return chk;
    U.pay(s.res, chk.cost);
    s.relays.push(i);
    s.events.push({ type: 'relay', x: i % s.W, y: (i / s.W) | 0, i });
    G.recomputeGrid(s);
    return { ok: true };
  };

  // Tiles that would newly receive power if a relay stood on tile i (placement preview).
  G.relayGain = function (s, i) {
    const v = computeVolt(s, s.relays.concat([i])).volt;
    const out = [];
    for (let k = 0; k < v.length; k++) if (v[k] >= 0 && !s.powered[k]) out.push(k);
    return out;
  };

  G.buildRobot = function (s, role) {
    const F = G.factory(s);
    if (!F || F.state !== 'active') return { ok: false, why: 'ロボット工場が停止している' };
    if (!U.canAfford(s.res, BAL.robotCost)) return { ok: false, why: 'スクラップが足りない（⚙' + BAL.robotCost.scrap + '）' };
    U.pay(s.res, BAL.robotCost);
    s.buildQueue.push({ role, t: 0 });
    s.events.push({ type: 'buildStart', role });
    return { ok: true, how: 'build' };
  };

  // "+" on a role: wake an idle robot if there is one, otherwise build a new one.
  G.requestRole = function (s, role) {
    const idle = s.robots.find((r) => r.role === 'idle');
    if (idle) { MD.Robots.setRole(s, idle, role); return { ok: true, how: 'assign' }; }
    return G.buildRobot(s, role);
  };

  // "−" on a role: send one robot of that role back to idle (prefer one that is not busy).
  G.releaseRole = function (s, role) {
    const cands = s.robots.filter((r) => r.role === role);
    if (!cands.length) {
      const qi = s.buildQueue.map((q) => q.role).lastIndexOf(role);
      if (qi >= 0 && qi > 0) { // cannot cancel the one being built; re-tag queued ones
        s.buildQueue[qi].role = 'idle';
        return true;
      }
      return false;
    }
    cands.sort((a, b) => MD.Robots.busyScore(a) - MD.Robots.busyScore(b));
    MD.Robots.setRole(s, cands[0], 'idle');
    return true;
  };

  G.roleCount = (s, role) => s.robots.filter((r) => r.role === role).length +
    s.buildQueue.filter((q) => q.role === role).length;

  // ------------------------------------------------------------------ progress

  G.computeRestoration = function (s) {
    if (s.won) return 100;
    let pts = 0;
    for (const f of s.facilities) if (f.state === 'active' || f.state === 'ignited') pts += G.def(f).pts || 0;
    const lit = s.lamps.filter((L) => L.lit).length;
    pts += 10 * lit / Math.max(1, s.lamps.length);
    let oldOn = 0;
    for (let i = 0; i < s.old.length; i++) if (s.old[i] === 1 && s.powered[i]) oldOn++;
    pts += 6 * oldOn / Math.max(1, s.oldTotal);
    return Math.min(99, pts);
  };

  G.ratePerMin = function (s, kind) {
    const win = 60;
    let sum = 0, first = s.time;
    for (const r of s.stats.recent) if (r.k === kind && s.time - r.t <= win) { sum += r.n; first = Math.min(first, r.t); }
    const span = Math.max(20, Math.min(win, s.time - first + 5));
    return sum * 60 / span;
  };

  G.noteDelivery = function (s, kind, n) {
    s.stats.delivered[kind] += n;
    s.stats.recent.push({ t: s.time, k: kind, n });
    if (s.stats.recent.length > 400) s.stats.recent.splice(0, 100);
  };

  // ------------------------------------------------------------------ main update

  G.update = function (s, dt) {
    s.time += dt;
    if (s.tripT > 0) {
      s.tripT -= dt;
      if (s.tripT <= 0) { s.tripT = 0; s.events.push({ type: 'tripEnd' }); }
    }
    updateExplorer(s, dt);
    s.sat = G.satisfaction(s); // after the explorer, so a short circuit stops the city this very tick
    // announce the moment the city starts (and stops) running short of power
    const short = !s.tripT && G.coverage(s) < 1;
    if (short !== !!s.brownout) {
      s.brownout = short;
      if (short) s.stats.brownouts = (s.stats.brownouts || 0) + 1;
      s.events.push(short ? { type: 'brownout', speed: s.sat, supply: G.supply(s), demand: G.demand(s) } : { type: 'brownoutEnd' });
    }
    MD.Robots.update(s, dt, s.sat);
    // Dock recycler: a slow trickle that only runs when scrap is short, so the game can never soft-lock.
    const floor = G.factory(s).state === 'active' ? Math.max(BAL.robotCost.scrap, MD.FAC.G.cost.scrap) : MD.FAC.F.cost.scrap;
    if (s.res.scrap < floor) {
      s.trickleT += dt;
      if (s.trickleT >= BAL.dockTrickle) {
        s.trickleT = 0;
        s.res.scrap += 1;
        s.events.push({ type: 'trickle' });
      }
    } else s.trickleT = 0;
    checkIgnite(s);
    s.restoration = G.computeRestoration(s);
    if (s.events.length > 600) s.events.splice(0, s.events.length - 300);
  };

  // ------------------------------------------------------------------ guidance

  G.objective = function (s) {
    const F = G.factory(s), X = G.reactor(s);
    if (s.won) return { id: 'won', title: '夜明け', text: '中央動力炉が再点火した。都市は再び動き出す。' };
    if (F.state !== 'active') {
      if (!F.connected) {
        return { id: 'reachFactory', title: '工場の救難信号へ向かえ', target: F.id,
          text: s.stats.sorties <= 1
            ? '新しい地面を1歩進むごとにバッテリーを1消費し、仮設ケーブルが残る。基地に帰るか施設につなぐと確定する。'
            : 'ケーブルの上はバッテリーを使わずに走れる。ケーブルの先から続きを伸ばそう。' };
      }
      return { id: 'restoreFactory', title: 'ロボット工場を再起動せよ', target: F.id,
        text: U.canAfford(s.res, MD.FAC.F.cost) ? '工場をクリックして［再起動］。' : '再起動にはスクラップ⚙10。道に落ちている光るスクラップを拾おう。' };
    }
    const working = s.robots.filter((r) => r.role !== 'idle' && r.role !== 'parade').length;
    if (!working && s.robots.length) {
      return { id: 'assign', title: '目覚めたロボットに役割を', text: '右の［ロボット］パネルの＋で役割を割り当てよう。' };
    }
    const scrapDep = s.deposits.filter((d) => d.kind === 'scrap');
    if (!scrapDep.some((d) => d.connected)) {
      const known = scrapDep.filter((d) => d.known);
      return { id: 'connectHeap', title: 'スクラップ山へケーブルをつなげ', target: known.length ? { dep: known[0].id } : null,
        text: 'ロボットは送電網の上しか動けない。資源に隣接するまでケーブルを伸ばそう。' };
    }
    if (s.stats.delivered.scrap + s.stats.delivered.crystal === 0) {
      return { id: 'haul', title: '資源を基地へ運ばせよう', text: '採掘ロボが掘り、運搬ロボが基地へ運ぶ。両方そろえよう。' };
    }
    if (!Object.keys(s.upgrades).length) {
      return { id: 'upgrade', title: 'ホタルを強化しよう', text: '［強化］で新しい行動を手に入れると、行ける場所が変わる。' };
    }
    const subs = G.substations(s), active = subs.filter((f) => f.state === 'active').length;
    if (active < 3) {
      let hint = '変電所を復旧すると発電とバッテリーが増え、そこから先へ電気が届く。';
      if (!s.upgrades.drill) hint = '瓦礫の向こうに工業区がある。ドリルアームがあれば進める。';
      else if (!s.upgrades.hover && subs.some((f) => f.state === 'active')) hint = '運河の向こうにも変電所がある。ホバー脚には結晶◆が必要。';
      const restoring = subs.find((f) => f.state === 'restoring');
      if (restoring) hint = restoring.name + 'を復旧中。修理ロボが多いほど早い。';
      return { id: 'subs', title: '変電所を復旧せよ（' + active + '/3）', text: hint };
    }
    if (X.state === 'dormant' && !X.connected) {
      return { id: 'reachReactor', title: '中央動力炉へ送電網をつなげ', target: X.id,
        text: s.upgrades.hover ? '冷却水路を越えて炉にケーブルを届けよう。' : '炉は冷却水路に囲まれている。ホバー脚が必要だ。' };
    }
    if (X.state === 'dormant') {
      return { id: 'restoreReactor', title: '中央動力炉を再起動せよ', target: X.id,
        text: '必要資源 ' + U.costText(MD.FAC.X.cost) + '。炉をクリックして復旧を開始。' };
    }
    if (X.state === 'restoring') {
      return { id: 'reactorWork', title: '中央動力炉 復旧作業中', target: X.id, text: '修理ロボを集めれば早く終わる。' };
    }
    return { id: 'ignite', title: 'ホタルで点火せよ', target: X.id, text: 'ホタルを中央動力炉の隣まで動かそう。' };
  };
})(typeof window !== 'undefined' ? window : globalThis);

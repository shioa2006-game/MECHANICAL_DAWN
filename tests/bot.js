// A scripted "player" that drives the public game API (the same calls the UI makes)
// from a fresh game to the ending. Used to prove the game is completable and to measure pacing.
// Works in Node (require) and in the browser (loaded after the game scripts; exposes MD.Bot).
const MD = typeof window !== 'undefined' ? window.MD : require('./load.js');
const G = MD.G;

const GOALS = [
  { fac: 'F' },
  { dep: [5, 18] },             // scrap heap next to the factory
  { tile: [15, 20] },           // touch the old avenue line -> cascade
  { item: [1, 16] },            // dormant robot
  { fac: 'R' },                 // radio tower
  { dep: [17, 25] },            // second scrap heap
  { dep: [24, 18] },            // small crystal vein (no upgrade needed)
  { need: 'drill', tile: [27, 21] },
  { need: 'drill', fac: 'W' },
  { need: 'drill', fac: 'conveyor' },
  { need: 'drill', dep: [45, 19] },
  { need: 'drill', fac: '1' },
  { need: 'drill', dep: [36, 27] },
  { need: 'drill', tile: [23, 13] },
  { need: 'drill', fac: '3' },
  { need: 'hover', fac: '2' },
  { need: 'hover', dep: [4, 4] },
  { need: 'hover', fac: 'X' },
];

const RESTORE_ORDER = ['F', '1', '2', '3', 'W', 'conveyor', 'R', 'X'];
const UPGRADE_ORDER = ['drill', 'bat1', 'hover', 'scanner', 'bat2', 'bat3'];
const ROBOT_PLAN = [['scrap', 1], ['haul', 1], ['repair', 1], ['crystal', 1], ['scrap', 2], ['haul', 2],
  ['crystal', 2], ['haul', 3], ['repair', 2], ['scrap', 3], ['haul', 4], ['crystal', 3], ['repair', 3],
  ['haul', 5], ['crystal', 4], ['repair', 4], ['haul', 6], ['scrap', 4], ['repair', 5]];

function facOf(s, ch) { return s.facilities.find((f) => f.ch === ch); }
function depAt(s, x, y) { return s.deposits[s.depAt[y * s.W + x]]; }

function goalDone(s, g) {
  if (g.fac) return facOf(s, g.fac).connected;
  if (g.dep) return depAt(s, g.dep[0], g.dep[1]).connected;
  if (g.tile) return !!s.powered[g.tile[1] * s.W + g.tile[0]];
  if (g.item) return !s.items[g.item[1] * s.W + g.item[0]];
  return true;
}

function goalTiles(s, g) {
  if (g.tile) return [g.tile[1] * s.W + g.tile[0]];
  if (g.item) return [g.item[1] * s.W + g.item[0]];
  const tiles = g.fac ? facOf(s, g.fac).tiles : [depAt(s, g.dep[0], g.dep[1]).i];
  const out = [];
  for (const t of tiles) for (const n of G.neighborsOf(s, t)) if (tiles.indexOf(n) < 0 && out.indexOf(n) < 0) out.push(n);
  return out;
}

// A goal whose neighbouring cable exists but carries no power: returns that dead tile.
function deadTouch(s, g) {
  for (const t of goalTiles(s, g)) if (G.isConductive(s, t) && !s.powered[t]) return t;
  return -1;
}

// Walk the cable back from a dead tile to the last live one: the place for a relay tower.
function liveEdge(s, from) {
  const seen = new Set([from]), q = [from];
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    if (s.powered[c]) return c;
    for (const n of G.neighborsOf(s, c)) if (!seen.has(n) && G.isConductive(s, n)) { seen.add(n); q.push(n); }
  }
  return -1;
}

// Without scrap for a relay: find the live tile from which a fresh line over new ground still arrives
// with power (reach left >= tiles to lay). Returns { from, path } where path leads from 'from' to the goal.
function shortcut(s, g) {
  const ends = goalTiles(s, g).filter((t) => G.exStepInfo(s, t).ok);
  const N = s.W * s.H, dist = new Int32Array(N).fill(-1), next = new Int32Array(N).fill(-1);
  const q = [];
  for (const t of ends) { dist[t] = 1; q.push(t); }
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    if (s.powered[c]) {
      if (s.volt[c] >= dist[c] - 1) {
        const path = [];
        for (let k = next[c]; k >= 0; k = next[k]) path.push(k);
        return { from: c, path };
      }
      continue;
    }
    for (const n of G.neighborsOf(s, c)) {
      if (dist[n] >= 0 || !G.exStepInfo(s, n).ok) continue;
      if (G.isConductive(s, n) && !s.powered[n]) continue; // riding dead cable adds no power: lay new ground
      dist[n] = dist[c] + 1; next[n] = c; q.push(n);
    }
  }
  return null;
}

// Cautious play: cut the route before the first step that could hit a live floor with too little
// battery left to survive it. Returns false if even the first new step is that risky.
function trimRisky(s) {
  const e = s.ex;
  let bat = e.battery;
  for (let k = 0; k < e.path.length; k++) {
    const i = e.path[k], info = G.exStepInfo(s, i);
    const cost = info.ok ? info.cost : 1;
    if (cost > 0 && G.maybeHazard(s, i) && bat - cost < MD.BAL.hazardDrain) { e.path.length = k; return k > 0; }
    bat -= cost;
  }
  return true;
}

function bestPlan(s, g) {
  let best = null;
  for (const t of goalTiles(s, g)) {
    const p = G.planPath(s, t % s.W, (t / s.W) | 0);
    if (p && p.path.length && (!best || p.cost < best.cost || (p.cost === best.cost && p.steps < best.steps))) best = p;
  }
  return best;
}

const DEFAULT_CFG = { goals: GOALS, restoreOrder: RESTORE_ORDER, upgradeOrder: UPGRADE_ORDER, robotPlan: ROBOT_PLAN, adaptive: true };

function manageEconomy(s, log, cfg) {
  cfg = cfg || DEFAULT_CFG;
  for (const ch of cfg.restoreOrder) {
    const f = facOf(s, ch);
    if (f.state === 'dormant' && G.canRestore(s, f).ok) { G.orderRestore(s, f.id); log('restore ' + f.name); return; }
  }
  for (const id of cfg.upgradeOrder) {
    const u = MD.UPGRADES.find((x) => x.id === id);
    const st = G.upgradeState(s, u);
    if (st === 'owned' || st === 'locked') continue;
    if (st === 'available') { G.buyUpgrade(s, id); log('upgrade ' + u.name); return; }
    if (!cfg.impatient) break; // save for this one
  }
  if (cfg.adaptive && rebalance(s, log)) return;
  if (G.factory(s).state !== 'active') return;
  const idle = s.robots.find((r) => r.role === 'idle');
  for (const [role, n] of cfg.robotPlan) {
    if (G.roleCount(s, role) >= n) continue;
    if (role === 'crystal' && !s.deposits.some((d) => d.kind === 'crystal' && d.connected)) continue;
    if (!idle && G.robotTotal(s) >= G.powerCap(s)) return;
    const r = G.requestRole(s, role);
    if (r.ok) log((r.how === 'assign' ? 'assign ' : 'build ') + role);
    return;
  }
}

// What a reasonable player does when the hint panel says a key role is missing.
function rebalance(s, log) {
  if (G.factory(s).state !== 'active' || s.robots.length < 2) return false;
  if ((s._rebalanceT || 0) > s.time) return false;
  const need = [];
  if (!G.roleCount(s, 'scrap') && s.deposits.some((d) => d.kind === 'scrap' && d.connected) && s.res.scrap < 30) need.push('scrap');
  if (!G.roleCount(s, 'haul') && s.deposits.some((d) => d.buffer > 0)) need.push('haul');
  if (!G.roleCount(s, 'crystal') && s.deposits.some((d) => d.kind === 'crystal' && d.connected) && s.res.crystal < 10) need.push('crystal');
  if (!G.roleCount(s, 'repair') && s.facilities.some((f) => f.state === 'restoring')) need.push('repair');
  if (!need.length) return false;
  const counts = ['scrap', 'crystal', 'haul', 'repair', 'idle'].map((r) => [r, G.roleCount(s, r)]).filter(([r, n]) => n > 1 || r === 'idle' && n > 0);
  counts.sort((a, b) => b[1] - a[1]);
  if (!counts.length) return false;
  G.releaseRole(s, counts[0][0]);
  G.requestRole(s, need[0]);
  s._rebalanceT = s.time + 8;
  log('rebalance ' + counts[0][0] + ' -> ' + need[0]);
  return true;
}

function driveExplorer(s, cfg) {
  cfg = cfg || DEFAULT_CFG;
  const e = s.ex;
  if (e.moving || e.path.length || e.mode === 'returning' || e.mode === 'shorted' || s.won) return;
  const go = (i) => {
    G.cmdMoveTo(s, i % s.W, (i / s.W) | 0);
    if (!cfg.reckless && !trimRisky(s) && e.mode === 'out') G.cmdReturn(s);
  };
  const X = facOf(s, 'X');
  if (X.state === 'ready') {
    const p = bestPlan(s, { fac: 'X' });
    if (p) go(p.path[p.path.length - 1]);
    return;
  }
  for (const g of cfg.goals) {
    if (g.need && !s.upgrades[g.need]) continue;
    if (goalDone(s, g)) continue;
    const dead = deadTouch(s, g);
    const edge = dead >= 0 ? liveEdge(s, dead) : -1;
    if (edge >= 0) {
      // our cable reaches the goal but the power does not: put a relay tower at the live edge
      if (G.relayCheck(s, edge).ok) {
        if (e.y * s.W + e.x === edge) G.buildRelay(s);
        else G.cmdMoveTo(s, edge % s.W, (edge / s.W) | 0);
        return;
      }
      // no scrap for a relay: lay a shorter line from where the power is still strong
      const sc = shortcut(s, g);
      if (!sc) continue;
      if (e.y * s.W + e.x !== sc.from) { G.cmdMoveTo(s, sc.from % s.W, (sc.from / s.W) | 0); return; }
      const first = sc.path.find((i) => G.exStepInfo(s, i).cost > 0);
      if (first != null && G.exStepInfo(s, first).cost > e.battery) {
        if (e.mode === 'out') G.cmdReturn(s);
        return;
      }
      e.path = sc.path; e.keyq = [];
      if (!cfg.reckless && !trimRisky(s) && e.mode === 'out') G.cmdReturn(s);
      return;
    }
    const p = bestPlan(s, g);
    if (!p) continue;
    const firstCostly = p.path.findIndex((i) => G.exStepInfo(s, i).cost > 0);
    if (firstCostly >= 0 && G.exStepInfo(s, p.path[firstCostly]).cost > e.battery) {
      if (e.mode === 'out') G.cmdReturn(s);
      return;
    }
    go(p.path[p.path.length - 1]);
    return;
  }
  if (e.mode === 'out') G.cmdReturn(s);
}

function play(opts) {
  opts = opts || {};
  const s = G.newGame({ seed: opts.seed != null ? opts.seed : 1, hazards: opts.hazards });
  const dt = 1 / 30, maxT = opts.maxTime || 3600;
  const marks = [];
  const log = (m) => { if (opts.verbose) console.log('[' + s.time.toFixed(1) + 's] ' + m); };
  let econT = 0;
  while (!s.won && s.time < maxT) {
    driveExplorer(s, opts.cfg);
    econT += dt;
    if (econT > 0.5) { econT = 0; manageEconomy(s, log, opts.cfg); }
    G.update(s, dt);
    for (const ev of s.events) {
      if (ev.type === 'restored') marks.push([s.time, s.facilities[ev.fac].name]);
      if (ev.type === 'upgrade') marks.push([s.time, 'UP ' + ev.id]);
      if (ev.type === 'energize') log('cascade ' + ev.tiles.length + ' tiles');
    }
    s.events.length = 0;
  }
  return { s, marks };
}

MD.Bot = { play, driveExplorer, manageEconomy, DEFAULT_CFG };
if (typeof module !== 'undefined') module.exports = { play, driveExplorer, manageEconomy, DEFAULT_CFG };

if (typeof require !== 'undefined' && require.main === module) {
  const { s, marks } = play({ verbose: process.argv.includes('-v') });
  for (const [t, m] of marks) console.log(MD.U.fmtTime(t).padStart(6), m);
  console.log('won:', s.won, 'time', MD.U.fmtTime(s.time), 'sorties', s.stats.sorties, 'cables', s.stats.cables,
    'relays', s.relays.length, 'recalls', s.stats.recalls, 'lost tiles', s.stats.lostTiles,
    'robots', s.robots.filter((r) => r.role !== 'parade').length, 'res', JSON.stringify(s.res));
}

// Headless rule tests for MECHANICAL DAWN.  Run:  node tests/run-tests.js
const MD = require('./load.js');
const { play } = require('./bot.js');
const G = MD.G, BAL = MD.BAL;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e)); }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'expected equal') + ': got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b)); }
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }

function run(s, sec, dt = 1 / 30) { for (let t = 0; t < sec; t += dt) { G.update(s, dt); } }
function idx(s, x, y) { return y * s.W + x; }
// Drive the explorer along explicit tiles (each must be adjacent) and wait for it to finish.
function walk(s, tiles) {
  for (const [x, y] of tiles) {
    G.cmdStep(s, x - (s.ex.moving ? s.ex.to.x : s.ex.x), y - (s.ex.moving ? s.ex.to.y : s.ex.y));
    for (let k = 0; k < 120 && (s.ex.moving || s.ex.path.length || (s.ex.keyq && s.ex.keyq.length)); k++) G.update(s, 1 / 30);
  }
}
function line(x0, y0, x1, y1) {
  const out = []; let x = x0, y = y0;
  while (x !== x1 || y !== y1) { if (x !== x1) x += Math.sign(x1 - x); else y += Math.sign(y1 - y); out.push([x, y]); }
  return out;
}
function fac(s, ch) { return s.facilities.find((f) => f.ch === ch); }
// Rule tests run on a fixed, hazard-free city unless a test places live floors itself.
function fresh() { return G.newGame({ seed: 7, hazards: false }); }

console.log('\nMap & setup');
test('map is rectangular and fully enclosed', () => {
  const rows = MD.MAP;
  ok(rows.every((r) => r.length === rows[0].length), 'row lengths differ');
  ok(/^#+$/.test(rows[0]) && /^#+$/.test(rows[rows.length - 1]), 'top/bottom border');
  ok(rows.every((r) => r[0] === '#' && r[r.length - 1] === '#'), 'side borders');
});
test('every facility and deposit has a reachable side', () => {
  const s = fresh();
  for (const f of s.facilities) {
    if (f.kind === 'dock') continue;
    const sides = []; for (const t of f.tiles) for (const n of G.neighborsOf(s, t)) if (s.facAt[n] !== f.id) sides.push(n);
    ok(sides.some((n) => s.tile[n] !== G.T.BUILDING && s.tile[n] !== G.T.FACILITY), f.name + ' has no open side');
  }
  for (const d of s.deposits) ok(G.neighborsOf(s, d.i).some((n) => s.tile[n] === G.T.STREET), 'deposit ' + d.x + ',' + d.y);
});
test('start state: battery 10, at dock, factory beacon & reactor known', () => {
  const s = fresh();
  eq(s.ex.battery, 10); eq(s.ex.mode, 'home');
  ok(fac(s, 'F').known && fac(s, 'X').known);
  ok(!fac(s, '1').known, 'substation 1 should be unknown at start');
});
test('upgrade gates: rubble needs drill, canal needs hover', () => {
  const s = fresh();
  ok(!G.exStepInfo(s, idx(s, 26, 20)).ok, 'rubble blocked');
  ok(!G.exStepInfo(s, idx(s, 10, 12)).ok, 'canal blocked');
  s.upgrades.drill = true; s.upgrades.hover = true;
  eq(G.exStepInfo(s, idx(s, 26, 20)).cost, 2);
  eq(G.exStepInfo(s, idx(s, 10, 12)).cost, 1);
});
test('all substations and the reactor reachable with drill+hover', () => {
  const s = fresh();
  s.upgrades.drill = true; s.upgrades.hover = true;
  const W = s.W, seen = new Set(), q = [];
  for (const t of G.dock(s).tiles) { seen.add(t); q.push(t); }
  while (q.length) { const c = q.shift(); for (const n of G.neighborsOf(s, c)) if (!seen.has(n) && G.exStepInfo(s, n).ok) { seen.add(n); q.push(n); } }
  for (const ch of ['F', 'R', 'W', '1', '2', '3', 'X', 'conveyor']) {
    const f = fac(s, ch);
    ok(f.tiles.some((t) => G.neighborsOf(s, t).some((n) => seen.has(n))), f.name + ' unreachable');
  }
  ok(W > 0);
});

console.log('\nExplorer, steps & cable');
test('a step onto new ground costs 1 battery and leaves provisional cable', () => {
  const s = fresh();
  walk(s, [[5, 26], [6, 26]]);
  eq(s.ex.battery, 9);
  eq(s.cable[idx(s, 6, 26)], 2, 'provisional until anchored');
  eq(s.powered[idx(s, 6, 26)], 0, 'provisional cable carries no power');
  eq(s.ex.mode, 'out'); eq(s.stats.sorties, 1);
  ok(G.cmdReturn(s)); run(s, 2);
  eq(s.cable[idx(s, 6, 26)], 1, 'returning home makes it permanent');
  eq(s.powered[idx(s, 6, 26)], 1);
});
test('walking on existing cable is free', () => {
  const s = fresh();
  walk(s, [[5, 26], [6, 26], [6, 25], [6, 24]]);
  const b = s.ex.battery;
  walk(s, [[6, 25], [6, 26], [6, 25]]);
  eq(s.ex.battery, b);
});
test('battery cannot go below zero; buildings block', () => {
  const s = fresh();
  walk(s, [[5, 26], [6, 26]]);
  G.cmdStep(s, 1, 0); run(s, 0.5); // (7,26) street
  const b = s.ex.battery;
  G.cmdStep(s, 1, 0); run(s, 0.5); // (8,26) building
  eq(s.ex.battery, b); eq(s.ex.x, 7);
});
test('empty battery -> automatic return and recharge at dock', () => {
  const s = fresh();
  walk(s, [[5, 26], [6, 26], ...line(6, 26, 6, 20), ...line(6, 20, 9, 20)]);
  eq(s.ex.battery, 0);
  run(s, 3);
  eq(s.ex.mode, 'home'); eq(s.ex.battery, G.maxBattery(s));
  eq(s.cable[idx(s, 9, 20)], 1, 'trail persists after return');
});
test('second sortie can ride the grid then extend beyond it', () => {
  const s = fresh();
  walk(s, [[5, 26], [6, 26], ...line(6, 26, 6, 20), ...line(6, 20, 9, 20)]);
  run(s, 3);
  ok(G.cmdMoveTo(s, 12, 20));
  run(s, 4);
  eq(s.ex.x, 12); eq(s.ex.battery, G.maxBattery(s) - 3);
  ok(fac(s, 'F').connected, 'factory connected by cable');
});
test('path plan reports battery cost and reachable prefix', () => {
  const s = fresh();
  const p = G.planPath(s, 12, 20);
  ok(p.cost > 10, 'factory is out of reach on sortie 1');
  ok(p.reach < p.path.length);
});
test('"go there" walks toward a building and stops next to it', () => {
  const s = fresh();
  s.ex.battery = 99;
  ok(G.cmdGoAdjacent(s, fac(s, 'F').tiles));
  run(s, 4);
  ok(fac(s, 'F').connected, 'factory connected');
  ok(G.adjacentTo(s, fac(s, 'F').tiles, s.ex.x, s.ex.y), 'explorer stands next to the factory');
});
test('loose scrap is collected when stepped on', () => {
  const s = fresh();
  walk(s, [[5, 26], [6, 26], [6, 25], [7, 25]]);
  eq(s.res.scrap, BAL.scrapPile);
  ok(!s.items[idx(s, 7, 25)]);
});

console.log('\nOld grid, breaks & lamps');
test('touching an old line energizes it up to the break (cascade)', () => {
  const s = fresh();
  s.ex.battery = 99;
  walk(s, [[5, 26], [6, 26], ...line(6, 26, 6, 20), ...line(6, 20, 14, 20)]);
  eq(s.powered[idx(s, 19, 21)], 0);
  walk(s, [[15, 20]]);
  eq(s.powered[idx(s, 19, 21)], 1, 'old line powered up to the break');
  eq(s.powered[idx(s, 21, 21)], 0, 'beyond the break stays dead');
  ok(s.lamps[s.lampAt[idx(s, 16, 21)]].lit, 'lamp lit');
  ok(!s.lamps[s.lampAt[idx(s, 18, 21)]].lit, 'broken lamp stays dark');
  ok(!G.exStepInfo(s, idx(s, 20, 21)).ok, 'break is impassable for the explorer');
});
test('repairing a break lets the cascade continue', () => {
  const s = fresh();
  s.ex.battery = 99;
  walk(s, [[5, 26], [6, 26], ...line(6, 26, 6, 20), ...line(6, 20, 15, 20)]);
  G.repairBreak(s, idx(s, 20, 21));
  eq(s.powered[idx(s, 25, 21)], 1);
});

console.log('\nFacilities, robots & economy');
function setupFactory() {
  const s = fresh();
  s.ex.battery = 99;
  walk(s, [[5, 26], [6, 26], ...line(6, 26, 6, 20), ...line(6, 20, 12, 20)]);
  return s;
}
test('factory needs connection and scrap, then wakes a robot', () => {
  const s = fresh();
  const F = fac(s, 'F');
  ok(!G.orderRestore(s, F.id).ok, 'cannot restore unconnected');
  const s2 = setupFactory(); const F2 = fac(s2, 'F');
  s2.res.scrap = 0;
  ok(!G.orderRestore(s2, F2.id).ok, 'cannot restore without scrap');
  s2.res.scrap = 10;
  ok(G.orderRestore(s2, F2.id).ok);
  eq(F2.state, 'active'); eq(s2.res.scrap, 0);
  eq(G.supply(s2), MD.FAC.D.power, 'the factory makes no power itself'); eq(s2.robots.length, 1); eq(s2.robots[0].role, 'idle');
});
test('miner + hauler deliver scrap to the dock along the grid', () => {
  const s = setupFactory();
  s.res.scrap = 30;
  G.orderRestore(s, fac(s, 'F').id);
  walk(s, [...line(12, 20, 7, 20), [6, 20], [6, 19], [6, 18]]); // touch heap (5,18)
  ok(s.deposits[s.depAt[idx(s, 5, 18)]].connected, 'heap connected');
  G.requestRole(s, 'scrap');
  ok(G.requestRole(s, 'haul').ok, 'build hauler');
  const before = s.res.scrap;
  run(s, 40);
  ok(s.stats.delivered.scrap > 0, 'delivered something');
  ok(s.res.scrap > before, 'storage grew');
});
test('robots can cross the dock between cable branches leaving different sides', () => {
  const s = fresh();
  s.ex.battery = 99;
  // branch A leaves the dock to the north and reaches the heap at (5,18)
  walk(s, [[4, 25], [4, 24], [5, 24], [6, 24], [6, 23], [6, 22], [6, 21], [6, 20], [6, 19], [6, 18]]);
  run(s, 3);
  // branch B leaves the dock to the east and reaches the factory
  walk(s, [[5, 26], [6, 26], [7, 26], [7, 25]]);
  s.ex.battery = 99;
  const p = G.planPath(s, 12, 20);
  ok(p, 'plan to factory');
  G.cmdMoveTo(s, 12, 20); run(s, 6);
  ok(fac(s, 'F').connected);
  const heapSpot = 6 + 18 * s.W, door = G.doorSpot(s, fac(s, 'F'));
  const { dist } = MD.Robots.bfs(s, door);
  ok(dist[heapSpot] >= 0, 'heap reachable from the factory door through the dock');
});
test('miner alone fills the heap buffer (visible bottleneck)', () => {
  const s = setupFactory();
  s.res.scrap = 30;
  G.orderRestore(s, fac(s, 'F').id);
  walk(s, [...line(12, 20, 7, 20), [6, 20], [6, 19], [6, 18]]);
  G.requestRole(s, 'scrap');
  run(s, 60);
  const d = s.deposits[s.depAt[idx(s, 5, 18)]];
  eq(d.buffer, d.cap); eq(s.stats.delivered.scrap, 0);
});
test('repair robot restores a facility with work over time', () => {
  const s = setupFactory();
  s.res.scrap = 100; s.res.crystal = 20;
  G.orderRestore(s, fac(s, 'F').id);
  walk(s, [...line(12, 20, 7, 20), ...line(7, 20, 7, 13)]);
  G.cmdReturn(s); run(s, 2);
  ok(G.buildRelay(s, idx(s, 7, 13)).ok, 'relay at the edge of the dock reach');
  G.cmdMoveTo(s, 7, 13); run(s, 3);
  walk(s, line(7, 13, 17, 13)); // radar at (17,14)
  const R = fac(s, 'R');
  ok(R.connected);
  ok(G.orderRestore(s, R.id).ok);
  eq(R.state, 'restoring');
  G.requestRole(s, 'repair');
  run(s, 30);
  eq(R.state, 'active');
});
test('robots draw power by role; more than the supply slows the whole city', () => {
  const s = setupFactory();
  s.res.scrap = 999;
  G.orderRestore(s, fac(s, 'F').id);
  G.requestRole(s, 'scrap'); G.requestRole(s, 'repair');
  run(s, 6);
  eq(G.demand(s), BAL.upkeep.scrap + BAL.upkeep.repair);
  eq(G.supply(s), 3); eq(s.sat, 1);
  for (let k = 0; k < 3; k++) ok(G.requestRole(s, 'haul').ok, 'no hard robot cap');
  run(s, 40);
  eq(G.demand(s), 6);
  eq(G.coverage(s), 0.5); ok(Math.abs(s.sat - 0.25) < 1e-9, 'speed falls with the square of the coverage');
  G.releaseRole(s, 'haul');
  eq(G.demand(s), 5, 'an idle robot draws nothing');
});
test('brownout slows robot work in proportion to the speed factor', () => {
  const mk = (extra) => {
    const s = setupFactory();
    s.res.scrap = 999;
    G.orderRestore(s, fac(s, 'F').id);
    walk(s, [...line(12, 20, 7, 20), [6, 20], [6, 19], [6, 18]]); // heap (5,18)
    G.requestRole(s, 'scrap');
    for (let k = 0; k < extra; k++) G.requestRole(s, 'idle');
    return s;
  };
  const a = mk(0);
  run(a, 20);
  const b = mk(0);
  b.relays.push(idx(b, 7, 20), idx(b, 8, 20), idx(b, 9, 20), idx(b, 10, 20)); // 4 relays: demand 5 > supply 3
  G.recomputeGrid(b, true);
  run(b, 20);
  const da = a.deposits[a.depAt[idx(a, 5, 18)]].mined, db = b.deposits[b.depAt[idx(b, 5, 18)]].mined;
  ok(da > 0 && db < da * 0.6, 'mined ' + db + ' under brownout vs ' + da);
});
test('generators and substations add supply; generator efficiency adds to every source', () => {
  const s = fresh();
  eq(G.supply(s), MD.FAC.D.power);
  const g = fac(s, 'G'); g.connected = true; s.res.scrap = 99;
  ok(G.orderRestore(s, g.id).ok);
  eq(g.state, 'active', 'generators start without repair work');
  eq(G.supply(s), MD.FAC.D.power + MD.FAC.G.power);
  const sub = fac(s, '1'); sub.connected = true; G.activate(s, sub);
  eq(G.supply(s), MD.FAC.D.power + MD.FAC.G.power + MD.FAC['1'].power);
  s.res.crystal = 99;
  ok(G.buyUpgrade(s, 'gen1').ok);
  eq(G.supply(s), MD.FAC.D.power + MD.FAC.G.power + MD.FAC['1'].power + 3);
});
test('"-" sends a robot back to idle and "+" reuses it without cost', () => {
  const s = setupFactory();
  s.res.scrap = 30;
  G.orderRestore(s, fac(s, 'F').id);
  G.requestRole(s, 'haul');
  G.releaseRole(s, 'haul');
  const sc = s.res.scrap;
  ok(G.requestRole(s, 'repair').ok);
  eq(s.res.scrap, sc); eq(G.roleCount(s, 'repair'), 1);
});

console.log('\nUpgrades & ending');
test('upgrades cost resources and change abilities', () => {
  const s = fresh();
  s.res.scrap = 100; s.res.crystal = 20;
  ok(!G.buyUpgrade(s, 'bat2').ok, 'bat2 locked behind bat1');
  ok(G.buyUpgrade(s, 'bat1').ok); eq(G.maxBattery(s), 13);
  ok(G.buyUpgrade(s, 'drill').ok); ok(G.exStepInfo(s, idx(s, 26, 20)).ok);
  ok(G.buyUpgrade(s, 'hover').ok); ok(G.exStepInfo(s, idx(s, 10, 12)).ok);
  const cost = (id) => MD.UPGRADES.find((u) => u.id === id).cost.scrap;
  eq(s.res.scrap, 100 - cost('bat1') - cost('drill') - cost('hover'));
});
test('reactor requires all three substations', () => {
  const s = fresh();
  const X = fac(s, 'X'); X.connected = true; s.res.scrap = 999; s.res.crystal = 999;
  ok(!G.canRestore(s, X).ok);
  for (const ch of ['1', '2', '3']) G.activate(s, fac(s, ch));
  ok(G.canRestore(s, X).ok);
});
test('ignition happens when the explorer reaches the ready reactor', () => {
  const s = fresh();
  const X = fac(s, 'X'); X.state = 'ready';
  s.ex.x = 34; s.ex.y = 4;
  run(s, 0.1);
  ok(s.won); eq(s.restoration, 100);
});
test('save/load roundtrip via JSON keeps the game running', () => {
  const s = setupFactory();
  s.res.scrap = 30; G.orderRestore(s, fac(s, 'F').id); G.requestRole(s, 'haul');
  run(s, 3);
  const copy = JSON.parse(JSON.stringify(Object.assign({}, s, { events: [] })));
  run(copy, 5);
  eq(copy.facilities[fac(s, 'F').id].state, 'active');
  ok(copy.time > s.time);
});

console.log('\nProvisional cable & live floors');
test('provisional cable is anchored the moment it reaches a deposit', () => {
  const s = fresh();
  walk(s, [[4, 25], [4, 24], [5, 24], [6, 24], [6, 23], [6, 22], [6, 21], [6, 20], [6, 19]]);
  eq(s.cable[idx(s, 6, 23)], 2);
  walk(s, [[6, 18]]); // next to the heap at (5,18)
  eq(s.cable[idx(s, 6, 23)], 1, 'whole trail committed');
  ok(s.deposits[s.depAt[idx(s, 5, 18)]].connected, 'heap connected at once');
  eq(s.ex.temp.length, 0);
});
test('a hidden live floor drains extra battery and becomes known', () => {
  const s = fresh();
  const i = idx(s, 6, 25);
  s.hz[i] = 1;
  walk(s, [[5, 26], [6, 26], [6, 25]]);
  eq(s.ex.battery, 10 - 1 - 1 - BAL.hazardDrain);
  ok(s.hzKnown[i], 'now known');
  eq(s.ex.mode, 'out');
  const j = idx(s, 6, 24); s.hz[j] = 1; s.hzKnown[j] = 1;
  eq(G.exStepInfo(s, j).cost, 1 + BAL.hazardDrain, 'known floors are priced into plans');
});
test('overdrawing on a live floor burns out the provisional cable and drops the pickups', () => {
  const s = fresh();
  const hz = idx(s, 7, 20);
  s.hz[hz] = 1;
  walk(s, [[5, 26], [6, 26], [6, 25], [7, 25], ...line(7, 25, 7, 20)]); // picks up scrap at (7,25)
  eq(s.ex.mode, 'shorted');
  run(s, BAL.shortDelay + 0.2);
  eq(s.ex.mode, 'home'); eq(s.ex.battery, G.maxBattery(s));
  eq(s.cable[idx(s, 6, 26)], 0); eq(s.cable[idx(s, 7, 21)], 0);
  ok(s.items[idx(s, 7, 25)], 'scrap dropped back where it was');
  eq(s.res.scrap, 0);
  ok(s.hzKnown[hz], 'the live floor stays known');
  eq(s.stats.recalls, 1);
});
test('an overdraw also trips the whole grid for a while', () => {
  const s = setupFactory();
  s.res.scrap = 30;
  G.orderRestore(s, fac(s, 'F').id);
  G.requestRole(s, 'haul');
  run(s, 3);
  G.cmdReturn(s); run(s, 2);
  G.cmdMoveTo(s, 12, 20); run(s, 3);
  s.hz[idx(s, 12, 21)] = 1;
  s.ex.battery = 2;
  walk(s, [[12, 21]]);
  ok(s.tripT > 0, 'breakers out'); eq(s.sat, 0);
  const r = s.robots[0], x0 = r.x, y0 = r.y;
  run(s, 1);
  ok(r.x === x0 && r.y === y0, 'robots stand still');
  run(s, BAL.tripTime);
  eq(s.tripT, 0); eq(s.sat, 1);
});
test('a known live floor is never stepped on without the battery for it', () => {
  const s = fresh();
  const j = idx(s, 6, 24); s.hz[j] = 1; s.hzKnown[j] = 1;
  walk(s, [[5, 26], [6, 26], [6, 25]]);
  s.ex.battery = BAL.hazardDrain;
  walk(s, [[6, 24]]);
  eq(s.ex.y, 25, 'refused'); eq(s.ex.mode, 'out');
});
test('the scanner exposes live floors around the explorer', () => {
  const s = fresh();
  const j = idx(s, 9, 20); s.hz[j] = 1;
  G.revealAround(s, 8, 20);
  ok(!s.hzKnown[j], 'not without the scanner');
  s.upgrades.scanner = true;
  G.revealAround(s, 8, 20);
  ok(s.hzKnown[j]);
});
test('live floors are placed only on plain streets away from the dock and from goals', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const s = G.newGame({ seed });
    const d = G.dock(s);
    let n = 0;
    for (let i = 0; i < s.hz.length; i++) {
      if (!s.hz[i]) continue;
      n++;
      const x = i % s.W, y = (i / s.W) | 0;
      ok(s.tile[i] === G.T.STREET && !s.old[i] && !s.items[i], 'plain street ' + x + ',' + y);
      ok(Math.abs(x - d.x - 1) + Math.abs(y - d.y - 1) > BAL.hazardSafeRadius, 'away from the dock');
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const k = (y + dy) * s.W + x + dx;
        if (k === i) continue;
        ok(s.facAt[k] < 0 && s.depAt[k] < 0 && !s.hz[k], 'nothing important next to ' + x + ',' + y);
      }
    }
    ok(n >= 8 && n <= 60, 'seed ' + seed + ': ' + n + ' live floors');
  }
});

test('the surge knocks out the nearest generator until repair robots fix it', () => {
  const s = setupFactory();
  s.res.scrap = 99;
  G.orderRestore(s, fac(s, 'F').id);
  s.cable[idx(s, 5, 21)] = 1; s.cable[idx(s, 4, 21)] = 1; G.recomputeGrid(s, true); // a line to the west generator
  const g = fac(s, 'G'); ok(g.connected); G.orderRestore(s, g.id);
  const sub = fac(s, '1'); sub.connected = true; G.activate(s, sub);
  const light = s.districtLight.sw, before = G.supply(s);
  G.cmdMoveTo(s, 12, 20); run(s, 3);
  s.hz[idx(s, 12, 21)] = 1; s.ex.battery = 2;
  walk(s, [[12, 21]]);
  ok(g.damaged && g.state === 'restoring', 'the west generator is closer than the substation');
  eq(sub.state, 'active');
  eq(G.supply(s), before - MD.FAC.G.power);
  G.requestRole(s, 'repair');
  run(s, BAL.tripTime + BAL.surgeRepair * 3);
  eq(g.state, 'active'); ok(!g.damaged);
  eq(G.supply(s), before, 'generation back after the repair');
  eq(s.districtLight.sw, light, 'a repair does not count as a new restoration');
});
test('a damaged substation stops generating but still carries power along the grid', () => {
  const s = fresh();
  const sub = fac(s, '1'); sub.connected = true; G.activate(s, sub);
  const i = idx(s, 41, 24);
  sub.state = 'restoring'; sub.damaged = true; sub.work = 0; sub.need = BAL.surgeRepair;
  G.recomputeGrid(s, true);
  eq(s.powered[i], 1, 'reach kept');
  eq(G.supplyOf(s, sub), 0, 'no generation');
});

console.log('\nPower reach & relay towers');
function trailToRow13(s) {
  s.ex.battery = 99;
  walk(s, [[5, 26], [6, 26], ...line(6, 26, 6, 20), ...line(6, 20, 7, 20), ...line(7, 20, 7, 13), ...line(7, 13, 11, 13)]);
  G.cmdReturn(s); run(s, 2);
}
test('cable beyond the dock reach carries no power', () => {
  const s = fresh();
  trailToRow13(s);
  eq(s.volt[idx(s, 9, 13)], 0); eq(s.powered[idx(s, 9, 13)], 1);
  eq(s.volt[idx(s, 10, 13)], -1); eq(s.powered[idx(s, 10, 13)], 0);
});
test('a relay tower restarts the reach; it must stand on live cable and costs more each time', () => {
  const s = fresh();
  trailToRow13(s);
  s.res.scrap = 100;
  ok(!G.buildRelay(s, idx(s, 10, 13)).ok, 'not on a dead line');
  ok(!G.buildRelay(s, idx(s, 10, 14)).ok, 'not off the grid');
  const gain = G.relayGain(s, idx(s, 9, 13));
  ok(gain.indexOf(idx(s, 10, 13)) >= 0 && gain.indexOf(idx(s, 11, 13)) >= 0, 'preview lists the tiles that would come alive');
  ok(G.buildRelay(s, idx(s, 9, 13)).ok, 'placed remotely, the explorer is elsewhere');
  eq(s.res.scrap, 100 - BAL.relayCost);
  eq(s.volt[idx(s, 10, 13)], BAL.relayReach - 1);
  ok(s.powered[idx(s, 11, 13)]);
  eq(G.demandParts(s).relay, BAL.relayUpkeep, 'relays draw power');
  ok(!G.buildRelay(s, idx(s, 9, 13)).ok, 'one per tile');
  eq(G.relayCost(s).scrap, BAL.relayCost + BAL.relayStep);
});
test('old city lines carry power without loss', () => {
  const s = fresh();
  s.ex.battery = 99;
  walk(s, [[5, 26], [6, 26], ...line(6, 26, 6, 20), ...line(6, 20, 15, 20)]);
  ok(s.powered[idx(s, 15, 21)]);
  eq(s.volt[idx(s, 19, 21)], s.volt[idx(s, 15, 21)]);
});
test('an active substation becomes a power source', () => {
  const s = fresh();
  const sub = fac(s, '1'), i = idx(s, 41, 24);
  eq(s.powered[i], 0);
  sub.connected = true; G.activate(s, sub);
  eq(s.powered[i], 1);
  eq(s.volt[i], MD.FAC['1'].reach);
});

console.log('\nFull playthrough (scripted bot)');
test('bot can finish the game without soft-locks', () => {
  const { s, marks } = play({ maxTime: 2400 });
  ok(s.won, 'not won after 40 min; last marks: ' + JSON.stringify(marks.slice(-3)));
  console.log('       bot clear time ' + MD.U.fmtTime(s.time) + ', sorties ' + s.stats.sorties + ', robots ' +
    s.robots.filter((r) => r.role !== 'parade').length);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

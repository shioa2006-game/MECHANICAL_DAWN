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

console.log('\nMap & setup');
test('map is rectangular and fully enclosed', () => {
  const rows = MD.MAP;
  ok(rows.every((r) => r.length === rows[0].length), 'row lengths differ');
  ok(/^#+$/.test(rows[0]) && /^#+$/.test(rows[rows.length - 1]), 'top/bottom border');
  ok(rows.every((r) => r[0] === '#' && r[r.length - 1] === '#'), 'side borders');
});
test('every facility and deposit has a reachable side', () => {
  const s = G.newGame();
  for (const f of s.facilities) {
    if (f.kind === 'dock') continue;
    const sides = []; for (const t of f.tiles) for (const n of G.neighborsOf(s, t)) if (s.facAt[n] !== f.id) sides.push(n);
    ok(sides.some((n) => s.tile[n] !== G.T.BUILDING && s.tile[n] !== G.T.FACILITY), f.name + ' has no open side');
  }
  for (const d of s.deposits) ok(G.neighborsOf(s, d.i).some((n) => s.tile[n] === G.T.STREET), 'deposit ' + d.x + ',' + d.y);
});
test('start state: battery 10, at dock, factory beacon & reactor known', () => {
  const s = G.newGame();
  eq(s.ex.battery, 10); eq(s.ex.mode, 'home');
  ok(fac(s, 'F').known && fac(s, 'X').known);
  ok(!fac(s, '1').known, 'substation 1 should be unknown at start');
});
test('upgrade gates: rubble needs drill, canal needs hover', () => {
  const s = G.newGame();
  ok(!G.exStepInfo(s, idx(s, 26, 20)).ok, 'rubble blocked');
  ok(!G.exStepInfo(s, idx(s, 10, 12)).ok, 'canal blocked');
  s.upgrades.drill = true; s.upgrades.hover = true;
  eq(G.exStepInfo(s, idx(s, 26, 20)).cost, 2);
  eq(G.exStepInfo(s, idx(s, 10, 12)).cost, 1);
});
test('all substations and the reactor reachable with drill+hover', () => {
  const s = G.newGame();
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
test('a step onto new ground costs 1 battery and leaves powered cable', () => {
  const s = G.newGame();
  walk(s, [[5, 26], [6, 26]]);
  eq(s.ex.battery, 9);
  eq(s.cable[idx(s, 6, 26)], 1);
  eq(s.powered[idx(s, 6, 26)], 1);
  eq(s.ex.mode, 'out'); eq(s.stats.sorties, 1);
});
test('walking on existing cable is free', () => {
  const s = G.newGame();
  walk(s, [[5, 26], [6, 26], [6, 25], [6, 24]]);
  const b = s.ex.battery;
  walk(s, [[6, 25], [6, 26], [6, 25]]);
  eq(s.ex.battery, b);
});
test('battery cannot go below zero; buildings block', () => {
  const s = G.newGame();
  walk(s, [[5, 26], [6, 26]]);
  G.cmdStep(s, 1, 0); run(s, 0.5); // (7,26) street
  const b = s.ex.battery;
  G.cmdStep(s, 1, 0); run(s, 0.5); // (8,26) building
  eq(s.ex.battery, b); eq(s.ex.x, 7);
});
test('empty battery -> automatic return and recharge at dock', () => {
  const s = G.newGame();
  walk(s, [[5, 26], [6, 26], ...line(6, 26, 6, 20), ...line(6, 20, 9, 20)]);
  eq(s.ex.battery, 0);
  run(s, 3);
  eq(s.ex.mode, 'home'); eq(s.ex.battery, G.maxBattery(s));
  eq(s.cable[idx(s, 9, 20)], 1, 'trail persists after return');
});
test('second sortie can ride the grid then extend beyond it', () => {
  const s = G.newGame();
  walk(s, [[5, 26], [6, 26], ...line(6, 26, 6, 20), ...line(6, 20, 9, 20)]);
  run(s, 3);
  ok(G.cmdMoveTo(s, 12, 20));
  run(s, 4);
  eq(s.ex.x, 12); eq(s.ex.battery, G.maxBattery(s) - 3);
  ok(fac(s, 'F').connected, 'factory connected by cable');
});
test('path plan reports battery cost and reachable prefix', () => {
  const s = G.newGame();
  const p = G.planPath(s, 12, 20);
  ok(p.cost > 10, 'factory is out of reach on sortie 1');
  ok(p.reach < p.path.length);
});
test('"go there" walks toward a building and stops next to it', () => {
  const s = G.newGame();
  s.ex.battery = 99;
  ok(G.cmdGoAdjacent(s, fac(s, 'F').tiles));
  run(s, 4);
  ok(fac(s, 'F').connected, 'factory connected');
  ok(G.adjacentTo(s, fac(s, 'F').tiles, s.ex.x, s.ex.y), 'explorer stands next to the factory');
});
test('loose scrap is collected when stepped on', () => {
  const s = G.newGame();
  walk(s, [[5, 26], [6, 26], [6, 25], [7, 25]]);
  eq(s.res.scrap, BAL.scrapPile);
  ok(!s.items[idx(s, 7, 25)]);
});

console.log('\nOld grid, breaks & lamps');
test('touching an old line energizes it up to the break (cascade)', () => {
  const s = G.newGame();
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
  const s = G.newGame();
  s.ex.battery = 99;
  walk(s, [[5, 26], [6, 26], ...line(6, 26, 6, 20), ...line(6, 20, 15, 20)]);
  G.repairBreak(s, idx(s, 20, 21));
  eq(s.powered[idx(s, 25, 21)], 1);
});

console.log('\nFacilities, robots & economy');
function setupFactory() {
  const s = G.newGame();
  s.ex.battery = 99;
  walk(s, [[5, 26], [6, 26], ...line(6, 26, 6, 20), ...line(6, 20, 12, 20)]);
  return s;
}
test('factory needs connection and scrap, then wakes a robot and adds power', () => {
  const s = G.newGame();
  const F = fac(s, 'F');
  ok(!G.orderRestore(s, F.id).ok, 'cannot restore unconnected');
  const s2 = setupFactory(); const F2 = fac(s2, 'F');
  s2.res.scrap = 0;
  ok(!G.orderRestore(s2, F2.id).ok, 'cannot restore without scrap');
  s2.res.scrap = 10;
  ok(G.orderRestore(s2, F2.id).ok);
  eq(F2.state, 'active'); eq(s2.res.scrap, 0);
  eq(G.powerCap(s2), 5); eq(s2.robots.length, 1); eq(s2.robots[0].role, 'idle');
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
  const s = G.newGame();
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
  walk(s, [...line(12, 20, 7, 20), ...line(7, 20, 7, 13), ...line(7, 13, 17, 13)]); // radar at (17,14)
  const R = fac(s, 'R');
  ok(R.connected);
  ok(G.orderRestore(s, R.id).ok);
  eq(R.state, 'restoring');
  G.requestRole(s, 'repair');
  run(s, 30);
  eq(R.state, 'active');
});
test('robot cap is limited by power; substations raise it', () => {
  const s = setupFactory();
  s.res.scrap = 999;
  G.orderRestore(s, fac(s, 'F').id);
  for (let k = 0; k < 6; k++) G.requestRole(s, 'haul');
  eq(G.robotTotal(s), 5);
  const sub = fac(s, '1'); sub.connected = true; G.activate(s, sub);
  eq(G.powerCap(s), 8);
  ok(G.requestRole(s, 'haul').ok);
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
  const s = G.newGame();
  s.res.scrap = 100; s.res.crystal = 20;
  ok(!G.buyUpgrade(s, 'bat2').ok, 'bat2 locked behind bat1');
  ok(G.buyUpgrade(s, 'bat1').ok); eq(G.maxBattery(s), 13);
  ok(G.buyUpgrade(s, 'drill').ok); ok(G.exStepInfo(s, idx(s, 26, 20)).ok);
  ok(G.buyUpgrade(s, 'hover').ok); ok(G.exStepInfo(s, idx(s, 10, 12)).ok);
  eq(s.res.scrap, 100 - 10 - 16 - MD.UPGRADES.find((u) => u.id === 'hover').cost.scrap);
});
test('reactor requires all three substations', () => {
  const s = G.newGame();
  const X = fac(s, 'X'); X.connected = true; s.res.scrap = 999; s.res.crystal = 999;
  ok(!G.canRestore(s, X).ok);
  for (const ch of ['1', '2', '3']) G.activate(s, fac(s, ch));
  ok(G.canRestore(s, X).ok);
});
test('ignition happens when the explorer reaches the ready reactor', () => {
  const s = G.newGame();
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

console.log('\nFull playthrough (scripted bot)');
test('bot can finish the game without soft-locks', () => {
  const { s, marks } = play({ maxTime: 2400 });
  ok(s.won, 'not won after 40 min; last marks: ' + JSON.stringify(marks.slice(-3)));
  console.log('       bot clear time ' + MD.U.fmtTime(s.time) + ', sorties ' + s.stats.sorties + ', robots ' +
    s.robots.filter((r) => r.role !== 'parade').length);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

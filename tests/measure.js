// Pacing and power-economy measurements over scripted playthroughs with different priorities.
// Run:  node tests/measure.js [runsPerPolicy] [policy]
// These numbers show where the time goes; they do not say whether the game is fun.
const MD = require('./load.js');
const B = require('./bot.js');
const G = MD.G, T = MD.U.fmtTime;

const base = B.DEFAULT_CFG;
const firstBy = (list, pred) => list.filter(pred).concat(list.filter((g) => !pred(g)));
const POLICIES = {
  // go for generators and substations before anything else
  explore: Object.assign({}, base, {
    label: '探索優先（発電所を先に）',
    goals: firstBy(base.goals, (g) => g.fac && 'FGJKH123'.includes(g.fac)),
    restoreOrder: ['F', 'G', 'J', 'K', 'H', '1', '3', '2', 'W', 'conveyor', 'R', 'X'],
    upgradeOrder: ['drill', 'hover', 'bat1', 'scanner', 'bat2', 'gen1', 'bat3', 'gen2'],
  }),
  // more miners early, spend on generator efficiency and equipment first
  mine: Object.assign({}, base, {
    label: '採掘優先（ロボと強化を先に）',
    goals: firstBy(base.goals, (g) => !!g.dep),
    robotPlan: [['scrap', 1], ['haul', 1], ['scrap', 2], ['haul', 2], ['crystal', 1], ['haul', 3], ['repair', 1]].concat(base.robotPlan),
    upgradeOrder: ['gen1', 'drill', 'bat1', 'gen2', 'scanner', 'hover', 'bat2', 'bat3'],
  }),
  // repair robots early: old lines, lamps and the depot/conveyor logistics first
  repair: Object.assign({}, base, {
    label: '修理優先（古い送電線と物流を先に）',
    goals: firstBy(base.goals, (g) => !!g.tile || g.fac === 'W' || g.fac === 'conveyor'),
    robotPlan: [['repair', 1], ['scrap', 1], ['haul', 1], ['repair', 2], ['crystal', 1], ['repair', 3]].concat(base.robotPlan),
    restoreOrder: ['F', 'W', 'conveyor', 'R', 'G', '1', 'J', '3', 'K', 'H', '2', 'X'],
  }),
  // builds robots past what the generators carry (stays in brownout)
  overbuild: Object.assign({}, base, { label: '作りすぎ（発電量の1.6倍まで製造）', overbuild: 1.6 }),
};

function measure(cfg, seed) {
  const m = {
    out: 0, home: 0, lastNew: 0, brown: 0, trip: 0, satSum: 0, ticks: 0,
    parts: {}, series: [], restores: [], robotsAt: {}, maxScrap: 0, maxCrystal: 0,
  };
  let nextSample = 0;
  const { s } = B.play({
    cfg, seed, maxTime: 2700,
    onTick(s, dt) {
      m.ticks++;
      if (s.ex.mode === 'home') m.home += dt; else m.out += dt;
      if (s.tripT > 0) m.trip += dt; else if (s.sat < 0.999) m.brown += dt;
      m.satSum += s.sat;
      const parts = G.demandParts(s);
      for (const k in parts) m.parts[k] = (m.parts[k] || 0) + parts[k] * dt;
      for (const ev of s.events) {
        if (ev.type === 'lay') m.lastNew = s.time;
        if (ev.type === 'restored') m.restores.push(s.facilities[ev.fac].name);
      }
      for (const min of [3, 6, 9, 12]) if (m.robotsAt[min] == null && s.time >= min * 60) m.robotsAt[min] = G.robotTotal(s);
      m.maxScrap = Math.max(m.maxScrap, s.res.scrap);
      m.maxCrystal = Math.max(m.maxCrystal, s.res.crystal);
      if (s.time >= nextSample) {
        nextSample += 60;
        m.series.push([Math.round(s.time / 60), G.supply(s), G.demand(s), Math.round(s.res.scrap), Math.round(s.res.crystal)]);
      }
    },
  });
  m.s = s;
  return m;
}

function report(name, cfg, runs) {
  const ms = [];
  for (let seed = 1; seed <= runs; seed++) ms.push(measure(cfg, seed));
  const avg = (f) => ms.reduce((a, m) => a + f(m), 0) / ms.length;
  const won = ms.filter((m) => m.s.won).length;
  const t = avg((m) => m.s.time);
  console.log('\n== ' + name + ' — ' + cfg.label + ' (' + won + '/' + runs + ' cleared)');
  console.log('  clear ' + T(t) + '   explorer out ' + T(avg((m) => m.out)) + ' (' + Math.round(avg((m) => m.out / m.s.time) * 100) + '%)' +
    '   at base ' + T(avg((m) => m.home)) + '   last new tile ' + T(avg((m) => m.lastNew)) + ' (' + Math.round(avg((m) => m.lastNew / m.s.time) * 100) + '% of the game)');
  console.log('  brownout ' + T(avg((m) => m.brown)) + '   tripped ' + avg((m) => m.trip).toFixed(0) + 's   average speed ' + Math.round(avg((m) => m.satSum / m.ticks) * 100) + '%');
  const parts = {};
  for (const k in ms[0].parts) parts[k] = Math.round(avg((m) => (m.parts[k] || 0) / m.s.time) * 10) / 10;
  console.log('  average draw by consumer ' + JSON.stringify(parts));
  console.log('  robots at 3/6/9/12 min ' + [3, 6, 9, 12].map((k) => Math.round(avg((m) => m.robotsAt[k] || G.robotTotal(m.s)))).join(' / ') +
    '   max scrap ' + Math.round(avg((m) => m.maxScrap)) + '  max crystal ' + Math.round(avg((m) => m.maxCrystal)) +
    '   left at the end ' + Math.round(avg((m) => m.s.res.scrap)) + ' / ' + Math.round(avg((m) => m.s.res.crystal)));
  console.log('  restore order (seed 1) ' + ms[0].restores.join(' > '));
  console.log('  minute: supply/demand scrap/crystal (seed 1) ' + ms[0].series.map((r) => r[0] + ':' + r[1] + '/' + r[2] + ' ' + r[3] + '/' + r[4]).join('  '));
}

const runs = +(process.argv[2] || 5);
const only = process.argv[3];
for (const k in POLICIES) if (!only || only === k) report(k, POLICIES[k], runs);

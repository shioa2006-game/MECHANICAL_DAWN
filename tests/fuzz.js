// Randomised strategies: shuffled exploration goals, upgrade/restore orders, robot plans,
// live-floor layouts and risk appetite (cautious / reckless explorer).
// Every run must reach the ending (no soft-lock).   Run:  node tests/fuzz.js [runs] [firstSeed]
const MD = require('./load.js');
const { play, DEFAULT_CFG } = require('./bot.js');

function rng(seed) {
  let t = seed >>> 0;
  return () => { t += 0x6D2B79F5; let r = Math.imul(t ^ (t >>> 15), t | 1); r ^= r + Math.imul(r ^ (r >>> 7), r | 61); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}
function shuffle(a, r) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

const runs = +(process.argv[2] || 10);
let failed = 0;
const times = [], byStyle = { cautious: [], reckless: [] };
const first = +(process.argv[3] || 1);
for (let k = first; k < first + runs; k++) {
  const r = rng(k * 7919);
  const roles = ['scrap', 'crystal', 'haul', 'repair'];
  const counts = { scrap: 0, crystal: 0, haul: 0, repair: 0 };
  const robotPlan = [];
  for (let n = 0; n < 18; n++) { const role = roles[Math.floor(r() * roles.length)]; robotPlan.push([role, ++counts[role]]); }
  const cfg = {
    goals: shuffle(DEFAULT_CFG.goals, r),
    restoreOrder: shuffle(DEFAULT_CFG.restoreOrder, r),
    upgradeOrder: shuffle(DEFAULT_CFG.upgradeOrder, r),
    robotPlan,
    impatient: true,   // buys whatever upgrade is affordable instead of saving
    adaptive: true,    // reassigns roles when the hint panel reports a missing key role
    reckless: r() < 0.5, // walks into suspicious tiles even with too little battery to survive a live floor
  };
  const style = cfg.reckless ? 'reckless' : 'cautious';
  const { s } = play({ cfg, maxTime: 2700, seed: k });
  const t = MD.U.fmtTime(s.time);
  if (!s.won) {
    failed++;
    console.log('  FAIL run ' + k + ' stuck at ' + t + ' restoration ' + s.restoration.toFixed(0) + '% res ' + JSON.stringify(s.res) +
      ' fac ' + s.facilities.map((f) => f.ch + ':' + f.state[0] + (f.connected ? 'c' : '')).join(' ') + ' up ' + Object.keys(s.upgrades).join(','));
  } else {
    times.push(s.time); byStyle[style].push(s);
    console.log('  ok   run ' + k + ' cleared in ' + t + ' (' + style + ', ' + s.stats.sorties + ' sorties, ' + s.relays.length + ' relays, ' +
      (s.stats.shocks || 0) + ' shocks, ' + s.stats.recalls + ' recalls / ' + s.stats.lostTiles + ' tiles lost)');
  }
}
if (times.length) console.log('clear time min ' + MD.U.fmtTime(Math.min(...times)) + ' / max ' + MD.U.fmtTime(Math.max(...times)));
for (const k in byStyle) {
  const a = byStyle[k];
  if (!a.length) continue;
  const avg = (fn) => a.reduce((x, s) => x + fn(s), 0) / a.length;
  console.log(k + ': ' + a.length + ' runs, avg clear ' + MD.U.fmtTime(avg((s) => s.time)) + ', avg recalls ' + avg((s) => s.stats.recalls).toFixed(1) +
    ', avg tiles lost ' + avg((s) => s.stats.lostTiles).toFixed(1) + ', avg relays ' + avg((s) => s.relays.length).toFixed(1));
}
console.log(runs - failed + '/' + runs + ' strategies reached the ending');
process.exit(failed ? 1 : 0);

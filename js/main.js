/* MECHANICAL DAWN — main.js : boot, loop, screens, event effects, camera, save */
(function (root) {
  'use strict';
  const MD = root.MD, U = MD.U, G = MD.G, RV = MD.Render, A = MD.Audio, UI = MD.UI;
  const SAVE_KEY = 'mechanical-dawn-save-v1';
  const PREF_KEY = 'mechanical-dawn-prefs';
  const TS = 16;
  const ZOOMS = [1, 1.5, 2, 2.5, 3, 4, 5];
  const $ = (id) => document.getElementById(id);

  let s = null, demo = null;
  let mode = 'title';
  let speed = 1, now = 0, lastTs = 0, saveT = 0;
  let zoomIdx = 4;
  let touchMode = false;
  let lastBlocked = { t: -9, i: -1 };
  let endingShown = false;
  const view = { hover: null, hoverOk: true, plan: null, planLabel: null, selection: null, pointer: null, follow: true, focus: null, touchTarget: null };
  let planKey = '';

  // ---------------------------------------------------------------- persistence

  function save() {
    if (!s) return;
    try {
      const data = Object.assign({}, s, { events: [] });
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) { /* storage unavailable: play continues without saving */ }
  }
  function loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (d.v !== 1 || d.W !== MD.MAP[0].length || d.H !== MD.MAP.length) return null;
      d.events = [];
      return d;
    } catch (e) { return null; }
  }
  function prefs(p) {
    try {
      if (p) localStorage.setItem(PREF_KEY, JSON.stringify(p));
      return JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    } catch (e) { return {}; }
  }

  // ---------------------------------------------------------------- screens

  function showScreen(id) {
    for (const k of ['title', 'intro', 'help', 'pause', 'ending']) $(k).classList.toggle('hidden', k !== id);
  }

  function makeDemo() {
    const d = G.newGame();
    d.revealed.fill(1);
    d.districtLight = { sw: 0.35, ind: 0.25, nw: 0.2, core: 0.12 };
    d.restoration = 18;
    for (const f of d.facilities) f.seen = true;
    return d;
  }

  function toTitle() {
    if (s && mode !== 'title') save();
    mode = 'title';
    UI.show(false);
    showScreen('title');
    $('btn-continue').classList.toggle('hidden', !loadSave());
    demo = demo || makeDemo();
    RV.attach(demo);
    RV.cam.zoom = 2;
  }

  function newGame() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
    s = G.newGame();
    endingShown = false;
    startIntro();
  }

  function continueGame() {
    const d = loadSave();
    if (!d) { newGame(); return; }
    s = d;
    endingShown = !!s.won;
    enterPlay();
    UI.toast('つづきから再開しました', 'info');
  }

  let introIdx = 0, introTimer = 0;
  function startIntro() {
    mode = 'intro';
    showScreen('intro');
    const box = $('intro-lines');
    box.innerHTML = MD.INTRO.map((l, k) => '<div' + (k === MD.INTRO.length - 1 ? ' class="last"' : '') + '>' + l + '</div>').join('');
    introIdx = 0; introTimer = 0.4;
  }
  function introNext() {
    if (mode !== 'intro' || !s) return;
    const lines = $('intro-lines').children;
    if (introIdx < lines.length) { lines[introIdx].classList.add('on'); introIdx++; introTimer = 2.4; A.play('log'); return; }
    enterPlay(true);
  }

  function enterPlay(fresh) {
    mode = 'play';
    showScreen(null);
    UI.show(true);
    UI.forceRefresh();
    RV.attach(s);
    zoomIdx = defaultZoomIdx();
    RV.cam.zoom = ZOOMS[zoomIdx];
    centerExplorer(true);
    view.selection = null;
    A.init();
    if (fresh) {
      setTimeout(() => UI.toast('WASD／矢印キーで1歩ずつ。マウスを地面に乗せると経路と消費バッテリーが見え、クリックで移動。', 'info', 8000), 600);
    }
  }

  function defaultZoomIdx() {
    // aim for roughly 26-30 tiles across the screen
    const want = window.innerWidth / (28 * TS);
    let best = 0;
    for (let k = 0; k < ZOOMS.length; k++) if (ZOOMS[k] <= Math.max(2, want)) best = k;
    return Math.min(best, 5);
  }

  function showEnding() {
    endingShown = true;
    mode = 'ending';
    showScreen('ending');
    const st = s.stats;
    const robots = s.robots.filter((r) => r.role !== 'parade').length;
    $('end-stats').innerHTML = [
      ['クリアタイム', U.fmtTime(s.wonAt)], ['出撃回数', st.sorties + '回'], ['敷いたケーブル', st.cables + 'マス'],
      ['ロボット', robots + '体'], ['復活した古い送電線', st.cascades + '区間'], ['回収した記録', s.logsRead.length + '/' + MD.LOGS.length],
    ].map(([k, v]) => '<div>' + k + '<b>' + v + '</b></div>').join('');
    save();
  }

  // ---------------------------------------------------------------- camera

  function centerExplorer(instant) {
    if (!s) return;
    view.follow = true;
    view.focus = null;
    if (instant) { RV.cam.x = (s.ex.fx + 0.5) * TS; RV.cam.y = (s.ex.fy + 0.5) * TS; }
  }

  function zoom(dir, sx, sy) {
    const ni = U.clamp(zoomIdx + dir, 0, ZOOMS.length - 1);
    if (ni === zoomIdx) return;
    const before = sx != null ? RV.screenToWorld(sx, sy) : null;
    zoomIdx = ni;
    RV.cam.zoom = ZOOMS[ni];
    if (before) {
      const after = RV.screenToWorld(sx, sy);
      RV.cam.x += before.x - after.x;
      RV.cam.y += before.y - after.y;
      view.follow = false;
    }
    RV.clampCam();
    planKey = '';
  }

  function updateCamera(dt) {
    const e = s.ex;
    let tx = null, ty = null, k = 6;
    if (RV.fx.ending) {
      const X = G.reactor(s);
      tx = (X.x + X.w / 2) * TS; ty = (X.y + X.h / 2) * TS; k = 1.5;
      const age = now - RV.fx.ending.t0;
      if (age > 2.5 && RV.cam.zoom > 1.5 && age < 9) { zoomIdx = Math.max(1, zoomIdx); RV.cam.zoom = Math.max(1.5, RV.cam.zoom - dt * 0.35); }
    } else if (view.focus && now < view.focus.until) {
      tx = view.focus.x; ty = view.focus.y; k = 3;
    } else {
      view.focus = null;
      if (view.follow) { tx = (e.fx + 0.5) * TS; ty = (e.fy + 0.5) * TS; k = e.mode === 'returning' ? 9 : 5; }
    }
    if (tx != null) {
      RV.cam.x += (tx - RV.cam.x) * Math.min(1, dt * k);
      RV.cam.y += (ty - RV.cam.y) * Math.min(1, dt * k);
    }
    RV.clampCam();
  }

  // ---------------------------------------------------------------- hover & plan preview

  function computePlan(t) {
    view.plan = null; view.planLabel = null; view.hoverOk = true;
    if (!t || !G.inb(s, t.x, t.y) || !G.canCommand(s)) return;
    const i = t.y * s.W + t.x;
    if (s.facAt[i] >= 0 || s.depAt[i] >= 0) return;
    const e = s.ex, fx = e.moving ? e.to.x : e.x, fy = e.moving ? e.to.y : e.y;
    if (t.x === fx && t.y === fy) return;
    const p = G.planPath(s, t.x, t.y, fx, fy);
    if (!p) {
      view.hoverOk = false;
      if (s.revealed[i] && s.tile[i] !== G.T.BUILDING) view.planLabel = { x: t.x, y: t.y, text: 'ここへは行けない', col: '#ff6b5b' };
      return;
    }
    view.plan = p;
    let text, col;
    if (p.cost === 0) { text = 'ケーブル上を移動（消費 0）'; col = '#ffe08a'; }
    else if (p.reach >= p.path.length) { text = 'バッテリー ' + p.cost + ' / ' + e.battery + (p.unknown ? '（未探索あり）' : ''); col = '#8ff8ff'; }
    else { text = 'バッテリーが ' + (p.cost - e.battery) + ' 足りない'; col = '#ff6b5b'; view.hoverOk = false; }
    view.planLabel = { x: t.x, y: t.y, text, col };
  }

  function updateHover() {
    const m = MD.Input.mouse;
    let t = null;
    if (touchMode) t = view.touchTarget;
    else if (m.inside) t = RV.screenToTile(m.x, m.y);
    view.hover = t;
    if (!t) { view.plan = null; view.planLabel = null; UI.tooltip(0, 0, null); planKey = ''; return; }
    if (!touchMode) UI.tooltip(m.x, m.y, UI.tileInfo(s, t.x, t.y));
    const e = s.ex;
    const key = t.x + ',' + t.y + '|' + e.x + ',' + e.y + '|' + e.battery + '|' + s.gridVersion + '|' + e.mode + '|' + (e.moving ? e.to.x + ',' + e.to.y : '') + '|' + Object.keys(s.upgrades).length;
    if (key !== planKey) { planKey = key; computePlan(t); }
  }

  function updatePointer() {
    const o = G.objective(s);
    view.pointer = null;
    if (o.target == null) return;
    if (typeof o.target === 'number') {
      const f = s.facilities[o.target];
      view.pointer = { x: (f.x + f.w / 2) * TS, y: (f.y + f.h / 2) * TS, col: f.kind === 'factory' && !f.seen ? '#ff4a3c' : '#ffcf6b' };
    } else if (o.target.dep != null) {
      const d = s.deposits[o.target.dep];
      view.pointer = { x: (d.x + 0.5) * TS, y: (d.y + 0.5) * TS, col: '#d8c3a0' };
    }
  }

  // ---------------------------------------------------------------- actions

  function select(sel, pan) {
    view.selection = sel;
    UI.forceRefresh();
    A.play('click');
    if (pan && sel.fac != null) {
      const f = s.facilities[sel.fac];
      view.follow = false;
      view.focus = { x: (f.x + f.w / 2) * TS, y: (f.y + f.h / 2) * TS, until: now + 1.5 };
    }
  }

  function onClick(sx, sy, touch) {
    A.init();
    touchMode = !!touch;
    if (mode !== 'play' || !s) return;
    const t = RV.screenToTile(sx, sy);
    if (!G.inb(s, t.x, t.y)) return;
    const i = t.y * s.W + t.x;
    const w = RV.screenToWorld(sx, sy);
    const bot = s.robots.find((r) => r.role !== 'parade' && Math.abs((r.x + 0.5) * TS - w.x) < 7 && Math.abs((r.y + 0.5) * TS - w.y) < 8);
    if (bot && !(t.x === s.ex.x && t.y === s.ex.y)) { select({ robot: bot.id }); return; }
    const fi = s.facAt[i];
    if (fi >= 0 && (s.revealed[i] || s.facilities[fi].known)) { select({ fac: fi }); return; }
    const di = s.depAt[i];
    if (di >= 0 && s.revealed[i]) { select({ dep: di }); return; }
    if (touch && (!view.touchTarget || view.touchTarget.x !== t.x || view.touchTarget.y !== t.y)) {
      view.touchTarget = t; planKey = '';
      return;
    }
    view.touchTarget = null;
    if (G.cmdMoveTo(s, t.x, t.y)) { view.follow = true; view.focus = null; }
    else A.play('deny');
  }

  function onStep(dx, dy, repeat) {
    A.init();
    if (mode !== 'play') return;
    touchMode = false;
    if (G.cmdStep(s, dx, dy, repeat)) { view.follow = true; view.focus = null; }
  }

  function returnHome() {
    if (mode !== 'play') return;
    if (G.cmdReturn(s)) view.follow = true;
  }

  function cycleSpeed() {
    speed = speed === 1 ? 2 : speed === 2 ? 3 : 1;
    UI.setSpeedLabel(speed);
    A.play('click');
  }

  function toggleSound() {
    A.init();
    A.setMuted(!A.muted);
    UI.setSoundLabel(!A.muted);
    prefs(Object.assign(prefs(), { muted: A.muted }));
  }

  function escape() {
    if (mode === 'play') {
      if (view.selection) { view.selection = null; return; }
      if (!$('logbox').classList.contains('hidden')) { $('logbox').classList.add('hidden'); return; }
      mode = 'pause';
      showScreen('pause');
    }
  }

  let helpFrom = null;
  function showHelp() {
    helpFrom = mode;
    if (mode === 'play') mode = 'help';
    showScreen('help');
  }
  function closeHelp() {
    if (helpFrom === 'title') { showScreen('title'); mode = 'title'; return; }
    if (helpFrom === 'pause') { mode = 'pause'; showScreen('pause'); return; }
    mode = s ? (endingShown && s.won ? 'watch' : 'play') : 'title';
    if (mode === 'watch') mode = 'play';
    showScreen(null);
  }

  // ---------------------------------------------------------------- events -> effects

  function wpos(x, y) { return [(x + 0.5) * TS, (y + 0.5) * TS]; }
  function vol(x, y) {
    const [wx, wy] = wpos(x, y);
    const d = Math.hypot(wx - RV.cam.x, wy - RV.cam.y) * RV.cam.zoom;
    return U.clamp(1.2 - d / (Math.max(window.innerWidth, window.innerHeight) * 0.7), 0, 1);
  }
  function once(flag, fn) { if (!s.flags[flag]) { s.flags[flag] = 1; fn(); } }
  function facCenter(f) { return [(f.x + f.w / 2) * TS, (f.y + f.h / 2) * TS]; }

  const BLOCK_WHY = {
    rubble: '瓦礫：ドリルアームが必要', canal: '冷却水路：ホバー脚が必要', break: '断線：修理ロボが直せる',
    wall: '建物', deposit: '資源（隣接で接続）', facility: '施設（隣接で接続）', conveyor: 'コンベヤー',
  };

  function handle(ev) {
    switch (ev.type) {
      case 'lay': {
        const i = ev.y * s.W + ev.x;
        RV.powerFlash(i, now);
        const [wx, wy] = wpos(ev.x, ev.y);
        RV.burst(wx, wy, { n: 5, speed: 22, cols: ['#ffe08a', '#ffb347'], life: 0.35, g: 0 });
        A.play('step'); A.play('lay', { battery: ev.battery });
        break;
      }
      case 'glide': A.play('glide'); break;
      case 'drill': {
        const [wx, wy] = wpos(ev.x, ev.y);
        RV.burst(wx, wy, { n: 16, speed: 45, cols: ['#ffffff', '#ffb347', '#8a7a6a'], life: 0.5 });
        A.play('drill');
        break;
      }
      case 'rubble': {
        RV.markTerrainDirty();
        const [wx, wy] = wpos(ev.x, ev.y);
        RV.burst(wx, wy, { n: 18, speed: 40, cols: ['#5f5651', '#4a4444', '#8a8079'], life: 0.8, g: 60, emit: false, size: 2 });
        RV.floatText(wx, wy - 6, '+' + ev.amount + ' ⚙', '#d8c3a0');
        A.play('rubble');
        break;
      }
      case 'pickup': {
        const [wx, wy] = wpos(ev.x, ev.y);
        const cr = ev.kind === 'crystal';
        RV.floatText(wx, wy - 6, '+' + ev.amount + (cr ? ' ◆' : ' ⚙'), cr ? '#8ff8ff' : '#ffe9a0');
        RV.burst(wx, wy, { n: 10, speed: 35, cols: cr ? ['#8ff8ff', '#ffffff'] : ['#ffe9a0', '#ffffff'], life: 0.5, g: -10 });
        A.play(cr ? 'crystal' : 'pickup');
        break;
      }
      case 'cell': {
        const [wx, wy] = wpos(ev.x, ev.y);
        RV.floatText(wx, wy - 8, '最大バッテリー +1', '#7dff9a', { big: true, life: 2 });
        RV.ring(wx, wy, { r1: 40, col: '#7dff9a', life: 0.8 });
        A.play('cell');
        UI.toast('予備電池を見つけた！ 最大バッテリーが永久に +1', 'good');
        break;
      }
      case 'log': A.play('log'); UI.showLog(MD.LOGS[ev.log]); break;
      case 'blocked': {
        const i = ev.y * s.W + ev.x;
        if (lastBlocked.i === i && now - lastBlocked.t < 0.8) break;
        lastBlocked = { i, t: now };
        RV.mark(ev.x, ev.y, '#ff5a4c');
        const [wx, wy] = wpos(ev.x, ev.y);
        if (BLOCK_WHY[ev.why] && ev.why !== 'wall') RV.floatText(wx, wy - 6, BLOCK_WHY[ev.why], '#ff9a8a');
        A.play('blocked');
        break;
      }
      case 'noBattery': {
        const i = ev.y * s.W + ev.x;
        if (lastBlocked.i === i && now - lastBlocked.t < 0.8) break;
        lastBlocked = { i, t: now };
        const [wx, wy] = wpos(ev.x, ev.y);
        RV.floatText(wx, wy - 6, 'バッテリー不足', '#ff9a8a');
        A.play('blocked');
        if (s.ex.battery > 0) UI.toast('バッテリーが足りない。R で帰還すれば満充電で出直せる。', 'warn');
        break;
      }
      case 'batteryEmpty': {
        const [wx, wy] = wpos(ev.x, ev.y);
        RV.floatText(wx, wy - 10, 'バッテリー切れ', '#ffb347');
        A.play('empty');
        break;
      }
      case 'return': A.play('ret'); view.follow = true; break;
      case 'recharge': {
        const d = G.dock(s), [cx, cy] = facCenter(d);
        RV.ring(cx, cy, { r1: 34, col: '#7dff9a', life: 0.8 });
        A.play('recharge');
        const sm = ev.summary;
        if (sm && (sm.newTiles || sm.scrap || sm.crystal || sm.found.length)) {
          const parts = [];
          if (sm.newTiles) parts.push('送電路 +' + sm.newTiles);
          if (sm.scrap) parts.push('⚙+' + sm.scrap);
          if (sm.crystal) parts.push('◆+' + sm.crystal);
          if (sm.found.length) parts.push('発見：' + Array.from(new Set(sm.found)).join('・'));
          UI.toast('出撃 #' + s.stats.sorties + ' 帰還 — ' + parts.join(' ／ '), 'good', 4500);
        }
        once('t_recharge', () => setTimeout(() => UI.toast('ケーブルの上はバッテリーを使わない。クリックで一気にケーブルの先まで行ける。', 'info', 7000), 900));
        save();
        break;
      }
      case 'energize': {
        let lamps = 0;
        for (const [i, d] of ev.tiles) {
          RV.powerFlash(i, now + d * 0.05);
          if (s.lampAt[i] >= 0 && lamps < 14) { A.play('ping', { delay: d * 0.05, k: lamps }); lamps++; }
        }
        UI.toast('古い送電線が復活！ ＋' + ev.tiles.length + 'マスの送電網', 'good');
        once('t_old', () => setTimeout(() => UI.toast('古い送電線に触れると、断線までの区間が一気に通電する。', 'info', 6000), 1200));
        break;
      }
      case 'connect': {
        const f = s.facilities[ev.fac], [cx, cy] = facCenter(f);
        RV.ring(cx, cy, { r1: f.w * TS, col: '#8ff8ff', life: 0.9 });
        RV.floatText(cx, f.y * TS, '接続！', '#8ff8ff');
        A.play('connect');
        UI.toast(f.name + 'に送電網がつながった' + (f.state === 'dormant' ? ' — クリックで詳細' : ''), 'info');
        break;
      }
      case 'connectDep': {
        const d = s.deposits[ev.dep], [wx, wy] = wpos(d.x, d.y);
        RV.ring(wx, wy, { r1: 22, col: '#8ff8ff', life: 0.7 });
        RV.floatText(wx, wy - 8, '接続', '#8ff8ff');
        A.play('connect');
        UI.toast((d.kind === 'scrap' ? 'スクラップ山' : '結晶鉱脈') + 'がつながった — 採掘ロボが掘りに来られる', 'info');
        break;
      }
      case 'discover': {
        const f = s.facilities[ev.fac];
        A.play('discover');
        UI.toast('発見：' + f.name, 'info');
        break;
      }
      case 'signal': {
        const f = s.facilities[ev.fac];
        UI.toast('信号を受信：' + f.name + '（闇の中で点滅）', 'info');
        A.play('discover');
        break;
      }
      case 'restoreStart': {
        const f = s.facilities[ev.fac];
        A.play('restoreStart');
        UI.toast(f.name + 'の復旧作業を開始 — 修理ロボが向かう', 'info');
        break;
      }
      case 'restored': {
        const f = s.facilities[ev.fac], [cx, cy] = facCenter(f);
        RV.facPowerUp(f.id, now);
        RV.ring(cx, cy, { r1: 110, col: '#ffe08a', life: 1.4, w: 2 });
        RV.ring(cx, cy, { r1: 60, col: '#ffffff', life: 0.9 });
        RV.burst(cx, cy, { n: 46, speed: 80, cols: ['#ffe08a', '#ffb347', '#ffffff'], life: 1.3, g: 15 });
        RV.shake(1.1);
        if (f.kind === 'radar') RV.ring(cx, cy, { r1: G.def(f).reveal * TS, col: '#8fd3ff', life: 1.8, w: 2 });
        A.play('restored');
        UI.banner(f.name + '　復旧', G.def(f).effect);
        if (!s.ex.moving) view.focus = { x: cx, y: cy, until: now + 2.4 };
        if (f.kind === 'factory') once('t_factory', () => setTimeout(() => UI.toast('目覚めたロボットに役割を与えよう — 右の［ロボット］パネルの＋', 'info', 7000), 1500));
        save();
        break;
      }
      case 'reactorReady': {
        A.play('restored');
        UI.banner('中央動力炉　点火準備完了', 'ホタルを炉の隣へ。最後の一歩で、夜が明ける。');
        break;
      }
      case 'ignite': startEndingFx(); break;
      case 'built': {
        const r = s.robots.find((o) => o.id === ev.rid);
        if (r) { const [wx, wy] = wpos(r.x, r.y); RV.ring(wx, wy, { r1: 20, col: MD.ROLES[ev.role].color, life: 0.6 }); RV.floatText(wx, wy - 8, 'ロボット完成', '#7dff9a'); }
        A.play('build');
        break;
      }
      case 'rescue': {
        const [wx, wy] = wpos(ev.x, ev.y);
        RV.ring(wx, wy, { r1: 26, col: '#7dff9a', life: 0.8 });
        RV.floatText(wx, wy - 8, '起動！', '#7dff9a');
        A.play('rescue');
        if (!ev.factory) UI.toast('休眠ロボットが目覚めた！ 右のパネルで役割を与えよう', 'good');
        break;
      }
      case 'rescueReserve':
        UI.toast('ロボットを見つけたが電力が足りない…（ロボット枠が増えると自動で目覚める）', 'warn', 5000);
        break;
      case 'role': {
        const r = s.robots.find((o) => o.id === ev.rid);
        if (r) { const [wx, wy] = wpos(r.x, r.y); RV.floatText(wx, wy - 8, MD.ROLES[ev.role].icon + MD.ROLES[ev.role].short, MD.ROLES[ev.role].color, { life: 1 }); }
        break;
      }
      case 'upgrade': {
        const u = MD.UPGRADES.find((x) => x.id === ev.id);
        const [wx, wy] = wpos(s.ex.fx, s.ex.fy);
        RV.ring(wx, wy, { r1: 50, col: '#ffe08a', life: 1 });
        RV.burst(wx, wy, { n: 24, speed: 50, cols: ['#ffe08a', '#ffffff'], life: 0.8, g: 0 });
        A.play('upgrade');
        UI.banner('強化：' + u.name, u.desc);
        if (ev.id === 'drill' || ev.id === 'hover' || ev.id === 'scanner') RV.highlight(ev.id, now + 4.5);
        save();
        break;
      }
      case 'mined': {
        const d = s.deposits[ev.dep], v = vol(d.x, d.y);
        if (v > 0.05) {
          const [wx, wy] = wpos(d.x, d.y);
          RV.burst(wx, wy, { n: 3, speed: 18, cols: d.kind === 'crystal' ? ['#59dcff', '#bff4ff'] : ['#8a7a6a', '#b8a68e'], life: 0.4, g: 50, emit: d.kind === 'crystal' });
          A.play('mined', { vol: v });
        }
        break;
      }
      case 'deliver': {
        const v = vol(ev.x, ev.y);
        if (v > 0.05) {
          const [wx, wy] = wpos(ev.x, ev.y);
          RV.floatText(wx, wy - 4, '+' + ev.amount + (ev.kind === 'crystal' ? '◆' : '⚙'), ev.kind === 'crystal' ? '#8ff8ff' : '#d8c3a0', { life: 0.9, dy: -12 });
          A.play('deliver', { vol: v });
        }
        break;
      }
      case 'weld': {
        const r = s.robots.find((o) => o.id === ev.rid);
        if (r) {
          const v = vol(r.x, r.y);
          if (v > 0.05) {
            const [wx, wy] = wpos(r.x, r.y);
            RV.burst(wx + r.face * 6, wy - 2, { n: 4, speed: 40, cols: ['#ffffff', '#8ff8ff', '#ffe08a'], life: 0.3, g: 60 });
            A.play('weld', { vol: v });
          }
        }
        break;
      }
      case 'breakFixed': {
        const [wx, wy] = wpos(ev.x, ev.y);
        RV.ring(wx, wy, { r1: 30, col: '#ffe08a', life: 0.8 });
        A.play('breakFixed');
        UI.toast('断線を修理した！', 'good');
        break;
      }
      case 'lampFixed': {
        const L = s.lamps[ev.lamp];
        RV.powerFlash(L.i, now);
        break;
      }
      case 'trickle': {
        const d = G.dock(s), [cx, cy] = facCenter(d);
        RV.floatText(cx, cy - 10, '+1 ⚙（回収機）', '#8b90a8', { life: 1.2 });
        break;
      }
      case 'buildStart': A.play('click'); break;
    }
  }

  function processEvents() {
    const evs = s.events;
    s.events = [];
    for (const ev of evs) handle(ev);
    // contextual tips that depend on state rather than a single event
    if (G.factory(s).state === 'active' && Object.keys(s.breaks).some((k) => G.neighborsOf(s, +k).some((n) => s.powered[n]))) {
      once('t_break', () => UI.toast('火花を散らす断線は、修理ロボが直すと先の送電線が復活する。', 'info', 6000));
    }
    const d = s.deposits.find((x) => x.connected && x.buffer >= x.cap);
    if (d && !G.roleCount(s, 'haul')) once('t_full', () => UI.toast('置き場が満杯！ 掘った資源は運搬ロボが運ぶまで使えない。', 'warn', 6000));
  }

  // ---------------------------------------------------------------- ending

  function startEndingFx() {
    const X = G.reactor(s), [cx, cy] = facCenter(X);
    RV.fx.ending = { t0: now, stage: 0 };
    RV.facPowerUp(X.id, now);
    RV.shake(2.5);
    A.play('ignite');
    setTimeout(() => A.setLevel(5, true), 2300);
    UI.banner('中央動力炉　点火', '');
    view.selection = null;
    RV.ring(cx, cy, { r1: 80, col: '#ffffff', life: 1.2, w: 2 });
  }

  function endingTick() {
    const E = RV.fx.ending;
    if (!E) return;
    const k = now - E.t0;
    const X = G.reactor(s), [cx, cy] = facCenter(X);
    if (E.stage === 0 && k > 2.2) {
      E.stage = 1;
      RV.ring(cx, cy, { r1: 900, col: '#ffe08a', life: 4, w: 3 });
      RV.ring(cx, cy, { r1: 600, col: '#ffffff', life: 3, w: 2 });
      RV.burst(cx, cy, { n: 120, speed: 160, cols: ['#ffe08a', '#ffffff', '#ffb347', '#b48cff'], life: 2.4, g: 0, drag: 0.95 });
      RV.shake(2);
      UI.banner('夜明け', '機械都市が目を覚ます');
    }
    if (E.stage === 1 && k > 4.2) { E.stage = 2; RV.ring(cx, cy, { r1: 1200, col: '#ffb347', life: 5, w: 2 }); }
    if (!endingShown && k > 9.5) showEnding();
  }

  // ---------------------------------------------------------------- loop

  function frame(ts) {
    const t = ts / 1000;
    const dt = Math.min(0.25, lastTs ? t - lastTs : 0.016);
    lastTs = t;
    if (MD.debug && MD.debug.freeze) { requestAnimationFrame(frame); return; }
    now += dt;
    if (mode === 'play' || mode === 'ending' || mode === 'pause' || mode === 'help') {
      const running = mode === 'play' || mode === 'ending';
      if (running) {
        let sim = dt * (mode === 'play' ? speed : 1);
        while (sim > 1e-6) { const st = Math.min(sim, 1 / 30); G.update(s, st); sim -= st; }
        processEvents();
        endingTick();
        saveT += dt;
        if (saveT > 20) { saveT = 0; save(); }
      }
      updateCamera(dt);
      if (mode === 'play') { updateHover(); updatePointer(); } else { view.plan = null; view.planLabel = null; UI.tooltip(0, 0, null); }
      RV.draw(s, view, now, dt);
      UI.update(s, view, dt);
      const lv = s.won ? 5 : G.factory(s).state !== 'active' ? 0 : s.restoration >= 66 ? 4 : s.restoration >= 42 ? 3 : s.restoration >= 22 ? 2 : 1;
      A.setLevel(lv, s.won && RV.fx.ending && now - RV.fx.ending.t0 > 2.3);
    } else {
      if (introTimer > 0 && mode === 'intro') { introTimer -= dt; if (introTimer <= 0) introNext(); }
      if (demo) {
        RV.cam.x = demo.W * TS / 2 + Math.sin(now * 0.05) * 260;
        RV.cam.y = demo.H * TS / 2 + Math.cos(now * 0.037) * 120;
        RV.draw(demo, { selection: null }, now, dt);
      }
    }
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- boot

  function boot() {
    RV.init($('game'));
    const p = prefs();
    A.muted = !!p.muted;
    UI.setSoundLabel(!A.muted);
    UI.init({
      returnHome, cycleSpeed, toggleSound, showHelp,
      pause: () => { if (mode === 'play') { mode = 'pause'; showScreen('pause'); } },
      zoom: (d) => zoom(d),
      centerExplorer: () => centerExplorer(false),
      minimapJump: (fx, fy) => { view.follow = false; view.focus = null; RV.cam.x = fx * s.W * TS; RV.cam.y = fy * s.H * TS; RV.clampCam(); },
      rolePlus: (role) => {
        const r = G.requestRole(s, role);
        if (!r.ok) { UI.toast(r.why, 'warn'); A.play('deny'); } else A.play('click');
      },
      roleMinus: (role) => { if (G.releaseRole(s, role)) A.play('click'); },
      buyUpgrade: (id) => { const r = G.buyUpgrade(s, id); if (!r.ok) A.play('deny'); },
      restore: (fid) => {
        const r = G.orderRestore(s, fid);
        if (!r.ok) { UI.toast(r.why, 'warn'); A.play('deny'); }
      },
      setRobotRole: (rid, role) => { const r = s.robots.find((o) => o.id === rid); if (r) { MD.Robots.setRole(s, r, role); A.play('click'); } },
      select, deselect: () => { view.selection = null; },
      gotoTarget: (key) => {
        const id = +key.slice(1);
        const tiles = key[0] === 'f' ? s.facilities[id].tiles : [s.deposits[id].i];
        if (G.cmdGoAdjacent(s, tiles)) { view.follow = true; view.focus = null; A.play('click'); }
        else { UI.toast('今の装備では道がない（瓦礫や水路が塞いでいる）', 'warn'); A.play('deny'); }
      },
    });
    MD.Input.init($('game'), {
      blocked: () => mode !== 'play',
      screenKey: (code) => {
        if (mode === 'intro') introNext();
        else if (mode === 'pause' && code === 'Escape') { mode = 'play'; showScreen(null); }
        else if (mode === 'help' || (mode === 'title' && !$('help').classList.contains('hidden'))) closeHelp();
      },
      step: onStep, click: onClick, returnHome, cycleSpeed, toggleSound, showHelp, escape,
      zoom: (d, sx, sy) => zoom(d, sx, sy),
      centerExplorer: () => centerExplorer(false),
      panTo: (x, y) => { view.follow = false; view.focus = null; RV.cam.x = x; RV.cam.y = y; RV.clampCam(); },
      cancel: () => { if (s) { G.cmdStop(s); view.selection = null; view.touchTarget = null; } },
    });
    $('btn-new').onclick = () => { A.init(); if (loadSave() && !confirm('保存データを消して最初から始めますか？')) return; newGame(); };
    $('btn-continue').onclick = () => { A.init(); continueGame(); };
    $('btn-title-help').onclick = () => { helpFrom = 'title'; showScreen('help'); };
    $('btn-help-close').onclick = () => closeHelp();
    $('intro').onclick = () => { A.init(); introNext(); };
    $('btn-resume').onclick = () => { mode = 'play'; showScreen(null); };
    $('btn-pause-help').onclick = () => { helpFrom = 'pause'; showScreen('help'); mode = 'help'; };
    $('btn-restart').onclick = () => { if (confirm('最初からやり直しますか？（進行は失われます）')) { UI.show(false); newGame(); } };
    $('btn-to-title').onclick = () => toTitle();
    $('btn-watch').onclick = () => { mode = 'play'; showScreen(null); };
    $('btn-end-title').onclick = () => toTitle();
    window.addEventListener('resize', () => { RV.resize(); if (s) RV.clampCam(); });
    window.addEventListener('beforeunload', () => { if (mode !== 'title' && s) save(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && s && mode === 'play') save(); });
    toTitle();
    requestAnimationFrame(frame);
    // Console helpers for testing: MD.debug.ff(seconds) fast-forwards the simulation with effects.
    MD.debug = {
      get state() { return s; }, view,
      ff: (sec) => {
        for (let k = 0; k < sec * 30; k++) { G.update(s, 1 / 30); now += 1 / 30; processEvents(); }
        RV.fx.texts.length = 0; RV.fx.particles.length = 0; RV.fx.rings.length = 0;
        return s.time;
      },
      render: (dt) => { now += dt || 0.016; updateCamera(dt || 0.016); RV.draw(s, view, now, dt || 0.016); UI.update(s, view, 1); },
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);

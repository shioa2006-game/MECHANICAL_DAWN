/* MECHANICAL DAWN — ui.js : DOM HUD, panels, cards, tooltips, toasts, minimap */
(function (root) {
  'use strict';
  const MD = root.MD, U = MD.U;
  const UI = MD.UI = {};
  const $ = (id) => document.getElementById(id);
  let H = {};            // handlers from main
  let lastSig = {};      // change detection for DOM rebuilds
  let mm, mmx;           // minimap canvas / ctx
  const MM = 4;          // minimap pixels per tile

  UI.init = function (handlers) {
    H = handlers;
    $('btn-return').onclick = () => H.returnHome();
    $('btn-relay').onclick = () => H.toggleRelayMode();
    $('btn-speed').onclick = () => H.cycleSpeed();
    $('btn-sound').onclick = () => H.toggleSound();
    $('btn-help').onclick = () => H.showHelp();
    $('btn-menu').onclick = () => H.pause();
    $('z-in').onclick = () => H.zoom(1);
    $('z-out').onclick = () => H.zoom(-1);
    $('z-home').onclick = () => H.centerExplorer();
    const side = $('side');
    const syncToggle = () => { $('side-toggle').textContent = 'ロボット／強化 ' + (side.classList.contains('collapsed') ? '▲' : '▼'); };
    if (window.innerWidth <= 900) side.classList.add('collapsed');
    syncToggle();
    $('side-toggle').onclick = () => { side.classList.toggle('collapsed'); syncToggle(); };
    mm = $('minimap');
    mmx = mm.getContext('2d');
    mm.addEventListener('mousedown', (e) => {
      const r = mm.getBoundingClientRect();
      H.minimapJump((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    });
    $('robot-rows').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.plus) H.rolePlus(b.dataset.plus);
      if (b.dataset.minus) H.roleMinus(b.dataset.minus);
    });
    $('upgrade-rows').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b && b.dataset.up) H.buyUpgrade(b.dataset.up);
    });
    $('card').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.close) H.deselect();
      if (b.dataset.restore) H.restore(+b.dataset.restore);
      if (b.dataset.setrole) H.setRobotRole(+b.dataset.rid, b.dataset.setrole);
      if (b.dataset.goto) H.gotoTarget(b.dataset.goto);
    });
    $('obj-hints').addEventListener('click', (e) => {
      const li = e.target.closest('li');
      if (li && li.dataset.fac) H.select({ fac: +li.dataset.fac }, true);
    });
  };

  UI.show = (on) => $('ui').classList.toggle('hidden', !on);

  // ---------------------------------------------------------------- toasts / banner / log

  UI.toast = function (text, kind, ms) {
    const box = $('toasts');
    const d = document.createElement('div');
    d.className = 'toast ' + (kind || '');
    d.textContent = text;
    box.insertBefore(d, box.firstChild);
    while (box.children.length > 3) box.removeChild(box.lastChild);
    setTimeout(() => d.classList.add('out'), ms || 3800);
    setTimeout(() => d.remove(), (ms || 3800) + 600);
  };

  UI.banner = function (title, sub) {
    const b = $('banner');
    b.querySelector('.b1').textContent = title;
    b.querySelector('.b2').textContent = sub || '';
    b.classList.remove('hidden', 'show');
    void b.offsetWidth;
    b.classList.add('show');
  };

  let logTimer = 0;
  UI.showLog = function (log) {
    const b = $('logbox');
    b.innerHTML = '<div class="lh">▣ 記録データを回収 — ' + log.title + '</div><div>' + log.text + '</div><button class="lx">閉じる</button>';
    b.classList.remove('hidden');
    b.querySelector('.lx').onclick = () => b.classList.add('hidden');
    clearTimeout(logTimer);
    logTimer = setTimeout(() => b.classList.add('hidden'), 11000);
  };

  UI.pulseObjective = function () {
    const o = $('objective');
    o.classList.remove('pulse'); void o.offsetWidth; o.classList.add('pulse');
  };

  UI.bump = function (id) {
    const el = $(id) && $(id).parentElement;
    if (!el) return;
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  };

  // ---------------------------------------------------------------- tooltip

  UI.tooltip = function (sx, sy, html) {
    const t = $('tooltip');
    if (!html) { t.classList.add('hidden'); return; }
    t.innerHTML = html;
    t.classList.remove('hidden');
    const w = t.offsetWidth, h = t.offsetHeight;
    t.style.left = Math.min(window.innerWidth - w - 6, sx + 16) + 'px';
    t.style.top = Math.min(window.innerHeight - h - 6, sy + 18) + 'px';
  };

  UI.tileInfo = function (s, x, y) {
    if (x < 0 || y < 0 || x >= s.W || y >= s.H) return null;
    const i = y * s.W + x, G = MD.G;
    if (!s.revealed[i]) {
      const f = s.facAt[i] >= 0 ? s.facilities[s.facAt[i]] : null;
      if (f && f.known) return '<b>' + f.name + '</b> の信号 — 未踏の闇の中';
      return '<span class="ng">未探索</span> — 近づくと見える';
    }
    const fi = s.facAt[i];
    if (fi >= 0) {
      const f = s.facilities[fi];
      const st = { dormant: f.connected ? '停止中・接続済み' : '停止中・未接続', restoring: '復旧作業中', active: '稼働中', ready: '点火待ち', ignited: '稼働中' }[f.state];
      return '<b>' + f.name + '</b>（' + st + '）<br>クリックで詳細';
    }
    const di = s.depAt[i];
    if (di >= 0) {
      const d = s.deposits[di];
      const nm = d.kind === 'scrap' ? 'スクラップ山' : '結晶鉱脈';
      return '<b>' + nm + '</b> ' + (d.connected ? '（接続済み・在庫 ' + d.buffer + '/' + d.cap + '）' : '<br><span class="ng">未接続</span> — ケーブルを隣に伸ばすと採掘できる');
    }
    const it = s.items[i];
    if (it) {
      const nm = { scrap: 'スクラップ（拾うと ⚙+' + it.amount + '）', crystal: '結晶のかけら（◆+' + it.amount + '）', cell: '予備電池（最大バッテリー +1）', log: '記録データ', bot: '休眠中のロボット（触れると目覚める）' }[it.kind];
      return '<b>' + nm + '</b>';
    }
    if (s.old[i] === 2) return '<b>断線（火花）</b><br><span class="ng">ホタルは通れない</span> — 修理ロボが直すと先の送電線が復活';
    const t = s.tile[i];
    if (t === G.T.RUBBLE) return '<b>瓦礫</b><br>' + (s.upgrades.drill ? 'ドリルで砕ける（バッテリー2）' : '<span class="ng">ドリルアームが必要</span>');
    if (t === G.T.CANAL) {
      if (s.cable[i]) return '<b>ケーブルの橋</b> — ロボットも渡れる';
      return '<b>冷却水路</b><br>' + (s.upgrades.hover ? 'ホバーで渡れる（ケーブルが橋になる）' : '<span class="ng">ホバー脚が必要</span>');
    }
    if (t === G.T.BUILDING) return null;
    const L = s.lampAt[i] >= 0 ? s.lamps[s.lampAt[i]] : null;
    const spark = s.hzN[i] && !s.hz[i] ? '<br><span class="warn">火花：周囲8マスに漏電床が ' + s.hzN[i] + ' 個</span>' : '';
    const live = s.hz[i] && s.hzKnown[i];
    if (s.relays.indexOf(i) >= 0) return '<b>中継塔</b> — ここから' + MD.BAL.relayReach + 'マス先まで送電する（維持 ⚡' + MD.BAL.relayUpkeep + '）';
    if (s.cable[i] === 2) {
      return '<b>仮設ケーブル</b> — 基地に帰るか、施設・資源・古い送電線につなぐと確定' +
        '<br><span class="ng">漏電床でバッテリーが尽きると焼き切れる</span>' + spark;
    }
    if (s.cable[i]) {
      return '<b>送電ケーブル</b>' + voltText(s, i) + (live ? '<br>漏電床（ケーブルで絶縁済み）' : '') + spark;
    }
    if (s.old[i] === 1 && (!s.buried[i] || s.upgrades.scanner || s.powered[i])) {
      return '<b>古い送電線</b>' + (s.powered[i] ? '（復活・損失なし）' + voltText(s, i) : '（休眠中）— 送電網で触れると一気に通電') + (L ? (L.broken ? '<br>壊れた街灯（修理ロボが直せる）' : '<br>街灯') : '');
    }
    if (live) return '<b>漏電床</b> — 踏むとバッテリー −' + MD.BAL.hazardDrain + '（ケーブルを敷けば以後は無害）';
    if (spark) return '<b>道路</b>' + spark + '<br>粒の数が多いほど危ない';
    return null;
  };

  function voltText(s, i) {
    const v = s.volt[i];
    if (s.powered[i]) return '<br>電圧 ' + v + (v <= 2 ? ' <span class="warn">（もうすぐ届かなくなる）</span>' : '') + ' — 上はバッテリー消費なし';
    if (v === MD.G.NO_VOLT) return '<br><span class="ng">電気が来ていない</span>';
    return '<br><span class="ng">電圧不足（' + -v + 'マス届かない）</span> — 手前に中継塔［B］を建てるか、近道を敷こう';
  }

  // ---------------------------------------------------------------- HUD

  function setText(id, v) { const el = $(id); if (el && el.textContent !== String(v)) el.textContent = v; }

  function updateHud(s) {
    const G = MD.G, e = s.ex;
    const max = G.maxBattery(s);
    const sig = max + ':' + e.battery;
    if (lastSig.pips !== sig) {
      const box = $('pips');
      const prev = lastSig.bat;
      let html = '';
      for (let k = 0; k < max; k++) {
        const on = k < e.battery;
        const cls = 'pip' + (on ? ' on' : '') + (on && e.battery <= 2 && e.mode === 'out' ? ' low' : '') + (prev != null && k >= e.battery && k < prev ? ' flash' : '');
        html += '<div class="' + cls + '"></div>';
      }
      box.innerHTML = html;
      lastSig.pips = sig;
      lastSig.bat = e.battery;
    }
    setText('bat-num', e.battery + '/' + max);
    setText('mode-text', e.mode === 'home' ? '基地で待機（充電済み）' : e.mode === 'returning' ? '帰還中…' : e.mode === 'shorted' ? '過放電！ 緊急回収中…' : '出撃中 #' + s.stats.sorties);
    $('btn-return').disabled = e.mode !== 'out';
    setText('temp-num', e.temp.length ? '仮設 ' + e.temp.length : '');
    const rb = $('btn-relay');
    setText('btn-relay', (UI.relayMode ? '配置中… ' : '中継塔 ') + '⚙' + G.relayCost(s).scrap);
    rb.classList.toggle('on', !!UI.relayMode);
    rb.title = (UI.relayMode ? 'クリックで配置／右クリック・Escでやめる' : '中継塔を置く場所を選ぶ（電気の届いているケーブルの上）') + ' [B]';
    const sc = Math.floor(s.res.scrap), cr = Math.floor(s.res.crystal);
    if (lastSig.sc != null && sc > lastSig.sc) UI.bump('r-scrap');
    if (lastSig.cr != null && cr > lastSig.cr) UI.bump('r-crystal');
    lastSig.sc = sc; lastSig.cr = cr;
    setText('r-scrap', sc);
    setText('r-crystal', cr);
    const rs = G.ratePerMin(s, 'scrap'), rc = G.ratePerMin(s, 'crystal');
    setText('r-scrap-rate', rs >= 1 ? '+' + Math.round(rs) + '/分' : '');
    setText('r-crystal-rate', rc >= 1 ? '+' + Math.round(rc) + '/分' : '');
    const sup = G.supply(s), dem = G.demand(s), cov = G.coverage(s);
    const pw = $('res-power');
    pw.classList.toggle('short', cov < 1 && !s.tripT);
    pw.classList.toggle('trip', s.tripT > 0);
    setText('r-power', dem + '/' + sup);
    setText('r-power-sub', s.tripT > 0 ? '停電 ' + Math.ceil(s.tripT) + '秒' : cov < 1 ? '作業 ' + Math.round(s.sat * 100) + '%' : '使用/発電');
    const parts = G.demandParts(s);
    const label = { scrap: 'スクラップ採掘', crystal: '結晶採掘', haul: '運搬', repair: '修理', relay: '中継塔', conveyor: 'コンベヤー' };
    pw.title = '電力 ⚡ 使用 ' + dem + ' / 発電 ' + sup + (cov < 1 ? '（不足：作業速度 ' + Math.round(s.sat * 100) + '%）' : '') + '\n' +
      Object.keys(parts).filter((k) => parts[k]).map((k) => '・' + label[k] + ' ' + parts[k]).join('\n') +
      '\n発電：' + s.facilities.filter((f) => G.supplyOf(s, f)).map((f) => f.name + ' ' + G.supplyOf(s, f)).join('、');
    const r = Math.floor(s.restoration);
    setText('dawn-num', r + '%');
    $('dawn-fill').style.left = r + '%';
    $('dawn-sun').style.left = r + '%';
    setText('clock', U.fmtTime(s.time));
    setText('sorties', s.stats.sorties);
  }

  // ---------------------------------------------------------------- objective & hints

  function hints(s) {
    const G = MD.G, out = [];
    for (const f of s.facilities) {
      if (f.state === 'dormant' && f.connected && G.canRestore(s, f).ok) out.push({ t: f.name + 'を復旧できる（クリック）', fac: f.id });
    }
    // cable laid up to something, but the power runs out before it gets there
    for (const f of s.facilities) {
      if (f.connected || f.kind === 'dock' || !f.seen) continue;
      if (G.spotsAround(s, f.tiles).length) continue;
      if (f.tiles.some((t) => G.neighborsOf(s, t).some((n) => s.cable[n] === 1 && !s.powered[n]))) {
        out.push({ t: f.name + 'まで電気が届かない → 中継塔［B］か近道を', warn: true, fac: f.id });
        break;
      }
    }
    if (s.ex.temp.length >= 4 && s.ex.mode === 'out' && s.ex.battery <= MD.BAL.hazardDrain) {
      out.push({ t: '仮設ケーブル ' + s.ex.temp.length + 'マス：帰還（R）で確定できる', warn: true });
    }
    const idle = s.robots.filter((r) => r.role === 'idle').length;
    if (idle) out.push({ t: '待機中のロボット ' + idle + '体 → ＋で役割を与えよう', warn: true });
    // missing key roles: the economy silently stalls without them
    const working = s.robots.filter((r) => r.role !== 'parade').length;
    if (working >= 2) {
      if (!G.roleCount(s, 'scrap') && s.deposits.some((d) => d.kind === 'scrap' && d.connected) && s.res.scrap < 30) out.push({ t: 'スクラップを掘るロボがいない → −と＋で役割を変えよう', warn: true });
      if (!G.roleCount(s, 'haul') && s.deposits.some((d) => d.buffer > 0)) out.push({ t: '運搬ロボがいない → 掘った資源が基地に届かない', warn: true });
      if (!G.roleCount(s, 'crystal') && s.deposits.some((d) => d.kind === 'crystal' && d.connected) && s.res.crystal < 10) out.push({ t: '結晶を掘るロボがいない（変電所や強化に結晶が必要）', warn: true });
    }
    for (const u of MD.UPGRADES) if (G.upgradeState(s, u) === 'available') { out.push({ t: '強化「' + u.name + '」を買える' }); break; }
    const buf = s.deposits.reduce((a, d) => a + (d.connected && !MD.Robots.conveyorFeeds(s, d) ? d.buffer : 0), 0);
    const haul = G.roleCount(s, 'haul');
    if (buf >= 10 && haul <= G.roleCount(s, 'scrap') + G.roleCount(s, 'crystal')) out.push({ t: '資源が ' + buf + ' 滞留中 → 運搬ロボを増やそう', warn: true });
    const fullMiners = s.robots.filter((r) => (r.role === 'scrap' || r.role === 'crystal') && r.reason === 'slotsFull').length;
    if (fullMiners) out.push({ t: '掘る場所が足りない → 新しい鉱床をつなごう', warn: true });
    const noDep = s.robots.filter((r) => r.role === 'crystal' && r.reason === 'noDeposit').length;
    if (noDep) out.push({ t: '結晶鉱脈がつながっていない', warn: true });
    const restoring = s.facilities.filter((f) => f.state === 'restoring');
    if (restoring.length && !G.roleCount(s, 'repair')) out.push({ t: '復旧作業には修理ロボが必要', warn: true });
    if (Object.keys(s.breaks).some((k) => MD.G.neighborsOf(s, +k).some((n) => s.powered[n])) && !G.roleCount(s, 'repair') && G.factory(s).state === 'active') {
      out.push({ t: '断線を見つけた → 修理ロボで直せる' });
    }
    const cov = G.coverage(s);
    if (s.tripT > 0) out.push({ t: '停電中！ 送電網の復帰まで ' + Math.ceil(s.tripT) + '秒', warn: true });
    else if (cov < 1) out.push({ t: '電力不足：作業速度 ' + Math.round(s.sat * 100) + '% → 発電所を復旧するか、ロボを待機（−）に', warn: true });
    else if (G.factory(s).state === 'active' && G.supply(s) - G.demand(s) >= 2 && s.res.scrap >= MD.BAL.robotCost.scrap) out.push({ t: '発電に余裕あり（⚡' + (G.supply(s) - G.demand(s)) + '）→ ロボを増やせる' });
    if (s.ex.mode === 'out' && !s.ex.moving && s.ex.battery > 0 && s.ex.battery < 2) out.push({ t: 'Rで帰還すれば満充電で出直せる' });
    return out.slice(0, 4);
  }

  function updateObjective(s) {
    const o = MD.G.objective(s);
    if (lastSig.obj !== o.id) {
      if (lastSig.obj) UI.pulseObjective();
      lastSig.obj = o.id;
    }
    setText('obj-title', o.title);
    setText('obj-text', o.text);
    const hs = hints(s);
    const sig = hs.map((h) => h.t).join('|');
    if (lastSig.hints !== sig) {
      $('obj-hints').innerHTML = hs.map((h) => '<li' + (h.warn ? ' class="warn"' : '') + (h.fac != null ? ' data-fac="' + h.fac + '" style="cursor:pointer"' : '') + '>' + h.t + '</li>').join('');
      lastSig.hints = sig;
    }
  }

  // ---------------------------------------------------------------- robots panel

  function roleStatus(s, role) {
    const G = MD.G;
    const n = G.roleCount(s, role);
    if (role === 'scrap' || role === 'crystal') {
      const deps = s.deposits.filter((d) => d.kind === role && d.connected);
      if (!deps.length) return { t: role === 'scrap' ? 'つながったスクラップ山がない' : 'つながった結晶鉱脈がない', c: n ? 'bad' : '' };
      const slots = deps.reduce((a, d) => a + d.slots, 0);
      const full = deps.filter((d) => d.buffer >= d.cap).length;
      return { t: '掘れる場所 ' + Math.min(n, slots) + '/' + slots + (full ? ' ・ 満杯' + full + 'か所' : ''), c: n > slots ? 'warn' : full ? 'warn' : '' };
    }
    if (role === 'haul') {
      const buf = s.deposits.reduce((a, d) => a + (d.connected && !MD.Robots.conveyorFeeds(s, d) ? d.buffer : 0), 0);
      const carrying = s.robots.filter((r) => r.role === 'haul' && r.carry > 0).length;
      return { t: '滞留 ' + buf + ' ・ 運搬中 ' + carrying, c: buf >= 12 ? 'warn' : '' };
    }
    if (role === 'repair') {
      const fac = s.facilities.filter((f) => f.state === 'restoring').length;
      const br = Object.keys(s.breaks).filter((k) => MD.G.neighborsOf(s, +k).some((q) => s.powered[q])).length;
      const lamps = s.lamps.filter((L) => L.broken && s.powered[L.i]).length;
      const tot = fac + br + lamps;
      return { t: tot ? '仕事 ' + tot + '件（施設' + fac + '・断線' + br + '・街灯' + lamps + '）' : '修理する物がない', c: tot && !n ? 'warn' : '' };
    }
    return { t: '' };
  }

  function updateRobots(s) {
    const G = MD.G, F = G.factory(s);
    const fActive = F.state === 'active';
    const idle = s.robots.filter((r) => r.role === 'idle').length;
    const canBuild = fActive;
    const spare = G.supply(s) - G.demand(s);
    const afford = U.canAfford(s.res, MD.BAL.robotCost);
    const rows = MD.ROLE_ORDER.map((role) => {
      const R = MD.ROLES[role];
      const n = G.roleCount(s, role);
      const st = roleStatus(s, role);
      const plusOk = idle > 0 || (canBuild && afford);
      const draw = MD.BAL.upkeep[role];
      const over = spare < draw ? '（電力不足になる）' : '';
      const plusTitle = (idle > 0 ? '待機中のロボットを割り当てる' : !fActive ? '工場が停止中' : afford ? '新しく製造する（⚙' + MD.BAL.robotCost.scrap + '）' : 'スクラップが足りない') + ' 使用電力 +' + draw + over;
      return '<div class="rrow"><div class="ri" style="background:' + R.color + '">' + R.icon + '</div>' +
        '<div class="rn">' + R.name + '<small>⚡' + draw + '</small></div><div class="rc">' + n + '</div>' +
        '<button data-minus="' + role + '" title="待機に戻す" aria-label="' + R.name + 'を1体減らす"' + (n ? '' : ' disabled') + '>−</button>' +
        '<button class="plus' + (idle ? '' : ' build') + '" data-plus="' + role + '" title="' + plusTitle + '" aria-label="' + R.name + 'を1体増やす"' + (plusOk ? '' : ' disabled') + '>＋</button>' +
        '<div class="rs ' + (st.c || '') + '">' + st.t + '</div></div>';
    }).join('');
    const sig = rows + idle + s.buildQueue.length + ':' + (spare >= 2);
    if (lastSig.robots !== sig) { $('robot-rows').innerHTML = rows; lastSig.robots = sig; }
    setText('robot-cap', '⚡ 使用 ' + G.demand(s) + ' / 発電 ' + G.supply(s));
    let note;
    if (!fActive) note = 'ロボット工場を再起動すると製造できる。';
    else {
      note = '<b>＋</b>：待機ロボを割当／いなければ製造（⚙' + MD.BAL.robotCost.scrap + '）　<b>−</b>：待機に戻す';
      if (idle) note = '<b style="color:#ffcc66">待機中 ' + idle + '体</b> — ' + note;
      if (s.buildQueue.length) note = '<b>製造中 ' + s.buildQueue.length + '体</b> … ' + note;
      if (G.coverage(s) < 1) note = '<b style="color:#ff9a6a">電力不足：作業速度 ' + Math.round(s.sat * 100) + '%</b> — 発電所の復旧か、−で待機に<br>' + note;
      if (s.reserve) note += '<br>ケーブルの確定を待つ休眠ロボ：' + s.reserve + '体';
    }
    if (lastSig.note !== note) { $('robot-note').innerHTML = note; lastSig.note = note; }
    $('panel-robots').classList.toggle('locked', !fActive && !s.robots.length);
  }

  function costHtml(s, cost) {
    const parts = [];
    if (cost.scrap) parts.push('<span class="' + (s.res.scrap >= cost.scrap ? 'cost-ok' : 'cost-ng') + '">⚙' + cost.scrap + '</span>');
    if (cost.crystal) parts.push('<span class="' + (s.res.crystal >= cost.crystal ? 'cost-ok' : 'cost-ng') + '">◆' + cost.crystal + '</span>');
    return parts.join(' ');
  }

  function updateUpgrades(s) {
    const G = MD.G;
    const html = MD.UPGRADES.map((u) => {
      const st = G.upgradeState(s, u);
      if (st === 'locked') return '';
      if (st === 'owned') return '<div class="urow owned"><div class="un">✔ ' + u.name + '</div></div>';
      return '<div class="urow"><div class="un">' + u.name + '</div><button data-up="' + u.id + '" aria-label="' + u.name + 'を購入（' + U.costText(u.cost) + '）" title="' + u.name + 'を購入" class="' + (st === 'available' ? 'can' : '') + '"' + (st === 'available' ? '' : ' disabled') + '>' + costHtml(s, u.cost) + '</button><div class="ud">' + u.desc + '</div></div>';
    }).join('');
    if (lastSig.up !== html) { $('upgrade-rows').innerHTML = html; lastSig.up = html; }
  }

  // ---------------------------------------------------------------- selection card

  const STATE_BADGE = {
    dormant: ['off', '停止中'], restoring: ['work', '復旧作業中'], active: ['on', '稼働中'], ready: ['work', '点火待ち'], ignited: ['on', '稼働中'],
  };
  const ROLE_DOING = {
    move: '移動中', mine: '採掘中', full: '置き場が満杯で待機', load: '積み込み中', unload: '荷下ろし中', repair: '修理中', wait: '仕事待ち', sleep: '待機中', idle: '待機中',
  };
  const REASON = {
    noDeposit: 'つながった鉱床がない', slotsFull: '掘る場所が埋まっている', noCargo: '運ぶ物がない', noRepair: '修理する物がない', noDropoff: '荷下ろし先がない',
  };

  function facCard(s, f) {
    const G = MD.G, def = G.def(f);
    const [bc, bt] = STATE_BADGE[f.state] || ['off', ''];
    let h = '<h4>' + f.name + ' <span class="badge ' + bc + '">' + bt + '</span></h4>';
    h += '<div class="desc">' + def.desc + '</div><div class="eff">効果：' + def.effect + '</div>';
    if (def.power) h += '<div class="row"><span>発電</span><span>⚡' + (def.power + G.genBonus(s)) + (f.state === 'active' ? '' : '（復旧後）') + '</span></div>';
    if (f.kind === 'conveyor') h += '<div class="row"><span>使用電力</span><span>⚡' + MD.BAL.conveyorUpkeep + '（稼働中）</span></div>';
    if (f.kind === 'dock') return h;
    if (f.state === 'dormant') {
      if (def.requires) {
        h += '<div class="req">条件：' + def.requires.map((ch) => {
          const x = G.facByCh(s, ch);
          return '<span class="' + (x.state === 'active' ? 'ok' : 'ng') + '">' + (x.state === 'active' ? '✔' : '✖') + x.name + '</span>';
        }).join(' ') + '</div>';
      }
      h += '<div class="row"><span>必要資源</span><span>' + costHtml(s, def.cost) + '</span></div>';
      if (def.work) h += '<div class="row"><span>復旧作業</span><span>修理ロボ ' + def.work + '秒ぶん</span></div>';
      const chk = G.canRestore(s, f);
      if (!f.connected) {
        h += '<div class="why">送電網につながっていない — ケーブルを隣に伸ばそう</div>';
        h += '<button class="act" style="border-color:#8ff8ff;color:#8ff8ff" data-goto="f' + f.id + '">ホタルで向かう（届くところまで）</button>';
      } else if (!chk.ok) h += '<div class="why">' + chk.why + '</div>';
      h += '<button class="act" data-restore="' + f.id + '"' + (chk.ok ? '' : ' disabled') + '>' + (f.kind === 'factory' ? '再起動する' : '復旧を始める') + '</button>';
    } else if (f.state === 'restoring') {
      const workers = s.robots.filter((r) => r.task && r.task.type === 'repair' && r.task.tk === 'fac' && r.task.tid === f.id && !r.path.length).length;
      h += '<div class="bar"><i style="width:' + Math.round(f.work / f.need * 100) + '%"></i></div>';
      h += '<div class="row"><span>作業中の修理ロボ</span><span>' + workers + '体</span></div>';
      if (!G.roleCount(s, 'repair')) h += '<div class="why">修理ロボがいない — 右のパネルで＋</div>';
    } else if (f.state === 'ready') {
      h += '<div class="why" style="color:#7dff9a">ホタルを炉の隣まで動かすと点火する</div>';
    } else if (f.kind === 'factory') {
      h += '<div class="row"><span>製造コスト</span><span>' + costHtml(s, MD.BAL.robotCost) + '</span></div>';
      h += '<div class="row"><span>製造中</span><span>' + s.buildQueue.length + '体</span></div>';
    } else if (f.kind === 'conveyor') {
      const sink = s.facilities[s.conveyor.sink];
      h += '<div class="row"><span>運搬先</span><span>' + sink.name + (sink.state === 'active' ? '' : '（停止中）') + '</span></div>';
      h += '<div class="row"><span>ベルト上</span><span>' + s.conveyor.items.length + '個</span></div>';
    }
    return h;
  }

  function depCard(s, d) {
    const nm = d.kind === 'scrap' ? 'スクラップ山' : '結晶鉱脈';
    let h = '<h4>' + nm + ' <span class="badge ' + (d.connected ? 'on' : 'off') + '">' + (d.connected ? '接続済み' : '未接続') + '</span></h4>';
    h += '<div class="desc">' + (d.kind === 'scrap' ? '古い機械の残骸。掘っても尽きない。' : '青く光るエネルギー結晶。高度な強化と大型施設に必要。') + '</div>';
    if (!d.connected) {
      h += '<div class="why">ケーブルを隣に伸ばすと採掘ロボが来られる</div>';
      h += '<button class="act" style="border-color:#8ff8ff;color:#8ff8ff" data-goto="d' + d.id + '">ホタルで向かう（届くところまで）</button>';
    }
    const miners = s.robots.filter((r) => r.task && r.task.type === 'mine' && r.task.dep === d.id).length;
    h += '<div class="row"><span>採掘ロボ</span><span>' + miners + '/' + d.slots + '</span></div>';
    h += '<div class="row"><span>置き場の在庫</span><span>' + d.buffer + '/' + d.cap + '</span></div>';
    h += '<div class="bar"><i style="width:' + Math.round(d.buffer / d.cap * 100) + '%"></i></div>';
    if (MD.Robots.conveyorFeeds(s, d)) h += '<div class="eff">コンベヤーが自動で倉庫へ運んでいる</div>';
    else if (d.buffer >= d.cap) h += '<div class="why">置き場が満杯 — 運搬ロボを増やそう</div>';
    return h;
  }

  function robotCard(s, r) {
    const R = MD.ROLES[r.role] || MD.ROLES.idle;
    let h = '<h4><span class="badge on" style="color:' + R.color + '">' + R.icon + '</span> ロボ #' + r.id + ' — ' + R.name + '</h4>';
    let doing = ROLE_DOING[r.state] || '';
    if ((r.state === 'wait' || r.state === 'sleep') && r.reason) doing = REASON[r.reason] || doing;
    h += '<div class="desc">' + doing + (r.carry ? '（' + (r.carryKind === 'scrap' ? '⚙' : '◆') + r.carry + ' 運搬中）' : '') + '</div>';
    if (r.role !== 'parade') {
      h += '<div class="roles">' + ['scrap', 'crystal', 'haul', 'repair', 'idle'].map((k) =>
        '<button data-setrole="' + k + '" data-rid="' + r.id + '" class="' + (r.role === k ? 'cur' : '') + '" title="' + MD.ROLES[k].name + '">' + MD.ROLES[k].icon + MD.ROLES[k].short + '</button>').join('') + '</div>';
    }
    return h;
  }

  function updateCard(s, sel) {
    const card = $('card');
    if (!sel) { card.classList.add('hidden'); lastSig.card = null; return; }
    let h = '';
    if (sel.fac != null) h = facCard(s, s.facilities[sel.fac]);
    else if (sel.dep != null) h = depCard(s, s.deposits[sel.dep]);
    else if (sel.robot != null) {
      const r = s.robots.find((o) => o.id === sel.robot);
      if (!r) { card.classList.add('hidden'); return; }
      h = robotCard(s, r);
    }
    h = '<button class="close" data-close="1" title="閉じる [Esc]">✕</button>' + h;
    if (lastSig.card !== h) { card.innerHTML = h; lastSig.card = h; }
    card.classList.remove('hidden');
    const obj = $('objective');
    if (window.innerWidth > 900) card.style.top = (obj.offsetTop + obj.offsetHeight + 8) + 'px';
  }

  // ---------------------------------------------------------------- minimap

  function updateMinimap(s, cam) {
    if (mm.width !== s.W * MM) { mm.width = s.W * MM; mm.height = s.H * MM; mm.style.width = s.W * MM + 'px'; mm.style.height = s.H * MM + 'px'; }
    const c = mmx, G = MD.G;
    c.fillStyle = '#030409';
    c.fillRect(0, 0, mm.width, mm.height);
    for (let i = 0; i < s.tile.length; i++) {
      if (!s.revealed[i]) continue;
      const x = i % s.W, y = (i / s.W) | 0, t = s.tile[i];
      let col = '#1d2133';
      if (t === G.T.BUILDING) col = '#0f111c';
      else if (t === G.T.CANAL) col = '#0f3d45';
      else if (t === G.T.RUBBLE) col = '#3a3434';
      if (s.powered[i]) col = s.cable[i] ? '#ffb347' : '#c9a24a';
      else if (s.old[i] === 1 && (!s.buried[i] || s.upgrades.scanner)) col = '#3a332f';
      else if (s.old[i] === 2) col = '#ff5a4c';
      c.fillStyle = col;
      c.fillRect(x * MM, y * MM, MM, MM);
    }
    for (const d of s.deposits) {
      if (!d.known) continue;
      c.fillStyle = d.kind === 'crystal' ? '#59dcff' : '#b8a68e';
      c.fillRect(d.x * MM, d.y * MM, MM, MM);
    }
    const now = performance.now() / 1000;
    for (const f of s.facilities) {
      if (!f.known) continue;
      const seen = f.tiles.some((t) => s.revealed[t]);
      if (!seen) {
        if (Math.sin(now * 4 + f.id) > 0) { c.fillStyle = f.kind === 'factory' ? '#ff4a3c' : '#ffcf6b'; c.fillRect((f.x + f.w / 2) * MM - 2, (f.y + f.h / 2) * MM - 2, 4, 4); }
        continue;
      }
      c.fillStyle = f.state === 'active' || f.state === 'ignited' ? '#7dff9a' : f.state === 'restoring' || f.state === 'ready' ? '#ffe08a' : f.kind === 'reactor' ? '#5b4a8a' : '#4a4f66';
      for (const t of f.tiles) c.fillRect((t % s.W) * MM, ((t / s.W) | 0) * MM, MM, MM);
    }
    for (const r of s.robots) {
      c.fillStyle = (MD.ROLES[r.role] || MD.ROLES.idle).color;
      c.fillRect(Math.round(r.x * MM) + 1, Math.round(r.y * MM) + 1, 2, 2);
    }
    c.fillStyle = Math.sin(now * 8) > 0 ? '#ffffff' : '#8ff8ff';
    c.fillRect(Math.round(s.ex.fx * MM) - 1, Math.round(s.ex.fy * MM) - 1, MM + 2, MM + 2);
    // camera rectangle
    const TS = MD.Render.TS, z = cam.zoom;
    const w = window.innerWidth / z / TS * MM, h = window.innerHeight / z / TS * MM;
    c.strokeStyle = 'rgba(143,248,255,0.7)';
    c.lineWidth = 1;
    c.strokeRect(Math.round(cam.x / TS * MM - w / 2) + 0.5, Math.round(cam.y / TS * MM - h / 2) + 0.5, Math.round(w), Math.round(h));
  }

  // ---------------------------------------------------------------- per-frame

  let acc = 0;
  UI.update = function (s, view, dt) {
    acc += dt;
    updateHud(s);
    if (acc < 0.12) return;
    acc = 0;
    updateObjective(s);
    updateRobots(s);
    updateUpgrades(s);
    updateCard(s, view.selection);
    updateMinimap(s, MD.Render.cam);
  };

  UI.forceRefresh = function () { lastSig = {}; acc = 1; };

  UI.setSpeedLabel = (v) => { $('btn-speed').textContent = '×' + v; };
  UI.setSoundLabel = (on) => { $('btn-sound').textContent = on ? '♪' : '×'; $('btn-sound').style.opacity = on ? 1 : 0.6; };
})(typeof window !== 'undefined' ? window : globalThis);

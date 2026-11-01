/* MECHANICAL DAWN — robots.js : NPC robots that live on the power grid (no DOM) */
(function (root) {
  'use strict';
  const MD = root.MD;
  const BAL = MD.BAL;
  const RB = MD.Robots = {};
  const G = () => MD.G;

  RB.spawn = function (s, i, role) {
    const r = {
      id: s.nextRobotId++, role, i, x: i % s.W, y: (i / s.W) | 0,
      path: [], task: null, carry: 0, carryKind: null, timer: 0, state: 'idle', reason: '',
      face: 1, born: s.time, delay: 0,
    };
    s.robots.push(r);
    return r;
  };

  // ------------------------------------------------------------------ navigation

  // Walkable for robots: powered grid tiles plus the dock itself, which joins every cable
  // branch that leaves the base from a different side.
  let walkCache = { s: null, v: -1, a: null };
  function walkable(s) {
    if (walkCache.s === s && walkCache.v === s.gridVersion) return walkCache.a;
    const a = s.powered.slice();
    for (const t of G().dock(s).tiles) a[t] = 1;
    walkCache = { s, v: s.gridVersion, a };
    return a;
  }

  // BFS over the grid. Robots never leave it.
  RB.bfs = function (s, start) {
    const W = s.W, H = s.H, N = W * H, pw = walkable(s);
    const dist = new Int32Array(N).fill(-1), prev = new Int32Array(N).fill(-1);
    const q = new Int32Array(N);
    let h = 0, t = 0;
    dist[start] = 0;
    q[t++] = start;
    while (h < t) {
      const c = q[h++], cx = c % W, cy = (c / W) | 0, nd = dist[c] + 1;
      if (cx + 1 < W && pw[c + 1] && dist[c + 1] < 0) { dist[c + 1] = nd; prev[c + 1] = c; q[t++] = c + 1; }
      if (cx > 0 && pw[c - 1] && dist[c - 1] < 0) { dist[c - 1] = nd; prev[c - 1] = c; q[t++] = c - 1; }
      if (cy + 1 < H && pw[c + W] && dist[c + W] < 0) { dist[c + W] = nd; prev[c + W] = c; q[t++] = c + W; }
      if (cy > 0 && pw[c - W] && dist[c - W] < 0) { dist[c - W] = nd; prev[c - W] = c; q[t++] = c - W; }
    }
    return { dist, prev };
  };

  function pathTo(prev, start, target) {
    const p = [];
    for (let c = target; c !== start; c = prev[c]) {
      if (c < 0) return null;
      p.push(c);
    }
    p.reverse();
    return p;
  }

  let spotCache = { s: null, v: -1, m: new Map() };
  RB.spots = function (s, key, tiles) {
    if (spotCache.s !== s || spotCache.v !== s.gridVersion) spotCache = { s, v: s.gridVersion, m: new Map() };
    let v = spotCache.m.get(key);
    if (!v) { v = G().spotsAround(s, tiles); spotCache.m.set(key, v); }
    return v;
  };

  function nearestSpot(dist, spots) {
    let best = -1, bd = Infinity;
    for (const i of spots) {
      const d = dist[i];
      if (d >= 0 && d < bd) { bd = d; best = i; }
    }
    return best < 0 ? null : { i: best, d: bd };
  }

  function nearestDropoff(s, dist) {
    let best = null;
    for (const f of s.facilities) {
      if (f.state !== 'active' || !G().def(f).dropoff) continue;
      const sp = nearestSpot(dist, RB.spots(s, 'f' + f.id, f.tiles));
      if (sp && (!best || sp.d < best.d)) best = { i: sp.i, d: sp.d, fac: f.id };
    }
    return best;
  }

  RB.conveyorFeeds = function (s, d) {
    const c = s.conveyor;
    if (!c || c.src !== d.id) return false;
    const f = s.facilities[c.fac], sink = s.facilities[c.sink];
    return f.state === 'active' && sink && sink.state === 'active';
  };

  // ------------------------------------------------------------------ task choice

  function workersOn(s, r, pred) {
    let n = 0;
    for (const o of s.robots) if (o !== r && o.task && pred(o.task)) n++;
    return n;
  }

  function chooseMine(s, r, dist) {
    let best = null;
    for (const d of s.deposits) {
      if (d.kind !== r.role || !d.connected) continue;
      if (workersOn(s, r, (t) => t.type === 'mine' && t.dep === d.id) >= d.slots) continue;
      const sp = nearestSpot(dist, RB.spots(s, 'd' + d.id, [d.i]));
      if (sp && (!best || sp.d < best.d)) best = { d, sp };
    }
    if (!best) {
      const any = s.deposits.some((d) => d.kind === r.role && d.connected);
      r.reason = any ? 'slotsFull' : 'noDeposit';
      return null;
    }
    r.reason = '';
    return { type: 'mine', dep: best.d.id, spot: best.sp.i };
  }

  function chooseHaul(s, r, dist) {
    let best = null;
    for (const d of s.deposits) {
      if (!d.connected) continue;
      const avail = d.buffer - d.reserved;
      if (avail <= 0 || RB.conveyorFeeds(s, d)) continue;
      const sp = nearestSpot(dist, RB.spots(s, 'd' + d.id, [d.i]));
      if (!sp) continue;
      const amount = Math.min(avail, BAL.haulCap);
      // Aging keeps far deposits from starving next to a busy nearby one; a full stockpile
      // (a miner standing idle) is urgent.
      const waiting = d.waitSince != null ? s.time - d.waitSince : 0;
      const score = (amount + (d.buffer >= d.cap ? 6 : 0)) * (1 + waiting / 12) / (sp.d + 6);
      if (!best || score > best.score) best = { d, sp, amount, score };
    }
    if (!best) { r.reason = 'noCargo'; return null; }
    if (!nearestDropoff(s, dist)) { r.reason = 'noDropoff'; return null; }
    best.d.reserved += best.amount;
    r.reason = '';
    return { type: 'haul', stage: 'pickup', dep: best.d.id, spot: best.sp.i, amount: best.amount };
  }

  function repairTargets(s) {
    const out = [];
    for (const f of s.facilities) {
      if (f.state === 'restoring') out.push({ tk: 'fac', tid: f.id, key: 'f' + f.id, tiles: f.tiles, w: 3, max: 99 });
    }
    for (const k in s.breaks) {
      const i = +k;
      out.push({ tk: 'break', tid: i, key: 'b' + i, tiles: [i], w: 2, max: 1 });
    }
    s.lamps.forEach((L, li) => {
      if (L.broken && s.powered[L.i]) out.push({ tk: 'lamp', tid: li, spot: L.i, w: 1, max: 1 });
    });
    return out;
  }

  function chooseRepair(s, r, dist) {
    let best = null;
    for (const t of repairTargets(s)) {
      if (t.max < 99 && workersOn(s, r, (o) => o.type === 'repair' && o.tk === t.tk && o.tid === t.tid) >= t.max) continue;
      const sp = t.spot != null ? (dist[t.spot] >= 0 ? { i: t.spot, d: dist[t.spot] } : null)
        : nearestSpot(dist, RB.spots(s, t.key, t.tiles));
      if (!sp) continue;
      const score = t.w / (sp.d + 4);
      if (!best || score > best.score) best = { t, sp, score };
    }
    if (!best) { r.reason = 'noRepair'; return null; }
    r.reason = '';
    return { type: 'repair', tk: best.t.tk, tid: best.t.tid, spot: best.sp.i };
  }

  function chooseWait(s, r, dist) {
    let spot = null;
    if (r.role === 'idle' || r.role === 'scrap' || r.role === 'crystal' || r.role === 'repair') {
      const home = G().homeSpot(s);
      if (home >= 0 && dist[home] >= 0) spot = home;
    }
    if (r.role === 'idle') r.reason = '';
    return { type: 'wait', spot, until: s.time + (r.role === 'idle' ? 3 : 1.2) };
  }

  function taskValid(s, r) {
    const t = r.task;
    switch (t.type) {
      case 'mine': return s.deposits[t.dep].kind === r.role;
      case 'haul': return r.role === 'haul';
      case 'repair':
        if (r.role !== 'repair') return false;
        if (t.tk === 'fac') return s.facilities[t.tid].state === 'restoring';
        if (t.tk === 'break') return !!s.breaks[t.tid];
        return s.lamps[t.tid].broken;
      case 'wait': return true;
    }
    return false;
  }

  function dropTask(s, r) {
    const t = r.task;
    if (t && t.type === 'haul' && t.stage === 'pickup' && t.amount > 0) {
      const d = s.deposits[t.dep];
      d.reserved = Math.max(0, d.reserved - t.amount);
      t.amount = 0;
    }
    if (r.carry > 0) {
      s.res[r.carryKind] += r.carry;
      G().noteDelivery(s, r.carryKind, r.carry);
      r.carry = 0;
      r.carryKind = null;
    }
    r.task = null;
    r.timer = 0;
  }

  function assign(s, r) {
    const { dist, prev } = RB.bfs(s, r.i);
    let t = null;
    if (r.role === 'scrap' || r.role === 'crystal') t = chooseMine(s, r, dist);
    else if (r.role === 'haul') t = chooseHaul(s, r, dist);
    else if (r.role === 'repair') t = chooseRepair(s, r, dist);
    if (!t) t = chooseWait(s, r, dist);
    r.task = t;
    r.timer = 0;
    r.path = t.spot != null ? (pathTo(prev, r.i, t.spot) || []) : [];
  }

  // ------------------------------------------------------------------ per-robot update

  function move(s, r, dt) {
    let budget = BAL.robotSpeed * dt;
    r.state = 'move';
    while (budget > 0 && r.path.length) {
      const n = r.path[0], nx = n % s.W, ny = (n / s.W) | 0;
      const dx = nx - r.x, dy = ny - r.y, d = Math.hypot(dx, dy);
      if (dx > 0.01) r.face = 1; else if (dx < -0.01) r.face = -1;
      if (d <= budget) {
        r.x = nx; r.y = ny; r.i = n;
        r.path.shift();
        budget -= d;
      } else {
        r.x += dx / d * budget;
        r.y += dy / d * budget;
        budget = 0;
      }
    }
  }

  function act(s, r, dt) {
    const t = r.task;
    if (!t) return;
    switch (t.type) {
      case 'mine': {
        const d = s.deposits[t.dep];
        if (d.buffer >= d.cap) { r.state = 'full'; r.timer = Math.min(r.timer, BAL.mineTime[d.kind]); return; }
        r.state = 'mine';
        const mt = BAL.mineTime[d.kind];
        r.timer += dt;
        if (r.timer >= mt) {
          r.timer -= mt;
          if (d.buffer === 0 || d.waitSince == null) d.waitSince = s.time;
          d.buffer++;
          d.mined++;
          s.events.push({ type: 'mined', dep: d.id, rid: r.id });
        }
        return;
      }
      case 'haul': {
        if (t.stage === 'stuck') {
          r.state = 'wait';
          r.timer += dt;
          if (r.timer > 1) {
            r.timer = 0;
            const { dist, prev } = RB.bfs(s, r.i);
            const drop = nearestDropoff(s, dist);
            if (drop) { t.stage = 'drop'; t.spot = drop.i; t.drop = drop.fac; r.path = pathTo(prev, r.i, drop.i) || []; }
          }
          return;
        }
        r.state = t.stage === 'pickup' ? 'load' : 'unload';
        r.timer += dt;
        if (r.timer < BAL.loadTime) return;
        r.timer = 0;
        if (t.stage === 'pickup') {
          const d = s.deposits[t.dep];
          d.reserved = Math.max(0, d.reserved - t.amount);
          const take = Math.min(t.amount, d.buffer);
          t.amount = 0;
          if (take <= 0) { r.task = null; return; }
          d.buffer -= take;
          d.waitSince = d.buffer > 0 ? s.time : null;
          r.carry = take;
          r.carryKind = d.kind;
          s.events.push({ type: 'load', rid: r.id, dep: d.id, amount: take });
          const { dist, prev } = RB.bfs(s, r.i);
          const drop = nearestDropoff(s, dist);
          if (!drop) { t.stage = 'stuck'; return; }
          t.stage = 'drop';
          t.spot = drop.i;
          t.drop = drop.fac;
          r.path = pathTo(prev, r.i, drop.i) || [];
        } else {
          s.res[r.carryKind] += r.carry;
          G().noteDelivery(s, r.carryKind, r.carry);
          s.events.push({ type: 'deliver', rid: r.id, kind: r.carryKind, amount: r.carry, x: r.x, y: r.y, fac: t.drop });
          r.carry = 0;
          r.carryKind = null;
          r.task = null;
        }
        return;
      }
      case 'repair': {
        r.state = 'repair';
        const amt = BAL.repairRate * dt;
        if (t.tk === 'fac') G().addWork(s, s.facilities[t.tid], amt);
        else if (t.tk === 'break') {
          const b = s.breaks[t.tid];
          if (b) { b.work += amt; if (b.work >= BAL.breakWork) G().repairBreak(s, t.tid); }
        } else {
          const L = s.lamps[t.tid];
          L.work += amt;
          if (L.work >= BAL.lampWork) G().repairLamp(s, t.tid);
        }
        r.timer += dt;
        if (r.timer > 0.4) { r.timer = 0; s.events.push({ type: 'weld', rid: r.id }); }
        return;
      }
      case 'wait': {
        r.state = r.role === 'idle' ? 'sleep' : 'wait';
        if (s.time >= t.until) r.task = null;
        return;
      }
    }
  }

  function tick(s, r, dt) {
    if (r.role === 'parade') { paradeTick(s, r, dt); return; }
    if (r.task && !taskValid(s, r)) { dropTask(s, r); r.path = r.path.slice(0, 1); }
    if (r.path.length) { move(s, r, dt); return; }
    if (!r.task) { assign(s, r); if (r.path.length) return; }
    act(s, r, dt);
  }

  RB.setRole = function (s, r, role) {
    if (r.role === role) return;
    dropTask(s, r);
    r.role = role;
    r.reason = '';
    r.path = r.path.slice(0, 1);
    s.events.push({ type: 'role', rid: r.id, role });
  };

  RB.busyScore = function (r) {
    if (!r.task || r.task.type === 'wait') return 0;
    if (r.carry > 0) return 6;
    if (r.task.type === 'repair') return r.path.length ? 2 : 4;
    if (r.task.type === 'mine') return r.path.length ? 1 : 3;
    return 2;
  };

  // ------------------------------------------------------------------ factory & conveyor

  function factoryTick(s, dt) {
    if (!s.buildQueue.length) return;
    const F = G().factory(s);
    if (!F || F.state !== 'active') return;
    const q = s.buildQueue[0];
    q.t += dt;
    if (q.t >= BAL.robotBuildTime) {
      s.buildQueue.shift();
      const spot = G().doorSpot(s, F);
      if (spot < 0) return;
      const r = RB.spawn(s, spot, q.role);
      s.stats.robotsBuilt++;
      s.events.push({ type: 'built', rid: r.id, role: q.role });
    }
  }

  function conveyorTick(s, dt) {
    const c = s.conveyor;
    if (!c) return;
    const f = s.facilities[c.fac];
    if (f.state !== 'active') return;
    const sink = s.facilities[c.sink];
    const sinkOk = sink && sink.state === 'active';
    const L = c.path.length;
    let limit = L - 0.05;
    for (const it of c.items) {
      it.p = Math.min(it.p + BAL.conveyorSpeed * dt, limit);
      limit = it.p - 0.6;
    }
    while (sinkOk && c.items.length && c.items[0].p >= L - 0.06) {
      const it = c.items.shift();
      s.res[it.kind] += 1;
      G().noteDelivery(s, it.kind, 1);
      const end = c.path[L - 1];
      s.events.push({ type: 'deliver', kind: it.kind, amount: 1, x: end % s.W, y: (end / s.W) | 0, fac: c.sink, belt: true });
    }
    c.t += dt;
    const d = s.deposits[c.src];
    const last = c.items[c.items.length - 1];
    if (sinkOk && d && c.t >= BAL.conveyorInterval && d.buffer > d.reserved && (!last || last.p > 0.7)) {
      c.t = 0;
      d.buffer--;
      c.items.push({ p: 0, kind: d.kind });
    }
  }

  // ------------------------------------------------------------------ ending parade

  RB.spawnParade = function (s, n) {
    const tiles = [];
    for (let i = 0; i < s.powered.length; i++) if (s.powered[i]) tiles.push(i);
    if (!tiles.length) return;
    for (let k = 0; k < n; k++) {
      const i = tiles[Math.floor(G().rand(s) * tiles.length)];
      const r = RB.spawn(s, i, 'parade');
      r.delay = 0.6 + G().rand(s) * 3.5;
      r.timer = 0;
    }
  };

  function paradeTick(s, r, dt) {
    if (r.delay > 0) { r.delay -= dt; r.state = 'sleep'; return; }
    if (r.path.length) { move(s, r, dt); return; }
    r.state = 'wait';
    r.timer -= dt;
    if (r.timer > 0) return;
    const { dist, prev } = RB.bfs(s, r.i);
    const cands = [];
    for (let i = 0; i < dist.length; i++) if (dist[i] >= 3 && dist[i] <= 14) cands.push(i);
    if (cands.length) r.path = pathTo(prev, r.i, cands[Math.floor(G().rand(s) * cands.length)]) || [];
    r.timer = 0.3 + G().rand(s) * 1.5;
  }

  // sat: share of full speed the power supply allows (brownout slows everything, never stops it,
  // except while the breakers are tripped).
  RB.update = function (s, dt, sat) {
    const k = sat == null ? 1 : sat;
    for (const r of s.robots) tick(s, r, r.role === 'parade' ? dt : dt * k);
    factoryTick(s, dt * k);
    conveyorTick(s, dt * k);
  };
})(typeof window !== 'undefined' ? window : globalThis);

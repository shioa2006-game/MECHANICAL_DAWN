/* MECHANICAL DAWN — data.js : city map, definitions and balance (no DOM) */
(function (root) {
  'use strict';
  const MD = root.MD = root.MD || {};

  /*
   Map legend
     #  building            .  street             r  rubble (needs Drill)
     ~  coolant canal (needs Hover)
     =  old power line (dormant)   l  old line + street lamp   L  old line + broken lamp
     x  broken old line (sparks, impassable; repair bots fix it)
     u  buried old line (only visible with the Scanner)
     o  loose scrap   c  loose crystal   +  power cell (+1 max battery)
     ?  record log    z  dormant robot
     S  scrap heap    C  crystal vein    <  old conveyor (moves west)
     D  dock (base)   F  robot factory   R  radio tower   W  depot
     1 2 3  substations                  X  central reactor
     G H J K  small generators
  */
  MD.MAP = [
    '################################################',
    '#.c................?.~~........................#',
    '#.#####.HH###o######.~~.####=.....?....o=#####.#',
    '#o#####.HH###.##22##.~~o####l...........=33###.#',
    '#.##C##.#####.##22##.~~.###C=.~~~~~~~~~.=33###o#',
    '#....................~~.####=.~.XXXXX.~.l#####.#',
    '#.=l=====L=x===l===l.~~.####=.~cXXXXX.~.=#####.#',
    '#.##.##.##S##.######.~~.r+r.=.~.XXXXX.~.x......#',
    '#z##+##.#####.######o~~.####l.~.XXXXXc~.=##KK#.#',
    '#.#####o#####.######.~~.####=.~.XXXXX.~.=##KK#.#',
    '#....................~~.####=.~~~~~~~~~.LS####z#',
    '#~~~~~~~~~~~~~~~~~~~~~~.####l...........=#####.#',
    '#~~~~~~~~~~~~~~~~~~~~~~.####=.o.........=#####.#',
    '#.........o...o......rr==l===l===l=x=l===l===l=#',
    '#o####..########?RR##.#........................#',
    '#.####..########.RR##.#########r############r###',
    '#z####..########.####o#########r############r###',
    '#.####..####FFF#.####.###.#...o......o........?#',
    '#.###S..####FFF#o####.##C.#.#####.WW##########.#',
    '#.####..####FFF#.####.##c.#.#####.WW<<<<<<<<<C.#',
    '#........o.....o..........r....................#',
    '#..........o...=l=L=x==l=lr....................#',
    '#o#GG#o.########.####.###.#.#####.#####o##JJ##o#',
    '#.#GG#?.########.####.###.#.#####.#####.##JJ##.#',
    '#...........o.......o....or==l===l=x=L===l===l=#',
    '#.#DDD.o########.S###.###.#.S####.#####.#11###.#',
    '#.#DDD..########.####.###.#.#####.#####.#11###.#',
    '#.#DDD..########o####o###c#o#####.##C##.######.#',
    '#.o......uuuuuuuuuuuuuuuu.r...o............o...#',
    '#######################r###.#####.#####.~~~~~~c#',
    '#######################+###z#####c#####.~~+~~~.#',
    '################################################',
  ];

  MD.BAL = {
    startBattery: 10,
    stepTimeNew: 0.14,      // seconds per step onto new ground
    stepTimeCable: 0.05,    // seconds per step along the grid
    stepTimeRubble: 0.45,
    stepTimeCanal: 0.17,
    returnMin: 0.45, returnMax: 1.5, returnPerTile: 0.035,
    autoReturnDelay: 0.75,
    revealRadius: 2.9,
    scannerRadius: 4.6,
    detectRadius: 9,        // scanner: things in the fog within this radius glint
    signalRadius: 11,       // facilities emit a beacon once the explorer is this close
    scrapPile: 3,
    crystalPile: 2,
    rubbleScrap: 1,
    dockTrickle: 10,        // seconds per free scrap from the dock recycler (anti soft-lock)
    robotCost: { scrap: 6 },
    robotBuildTime: 2.2,
    robotSpeed: 5.0,        // tiles per second
    mineTime: { scrap: 1.4, crystal: 4.2 }, // seconds per unit
    haulCap: 5,
    loadTime: 0.35,
    repairRate: 1.0,        // work per second
    depositCap: 12,
    depositSlots: 2,
    breakWork: 5,
    lampWork: 2.5,
    conveyorInterval: 1.1,
    conveyorSpeed: 1.7,
    cellBonus: 1,
    relayReach: 12,
    upkeep: { scrap: 1, crystal: 1, haul: 1, repair: 2, idle: 0 }, // power each robot role draws
    relayUpkeep: 1,
    conveyorUpkeep: 2,
    tripTime: 10,           // seconds the whole grid stays dark after an overdraw on a live floor         // tiles of new cable a relay tower pushes power through (see FAC reach)
    relayCost: 8, relayStep: 4, // scrap for the first relay tower, + per tower already built
    hazardRate: 0.18,       // chance for an eligible street tile to be a live floor
    hazardSafeRadius: 6,    // no live floors this close to the dock (Manhattan)
    hazardDrain: 3,         // extra battery a live floor takes
    shortDelay: 1.4,        // seconds of sparking before the emergency recall
  };

  // Facilities keyed by their map character.
  MD.FAC = {
    D: {
      kind: 'dock', name: '基地ドック', w: 3, h: 3, startActive: true, power: 3, reach: 16, dropoff: true,
      desc: '探索機ホタルの充電基地。資源の保管庫でもある。',
      effect: '帰還すると充電 / 資源の荷下ろし先 / 発電⚡3 / 送電16マス',
    },
    F: {
      kind: 'factory', name: 'ロボット工場', cost: { scrap: 10 }, work: 0, pts: 10,
      light: { sw: 0.45 }, beaconAtStart: true,
      desc: '止まったままの製造ライン。救難信号を出し続けている。',
      effect: 'ロボットの製造が可能に / 休眠ロボ1体が目覚める',
    },
    R: {
      kind: 'radar', name: '電波塔', cost: { scrap: 12 }, work: 6, pts: 6, reveal: 14,
      light: { sw: 0.25 },
      desc: '街を見渡すための古いアンテナ塔。',
      effect: '周囲14マスの地図を表示 / 全施設の位置が判明',
    },
    W: {
      kind: 'depot', name: '集積倉庫', cost: { scrap: 15 }, work: 8, pts: 6, dropoff: true,
      light: { ind: 0.25 },
      desc: '工業区の資源を集めていた倉庫。',
      effect: '運搬ロボの荷下ろし先になる（運搬距離が短縮）',
    },
    '1': {
      kind: 'substation', name: '第1変電所', cost: { scrap: 20, crystal: 10 }, work: 12, power: 6, battery: 2, reach: 14, pts: 12,
      light: { ind: 0.65 }, music: 1,
      desc: '工業区へ電力を配っていた変電所。',
      effect: '発電⚡+6 / 出撃バッテリー+2 / 送電14マスの電源 / 工業区が点灯',
    },
    '2': {
      kind: 'substation', name: '第2変電所', cost: { scrap: 20, crystal: 10 }, work: 12, power: 6, battery: 2, reach: 14, pts: 12,
      light: { nw: 0.85 }, music: 1,
      desc: '運河の向こう、北西区の変電所。',
      effect: '発電⚡+6 / 出撃バッテリー+2 / 送電14マスの電源 / 北西区が点灯',
    },
    '3': {
      kind: 'substation', name: '第3変電所', cost: { scrap: 20, crystal: 10 }, work: 12, power: 6, battery: 2, reach: 14, pts: 12,
      light: { core: 0.5 }, music: 1,
      desc: '中枢区の変電所。中央動力炉への送電を担う。',
      effect: '発電⚡+6 / 出撃バッテリー+2 / 送電14マスの電源 / 中枢区が点灯',
    },
    G: {
      kind: 'generator', name: '西の発電機', cost: { scrap: 12 }, work: 0, power: 3, pts: 5,
      light: { sw: 0.2 },
      desc: '住宅街の非常用発電機。小さいが、基地のすぐ近くにある。',
      effect: '発電⚡+3',
    },
    H: {
      kind: 'generator', name: '北西の発電機', cost: { scrap: 12 }, work: 0, power: 3, pts: 5,
      light: { nw: 0.2 },
      desc: '運河の向こう、北西区の発電機。',
      effect: '発電⚡+3',
    },
    J: {
      kind: 'generator', name: '東の発電機', cost: { scrap: 12 }, work: 0, power: 3, pts: 5,
      light: { ind: 0.2 },
      desc: '工業区の自家発電機。周りの道は漏電がひどい。',
      effect: '発電⚡+3',
    },
    K: {
      kind: 'generator', name: '北東の発電機', cost: { scrap: 12 }, work: 0, power: 3, pts: 5,
      light: { core: 0.15 },
      desc: '中枢区の外れに残る発電機。',
      effect: '発電⚡+3',
    },
    X: {
      kind: 'reactor', name: '中央動力炉', cost: { scrap: 30, crystal: 50 }, work: 20, pts: 20,
      requires: ['1', '2', '3'], light: { core: 0.5 },
      desc: '都市のすべてを動かしていた心臓。冷却水路に囲まれている。',
      effect: '再起動すると、都市に夜明けが訪れる',
    },
  };

  MD.CONVEYOR_DEF = {
    kind: 'conveyor', name: 'コンベヤー', cost: { scrap: 10, crystal: 3 }, work: 8, pts: 6,
    light: { ind: 0.1 },
    desc: '結晶鉱脈から倉庫へ続く古いベルトコンベヤー。',
    effect: '鉱脈の結晶を倉庫へ自動で運ぶ（倉庫の復旧が必要）',
  };

  MD.UPGRADES = [
    { id: 'gen1', name: '発電効率 I', icon: 'gen', cost: { crystal: 12 }, genBonus: 1, city: true,
      desc: '稼働中の発電所すべて（基地・発電機・変電所）の発電 +1⚡' },
    { id: 'gen2', name: '発電効率 II', icon: 'gen', cost: { scrap: 10, crystal: 40 }, genBonus: 1, requires: 'gen1', city: true,
      desc: '稼働中の発電所すべての発電 さらに +1⚡' },
    { id: 'bat1', name: 'バッテリー増設 I', icon: 'bat', cost: { scrap: 8 }, battery: 3,
      desc: '1回の出撃で進める距離 +3' },
    { id: 'scanner', name: '広域スキャナ', icon: 'scan', cost: { scrap: 12 },
      desc: '視界が広がる。地中に埋まった古い送電線と、霧の中の資源が見えるようになる' },
    { id: 'drill', name: 'ドリルアーム', icon: 'drill', cost: { scrap: 12 },
      desc: '瓦礫を砕いて進める（1マスにつきバッテリー2）。砕いた跡はケーブルが通る道になる' },
    { id: 'hover', name: 'ホバー脚', icon: 'hover', cost: { scrap: 18, crystal: 10 },
      desc: '冷却水路の上を進める。敷いたケーブルは橋になり、ロボットも渡れる' },
    { id: 'bat2', name: 'バッテリー増設 II', icon: 'bat', cost: { scrap: 22, crystal: 6 }, battery: 3, requires: 'bat1',
      desc: '1回の出撃で進める距離 +3' },
    { id: 'bat3', name: 'バッテリー増設 III', icon: 'bat', cost: { scrap: 30, crystal: 14 }, battery: 4, requires: 'bat2',
      desc: '1回の出撃で進める距離 +4' },
  ];

  MD.ROLES = {
    scrap: { name: 'スクラップ採掘', short: '採掘', icon: '⚙', color: '#ffb000',
      desc: '送電網につながったスクラップ山を掘る' },
    crystal: { name: '結晶採掘', short: '採掘', icon: '◆', color: '#59dcff',
      desc: '送電網につながった結晶鉱脈を掘る' },
    haul: { name: '運搬', short: '運搬', icon: '▣', color: '#63d97a',
      desc: '掘り出された資源を基地や倉庫へ運ぶ' },
    repair: { name: '修理', short: '修理', icon: '✚', color: '#5aa8ff',
      desc: '施設の復旧作業、断線や街灯の修理をする' },
    idle: { name: '待機', short: '待機', icon: '…', color: '#8b90a8', desc: '指示を待っている' },
  };
  MD.ROLE_ORDER = ['scrap', 'crystal', 'haul', 'repair'];

  MD.LOGS = [
    { x: 6, y: 23, title: '記録01', text: '中央動力炉、停止。都市の全機能が眠りについた。残った予備電力では、探索機一体を10歩ぶん動かすのがやっとだ。' },
    { x: 16, y: 14, title: '記録02', text: '電波塔の保守メモ ―「塔さえ動けば、運河の向こうまで見渡せる」' },
    { x: 19, y: 1, title: '記録03', text: '変電所の運転日誌 ―「三つの変電所がそろわなければ、中央炉は再点火できない」' },
    { x: 46, y: 17, title: '記録04', text: '工場長の書き置き ―「ロボットたちは眠らせておく。いつか誰かが起こしてくれると信じて」' },
    { x: 34, y: 2, title: '記録05', text: '最後の技師の手記 ―「小さな探索機に、ありったけの電力を込めた。たった10歩。それでも、歩いた道は残る。きっと夜は明ける」' },
  ];

  MD.INTRO = [
    '中央動力炉が止まり、機械都市は長い夜に沈んだ。',
    '最後の予備電力で、小さな探索機〈ホタル〉が目を覚ます。',
    'バッテリーは、たった10歩ぶん。',
    '――けれど、歩いた道は送電路として残る。',
  ];

  // District of a map position (used for window lights and music).
  MD.districtOf = function (x, y) {
    if (x <= 20 && y <= 10) return 'nw';
    if (y <= 16 && x >= 21) return 'core';
    if (x >= 26 && y >= 17) return 'ind';
    return 'sw';
  };
})(typeof window !== 'undefined' ? window : globalThis);

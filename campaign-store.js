// Sdílený datový store kampaní (localStorage) + pomocné výpočty.
// Model v3 (bitva podle pravidel kampaně):
//   campaign.startBA — výchozí body armády (rozpočet), z něhož se kupuje.
//   unit.initial     — počet ks výchozí armády pořízený na startu (plná cena).
//   battle.rows[slot] = {
//     fielded  — nasazeno do bitvy
//     lost     — ztraceno (jednotka úplně zničena → mizí z armády)
//     damaged  — poškozeno (částečně zničena nebo utekla → jde do depa)
//     recruit  — naverbováno (ztracená jednotka zpět za PLNOU cenu)
//     restore  — obnoveno (poškozená jednotka zpět za POLOVIČNÍ cenu)
//     vets/elite/heroes — změna počtu povýšených ks (může být i negativní,
//                         přenáší se mezi bitvami, nepočítá se do ztrát)
//   }
//   battle.vp / battle.ba — Victory Points a body armády za bitvu.
// „Zbývá" se vždy počítá automaticky:
//   zbývá = před bitvou − ztraceno − poškozeno + naverbováno + obnoveno (max m)
(function () {
  'use strict';

  const KEY = 'onusCampaigns.v1';
  const D = window.ONUS_DATA;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function halfPrice(v) { return Math.ceil((v || 0) / 2); }
  function clamp(v, min, max) {
    let x = v || 0;
    if (min !== null && x < min) x = min;
    if (max !== null && x > max) x = max;
    return x;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const state = JSON.parse(raw);
        if (state && Array.isArray(state.campaigns)) {
          state.campaigns.forEach(migrateCampaign);
          return state;
        }
      }
    } catch (e) { /* poškozená data — začni znovu */ }
    return { campaigns: [] };
  }

  // Migrace starších modelů na model v3.
  function migrateCampaign(c) {
    if (!c || !Array.isArray(c.battles)) return;
    c.battles.forEach((b) => {
      if (b.cond === undefined) b.cond = '';
      if (b.ba === undefined || b.ba === null) b.ba = 0;
      if (b.vp === undefined || b.vp === null) b.vp = 0;
      if (b.vpAuto === undefined) b.vpAuto = false;
      if (!b.rows) b.rows = {};
      // starý b.buy[slot] = dokoupené ks → naverbováno
      if (b.buy) {
        Object.keys(b.buy).forEach((slotId) => {
          const r = row(b, slotId);
          if (!r.recruit) r.recruit = b.buy[slotId] || 0;
        });
        delete b.buy;
      }
      Object.keys(b.rows).forEach((slotId) => {
        const r = b.rows[slotId];
        // starý ruční přepis „after" → dopočítej ztráty, pak zahoď
        if (r.after !== undefined) {
          if ((r.lost === null || r.lost === undefined) && typeof r.after === 'number') {
            r.lost = null;
          }
          delete r.after;
        }
        if (r.damaged === undefined) r.damaged = null;
        if (r.recruit === undefined) r.recruit = null;
        if (r.restore === undefined) r.restore = null;
        if (r.vets === undefined) r.vets = null;
        if (r.elite === undefined) r.elite = null;
        if (r.heroes === undefined) r.heroes = null;
        delete r.cond;
      });
      delete b.result;
    });
    // Starší kampaně rozpočet BA neměly — odvoď ho tak, aby vše, co už je
    // v logu zapsané (výchozí armáda i posily), bylo přesně zaplacené a
    // kampaň nezačínala v mínusu.
    if (c.startBA === undefined || c.startBA === null) {
      let cost = 0;
      (c.units || []).forEach((u) => {
        const info = unitInfo(u.f, u.n);
        const v = info ? info.v : 0;
        cost += (u.initial || 0) * v;
        (c.battles || []).forEach((b) => {
          const r = b.rows && b.rows[u.id];
          if (!r) return;
          cost += (r.recruit || 0) * v + (r.restore || 0) * halfPrice(v);
        });
      });
      c.startBA = cost;
    }
  }

  function save(state) { localStorage.setItem(KEY, JSON.stringify(state)); }

  let state = load();
  function persist() { save(state); }

  // --- katalogové pomocníky ---

  function unitInfo(f, n) {
    const u = D.units.find((u) => u.f === f && u.n === n);
    if (!u) return null;
    return { f: u.f, n: u.n, v: u.v, m: u.m, stats: D.stats[f + '|' + n] || null };
  }

  function scenario(c) { return D.campaigns.find((s) => s.id === c.scenarioId) || null; }

  function sideDef(c) {
    const s = scenario(c);
    if (!s) return null;
    return s.sides.find((sd) => sd.name === c.sideName) || null;
  }

  function campaignPool(scenarioId, sideName) {
    const sc = D.campaigns.find((s) => s.id === scenarioId);
    if (!sc) return [];
    const sd = sc.sides.find((s) => s.name === sideName);
    if (!sd) return [];
    const pool = [];
    sd.factions.forEach((f) => { D.units.forEach((u) => { if (u.f === f) pool.push(u); }); });
    return pool;
  }

  function sideKind(scenarioDef, sideName) {
    const sd = scenarioDef.sides.find((s) => s.name === sideName);
    if (!sd) return null;
    return sd.factions.indexOf('Rom.Empire') !== -1 ? 'rome' : 'enemy';
  }

  function recommendedFor(scenarioId, battleIndex, sideName) {
    const rec = D.recommended[scenarioId];
    const sc = D.campaigns.find((s) => s.id === scenarioId);
    if (!rec || !sc || !rec[battleIndex]) return null;
    const kind = sideKind(sc, sideName);
    return kind ? rec[battleIndex][kind] : null;
  }

  // --- CRUD kampaní ---

  function list() { return state.campaigns; }
  function get(id) { return state.campaigns.find((c) => c.id === id) || null; }

  function create(opts) {
    const c = {
      id: uid(),
      name: opts.name || '',
      scenarioId: opts.scenarioId,
      sideName: opts.sideName,
      startBA: Math.max(0, opts.startBA || 0),
      createdAt: new Date().toISOString(),
      units: [],
      battles: [],
    };
    state.campaigns.push(c);
    persist();
    return c;
  }

  function remove(id) { state.campaigns = state.campaigns.filter((c) => c.id !== id); persist(); }

  function update(c) {
    const i = state.campaigns.findIndex((x) => x.id === c.id);
    if (i !== -1) state.campaigns[i] = c; else state.campaigns.push(c);
    persist();
  }

  // --- úpravy soupisky a bitev (bez persistu — volej update(c)) ---

  function addUnit(c, f, n, initial) {
    const slot = { id: uid(), f: f, n: n, initial: initial || 0 };
    c.units.push(slot);
    return slot;
  }
  function removeUnit(c, slotId) {
    c.units = c.units.filter((u) => u.id !== slotId);
    c.battles.forEach((b) => { if (b.rows) delete b.rows[slotId]; });
  }
  function addBattle(c, name, year) {
    const b = { id: uid(), name: name || '', year: year || '', cond: '', vp: 0, vpAuto: false, ba: 0, rows: {} };
    c.battles.push(b);
    return b;
  }
  function removeBattle(c, battleId) { c.battles = c.battles.filter((b) => b.id !== battleId); }
  function row(b, slotId) {
    if (!b.rows) b.rows = {};
    if (!b.rows[slotId]) {
      b.rows[slotId] = { fielded: null, lost: null, damaged: null, recruit: null, restore: null,
                         vets: null, elite: null, heroes: null };
    }
    return b.rows[slotId];
  }

  // --- průchod bitvami pro jeden slot ---
  // states[i] = { before, dmgBefore, fielded, lost, damaged, restore, recruit,
  //               after, dmgAfter, vets, elite, heroes,
  //               maxRecruit, maxRestore, promoBefore }
  function walk(c, slotId) {
    const slot = c.units.find((u) => u.id === slotId);
    const info = slot ? unitInfo(slot.f, slot.n) : null;
    const m = info ? info.m : 0;
    const v = info ? info.v : 0;
    let owned = slot ? (slot.initial || 0) : 0;
    let dmg = 0;
    const promo = { vets: 0, elite: 0, heroes: 0 };
    const states = [];
    (c.battles || []).forEach((b) => {
      const r = (b.rows && b.rows[slotId]) || {};
      const before = owned, dmgBefore = dmg;
      const fielded = clamp(r.fielded, 0, before);
      const lost = clamp(r.lost, 0, before);
      const damaged = clamp(r.damaged, 0, before - lost);
      const core = before - lost - damaged;
      const maxRestore = dmgBefore + damaged;
      const restore = clamp(r.restore, 0, Math.min(maxRestore, Math.max(0, m - core)));
      const maxRecruit = Math.max(0, m - core - restore);
      const recruit = clamp(r.recruit, 0, maxRecruit);
      const after = Math.min(m, core + restore + recruit);
      const promoBefore = { vets: promo.vets, elite: promo.elite, heroes: promo.heroes };
      promo.vets += (r.vets || 0);
      promo.elite += (r.elite || 0);
      promo.heroes += (r.heroes || 0);
      states.push({
        before: before, dmgBefore: dmgBefore, fielded: fielded, lost: lost, damaged: damaged,
        restore: restore, recruit: recruit, after: after,
        dmgAfter: Math.max(0, dmgBefore + damaged - restore),
        cost: recruit * v + restore * halfPrice(v),
        vets: r.vets || 0, elite: r.elite || 0, heroes: r.heroes || 0,
        maxRecruit: maxRecruit, maxRestore: Math.min(maxRestore, Math.max(0, m - core)),
        promoBefore: promoBefore,
      });
      dmg = Math.max(0, dmgBefore + damaged - restore);
      owned = after;
    });
    return {
      m: m, v: v, startOwned: slot ? (slot.initial || 0) : 0,
      states: states, finalOwned: owned, finalDamaged: dmg,
      promoTotal: { vets: promo.vets, elite: promo.elite, heroes: promo.heroes },
    };
  }

  function stateAt(c, slotId, battleIndex) {
    const w = walk(c, slotId);
    return w.states[battleIndex] || null;
  }

  // Vlastněno (nepoškozených ks) vstupujíc do bitvy battleIndex.
  function ownedEntering(c, slotId, battleIndex) {
    const w = walk(c, slotId);
    if (battleIndex === undefined || battleIndex >= w.states.length) return w.finalOwned;
    if (battleIndex <= 0) return w.startOwned;
    return w.states[battleIndex - 1].after;
  }
  // Poškozené ks (v depu) vstupujíc do bitvy battleIndex.
  function damagedEntering(c, slotId, battleIndex) {
    const w = walk(c, slotId);
    if (battleIndex === undefined || battleIndex >= w.states.length) return w.finalDamaged;
    if (battleIndex <= 0) return 0;
    return w.states[battleIndex - 1].dmgAfter;
  }
  function ownedFinal(c, slotId) { return walk(c, slotId).finalOwned; }
  function damagedFinal(c, slotId) { return walk(c, slotId).finalDamaged; }
  // Kumulativní povýšení vstupujíc do bitvy (nebo celkem, bez indexu).
  function promoEntering(c, slotId, battleIndex) {
    const w = walk(c, slotId);
    if (battleIndex === undefined || battleIndex >= w.states.length) return w.promoTotal;
    return w.states[battleIndex].promoBefore;
  }
  function promoTotal(c, slotId) { return walk(c, slotId).promoTotal; }

  // --- ekonomika (BA ledger) ---

  function spentBA(c) {
    let spent = 0;
    c.units.forEach((u) => {
      const info = unitInfo(u.f, u.n);
      spent += (u.initial || 0) * (info ? info.v : 0);
      const w = walk(c, u.id);
      w.states.forEach((st) => { spent += st.cost || 0; });
    });
    return spent;
  }
  function earnedBA(c) { return c.battles.reduce((s, b) => s + (b.ba || 0), 0); }
  function availableBA(c) { return (c.startBA || 0) + earnedBA(c) - spentBA(c); }

  function totals(c) {
    let initialCount = 0, initialPoints = 0;
    c.units.forEach((u) => {
      const info = unitInfo(u.f, u.n);
      initialCount += u.initial || 0;
      initialPoints += (u.initial || 0) * (info ? info.v : 0);
    });
    const walks = {};
    c.units.forEach((u) => { walks[u.id] = walk(c, u.id); });

    const perBattle = c.battles.map((b, bi) => {
      let fielded = 0, fieldedPoints = 0, lost = 0, damaged = 0, recruit = 0, restore = 0,
          cost = 0, after = 0, vets = 0, elite = 0, heroes = 0;
      c.units.forEach((u) => {
        const info = unitInfo(u.f, u.n);
        const st = walks[u.id].states[bi];
        if (!st) return;
        fielded += st.fielded;
        fieldedPoints += st.fielded * (info ? info.v : 0);
        lost += st.lost; damaged += st.damaged;
        recruit += st.recruit; restore += st.restore;
        cost += st.cost; after += st.after;
        vets += st.vets; elite += st.elite; heroes += st.heroes;
      });
      return { fielded: fielded, fieldedPoints: fieldedPoints, lost: lost, damaged: damaged,
               recruit: recruit, restore: restore, cost: cost, after: after,
               vets: vets, elite: elite, heroes: heroes,
               vp: b.vp || 0, ba: b.ba || 0 };
    });

    let remainingCount = 0, remainingPoints = 0, damagedCount = 0;
    let vetsTotal = 0, eliteTotal = 0, heroesTotal = 0;
    c.units.forEach((u) => {
      const info = unitInfo(u.f, u.n);
      const w = walks[u.id];
      remainingCount += w.finalOwned;
      remainingPoints += w.finalOwned * (info ? info.v : 0);
      damagedCount += w.finalDamaged;
      vetsTotal += w.promoTotal.vets;
      eliteTotal += w.promoTotal.elite;
      heroesTotal += w.promoTotal.heroes;
    });
    const vpTotal = c.battles.reduce((s, b) => s + (b.vp || 0), 0);
    return {
      initialCount: initialCount, initialPoints: initialPoints,
      perBattle: perBattle,
      remainingCount: remainingCount, remainingPoints: remainingPoints, damagedCount: damagedCount,
      vetsTotal: vetsTotal, eliteTotal: eliteTotal, heroesTotal: heroesTotal,
      vpTotal: vpTotal,
      startBA: c.startBA || 0, earnedBA: earnedBA(c), spentBA: spentBA(c), availableBA: availableBA(c),
    };
  }

  window.OnusStore = {
    list: list, get: get, create: create, remove: remove, update: update,
    addUnit: addUnit, removeUnit: removeUnit,
    addBattle: addBattle, removeBattle: removeBattle, row: row,
    unitInfo: unitInfo, scenario: scenario, sideDef: sideDef,
    sideKind: sideKind, recommendedFor: recommendedFor, campaignPool: campaignPool,
    halfPrice: halfPrice,
    walk: walk, stateAt: stateAt,
    ownedEntering: ownedEntering, damagedEntering: damagedEntering,
    ownedFinal: ownedFinal, damagedFinal: damagedFinal,
    promoEntering: promoEntering, promoTotal: promoTotal,
    spentBA: spentBA, earnedBA: earnedBA, availableBA: availableBA,
    totals: totals,
    // Zpětná kompatibilita pro army-builder.js a pdf-export.js: „kolik ks
    // slotu je k dispozici“ — bez indexu celkem, s indexem před danou bitvou.
    remaining: ownedEntering,
    VP_WIN: 10,
    _reload: function () { state = load(); },
  };
})();

// Sdílený datový store kampaní (localStorage) + pomocné výpočty.
// Používají ho campaign.js, army-builder.js i pdf-export.js.
(function () {
  'use strict';

  const KEY = 'onusCampaigns.v1';
  const D = window.ONUS_DATA;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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

  // Aktuální model řádku bitvy podle listu Instructions v Campaign Log Sheetu:
  // { fielded (nasazeno), lost (ztráty), vets (povýšeno na veterána),
  //   elite (povýšeno na elitu), heroes (hrdinové u jednotky),
  //   after (zbývá po bitvě = výchozí + dokoupené − ztracené; zapisuje se) }.
  // Starší uložené modely: v1 {fielded, lost, cond}, v2 {fielded, vets, after}.
  // Bitva: cond = výchozí podmínky ''|'green'|'yellow'|'red' (dříve result V/R/P).
  function migrateCampaign(c) {
    if (!c || !Array.isArray(c.battles)) return;
    (c.units || []).forEach((u) => {
      let rem = u.initial || 0;
      c.battles.forEach((b) => {
        const r = b.rows && b.rows[u.id];
        if (!r) return;
        if (r.elite === undefined) {
          if (r.cond !== undefined) {
            // v1: ztráty přímo, kondiční tečku zahoď
            const lost = (typeof r.lost === 'number') ? r.lost : null;
            r.after = lost === null ? null : Math.max(0, rem - lost);
            r.vets = null;
            delete r.cond;
          } else {
            // v2: „after“ zůstává, ztráty dopočítej z rozdílu
            r.lost = (r.after === null || r.after === undefined)
              ? null : Math.max(0, rem - r.after);
          }
          r.elite = null;
          r.heroes = null;
        }
        if (r.after !== null && r.after !== undefined) rem = r.after;
        else if (r.lost) rem = Math.max(0, rem - r.lost);
      });
    });
    c.battles.forEach((b) => {
      if (b.cond === undefined) b.cond = '';
      delete b.result;
    });
  }

  function save(state) {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  let state = load();

  function persist() { save(state); }

  // --- katalogové pomocníky ---

  function unitInfo(f, n) {
    const u = D.units.find((u) => u.f === f && u.n === n);
    if (!u) return null;
    return { f: u.f, n: u.n, v: u.v, m: u.m, stats: D.stats[f + '|' + n] || null };
  }

  function scenario(c) {
    return D.campaigns.find((s) => s.id === c.scenarioId) || null;
  }

  function sideDef(c) {
    const s = scenario(c);
    if (!s) return null;
    return s.sides.find((sd) => sd.name === c.sideName) || null;
  }

  // Předdefinované jednotky kampaně: kompletní pool jednotek, které smí daná
  // strana používat (frakce strany podle named ranges v Campaign Log Sheetu).
  function campaignPool(scenarioId, sideName) {
    const sc = D.campaigns.find((s) => s.id === scenarioId);
    if (!sc) return [];
    const sd = sc.sides.find((s) => s.name === sideName);
    if (!sd) return [];
    const pool = [];
    sd.factions.forEach((f) => {
      D.units.forEach((u) => { if (u.f === f) pool.push(u); });
    });
    return pool;
  }

  // Naplní soupisku kampaně výchozím (defaultním) složením armády strany:
  // všechny předdefinované jednotky s plnými dostupnými počty — sloupec
  // „TOTAL AVAILABLE“ v tabulce Traianus odpovídá sloupci „max. počet“
  // v Campaign Log Sheetu. Existující sloty nechává beze změny. Vrací počet
  // přidaných slotů. Nepersistuje — volej update(c).
  function prefillPool(c) {
    const pool = campaignPool(c.scenarioId, c.sideName);
    let added = 0;
    pool.forEach((u) => {
      const exists = c.units.some((s) => s.f === u.f && s.n === u.n);
      if (!exists) { addUnit(c, u.f, u.n, u.m || 0); added++; }
    });
    return added;
  }

  // Strana s frakcí Rom.Empire dostává „římský“ sloupec doporučených armád.
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

  function get(id) {
    return state.campaigns.find((c) => c.id === id) || null;
  }

  // prefillBattleIndex: index bitvy, jejíž doporučená armáda se předvyplní
  // jako výchozí armáda (jen kampaně, pro které existují doporučené sestavy).
  function create(opts) {
    const c = {
      id: uid(),
      name: opts.name || '',
      scenarioId: opts.scenarioId,
      sideName: opts.sideName,
      createdAt: new Date().toISOString(),
      units: [],
      battles: [],
    };
    if (typeof opts.prefillBattleIndex === 'number') {
      const rec = recommendedFor(c.scenarioId, opts.prefillBattleIndex, c.sideName);
      if (rec) rec.forEach(([f, n, cnt]) => addUnit(c, f, n, cnt));
    }
    state.campaigns.push(c);
    persist();
    return c;
  }

  function remove(id) {
    state.campaigns = state.campaigns.filter((c) => c.id !== id);
    persist();
  }

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
    c.battles.forEach((b) => { delete b.rows[slotId]; });
  }

  function addBattle(c, name, year) {
    const b = { id: uid(), name: name || '', year: year || '', cond: '', vp: null, rows: {} };
    c.battles.push(b);
    return b;
  }

  function removeBattle(c, battleId) {
    c.battles = c.battles.filter((b) => b.id !== battleId);
  }

  function row(b, slotId) {
    if (!b.rows[slotId]) {
      b.rows[slotId] = { fielded: null, lost: null, vets: null, elite: null, heroes: null, after: null };
    }
    return b.rows[slotId];
  }

  // --- výpočty ---

  // Kolik jednotek slotu zbývá před bitvou battleIndex (bez indexu = po všech).
  // Přednost má zapsané „zbývá po bitvě“ (Condit.) — může zahrnovat i dokoupené
  // jednotky; není-li vyplněno, odečítají se ztráty.
  function remaining(c, slotId, battleIndex) {
    const slot = c.units.find((u) => u.id === slotId);
    if (!slot) return 0;
    const idx = battleIndex === undefined ? c.battles.length : battleIndex;
    let rem = slot.initial || 0;
    for (let i = 0; i < idx && i < c.battles.length; i++) {
      const r = c.battles[i].rows[slotId];
      if (!r) continue;
      if (r.after !== null && r.after !== undefined) rem = r.after;
      else if (r.lost) rem = Math.max(0, rem - r.lost);
    }
    return rem;
  }

  function totals(c) {
    let initialCount = 0, initialPoints = 0;
    c.units.forEach((u) => {
      const info = unitInfo(u.f, u.n);
      initialCount += u.initial || 0;
      initialPoints += (u.initial || 0) * (info ? info.v : 0);
    });
    const perBattle = c.battles.map((b, bi) => {
      let fielded = 0, fieldedPoints = 0, lost = 0, vets = 0, elite = 0, heroes = 0, after = 0;
      c.units.forEach((u) => {
        const r = b.rows[u.id];
        const info = unitInfo(u.f, u.n);
        const before = remaining(c, u.id, bi);
        if (r && r.fielded) { fielded += r.fielded; fieldedPoints += r.fielded * (info ? info.v : 0); }
        if (r && r.lost) lost += r.lost;
        if (r && r.vets) vets += r.vets;
        if (r && r.elite) elite += r.elite;
        if (r && r.heroes) heroes += r.heroes;
        if (r && r.after !== null && r.after !== undefined) after += r.after;
        else after += Math.max(0, before - ((r && r.lost) || 0));
      });
      return { fielded: fielded, fieldedPoints: fieldedPoints, lost: lost,
               vets: vets, elite: elite, heroes: heroes, after: after, vp: b.vp };
    });
    let remainingCount = 0, remainingPoints = 0;
    c.units.forEach((u) => {
      const info = unitInfo(u.f, u.n);
      const rem = remaining(c, u.id);
      remainingCount += rem;
      remainingPoints += rem * (info ? info.v : 0);
    });
    const vpTotal = c.battles.reduce((s, b) => s + (b.vp || 0), 0);
    return {
      initialCount: initialCount, initialPoints: initialPoints,
      perBattle: perBattle,
      remainingCount: remainingCount, remainingPoints: remainingPoints,
      vpTotal: vpTotal,
    };
  }

  window.OnusStore = {
    list: list, get: get, create: create, remove: remove, update: update,
    addUnit: addUnit, removeUnit: removeUnit,
    addBattle: addBattle, removeBattle: removeBattle, row: row,
    unitInfo: unitInfo, scenario: scenario, sideDef: sideDef,
    sideKind: sideKind, recommendedFor: recommendedFor,
    campaignPool: campaignPool, prefillPool: prefillPool,
    remaining: remaining, totals: totals,
    _reload: function () { state = load(); },
  };
})();

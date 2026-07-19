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
        if (state && Array.isArray(state.campaigns)) return state;
      }
    } catch (e) { /* poškozená data — začni znovu */ }
    return { campaigns: [] };
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
    const b = { id: uid(), name: name || '', year: year || '', result: '', vp: null, rows: {} };
    c.battles.push(b);
    return b;
  }

  function removeBattle(c, battleId) {
    c.battles = c.battles.filter((b) => b.id !== battleId);
  }

  function row(b, slotId) {
    if (!b.rows[slotId]) b.rows[slotId] = { fielded: null, lost: null, cond: '' };
    return b.rows[slotId];
  }

  // --- výpočty ---

  function lostBefore(c, battleIndex, slotId) {
    let lost = 0;
    for (let i = 0; i < battleIndex && i < c.battles.length; i++) {
      const r = c.battles[i].rows[slotId];
      if (r && r.lost) lost += r.lost;
    }
    return lost;
  }

  // Kolik jednotek slotu zbývá před bitvou battleIndex (Infinity = po všech).
  function remaining(c, slotId, battleIndex) {
    const slot = c.units.find((u) => u.id === slotId);
    if (!slot) return 0;
    const idx = battleIndex === undefined ? c.battles.length : battleIndex;
    return slot.initial - lostBefore(c, idx, slotId);
  }

  function totals(c) {
    let initialCount = 0, initialPoints = 0;
    c.units.forEach((u) => {
      const info = unitInfo(u.f, u.n);
      initialCount += u.initial || 0;
      initialPoints += (u.initial || 0) * (info ? info.v : 0);
    });
    const perBattle = c.battles.map((b) => {
      let fielded = 0, fieldedPoints = 0, lost = 0;
      c.units.forEach((u) => {
        const r = b.rows[u.id];
        if (!r) return;
        const info = unitInfo(u.f, u.n);
        if (r.fielded) { fielded += r.fielded; fieldedPoints += r.fielded * (info ? info.v : 0); }
        if (r.lost) lost += r.lost;
      });
      return { fielded: fielded, fieldedPoints: fieldedPoints, lost: lost, vp: b.vp };
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
    remaining: remaining, totals: totals,
    _reload: function () { state = load(); },
  };
})();

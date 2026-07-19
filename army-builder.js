// Stavitel armád ONUS! — samostatný modul.
// window.ArmyBuilder = { render(container, opts) }
// opts.campaignId (nepovinné): staví armádu z existující kampaně (OnusStore),
// jinak volný režim s výběrem scénáře/strany/bitvy.
(function () {
  'use strict';

  var STAT_LABELS = [
    ['impact', 'Úder'],
    ['wound', 'Zranění'],
    ['ranged', 'Střelba'],
    ['range', 'Dostřel'],
    ['dodge', 'Úhyb'],
    ['shield', 'Štít'],
    ['morale', 'Morálka'],
    ['life', 'Životy'],
    ['move', 'Pohyb'],
  ];

  // --- modul si drží vlastní stav, nesahá mimo svůj container ---
  var root = null;     // aktuální kontejner (DOM element)
  var D = null;         // window.ONUS_DATA (načteno při render())
  var Store = null;     // window.OnusStore (načteno při render())
  var state = null;

  function esc(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function keyOf(f, n) { return f + '|' + n; }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // --- datové pomocníky ---

  function getScenarioObj(scenarioId) {
    return D.campaigns.find(function (s) { return s.id === scenarioId; }) || null;
  }

  function getSideObj(scenarioObj, sideName) {
    if (!scenarioObj) return null;
    return scenarioObj.sides.find(function (sd) { return sd.name === sideName; }) || null;
  }

  // Sestaví dostupné jednotky pro aktuální kontext, seskupené podle frakce.
  // Bez kampaně: katalog ONUS_DATA.units omezený na frakce strany, max = m.
  // S kampaní: jen jednotky soupisky kampaně, max = zbývající počet (sloty se
  // stejnou jednotkou sečteny).
  function getAvailableUnits(st) {
    var scenarioObj = getScenarioObj(st.scenarioId);
    var out = { factions: [], byKey: {} };
    if (!scenarioObj || !st.sideName) return out;
    var sideObj = getSideObj(scenarioObj, st.sideName);
    if (!sideObj) return out;
    var factionOrder = sideObj.factions;
    var byKey = out.byKey;

    if (st.campaign) {
      var groups = {};
      st.campaign.units.forEach(function (u) {
        if (factionOrder.indexOf(u.f) === -1) return;
        var k = keyOf(u.f, u.n);
        if (!groups[k]) groups[k] = { f: u.f, n: u.n, remaining: 0 };
        groups[k].remaining += Math.max(0, Store.remaining(st.campaign, u.id));
      });
      Object.keys(groups).forEach(function (k) {
        var g = groups[k];
        var info = Store.unitInfo(g.f, g.n);
        byKey[k] = { f: g.f, n: g.n, v: info ? info.v : 0, max: g.remaining, stats: info ? info.stats : null };
      });
    } else {
      D.units.filter(function (u) { return factionOrder.indexOf(u.f) !== -1; }).forEach(function (u) {
        var k = keyOf(u.f, u.n);
        byKey[k] = { f: u.f, n: u.n, v: u.v, max: u.m, stats: D.stats[k] || null };
      });
    }

    factionOrder.forEach(function (f) {
      var items = Object.keys(byKey)
        .filter(function (k) { return byKey[k].f === f; })
        .map(function (k) { return byKey[k]; })
        .sort(function (a, b) { return a.n < b.n ? -1 : a.n > b.n ? 1 : 0; });
      if (items.length) out.factions.push({ faction: f, items: items });
    });
    return out;
  }

  function getRecommended(st) {
    if (!st.scenarioId || !st.sideName || st.battleIndex === null) return null;
    if (!D.recommended[st.scenarioId]) return null;
    return Store.recommendedFor(st.scenarioId, st.battleIndex, st.sideName);
  }

  function recommendedTotal(rec) {
    if (!rec) return 0;
    var total = 0;
    rec.forEach(function (item) {
      var info = Store.unitInfo(item[0], item[1]);
      total += (info ? info.v : 0) * item[2];
    });
    return total;
  }

  function effectiveBudget(st) {
    if (st.budgetMode === 'custom') return Math.max(0, st.customBudget | 0);
    if (st.budgetMode === 'recommended') return recommendedTotal(getRecommended(st));
    var idx = st.budgetMode === 'preset1' ? 1 : 0;
    return (D.budgets && D.budgets[idx] !== undefined) ? D.budgets[idx] : (idx === 0 ? 1000 : 1800);
  }

  function computeTotals(st, avail) {
    var count = 0, points = 0;
    Object.keys(st.items).forEach(function (k) {
      var c = st.items[k];
      if (!c) return;
      var info = avail.byKey[k];
      count += c;
      points += c * (info ? info.v : 0);
    });
    return { count: count, points: points };
  }

  // --- akce měnící stav ---

  function applyRecommended(st, avail) {
    var rec = getRecommended(st);
    if (!rec) return;
    var items = {};
    rec.forEach(function (item) {
      var k = keyOf(item[0], item[1]);
      var info = avail.byKey[k];
      var max = info ? info.max : 0;
      var cnt = Math.min(item[2], max);
      if (cnt > 0) items[k] = cnt;
    });
    st.items = items;
  }

  function randomArmy(st, avail) {
    var budget = effectiveBudget(st);
    var candidates = [];
    avail.factions.forEach(function (grp) {
      grp.items.forEach(function (it) { if (it.max > 0) candidates.push(it); });
    });
    var items = {};
    var total = 0;
    var guard = 0;
    while (guard++ < 5000) {
      var pool = candidates.filter(function (it) {
        var cur = items[keyOf(it.f, it.n)] || 0;
        return cur < it.max && (total + it.v) <= budget;
      });
      if (!pool.length) break;
      var pick = pool[Math.floor(Math.random() * pool.length)];
      var k = keyOf(pick.f, pick.n);
      items[k] = (items[k] || 0) + 1;
      total += pick.v;
    }
    st.items = items;
  }

  // --- render helpery ---

  function factionHeading(f) {
    return '<div class="ab-faction-heading">' + esc(f) + '</div>';
  }

  function statsPanel(stats) {
    var cells = STAT_LABELS.map(function (pair) {
      var val = stats[pair[0]];
      var display = (val === null || val === undefined) ? '—' : val;
      return '<div class="ab-stat"><span class="ab-stat-label">' + esc(pair[1]) + '</span><span class="ab-stat-val">' + esc(display) + '</span></div>';
    }).join('');
    var skirmish = stats.skirmish ? '<div class="ab-stat ab-stat-wide">✻ Harcovníci (skirmish)</div>' : '';
    return '<div class="ab-stats">' + cells + skirmish + '</div>';
  }

  function unitRow(st, it) {
    var k = keyOf(it.f, it.n);
    var count = st.items[k] || 0;
    var atMax = count >= it.max;
    var expanded = !!st.expanded[k];
    var kAttr = esc(k);
    var toggle = it.stats
      ? '<button type="button" class="ab-stats-toggle" data-action="toggleStats" data-key="' + kAttr + '" aria-label="Zobrazit staty">' + (expanded ? '▾' : '▸') + '</button>'
      : '<span class="ab-stats-toggle ab-stats-toggle-empty"></span>';
    var html = '' +
      '<div class="mod-row ab-row">' +
        toggle +
        '<span class="mod-label ab-name">' + esc(it.n) + '</span>' +
        '<span class="ab-value">' + it.v + ' b/ks</span>' +
        '<div class="ab-stepper">' +
          '<button type="button" class="ab-step-btn" data-action="dec" data-key="' + kAttr + '"' + (count <= 0 ? ' disabled' : '') + '>−</button>' +
          '<span class="ab-count">' + count + '</span>' +
          '<button type="button" class="ab-step-btn" data-action="inc" data-key="' + kAttr + '"' + (atMax ? ' disabled' : '') + '>+</button>' +
        '</div>' +
      '</div>';
    if (it.stats && expanded) html += statsPanel(it.stats);
    return html;
  }

  function errorCard() {
    return '<div class="card accent-red">' +
      '<h3 class="serif">Kampaň nenalezena</h3>' +
      '<p class="grid-note">Kampaň zadaná v odkazu neexistuje nebo byla smazána. Pokračuj ve volném režimu — vyber scénář a stranu níže.</p>' +
      '</div>';
  }

  function contextCard(st, scenarioObj, sideObj) {
    var body = '';
    if (st.campaign) {
      body += '<div class="field">' +
        '<div class="field-row"><span>Kampaň</span><b>' + esc(st.campaign.name) + '</b></div>' +
        '<div class="field-row"><span>Scénář</span><b>' + esc(scenarioObj ? scenarioObj.name : '') + (scenarioObj ? ' (' + esc(scenarioObj.period) + ')' : '') + '</b></div>' +
        '<div class="field-row"><span>Strana</span><b>' + esc(st.sideName) + '</b></div>' +
        '</div>';
    } else {
      body += '<div class="field">' +
        '<span class="choice-label">Scénář</span>' +
        '<select class="ab-select" data-action="setScenario">' +
        '<option value="">— vyber scénář —</option>' +
        D.campaigns.map(function (s) {
          var sel = s.id === st.scenarioId ? ' selected' : '';
          return '<option value="' + esc(s.id) + '"' + sel + '>' + esc(s.name) + ' (' + esc(s.period) + ')</option>';
        }).join('') +
        '</select></div>';

      if (scenarioObj) {
        body += '<div class="choice-group">' +
          '<span class="choice-label">Strana</span>' +
          '<div class="choice-buttons">' +
          scenarioObj.sides.map(function (sd) {
            var active = sd.name === st.sideName;
            var style = active ? 'background:#9c7327;color:#fff;border-color:#9c7327;' : '';
            return '<button type="button" class="choice-btn" data-action="setSide" data-value="' + esc(sd.name) + '" style="' + style + '">' + esc(sd.name) + '</button>';
          }).join('') +
          '</div></div>';
      }
    }

    if (scenarioObj && st.sideName) {
      body += '<div class="field">' +
        '<span class="choice-label">Bitva</span>' +
        '<select class="ab-select" data-action="setBattle">' +
        '<option value=""' + (st.battleIndex === null ? ' selected' : '') + '>Volná bitva (bez konkrétní bitvy)</option>' +
        scenarioObj.battles.map(function (b, i) {
          var sel = i === st.battleIndex ? ' selected' : '';
          return '<option value="' + i + '"' + sel + '>' + esc(b.n) + ' (' + esc(b.y) + ')</option>';
        }).join('') +
        '</select>' +
        '<span class="hint">Bitva ovlivňuje doporučenou sestavu a rozpočet „dle doporučené“.</span>' +
        '</div>';
    }

    return '<div class="card accent-gold gap-14">' +
      '<h3 class="serif">Kontext armády</h3>' +
      body +
      '</div>';
  }

  function budgetCard(st, rec) {
    var presets = D.budgets || [1000, 1800];
    function btn(label, mode, disabled, title) {
      var active = st.budgetMode === mode;
      var style = active ? 'background:#9c7327;color:#fff;border-color:#9c7327;' : '';
      return '<button type="button" class="choice-btn wide" data-action="setBudgetMode" data-value="' + esc(mode) + '"' +
        (disabled ? ' disabled' : '') + (title ? ' title="' + esc(title) + '"' : '') +
        ' style="' + style + (disabled ? 'opacity:.45;cursor:not-allowed;' : '') + '">' + esc(label) + '</button>';
    }
    var recTotal = recommendedTotal(rec);
    var html = '<div class="card accent-gold gap-14">' +
      '<h3 class="serif">Bodový rozpočet</h3>' +
      '<div class="choice-buttons wrap">' +
      btn(presets[0] + ' b.', 'preset0') +
      btn((presets[1] !== undefined ? presets[1] : 1800) + ' b.', 'preset1') +
      btn('Vlastní', 'custom') +
      btn('Dle doporučené', 'recommended', !rec, rec ? ('Doporučená sestava: ' + recTotal + ' b.') : 'Dostupné jen pro bitvy s doporučenou sestavou (Traianus).') +
      '</div>';
    if (st.budgetMode === 'custom') {
      html += '<div class="field">' +
        '<span class="choice-label">Vlastní rozpočet (body)</span>' +
        '<input type="number" class="ab-input" min="0" step="10" value="' + esc(st.customBudget) + '" data-action="setCustomBudget">' +
        '</div>';
    }
    html += '<p class="hint">Aktuální rozpočet: <b>' + effectiveBudget(st) + ' b.</b></p>';
    html += '</div>';
    return html;
  }

  function actionsCard(st, rec, hasUnits) {
    var recDisabled = !rec;
    return '<div class="card accent-green gap-14">' +
      '<h3 class="serif">Rychlé akce</h3>' +
      '<div class="choice-buttons wrap">' +
        '<button type="button" class="choice-btn wide" data-action="applyRecommended"' + (recDisabled ? ' disabled style="opacity:.45;cursor:not-allowed;"' : '') +
          (recDisabled ? ' title="Dostupné jen pro bitvy s doporučenou sestavou (Traianus)."' : '') + '>Doporučená sestava</button>' +
        '<button type="button" class="choice-btn wide" data-action="randomArmy"' + (hasUnits ? '' : ' disabled style="opacity:.45;cursor:not-allowed;"') + '>Náhodná armáda</button>' +
      '</div>' +
      '<button type="button" class="reset-btn" data-action="clearArmy">Vyprázdnit sestavu</button>' +
      '</div>';
  }

  function rosterCard(st, avail) {
    if (!avail.factions.length) {
      return '<div class="card accent-gold">' +
        '<h3 class="serif">Sestava</h3>' +
        '<p class="grid-note">' + (st.campaign ? 'Kampaň zatím nemá žádné jednotky v soupisce.' : 'Pro tuto stranu nejsou v katalogu žádné jednotky.') + '</p>' +
        '</div>';
    }
    var body = avail.factions.map(function (grp) {
      return factionHeading(grp.faction) + grp.items.map(function (it) { return unitRow(st, it); }).join('');
    }).join('');
    return '<div class="card accent-gold">' +
      '<h3 class="serif">Sestava</h3>' +
      body +
      '</div>';
  }

  function summaryCard(st, totals, budget, battleObj, scenarioObj) {
    var over = totals.points > budget;
    var pointsColor = over ? '#8c2a22' : '#2f5d3a';
    var threshold = Math.floor(totals.points * (D.defeatThreshold || 0.5));
    var pdfMsg = st.pdfMsg ? '<p class="hint" style="color:#8c2a22;">' + esc(st.pdfMsg) + '</p>' : '';
    return '<div class="card accent-red gap-14 ab-summary">' +
      '<h3 class="serif">Souhrn armády</h3>' +
      '<div class="field-row"><span>Body celkem / rozpočet</span><b style="color:' + pointsColor + ';">' + totals.points + ' / ' + budget + '</b></div>' +
      '<div class="field-row"><span>Počet jednotek</span><b>' + totals.count + '</b></div>' +
      '<div class="field-row"><span>Práh porážky (' + Math.round((D.defeatThreshold || 0.5) * 100) + ' % hodnoty)</span><b>Porážka při ztrátě ' + threshold + ' b.</b></div>' +
      (over ? '<p class="hint" style="color:#8c2a22;">Sestava přesahuje zvolený rozpočet.</p>' : '') +
      '<button type="button" class="choice-btn wide" data-action="downloadPdf">Stáhnout PDF</button>' +
      pdfMsg +
      '</div>';
  }

  // --- sestavení armády pro export ---

  function buildArmyExport(st, avail, budget, scenarioObj) {
    var items = [];
    avail.factions.forEach(function (grp) {
      grp.items.forEach(function (it) {
        var k = keyOf(it.f, it.n);
        var c = st.items[k] || 0;
        if (c > 0) items.push({ f: it.f, n: it.n, v: it.v, count: c });
      });
    });
    var title = (st.battleIndex !== null && scenarioObj) ? scenarioObj.battles[st.battleIndex].n : 'Vlastní armáda';
    var subtitle;
    if (st.campaign) {
      subtitle = st.campaign.name + ' · ' + (scenarioObj ? scenarioObj.name : '') + ' — ' + st.sideName;
    } else {
      subtitle = (scenarioObj ? scenarioObj.name + ' (' + scenarioObj.period + ')' : '') + ' — ' + st.sideName;
    }
    return { title: title, subtitle: subtitle, sideName: st.sideName, budget: budget, items: items };
  }

  // --- hlavní vykreslení ---

  function draw() {
    var st = state;
    var scenarioObj = getScenarioObj(st.scenarioId);
    var sideObj = scenarioObj ? getSideObj(scenarioObj, st.sideName) : null;
    var ready = !!(scenarioObj && sideObj);
    var avail = ready ? getAvailableUnits(st) : { factions: [], byKey: {} };
    var rec = ready ? getRecommended(st) : null;
    var budget = ready ? effectiveBudget(st) : 0;
    var totals = computeTotals(st, avail);

    var html = '' +
      '<section class="page ab-page">' +
        '<div class="header">' +
          '<h1 class="serif">ONUS! — Stavitel armád</h1>' +
          '<div class="divider"></div>' +
          '<p>Sestav armádu podle rozpočtu, doporučené sestavy nebo náhodně a stáhni ji jako PDF.</p>' +
        '</div>' +
        '<div class="content">' +
          (st.campaignError ? errorCard() : '') +
          contextCard(st, scenarioObj, sideObj) +
          (ready ? budgetCard(st, rec) : '') +
          (ready ? actionsCard(st, rec, avail.factions.length > 0) : '') +
          (ready ? rosterCard(st, avail) : '') +
          (ready ? summaryCard(st, totals, budget, null, scenarioObj) : '') +
        '</div>' +
      '</section>';

    root.innerHTML = html;
  }

  // --- stav ---

  function buildInitialState(opts) {
    var st = {
      campaignId: opts && opts.campaignId,
      campaign: null,
      campaignError: false,
      scenarioId: '',
      sideName: '',
      battleIndex: null,
      budgetMode: 'preset0',
      customBudget: 1000,
      items: {},
      expanded: {},
      pdfMsg: '',
    };
    if (st.campaignId) {
      if (Store && typeof Store.get === 'function') {
        var c = Store.get(st.campaignId);
        if (c) {
          st.campaign = c;
          st.scenarioId = c.scenarioId;
          st.sideName = c.sideName;
        } else {
          st.campaignError = true;
        }
      } else {
        st.campaignError = true;
      }
    }
    return st;
  }

  // --- eventy ---

  function onClick(e) {
    var el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    var action = el.dataset.action;
    var scenarioObj = getScenarioObj(state.scenarioId);
    var avail = getAvailableUnits(state);

    if (action === 'setSide') {
      state.sideName = el.dataset.value;
      state.items = {};
      state.expanded = {};
    } else if (action === 'setBudgetMode') {
      var mode = el.dataset.value;
      if (mode === 'recommended' && !getRecommended(state)) return;
      state.budgetMode = mode;
    } else if (action === 'applyRecommended') {
      applyRecommended(state, avail);
    } else if (action === 'randomArmy') {
      randomArmy(state, avail);
    } else if (action === 'clearArmy') {
      state.items = {};
    } else if (action === 'inc') {
      var k1 = el.dataset.key;
      var info1 = avail.byKey[k1];
      var max1 = info1 ? info1.max : 0;
      state.items[k1] = clamp((state.items[k1] || 0) + 1, 0, max1);
    } else if (action === 'dec') {
      var k2 = el.dataset.key;
      state.items[k2] = Math.max(0, (state.items[k2] || 0) - 1);
    } else if (action === 'toggleStats') {
      var k3 = el.dataset.key;
      state.expanded[k3] = !state.expanded[k3];
    } else if (action === 'downloadPdf') {
      var budget = effectiveBudget(state);
      var army = buildArmyExport(state, avail, budget, scenarioObj);
      try {
        if (window.OnusPDF && typeof window.OnusPDF.exportArmy === 'function') {
          window.OnusPDF.exportArmy(army);
          state.pdfMsg = '';
        } else {
          state.pdfMsg = 'PDF export není momentálně k dispozici (modul se ještě načítá).';
        }
      } catch (err) {
        state.pdfMsg = 'Export PDF se nezdařil.';
      }
    } else {
      return;
    }
    draw();
  }

  function onChange(e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.dataset.action;
    if (action === 'setScenario') {
      state.scenarioId = el.value;
      state.sideName = '';
      state.battleIndex = null;
      state.budgetMode = 'preset0';
      state.items = {};
      state.expanded = {};
    } else if (action === 'setBattle') {
      state.battleIndex = el.value === '' ? null : Number(el.value);
    } else if (action === 'setCustomBudget') {
      state.customBudget = Math.max(0, Number(el.value) || 0);
    } else {
      return;
    }
    draw();
  }

  function render(container, opts) {
    if (!container) return;
    root = container;
    D = window.ONUS_DATA;
    Store = window.OnusStore;

    if (!D) {
      root.innerHTML = '<div class="content"><div class="card accent-red"><h3 class="serif">Chyba</h3>' +
        '<p class="grid-note">Chybí datový soubor campaign-data.js (window.ONUS_DATA).</p></div></div>';
      return;
    }
    if (!Store) {
      root.innerHTML = '<div class="content"><div class="card accent-red"><h3 class="serif">Chyba</h3>' +
        '<p class="grid-note">Chybí campaign-store.js (window.OnusStore).</p></div></div>';
      return;
    }

    state = buildInitialState(opts);

    if (!root.__onusAbBound) {
      root.addEventListener('click', onClick);
      root.addEventListener('change', onChange);
      root.__onusAbBound = true;
    }

    draw();
  }

  window.ArmyBuilder = { render: render };
})();

// ONUS! — Kampaně a bitvy: hlavní aplikace stránky campaign.html.
// Hash router (#/, #/campaign/<id>, #/builder), seznam kampaní, digitální
// Campaign Log a záložka Stavitel (deleguje na window.ArmyBuilder).
//
// Logika kampaně (model v3 v campaign-store.js):
//   • Kampaň má rozpočet „výchozí body armády“ (BA). Z něj se kupuje startovní
//     soupiska a mezi bitvami posily; za bitvy se BA i VP získávají zpět.
//   • Krok „Vaše armáda“ = nákup jednotek (max. počet typu i dostupné BA).
//   • Krok „bitva“ = nasazeno / ztraceno / poškozeno / naverbováno (plná cena)
//     / obnoveno (poloviční cena) + povýšení (veteráni, elitní, hrdinové),
//     které se přenáší mezi bitvami. „Zbývá“ se dopočítá automaticky.
//   • Výsledek bitvy: zelená = vítězství (automaticky VP_WIN), žlutá = remíza,
//     červená = prohra — u remízy a prohry se VP zadávají ručně.
(function () {
  'use strict';

  const root = document.getElementById('app');
  const D = window.ONUS_DATA;
  const Store = window.OnusStore;

  const MAX_BATTLES = 8;
  const DEFAULT_START_BA = 1000;

  const C = {
    text: '#2a2018', muted: '#6b5c46', dark: '#4a3418',
    gold: '#9c7327', red: '#8c2a22', green: '#2f5d3a',
    hint: '#9a8a68', yellow: '#e3c26a',
  };

  // Nepersistovaný stav formulářů (přežívá mezi rendery, ne přes reload).
  const ui = {
    showNewForm: false,
    newCampaign: null,     // { scenarioId, sideName, name, startBA }
    addUnit: {},           // campaignId -> { faction, name }
    prefill: {},           // campaignId -> { battleIndex }
    logView: {},           // campaignId -> 'battles' | 'overview'
    activeBattle: {},      // campaignId -> -1 (vaše armáda) | index bitvy
  };

  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function intOr(v, fallback) {
    const n = parseInt(v, 10);
    return isNaN(n) ? fallback : n;
  }

  function attrs(map) {
    return Object.keys(map || {})
      .filter((k) => map[k] !== undefined && map[k] !== null)
      .map((k) => `data-${k}="${esc(map[k])}"`)
      .join(' ');
  }

  // ---------------------------------------------------------------------
  // Router
  // ---------------------------------------------------------------------

  function parseHash() {
    let h = (window.location.hash || '#/').replace(/^#/, '');
    if (!h) h = '/';
    let path = h, queryStr = '';
    const qIdx = h.indexOf('?');
    if (qIdx !== -1) { path = h.slice(0, qIdx); queryStr = h.slice(qIdx + 1); }
    const parts = path.split('/').filter(Boolean);
    const query = {};
    queryStr.split('&').forEach((pair) => {
      if (!pair) return;
      const eq = pair.indexOf('=');
      const k = eq === -1 ? pair : pair.slice(0, eq);
      const v = eq === -1 ? '' : pair.slice(eq + 1);
      try { query[decodeURIComponent(k)] = decodeURIComponent(v); } catch (e) { query[k] = v; }
    });
    if (parts[0] === 'campaign' && parts[1]) return { view: 'campaign', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'builder') return { view: 'builder', campaignId: query.campaign || undefined };
    return { view: 'list' };
  }

  function navigate(hash) {
    if (window.location.hash === hash) render();
    else window.location.hash = hash;
  }

  // ---------------------------------------------------------------------
  // Stavební kameny vzhledu (stejná vizuální logika pro kampaň i bitvy)
  // ---------------------------------------------------------------------

  function shell(active, headerHtml, bodyHtml) {
    return `
      <section class="page">
        ${headerHtml}
        <div class="camp-wrap camp-tabs">
          <button type="button" class="camp-tab${active === 'list' ? ' active' : ''}" data-action="nav" data-href="#/">Kampaně a bitvy</button>
          <button type="button" class="camp-tab${active === 'builder' ? ' active' : ''}" data-action="nav" data-href="#/builder">Stavitel armády</button>
        </div>
        <div class="camp-wrap camp-body">${bodyHtml}</div>
      </section>`;
  }

  function headerHtml(title, subtitle, withBack) {
    return `
      <div class="camp-wrap camp-header">
        <h1 class="serif">${esc(title)}</h1>
        <div class="divider"></div>
        <p>${subtitle}</p>
        ${withBack ? '<button type="button" class="camp-back" data-action="gotoList">← Zpět na seznam kampaní</button>' : ''}
      </div>`;
  }

  // Mincový krokovač: − [mince] +. Mince nese hodnotu (zlatá kladná,
  // červená záporná, prázdná nula), tlačítka se zašednou na krajích rozsahu.
  function stepHtml(o) {
    const v = o.value == null ? 0 : o.value;
    const coinCls = v > 0 ? ' pos' : (v < 0 ? ' neg' : '');
    const btn = (dir, sign, enabled, target) => (enabled
      ? `<button type="button" class="camp-step-btn ${dir}" ${attrs(Object.assign({}, o.data, { value: target }))}>${sign}</button>`
      : `<button type="button" class="camp-step-btn ${dir} off" disabled>${sign}</button>`);
    return `
      <div class="camp-step${o.large ? ' lg' : ''}">
        <span class="camp-step-label"${o.accent ? ` style="color:${o.accent};"` : ''}>${esc(o.label)}</span>
        <div class="camp-step-controls">
          ${btn('dec', '−', o.canDec, v - 1)}
          <div class="camp-coin${coinCls}">${v}</div>
          ${btn('inc', '+', o.canInc, v + 1)}
        </div>
        ${o.hint ? `<span class="camp-step-hint${o.hintClass ? ' ' + o.hintClass : ''}">${esc(o.hint)}</span>` : ''}
      </div>`;
  }

  // Krokovač pro pole řádku bitvy (nasazeno / ztraceno / … / obnoveno).
  function rowStepHtml(c, b, slotId, field, label, accent, value, min, max, hint, hintClass) {
    return stepHtml({
      label: label, accent: accent, value: value,
      canDec: value > min, canInc: value < max,
      hint: hint, hintClass: hintClass,
      data: { action: 'stepRow', id: c.id, battle: b.id, slot: slotId, field: field },
    });
  }

  // ---------------------------------------------------------------------
  // Vlastnosti jednotky z nahrané tabulky
  // ---------------------------------------------------------------------

  const STAT_MAP = [
    ['impact', 'Náraz'], ['wound', 'Zranění'], ['ranged', 'Střelba'], ['range', 'Dostřel'],
    ['dodge', 'Úhyb'], ['shield', 'Štít'], ['morale', 'Morál'], ['life', 'Životy'], ['move', 'Pohyb'],
  ];

  function statRows(f, n) {
    const info = Store.unitInfo(f, n);
    const s = info && info.stats;
    if (!s) return [];
    const out = STAT_MAP.filter((p) => s[p[0]] != null).map((p) => ({ label: p[1], v: String(s[p[0]]) }));
    out.push({ label: 'Harcování', v: s.skirmish ? 'ano' : '—' });
    return out;
  }

  function statsTitle(f, n) {
    const rows = statRows(f, n);
    return rows.length ? rows.map((r) => r.label + ' ' + r.v).join(' · ') : '';
  }

  // ---------------------------------------------------------------------
  // Seznam kampaní (#/)
  // ---------------------------------------------------------------------

  function ensureNewCampaignState() {
    if (!ui.newCampaign) {
      const sc = D.campaigns[0];
      ui.newCampaign = { scenarioId: sc.id, sideName: sc.sides[0].name, name: '', startBA: DEFAULT_START_BA };
    }
    return ui.newCampaign;
  }

  function campaignCardHtml(c) {
    const sc = Store.scenario(c);
    const totals = Store.totals(c);
    const stats = [
      { b: c.battles.length + '/' + MAX_BATTLES, label: 'bitev' },
      { b: totals.remainingCount, label: 'jednotek' },
      { b: totals.availableBA, label: 'BA k dispozici' },
      { b: totals.vpTotal, label: 'VP' },
    ];
    return `
      <div class="camp-card gold">
        <h3>${esc(c.name || (sc ? sc.name : 'Kampaň'))}</h3>
        <p class="camp-note">${sc ? esc(sc.name) + ' · ' + esc(sc.period) : 'Scénář nenalezen'} — strana ${esc(c.sideName)}</p>
        <div class="camp-card-stats">
          ${stats.map((s) => `<div><b>${esc(s.b)}</b><span>${esc(s.label)}</span></div>`).join('')}
        </div>
        <div class="camp-card-actions">
          <button type="button" class="camp-btn gold grow" data-action="openCampaign" data-id="${esc(c.id)}">Otevřít</button>
          <button type="button" class="camp-btn danger" data-action="deleteCampaign" data-id="${esc(c.id)}">Smazat</button>
        </div>
      </div>`;
  }

  function newCampaignFormHtml() {
    const f = ensureNewCampaignState();
    const sc = D.campaigns.find((s) => s.id === f.scenarioId) || D.campaigns[0];
    const scenarioOptions = D.campaigns.map((s) =>
      `<option value="${esc(s.id)}"${s.id === sc.id ? ' selected' : ''}>${esc(s.name)} (${esc(s.period)})</option>`
    ).join('');
    const sides = sc.sides.map((sd) => {
      const on = sd.name === f.sideName;
      return `<button type="button" class="camp-btn${on ? ' gold' : ''}" data-action="nfSide" data-value="${esc(sd.name)}">${esc(sd.name)}</button>`;
    }).join('');

    return `
      <div class="camp-card green" style="max-width:660px;gap:16px;">
        <h3>Nová kampaň</h3>

        <div class="camp-field">
          <span class="camp-label">Scénář</span>
          <select data-action="nfScenario">${scenarioOptions}</select>
          <span class="camp-hint">${esc(sc.period)} · ${sc.battles.length} bitev${sc.note ? ' · ' + esc(sc.note) : ''}</span>
        </div>

        <div class="camp-field">
          <span class="camp-label">Strana</span>
          <div class="camp-choices">${sides}</div>
        </div>

        <div class="camp-field">
          <span class="camp-label">Výchozí body armády (BA)</span>
          <input type="number" min="0" class="camp-input mid" value="${f.startBA}" data-action="nfStartBA">
          <span class="camp-hint">Rozpočet, ze kterého složíš startovní armádu a mezi bitvami kupuješ posily. Za vítězství pak přibývají další BA.</span>
        </div>

        <div class="camp-field">
          <span class="camp-label">Vlastní název kampaně (nepovinné)</span>
          <input type="text" class="camp-input" value="${esc(f.name)}" placeholder="${esc(sc.name)}" data-action="nfName">
        </div>

        <button type="button" class="camp-btn gold start" data-action="createCampaign">Založit kampaň</button>
        <span class="camp-hint">Po založení si na kroku „Vaše armáda“ nakoupíš jednotky do kampaně.</span>
      </div>`;
  }

  function renderList() {
    const campaigns = Store.list();
    const header = headerHtml(
      'ONUS! — Kampaně a bitvy',
      'Digitální Campaign Log: založ kampaň s rozpočtem BA, slož armádu, veď bitvy a spravuj posily, ztráty a Victory Points.',
      false
    );

    let body = '';
    if (campaigns.length) {
      body += `<div class="camp-list">${campaigns.map(campaignCardHtml).join('')}</div>`;
      body += `<button type="button" class="camp-btn green-outline start" data-action="toggleNewForm">${ui.showNewForm ? '− Skrýt formulář' : '+ Nová kampaň'}</button>`;
    }
    if (!campaigns.length || ui.showNewForm) body += newCampaignFormHtml();

    root.innerHTML = shell('list', header, body);
  }

  // ---------------------------------------------------------------------
  // Detail kampaně (#/campaign/<id>)
  // ---------------------------------------------------------------------

  function availableUnitsForFaction(c, faction) {
    return D.units.filter((u) => u.f === faction && !c.units.some((cu) => cu.f === u.f && cu.n === u.n));
  }

  // Výběr ve formuláři „Přidat jednotku“ se sám opraví, když vybraná jednotka
  // mezitím skončí v soupisce (třeba přes doporučenou sestavu).
  function ensureAddUnitState(c) {
    const sd = Store.sideDef(c);
    const factions = sd ? sd.factions : [];
    let a = ui.addUnit[c.id];
    if (!a || factions.indexOf(a.faction) === -1) {
      a = { faction: factions.length ? factions[0] : '', name: '' };
    }
    const units = availableUnitsForFaction(c, a.faction);
    if (!units.some((u) => u.n === a.name)) a.name = units.length ? units[0].n : '';
    ui.addUnit[c.id] = a;
    return a;
  }

  function ensurePrefillState(c) {
    if (!ui.prefill[c.id]) ui.prefill[c.id] = { battleIndex: 0 };
    return ui.prefill[c.id];
  }

  function activeStep(c) {
    let active = ui.activeBattle[c.id];
    if (active === undefined) active = c.battles.length ? c.battles.length - 1 : -1;
    if (active >= c.battles.length) active = c.battles.length ? c.battles.length - 1 : -1;
    ui.activeBattle[c.id] = active;
    return active;
  }

  // --- souhrn kampaně ---------------------------------------------------

  function summaryCardHtml(c, totals) {
    const pdfReady = !!(window.OnusPDF && typeof window.OnusPDF.exportCampaign === 'function');
    const tiles = [
      { b: totals.remainingCount, label: 'jednotek', bg: '#fbf6e6', color: C.dark },
      { b: totals.damagedCount, label: 'poškozených', bg: '#fbf6e6', color: C.gold },
      { b: totals.remainingPoints, label: 'body armády', bg: '#fbf6e6', color: C.dark },
      { b: totals.availableBA, label: 'BA k dispozici', bg: '#eef4ec', color: C.green },
      { b: totals.spentBA, label: 'utraceno BA', bg: '#f7ecea', color: C.red },
      { b: totals.vpTotal, label: 'VP celkem', bg: '#f7ecea', color: C.red },
    ];
    return `
      <div class="camp-card gold">
        <h3>Souhrn kampaně</h3>
        <div class="camp-summary">
          ${tiles.map((t) => `<div style="background:${t.bg};"><b style="color:${t.color};">${esc(t.b)}</b><span>${esc(t.label)}</span></div>`).join('')}
        </div>
        <div class="camp-summary-actions">
          <button type="button" class="camp-btn" data-action="campDownloadPdf" data-id="${esc(c.id)}"${pdfReady ? '' : ' disabled title="PDF export není momentálně k dispozici"'}>Stáhnout PDF</button>
          <button type="button" class="camp-btn" data-action="gotoBuilder" data-id="${esc(c.id)}">Sestavit armádu do bitvy</button>
        </div>
      </div>`;
  }

  // --- krok „Vaše armáda“ ----------------------------------------------

  function armyUnitCardHtml(c, u, avail) {
    const info = Store.unitInfo(u.f, u.n);
    const v = info ? info.v : 0;
    const m = info ? info.m : 0;
    const initial = u.initial || 0;
    const over = initial > m;
    const canInc = initial < m && avail >= v;

    const pt = Store.promoTotal(c, u.id);
    const extra = [];
    if (pt.vets) extra.push('veteráni ' + pt.vets);
    if (pt.elite) extra.push('elitní ' + pt.elite);
    if (pt.heroes) extra.push('hrdinové ' + pt.heroes);
    const dmg = Store.damagedFinal(c, u.id);
    if (dmg) extra.push(dmg + ' poškozených');

    const meta = v + ' b/ks · max ' + m + ' · ' + (initial * v) + ' b.'
      + (over ? ' · NAD LIMIT' : (canInc ? '' : (initial >= m ? ' · maximum' : ' · nedostatek BA')))
      + (extra.length ? ' · ' + extra.join(' · ') : '');

    return `
      <div class="camp-unit army${over ? ' over' : ''}">
        <div class="camp-unit-head">
          <span class="camp-unit-name" title="${esc(statsTitle(u.f, u.n))}">${esc(u.f)} — ${esc(u.n)}</span>
          <button type="button" class="camp-unit-remove" title="Odebrat jednotku" data-action="removeUnitSlot" data-id="${esc(c.id)}" data-slot="${esc(u.id)}">✕</button>
        </div>
        <div class="camp-unit-row">
          ${stepHtml({
            label: 'V armádě', value: initial, large: true,
            canDec: initial > 0, canInc: canInc,
            data: { action: 'stepInitial', id: c.id, slot: u.id },
          })}
          <span class="camp-unit-meta">${esc(meta)}</span>
        </div>
      </div>`;
  }

  function armyStepHtml(c, totals) {
    const avail = totals.availableBA;
    const rows = c.units.map((u) => armyUnitCardHtml(c, u, avail)).join('');
    const sum = 'Kampaňová armáda: ' + totals.initialCount + ' ks / ' + totals.initialPoints
      + ' b. · zbývá dostupných ' + avail + ' BA · povýšení celkem: veteráni ' + totals.vetsTotal
      + ' · elitní ' + totals.eliteTotal + ' · hrdinové ' + totals.heroesTotal + '.';

    return `
      <div class="camp-bar">
        <div class="camp-bar-item">
          <span class="camp-bar-label">Výchozí BA</span>
          <input type="number" min="0" class="camp-input" style="width:110px;padding:6px 8px;font-size:14px;" value="${c.startBA || 0}" data-action="setStartBA" data-id="${esc(c.id)}">
        </div>
        <div class="camp-bar-item">
          <span class="camp-bar-label">Utraceno</span>
          <b class="camp-bar-value red">${totals.spentBA} b.</b>
        </div>
        <div class="camp-bar-item">
          <span class="camp-bar-label green">Dostupné BA</span>
          <b class="camp-bar-value green">${avail} b.</b>
        </div>
      </div>
      <p class="camp-note">Nakup jednotky do své kampaňové armády (tlačítko +). Nelze překročit maximum daného typu ani dostupné BA.</p>
      ${c.units.length ? '' : '<p class="camp-note strong">Zatím prázdná soupiska — přidej typy jednotek kartou „Přidat jednotku“ níže, nebo je vezmi z doporučené sestavy.</p>'}
      <div class="camp-units">${rows}</div>
      ${c.units.length ? `<p class="camp-note strong">${esc(sum)}</p>` : ''}`;
  }

  // --- krok „bitva“ -----------------------------------------------------

  const CONDS = [
    { value: 'green', color: C.green, label: 'Vítězství' },
    { value: 'yellow', color: C.yellow, label: 'Remíza' },
    { value: 'red', color: C.red, label: 'Prohra' },
  ];

  function battleBarHtml(c, sc, b, isLast, avail) {
    const scenarioBattles = sc ? sc.battles : [];
    const matchIndex = scenarioBattles.findIndex((sb) => sb.n === b.name);
    const isCustom = matchIndex === -1;
    const nameOptions = scenarioBattles.map((sb, i) =>
      `<option value="${i}"${!isCustom && i === matchIndex ? ' selected' : ''}>${i + 1}. ${esc(sb.n)}</option>`
    ).join('') + `<option value="custom"${isCustom ? ' selected' : ''}>Vlastní název…</option>`;

    const conds = CONDS.map((cd) => {
      const on = b.cond === cd.value;
      const title = cd.value === 'green'
        ? 'Vítězství (zelená) — automaticky ' + Store.VP_WIN + ' VP'
        : (cd.value === 'yellow' ? 'Remíza (žlutá) — VP si doplň sám' : 'Prohra (červená) — VP si doplň sám');
      return `
        <div class="camp-cond${on ? ' on' : ''}" style="--cond-color:${cd.color};">
          <button type="button" title="${esc(title)}" data-action="setBattleCond" data-id="${esc(c.id)}" data-battle="${esc(b.id)}" data-value="${cd.value}">${on ? '✓' : ''}</button>
          <span>${esc(cd.label)}</span>
        </div>`;
    }).join('');

    const vpLocked = !!b.vpAuto;
    return `
      <div class="camp-bar battle">
        <div class="camp-bar-item grow">
          <span class="camp-bar-label">Bitva</span>
          <select class="camp-input sm" data-action="setBattleName" data-id="${esc(c.id)}" data-battle="${esc(b.id)}">${nameOptions}</select>
          ${isCustom ? `<input type="text" class="camp-input sm" value="${esc(b.name)}" placeholder="Název bitvy" data-action="setBattleCustomName" data-id="${esc(c.id)}" data-battle="${esc(b.id)}">` : ''}
          <input type="text" class="camp-input sm" style="width:100px;" value="${esc(b.year)}" placeholder="Rok" data-action="setBattleYear" data-id="${esc(c.id)}" data-battle="${esc(b.id)}">
        </div>
        <div class="camp-bar-item">
          <span class="camp-bar-label">Výsledek bitvy</span>
          <div class="camp-conds">${conds}</div>
        </div>
        <div class="camp-bar-item">
          <span class="camp-bar-label red">Victory Points za bitvu</span>
          <input type="number" min="0" class="camp-input narrow sm${vpLocked ? ' vp-auto' : ''}" value="${b.vp || 0}"${vpLocked ? ' disabled' : ''} data-action="setBattleVp" data-id="${esc(c.id)}" data-battle="${esc(b.id)}">
          <span class="camp-vp-note${vpLocked ? ' auto' : ''}">${vpLocked ? 'Automaticky ' + Store.VP_WIN + ' b. za vyhranou bitvu.' : 'U remízy a prohry doplň body sám.'}</span>
        </div>
        <div class="camp-bar-item">
          <span class="camp-bar-label green">Body armády za bitvu</span>
          <input type="number" min="0" class="camp-input narrow sm" value="${b.ba || 0}" data-action="setBattleBa" data-id="${esc(c.id)}" data-battle="${esc(b.id)}">
        </div>
        ${isLast ? `<button type="button" class="camp-linkbtn" style="align-self:center;" data-action="removeBattle" data-id="${esc(c.id)}" data-battle="${esc(b.id)}">✕ odebrat bitvu</button>` : ''}
      </div>
      <p class="camp-note sm">Výsledek: zelená = vítězství (automaticky ${Store.VP_WIN} VP) · žlutá = remíza · červená = prohra — u remízy a prohry si VP doplň ručně. · Dostupné BA teď: ${avail} b.</p>`;
  }

  function battleUnitCardHtml(c, b, u, index, avail) {
    const info = Store.unitInfo(u.f, u.n);
    const v = info ? info.v : 0;
    const m = info ? info.m : 0;
    const half = Store.halfPrice(v);
    const st = Store.stateAt(c, u.id, index) || {};
    const before = st.before || 0;
    const dmgBefore = st.dmgBefore || 0;

    let stateText, stateColor;
    if (before === 0 && dmgBefore === 0) stateText = 'před bitvou 0 ks — jednotka není v armádě';
    else if (dmgBefore > 0) stateText = 'před bitvou ' + before + ' ks · ' + dmgBefore + ' poškozených';
    else stateText = 'před bitvou ' + before + ' ks';
    if (before === 0) stateColor = C.red;
    else if (dmgBefore > 0) stateColor = C.gold;
    else stateColor = C.muted;

    // Nákupy: strop dle maxima typu i dostupných BA.
    const recruitRoom = st.maxRecruit || 0, restoreRoom = st.maxRestore || 0;
    const canAffordRecruit = avail >= v, canAffordRestore = avail >= half;
    const recruitMax = canAffordRecruit ? recruitRoom : (st.recruit || 0);
    const restoreMax = canAffordRestore ? restoreRoom : (st.restore || 0);

    let recruitHint = 'plná ' + v + ' b./ks', recruitHintClass = '';
    if (recruitRoom === 0) recruitHint = 'plný počet ' + m + ' ks';
    else if (!canAffordRecruit) { recruitHint = 'chybí BA: ' + avail + ' / ' + v + ' b.'; recruitHintClass = 'warn'; }

    let restoreHint = '½ ' + half + ' b./ks', restoreHintClass = '';
    if (restoreRoom === 0) restoreHint = 'nic k obnově';
    else if (!canAffordRestore) { restoreHint = 'chybí BA: ' + avail + ' / ' + half + ' b.'; restoreHintClass = 'warn'; }

    const pv = st.promoBefore || { vets: 0, elite: 0, heroes: 0 };
    // Povýšení: mince drží přenesený součet z předchozích bitev, krokování
    // zapisuje jen změnu (deltu) udělanou v této bitvě.
    const promoStep = (label, accent, key) => {
      const carried = pv[key] || 0;
      const delta = st[key] || 0;
      const total = carried + delta;
      const parts = [];
      if (carried) parts.push('z minula ' + carried);
      if (delta) parts.push((delta > 0 ? '+' : '') + delta + ' zde');
      return stepHtml({
        label: label, accent: accent, value: total,
        canDec: total > 0, canInc: total < m,
        hint: parts.length ? parts.join(' · ') : '± status',
        // data-value nese cílový SOUČET; handler z něj dopočítá deltu.
        data: { action: 'stepPromo', id: c.id, battle: b.id, slot: u.id, field: key, carried: carried },
      });
    };

    const steppers = [
      rowStepHtml(c, b, u.id, 'fielded', 'Nasazeno', C.muted, st.fielded || 0, 0, before, 'do bitvy'),
      rowStepHtml(c, b, u.id, 'lost', 'Ztraceno', C.red, st.lost || 0, 0, Math.max(0, before - (st.damaged || 0)), 'úplně zničeno'),
      rowStepHtml(c, b, u.id, 'damaged', 'Poškozeno', C.gold, st.damaged || 0, 0, Math.max(0, before - (st.lost || 0)), 'částečně / uteklo'),
      promoStep('Veteráni', C.gold, 'vets'),
      promoStep('Elitní', C.dark, 'elite'),
      promoStep('Hrdinové', C.green, 'heroes'),
      rowStepHtml(c, b, u.id, 'recruit', 'Naverbovat', C.green, st.recruit || 0, 0, recruitMax, recruitHint, recruitHintClass),
      rowStepHtml(c, b, u.id, 'restore', 'Obnovit', C.green, st.restore || 0, 0, restoreMax, restoreHint, restoreHintClass),
    ].join('');

    const after = st.after || 0;
    return `
      <div class="camp-unit battle">
        <div class="camp-unit-head">
          <span class="camp-unit-name" title="${esc(statsTitle(u.f, u.n))}">${esc(u.f)} — ${esc(u.n)}</span>
          <span class="camp-unit-state" style="color:${stateColor};">${esc(stateText)}</span>
        </div>
        <span class="camp-unit-promo">Před bitvou: veteráni ${pv.vets} · elitní ${pv.elite} · hrdinové ${pv.heroes} ks · max typu ${m} ks</span>
        <div class="camp-steps">
          ${steppers}
          <div class="camp-step">
            <span class="camp-step-label" style="color:${C.dark};">Zbývá</span>
            <div class="camp-coin auto${after > 0 ? ' pos' : ''}">${after}</div>
            <span class="camp-step-hint auto">automaticky</span>
          </div>
        </div>
      </div>`;
  }

  function battleStepHtml(c, sc, totals, index) {
    const b = c.battles[index];
    if (!b) return '';
    const avail = totals.availableBA;
    const isLast = index === c.battles.length - 1;
    let html = battleBarHtml(c, sc, b, isLast, avail);

    if (!c.units.length) {
      return html + '<p class="camp-note strong">Nejdřív si slož armádu na kroku „Vaše armáda“.</p>';
    }

    html += `<div class="camp-units">${c.units.map((u) => battleUnitCardHtml(c, b, u, index, avail)).join('')}</div>`;

    const pb = totals.perBattle[index];
    const sum = 'Nasazeno ' + pb.fielded + ' ks / ' + pb.fieldedPoints + ' b. · ztraceno ' + pb.lost
      + ' · poškozeno ' + pb.damaged + ' · naverbováno ' + pb.recruit + ' + obnoveno ' + pb.restore
      + ' ks za ' + pb.cost + ' b. · zbývá ' + pb.after + ' ks · změna povýšení: veteráni '
      + (pb.vets > 0 ? '+' : '') + pb.vets + ' · elitní ' + (pb.elite > 0 ? '+' : '') + pb.elite
      + ' · hrdinové ' + (pb.heroes > 0 ? '+' : '') + pb.heroes + ' · zisk VP ' + pb.vp + ' · zisk BA ' + pb.ba + '.';
    html += `<p class="camp-note strong">${esc(sum)}</p>`;
    return html;
  }

  // --- přehled ----------------------------------------------------------

  function overviewHtml(c) {
    const head = ['<th>Jednotka</th>', '<th>Armáda</th>']
      .concat(c.battles.map((b, i) => `<th>B${i + 1}</th>`))
      .concat(['<th>Zbývá</th>']).join('');

    const rows = c.units.map((u) => {
      const w = Store.walk(c, u.id);
      const cells = w.states.map((st) =>
        `<td>${st.fielded} / −${st.lost} / −${st.damaged} / +${st.recruit} / ⟳${st.restore} / ${st.after}</td>`
      ).join('');
      const remain = w.finalOwned + ' ks' + (w.finalDamaged ? ' (+' + w.finalDamaged + ' poš.)' : '');
      return `<tr><td class="unit">${esc(u.f)} — ${esc(u.n)}</td><td>${u.initial || 0}</td>${cells}<td class="remain">${esc(remain)}</td></tr>`;
    }).join('');

    const baCells = c.battles.map((b) => `<td>${b.vp || 0} VP / ${b.ba || 0} BA</td>`).join('');

    return `
      <div class="camp-table-wrap">
        <table class="camp-table">
          <thead><tr>${head}</tr></thead>
          <tbody>
            ${rows || `<tr><td colspan="${3 + c.battles.length}">Zatím žádné jednotky v soupisce.</td></tr>`}
            <tr class="totals"><td>Body kampaně</td><td></td>${baCells}<td></td></tr>
          </tbody>
        </table>
      </div>
      <p class="camp-note sm">Buňka bitvy: nasazeno / −ztraceno / −poškozeno / +naverbováno / ⟳obnoveno / zbývá. Řádek „Body kampaně“: VP / BA získané za bitvu. Úpravy dělej v pohledu „Po krocích“.</p>`;
  }

  // --- průběh kampaně (krokový vs. přehledový pohled) -------------------

  function progressCardHtml(c, sc, totals, active) {
    const view = ui.logView[c.id] || 'battles';
    const battlesView = view === 'battles';

    let chips = `<button type="button" class="camp-chip${active === -1 ? ' active' : ''}" data-action="setActiveBattle" data-id="${esc(c.id)}" data-value="-1">Vaše armáda</button>`;
    c.battles.forEach((b, i) => {
      chips += `<button type="button" class="camp-chip${active === i ? ' active' : ''}" data-action="setActiveBattle" data-id="${esc(c.id)}" data-value="${i}">B${i + 1}</button>`;
    });
    if (c.battles.length < MAX_BATTLES) {
      chips += `<button type="button" class="camp-chip add" title="Přidat bitvu" data-action="addBattle" data-id="${esc(c.id)}">+</button>`;
    }

    const stepBody = battlesView
      ? `<div class="camp-chips">${chips}</div>` + (active === -1 ? armyStepHtml(c, totals) : battleStepHtml(c, sc, totals, active))
      : overviewHtml(c);

    return `
      <div class="camp-card red">
        <div class="camp-card-head">
          <h3>Průběh kampaně</h3>
          <div style="display:flex;gap:6px;">
            <button type="button" class="camp-btn sm${battlesView ? ' gold' : ''}" data-action="setLogView" data-id="${esc(c.id)}" data-value="battles">Po krocích</button>
            <button type="button" class="camp-btn sm${battlesView ? '' : ' gold'}" data-action="setLogView" data-id="${esc(c.id)}" data-value="overview">Přehled</button>
          </div>
        </div>
        ${stepBody}
      </div>`;
  }

  // --- nástroje složení armády (jen na kroku „Vaše armáda“) -------------

  function addUnitCardHtml(c) {
    const sd = Store.sideDef(c);
    if (!sd || !sd.factions.length) return '';
    const a = ensureAddUnitState(c);
    const units = availableUnitsForFaction(c, a.faction);
    const selU = units.find((u) => u.n === a.name);
    const factionOptions = sd.factions.map((fac) =>
      `<option value="${esc(fac)}"${fac === a.faction ? ' selected' : ''}>${esc(fac)}</option>`
    ).join('');
    const unitOptions = units.length
      ? units.map((u) => `<option value="${esc(u.n)}"${u.n === a.name ? ' selected' : ''}>${esc(u.n)} (${u.v} b., max ${u.m})</option>`).join('')
      : '<option value="">— vše už v soupisce —</option>';
    const stats = selU ? statRows(selU.f, selU.n) : [];

    return `
      <div class="camp-card green add-unit">
        <h3>Přidat jednotku</h3>
        <div class="camp-field">
          <span class="camp-label" style="font-size:12px;">Frakce</span>
          <select data-action="setAddUnitFaction" data-id="${esc(c.id)}">${factionOptions}</select>
        </div>
        <div class="camp-field">
          <span class="camp-label" style="font-size:12px;">Jednotka</span>
          <select data-action="setAddUnitName" data-id="${esc(c.id)}"${units.length ? '' : ' disabled'}>${unitOptions}</select>
          <span class="camp-hint">${selU ? 'Hodnota ' + selU.v + ' b., max ' + selU.m + ' ks.' : ''}</span>
        </div>
        ${stats.length ? `
        <div class="camp-statbox">
          <span>Vlastnosti jednotky</span>
          <div class="camp-statgrid">
            ${stats.map((s) => `<div><b>${esc(s.v)}</b><span>${esc(s.label)}</span></div>`).join('')}
          </div>
        </div>` : (selU ? '<span class="camp-hint">Pro tuto frakci nemá nahraná tabulka rozpis vlastností — hodnoty najdeš na kartě jednotky.</span>' : '')}
        <button type="button" class="camp-btn green" data-action="addUnitSlot" data-id="${esc(c.id)}"${selU ? '' : ' disabled'}>+ Přidat typ do soupisky</button>
        <span class="camp-hint">Přidá typ s 0 ks — kusy pak dokoupíš tlačítkem + u jednotky.</span>
      </div>`;
  }

  function recommendedCardHtml(c, sc, avail) {
    if (!sc) return '';
    const indices = sc.battles.map((_, i) => i).filter((i) => Store.recommendedFor(c.scenarioId, i, c.sideName));
    if (!indices.length) return '';
    const st = ensurePrefillState(c);
    if (indices.indexOf(st.battleIndex) === -1) st.battleIndex = indices[0];
    const list = Store.recommendedFor(c.scenarioId, st.battleIndex, c.sideName) || [];
    const options = indices.map((i) =>
      `<option value="${i}"${i === st.battleIndex ? ' selected' : ''}>${i + 1}. ${esc(sc.battles[i].n)}</option>`
    ).join('');

    const rows = list.map(([f, n, cnt]) => {
      const info = Store.unitInfo(f, n);
      const slot = c.units.find((u) => u.f === f && u.n === n);
      const cur = slot ? (slot.initial || 0) : 0;
      const max = info ? info.m : 0;
      const price = info ? info.v : 0;
      const atMax = cur >= max;
      const afford = avail >= price;
      const can = !atMax && afford;
      const title = atMax ? 'Dosažen maximální počet' : (afford ? 'Přidat 1 ks za ' + price + ' b.' : 'Nedostatek BA');
      return `
        <div class="camp-rec-row${cur > 0 ? ' owned' : ''}">
          <span>${esc(n)} ×${cnt} (${price} b., v armádě ${cur}/${max})</span>
          <button type="button" class="${can ? 'can' : ''}" title="${esc(title)}"${can ? '' : ' disabled'} data-action="recAdd" data-id="${esc(c.id)}" data-faction="${esc(f)}" data-unit="${esc(n)}">${atMax ? 'max' : '+ 1 ks'}</button>
        </div>`;
    }).join('');

    return `
      <div class="camp-card gold recommended">
        <h3>Doporučená sestava</h3>
        <select data-action="setRecommendedBattle" data-id="${esc(c.id)}">${options}</select>
        <p class="camp-note sm">Zobrazená sestava — přidávej z ní do armády jednotlivě (tlačítkem u řádku). Cena se odečte z dostupných BA.</p>
        <div class="camp-rec-rows">${rows}</div>
      </div>`;
  }

  function renderCampaignView(id) {
    const c = Store.get(id);
    if (!c) {
      root.innerHTML = shell('list',
        headerHtml('Kampaň nenalezena', 'Tato kampaň neexistuje nebo byla smazána.', true),
        '<div class="camp-card red"><p class="camp-note">Vrať se na seznam kampaní a vyber jinou.</p></div>');
      return;
    }

    const sc = Store.scenario(c);
    const totals = Store.totals(c);
    const active = activeStep(c);
    const subtitle = (sc ? esc(sc.name) + ' (' + esc(sc.period) + ')' : 'Scénář nenalezen')
      + ' — strana ' + esc(c.sideName) + (sc && sc.note ? ' · ' + esc(sc.note) : '');

    let body = summaryCardHtml(c, totals) + progressCardHtml(c, sc, totals, active);
    if (active === -1 && (ui.logView[c.id] || 'battles') === 'battles') {
      const tools = addUnitCardHtml(c) + recommendedCardHtml(c, sc, totals.availableBA);
      if (tools) body += `<div class="camp-tools">${tools}</div>`;
    }

    root.innerHTML = shell('list', headerHtml(c.name || (sc ? sc.name : 'Kampaň'), subtitle, true), body);
  }

  // ---------------------------------------------------------------------
  // Stavitel armády (#/builder) — jen deleguje na window.ArmyBuilder
  // ---------------------------------------------------------------------

  function renderBuilderView(campaignId) {
    const campaign = campaignId ? Store.get(campaignId) : null;
    const notice = campaignId && !campaign
      ? '<div class="card accent-red"><p>Kampaň s tímto ID nebyla nalezena — stavitel poběží bez vazby na kampaň.</p></div>'
      : '';

    const body = `<div class="content">${notice}<div id="armybuilder-mount"></div></div>`;
    root.innerHTML = shell('builder',
      headerHtml('ONUS! — Stavitel armády', 'Sestav armádu podle rozpočtu a ulož si soupisku jako PDF.', false),
      body);

    const mount = document.getElementById('armybuilder-mount');
    if (window.ArmyBuilder && typeof window.ArmyBuilder.render === 'function') {
      try {
        window.ArmyBuilder.render(mount, { campaignId: campaign ? campaignId : undefined, embedded: true });
      } catch (err) {
        mount.innerHTML = '<div class="card accent-red"><h3 class="serif">Modul se nepodařilo načíst</h3><p>Stavitel armády narazil na chybu při spuštění.</p></div>';
        if (window.console && console.error) console.error('ArmyBuilder.render selhal:', err);
      }
    } else {
      mount.innerHTML = '<div class="card accent-red"><h3 class="serif">Modul se nepodařilo načíst</h3><p>Stavitel armády (army-builder.js) není momentálně k dispozici.</p></div>';
    }
  }

  // ---------------------------------------------------------------------
  // Render dispatch
  // ---------------------------------------------------------------------

  function render() {
    const scrollY = window.scrollY;
    const route = parseHash();
    if (route.view === 'campaign') renderCampaignView(route.id);
    else if (route.view === 'builder') renderBuilderView(route.campaignId);
    else renderList();
    // Překreslujeme celý strom — zachovej pozici stránky, ať krokování
    // jednotek neposkakuje.
    if (window.scrollY !== scrollY) window.scrollTo(0, scrollY);
  }

  // ---------------------------------------------------------------------
  // Akce nad store (mutace + persist + rerender)
  // ---------------------------------------------------------------------

  function persist(c) { Store.update(c); render(); }

  function doCreateCampaign() {
    const f = ensureNewCampaignState();
    const sc = D.campaigns.find((s) => s.id === f.scenarioId);
    if (!sc) return;
    const c = Store.create({
      name: f.name.trim() || sc.name,
      scenarioId: f.scenarioId,
      sideName: f.sideName,
      startBA: f.startBA,
    });
    ui.newCampaign = null;
    ui.showNewForm = false;
    ui.activeBattle[c.id] = -1;
    navigate('#/campaign/' + encodeURIComponent(c.id));
  }

  function doDeleteCampaign(id) {
    const c = Store.get(id);
    if (!c) return;
    if (!window.confirm('Opravdu smazat kampaň „' + (c.name || '') + '“? Tuto akci nelze vrátit zpět.')) return;
    Store.remove(id);
    render();
  }

  function doAddBattle(cid) {
    const c = Store.get(cid); if (!c) return;
    if (c.battles.length >= MAX_BATTLES) return;
    const sc = Store.scenario(c);
    const next = sc ? sc.battles[c.battles.length] : null;
    Store.addBattle(c, next ? next.n : '', next ? next.y : '');
    Store.update(c);
    ui.activeBattle[cid] = c.battles.length - 1;
    ui.logView[cid] = 'battles';
    render();
  }

  function doRemoveBattle(cid, bid) {
    const c = Store.get(cid); if (!c) return;
    const last = c.battles[c.battles.length - 1];
    if (!last || last.id !== bid) return;
    if (!window.confirm('Odebrat poslední bitvu „' + (last.name || '(bez názvu)') + '“ včetně zadaných hodnot?')) return;
    Store.removeBattle(c, bid);
    Store.update(c);
    ui.activeBattle[cid] = c.battles.length ? c.battles.length - 1 : -1;
    render();
  }

  function doSetBattleCond(cid, bid, value) {
    const c = Store.get(cid); if (!c) return;
    const b = c.battles.find((x) => x.id === bid); if (!b) return;
    b.cond = (b.cond === value) ? '' : value;
    if (b.cond === 'green') { b.vp = Store.VP_WIN; b.vpAuto = true; }
    else if (b.vpAuto) { b.vp = 0; b.vpAuto = false; }
    persist(c);
  }

  function doSetInitial(cid, slotId, n) {
    const c = Store.get(cid); if (!c) return;
    const slot = c.units.find((u) => u.id === slotId); if (!slot) return;
    const info = Store.unitInfo(slot.f, slot.n);
    const max = info ? info.m : 0;
    slot.initial = Math.max(0, Math.min(max, n));
    persist(c);
  }

  function doSetRowField(cid, bid, slotId, field, val) {
    const c = Store.get(cid); if (!c) return;
    const b = c.battles.find((x) => x.id === bid); if (!b) return;
    Store.row(b, slotId)[field] = (val == null ? null : val);
    persist(c);
  }

  function doRemoveUnitSlot(cid, slotId) {
    const c = Store.get(cid); if (!c) return;
    const slot = c.units.find((u) => u.id === slotId); if (!slot) return;
    if (!window.confirm('Odebrat jednotku „' + slot.f + ' — ' + slot.n + '“ ze soupisky? Smažou se i její záznamy ve všech bitvách.')) return;
    Store.removeUnit(c, slotId);
    persist(c);
  }

  function doAddUnitSlot(cid) {
    const c = Store.get(cid); if (!c) return;
    const a = ensureAddUnitState(c);
    if (!a.faction || !a.name) return;
    if (c.units.some((u) => u.f === a.faction && u.n === a.name)) return;
    Store.addUnit(c, a.faction, a.name, 0);
    Store.update(c);
    delete ui.addUnit[cid];
    render();
  }

  // Přidá jeden ks doporučené jednotky do kampaňové armády — v mezích
  // maxima typu i dostupných BA.
  function doAddRecommended(cid, f, n) {
    const c = Store.get(cid); if (!c) return;
    const info = Store.unitInfo(f, n); if (!info) return;
    let slot = c.units.find((u) => u.f === f && u.n === n);
    const cur = slot ? (slot.initial || 0) : 0;
    if (cur >= info.m) return;
    if (Store.availableBA(c) < info.v) return;
    if (!slot) slot = Store.addUnit(c, f, n, 0);
    slot.initial = cur + 1;
    persist(c);
  }

  function doDownloadPdf(id) {
    if (window.OnusPDF && typeof window.OnusPDF.exportCampaign === 'function') {
      window.OnusPDF.exportCampaign(id);
    }
  }

  // ---------------------------------------------------------------------
  // Delegace událostí. Klik/change uvnitř #armybuilder-mount ignorujeme —
  // ten kontejner si spravuje výhradně window.ArmyBuilder (vlastní modul).
  // ---------------------------------------------------------------------

  function isForeignTarget(el) { return !!el.closest('#armybuilder-mount'); }

  function handleClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el || isForeignTarget(el)) return;
    const ds = el.dataset;
    switch (ds.action) {
      case 'nav': navigate(ds.href); break;
      case 'gotoList': navigate('#/'); break;
      case 'gotoBuilder': navigate('#/builder?campaign=' + encodeURIComponent(ds.id)); break;
      case 'openCampaign': navigate('#/campaign/' + encodeURIComponent(ds.id)); break;
      case 'toggleNewForm': ui.showNewForm = !ui.showNewForm; render(); break;
      case 'nfSide': { const f = ensureNewCampaignState(); f.sideName = ds.value; render(); break; }
      case 'createCampaign': doCreateCampaign(); break;
      case 'deleteCampaign': doDeleteCampaign(ds.id); break;
      case 'campDownloadPdf': doDownloadPdf(ds.id); break;
      case 'setLogView': ui.logView[ds.id] = ds.value; render(); break;
      case 'setActiveBattle': ui.activeBattle[ds.id] = Number(ds.value); render(); break;
      case 'addBattle': doAddBattle(ds.id); break;
      case 'removeBattle': doRemoveBattle(ds.id, ds.battle); break;
      case 'setBattleCond': doSetBattleCond(ds.id, ds.battle, ds.value); break;
      case 'stepInitial': doSetInitial(ds.id, ds.slot, Number(ds.value)); break;
      case 'stepRow': doSetRowField(ds.id, ds.battle, ds.slot, ds.field, Math.max(0, Number(ds.value))); break;
      case 'stepPromo': doSetRowField(ds.id, ds.battle, ds.slot, ds.field, Number(ds.value) - Number(ds.carried)); break;
      case 'removeUnitSlot': doRemoveUnitSlot(ds.id, ds.slot); break;
      case 'addUnitSlot': doAddUnitSlot(ds.id); break;
      case 'recAdd': doAddRecommended(ds.id, ds.faction, ds.unit); break;
      default: break;
    }
  }

  function handleChange(e) {
    const el = e.target.closest('[data-action]');
    if (!el || isForeignTarget(el)) return;
    const ds = el.dataset;
    const c = ds.id ? Store.get(ds.id) : null;
    const battle = (c && ds.battle) ? c.battles.find((x) => x.id === ds.battle) : null;

    switch (ds.action) {
      case 'nfScenario': {
        const f = ensureNewCampaignState();
        f.scenarioId = el.value;
        const sc = D.campaigns.find((s) => s.id === f.scenarioId);
        f.sideName = sc ? sc.sides[0].name : '';
        render();
        break;
      }
      case 'nfStartBA': { const f = ensureNewCampaignState(); f.startBA = Math.max(0, intOr(el.value, 0)); break; }
      case 'nfName': { const f = ensureNewCampaignState(); f.name = el.value; break; }

      case 'setStartBA': if (c) { c.startBA = Math.max(0, intOr(el.value, 0)); persist(c); } break;

      case 'setBattleName': {
        if (!c || !battle) break;
        const sc = Store.scenario(c);
        if (el.value === 'custom') {
          if (sc && sc.battles.some((sb) => sb.n === battle.name)) battle.name = '';
        } else if (sc) {
          const idx = Number(el.value);
          if (sc.battles[idx]) { battle.name = sc.battles[idx].n; battle.year = sc.battles[idx].y; }
        }
        persist(c);
        break;
      }
      case 'setBattleCustomName': if (c && battle) { battle.name = el.value; persist(c); } break;
      case 'setBattleYear': if (c && battle) { battle.year = el.value; persist(c); } break;
      case 'setBattleVp':
        if (c && battle && !battle.vpAuto) { battle.vp = Math.max(0, intOr(el.value, 0)); persist(c); }
        break;
      case 'setBattleBa': if (c && battle) { battle.ba = Math.max(0, intOr(el.value, 0)); persist(c); } break;

      case 'setAddUnitFaction': {
        if (!c) break;
        const a = ensureAddUnitState(c);
        a.faction = el.value;
        const units = availableUnitsForFaction(c, a.faction);
        a.name = units.length ? units[0].n : '';
        render();
        break;
      }
      case 'setAddUnitName': { if (!c) break; ensureAddUnitState(c).name = el.value; render(); break; }
      case 'setRecommendedBattle': { if (!c) break; ensurePrefillState(c).battleIndex = Number(el.value); render(); break; }
      default: break;
    }
  }

  root.addEventListener('click', handleClick);
  root.addEventListener('change', handleChange);
  window.addEventListener('hashchange', render);

  render();

  // campaign.js běží synchronně, dřív než defer skripty (pdf-export.js apod.)
  // — po jejich doběhnutí ještě jednou překreslíme, ať stav tlačítka
  // „Stáhnout PDF“ na hard reload / přímém odkazu sedí.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    window.setTimeout(render, 0);
  }

})();

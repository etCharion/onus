// ONUS! — Správa kampaní: hlavní aplikace stránky campaign.html.
// Hash router (#/, #/campaign/<id>, #/builder), seznam kampaní, digitální
// Campaign Log Sheet a záložka Stavitel (deleguje na window.ArmyBuilder).
(function () {
  'use strict';

  const root = document.getElementById('app');
  const D = window.ONUS_DATA;
  const Store = window.OnusStore;

  const colors = {
    red: '#8c2a22', redLight: '#c96a5c',
    green: '#2f5d3a', greenLight: '#5f9a6c',
    gold: '#9c7327', goldLight: '#e3c26a',
  };

  const COND_ORDER = ['', 'ok', 'worn', 'destroyed'];
  const COND_COLOR = { '': '#e8ddbe', ok: colors.green, worn: colors.gold, destroyed: colors.red };
  const COND_TITLE = {
    '': 'Kondice: nezadáno (klikni pro nastavení)',
    ok: 'Kondice: v pořádku (klikni pro změnu)',
    worn: 'Kondice: oslabená (klikni pro změnu)',
    destroyed: 'Kondice: zničená (klikni pro vynulování)',
  };

  // Nepersistovaný stav formulářů (mezi rendery přežívá, ale nikoli reload).
  const ui = {
    showNewForm: false,
    newCampaign: null,     // { scenarioId, sideName, name, prefill, prefillBattleIndex }
    addUnit: {},            // campaignId -> { faction, name, count }
    prefill: {},            // campaignId -> { battleIndex }
  };

  function esc(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function parseIntOrNull(v) {
    if (v === '' || v === null || v === undefined) return null;
    const n = parseInt(v, 10);
    return isNaN(n) ? null : n;
  }

  function clampCount(v) {
    const n = parseIntOrNull(v);
    return n === null ? null : Math.max(0, n);
  }

  // ---------------------------------------------------------------------
  // Router
  // ---------------------------------------------------------------------

  function parseHash() {
    let h = window.location.hash || '#/';
    h = h.replace(/^#/, '');
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
    if (parts[0] === 'campaign' && parts[1]) {
      return { view: 'campaign', id: decodeURIComponent(parts[1]) };
    }
    if (parts[0] === 'builder') {
      return { view: 'builder', campaignId: query.campaign || undefined };
    }
    return { view: 'list' };
  }

  function navigate(hash) {
    if (window.location.hash === hash) render();
    else window.location.hash = hash;
  }

  // ---------------------------------------------------------------------
  // Malé UI pomocníky (styl podle app.js)
  // ---------------------------------------------------------------------

  function shell(active, headerHtml, bodyHtml) {
    return `
      <section class="page">
        ${headerHtml}
        <div class="sticky-bar">
          <div class="tabs">
            <button type="button" class="tab-btn${active === 'list' ? ' active' : ''}" data-action="nav" data-href="#/">Kampaně</button>
            <button type="button" class="tab-btn${active === 'builder' ? ' active' : ''}" data-action="nav" data-href="#/builder">Stavitel armády</button>
          </div>
        </div>
        ${bodyHtml}
      </section>`;
  }

  function toggleRow(label, active, action, dataAttrs, ringKey) {
    ringKey = ringKey || 'green';
    const ring = colors[ringKey], ringLight = colors[ringKey + 'Light'];
    const tokenBg = active ? `radial-gradient(circle at 35% 30%, ${ringLight}, ${ring})` : '#fbf6e6';
    const tokenBorder = active ? `2px solid ${ring}` : '1px solid #ddcda0';
    const attrs = Object.keys(dataAttrs || {}).map((k) => `data-${k}="${esc(dataAttrs[k])}"`).join(' ');
    return `
      <div class="mod-row" data-action="${esc(action)}" ${attrs}>
        <span class="mod-label">${esc(label)}</span>
        <div class="token" style="background:${tokenBg};border:${tokenBorder};">
          <span class="token-check" style="opacity:${active ? 1 : 0};">✓</span>
        </div>
      </div>`;
  }

  function choiceBtnStyled(label, active, accentKey, dataAttrs) {
    const c = colors[accentKey];
    const bg = active ? c : '#fff';
    const color = active ? '#fff' : '#6b5c46';
    const border = active ? c : '#ddcda0';
    const attrs = Object.keys(dataAttrs || {}).map((k) => `data-${k}="${esc(dataAttrs[k])}"`).join(' ');
    return `<button type="button" class="choice-btn log-result-btn" style="background:${bg};color:${color};border-color:${border};" ${attrs}>${esc(label)}</button>`;
  }

  // ---------------------------------------------------------------------
  // Seznam kampaní (#/)
  // ---------------------------------------------------------------------

  function ensureNewCampaignState() {
    if (!ui.newCampaign) {
      const sc = D.campaigns[0];
      ui.newCampaign = {
        scenarioId: sc.id,
        sideName: sc.sides[0].name,
        name: '',
        prefill: false,
        prefillBattleIndex: 0,
      };
    }
    return ui.newCampaign;
  }

  function campaignCardHtml(c) {
    const sc = Store.scenario(c);
    const totals = Store.totals(c);
    const played = c.battles.filter((b) => b.result).length;
    return `
      <div class="card accent-gold campaign-card">
        <div class="campaign-card-head">
          <h3 class="serif">${esc(c.name || (sc ? sc.name : 'Kampaň'))}</h3>
        </div>
        <p class="hint">${sc ? esc(sc.name) + ' · ' + esc(sc.period) : 'Scénář nenalezen'} — strana <b>${esc(c.sideName)}</b></p>
        <div class="campaign-card-stats">
          <div><b>${played}/${c.battles.length}</b><span>bitev odehráno</span></div>
          <div><b>${totals.remainingCount}</b><span>jednotek zbývá</span></div>
          <div><b>${totals.remainingPoints}</b><span>bodů zbývá</span></div>
          <div><b>${totals.vpTotal}</b><span>VP celkem</span></div>
        </div>
        <div class="campaign-card-actions">
          <button type="button" class="choice-btn wide" data-action="openCampaign" data-id="${esc(c.id)}">Otevřít</button>
          <button type="button" class="choice-btn wide" data-action="deleteCampaign" data-id="${esc(c.id)}">Smazat</button>
        </div>
      </div>`;
  }

  function newCampaignFormHtml() {
    const f = ensureNewCampaignState();
    const sc = D.campaigns.find((s) => s.id === f.scenarioId) || D.campaigns[0];
    const hasRecommended = !!D.recommended[sc.id];
    const scenarioOptions = D.campaigns.map((s) =>
      `<option value="${esc(s.id)}"${s.id === sc.id ? ' selected' : ''}>${esc(s.name)} (${esc(s.period)})</option>`
    ).join('');
    const sideOptions = sc.sides.map((sd) =>
      `<option value="${esc(sd.name)}"${sd.name === f.sideName ? ' selected' : ''}>${esc(sd.name)}</option>`
    ).join('');
    const battleOptions = sc.battles.map((b, i) =>
      `<option value="${i}"${i === f.prefillBattleIndex ? ' selected' : ''}>${i + 1}. ${esc(b.n)} (${esc(b.y)})</option>`
    ).join('');

    return `
      <div class="card accent-green gap-14" id="new-campaign-form">
        <h3 class="serif">Nová kampaň</h3>
        <div class="field">
          <label class="choice-label">Scénář</label>
          <select data-action="campSetScenario">${scenarioOptions}</select>
          <span class="hint">${esc(sc.period)} · ${sc.battles.length} bitev v tabulce scénářů</span>
        </div>
        <div class="field">
          <label class="choice-label">Strana</label>
          <select data-action="campSetSide">${sideOptions}</select>
        </div>
        <div class="field">
          <label class="choice-label">Vlastní název kampaně (nepovinné)</label>
          <input type="text" data-action="setName" value="${esc(f.name)}" placeholder="${esc(sc.name)}">
        </div>
        ${hasRecommended ? `
        <div class="field">
          ${toggleRow('Předvyplnit doporučenou armádu', f.prefill, 'togglePrefill', {}, 'green')}
          ${f.prefill ? `
            <select data-action="setPrefillBattle">${battleOptions}</select>
            <span class="hint">Doporučená sestava pro vybranou bitvu se stane výchozí armádou kampaně.</span>
          ` : ''}
        </div>` : ''}
        <button type="button" class="choice-btn wide" data-action="createCampaign">Založit kampaň</button>
      </div>`;
  }

  function renderList() {
    const campaigns = Store.list();
    const headerHtml = `
      <div class="header">
        <h1 class="serif">ONUS! — Správa kampaní</h1>
        <div class="divider"></div>
        <p>Digitální Campaign Log Sheet: založ kampaň, veď záznamy bitev a sestavuj armády.</p>
      </div>`;

    let body = '';
    if (campaigns.length === 0) {
      body += `
        <div class="card accent-gold">
          <h3 class="serif">Zatím žádná kampaň</h3>
          <p class="grid-note">Založ svou první kampaň — vyber scénář a stranu a spravuj bitvy jako v papírovém Campaign Log Sheetu.</p>
        </div>`;
      body += newCampaignFormHtml();
    } else {
      body += campaigns.map(campaignCardHtml).join('');
      body += `<button type="button" class="choice-btn wide" data-action="toggleNewForm">${ui.showNewForm ? '− Skrýt formulář' : '+ Nová kampaň'}</button>`;
      if (ui.showNewForm) body += newCampaignFormHtml();
    }

    root.innerHTML = shell('list', headerHtml, `<div class="content">${body}</div>`);
  }

  // ---------------------------------------------------------------------
  // Detail kampaně (#/campaign/<id>)
  // ---------------------------------------------------------------------

  function ensureAddUnitState(c) {
    if (!ui.addUnit[c.id]) {
      const sd = Store.sideDef(c);
      const faction = sd && sd.factions.length ? sd.factions[0] : '';
      const units = D.units.filter((u) => u.f === faction);
      ui.addUnit[c.id] = { faction: faction, name: units.length ? units[0].n : '', count: 1 };
    }
    return ui.addUnit[c.id];
  }

  function ensurePrefillState(c) {
    if (!ui.prefill[c.id]) ui.prefill[c.id] = { battleIndex: 0 };
    return ui.prefill[c.id];
  }

  function condBtnHtml(c, b, slotId) {
    const r = b.rows[slotId];
    const cond = r ? (r.cond || '') : '';
    return `<button type="button" class="log-cond" style="background:${COND_COLOR[cond]};" data-action="cycleCond" data-id="${esc(c.id)}" data-battle="${esc(b.id)}" data-slot="${esc(slotId)}" title="${esc(COND_TITLE[cond])}"></button>`;
  }

  function battleHeaderHtml(c, sc, b, idx) {
    const isLast = idx === c.battles.length - 1;
    const scenarioBattles = sc ? sc.battles : [];
    const matchIndex = scenarioBattles.findIndex((sb) => sb.n === b.name);
    const isCustom = matchIndex === -1;
    const options = scenarioBattles.map((sb, i) =>
      `<option value="${i}"${!isCustom && i === matchIndex ? ' selected' : ''}>${i + 1}. ${esc(sb.n)}</option>`
    ).join('');
    const customOption = `<option value="custom"${isCustom ? ' selected' : ''}>Vlastní název…</option>`;

    return `
      <th class="log-th-battle">
        <div class="log-battle-head">
          <select class="log-battle-select" data-action="setBattleName" data-id="${esc(c.id)}" data-battle="${esc(b.id)}">
            ${options}${customOption}
          </select>
          ${isCustom ? `<input type="text" class="log-input log-battle-custom" data-action="setBattleCustomName" data-id="${esc(c.id)}" data-battle="${esc(b.id)}" value="${esc(b.name)}" placeholder="Název bitvy">` : ''}
          <input type="text" class="log-input log-battle-year" data-action="setBattleYear" data-id="${esc(c.id)}" data-battle="${esc(b.id)}" value="${esc(b.year)}" placeholder="Rok">
        </div>
        <div class="log-battle-result">
          ${choiceBtnStyled('V', b.result === 'win', 'green', { action: 'setBattleResult', id: c.id, battle: b.id, value: 'win' })}
          ${choiceBtnStyled('R', b.result === 'draw', 'gold', { action: 'setBattleResult', id: c.id, battle: b.id, value: 'draw' })}
          ${choiceBtnStyled('P', b.result === 'loss', 'red', { action: 'setBattleResult', id: c.id, battle: b.id, value: 'loss' })}
        </div>
        <div class="log-battle-vp">
          <label>VP</label>
          <input type="number" class="log-input log-battle-vp-input" data-action="setBattleVp" data-id="${esc(c.id)}" data-battle="${esc(b.id)}" value="${b.vp === null || b.vp === undefined ? '' : b.vp}">
        </div>
        ${isLast ? `<button type="button" class="log-battle-remove" data-action="removeBattle" data-id="${esc(c.id)}" data-battle="${esc(b.id)}" title="Odebrat poslední bitvu">✕ odebrat</button>` : ''}
      </th>`;
  }

  function unitRowHtml(c, u, battles) {
    const info = Store.unitInfo(u.f, u.n);
    const v = info ? info.v : 0;
    const m = info ? info.m : 0;
    const initial = u.initial || 0;
    const over = initial > m;
    const cells = battles.map((b) => {
      const r = b.rows[u.id] || { fielded: null, lost: null, cond: '' };
      return `
        <td class="log-td-battle">
          <div class="log-cell-inputs">
            <input type="number" min="0" class="log-input" placeholder="N" title="Nasazeno" value="${r.fielded === null || r.fielded === undefined ? '' : r.fielded}" data-action="setFielded" data-id="${esc(c.id)}" data-battle="${esc(b.id)}" data-slot="${esc(u.id)}">
            <input type="number" min="0" class="log-input" placeholder="Z" title="Ztráty" value="${r.lost === null || r.lost === undefined ? '' : r.lost}" data-action="setLost" data-id="${esc(c.id)}" data-battle="${esc(b.id)}" data-slot="${esc(u.id)}">
          </div>
          ${condBtnHtml(c, b, u.id)}
        </td>`;
    }).join('');
    const remain = Store.remaining(c, u.id);
    return `
      <tr>
        <td class="sticky-col log-td-unit">
          <span class="log-unit-name">${esc(u.f)} — ${esc(u.n)}</span>
          <button type="button" class="log-unit-remove" data-action="removeUnitSlot" data-id="${esc(c.id)}" data-slot="${esc(u.id)}" title="Odebrat jednotku ze soupisky">✕</button>
        </td>
        <td class="log-td-num">${v}</td>
        <td class="log-td-num">${m}</td>
        <td class="log-td-initial${over ? ' log-td-over' : ''}">
          <input type="number" min="0" class="log-input log-input-initial" title="Počet ve výchozí armádě" value="${initial}" data-action="setInitial" data-id="${esc(c.id)}" data-slot="${esc(u.id)}">
          <span class="log-points">${initial * v} b.</span>
        </td>
        ${cells}
        <td class="log-td-num log-td-remain">${remain} ks<br>${remain * v} b.</td>
      </tr>`;
  }

  function sumRowHtml(c, totals) {
    const perBattleCells = totals.perBattle.map((pb) =>
      `<td class="log-td-num">${pb.fielded} ks / ${pb.fieldedPoints} b.<br>−${pb.lost} ks ztrát</td>`
    ).join('');
    return `
      <tr class="log-sum-row">
        <td class="sticky-col">Součty</td>
        <td></td><td></td>
        <td class="log-td-num">${totals.initialCount} ks / ${totals.initialPoints} b.</td>
        ${perBattleCells}
        <td class="log-td-num">${totals.remainingCount} ks / ${totals.remainingPoints} b.</td>
      </tr>`;
  }

  function renderLogSection(c, sc) {
    const totals = Store.totals(c);
    const battles = c.battles;
    const canAddBattle = battles.length < 8;
    const colCount = 4 + battles.length + 1;

    const theadBattles = battles.map((b, i) => battleHeaderHtml(c, sc, b, i)).join('');
    const theadRow = `
      <tr>
        <th class="sticky-col log-th-unit">Jednotka</th>
        <th>Hodnota</th>
        <th>Max</th>
        <th>Výchozí armáda</th>
        ${theadBattles}
        <th>Zbývá</th>
      </tr>`;

    const bodyRows = c.units.length
      ? c.units.map((u) => unitRowHtml(c, u, battles)).join('')
      : `<tr class="log-empty-row"><td class="sticky-col" colspan="${colCount}">Zatím žádné jednotky v soupisce — přidej je níže.</td></tr>`;

    const sumRow = c.units.length ? sumRowHtml(c, totals) : '';

    return `
      <div class="log-section">
        <div class="card accent-gold log-card">
          <h3 class="serif">Log kampaně</h3>
          <p class="hint">Nasazeno / Ztráty za bitvu, kondice (klikni na tečku: prázdná → OK → oslabená → zničená).</p>
          <div class="log-table-wrap">
            <table class="log-table">
              <thead>${theadRow}</thead>
              <tbody>${bodyRows}</tbody>
              ${sumRow ? `<tfoot>${sumRow}</tfoot>` : ''}
            </table>
          </div>
          <div class="log-toolbar">
            <button type="button" class="choice-btn wide" data-action="addBattle" data-id="${esc(c.id)}"${canAddBattle ? '' : ' disabled'}>+ Přidat bitvu</button>
            ${!canAddBattle ? '<span class="hint">Maximálně 8 bitev (jako v sešitu Campaign Log).</span>' : `<span class="hint">${battles.length} / 8 bitev</span>`}
          </div>
        </div>
      </div>`;
  }

  function renderAddUnitForm(c) {
    const sd = Store.sideDef(c);
    if (!sd || !sd.factions.length) return '';
    const f = ensureAddUnitState(c);
    const factionOptions = sd.factions.map((fac) =>
      `<option value="${esc(fac)}"${fac === f.faction ? ' selected' : ''}>${esc(fac)}</option>`
    ).join('');
    const units = D.units.filter((u) => u.f === f.faction);
    const unitOptions = units.map((u) =>
      `<option value="${esc(u.n)}"${u.n === f.name ? ' selected' : ''}>${esc(u.n)} (${u.v} b., max ${u.m})</option>`
    ).join('');
    const selectedUnit = units.find((u) => u.n === f.name);
    return `
      <div class="card accent-green">
        <h3 class="serif">Přidat jednotku</h3>
        <div class="field">
          <label class="choice-label">Frakce</label>
          <select data-action="setAddUnitFaction" data-id="${esc(c.id)}">${factionOptions}</select>
        </div>
        <div class="field">
          <label class="choice-label">Jednotka</label>
          <select data-action="setAddUnitName" data-id="${esc(c.id)}">${unitOptions}</select>
          ${selectedUnit ? `<span class="hint">Hodnota ${selectedUnit.v} b., max ${selectedUnit.m} ks v soupisce.</span>` : ''}
        </div>
        <div class="field">
          <label class="choice-label">Počáteční počet</label>
          <input type="number" min="0" data-action="setAddUnitCount" data-id="${esc(c.id)}" value="${f.count}">
        </div>
        <button type="button" class="choice-btn wide" data-action="addUnitSlot" data-id="${esc(c.id)}"${f.faction && f.name ? '' : ' disabled'}>+ Přidat jednotku</button>
      </div>`;
  }

  function renderRecommendedSection(c, sc) {
    if (!sc) return '';
    const indices = sc.battles.map((_, i) => i).filter((i) => Store.recommendedFor(c.scenarioId, i, c.sideName));
    if (!indices.length) return '';
    const st = ensurePrefillState(c);
    if (indices.indexOf(st.battleIndex) === -1) st.battleIndex = indices[0];
    const options = indices.map((i) =>
      `<option value="${i}"${i === st.battleIndex ? ' selected' : ''}>${i + 1}. ${esc(sc.battles[i].n)}</option>`
    ).join('');
    return `
      <div class="card accent-gold">
        <h3 class="serif">Doporučená sestava</h3>
        <p class="grid-note">Doplní soupisku podle doporučené armády pro vybranou bitvu — existující sloty stejné jednotky navýší počet, nové jednotky přidá.</p>
        <div class="field">
          <label class="choice-label">Bitva</label>
          <select data-action="setRecommendedBattle" data-id="${esc(c.id)}">${options}</select>
        </div>
        <button type="button" class="choice-btn wide" data-action="prefillRecommended" data-id="${esc(c.id)}">Předvyplnit z doporučené sestavy</button>
      </div>`;
  }

  function renderCampaignView(id) {
    const c = Store.get(id);
    if (!c) {
      root.innerHTML = shell('list',
        `<div class="header"><h1 class="serif">Kampaň nenalezena</h1><div class="divider"></div></div>`,
        `<div class="content"><div class="card accent-red"><p>Tato kampaň neexistuje nebo byla smazána.</p><button type="button" class="choice-btn wide" data-action="gotoList">Zpět na seznam</button></div></div>`
      );
      return;
    }
    const sc = Store.scenario(c);
    const totals = Store.totals(c);
    const pdfDisabled = !(window.OnusPDF && typeof window.OnusPDF.exportCampaign === 'function');

    const headerHtml = `
      <div class="header">
        <h1 class="serif">${esc(c.name || (sc ? sc.name : 'Kampaň'))}</h1>
        <div class="divider"></div>
        <p>${sc ? esc(sc.name) + ' (' + esc(sc.period) + ')' : 'Scénář nenalezen'} — strana <b>${esc(c.sideName)}</b></p>
      </div>`;

    const summaryHtml = `
      <div class="card accent-gold">
        <h3 class="serif">Souhrn</h3>
        <div class="campaign-summary-grid">
          <div><b>${totals.initialCount}</b><span>výchozí jednotky</span></div>
          <div><b>${totals.initialPoints}</b><span>výchozí body</span></div>
          <div><b>${totals.remainingCount}</b><span>zbývá jednotek</span></div>
          <div><b>${totals.remainingPoints}</b><span>zbývá bodů</span></div>
          <div><b>${totals.vpTotal}</b><span>VP celkem</span></div>
        </div>
        <div class="campaign-actions">
          <button type="button" class="choice-btn wide" data-action="campDownloadPdf" data-id="${esc(c.id)}"${pdfDisabled ? ' disabled title="PDF export není momentálně k dispozici"' : ''}>Stáhnout PDF</button>
          <button type="button" class="choice-btn wide" data-action="gotoBuilder" data-id="${esc(c.id)}">Sestavit armádu do bitvy</button>
          <button type="button" class="choice-btn wide" data-action="gotoList">Zpět na seznam</button>
        </div>
      </div>`;

    const logHtml = renderLogSection(c, sc);
    const addUnitHtml = renderAddUnitForm(c);
    const recommendedHtml = renderRecommendedSection(c, sc);

    const body = `
      <div class="content">${summaryHtml}</div>
      ${logHtml}
      <div class="content">${addUnitHtml}${recommendedHtml}</div>`;

    root.innerHTML = shell('list', headerHtml, body);
  }

  // ---------------------------------------------------------------------
  // Stavitel armády (#/builder) — jen deleguje na window.ArmyBuilder
  // ---------------------------------------------------------------------

  function renderBuilderView(campaignId) {
    const campaign = campaignId ? Store.get(campaignId) : null;
    const notice = campaignId && !campaign
      ? `<div class="card accent-red"><p>Kampaň s tímto ID nebyla nalezena — stavitel poběží bez vazby na kampaň.</p></div>`
      : '';

    const headerHtml = `
      <div class="header">
        <h1 class="serif">ONUS! — Stavitel armády</h1>
        <div class="divider"></div>
        <p>Sestav armádu podle rozpočtu a ulož si soupisku jako PDF.</p>
      </div>`;

    const body = `<div class="content">${notice}<div id="armybuilder-mount"></div></div>`;

    root.innerHTML = shell('builder', headerHtml, body);

    const mount = document.getElementById('armybuilder-mount');
    if (window.ArmyBuilder && typeof window.ArmyBuilder.render === 'function') {
      try {
        window.ArmyBuilder.render(mount, { campaignId: campaign ? campaignId : undefined });
      } catch (err) {
        mount.innerHTML = `<div class="card accent-red"><h3 class="serif">Modul se nepodařilo načíst</h3><p>Stavitel armády narazil na chybu při spuštění.</p></div>`;
        if (window.console && console.error) console.error('ArmyBuilder.render selhal:', err);
      }
    } else {
      mount.innerHTML = `<div class="card accent-red"><h3 class="serif">Modul se nepodařilo načíst</h3><p>Stavitel armády (army-builder.js) není momentálně k dispozici.</p></div>`;
    }
  }

  // ---------------------------------------------------------------------
  // Render dispatch
  // ---------------------------------------------------------------------

  function render() {
    const route = parseHash();
    if (route.view === 'campaign') renderCampaignView(route.id);
    else if (route.view === 'builder') renderBuilderView(route.campaignId);
    else renderList();
  }

  // ---------------------------------------------------------------------
  // Akce nad store (mutace + persist + rerender)
  // ---------------------------------------------------------------------

  function doCreateCampaign() {
    const f = ensureNewCampaignState();
    const sc = D.campaigns.find((s) => s.id === f.scenarioId);
    if (!sc) return;
    const trimmedName = f.name.trim();
    const opts = { name: trimmedName || sc.name, scenarioId: f.scenarioId, sideName: f.sideName };
    if (f.prefill && D.recommended[f.scenarioId]) opts.prefillBattleIndex = f.prefillBattleIndex;
    const c = Store.create(opts);
    ui.newCampaign = null;
    ui.showNewForm = false;
    navigate('#/campaign/' + encodeURIComponent(c.id));
  }

  function doDeleteCampaign(id) {
    const c = Store.get(id);
    if (!c) return;
    if (!window.confirm('Opravdu smazat kampaň „' + (c.name || '') + '“? Tuto akci nelze vrátit zpět.')) return;
    Store.remove(id);
    render();
  }

  function doDownloadPdf(id) {
    if (window.OnusPDF && typeof window.OnusPDF.exportCampaign === 'function') {
      window.OnusPDF.exportCampaign(id);
    }
  }

  function doAddBattle(cid) {
    const c = Store.get(cid); if (!c) return;
    if (c.battles.length >= 8) return;
    const sc = Store.scenario(c);
    const next = sc ? sc.battles[c.battles.length] : null;
    Store.addBattle(c, next ? next.n : '', next ? next.y : '');
    Store.update(c);
    render();
  }

  function doRemoveBattle(cid, bid) {
    const c = Store.get(cid); if (!c) return;
    const last = c.battles[c.battles.length - 1];
    if (!last || last.id !== bid) return;
    if (!window.confirm('Opravdu odebrat poslední bitvu „' + (last.name || '(bez názvu)') + '“ včetně zadaných hodnot?')) return;
    Store.removeBattle(c, bid);
    Store.update(c);
    render();
  }

  function doSetBattleName(cid, bid, val) {
    const c = Store.get(cid); if (!c) return;
    const b = c.battles.find((x) => x.id === bid); if (!b) return;
    const sc = Store.scenario(c);
    if (val === 'custom') {
      if (sc && sc.battles.some((sb) => sb.n === b.name)) b.name = '';
    } else if (sc) {
      const idx = Number(val);
      if (sc.battles[idx]) { b.name = sc.battles[idx].n; b.year = sc.battles[idx].y; }
    }
    Store.update(c);
    render();
  }

  function doSetBattleCustomName(cid, bid, val) {
    const c = Store.get(cid); if (!c) return;
    const b = c.battles.find((x) => x.id === bid); if (!b) return;
    b.name = val;
    Store.update(c);
    render();
  }

  function doSetBattleYear(cid, bid, val) {
    const c = Store.get(cid); if (!c) return;
    const b = c.battles.find((x) => x.id === bid); if (!b) return;
    b.year = val;
    Store.update(c);
    render();
  }

  function doSetBattleVp(cid, bid, val) {
    const c = Store.get(cid); if (!c) return;
    const b = c.battles.find((x) => x.id === bid); if (!b) return;
    b.vp = parseIntOrNull(val);
    Store.update(c);
    render();
  }

  function doSetBattleResult(cid, bid, value) {
    const c = Store.get(cid); if (!c) return;
    const b = c.battles.find((x) => x.id === bid); if (!b) return;
    b.result = (b.result === value) ? '' : value;
    Store.update(c);
    render();
  }

  function doCycleCond(cid, bid, slotId) {
    const c = Store.get(cid); if (!c) return;
    const b = c.battles.find((x) => x.id === bid); if (!b) return;
    const r = Store.row(b, slotId);
    const idx = COND_ORDER.indexOf(r.cond || '');
    r.cond = COND_ORDER[(idx + 1) % COND_ORDER.length];
    Store.update(c);
    render();
  }

  function doSetInitial(cid, slotId, val) {
    const c = Store.get(cid); if (!c) return;
    const slot = c.units.find((u) => u.id === slotId); if (!slot) return;
    const n = clampCount(val);
    slot.initial = n === null ? 0 : n;
    Store.update(c);
    render();
  }

  function doSetFielded(cid, bid, slotId, val) {
    const c = Store.get(cid); if (!c) return;
    const b = c.battles.find((x) => x.id === bid); if (!b) return;
    const r = Store.row(b, slotId);
    r.fielded = clampCount(val);
    Store.update(c);
    render();
  }

  function doSetLost(cid, bid, slotId, val) {
    const c = Store.get(cid); if (!c) return;
    const b = c.battles.find((x) => x.id === bid); if (!b) return;
    const r = Store.row(b, slotId);
    r.lost = clampCount(val);
    Store.update(c);
    render();
  }

  function doRemoveUnitSlot(cid, slotId) {
    const c = Store.get(cid); if (!c) return;
    const slot = c.units.find((u) => u.id === slotId);
    if (!slot) return;
    if (!window.confirm('Opravdu odebrat jednotku „' + slot.f + ' — ' + slot.n + '“ ze soupisky? Smažou se i její záznamy ve všech bitvách.')) return;
    Store.removeUnit(c, slotId);
    Store.update(c);
    render();
  }

  function doAddUnitSlot(cid) {
    const c = Store.get(cid); if (!c) return;
    const f = ensureAddUnitState(c);
    if (!f.faction || !f.name) return;
    Store.addUnit(c, f.faction, f.name, f.count || 0);
    Store.update(c);
    delete ui.addUnit[cid];
    render();
  }

  function doPrefillRecommended(cid) {
    const c = Store.get(cid); if (!c) return;
    const st = ensurePrefillState(c);
    const rec = Store.recommendedFor(c.scenarioId, st.battleIndex, c.sideName);
    if (!rec) return;
    rec.forEach(([f, n, cnt]) => {
      const existing = c.units.find((u) => u.f === f && u.n === n);
      if (existing) existing.initial = (existing.initial || 0) + cnt;
      else Store.addUnit(c, f, n, cnt);
    });
    Store.update(c);
    render();
  }

  // ---------------------------------------------------------------------
  // Delegace událostí. Klik/change uvnitř #armybuilder-mount ignorujeme —
  // ten kontejner si spravuje výhradně window.ArmyBuilder (vlastní modul).
  // ---------------------------------------------------------------------

  function isForeignTarget(el) {
    return !!el.closest('#armybuilder-mount');
  }

  function handleClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el || isForeignTarget(el)) return;
    const ds = el.dataset;
    switch (ds.action) {
      case 'nav': navigate(ds.href); break;
      case 'toggleNewForm': ui.showNewForm = !ui.showNewForm; render(); break;
      case 'togglePrefill': { const f = ensureNewCampaignState(); f.prefill = !f.prefill; render(); break; }
      case 'createCampaign': doCreateCampaign(); break;
      case 'openCampaign': navigate('#/campaign/' + encodeURIComponent(ds.id)); break;
      case 'deleteCampaign': doDeleteCampaign(ds.id); break;
      case 'gotoList': navigate('#/'); break;
      case 'gotoBuilder': navigate('#/builder?campaign=' + encodeURIComponent(ds.id)); break;
      case 'campDownloadPdf': doDownloadPdf(ds.id); break;
      case 'addBattle': doAddBattle(ds.id); break;
      case 'removeBattle': doRemoveBattle(ds.id, ds.battle); break;
      case 'setBattleResult': doSetBattleResult(ds.id, ds.battle, ds.value); break;
      case 'cycleCond': doCycleCond(ds.id, ds.battle, ds.slot); break;
      case 'removeUnitSlot': doRemoveUnitSlot(ds.id, ds.slot); break;
      case 'addUnitSlot': doAddUnitSlot(ds.id); break;
      case 'prefillRecommended': doPrefillRecommended(ds.id); break;
      default: break;
    }
  }

  function handleChange(e) {
    const el = e.target.closest('[data-action]');
    if (!el || isForeignTarget(el)) return;
    const ds = el.dataset;
    switch (ds.action) {
      case 'campSetScenario': {
        const f = ensureNewCampaignState();
        f.scenarioId = el.value;
        const sc = D.campaigns.find((s) => s.id === f.scenarioId);
        f.sideName = sc ? sc.sides[0].name : '';
        f.prefill = false;
        f.prefillBattleIndex = 0;
        render();
        break;
      }
      case 'campSetSide': { const f = ensureNewCampaignState(); f.sideName = el.value; render(); break; }
      case 'setName': { const f = ensureNewCampaignState(); f.name = el.value; break; }
      case 'setPrefillBattle': { const f = ensureNewCampaignState(); f.prefillBattleIndex = Number(el.value); break; }
      case 'setAddUnitFaction': {
        const c = Store.get(ds.id); if (!c) break;
        const f = ensureAddUnitState(c);
        f.faction = el.value;
        const units = D.units.filter((u) => u.f === f.faction);
        f.name = units.length ? units[0].n : '';
        render();
        break;
      }
      case 'setAddUnitName': {
        const c = Store.get(ds.id); if (!c) break;
        const f = ensureAddUnitState(c);
        f.name = el.value;
        render();
        break;
      }
      case 'setAddUnitCount': {
        const c = Store.get(ds.id); if (!c) break;
        const f = ensureAddUnitState(c);
        const n = clampCount(el.value);
        f.count = n === null ? 0 : n;
        break;
      }
      case 'setRecommendedBattle': {
        const c = Store.get(ds.id); if (!c) break;
        const st = ensurePrefillState(c);
        st.battleIndex = Number(el.value);
        break;
      }
      case 'setBattleName': doSetBattleName(ds.id, ds.battle, el.value); break;
      case 'setBattleCustomName': doSetBattleCustomName(ds.id, ds.battle, el.value); break;
      case 'setBattleYear': doSetBattleYear(ds.id, ds.battle, el.value); break;
      case 'setBattleVp': doSetBattleVp(ds.id, ds.battle, el.value); break;
      case 'setInitial': doSetInitial(ds.id, ds.slot, el.value); break;
      case 'setFielded': doSetFielded(ds.id, ds.battle, ds.slot, el.value); break;
      case 'setLost': doSetLost(ds.id, ds.battle, ds.slot, el.value); break;
      default: break;
    }
  }

  root.addEventListener('click', handleClick);
  root.addEventListener('change', handleChange);
  window.addEventListener('hashchange', render);

  render();

  // campaign.js je vykreslen synchronně a proběhne dřív než defer skripty
  // (pdf-export.js apod.) — po jejich doběhnutí ještě jednou překreslíme,
  // aby se stav tlačítka „Stáhnout PDF“ na hard reload/přímém odkazu srovnal.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    window.setTimeout(render, 0);
  }

})();

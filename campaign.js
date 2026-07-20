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

  // Nepersistovaný stav formulářů (mezi rendery přežívá, ale nikoli reload).
  const ui = {
    showNewForm: false,
    newCampaign: null,     // { scenarioId, sideName, name, prefillMode, prefillBattleIndex }
    addUnit: {},            // campaignId -> { faction, name, count }
    prefill: {},            // campaignId -> { battleIndex }
    logView: {},            // campaignId -> 'table' | 'battles'
    activeBattle: {},       // campaignId -> -1 (výchozí armáda) | index bitvy
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
        prefillMode: 'pool',   // 'none' | 'pool' | 'recommended'
        prefillBattleIndex: 0,
      };
    }
    return ui.newCampaign;
  }

  function poolSummary(scenarioId, sideName) {
    const pool = Store.campaignPool(scenarioId, sideName);
    let count = 0, points = 0;
    pool.forEach((u) => { count += u.m || 0; points += (u.m || 0) * (u.v || 0); });
    return { units: pool.length, count: count, points: points };
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
          <span class="hint">${esc(sc.period)} · ${sc.battles.length} bitev v tabulce scénářů${sc.note ? ' · ' + esc(sc.note) : ''}</span>
        </div>
        <div class="field">
          <label class="choice-label">Strana</label>
          <select data-action="campSetSide">${sideOptions}</select>
        </div>
        <div class="field">
          <label class="choice-label">Vlastní název kampaně (nepovinné)</label>
          <input type="text" data-action="setName" value="${esc(f.name)}" placeholder="${esc(sc.name)}">
        </div>
        <div class="field">
          <label class="choice-label">Výchozí armáda</label>
          <div class="choice-buttons wrap">
            ${choiceBtnStyled('Výchozí armáda strany', f.prefillMode === 'pool', 'green', { action: 'setPrefillMode', value: 'pool' })}
            ${hasRecommended ? choiceBtnStyled('Doporučená pro bitvu', f.prefillMode === 'recommended', 'green', { action: 'setPrefillMode', value: 'recommended' }) : ''}
            ${choiceBtnStyled('Prázdná soupiska', f.prefillMode === 'none', 'green', { action: 'setPrefillMode', value: 'none' })}
          </div>
          ${f.prefillMode === 'pool' ? (() => {
            const ps = poolSummary(sc.id, f.sideName);
            return `<span class="hint">Naplní soupisku všemi předdefinovanými jednotkami strany s plnými dostupnými počty dle tabulky: ${ps.units} typů jednotek, ${ps.count} ks / ${ps.points} b.</span>`;
          })() : ''}
          ${f.prefillMode === 'recommended' ? `
            <select data-action="setPrefillBattle">${battleOptions}</select>
            <span class="hint">Doporučená sestava pro vybranou bitvu se stane výchozí armádou kampaně.</span>
          ` : ''}
        </div>
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

  // Tři vstupy buňky bitvy podle papírového logu: Nasazeno (Starting, horní
  // řádek), z toho Veteráni (dolní řádek) a Po bitvě (Condit. = kolik jednotek
  // typu zbývá v armádě po bitvě).
  function battleCellInputs(c, b, slotId, r) {
    const val = (x) => (x === null || x === undefined ? '' : x);
    const inp = (action, ph, title, v) =>
      `<input type="number" min="0" class="log-input" placeholder="${ph}" title="${esc(title)}" value="${val(v)}" data-action="${action}" data-id="${esc(c.id)}" data-battle="${esc(b.id)}" data-slot="${esc(slotId)}">`;
    return inp('setFielded', 'N', 'Nasazeno do bitvy (Starting)', r.fielded)
      + inp('setVets', 'V', 'Z toho veteráni', r.vets)
      + inp('setAfter', 'Po', 'Zbývá po bitvě (Condit.)', r.after);
  }

  // Ovládání bitvy (název, rok, výsledek V/R/P jako zelené/žluté/červené pole
  // v sešitu, Vict. body) — sdílené tabulkou i mobilním pohledem po bitvách.
  function battleControlsHtml(c, sc, b, isLast) {
    const scenarioBattles = sc ? sc.battles : [];
    const matchIndex = scenarioBattles.findIndex((sb) => sb.n === b.name);
    const isCustom = matchIndex === -1;
    const options = scenarioBattles.map((sb, i) =>
      `<option value="${i}"${!isCustom && i === matchIndex ? ' selected' : ''}>${i + 1}. ${esc(sb.n)}</option>`
    ).join('');
    const customOption = `<option value="custom"${isCustom ? ' selected' : ''}>Vlastní název…</option>`;

    return `
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
        ${isLast ? `<button type="button" class="log-battle-remove" data-action="removeBattle" data-id="${esc(c.id)}" data-battle="${esc(b.id)}" title="Odebrat poslední bitvu">✕ odebrat</button>` : ''}`;
  }

  function battleHeaderHtml(c, sc, b, idx) {
    const isLast = idx === c.battles.length - 1;
    return `
      <th class="log-th-battle">
        ${battleControlsHtml(c, sc, b, isLast)}
        <div class="log-battle-legend">N / V / Po bitvě</div>
      </th>`;
  }

  function unitRowHtml(c, u, battles) {
    const info = Store.unitInfo(u.f, u.n);
    const v = info ? info.v : 0;
    const m = info ? info.m : 0;
    const initial = u.initial || 0;
    const over = initial > m;
    const cells = battles.map((b) => {
      const r = b.rows[u.id] || { fielded: null, vets: null, after: null };
      return `
        <td class="log-td-battle">
          <div class="log-cell-inputs">${battleCellInputs(c, b, u.id, r)}</div>
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
      `<td class="log-td-num">${pb.fielded} ks / ${pb.fieldedPoints} b. · ${pb.vets} vet.<br>po bitvě ${pb.after} ks (−${pb.lost})</td>`
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

  function ensureLogView(c) {
    if (!ui.logView[c.id]) {
      ui.logView[c.id] = window.innerWidth <= 640 ? 'battles' : 'table';
    }
    if (ui.activeBattle[c.id] === undefined) {
      ui.activeBattle[c.id] = c.battles.length ? c.battles.length - 1 : -1;
    }
    if (ui.activeBattle[c.id] >= c.battles.length) {
      ui.activeBattle[c.id] = c.battles.length ? c.battles.length - 1 : -1;
    }
    return ui.logView[c.id];
  }

  function renderLogTable(c, sc, totals) {
    const battles = c.battles;
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
      <div class="log-table-wrap">
        <table class="log-table">
          <thead>${theadRow}</thead>
          <tbody>${bodyRows}</tbody>
          ${sumRow ? `<tfoot>${sumRow}</tfoot>` : ''}
        </table>
      </div>`;
  }

  // Mobilní pohled: jedna bitva (nebo výchozí armáda) najednou, jednotky pod sebou.
  function renderBattleLog(c, sc, totals) {
    const active = ui.activeBattle[c.id];
    const canAddBattle = c.battles.length < 8;

    let chips = choiceBtnStyled('Výchozí', active === -1, 'gold', { action: 'setActiveBattle', id: c.id, value: '-1' });
    c.battles.forEach((b, i) => {
      chips += choiceBtnStyled('B' + (i + 1), active === i, 'gold', { action: 'setActiveBattle', id: c.id, value: String(i) });
    });
    if (canAddBattle) {
      chips += `<button type="button" class="choice-btn log-result-btn" data-action="addBattle" data-id="${esc(c.id)}">+</button>`;
    }
    const chipsHtml = `<div class="log-battle-chips">${chips}</div>`;

    if (!c.units.length) {
      return chipsHtml + `<p class="grid-note">Zatím žádné jednotky v soupisce — přidej je níže.</p>`;
    }

    if (active === -1) {
      const rows = c.units.map((u) => {
        const info = Store.unitInfo(u.f, u.n);
        const v = info ? info.v : 0;
        const m = info ? info.m : 0;
        const initial = u.initial || 0;
        return `
          <div class="log-mob-row${initial > m ? ' log-mob-over' : ''}">
            <div class="log-mob-head">
              <span class="log-unit-name">${esc(u.f)} — ${esc(u.n)}</span>
              <button type="button" class="log-unit-remove" data-action="removeUnitSlot" data-id="${esc(c.id)}" data-slot="${esc(u.id)}" title="Odebrat jednotku">✕</button>
            </div>
            <div class="log-mob-inputs">
              <label>Výchozí
                <input type="number" min="0" class="log-input" value="${initial}" data-action="setInitial" data-id="${esc(c.id)}" data-slot="${esc(u.id)}">
              </label>
              <span class="log-mob-meta">${v} b./ks · max ${m} · ${initial * v} b.</span>
            </div>
          </div>`;
      }).join('');
      return chipsHtml + `
        <div class="log-mob-list">${rows}</div>
        <p class="log-mob-sum">Výchozí armáda: <b>${totals.initialCount} ks / ${totals.initialPoints} b.</b></p>`;
    }

    const b = c.battles[active];
    if (!b) return chipsHtml;
    const isLast = active === c.battles.length - 1;
    const pb = totals.perBattle[active];
    const rows = c.units.map((u) => {
      const r = b.rows[u.id] || { fielded: null, vets: null, after: null };
      const before = Store.remaining(c, u.id, active);
      return `
        <div class="log-mob-row">
          <div class="log-mob-head">
            <span class="log-unit-name">${esc(u.f)} — ${esc(u.n)}</span>
            <span class="log-mob-meta">před bitvou ${before} ks</span>
          </div>
          <div class="log-mob-inputs log-mob-inputs-battle">${battleCellInputs(c, b, u.id, r)}</div>
        </div>`;
    }).join('');

    return chipsHtml + `
      <div class="log-mob-battle-controls">${battleControlsHtml(c, sc, b, isLast)}</div>
      <p class="hint">N = nasazeno do bitvy, V = z toho veteráni, Po = zbývá po bitvě.</p>
      <div class="log-mob-list">${rows}</div>
      <p class="log-mob-sum">Nasazeno <b>${pb.fielded} ks / ${pb.fieldedPoints} b.</b> · veteránů <b>${pb.vets}</b> · po bitvě <b>${pb.after} ks</b> (−${pb.lost} ztrát)</p>`;
  }

  function renderLogSection(c, sc) {
    const totals = Store.totals(c);
    const view = ensureLogView(c);
    const canAddBattle = c.battles.length < 8;

    const toggle = `
      <div class="log-view-toggle">
        ${choiceBtnStyled('Tabulka', view === 'table', 'gold', { action: 'setLogView', id: c.id, value: 'table' })}
        ${choiceBtnStyled('Po bitvách', view === 'battles', 'gold', { action: 'setLogView', id: c.id, value: 'battles' })}
      </div>`;

    const bodyHtml = view === 'battles'
      ? renderBattleLog(c, sc, totals)
      : renderLogTable(c, sc, totals);

    const toolbar = view === 'battles' ? '' : `
      <div class="log-toolbar">
        <button type="button" class="choice-btn wide" data-action="addBattle" data-id="${esc(c.id)}"${canAddBattle ? '' : ' disabled'}>+ Přidat bitvu</button>
        ${!canAddBattle ? '<span class="hint">Maximálně 8 bitev (jako v sešitu Campaign Log).</span>' : `<span class="hint">${c.battles.length} / 8 bitev</span>`}
      </div>`;

    return `
      <div class="log-section">
        <div class="card accent-gold log-card">
          <h3 class="serif">Log kampaně</h3>
          <p class="hint">Za každou bitvu: N = nasazeno (Starting), V = z toho veteráni, Po = zbývá po bitvě (Condit.).</p>
          ${toggle}
          ${bodyHtml}
          ${toolbar}
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

  function renderPoolCard(c) {
    const ps = poolSummary(c.scenarioId, c.sideName);
    if (!ps.units) return '';
    return `
      <div class="card accent-green">
        <h3 class="serif">Výchozí armáda strany</h3>
        <p class="grid-note">Doplní do soupisky všechny předdefinované jednotky tvé strany s plnými dostupnými počty dle tabulky (${ps.units} typů, ${ps.count} ks / ${ps.points} b.). Jednotky, které už v soupisce jsou, nemění.</p>
        <button type="button" class="choice-btn wide" data-action="prefillPool" data-id="${esc(c.id)}">Načíst výchozí armádu strany</button>
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
        <p>${sc ? esc(sc.name) + ' (' + esc(sc.period) + ')' : 'Scénář nenalezen'} — strana <b>${esc(c.sideName)}</b>${sc && sc.note ? '<br><span class="hint">' + esc(sc.note) + '</span>' : ''}</p>
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
    const poolHtml = renderPoolCard(c);
    const recommendedHtml = renderRecommendedSection(c, sc);

    const body = `
      <div class="content">${summaryHtml}</div>
      ${logHtml}
      <div class="content">${addUnitHtml}${poolHtml}${recommendedHtml}</div>`;

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
        window.ArmyBuilder.render(mount, { campaignId: campaign ? campaignId : undefined, embedded: true });
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
    if (f.prefillMode === 'recommended' && D.recommended[f.scenarioId]) opts.prefillBattleIndex = f.prefillBattleIndex;
    const c = Store.create(opts);
    if (f.prefillMode === 'pool') {
      Store.prefillPool(c);
      Store.update(c);
    }
    ui.newCampaign = null;
    ui.showNewForm = false;
    navigate('#/campaign/' + encodeURIComponent(c.id));
  }

  function doPrefillPool(cid) {
    const c = Store.get(cid); if (!c) return;
    const added = Store.prefillPool(c);
    if (added) Store.update(c);
    render();
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
    ui.activeBattle[cid] = c.battles.length - 1;
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

  function doSetVets(cid, bid, slotId, val) {
    const c = Store.get(cid); if (!c) return;
    const b = c.battles.find((x) => x.id === bid); if (!b) return;
    const r = Store.row(b, slotId);
    r.vets = clampCount(val);
    Store.update(c);
    render();
  }

  function doSetAfter(cid, bid, slotId, val) {
    const c = Store.get(cid); if (!c) return;
    const b = c.battles.find((x) => x.id === bid); if (!b) return;
    const r = Store.row(b, slotId);
    r.after = clampCount(val);
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
      case 'setPrefillMode': { const f = ensureNewCampaignState(); f.prefillMode = ds.value; render(); break; }
      case 'createCampaign': doCreateCampaign(); break;
      case 'openCampaign': navigate('#/campaign/' + encodeURIComponent(ds.id)); break;
      case 'deleteCampaign': doDeleteCampaign(ds.id); break;
      case 'gotoList': navigate('#/'); break;
      case 'gotoBuilder': navigate('#/builder?campaign=' + encodeURIComponent(ds.id)); break;
      case 'campDownloadPdf': doDownloadPdf(ds.id); break;
      case 'addBattle': doAddBattle(ds.id); break;
      case 'removeBattle': doRemoveBattle(ds.id, ds.battle); break;
      case 'setBattleResult': doSetBattleResult(ds.id, ds.battle, ds.value); break;
      case 'removeUnitSlot': doRemoveUnitSlot(ds.id, ds.slot); break;
      case 'addUnitSlot': doAddUnitSlot(ds.id); break;
      case 'prefillRecommended': doPrefillRecommended(ds.id); break;
      case 'prefillPool': doPrefillPool(ds.id); break;
      case 'setLogView': ui.logView[ds.id] = ds.value; render(); break;
      case 'setActiveBattle': ui.activeBattle[ds.id] = Number(ds.value); render(); break;
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
      case 'setVets': doSetVets(ds.id, ds.battle, ds.slot, el.value); break;
      case 'setAfter': doSetAfter(ds.id, ds.battle, ds.slot, el.value); break;
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

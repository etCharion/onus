(function () {
  'use strict';

  const root = document.getElementById('app');

  const state = {
    situation: 'melee',
    melee: {
      attack: 4, defense: 8,
      phalanx: false, arrowTip: false, spears: false, onrush: false,
      atkWounds: 0, atkOfficerLost: false, atkBroken: false,
      defHero: false, formation: 'none', hit: 'front',
      multiAttackers: false, forcedMarch: false, defOfficerLost: false,
    },
    ranged: {
      attack: 4, defense: 8,
      atkWounds: 0, atkOfficerLost: false, losBlocked: false,
      defHero: false, formation: 'none', hit: 'front',
      forcedMarch: false, defOfficerLost: false,
    },
    morale: {
      morale: 7, wounds: 0,
      general: false, hero: false, generalLost: false, terror: false, forcedMarch: false,
      hit: 'front', multiAttackers: false, extended: 0, officerLost: false, broken: false,
    },
  };

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function resetMelee() {
    Object.assign(state.melee, {
      phalanx: false, arrowTip: false, spears: false, onrush: false,
      atkWounds: 0, atkOfficerLost: false, atkBroken: false,
      defHero: false, formation: 'none', hit: 'front',
      multiAttackers: false, forcedMarch: false, defOfficerLost: false,
    });
  }

  function resetRanged() {
    Object.assign(state.ranged, {
      atkWounds: 0, atkOfficerLost: false, losBlocked: false,
      defHero: false, formation: 'none', hit: 'front',
      forcedMarch: false, defOfficerLost: false,
    });
  }

  function resetMorale() {
    Object.assign(state.morale, {
      wounds: 0, general: false, hero: false, generalLost: false, terror: false, forcedMarch: false,
      hit: 'front', multiAttackers: false, extended: 0, officerLost: false, broken: false,
    });
  }

  function neededInfo(defense, attack) {
    const needed = defense - attack + 1;
    let zone = 'normal';
    if (needed <= 1) zone = 'hit'; else if (needed >= 7) zone = 'miss';
    return { needed, zone };
  }
  function zoneColor(zone) { return zone === 'hit' ? '#3f7a4f' : zone === 'miss' ? '#b0473a' : '#a97d3b'; }
  function zoneBg(zone) { return zone === 'hit' ? '#e3ede2' : zone === 'miss' ? '#f3e0dc' : '#f1e9d8'; }
  function zoneText(info) {
    if (info.zone === 'hit') return 'Automatický zásah';
    if (info.zone === 'miss') return 'Automatické minutí';
    return 'Potřeba hodit ' + info.needed + '+';
  }

  function buildGrid(effAttack, effDefense) {
    const rows = [];
    const clampA = clamp(effAttack, 0, 10);
    const clampD = clamp(effDefense, 0, 10);
    for (let d = 0; d <= 10; d++) {
      const cells = [];
      for (let a = 0; a <= 10; a++) {
        const info = neededInfo(d, a);
        const isHi = (d === clampD && a === clampA);
        cells.push({
          needed: info.needed,
          bg: zoneBg(info.zone),
          fg: zoneColor(info.zone),
          border: isHi ? '2px solid #241f1a' : '1px solid #e3d8bc',
        });
      }
      rows.push({ defense: d, cells });
    }
    return rows;
  }

  function meleeEff(m) {
    let atk = m.attack;
    if (m.phalanx) atk += 1;
    if (m.arrowTip) atk += 1;
    if (m.spears) atk += 1;
    if (m.onrush) atk += 1;
    atk -= Math.floor(m.atkWounds / 3);
    if (m.atkOfficerLost) atk -= 1;
    if (m.atkBroken) atk -= 1;

    let def = m.defense;
    if (m.defHero) def += 1;
    if (m.formation === 'square') def += 2;
    if (m.formation === 'wallOfShields') def += 1;
    if (m.hit === 'flank') def -= 1;
    if (m.hit === 'rear') def -= 2;
    if (m.multiAttackers) def -= 1;
    if (m.forcedMarch) def -= 2;
    if (m.defOfficerLost) def -= 1;
    return { atk, def };
  }

  function rangedEff(r) {
    let atk = r.attack;
    atk -= Math.floor(r.atkWounds / 3);
    if (r.atkOfficerLost) atk -= 1;
    if (r.losBlocked) atk -= 1;

    let def = r.defense;
    if (r.defHero) def += 1;
    if (r.formation === 'square') def -= 1;
    if (r.formation === 'wallOfShields') def += 1;
    if (r.hit === 'flank') def -= 1;
    if (r.hit === 'rear') def -= 2;
    if (r.forcedMarch) def -= 2;
    if (r.defOfficerLost) def -= 1;
    return { atk, def };
  }

  function moraleEffVal(mo) {
    let v = mo.morale;
    if (mo.general) v += 1;
    if (mo.hero) v += 1;
    if (mo.generalLost) v -= 1;
    if (mo.terror) v -= 1;
    if (mo.forcedMarch) v -= 2;
    if (mo.hit === 'flank') v -= 1;
    if (mo.hit === 'rear') v -= 2;
    if (mo.multiAttackers) v -= 1;
    v -= mo.extended;
    if (mo.officerLost) v -= 1;
    if (mo.broken) v -= 1;
    v -= mo.wounds;
    return v;
  }

  function buildMoraleScale(target) {
    const arr = [];
    for (let v = 1; v <= 6; v++) {
      const pass = v === 1 || v <= target;
      arr.push({ v, bg: pass ? '#e3ede2' : '#f3e0dc', fg: pass ? '#3f7a4f' : '#b0473a' });
    }
    return arr;
  }

  function esc(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function modRow(label, section, field, delta) {
    const active = state[section][field];
    const deltaText = (delta > 0 ? '+' : '') + delta;
    const deltaColor = delta > 0 ? '#3f7a4f' : delta < 0 ? '#b0473a' : '#5a5142';
    const swBg = active ? '#a97d3b' : '#d8cbaa';
    const knobLeft = active ? 18 : 2;
    return `
      <div class="mod-row" data-action="toggle" data-section="${section}" data-field="${field}">
        <span class="mod-label">${esc(label)}</span>
        <span class="mod-delta" style="color:${deltaColor};">${deltaText}</span>
        <div class="switch" style="background:${swBg};">
          <div class="switch-knob" style="left:${knobLeft}px;"></div>
        </div>
      </div>`;
  }

  function choiceBtn(label, section, field, value, extraWidth) {
    const active = state[section][field] === value;
    return `<button type="button" class="choice-btn${active ? ' active' : ''}" data-action="setChoice" data-section="${section}" data-field="${field}" data-value="${value}">${esc(label)}</button>`;
  }

  function sliderBlock(label, section, field, min, max, hintText) {
    const value = state[section][field];
    return `
      <div class="slider-block">
        <div class="slider-row"><span>${esc(label)}</span><b>${value}</b></div>
        <input type="range" min="${min}" max="${max}" value="${value}" data-action="setNumber" data-section="${section}" data-field="${field}">
        ${hintText ? `<span class="hint">${esc(hintText)}</span>` : ''}
      </div>`;
  }

  function renderGrid(rows) {
    let header = '<div></div>';
    for (let a = 0; a <= 10; a++) header += `<div class="grid-header-cell">${a}</div>`;
    let body = '';
    rows.forEach((row) => {
      body += `<div class="grid-row"><div class="grid-header-cell">${row.defense}</div>`;
      row.cells.forEach((cell) => {
        body += `<div class="grid-cell" style="background:${cell.bg};color:${cell.fg};border:${cell.border};">${cell.needed}</div>`;
      });
      body += '</div>';
    });
    return `<div class="calc-grid">${header}${body}</div>`;
  }

  function renderMeleeSection() {
    const m = state.melee;
    const eff = meleeEff(m);
    const grid = buildGrid(eff.atk, eff.def);

    return `
      <div class="card gap-12">
        <h3 class="serif">Základní hodnoty</h3>
        ${sliderBlock('Útok jednotky', 'melee', 'attack', 0, 10)}
        ${sliderBlock('Obrana cíle', 'melee', 'defense', 0, 10)}
      </div>

      <div class="card">
        <h3 class="serif">Modifikátory útočníka</h3>

        ${sliderBlock('Ztráty jednotky (zranění)', 'melee', 'atkWounds', 0, 9, '−1 za každé 3 zranění')}

        ${modRow('Falanga (Phalanx)', 'melee', 'phalanx', 1)}
        ${modRow('Klín při nájezdu (Arrowhead)', 'melee', 'arrowTip', 1)}
        ${modRow('Kopiníci proti jízdě (Spearmen)', 'melee', 'spears', 1)}
        ${modRow('Výpad na pěchotu při nájezdu (Lunge)', 'melee', 'onrush', 1)}
        ${modRow('Jednotka přišla o důstojníky (No Officer)', 'melee', 'atkOfficerLost', -1)}
        ${modRow('Jednotka je rozvrácená (Broken)', 'melee', 'atkBroken', -1)}

        <button type="button" class="reset-btn" data-action="reset" data-section="melee">Resetovat modifikátory</button>
      </div>

      <div class="card">
        <h3 class="serif">Modifikátory obránce</h3>

        <div class="choice-group">
          <span class="choice-label">Formace</span>
          <div class="choice-buttons">
            ${choiceBtn('Žádná', 'melee', 'formation', 'none')}
            ${choiceBtn('Čtverec proti jízdě +2', 'melee', 'formation', 'square')}
            ${choiceBtn('Zeď štítů +1', 'melee', 'formation', 'wallOfShields')}
          </div>
        </div>

        <div class="choice-group">
          <span class="choice-label">Napadena</span>
          <div class="choice-buttons">
            ${choiceBtn('Zepředu', 'melee', 'hit', 'front')}
            ${choiceBtn('Z boku −1', 'melee', 'hit', 'flank')}
            ${choiceBtn('Zezadu −2', 'melee', 'hit', 'rear')}
          </div>
        </div>

        ${modRow('Jednotka má hrdinu (Hero)', 'melee', 'defHero', 1)}
        ${modRow('Útočí víc jednotek najednou (Other Enemies)', 'melee', 'multiAttackers', -1)}
        ${modRow('Nucený pochod (Marching)', 'melee', 'forcedMarch', -2)}
        ${modRow('Jednotka přišla o důstojníky (No Officer)', 'melee', 'defOfficerLost', -1)}
      </div>

      <div class="card">
        <h3 class="serif">Početní tabulka</h3>
        <p class="grid-note">Efektivní útok <b>${eff.atk}</b>, efektivní obrana <b>${eff.def}</b>. Vzorec: potřebný hod = obrana − útok + 1.</p>
        ${renderGrid(grid)}
        <p class="grid-footnote">Řádek = obrana, sloupec = útok. Zvýrazněná buňka je tvá aktuální situace (útok/obrana mimo 0–10 se zobrazí u kraje).</p>
      </div>`;
  }

  function renderRangedSection() {
    const r = state.ranged;
    const eff = rangedEff(r);
    const grid = buildGrid(eff.atk, eff.def);

    return `
      <div class="card gap-12">
        <h3 class="serif">Základní hodnoty</h3>
        ${sliderBlock('Útok na dálku', 'ranged', 'attack', 0, 10)}
        ${sliderBlock('Obrana cíle', 'ranged', 'defense', 0, 10)}
      </div>

      <div class="card">
        <h3 class="serif">Modifikátory střelce</h3>
        ${sliderBlock('Ztráty jednotky (zranění)', 'ranged', 'atkWounds', 0, 9, '−1 za každé 3 zranění')}
        ${modRow('Jednotka přišla o důstojníky (No Officer)', 'ranged', 'atkOfficerLost', -1)}
        ${modRow('Zastřený výhled (Line of Sight)', 'ranged', 'losBlocked', -1)}
        <button type="button" class="reset-btn" data-action="reset" data-section="ranged">Resetovat modifikátory</button>
      </div>

      <div class="card">
        <h3 class="serif">Modifikátory cíle</h3>
        <div class="choice-group">
          <span class="choice-label">Formace</span>
          <div class="choice-buttons">
            ${choiceBtn('Žádná', 'ranged', 'formation', 'none')}
            ${choiceBtn('Čtverec −1', 'ranged', 'formation', 'square')}
            ${choiceBtn('Zeď štítů +1', 'ranged', 'formation', 'wallOfShields')}
          </div>
        </div>
        <div class="choice-group">
          <span class="choice-label">Zásah</span>
          <div class="choice-buttons">
            ${choiceBtn('Zepředu', 'ranged', 'hit', 'front')}
            ${choiceBtn('Z boku −1', 'ranged', 'hit', 'flank')}
            ${choiceBtn('Zezadu −2', 'ranged', 'hit', 'rear')}
          </div>
        </div>
        ${modRow('Jednotka má hrdinu (Hero)', 'ranged', 'defHero', 1)}
        ${modRow('Nucený pochod (Marching)', 'ranged', 'forcedMarch', -2)}
        ${modRow('Jednotka přišla o důstojníky (No Officer)', 'ranged', 'defOfficerLost', -1)}
      </div>

      <div class="card">
        <h3 class="serif">Početní tabulka</h3>
        <p class="grid-note">Efektivní útok <b>${eff.atk}</b>, efektivní obrana <b>${eff.def}</b>. Vzorec: potřebný hod = obrana − útok + 1.</p>
        ${renderGrid(grid)}
        <p class="grid-footnote">Řádek = obrana, sloupec = útok. Zvýrazněná buňka je tvá aktuální situace (útok/obrana mimo 0–10 se zobrazí u kraje).</p>
      </div>`;
  }

  function renderMoraleSection() {
    const mo = state.morale;
    const eff = moraleEffVal(mo);
    const scale = buildMoraleScale(eff);

    let scaleHtml = '';
    scale.forEach((face) => {
      scaleHtml += `<div class="morale-face" style="background:${face.bg};color:${face.fg};">${face.v}</div>`;
    });

    return `
      <div class="card gap-12">
        <h3 class="serif">Základní hodnota</h3>
        ${sliderBlock('Morálka jednotky', 'morale', 'morale', 0, 12)}
        ${sliderBlock('Počet aktuálních zranění', 'morale', 'wounds', 0, 9, '−1 za každé zranění')}
        ${sliderBlock('Počet rozšířených sekcí formace', 'morale', 'extended', 0, 2, '−1 za každou rozšířenou sekci')}
      </div>

      <div class="card">
        <h3 class="serif">Modifikátory</h3>
        <div class="choice-group">
          <span class="choice-label">Je napadena</span>
          <div class="choice-buttons">
            ${choiceBtn('Zepředu', 'morale', 'hit', 'front')}
            ${choiceBtn('Z boku −1', 'morale', 'hit', 'flank')}
            ${choiceBtn('Zezadu −2', 'morale', 'hit', 'rear')}
          </div>
        </div>
        ${modRow('V dosahu vlivu generála', 'morale', 'general', 1)}
        ${modRow('Jednotka má hrdinu (Hero)', 'morale', 'hero', 1)}
        ${modRow('Generál zraněn, padl nebo prchá', 'morale', 'generalLost', -1)}
        ${modRow('Nepřítel vyvolává strach (Fear)', 'morale', 'terror', -1)}
        ${modRow('Nucený pochod (Marching)', 'morale', 'forcedMarch', -2)}
        ${modRow('Útočí víc nepřátelských jednotek (Other Enemies)', 'morale', 'multiAttackers', -1)}
        ${modRow('Jednotka přišla o důstojníky (No Officer)', 'morale', 'officerLost', -1)}
        ${modRow('Jednotka je rozvrácená (Broken)', 'morale', 'broken', -1)}
        <button type="button" class="reset-btn" data-action="reset" data-section="morale">Resetovat modifikátory</button>
      </div>

      <div class="card">
        <h3 class="serif">Škála hodu (k6)</h3>
        <p class="grid-note">Výsledná morálka po modifikátorech: <b>${eff}</b>. Uspěješ, hodíš-li tuto hodnotu nebo méně (hod 1 uspěje vždy).</p>
        <div class="morale-scale">${scaleHtml}</div>
      </div>`;
  }

  function render() {
    const s = state;
    const m = s.melee, r = s.ranged, mo = s.morale;

    const meleeInfo = neededInfo(meleeEff(m).def, meleeEff(m).atk);
    const rangedInfo = neededInfo(rangedEff(r).def, rangedEff(r).atk);
    const moraleEff = moraleEffVal(mo);

    let resultLabel = '', resultText = '', resultColor = '', resultBg = '';
    if (s.situation === 'melee') {
      resultLabel = 'Útok z blízka — výsledek';
      resultText = zoneText(meleeInfo);
      resultColor = zoneColor(meleeInfo.zone);
      resultBg = zoneBg(meleeInfo.zone);
    } else if (s.situation === 'ranged') {
      resultLabel = 'Útok na dálku — výsledek';
      resultText = zoneText(rangedInfo);
      resultColor = zoneColor(rangedInfo.zone);
      resultBg = zoneBg(rangedInfo.zone);
    } else {
      resultLabel = 'Kontrola morálky — výsledek';
      if (moraleEff >= 6) { resultText = 'Automatický úspěch'; resultColor = '#3f7a4f'; resultBg = '#e3ede2'; }
      else if (moraleEff <= 0) { resultText = 'Uspěje jen hod 1'; resultColor = '#b0473a'; resultBg = '#f3e0dc'; }
      else { resultText = 'Potřeba hodit ' + moraleEff + ' nebo méně'; resultColor = '#a97d3b'; resultBg = '#f1e9d8'; }
    }

    let sectionHtml = '';
    if (s.situation === 'melee') sectionHtml = renderMeleeSection();
    else if (s.situation === 'ranged') sectionHtml = renderRangedSection();
    else sectionHtml = renderMoraleSection();

    root.innerHTML = `
      <section class="page">
        <div class="header">
          <h1 class="serif">ONUS! — Počítadlo hodu</h1>
          <p>Vyber situaci, zapni platné modifikátory a hned uvidíš, kolik musíš hodit.</p>
        </div>

        <div class="sticky-bar">
          <div class="tabs">
            <button type="button" class="tab-btn${s.situation === 'melee' ? ' active' : ''}" data-action="selectSituation" data-value="melee">Z blízka</button>
            <button type="button" class="tab-btn${s.situation === 'ranged' ? ' active' : ''}" data-action="selectSituation" data-value="ranged">Na dálku</button>
            <button type="button" class="tab-btn${s.situation === 'morale' ? ' active' : ''}" data-action="selectSituation" data-value="morale">Morálka</button>
          </div>
          <div class="result-box" style="background:${resultBg};border-color:${resultColor};">
            <div class="result-label">${esc(resultLabel)}</div>
            <div class="result-text" style="color:${resultColor};">${esc(resultText)}</div>
          </div>
        </div>

        <div class="content">
          ${sectionHtml}
        </div>
      </section>`;
  }

  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (action === 'selectSituation') {
      state.situation = el.dataset.value;
      render();
    } else if (action === 'toggle') {
      const { section, field } = el.dataset;
      state[section][field] = !state[section][field];
      render();
    } else if (action === 'setChoice') {
      const { section, field, value } = el.dataset;
      state[section][field] = value;
      render();
    } else if (action === 'reset') {
      const { section } = el.dataset;
      if (section === 'melee') resetMelee();
      else if (section === 'ranged') resetRanged();
      else if (section === 'morale') resetMorale();
      render();
    }
  });

  root.addEventListener('change', (e) => {
    const el = e.target.closest('[data-action="setNumber"]');
    if (!el) return;
    const { section, field } = el.dataset;
    state[section][field] = Number(el.value);
    render();
  });

  render();
})();

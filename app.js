(function () {
  'use strict';

  const root = document.getElementById('app');

  const colors = {
    red: '#8c2a22', redLight: '#c96a5c',
    green: '#2f5d3a', greenLight: '#5f9a6c',
    gold: '#9c7327', goldLight: '#e3c26a',
  };

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
  function zoneColor(zone) { return zone === 'hit' ? colors.green : zone === 'miss' ? colors.red : colors.gold; }
  function zoneBg(zone) { return zone === 'hit' ? '#e2ead9' : zone === 'miss' ? '#f4ded9' : '#f6ecd4'; }
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
          border: isHi ? '2px solid #2a2018' : '1px solid #ecdfc0',
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
      arr.push({ v, bg: pass ? '#e2ead9' : '#f4ded9', fg: pass ? colors.green : colors.red });
    }
    return arr;
  }

  function esc(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // A row of circular "coin" buttons for picking a number 0..max.
  function coinRow(value, max, section, field, ringKey) {
    const ring = colors[ringKey];
    const ringLight = colors[ringKey + 'Light'];
    let html = '<div class="coin-row">';
    for (let n = 0; n <= max; n++) {
      const filled = n <= value;
      const current = n === value;
      const bg = current
        ? `radial-gradient(circle at 35% 30%, ${ringLight}, ${ring})`
        : (filled ? 'linear-gradient(160deg,#e9d8a8,#c8a24e)' : '#fbf6e6');
      const border = current ? `2px solid ${ring}` : (filled ? '1px solid #a9793f' : '1px solid #ddcda0');
      const boxShadow = current
        ? '0 2px 5px rgba(42,32,24,0.35), inset 0 0 0 2px rgba(255,255,255,0.5)'
        : (filled ? 'inset 0 1px 2px rgba(42,32,24,0.25)' : 'none');
      const color = current ? '#fff' : (filled ? '#4a3418' : '#b3a077');
      const transform = current ? 'translateY(-2px) scale(1.1)' : 'none';
      html += `<button type="button" class="coin" data-action="setNumber" data-section="${section}" data-field="${field}" data-value="${n}" style="background:${bg};border:${border};box-shadow:${boxShadow};color:${color};transform:${transform};">${n}</button>`;
    }
    return html + '</div>';
  }

  function coinField(label, value, max, section, field, ringKey, hintText) {
    return `
      <div class="field">
        <div class="field-row"><span>${esc(label)}</span><b>${value}</b></div>
        ${coinRow(value, max, section, field, ringKey)}
        ${hintText ? `<span class="hint">${esc(hintText)}</span>` : ''}
      </div>`;
  }

  function modRow(label, section, field, delta) {
    const active = state[section][field];
    const ringKey = delta > 0 ? 'green' : delta < 0 ? 'red' : 'gold';
    const ring = colors[ringKey];
    const ringLight = colors[ringKey + 'Light'];
    const deltaText = (delta > 0 ? '+' : '') + delta;
    const deltaColor = delta > 0 ? colors.green : delta < 0 ? colors.red : colors.gold;
    const tokenBg = active ? `radial-gradient(circle at 35% 30%, ${ringLight}, ${ring})` : '#fbf6e6';
    const tokenBorder = active ? `2px solid ${ring}` : '1px solid #ddcda0';
    const tokenShadow = active
      ? '0 2px 5px rgba(42,32,24,0.35), inset 0 0 0 2px rgba(255,255,255,0.5)'
      : 'inset 0 1px 2px rgba(42,32,24,0.12)';
    const checkOpacity = active ? 1 : 0;
    return `
      <div class="mod-row" data-action="toggle" data-section="${section}" data-field="${field}">
        <span class="mod-label">${esc(label)}</span>
        <span class="mod-delta" style="color:${deltaColor};">${deltaText}</span>
        <div class="token" style="background:${tokenBg};border:${tokenBorder};box-shadow:${tokenShadow};">
          <span class="token-check" style="opacity:${checkOpacity};">✓</span>
        </div>
      </div>`;
  }

  function choiceBtn(label, section, field, value, accentKey, wide) {
    const active = state[section][field] === value;
    const c = colors[accentKey];
    const bg = active ? c : '#fff';
    const color = active ? '#fff' : '#6b5c46';
    const border = active ? c : '#ddcda0';
    return `<button type="button" class="choice-btn${wide ? ' wide' : ''}" data-action="setChoice" data-section="${section}" data-field="${field}" data-value="${value}" style="background:${bg};color:${color};border-color:${border};">${esc(label)}</button>`;
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
      <div class="card gap-14 accent-gold">
        <h3 class="serif">Základní hodnoty</h3>
        ${coinField('Útok jednotky', m.attack, 10, 'melee', 'attack', 'red')}
        ${coinField('Obrana cíle', m.defense, 10, 'melee', 'defense', 'green')}
      </div>

      <div class="card accent-red">
        <h3 class="serif">Modifikátory útočníka</h3>

        ${coinField('Ztráty jednotky (zranění)', m.atkWounds, 9, 'melee', 'atkWounds', 'red', '−1 za každé 3 zranění')}

        ${modRow('Falanga (Phalanx)', 'melee', 'phalanx', 1)}
        ${modRow('Klín při nájezdu (Arrowhead)', 'melee', 'arrowTip', 1)}
        ${modRow('Kopiníci proti jízdě (Spearmen)', 'melee', 'spears', 1)}
        ${modRow('Výpad na pěchotu při nájezdu (Lunge)', 'melee', 'onrush', 1)}
        ${modRow('Jednotka přišla o důstojníky (No Officer)', 'melee', 'atkOfficerLost', -1)}
        ${modRow('Jednotka je rozvrácená (Broken)', 'melee', 'atkBroken', -1)}

        <button type="button" class="reset-btn" data-action="reset" data-section="melee">Resetovat modifikátory</button>
      </div>

      <div class="card accent-green">
        <h3 class="serif">Modifikátory obránce</h3>

        <div class="choice-group">
          <span class="choice-label">Formace</span>
          <div class="choice-buttons wrap">
            ${choiceBtn('Žádná', 'melee', 'formation', 'none', 'green', true)}
            ${choiceBtn('Čtverec proti jízdě +2', 'melee', 'formation', 'square', 'green', true)}
            ${choiceBtn('Zeď štítů +1', 'melee', 'formation', 'wallOfShields', 'green', true)}
          </div>
        </div>

        <div class="choice-group">
          <span class="choice-label">Napadena</span>
          <div class="choice-buttons">
            ${choiceBtn('Zepředu', 'melee', 'hit', 'front', 'green')}
            ${choiceBtn('Z boku −1', 'melee', 'hit', 'flank', 'green')}
            ${choiceBtn('Zezadu −2', 'melee', 'hit', 'rear', 'green')}
          </div>
        </div>

        ${modRow('Jednotka má hrdinu (Hero)', 'melee', 'defHero', 1)}
        ${modRow('Útočí víc jednotek najednou (Other Enemies)', 'melee', 'multiAttackers', -1)}
        ${modRow('Nucený pochod (Marching)', 'melee', 'forcedMarch', -2)}
        ${modRow('Jednotka přišla o důstojníky (No Officer)', 'melee', 'defOfficerLost', -1)}
      </div>

      <div class="card accent-gold">
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
      <div class="card gap-14 accent-gold">
        <h3 class="serif">Základní hodnoty</h3>
        ${coinField('Útok na dálku', r.attack, 10, 'ranged', 'attack', 'red')}
        ${coinField('Obrana cíle', r.defense, 10, 'ranged', 'defense', 'green')}
      </div>

      <div class="card accent-red">
        <h3 class="serif">Modifikátory střelce</h3>
        ${coinField('Ztráty jednotky (zranění)', r.atkWounds, 9, 'ranged', 'atkWounds', 'red', '−1 za každé 3 zranění')}
        ${modRow('Jednotka přišla o důstojníky (No Officer)', 'ranged', 'atkOfficerLost', -1)}
        ${modRow('Zastřený výhled (Line of Sight)', 'ranged', 'losBlocked', -1)}
        <button type="button" class="reset-btn" data-action="reset" data-section="ranged">Resetovat modifikátory</button>
      </div>

      <div class="card accent-green">
        <h3 class="serif">Modifikátory cíle</h3>
        <div class="choice-group">
          <span class="choice-label">Formace</span>
          <div class="choice-buttons wrap">
            ${choiceBtn('Žádná', 'ranged', 'formation', 'none', 'green', true)}
            ${choiceBtn('Čtverec −1', 'ranged', 'formation', 'square', 'green', true)}
            ${choiceBtn('Zeď štítů +1', 'ranged', 'formation', 'wallOfShields', 'green', true)}
          </div>
        </div>
        <div class="choice-group">
          <span class="choice-label">Zásah</span>
          <div class="choice-buttons">
            ${choiceBtn('Zepředu', 'ranged', 'hit', 'front', 'green')}
            ${choiceBtn('Z boku −1', 'ranged', 'hit', 'flank', 'green')}
            ${choiceBtn('Zezadu −2', 'ranged', 'hit', 'rear', 'green')}
          </div>
        </div>
        ${modRow('Jednotka má hrdinu (Hero)', 'ranged', 'defHero', 1)}
        ${modRow('Nucený pochod (Marching)', 'ranged', 'forcedMarch', -2)}
        ${modRow('Jednotka přišla o důstojníky (No Officer)', 'ranged', 'defOfficerLost', -1)}
      </div>

      <div class="card accent-gold">
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
      <div class="card gap-14 accent-gold">
        <h3 class="serif">Základní hodnota</h3>
        ${coinField('Morálka jednotky', mo.morale, 12, 'morale', 'morale', 'gold')}
        ${coinField('Počet aktuálních zranění', mo.wounds, 9, 'morale', 'wounds', 'red', '−1 za každé zranění')}
        ${coinField('Počet rozšířených sekcí formace', mo.extended, 2, 'morale', 'extended', 'gold', '−1 za každou rozšířenou sekci')}
      </div>

      <div class="card accent-gold">
        <h3 class="serif">Modifikátory</h3>
        <div class="choice-group">
          <span class="choice-label">Je napadena</span>
          <div class="choice-buttons">
            ${choiceBtn('Zepředu', 'morale', 'hit', 'front', 'gold')}
            ${choiceBtn('Z boku −1', 'morale', 'hit', 'flank', 'gold')}
            ${choiceBtn('Zezadu −2', 'morale', 'hit', 'rear', 'gold')}
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

      <div class="card accent-gold">
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
      if (moraleEff >= 6) { resultText = 'Automatický úspěch'; resultColor = colors.green; resultBg = '#e2ead9'; }
      else if (moraleEff <= 0) { resultText = 'Uspěje jen hod 1'; resultColor = colors.red; resultBg = '#f4ded9'; }
      else { resultText = 'Potřeba hodit ' + moraleEff + ' nebo méně'; resultColor = colors.gold; resultBg = '#f6ecd4'; }
    }

    let sectionHtml = '';
    if (s.situation === 'melee') sectionHtml = renderMeleeSection();
    else if (s.situation === 'ranged') sectionHtml = renderRangedSection();
    else sectionHtml = renderMoraleSection();

    root.innerHTML = `
      <section class="page">
        <div class="header">
          <h1 class="serif">ONUS! — Počítadlo hodu</h1>
          <div class="divider"></div>
          <p>Vyber situaci, zaklikni platné žetony a hned uvidíš, kolik musíš hodit.</p>
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
    } else if (action === 'setNumber') {
      const { section, field, value } = el.dataset;
      state[section][field] = Number(value);
      render();
    } else if (action === 'reset') {
      const { section } = el.dataset;
      if (section === 'melee') resetMelee();
      else if (section === 'ranged') resetRanged();
      else if (section === 'morale') resetMorale();
      render();
    }
  });

  render();
})();

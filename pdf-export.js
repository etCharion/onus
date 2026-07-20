// PDF export pro ONUS! — Správa kampaní.
// window.OnusPDF = { exportCampaign(campaignId), exportArmy(army) }
// Používá jsPDF + jspdf-autotable (vendor/) a vestavěný font DejaVu Sans
// (vendor/onus-pdf-fonts.js) kvůli české diakritice. Žádné síťové požadavky.
(function () {
  'use strict';

  var FONT = 'DejaVu';

  var COLORS = {
    red: [140, 42, 34],       // #8c2a22
    green: [47, 93, 58],      // #2f5d3a
    gold: [156, 115, 39],     // #9c7327
    goldLight: [227, 194, 106], // #e3c26a
    text: [42, 32, 24],       // #2a2018
    textMuted: [107, 92, 70], // #6b5c46
    border: [221, 205, 160],  // #ddcda0
    cardBg: [255, 253, 248],  // #fffdf8
    headBg: [156, 115, 39],
    footBg: [228, 214, 174],
  };

  // Výchozí podmínky bitvy (Initial Condit. v sešitu)
  var COND_LABELS = {
    green: 'výhoda hráče',
    yellow: 'bez výhody',
    red: 'výhoda soupeře',
  };

  // --- pomocné funkce -------------------------------------------------

  function slugify(str) {
    var s = String(str == null ? '' : str);
    try {
      s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    } catch (e) { /* normalize nemusí být k dispozici — pokračuj bez odstranění diakritiky */ }
    s = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return s || 'export';
  }

  function formatDateCZ(d) {
    d = d || new Date();
    return d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + d.getFullYear();
  }

  function num(v) {
    return (typeof v === 'number' && isFinite(v)) ? v : 0;
  }

  // Bezpečně dohledá katalogové info o jednotce — chybějící jednotka -> hodnota 0.
  function safeUnitInfo(f, n) {
    try {
      var info = window.OnusStore && window.OnusStore.unitInfo(f, n);
      if (info) return info;
    } catch (e) { /* ignoruj */ }
    return { f: f, n: n, v: 0, m: null, stats: null };
  }

  // Zaregistruje font DejaVu (normal + bold) do virtuálního FS jsPDF a nastaví ho jako výchozí.
  function registerFont(doc) {
    var fonts = window.ONUS_PDF_FONTS;
    if (!fonts) return;
    try {
      if (fonts.regular) {
        doc.addFileToVFS('DejaVuSans.ttf', fonts.regular);
        doc.addFont('DejaVuSans.ttf', FONT, 'normal');
      }
      if (fonts.bold) {
        doc.addFileToVFS('DejaVuSans-Bold.ttf', fonts.bold);
        doc.addFont('DejaVuSans-Bold.ttf', FONT, 'bold');
      }
      doc.setFont(FONT, 'normal');
    } catch (e) {
      // Font se nepodařilo zaregistrovat — pokračuj s výchozím fontem jsPDF
      // (diakritika nebude 100% správně, ale export nespadne).
    }
  }

  function fontStyleName(doc, style) {
    // Pokud registrace fontu selhala, DejaVu není k dispozici — vrať fallback.
    try {
      var list = doc.getFontList();
      if (list && list[FONT] && list[FONT].indexOf(style) !== -1) return FONT;
    } catch (e) { /* ignoruj */ }
    return 'helvetica';
  }

  function newDoc(orientation) {
    var jsPDF = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDF) throw new Error('OnusPDF: jsPDF není načtený.');
    var doc = new jsPDF({ orientation: orientation, unit: 'mm', format: 'a4', compress: true });
    registerFont(doc);
    return doc;
  }

  function setFont(doc, style) {
    doc.setFont(fontStyleName(doc, style || 'normal'), style || 'normal');
  }

  // Ujisti se, že na aktuální stránce je dost místa; jinak přidej novou stránku a vrať nové y.
  function ensureSpace(doc, y, needed, margin) {
    var pageH = doc.internal.pageSize.getHeight();
    if (y + needed > pageH - margin) {
      doc.addPage();
      return margin;
    }
    return y;
  }

  // --- hlavičky dokumentů ---------------------------------------------

  function drawTitle(doc, margin, title, lines) {
    var y = margin;
    setFont(doc, 'bold');
    doc.setFontSize(16);
    doc.setTextColor(COLORS.gold[0], COLORS.gold[1], COLORS.gold[2]);
    doc.text(title, margin, y);
    y += 5;
    doc.setDrawColor(COLORS.gold[0], COLORS.gold[1], COLORS.gold[2]);
    doc.setLineWidth(0.4);
    doc.line(margin, y, doc.internal.pageSize.getWidth() - margin, y);
    y += 6;

    lines.forEach(function (line, i) {
      if (!line) return;
      setFont(doc, i === 0 ? 'bold' : 'normal');
      doc.setFontSize(i === 0 ? 12 : 10);
      doc.setTextColor(
        i === 0 ? COLORS.text[0] : COLORS.textMuted[0],
        i === 0 ? COLORS.text[1] : COLORS.textMuted[1],
        i === 0 ? COLORS.text[2] : COLORS.textMuted[2]
      );
      doc.text(line, margin, y);
      y += i === 0 ? 6 : 5;
    });

    doc.setTextColor(COLORS.text[0], COLORS.text[1], COLORS.text[2]);
    return y + 2;
  }

  // --- exportCampaign ---------------------------------------------------

  function exportCampaign(campaignId) {
    try {
      var store = window.OnusStore;
      if (!store) { console.error('OnusPDF.exportCampaign: OnusStore není k dispozici.'); return null; }
      var c = store.get(campaignId);
      if (!c) { console.error('OnusPDF.exportCampaign: kampaň nenalezena (' + campaignId + ').'); return null; }

      var scenarioDef = store.scenario(c) || null;
      var scenarioName = scenarioDef ? scenarioDef.name : (c.scenarioId || '');
      var scenarioPeriod = scenarioDef ? scenarioDef.period : '';
      var totals = store.totals(c);

      var margin = 10;
      var doc = newDoc('landscape');

      var headerLines = [
        c.name || scenarioName || 'Kampaň',
        'Scénář: ' + scenarioName + (scenarioPeriod ? ' (' + scenarioPeriod + ')' : ''),
        'Strana: ' + (c.sideName || '') + '        Datum: ' + formatDateCZ(),
      ];
      var y = drawTitle(doc, margin, 'ONUS! — Záznam kampaně', headerLines);

      var battles = (c.battles || []).slice(0, 8);

      var head = ['Frakce', 'Jednotka', 'Hodnota', 'Max', 'Výchozí počet', 'Výchozí body'];
      battles.forEach(function (b, i) { head.push('B' + (i + 1)); });
      head.push('Zbývá');

      // Buňka bitvy jako v papírovém logu: nasazeno / ztráty → zbývá po bitvě,
      // druhý řádek povýšení: V = veterán, E = elita, H = hrdinové.
      function battleCell(b, slotId) {
        var r = b.rows ? b.rows[slotId] : null;
        if (!r) return '';
        var vals = ['fielded', 'lost', 'after', 'vets', 'elite', 'heroes'].map(function (k) {
          return r[k] == null ? null : r[k];
        });
        if (vals.every(function (v) { return v === null; })) return '';
        var d = function (v) { return v === null ? '–' : String(v); };
        var line1 = d(vals[0]) + ' / ' + d(vals[1]) + ' → ' + d(vals[2]);
        var line2 = 'V' + d(vals[3]) + ' E' + d(vals[4]) + ' H' + d(vals[5]);
        return line1 + '\n' + line2;
      }

      var body = (c.units || []).map(function (u) {
        var info = safeUnitInfo(u.f, u.n);
        var initial = num(u.initial);
        var row = [
          u.f, u.n,
          String(info.v), info.m == null ? '–' : String(info.m),
          String(initial), String(initial * info.v),
        ];
        battles.forEach(function (b) { row.push(battleCell(b, u.id)); });
        row.push(String(store.remaining(c, u.id)));
        return row;
      });

      var foot = ['SOUČTY', '', '', '', String(totals.initialCount), String(totals.initialPoints)];
      totals.perBattle.slice(0, 8).forEach(function (pb) {
        foot.push(pb.fielded + ' (' + pb.fieldedPoints + ' b.) / ' + pb.lost + ' → ' + pb.after +
          '\nV' + pb.vets + ' E' + pb.elite + ' H' + pb.heroes);
      });
      foot.push(String(totals.remainingCount));

      var battleColCount = battles.length;
      var columnStyles = {
        0: { cellWidth: 22 },
        1: { cellWidth: 32, halign: 'left' },
        2: { cellWidth: 12 },
        3: { cellWidth: 10 },
        4: { cellWidth: 16 },
        5: { cellWidth: 16 },
      };
      var battleColWidth = 16;
      for (var bi = 0; bi < battleColCount; bi++) {
        columnStyles[6 + bi] = { cellWidth: battleColWidth };
      }
      columnStyles[6 + battleColCount] = { cellWidth: 14 };

      doc.autoTable({
        startY: y,
        margin: { left: margin, right: margin },
        head: [head],
        body: body,
        foot: [foot],
        showFoot: 'lastPage',
        theme: 'grid',
        styles: {
          font: fontStyleName(doc, 'normal'), fontStyle: 'normal',
          fontSize: 7, cellPadding: 1.3, overflow: 'linebreak',
          textColor: COLORS.text, lineColor: COLORS.border, lineWidth: 0.1,
          halign: 'center', valign: 'middle',
        },
        headStyles: {
          font: fontStyleName(doc, 'bold'), fontStyle: 'bold',
          fillColor: COLORS.headBg, textColor: [255, 255, 255], fontSize: 7.5,
        },
        footStyles: {
          font: fontStyleName(doc, 'bold'), fontStyle: 'bold',
          fillColor: COLORS.footBg, textColor: COLORS.text, fontSize: 7,
        },
        alternateRowStyles: { fillColor: COLORS.cardBg },
        columnStyles: columnStyles,
        didParseCell: function (data) {
          if (data.section === 'foot' && data.column.index === 0) {
            data.cell.styles.halign = 'left';
          }
        },
      });

      y = doc.lastAutoTable.finalY + 5;

      // legenda sloupců bitev
      y = ensureSpace(doc, y, 6, margin);
      setFont(doc, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(COLORS.textMuted[0], COLORS.textMuted[1], COLORS.textMuted[2]);
      doc.text(
        'Sloupce bitev: nasazeno / ztráty → zbývá po bitvě (Condit.); V = povýšeno na veterána, E = na elitu, H = hrdinové.',
        margin, y
      );
      y += 7;

      // blok výsledků bitev + VP
      var neededForBlock = 6 + (c.battles || []).length * 5 + 6;
      y = ensureSpace(doc, y, neededForBlock, margin);
      setFont(doc, 'bold');
      doc.setFontSize(10);
      doc.setTextColor(COLORS.text[0], COLORS.text[1], COLORS.text[2]);
      doc.text('Bitvy', margin, y);
      y += 5.5;

      setFont(doc, 'normal');
      doc.setFontSize(8.5);
      (c.battles || []).forEach(function (b, i) {
        y = ensureSpace(doc, y, 5, margin);
        var cond = COND_LABELS[b.cond] || '–';
        var vp = (b.vp == null) ? '–' : String(b.vp);
        var line = 'B' + (i + 1) + ': ' + (b.name || '(bez názvu)') +
          (b.year ? ' (' + b.year + ')' : '') +
          ' — výchozí podmínky: ' + cond + ', VP: ' + vp;
        doc.text(line, margin, y);
        y += 5;
      });

      y += 1;
      y = ensureSpace(doc, y, 6, margin);
      setFont(doc, 'bold');
      doc.setFontSize(10);
      doc.setTextColor(COLORS.gold[0], COLORS.gold[1], COLORS.gold[2]);
      doc.text('Celkem VP: ' + totals.vpTotal, margin, y);

      var filename = 'onus-kampan-' + slugify(c.name || scenarioName) + '.pdf';
      doc.save(filename);
      return doc;
    } catch (err) {
      console.error('OnusPDF.exportCampaign selhal:', err);
      return null;
    }
  }

  // --- exportArmy ---------------------------------------------------

  function exportArmy(army) {
    try {
      army = army || {};
      var items = Array.isArray(army.items) ? army.items : [];

      var margin = 12;
      var doc = newDoc('portrait');

      var headerLines = [
        army.title || 'Vlastní armáda',
        army.subtitle || '',
        (army.sideName ? 'Strana: ' + army.sideName + '        ' : '') + 'Datum: ' + formatDateCZ(),
      ];
      var y = drawTitle(doc, margin, 'ONUS! — Soupiska armády', headerLines);

      // seskup podle frakce (stabilní řazení podle pořadí prvního výskytu)
      var factionOrder = [];
      items.forEach(function (it) {
        if (factionOrder.indexOf(it.f) === -1) factionOrder.push(it.f);
      });
      var sorted = items.slice().sort(function (a, b) {
        return factionOrder.indexOf(a.f) - factionOrder.indexOf(b.f);
      });

      var totalPoints = 0, totalCount = 0;
      var body = sorted.map(function (it) {
        var v = num(it.v);
        var count = num(it.count);
        var pts = v * count;
        totalPoints += pts;
        totalCount += count;
        return [it.f || '', it.n || '', String(v), String(count), String(pts)];
      });

      doc.autoTable({
        startY: y,
        margin: { left: margin, right: margin },
        head: [['Frakce', 'Jednotka', 'Hodnota', 'Počet', 'Body']],
        body: body,
        theme: 'grid',
        styles: {
          font: fontStyleName(doc, 'normal'), fontStyle: 'normal',
          fontSize: 9, cellPadding: 2, overflow: 'linebreak',
          textColor: COLORS.text, lineColor: COLORS.border, lineWidth: 0.1,
          valign: 'middle',
        },
        headStyles: {
          font: fontStyleName(doc, 'bold'), fontStyle: 'bold',
          fillColor: COLORS.headBg, textColor: [255, 255, 255], fontSize: 9.5,
        },
        columnStyles: {
          0: { cellWidth: 42 },
          1: { cellWidth: 62 },
          2: { cellWidth: 24, halign: 'center' },
          3: { cellWidth: 24, halign: 'center' },
          4: { cellWidth: 24, halign: 'center' },
        },
        alternateRowStyles: { fillColor: COLORS.cardBg },
      });

      y = doc.lastAutoTable.finalY + 8;
      y = ensureSpace(doc, y, 40, margin);

      var budget = (typeof army.budget === 'number') ? army.budget : null;
      var D = window.ONUS_DATA || {};
      var threshold = Math.floor(totalPoints * (typeof D.defeatThreshold === 'number' ? D.defeatThreshold : 0.5));
      var overBudget = budget != null && totalPoints > budget;

      setFont(doc, 'bold');
      doc.setFontSize(11);
      doc.setTextColor(
        overBudget ? COLORS.red[0] : COLORS.text[0],
        overBudget ? COLORS.red[1] : COLORS.text[1],
        overBudget ? COLORS.red[2] : COLORS.text[2]
      );
      doc.text(
        'Celkem bodů: ' + totalPoints + (budget != null ? ' / rozpočet ' + budget : ''),
        margin, y
      );
      y += 6;

      setFont(doc, 'normal');
      doc.setFontSize(10);
      doc.setTextColor(COLORS.text[0], COLORS.text[1], COLORS.text[2]);
      doc.text('Počet jednotek: ' + totalCount, margin, y);
      y += 6;

      setFont(doc, 'bold');
      doc.setTextColor(COLORS.red[0], COLORS.red[1], COLORS.red[2]);
      doc.text('Porážka při ztrátě ' + threshold + ' bodů', margin, y);

      var filename = 'onus-armada-' + slugify(army.title || army.subtitle || 'armada') + '.pdf';
      doc.save(filename);
      return doc;
    } catch (err) {
      console.error('OnusPDF.exportArmy selhal:', err);
      return null;
    }
  }

  window.OnusPDF = { exportCampaign: exportCampaign, exportArmy: exportArmy };
})();

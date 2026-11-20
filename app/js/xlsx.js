/* OfflineBooks US — minimal, dependency-free .xlsx writer (Office Open XML, stored ZIP).
 * sheets: [{ name, rows: [[cell, ...], ...], widths?: [chars...] }]
 * cell: string | number | { v: number, money: true } | { v: string, bold: true } | null — styles, formulas,
 * merges, frozen panes and print setup: see sheetXml below. Own writer because the bundled SheetJS
 * Community edition does not write cell styles (DEC-013).
 */
(function (root) {
  'use strict';
  var OB = root.OB = root.OB || {};
  var U = OB.util;
  var X = OB.xlsx = {};

  function utf8(s) { return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s) : new Uint8Array(Buffer.from(s, 'utf8')); }
  function xmlEsc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); }
  function colName(n) { var s = ''; n++; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

  X.colName = colName;
  /** "B7" from 0-based row and column. */
  X.ref = function (r, c) { return colName(c) + (r + 1); };

  /* ---------- styles: one cellXfs entry per distinct look, shared by all sheets ---------- */
  var MONEY = '#,##0.00;[Red]-#,##0.00';
  function Styles() {
    this.fonts = ['<font><sz val="11"/><name val="Calibri"/></font>'];
    this.fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
    this.borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
    this.fmts = []; this.xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>']; this.map = { '': 0 };
  }
  Styles.prototype.idx = function (list, xml) { var i = list.indexOf(xml); if (i < 0) { list.push(xml); i = list.length - 1; } return i; };
  Styles.prototype.get = function (c) {
    if (!c || typeof c !== 'object') return 0;
    var code = c.fmt || (c.money ? MONEY : c.pct ? '0.0%' : c.date ? 'date' : '');
    var key = [code, c.bold ? 1 : 0, c.italic ? 1 : 0, c.size || '', c.indent || 0, c.border || '', c.fill || '', c.align || '', c.wrap ? 1 : 0, c.color || '', c.underline ? 1 : 0].join('|');
    if (key === '|0|0||0||||0||0') return 0;
    if (this.map[key] !== undefined) return this.map[key];
    var numId = 0;
    if (code === 'date') numId = 14;
    else if (code) { var k = this.fmts.indexOf(code); if (k < 0) { this.fmts.push(code); k = this.fmts.length - 1; } numId = 164 + k; }
    var font = this.idx(this.fonts, '<font>' + (c.bold ? '<b/>' : '') + (c.italic ? '<i/>' : '') + (c.underline ? '<u/>' : '') + '<sz val="' + (c.size || 11) + '"/>' + (c.color ? '<color rgb="FF' + c.color + '"/>' : '') + '<name val="Calibri"/></font>');
    var fill = c.fill ? this.idx(this.fills, '<fill><patternFill patternType="solid"><fgColor rgb="FF' + (c.fill === 'head' ? 'E7ECF2' : c.fill) + '"/><bgColor indexed="64"/></patternFill></fill>') : 0;
    var bd = c.border === 'top' ? '<border><left/><right/><top style="thin"/><bottom/><diagonal/></border>'
      : c.border === 'double' ? '<border><left/><right/><top style="thin"/><bottom style="double"/><diagonal/></border>'
      : c.border === 'bottom' ? '<border><left/><right/><top/><bottom style="thin"/><diagonal/></border>' : '';
    var border = bd ? this.idx(this.borders, bd) : 0;
    var align = c.indent || c.align || c.wrap ? '<alignment' + (c.align ? ' horizontal="' + c.align + '"' : c.indent ? ' horizontal="left"' : '') + (c.indent ? ' indent="' + c.indent + '"' : '') + (c.wrap ? ' wrapText="1"' : '') + '/>' : '';
    this.xfs.push('<xf numFmtId="' + numId + '" fontId="' + font + '" fillId="' + fill + '" borderId="' + border + '" xfId="0"' + (numId ? ' applyNumberFormat="1"' : '') + (font ? ' applyFont="1"' : '') + (fill ? ' applyFill="1"' : '') + (border ? ' applyBorder="1"' : '') + (align ? ' applyAlignment="1">' + align + '</xf>' : '/>'));
    return (this.map[key] = this.xfs.length - 1);
  };
  /** Differential style for conditional formatting: { color, fill, bold, italic } → dxfId. */
  Styles.prototype.dxf = function (d) {
    this.dxfs = this.dxfs || [];
    return this.idx(this.dxfs, '<dxf>' + (d.color || d.bold || d.italic ? '<font>' + (d.bold ? '<b/>' : '') + (d.italic ? '<i/>' : '') + (d.color ? '<color rgb="FF' + d.color + '"/>' : '') + '</font>' : '') +
      (d.fill ? '<fill><patternFill patternType="solid"><fgColor rgb="FF' + d.fill + '"/><bgColor rgb="FF' + d.fill + '"/></patternFill></fill>' : '') + '</dxf>');
  };
  Styles.prototype.xml = function () {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      (this.fmts.length ? '<numFmts count="' + this.fmts.length + '">' + this.fmts.map(function (f, i) { return '<numFmt numFmtId="' + (164 + i) + '" formatCode="' + xmlEsc(f) + '"/>'; }).join('') + '</numFmts>' : '') +
      '<fonts count="' + this.fonts.length + '">' + this.fonts.join('') + '</fonts><fills count="' + this.fills.length + '">' + this.fills.join('') + '</fills>' +
      '<borders count="' + this.borders.length + '">' + this.borders.join('') + '</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="' + this.xfs.length + '">' + this.xfs.join('') + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      (this.dxfs && this.dxfs.length ? '<dxfs count="' + this.dxfs.length + '">' + this.dxfs.join('') + '</dxfs>' : '') + '</styleSheet>';
  };

  var PAPER = { letter: 1, legal: 5, a4: 9, tabloid: 3, a3: 8 };
  /**
   * sheet: { name, rows, widths?, merges?: ['A1:D1'], freeze?: { row, col } (rows/cols kept in view),
   *          page?: { orientation, paper, fitWidth, titles: [firstRow, lastRow] (1-based, repeat on each printed page), header, footer } }
   * cell extras: f (formula, no "="; v is its cached value), pct, fmt (number format code), italic, size, indent, border ('top'|'double'|'bottom'), fill ('head'|RRGGBB), align, wrap
   */
  /*
   * More sheet options (workbook export):
   *   tabColor 'RRGGBB'; cols: [{ width, hidden }] (instead of widths); rowMeta: { rowIndex: { level, hidden, height } } (grouped rows); summaryAbove: the +/− sits on the row above each group;
   *   autoFilter 'A4:H90'; protect: true (no password — Review › Unprotect Sheet); validations: [{ ref, type: 'date', title, prompt }];
   *   cond: [{ ref, formula, style: { color, fill, bold, italic } }]; tables: [{ name, ref, columns: [header text], style }];
   *   charts: [{ title, cats, series: [{ name, vals, color }], from: [col, row], to: [col, row] }] (clustered columns)
   *   cell.link: internal destination such as "'General Ledger'!A12" (native hyperlink; cell text stays editable)
   * Element order follows the SpreadsheetML schema (Excel rejects files that do not).
   */
  function sheetXml(sheet, styles, rel) {
    var pg = sheet.page || {}, meta = sheet.rowMeta || {}, links = [];
    var out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'];
    var levels = Object.keys(meta).reduce(function (m, k) { return Math.max(m, meta[k].level || 0); }, 0);
    if (pg.fitWidth || sheet.tabColor || levels) out.push('<sheetPr>' + (sheet.tabColor ? '<tabColor rgb="FF' + sheet.tabColor + '"/>' : '') + (levels ? '<outlinePr summaryBelow="' + (sheet.summaryAbove ? 0 : 1) + '" summaryRight="1"/>' : '') + (pg.fitWidth ? '<pageSetUpPr fitToPage="1"/>' : '') + '</sheetPr>');
    var fz = sheet.freeze;
    if (fz && (fz.row || fz.col)) {
      var pane = '<pane' + (fz.col ? ' xSplit="' + fz.col + '"' : '') + (fz.row ? ' ySplit="' + fz.row + '"' : '') + ' topLeftCell="' + X.ref(fz.row || 0, fz.col || 0) + '" activePane="' + (fz.row && fz.col ? 'bottomRight' : fz.row ? 'bottomLeft' : 'topRight') + '" state="frozen"/>';
      out.push('<sheetViews><sheetView workbookViewId="0"' + (sheet.gridlines === false ? ' showGridLines="0"' : '') + '>' + pane + '</sheetView></sheetViews>');
    } else if (sheet.gridlines === false) out.push('<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>');
    out.push('<sheetFormatPr defaultRowHeight="15"' + (levels ? ' outlineLevelRow="' + levels + '"' : '') + '/>');
    var cols = sheet.cols || (sheet.widths || []).map(function (w) { return { width: w }; });
    if (cols.length) {
      out.push('<cols>');
      cols.forEach(function (c, i) { if (c) out.push('<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.width || 10) + '" customWidth="1"' + (c.hidden ? ' hidden="1"' : '') + '/>'); });
      out.push('</cols>');
    }
    out.push('<sheetData>');
    sheet.rows.forEach(function (row, r) {
      var m = meta[r];
      out.push('<row r="' + (r + 1) + '"' + (m && m.level ? ' outlineLevel="' + m.level + '"' : '') + (m && m.hidden ? ' hidden="1"' : '') + (m && m.height ? ' ht="' + m.height + '" customHeight="1"' : '') + '>');
      row.forEach(function (cell, c) {
        if (cell === null || cell === undefined || cell === '') return;
        var ref = colName(c) + (r + 1);
        // check the type first: every JavaScript string has a built-in .link() method
        if (typeof cell === 'object' && cell.link) { links.push('<hyperlink ref="' + ref + '" location="' + xmlEsc(cell.link) + '" display="' + xmlEsc(cell.v === undefined || cell.v === null ? '' : cell.v) + '"/>'); if (!cell.color) { cell = Object.assign({ color: '0563C1', underline: true }, cell); } }
        var v = cell, style = styles.get(cell);
        if (typeof cell === 'object') v = cell.v;
        var sa = style ? ' s="' + style + '"' : '';
        if (cell.f) out.push('<c r="' + ref + '"' + sa + (typeof v === 'number' ? '' : ' t="str"') + '><f>' + xmlEsc(cell.f) + '</f>' + (v === undefined || v === null || v === '' ? '' : '<v>' + xmlEsc(v) + '</v>') + '</c>');
        else if (typeof v === 'number' && isFinite(v)) out.push('<c r="' + ref + '"' + sa + '><v>' + v + '</v></c>');
        else if (v === undefined || v === null || v === '') { if (style) out.push('<c r="' + ref + '"' + sa + '/>'); }
        else out.push('<c r="' + ref + '" t="inlineStr"' + sa + '><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>');
      });
      out.push('</row>');
    });
    out.push('</sheetData>');
    if (sheet.protect) out.push('<sheetProtection sheet="1" objects="1" scenarios="1" formatColumns="0" formatRows="0" sort="0" autoFilter="0" pivotTables="0"/>');
    if (sheet.autoFilter) out.push('<autoFilter ref="' + sheet.autoFilter + '"/>');
    if (sheet.merges && sheet.merges.length) out.push('<mergeCells count="' + sheet.merges.length + '">' + sheet.merges.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join('') + '</mergeCells>');
    (sheet.cond || []).forEach(function (c, i) {
      out.push('<conditionalFormatting sqref="' + c.ref + '"><cfRule type="expression" dxfId="' + styles.dxf(c.style || {}) + '" priority="' + (i + 1) + '"><formula>' + xmlEsc(c.formula) + '</formula></cfRule></conditionalFormatting>');
    });
    if (sheet.validations && sheet.validations.length) {
      out.push('<dataValidations count="' + sheet.validations.length + '">' + sheet.validations.map(function (d) {
        return '<dataValidation type="date" operator="between" allowBlank="0" showInputMessage="1" showErrorMessage="1" errorTitle="Date" error="Enter a date, for example 1/31/2026." promptTitle="' + xmlEsc(d.title || 'Date') + '" prompt="' + xmlEsc(d.prompt || '') + '" sqref="' + d.ref + '"><formula1>1</formula1><formula2>2958465</formula2></dataValidation>';
      }).join('') + '</dataValidations>');
    }
    if (links.length) out.push('<hyperlinks>' + links.join('') + '</hyperlinks>');
    if (sheet.page) {
      out.push('<printOptions horizontalCentered="1"/><pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>');
      out.push('<pageSetup paperSize="' + (PAPER[pg.paper] || 1) + '" orientation="' + (pg.orientation === 'landscape' ? 'landscape' : 'portrait') + '"' + (pg.fitWidth ? ' fitToWidth="1" fitToHeight="0"' : '') + '/>');
      if (pg.header || pg.footer) out.push('<headerFooter>' + (pg.header ? '<oddHeader>' + xmlEsc(pg.header) + '</oddHeader>' : '') + (pg.footer ? '<oddFooter>' + xmlEsc(pg.footer) + '</oddFooter>' : '') + '</headerFooter>');
    }
    if (rel.drawing) out.push('<drawing r:id="' + rel.drawing + '"/>');
    if (rel.tables.length) out.push('<tableParts count="' + rel.tables.length + '">' + rel.tables.map(function (id) { return '<tablePart r:id="' + id + '"/>'; }).join('') + '</tableParts>');
    out.push('</worksheet>');
    return out.join('');
  }

  function tableXml(t, id) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="' + id + '" name="' + t.name + '" displayName="' + t.name + '" ref="' + t.ref + '" totalsRowShown="0">' +
      '<autoFilter ref="' + t.ref + '"/><tableColumns count="' + t.columns.length + '">' + t.columns.map(function (c, i) { return '<tableColumn id="' + (i + 1) + '" name="' + xmlEsc(c) + '"/>'; }).join('') + '</tableColumns>' +
      '<tableStyleInfo name="' + (t.style || 'TableStyleLight9') + '" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>';
  }
  var C_NS = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  function chartXml(ch) {
    var rich = function (t) { return '<c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>' + xmlEsc(t) + '</a:t></a:r></a:p></c:rich></c:tx>'; };
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace ' + C_NS + '><c:roundedCorners val="0"/><c:chart>' +
      (ch.title ? '<c:title>' + rich(ch.title) + '<c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>' : '<c:autoTitleDeleted val="1"/>') +
      '<c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>' +
      ch.series.map(function (s, i) {
        return '<c:ser><c:idx val="' + i + '"/><c:order val="' + i + '"/><c:tx><c:strRef><c:f>' + xmlEsc(s.name) + '</c:f></c:strRef></c:tx>' +
          '<c:spPr><a:solidFill><a:srgbClr val="' + (s.color || ['2E75B6', 'C55A11', '70AD47'][i % 3]) + '"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>' +
          '<c:cat><c:strRef><c:f>' + xmlEsc(ch.cats) + '</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>' + xmlEsc(s.vals) + '</c:f></c:numRef></c:val></c:ser>';
      }).join('') +
      '<c:gapWidth val="80"/><c:axId val="5001"/><c:axId val="5002"/></c:barChart>' +
      '<c:catAx><c:axId val="5001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:tickLblPos val="nextTo"/><c:crossAx val="5002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>' +
      '<c:valAx><c:axId val="5002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="#,##0" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="5001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>' +
      '</c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>';
  }
  function drawingXml(charts) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      charts.map(function (ch, i) {
        var pt = function (tag, p) { return '<xdr:' + tag + '><xdr:col>' + p[0] + '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + p[1] + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:' + tag + '>'; };
        return '<xdr:twoCellAnchor>' + pt('from', ch.from) + pt('to', ch.to) + '<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="' + (i + 2) + '" name="Chart ' + (i + 1) + '"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>' +
          '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId' + (i + 1) + '"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>';
      }).join('') + '</xdr:wsDr>';
  }
  var REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  var CT = 'application/vnd.openxmlformats-officedocument.';
  function rels(list) { return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + list.map(function (r) { return '<Relationship Id="' + r[0] + '" Type="' + REL + r[1] + '" Target="' + r[2] + '"/>'; }).join('') + '</Relationships>'; }

  /**
   * opts: { names: [{ name, ref, comment }] (workbook defined names; ref without "="),
   *         props: { title, subject, creator, description } (document properties), active: sheet index }
   */
  X.build = function (sheets, opts) {
    opts = opts || {};
    var files = [], styles = new Styles(), over = [];
    var safeNames = sheets.map(function (s, i) { return (String(s.name || 'Sheet' + (i + 1)).replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31)) || 'Sheet' + (i + 1); });
    var seen = {};
    safeNames = safeNames.map(function (n) { var b = n, k = 2; while (seen[n.toLowerCase()]) n = b.slice(0, 27) + ' (' + k++ + ')'; seen[n.toLowerCase()] = 1; return n; });
    var q = function (i) { return '\'' + xmlEsc(safeNames[i].replace(/'/g, "''")) + '\''; };
    var tableN = 0, chartN = 0, drawN = 0;
    var sheetFiles = sheets.map(function (s, i) {
      var rel = { tables: [], drawing: null }, list = [];
      (s.tables || []).forEach(function (t) { tableN++; var id = 'rId' + (list.length + 1); list.push([id, 'table', '../tables/table' + tableN + '.xml']); rel.tables.push(id); files.push(['xl/tables/table' + tableN + '.xml', tableXml(t, tableN)]); over.push(['/xl/tables/table' + tableN + '.xml', CT + 'spreadsheetml.table+xml']); });
      if (s.charts && s.charts.length) {
        drawN++; var did = 'rId' + (list.length + 1); list.push([did, 'drawing', '../drawings/drawing' + drawN + '.xml']); rel.drawing = did;
        var dl = s.charts.map(function (ch, k) { chartN++; files.push(['xl/charts/chart' + chartN + '.xml', chartXml(ch)]); over.push(['/xl/charts/chart' + chartN + '.xml', CT + 'drawingml.chart+xml']); return ['rId' + (k + 1), 'chart', '../charts/chart' + chartN + '.xml']; });
        files.push(['xl/drawings/drawing' + drawN + '.xml', drawingXml(s.charts)]); files.push(['xl/drawings/_rels/drawing' + drawN + '.xml.rels', rels(dl)]);
        over.push(['/xl/drawings/drawing' + drawN + '.xml', CT + 'drawing+xml']);
      }
      if (list.length) files.push(['xl/worksheets/_rels/sheet' + (i + 1) + '.xml.rels', rels(list)]);
      return sheetXml(s, styles, rel);
    });
    var names = [];
    sheets.forEach(function (s, i) {
      var t = s.page && s.page.titles;
      if (t) names.push('<definedName name="_xlnm.Print_Titles" localSheetId="' + i + '">' + q(i) + '!$' + t[0] + ':$' + t[1] + '</definedName>');
      if (s.autoFilter) names.push('<definedName name="_xlnm._FilterDatabase" localSheetId="' + i + '" hidden="1">' + q(i) + '!' + s.autoFilter.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2') + '</definedName>');
    });
    (opts.names || []).forEach(function (n) { names.push('<definedName name="' + n.name + '"' + (n.comment ? ' comment="' + xmlEsc(n.comment) + '"' : '') + '>' + xmlEsc(n.ref) + '</definedName>'); });
    var pr = opts.props;
    files.push(['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map(function (s, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') +
      over.map(function (o) { return '<Override PartName="' + o[0] + '" ContentType="' + o[1] + '"/>'; }).join('') +
      (pr ? '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' : '') + '</Types>']);
    files.push(['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      (pr ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' : '') + '</Relationships>']);
    if (pr) {
      var now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
      files.push(['docProps/core.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        '<dc:title>' + xmlEsc(pr.title || '') + '</dc:title><dc:subject>' + xmlEsc(pr.subject || '') + '</dc:subject><dc:creator>' + xmlEsc(pr.creator || 'VaultBook') + '</dc:creator><dc:description>' + xmlEsc(pr.description || '') + '</dc:description>' +
        '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified></cp:coreProperties>']);
    }
    files.push(['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="' + (opts.active || 0) + '"/></bookViews><sheets>' +
      safeNames.map(function (n, i) { return '<sheet name="' + xmlEsc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets>' +
      (names.length ? '<definedNames>' + names.join('') + '</definedNames>' : '') + '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>']);
    files.push(['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function (s, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>']);
    files.push(['xl/styles.xml', styles.xml()]);
    sheetFiles.forEach(function (x, i) { files.push(['xl/worksheets/sheet' + (i + 1) + '.xml', x]); });
    var list = files.map(function (f) { return { name: f[0], data: utf8(f[1]) }; });
    return opts.parts ? list : X.zip(list);
  };
  /** Native DEFLATE (CompressionStream: Chrome/Edge 103+, Firefox 113+, Safari 16.4+, Node 18+); resolves null when unavailable. */
  X.deflate = function (bytes) {
    if (typeof CompressionStream === 'undefined' || typeof Response === 'undefined') return Promise.resolve(null);
    try {
      var cs = new CompressionStream('deflate-raw'), w = cs.writable.getWriter();
      w.write(bytes); w.close();
      return new Response(cs.readable).arrayBuffer().then(function (b) { return new Uint8Array(b); }, function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  };
  /** Same workbook as X.build, compressed (large workbooks shrink about 10–20×). Falls back to stored when compression is unavailable. */
  X.buildAsync = function (sheets, opts) {
    var list = X.build(sheets, Object.assign({}, opts || {}, { parts: true }));
    return Promise.all(list.map(function (f) { return f.data.length > 1024 ? X.deflate(f.data) : null; })).then(function (packed) { return X.zip(list, packed); });
  };
  /** Excel date serial (days since 1899-12-30) for 'YYYY-MM-DD'. */
  X.serial = function (d) { return Math.round((Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000); };

  /** Build an uncompressed ("stored") ZIP archive. */
  /** files: [{ name, data }]; packed: optional same-length list of DEFLATE-compressed data (null = store). */
  X.zip = function (files, packed) {
    var now = new Date();
    var dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (Math.floor(now.getSeconds() / 2));
    var dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    var chunks = [], central = [], offset = 0;
    files.forEach(function (f) {
      var name = utf8(f.name), crc = U.crc32(f.data), size = f.data.length;
      var pk = packed && packed[files.indexOf(f)], body = pk || f.data, method = pk ? 8 : 0, csize = body.length;
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, csize, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), name, body);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, method, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, csize, true); ch.setUint32(24, size, true);
      ch.setUint16(28, name.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
      ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + csize;
    });
    var cdSize = central.reduce(function (s, c) { return s + c.length; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    var all = chunks.concat(central, [new Uint8Array(end.buffer)]);
    var total = all.reduce(function (s, c) { return s + c.length; }, 0);
    var out = new Uint8Array(total), p = 0;
    all.forEach(function (c) { out.set(c, p); p += c.length; });
    return out;
  };
  X.MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
})(typeof window !== 'undefined' ? window : globalThis);

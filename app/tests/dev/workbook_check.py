"""
Developer-only check of the financial workbook (Export financial workbook) in a real spreadsheet engine.
1. Node builds sample companies (calendar and July fiscal years, accrual and cash basis) and exports workbooks,
   plus the engine's figures for several other periods.
2. LibreOffice (headless, UNO) recalculates each workbook as exported: every formula must equal its stored value.
3. The Dashboard From/To dates are changed inside the workbook and recalculated: P&L, Balance Sheet, Trial Balance,
   Cash Flow and Dashboard checks must equal the VaultBook engine for that period.
4. Hyperlinks must point at existing sheets and non-empty rows; a user sheet added to the file must survive saving.
Requires Node.js, LibreOffice with Python UNO, openpyxl.
Usage: python3 workbook_check.py /path/to/app
"""
import json, os, subprocess, sys, tempfile, openpyxl
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lo_recalc import recalc, shutdown

APP = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = tempfile.mkdtemp(prefix='vb_wb_')
results = []
def check(cond, name, detail=''):
    results.append((bool(cond), name)); print(('  ok   ' if cond else '  FAIL ') + name + (('  [' + str(detail)[:300] + ']') if detail and not cond else ''))

GEN = r"""
var path = require('path'), fs = require('fs'), A = process.argv[1], OUT = process.argv[2];
['util','schema','crypto','ledger','reports','statements','backup','xlsx','pdf','report-model','designer','sample','workbook'].forEach(function (f) { require(path.join(A, 'js', f + '.js')); });
var R = OB.reports;
function figures(b, basis, from, to) {
  var pl = R.statement(b, { kind: 'pl', from: from, to: to, basis: basis }), bs = R.statement(b, { kind: 'bs', from: from, to: to, basis: basis });
  var tb = R.trialBalance(b, { asOf: to, basis: basis }), cf = R.cashFlow(b, { from: from, to: to, basis: basis });
  return { from: from, to: to, 'pl.income': pl.sections.income.cells[0] / 100, 'pl.net': pl.sections.net.cells[0] / 100, 'bs.assets': bs.sections.assets.cells[0] / 100, 'bs.le': bs.sections.le.cells[0] / 100,
    'tb.debit': tb.totalDebit / 100, 'tb.credit': tb.totalCredit / 100, 'cf.end': cf.cashEnd / 100, 'cf.begin': cf.cashBegin / 100 };
}
var cases = [
  { name: 'calendar-accrual', fy: 1, basis: 'accrual', today: '2025-06-30', from: '2025-01-01', to: '2025-12-31', alt: [['2025-04-01', '2025-06-30'], ['2025-02-01', '2025-02-28'], ['2026-01-01', '2026-03-31']] },
  { name: 'calendar-cash', fy: 1, basis: 'cash', today: '2025-06-30', from: '2025-01-01', to: '2025-12-31', alt: [['2025-03-01', '2025-05-31']] },
  { name: 'july-fy-accrual', fy: 7, basis: 'accrual', today: '2025-10-31', from: '2025-07-01', to: '2026-06-30', alt: [['2025-08-01', '2025-09-30'], ['2025-05-01', '2025-08-31']] }
];
var seq = Promise.resolve(), meta = [];
cases.forEach(function (c) {
  seq = seq.then(function () { return OB.Book.create(new OB.MemoryAdapter(), { name: 'Check & Co ' + c.name, fiscalYearStartMonth: c.fy }); })
    .then(function (b) { return OB.sample.populate(b, c.today).then(function () { return b; }); })
    .then(function (b) { return OB.workbook.buildAsync(b, { from: c.from, to: c.to, basis: c.basis }).then(function (r) { return [b, r]; }); })
    .then(function (x) {
      var b = x[0], r = x[1];
      var file = path.join(OUT, c.name + '.xlsx'); fs.writeFileSync(file, Buffer.from(r.bytes));
      meta.push({ name: c.name, file: file, basis: c.basis, export: figures(b, c.basis, c.from, c.to), alt: c.alt.map(function (p) { return figures(b, c.basis, p[0], p[1]); }), lines: r.plan.stats.lines });
    });
});
seq.then(function () { console.log(JSON.stringify(meta)); }, function (e) { console.error(e); process.exit(1); });
"""

def find(ws, label, col):
    for row in ws.iter_rows():
        b = row[1].value if len(row) > 1 else None
        if isinstance(b, str) and b.strip() == label:
            return ws[col + str(row[0].row)].value
    return None

def figures_in(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    tb = wb['Trial Balance']
    return {
        'pl.income': find(wb['Profit & Loss'], 'Total Income', 'C'), 'pl.net': find(wb['Profit & Loss'], 'Net Income', 'C'),
        'bs.assets': find(wb['Balance Sheet'], 'Total Assets', 'C'), 'bs.le': find(wb['Balance Sheet'], 'Total Liabilities and Equity', 'C'),
        'tb.debit': find(tb, 'Total', 'C'), 'tb.credit': find(tb, 'Total', 'D'), 'cf.end': find(wb['Cash Flow'], 'Cash at end of period', 'C'), 'cf.begin': find(wb['Cash Flow'], 'Cash at beginning of period', 'C'),
        'checks': [r[1].value for r in wb['Dashboard'].iter_rows() if r[1].value in ('OK', 'CHECK')],
    }

def formulas_equal(src, dst):
    a = openpyxl.load_workbook(src, data_only=True); f = openpyxl.load_workbook(src); b = openpyxl.load_workbook(dst, data_only=True)
    n = bad = 0; ex = []
    for name in f.sheetnames:
        for row in f[name].iter_rows():
            for c in row:
                if isinstance(c.value, str) and c.value.startswith('='):
                    n += 1; x = a[name][c.coordinate].value; y = b[name][c.coordinate].value
                    if isinstance(x, (int, float)) or isinstance(y, (int, float)):
                        try: same = abs(float(x or 0) - float(y or 0)) < 0.005
                        except Exception: same = False
                    else: same = (x or '') == (y or '')
                    if not same:
                        bad += 1; ex.append((name, c.coordinate, c.value[:80], x, y))
    return n, bad, ex[:5]

def dash_rows(path):
    ws = openpyxl.load_workbook(path)['Dashboard']
    for row in ws.iter_rows():
        if row[0].value == 'From date': return 'B' + str(row[0].row), 'B' + str(row[0].row + 1)

def main():
    meta = json.loads(subprocess.check_output(['node', '-e', GEN, APP, OUT]).decode())
    for m in meta:
        print('— ' + m['name'] + ' (' + str(m['lines']) + ' lines)')
        src = m['file'],
        src = m['file']; rc = src.replace('.xlsx', '.recalc.xlsx'); recalc(src, rc)
        n, bad, ex = formulas_equal(src, rc)
        check(n > 500 and bad == 0, m['name'] + ': all %d formulas recalculate to the exported values' % n, ex)
        got = figures_in(rc)
        for k, v in m['export'].items():
            if k in ('from', 'to'): continue
            check(got[k] is not None and abs(got[k] - v) < 0.005, m['name'] + ': ' + k + ' equals the engine (' + str(v) + ')', got[k])
        check(got['checks'] and all(c == 'OK' for c in got['checks']), m['name'] + ': every Dashboard check is OK', got['checks'])
        fr, tr = dash_rows(src)
        for alt in m['alt']:
            dst = src.replace('.xlsx', '_%s_%s.xlsx' % (alt['from'], alt['to']))
            recalc(src, dst, {('Dashboard', fr): alt['from'], ('Dashboard', tr): alt['to']})
            got = figures_in(dst)
            bad = [(k, v, got[k]) for k, v in alt.items() if k not in ('from', 'to') and (got[k] is None or abs(got[k] - v) >= 0.005)]
            check(not bad, m['name'] + ': dates changed in Excel to %s – %s → P&L, Balance Sheet, Trial Balance, Cash Flow equal the engine' % (alt['from'], alt['to']), bad)
            check(all(c == 'OK' for c in got['checks'][:4]), m['name'] + ': checks still OK after changing dates', got['checks'])
        # links point at real places
        wb = openpyxl.load_workbook(src)
        bad_links = []; nlinks = 0
        for ws in wb:
            for hl in [c.hyperlink for row in ws.iter_rows() for c in row if c.hyperlink]:
                nlinks += 1
                loc = hl.location or ''
                sh, _, ref = loc.rpartition('!'); sh = sh.strip("'").replace("''", "'")
                if sh not in wb.sheetnames: bad_links.append((ws.title, hl.ref, loc)); continue
                t = wb[sh]; row = int(''.join(ch for ch in ref if ch.isdigit()))
                if row > 1 and not any(c.value not in (None, '') for c in t[row]): bad_links.append((ws.title, hl.ref, loc))
        check(nlinks > 50 and not bad_links, m['name'] + ': %d hyperlinks all land on existing, non-empty rows' % nlinks, bad_links[:5])
    # every package part is well-formed XML, and the bundled SheetJS reads the file (a second, independent parser)
    import zipfile, xml.dom.minidom
    zf = zipfile.ZipFile(meta[0]['file']); badxml = []
    for nm in zf.namelist():
        try: xml.dom.minidom.parseString(zf.read(nm))
        except Exception as e: badxml.append((nm, str(e)[:80]))
    check(not badxml and len(zf.namelist()) >= 25, 'All %d package parts are well-formed XML' % len(zf.namelist()), badxml[:3])
    js = "var fs=require('fs'),vm=require('vm');var c={};vm.createContext(c);vm.runInContext(fs.readFileSync(process.argv[1],'utf8'),c);var X=c.XLSX;var wb=X.read(fs.readFileSync(process.argv[2]),{type:'buffer'});var ws=wb.Sheets['Profit & Loss'];var n=0;for(var k in ws){if(ws[k]&&ws[k].f)n++;}console.log(JSON.stringify({sheets:wb.SheetNames.length,formulas:n,names:(wb.Workbook&&wb.Workbook.Names||[]).length}))"
    sj = json.loads(subprocess.check_output(['node', '-e', js, os.path.join(APP, 'js', 'vendor', 'sheetjs.min.js'), meta[0]['file']]).decode())
    check(sj['sheets'] == 14 and sj['formulas'] > 20 and sj['names'] >= 15, 'Bundled SheetJS reads every sheet, the formulas and the defined names', sj)
    # user customisation survives saving and reopening (openpyxl stands in for the user's spreadsheet program)
    src = meta[0]['file']; wb = openpyxl.load_workbook(src)
    ws = wb.create_sheet('Partner notes'); ws['A1'] = 'Margin'; ws['B1'] = "='Profit & Loss'!C10/2"
    wb['My Analysis']['A20'] = 'My own row'
    mod = src.replace('.xlsx', '_edited.xlsx'); wb.save(mod)
    rc = mod.replace('.xlsx', '.recalc.xlsx'); recalc(mod, rc)
    w2 = openpyxl.load_workbook(rc, data_only=True)
    check('Partner notes' in w2.sheetnames and w2['My Analysis']['A20'].value == 'My own row' and isinstance(w2['Partner notes']['B1'].value, (int, float)), 'A sheet and formulas added by the user survive saving, reopening and recalculation')
    shutdown()
    fails = [n for ok, n in results if not ok]
    print('\n%d passed, %d failed' % (len(results) - len(fails), len(fails)))
    sys.exit(1 if fails else 0)

main()

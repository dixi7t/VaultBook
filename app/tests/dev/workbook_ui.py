"""
VaultBook "Export financial workbook" UI test (developer-only, 1.11).
Two sample companies are exported separately from Reports; checks the dialog (period, basis, sheet choice,
protection), the downloaded workbook (sheets, company metadata, figures equal to the screen) and that
companies never mix. Requires Python 3 + Playwright (Chromium) and openpyxl.
Usage: python3 workbook_ui.py /path/to/app/index.html
"""
import asyncio, os, sys, tempfile, openpyxl
from playwright.async_api import async_playwright

APP = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'index.html'))
URL = 'file://' + APP
DL = tempfile.mkdtemp(prefix='vb_wbui_')
results = []
def check(cond, name, detail=''):
    results.append((bool(cond), name)); print(('  ok   ' if cond else '  FAIL ') + name + (('  [' + str(detail)[:300] + ']') if detail and not cond else ''))

def cellval(ws, label, col='C'):
    for row in ws.iter_rows():
        if len(row) > 1 and isinstance(row[1].value, str) and row[1].value.strip() == label: return ws[col + str(row[0].row)].value

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='vb_wbui_p_'), viewport={'width': 1440, 'height': 900}, accept_downloads=True)
        pg = ctx.pages[0]; errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        ev = pg.evaluate
        async def go(h): await ev('h => { location.hash = h; }', h); await pg.wait_for_timeout(350)
        async def new_company(name, sample):
            await pg.goto(URL); await pg.wait_for_timeout(500)
            if await ev('!!(OB.ui && OB.ui.book)'): await ev('OB.ui.closeCompany()')
            await pg.wait_for_selector('#newco')
            await pg.fill('#newco input[name=name]', name)
            if sample: await pg.check('#newco input[name=sample]')
            await pg.click('#newco button[type=submit]')
            await pg.wait_for_function("OB.ui.book && OB.ui.book.company.name === %r" % name, timeout=20000)
        async def export(setup=None):
            await go('#/reports'); await pg.click('[data-testid=export-workbook]'); await pg.wait_for_selector('.modal #wb-period')
            if setup: await setup()
            async with pg.expect_download() as d:
                await pg.click('.modal .btn.primary')
            dl = await d.value; path = os.path.join(DL, dl.suggested_filename); await dl.save_as(path); return path, dl.suggested_filename

        await new_company('Harbor Consulting LLC', True)
        await pg.wait_for_function("OB.ui.book.transactions.length > 20", timeout=20000)
        await go('#/reports')
        check(await ev("!!document.querySelector('[data-testid=export-workbook]')"), 'Reports has "Export financial workbook"')
        path, fname = await export()
        wb = openpyxl.load_workbook(path, data_only=True)
        check(len(wb.sheetnames) == 14 and wb.sheetnames[0] == 'Dashboard' and 'Data - Ledger Lines' in wb.sheetnames, 'Workbook has all sheets, Dashboard first', wb.sheetnames)
        dtxt = ' '.join(str(c.value) for r in wb['Dashboard'].iter_rows() for c in r if c.value is not None)
        check('Harbor Consulting LLC' in dtxt and 'Fiscal year' in dtxt and 'Exported' in dtxt and 'Accrual' in dtxt and 'Data through' in dtxt, 'Dashboard shows company, fiscal year, export time, basis and data-through date')
        check('Harbor_Consulting_LLC' in fname and fname.endswith('accrual.xlsx'), 'File name names the company, period and basis', fname)
        r = await ev("(() => { const f = OB.ui.ranges().thisFY; const st = OB.reports.statement(OB.ui.book, { kind: 'pl', from: f[1], to: f[2] }); const bs = OB.reports.statement(OB.ui.book, { kind: 'bs', from: f[1], to: f[2] }); return [st.sections.net.cells[0] / 100, bs.sections.assets.cells[0] / 100]; })()")
        check(abs(cellval(wb['Profit & Loss'], 'Net Income') - r[0]) < 0.005, 'Net income in Excel equals VaultBook', (cellval(wb['Profit & Loss'], 'Net Income'), r[0]))
        check(abs(cellval(wb['Balance Sheet'], 'Total Assets') - r[1]) < 0.005, 'Total assets in Excel equals VaultBook')
        checks = [row[1].value for row in wb['Dashboard'].iter_rows() if row[1].value in ('OK', 'CHECK')]
        check(len(checks) >= 5 and all(c == 'OK' for c in checks), 'Every Dashboard check reads OK', checks)
        wf = openpyxl.load_workbook(path)
        check(not wf['Data - Ledger Lines'].protection.sheet and not wf['Profit & Loss'].protection.sheet, 'Nothing is protected by default (the file is editable)')

        # cash basis, custom period, sheet subset, protection
        async def setup2():
            await pg.select_option('#wb-period', 'custom'); await pg.fill('#wb-from', '2026-01-01'); await pg.fill('#wb-to', '2026-06-30')
            await pg.select_option('#wb-basis', 'cash'); await pg.uncheck('[name=wb-sheet][value=ap]'); await pg.uncheck('[name=wb-sheet][value=my]'); await pg.check('#wb-protect')
        path2, fname2 = await export(setup2)
        w2 = openpyxl.load_workbook(path2)
        check('AP Aging' not in w2.sheetnames and 'My Analysis' not in w2.sheetnames and len(w2.sheetnames) == 12, 'Unticked sheets are left out', w2.sheetnames)
        check(w2['Data - Ledger Lines'].protection.sheet and not w2['Profit & Loss'].protection.sheet, 'Protection, when asked, covers only the original data sheets')
        check(fname2.endswith('cash.xlsx') and '2026-01-01_to_2026-06-30' in fname2, 'Custom period and cash basis are used', fname2)
        dn = w2.defined_names
        frm = w2['Dashboard'][list(dn['FromDate'].destinations)[0][1].replace('$', '')].value
        check(str(frm)[:10] == '2026-01-01', 'Dashboard From date defaults to the chosen period', frm)
        r2 = await ev("OB.reports.statement(OB.ui.book, { kind: 'pl', from: '2026-01-01', to: '2026-06-30', basis: 'cash' }).sections.net.cells[0] / 100")
        check(abs(cellval(openpyxl.load_workbook(path2, data_only=True)['Profit & Loss'], 'Net Income') - r2) < 0.005, 'Cash-basis net income equals VaultBook')
        check(await ev("OB.prefs.get('workbookExport').sheets.ap === false"), 'Sheet choices are remembered for next time')

        # a second company exports separately, without the first company's records
        await ev("OB.prefs.set('workbookExport', {})")
        await new_company('Second Street Bakery', False)
        await ev("""(async () => { const b = OB.ui.book; const c = await b.saveContact({ kind: 'customer', name: 'Corner Cafe' });
            const acc = (n) => b.accounts.find((a) => a.name === n).id;
            await b.saveTransaction({ type: 'salesReceipt', date: OB.util.today(), contactId: c.id, accountId: acc('Checking'), lines: [{ accountId: acc('Sales'), amount: '321.45' }] }); })()""")
        await pg.wait_for_timeout(300)
        path3, fname3 = await export()
        w3 = openpyxl.load_workbook(path3, data_only=True)
        data = [r for r in w3['Data - Ledger Lines'].iter_rows(min_row=5, values_only=True) if r[0]]
        names = set(r[13] for r in data)
        check(len(data) == 2 and 'Corner Cafe' in names and not any('Harbor' in str(n) or 'Dental' in str(n) for n in names), 'Second company workbook holds only its own two lines', names)
        check('Second_Street_Bakery' in fname3 and abs(cellval(w3['Profit & Loss'], 'Net Income') - 321.45) < 0.005, 'Second company figures are its own')

        # palette entry
        await go('#/reports'); await pg.keyboard.press('Control+k'); await pg.wait_for_timeout(300)
        await pg.keyboard.type('financial workbook'); await pg.wait_for_timeout(300); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(400)
        check(await ev("!!document.querySelector('.modal #wb-period')"), 'Ctrl+K "financial workbook" opens the export dialog')
        await pg.keyboard.press('Escape')
        check(not errors, 'No JavaScript errors', errors[:3])
        await ctx.close()
    fails = [n for ok, n in results if not ok]
    print('\n%d passed, %d failed' % (len(results) - len(fails), len(fails)))
    sys.exit(1 if fails else 0)
asyncio.run(main())

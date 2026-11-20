"""
VaultBook QuickBooks Online import UI test (developer-only).
Builds the Excel files QuickBooks Online exports (Journal, Trial Balance, Balance Sheet, Profit and Loss,
contact lists) with synthetic data, writing every report amount as a constant formula ("=1234.56") exactly as
QuickBooks Online does, then: creates a company straight from the files on the company screen, checks the
preview, imports, and checks the result. Also: adding the files to a company that already has transactions.
Requires: Python 3 + Playwright (Chromium) + openpyxl.
Usage: python3 qbo_ui.py /path/to/app/index.html
"""
import asyncio, os, sys, tempfile
import openpyxl
from playwright.async_api import async_playwright

APP = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'index.html'))
URL = 'file://' + APP
results = []
def check(cond, name, detail=''):
    results.append((bool(cond), name)); print(('  ok   ' if cond else '  FAIL ') + name + (('  [' + str(detail) + ']') if detail and not cond else ''))

CO = 'Maple Dental, P.C.'; FOOT = 'Monday, Nov 09, 2026 10:31:47 AM GMT-8 - Accrual Basis'
F = lambda v: '=%.2f' % v      # QuickBooks Online writes report amounts as constant formulas
TX = [('01/02/2025', 'Deposit', None, None, [('Deposit', 'Checking', 1000, None), ('Deposit', 'Sales', None, 1000)]),
      ('01/03/2025', 'Expense', None, 'Staples', [('STAPLES 0010', 'Checking', None, 50), ('STAPLES 0010', 'Office Supplies & Software', 50, None)]),
      ('01/05/2025', 'Check', 101, 'Oak Realty', [('January rent', 'Checking', None, 800), ('January rent', 'Rent & Lease', 800, None)]),
      ('01/31/2025', 'Journal Entry', 'JE-1', None, [('Depreciation', 'Depreciation Expense', 100, None), ('Depreciation', 'z-Accumulated Depreciation', None, 100)]),
      ('02/01/2025', 'Expense', None, None, [('PARKING AUTH', 'Checking', None, 30), ('PARKING AUTH', 'Auto Expense:Parking & Tolls', 30, None)]),
      ('02/02/2025', 'Journal Entry', 'JE-2', None, [('Chair bought on loan', 'Dental Equipment', 5000, None), ('Chair bought on loan', 'Bank Loan', None, 5000)]),
      ('02/03/2025', 'Transfer', None, None, [('To savings', 'Checking', None, 200), ('To savings', 'Savings (9576)', 200, None)])]
def book(title, period, rows, path):
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = title[:31]
    for r in [[CO], [title], [period], []] + rows + [[], [FOOT]]: ws.append(r)
    wb.save(path); return path
def make(d):
    j = [[None, 'Date', 'Transaction Type', 'Num', 'Name', 'Memo/Description', 'Account', 'Debit', 'Credit']]
    for t in TX:
        for i, l in enumerate(t[4]): j.append([None, t[0] if not i else None, t[1] if not i else None, t[2] if not i else None, t[3] if not i else None, l[0], l[1], l[2], l[3]])
        j.append([None, None, None, None, None, None, None, 1, 1]); j.append([])
    j.append(['TOTAL', None, None, None, None, None, None, 7180, 7180])
    bs = [[None, 'Total'], ['ASSETS'], ['   Current Assets'], ['      Bank Accounts'], ['         Checking', F(-80)], ['         Savings (9576)', F(200)], ['      Total Bank Accounts', '=(B9)+(B10)'], ['   Total Current Assets', '=B11'],
          ['   Fixed Assets'], ['      Dental Equipment', F(5000)], ['      z-Accumulated Depreciation', F(-100)], ['   Total Fixed Assets', '=(B14)+(B15)'], ['TOTAL ASSETS', '=(B12)+(B16)'], ['LIABILITIES AND EQUITY'], ['   Liabilities'],
          ['      Long-Term Liabilities'], ['         Bank Loan', F(5000)], ['      Total Long-Term Liabilities', '=B21'], ['   Total Liabilities', '=B22'], ['   Equity'], ['      Retained Earnings', F(0)], ['      Net Income', F(20)], ['   Total Equity', '=(B25)+(B26)'], ['TOTAL LIABILITIES AND EQUITY', '=(B23)+(B27)']]
    pl = [[None, 'Total'], ['Income'], ['   Sales', F(1000)], ['Total Income', '=B7'], ['Gross Profit', '=B8'], ['Expenses'], ['   Auto Expense'], ['      Parking & Tolls', F(30)], ['   Total Auto Expense', '=B12'], ['   Office Supplies & Software', F(50)], ['   Rent & Lease', F(800)],
          ['Total Expenses', '=(B13)+(B14)+(B15)'], ['Net Operating Income', '=(B9)-(B16)'], ['Other Expenses'], ['   Depreciation Expense', F(100)], ['Total Other Expenses', '=B19'], ['Net Other Income', '=-(B20)'], ['Net Income', '=(B17)+(B21)']]
    tb = [[None, 'Debit', 'Credit'], ['Checking', None, F(80)], ['Savings (9576)', F(200), None], ['Dental Equipment', F(5000), None], ['z-Accumulated Depreciation', None, F(100)], ['Bank Loan', None, F(5000)], ['Retained Earnings', None, F(0)], ['Sales', None, F(1000)],
          ['Auto Expense:Parking & Tolls', F(30), None], ['Office Supplies & Software', F(50), None], ['Rent & Lease', F(800), None], ['Depreciation Expense', F(100), None], ['TOTAL', '=SUM(B6:B16)', '=SUM(C6:C16)']]
    ve = [[None, 'Vendor', 'Phone Numbers', 'Email', 'Full Name', 'Address', 'Account #'], [None, 'Staples', 'Phone: (610) 555-0100', 'orders@staples.example', 'Pat Lee', '1 Main St', None], [None, 'Oak Realty']]
    cu = [[None, 'Customer', 'Phone Numbers', 'Email', 'Full Name', 'Billing Address', 'Shipping Address'], [], ['This report contains no data']]
    em = [[None, 'Employee', 'Phone Numbers', 'Email', 'Address'], [None, 'Dr. Ana Ruiz']]
    P = lambda n: os.path.join(d, n)
    return [book('Journal', 'All Dates', j, P('Journal.xlsx')), book('Balance Sheet', 'All Dates', bs, P('Balance_sheet.xlsx')), book('Profit and Loss', 'All Dates', pl, P('Profit_and_loss.xlsx')), book('Trial Balance', 'All Dates', tb, P('Trial_balance.xlsx')),
            book('Vendor Contact List', None, ve, P('Vendors.xlsx')), book('Customer Contact List', None, cu, P('Customers.xlsx')), book('Employee Contact List', None, em, P('Employees.xlsx'))]

async def main():
    d = tempfile.mkdtemp(prefix='vb_qbo_'); files = make(d)
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='vb_qbo_p_'), viewport={'width': 1440, 'height': 900})
        pg = ctx.pages[0]; errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        ev = pg.evaluate
        await pg.goto(URL); await pg.wait_for_selector('#newco')
        check(await pg.locator('[data-testid=qb-newco]').count() == 1 and 'Alt+Q' in await pg.inner_text('#main'), 'Company screen offers "Create from QuickBooks files" (Alt+Q)')
        await pg.set_input_files('[data-testid=qb-newco]', files)
        await pg.wait_for_selector('[data-testid=migrate-preview]', timeout=20000)
        check(await ev('OB.ui.book.company.name') == CO, 'The company is created and named as the reports name it', await ev('OB.ui.book.company.name'))
        check(await ev('location.hash') == '#/migrate', 'It opens on the import preview')
        rows = await pg.inner_text('.mg-files')
        check('Journal — 7 transactions' in rows and 'Trial Balance' in rows and 'Vendor list (2)' in rows and 'empty' in rows and 'Not a recognised' not in rows, 'All seven Excel files are recognised', rows)
        prev = await pg.inner_text('[data-testid=migrate-preview]')
        check('not fully explained' not in prev and 'Fix these' not in prev, 'Amounts written as formulas are read: nothing is left unexplained', prev[:1500])
        check(await ev('OB.ui.book.transactions.length') == 0, 'Nothing is posted before Import is pressed')
        await pg.screenshot(path='/tmp/probe/qbo_preview.png', full_page=True)
        await pg.click('#mg-go'); await pg.wait_for_selector('[data-testid=migrate-result]', timeout=30000)
        res = await pg.inner_text('[data-testid=migrate-result]')
        check('Every account balance equals QuickBooks (11 accounts checked)' in res and '7 transactions' in res, 'Result: every balance equals the Trial Balance', res[:300])
        st = await ev("(()=>{const b=OB.ui.book,a=n=>b.accounts.find(x=>x.name===n),k=t=>b.transactions.filter(x=>x.type===t).length;return {chk:b.rawBalance(a('Checking').id),loan:a('Bank Loan').type,par:a('Parking & Tolls').parentId===a('Auto Expense').id,dep:k('deposit'),exp:k('expense'),chq:k('check'),jr:k('journal'),tr:k('transfer'),v:b.contacts.filter(c=>c.kind==='vendor').length,from:b.company.imports[0].from,basis:b.company.basis}})()")
        check(st['chk'] == -8000 and st['loan'] == 'ltl' and st['par'], 'Balances, account types and sub-accounts are right', st)
        check([st['dep'], st['exp'], st['chq'], st['jr'], st['tr']] == [1, 2, 1, 2, 1] and st['v'] == 3, 'Deposits, expenses, checks, journals, a transfer and the vendors (employee kept as a payee)', st)
        check(st['from'] == 'QuickBooks Online' and st['basis'] == 'accrual', 'Import history says QuickBooks Online; basis taken from the report', st)
        await pg.screenshot(path='/tmp/probe/qbo_result.png', full_page=True)
        # the same files dropped into this company (which now has transactions): offer a new company from them
        await pg.set_input_files('#mg-file', files); await pg.wait_for_selector('#mg-newco', timeout=15000)
        check('Create a new company from these files' in await pg.inner_text('#mg-newco') and await ev("document.querySelector('#mg-go').disabled"), 'A company with transactions cannot be imported into; a new company is offered')
        await pg.click('#mg-newco'); await pg.wait_for_function("OB.ui.book && OB.ui.book.transactions.length === 0 && !!document.querySelector('[data-testid=migrate-preview]')", timeout=20000)
        n = await ev("OB.db.listCompanies().then(l=>l.filter(c=>c.name==='%s').length)" % CO)
        check(n == 2 and await ev("!document.querySelector('#mg-go').disabled"), 'The new company opens with the files loaded and ready to import', n)
        # keyboard: Alt+Q on the company screen opens the file chooser
        await ev('OB.ui.closeCompany()'); await pg.wait_for_selector('#newco')
        async with pg.expect_file_chooser(timeout=5000) as fc: await pg.keyboard.press('Alt+KeyQ')
        ch = await fc.value; check(ch.is_multiple(), 'Alt+Q opens the file chooser for several files')
        # a file that is not a QuickBooks export is refused with a plain message, and no company is made
        junk = os.path.join(d, 'notes.xlsx'); wb = openpyxl.Workbook(); wb.active.append(['hello', 1]); wb.save(junk)
        before = await ev('OB.db.listCompanies().then(l=>l.length)')
        await ch.set_files([junk]); await pg.wait_for_selector('.modal-backdrop, .toast.error, [role=alert]', timeout=8000)
        check(await ev('OB.db.listCompanies().then(l=>l.length)') == before, 'Unknown files create no company')
        check(not errors, 'No page errors', errors[:3])
        await ctx.close()
    ok = sum(1 for r in results if r[0]); print('\n%d passed, %d failed' % (ok, len(results) - ok)); sys.exit(0 if ok == len(results) else 1)
asyncio.run(main())

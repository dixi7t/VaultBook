"""
VaultBook 1.29 Invoice Payment Days (MIS) UI test (developer-only): report in the Reports list, Summary by customer with
the glance strip, drill to a customer's invoices, By payment view, status filter, Fields chooser (remove, reorder,
remembered), Excel/CSV export uses the chosen fields. Synthetic company only.
Usage: python3 mis_ui.py /path/to/app/index.html
"""
import asyncio, os, sys, tempfile
from playwright.async_api import async_playwright

APP = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'index.html'))
results = []
def check(cond, name, detail=''):
    results.append((bool(cond), name)); print(('  ok   ' if cond else '  FAIL ') + name + (('  [' + str(detail) + ']') if detail and not cond else ''))

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='vb_mis_'), viewport={'width': 1440, 'height': 900}, accept_downloads=True)
        pg = ctx.pages[0]; errors = []; pg.on('pageerror', lambda e: errors.append(str(e))); ev = pg.evaluate
        await pg.goto('file://' + APP); await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'MIS Co'); await pg.click('#newco button[type=submit]'); await pg.wait_for_function('OB.ui.book'); await pg.wait_for_timeout(1200)
        go = lambda h: ev("h => location.hash = h", h)
        ids = await ev("""async () => {
          const b = OB.ui.book, svc = b.accounts.find(a => a.type === 'income').id, ck = b.accounts.find(a => a.type === 'bank').id;
          const a = await b.saveContact({ kind: 'customer', name: 'ACME Imaging' }), d = await b.saveContact({ kind: 'customer', name: 'Beta Clinic' });
          const inv = await b.saveTransactions([
            { type: 'invoice', date: '2026-01-10', dueDate: '2026-01-25', number: 'A1', contactId: a.id, lines: [{ accountId: svc, amount: '1000' }] },
            { type: 'invoice', date: '2026-01-10', dueDate: '2026-02-09', number: 'A2', contactId: a.id, lines: [{ accountId: svc, amount: '2000' }] },
            { type: 'invoice', date: '2026-02-01', dueDate: '2026-03-03', number: 'A3', contactId: a.id, lines: [{ accountId: svc, amount: '800' }] },
            { type: 'invoice', date: '2026-02-10', dueDate: '2026-03-12', number: 'B1', contactId: d.id, lines: [{ accountId: svc, amount: '500' }] }]);
          await b.saveTransactions([
            { type: 'payment', date: '2026-01-25', number: '501', contactId: a.id, accountId: ck, amount: '1000', applications: [{ txnId: inv[0].id, amount: '1000' }] },
            { type: 'payment', date: '2026-02-01', contactId: a.id, accountId: ck, amount: '500', applications: [{ txnId: inv[1].id, amount: '500' }] },
            { type: 'payment', date: '2026-03-11', contactId: a.id, accountId: ck, amount: '1500', applications: [{ txnId: inv[1].id, amount: '1500' }] },
            { type: 'payment', date: '2026-03-02', contactId: d.id, accountId: ck, amount: '500', applications: [{ txnId: inv[3].id, amount: '500' }] }]);
          return { a: a.id, d: d.id };
        }""")
        base = '#/report/paydays?range=custom&from=2026-01-01&to=2026-03-31&upto=2026-03-31'

        await go('#/reports'); await pg.wait_for_selector('.report-links')
        check(await pg.locator('.report-links a[href="#/report/paydays"]').count() == 1, 'Invoice Payment Days is in the Reports list (Management (MIS))')

        # 1.29.1 drill-down is the standard view: customers, each opening to its invoices (one level, payments on the invoice row)
        await go(base); await pg.wait_for_selector('[data-testid=pd-table].pd-tree')
        vis = lambda: ev("[...document.querySelectorAll('.pd-tree tbody tr[data-path]')].filter(r => !r.classList.contains('pd-hide')).map(r => r.dataset.level).join('')")
        check(await vis() == '00', 'Drill-down opens with one row per customer', await vis())
        await pg.click('.pd-tree tr.pd-l0:has-text("ACME") [data-tog]')
        check(await vis() == '01110', 'Clicking ▸ on a customer shows its invoices', await vis())
        row = await ev("[...document.querySelectorAll('.pd-tree tr.pd-l1')].find(r => r.textContent.includes('Invoice A2')).innerText.replace(/\\s+/g, ' ')")
        check('01/10/2026' in row and '03/11/2026' in row and '60' in row and '30' in row and 'Paid' in row and '02/01/2026 $500.00' in row, 'Invoice row: invoice date, payments with dates, paid in full, days to pay, days late, status — no second drill', row)
        check(await pg.locator('.pd-tree tr.pd-l1 [data-tog]').count() == 0 and await pg.locator('.pd-tree tr.pd-l2').count() == 0, 'Invoices do not drill further')
        await pg.click('[data-testid=pd-expand]'); check(await vis() == '011101', 'Expand all customers', await vis())
        await pg.click('[data-testid=pd-collapse]'); check(await vis() == '00', 'Collapse all')
        async with pg.expect_download() as dlx: await pg.click('button[data-x=xlsx]')
        import zipfile; z = zipfile.ZipFile(await (await dlx.value).path()); sx = z.read('xl/worksheets/sheet1.xml').decode()
        check('outlineLevel="1"' in sx and 'outlineLevel="2"' not in sx and 'summaryBelow="0"' in sx, 'Excel: invoices are grouped rows under their customer (+/− and 1 2)')

        await go(base + '&view=summary'); await pg.wait_for_selector('[data-testid=pd-table]:not(.pd-tree)')
        g = await pg.inner_text('[data-testid=pd-glance]')
        check('4' in g and '31.7' in g and '66.7%' in g and '58 days' in g, 'Glance strip: invoices, avg days to pay, paid on time, oldest open', g.replace('\n', ' '))
        heads = await ev("[...document.querySelectorAll('[data-testid=pd-table] thead th')].map(t => t.textContent).join('|')")
        check(heads.startswith('Customer|Invoices|Invoiced|Received|Open balance|Avg days to pay'), 'Summary by customer is the standard view', heads)
        row = await ev("[...document.querySelectorAll('[data-testid=pd-table] tbody tr')].find(r => r.textContent.includes('ACME')).innerText")
        check('37.5' in row and '38.7' in row and '50%' in row, 'ACME: avg 37.5, weighted 38.7, 50% on time', row)

        await pg.click('[data-testid=pd-table] a:has-text("ACME Imaging")'); await pg.wait_for_function("location.hash.includes('view=invoice')"); await pg.wait_for_selector('[data-testid=pd-table]')
        txt = await pg.inner_text('[data-testid=pd-table]')
        check('A2' in txt and 'B1' not in txt and 'Partly' not in txt and '60' in txt and 'Open' in txt, "Clicking a customer opens its invoices with days to pay and status", txt[:300])

        await go(base + '&view=payment&by=payment&from=2026-03-01'); await pg.wait_for_selector('[data-testid=pd-table]')
        n = await pg.locator('[data-testid=pd-table] tbody tr:not(.grand)').count()
        check(n == 2, 'By payment, period by date received: only March receipts', n)

        await go(base + '&view=invoice&status=open'); await pg.wait_for_selector('[data-testid=pd-table]')
        check(await pg.locator('[data-testid=pd-table] tbody tr:not(.grand)').count() == 1, 'Status filter: not paid')
        await pg.select_option('#pd-status', ''); await pg.click('#rp-form button[type=submit]'); await pg.wait_for_function("!location.hash.includes('status=open')")
        await pg.wait_for_selector('[data-testid=pd-table]')
        check(await pg.locator('[data-testid=pd-table] tbody tr:not(.grand)').count() == 4, 'Toolbar Run report applies the change')

        # Fields: remove Due date, move Days to pay to the front
        await pg.click('[data-testid=rp-fields]'); await pg.wait_for_selector('[data-testid=pd-flist]')
        await pg.uncheck('[data-testid=pd-flist] input[data-k=dueDate]')
        for _ in range(7):
            i = await ev("[...document.querySelectorAll('[data-testid=pd-flist] input')].findIndex(x => x.dataset.k === 'daysToPay')")
            if i == 0: break
            await pg.click(f'[data-testid=pd-flist] [data-up="{i}"]')
        await pg.click('.modal button:has-text("Apply")'); await pg.wait_for_function("location.hash.includes('f=') && (document.querySelector('[data-testid=pd-table] thead th') || {}).textContent === 'Days to pay'", timeout=5000)
        heads = await ev("[...document.querySelectorAll('[data-testid=pd-table] thead th')].map(t => t.textContent)")
        check(heads[0] == 'Days to pay' and 'Due date' not in heads, 'Fields: removed and reordered', heads)
        await go(base + '&view=invoice'); await pg.wait_for_selector('[data-testid=pd-table]')
        heads2 = await ev("[...document.querySelectorAll('[data-testid=pd-table] thead th')].map(t => t.textContent)")
        check(heads2 == heads, 'The field choice is remembered for the view', heads2)
        async with pg.expect_download() as dl: await pg.click('button[data-x=csv]')
        csv = open(await (await dl.value).path(), encoding='utf-8-sig').read()
        check('Days to pay' in csv and 'Due date' not in csv and 'Total' in csv, 'CSV export uses the chosen fields', csv[:200])

        # 1.29.2 income accounts on each invoice: list, count and one column per income account
        await go(base); await pg.wait_for_selector('.pd-tree')
        await pg.click('[data-testid=rp-fields]'); await pg.wait_for_selector('[data-testid=pd-flist]')
        lbl = await ev("OB.ui.book.accountLabel(OB.ui.book.accounts.find(a => a.type === 'income').id)")
        key = await ev("'inc:' + OB.ui.book.accounts.find(a => a.type === 'income').id")
        check(await pg.locator(f'[data-testid=pd-flist] input[data-k="{key}"]').count() == 1, 'Fields offer a column for the income account used: ' + lbl)
        await pg.check('[data-testid=pd-flist] input[data-k=incomeText]'); await pg.check(f'[data-testid=pd-flist] input[data-k="{key}"]'); await pg.check('[data-testid=pd-flist] input[data-k=incomeCount]')
        await pg.click('.modal button:has-text("Apply")'); await pg.wait_for_function("location.hash.includes('incomeText')"); await pg.wait_for_timeout(300)
        heads = await ev("[...document.querySelectorAll('[data-testid=pd-table] thead th')].map(t => t.textContent)")
        check('Income accounts' in heads and lbl in heads and 'No. of income accounts' in heads, 'Income account fields show as columns', heads)
        await pg.click('[data-testid=pd-expand]')
        row = await ev("[...document.querySelectorAll('.pd-tree tr.pd-l1')].find(r => r.textContent.includes('Invoice A2')).innerText")
        check((lbl + ' $2,000.00') in row and '2,000.00' in row, 'Invoice row lists its income account with the amount', row)

        check(not errors, 'No page errors', errors[:3])
        await ctx.close()
    ok = sum(1 for r in results if r[0]); print('\n%d passed, %d failed' % (ok, len(results) - ok)); sys.exit(0 if ok == len(results) else 1)
asyncio.run(main())

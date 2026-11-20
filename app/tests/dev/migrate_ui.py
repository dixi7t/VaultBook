"""
VaultBook QuickBooks migration UI test (developer-only).
Creates a new company with "Bring in my books from QuickBooks next", drops the synthetic
QuickBooks export fixtures (tests/fixtures/qb — no client data), imports, and checks the
result, the new QuickBooks-style reports, the Products and services list and the item column.
Requires: Python 3 + Playwright (Chromium).
Usage: python3 migrate_ui.py /path/to/app/index.html
"""
import asyncio, glob, os, sys, tempfile
from playwright.async_api import async_playwright

async def pick_item(pg, row, item_id):
    """Type the item's name in the line's Item box and press Enter (type-ahead item list)."""
    name = await pg.evaluate("id => OB.ui.book.itemById[id].name", item_id)
    box = row + ' .combo:has(input[data-f=itemId]) .combo-input'
    await pg.click(box); await pg.fill(box, name); await pg.wait_for_timeout(120); await pg.keyboard.press('Enter')


APP = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'index.html'))
URL = 'file://' + APP
FIX = sorted(glob.glob(os.path.join(os.path.dirname(APP), 'tests', 'fixtures', 'qb', '*')))
results = []

def check(cond, name, detail=''):
    results.append((bool(cond), name))
    print(('  ok   ' if cond else '  FAIL ') + name + (('  [' + str(detail) + ']') if detail and not cond else ''))

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='vb_mg_'), viewport={'width': 1440, 'height': 900})
        pg = ctx.pages[0]; errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        ev = pg.evaluate
        async def h(): return await ev('location.hash')
        check(len(FIX) >= 6, 'Synthetic QuickBooks fixtures found', len(FIX))

        await pg.goto(URL); await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'Migrated Co')
        await pg.check('[data-testid=newco-qb]')
        await pg.click('#newco button[type=submit]')
        await pg.wait_for_selector('[data-testid=migrate]', timeout=15000)
        check(await h() == '#/migrate', 'New company with the QuickBooks option opens the migration screen', await h())

        await pg.set_input_files('#mg-file', FIX)
        await pg.wait_for_selector('[data-testid=migrate-preview]', timeout=15000)
        prev = await pg.inner_text('[data-testid=migrate-preview]')
        check('Accounts' in prev and 'Customers' in prev, 'Preview lists accounts and customers to import', prev[:200])
        check(await ev("!document.querySelector('#mg-go').disabled"), 'Import button is enabled for a complete set of files')
        await pg.click('#mg-go')
        await pg.wait_for_selector('[data-testid=migrate-result]', timeout=30000)
        res = await pg.inner_text('[data-testid=migrate-result]')
        check('Every account balance equals QuickBooks' in res, 'Result: every account balance equals QuickBooks', res[:300])
        ar = await ev("OB.ui.book.accountBalance(OB.ui.book.sys('AR').id)")
        check(ar == 120000, 'A/R balance after import', ar)

        # Open Invoices is reachable from Reports
        await pg.goto(URL + '#/reports'); await pg.wait_for_selector('.report-links')
        links = await ev("[...document.querySelectorAll('.report-links a')].map(a => a.getAttribute('href'))")
        for k in ['openinv', 'unpaidbills', 'custdetail', 'venddetail', 'salescust', 'salesitem', 'depdetail', 'checkdetail', 'acctlist', 'custlist', 'vendlist']:
            check(('#/report/' + k) in links, 'Reports page lists ' + k)
        check('#/items' in links, 'Reports page links the Product/Service list')
        for k in ['openinv', 'unpaidbills', 'custdetail', 'venddetail']:
            await pg.goto(URL + '#/report/' + k + '?asOf=2099-12-31'); await pg.wait_for_selector('article.report', timeout=10000)
            t = await pg.inner_text('article.report')
            check('✓ Ties to' in t, k + ' ties to its control account', t[-200:])
        for k in ['salescust', 'salesitem', 'depdetail', 'checkdetail', 'acctlist', 'custlist', 'vendlist']:
            await pg.goto(URL + '#/report/' + k + '?range=all&from=1900-01-01&to=2099-12-31&asOf=2099-12-31'); await pg.wait_for_selector('article.report', timeout=10000)
            n = await ev("document.querySelectorAll('article.report tbody tr').length")
            check(n >= 2 and not await ev("!!document.querySelector('article.report .banner.danger')"), k + ' renders rows', n)
        await pg.goto(URL + '#/report/openinv?asOf=2099-12-31'); await pg.wait_for_selector('article.report')
        check('1003' in await pg.inner_text('article.report'), 'Open Invoices shows the unpaid invoice 1003')

        # Products and services
        await pg.goto(URL + '#/items'); await pg.wait_for_selector('[data-testid=items-table]', timeout=10000)
        check(await ev("document.querySelectorAll('[data-testid=items-table] tbody tr').length") == 3, 'Products and services lists the 3 imported items')
        await pg.click('[data-testid=item-new]'); await pg.wait_for_selector('#it-name')
        await pg.fill('#it-name', 'Rush fee'); await pg.fill('#it-price', '75')
        await pg.click('.modal .btn.primary'); await pg.wait_for_timeout(500)
        check(await ev("OB.ui.book.items.some(i => i.name === 'Rush fee' && i.price === 7500)"), 'New product/service saved from the editor')

        # item column on an invoice fills price
        await pg.goto(URL + '#/txn/new?type=invoice'); await pg.wait_for_selector('input[data-f=itemId]', state='attached', timeout=10000)
        rid = await ev("OB.ui.book.items.find(i => i.name === 'Rush fee').id")
        await pick_item(pg, 'tr.line:nth-child(1)', rid); await pg.wait_for_timeout(300)
        rate = await ev("(document.querySelector('tr [data-f=rate]') || {}).value || (document.querySelector('tr [data-f=amount]') || {}).value")
        check(rate and '75' in rate, 'Choosing an item fills the line price', rate)

        # entry points (leave the unsaved invoice through the unsaved-entry guard)
        await ev("location.hash = '#/gateway'"); await pg.wait_for_timeout(300)
        if await pg.query_selector('.modal button.danger'): await pg.click('.modal button.danger')
        await pg.wait_for_selector('.gateway', timeout=10000)
        await ev("location.hash = '#/gateway?m=company'"); await pg.wait_for_selector('.gw-item')
        check('Import from QuickBooks' in await pg.inner_text('.gw-menu'), 'Gateway › Company shows Import from QuickBooks')
        await ev("location.hash = '#/gateway?m=reports'"); await pg.wait_for_selector('.gw-item')
        check('Open Invoices' in await pg.inner_text('.gw-menu'), 'Gateway › Display More Reports shows Open Invoices')
        await pg.goto(URL + '#/settings?tab=data'); await pg.wait_for_selector('[data-testid=settings-migrate]')
        check(True, 'Settings › Import and export links the migration')
        await pg.goto(URL + '#/migrate'); await pg.wait_for_selector('[data-testid=migrate]')
        check(await ev("document.querySelector('#mg-go') ? document.querySelector('#mg-go').disabled : true"), 'A company with transactions cannot be imported into twice')

        check(not errors, 'No page errors', errors[:3])
        await ctx.close()
    bad = [n for ok_, n in results if not ok_]
    print('\n%d passed, %d failed' % (len(results) - len(bad), len(bad)))
    sys.exit(1 if bad else 0)

asyncio.run(main())

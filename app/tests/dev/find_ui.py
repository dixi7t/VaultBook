"""
VaultBook 1.27 Find UI test (developer-only): Ctrl+F, the All results box (plain words and field:value), Simple,
Advanced conditions (add, change field, match any, all dates), Change in Advanced, sorting, saved searches,
export dialog, the command bar's "Search all company data" row. Synthetic sample company only.
Usage: python3 find_ui.py /path/to/app/index.html
"""
import asyncio, os, sys, tempfile
from playwright.async_api import async_playwright

APP = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'index.html'))
results = []
def check(cond, name, detail=''):
    results.append((bool(cond), name)); print(('  ok   ' if cond else '  FAIL ') + name + (('  [' + str(detail) + ']') if detail and not cond else ''))

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='vb_find_'), viewport={'width': 1440, 'height': 900})
        pg = ctx.pages[0]; errors = []; pg.on('pageerror', lambda e: errors.append(str(e))); ev = pg.evaluate
        await pg.goto('file://' + APP); await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'Find Co'); await pg.check('#newco input[name=sample]')
        await pg.click('#newco button[type=submit]'); await pg.wait_for_function('OB.ui.book'); await pg.wait_for_timeout(1500)
        go = lambda h: ev("h => location.hash = h", h)
        ids = await ev("""async () => {
          const b = OB.ui.book, svc = b.accounts.find(a => a.type === 'income').id, ck = b.accounts.find(a => a.type === 'bank').id;
          const c = await b.saveContact({ kind: 'customer', name: 'Sunrise Health', email: 'ap@sunrise.example' });
          const i1 = await b.saveTransaction({ type: 'invoice', date: '2024-02-10', number: '7001', contactId: c.id, memo: 'Old year fees', lines: [{ accountId: svc, amount: '5000', description: 'Reading fees' }] });
          const i2 = await b.saveTransaction({ type: 'invoice', date: '2026-05-04', number: '7162', contactId: c.id, lines: [{ accountId: svc, amount: '340074.75', description: 'MRI reads' }, { accountId: svc, amount: '125', description: 'Courier' }] });
          await b.importBankLines(ck, [{ date: '2026-06-11', description: 'ORIG CO NAME:SUNRISE HEALTH ACH', amount: 3000000 }], { fileName: 'f.csv' });
          return { c: c.id, i1: i1.id, i2: i2.id };
        }""")

        # Ctrl+F opens Find, the box reads plain words
        await go('#/gateway'); await pg.wait_for_selector('.gw-item'); await pg.keyboard.press('Control+f'); await pg.wait_for_selector('[data-testid=fd-q]')
        check(await ev("document.activeElement.id") == 'fd-q', 'Ctrl+F opens Find with the cursor in the search box')
        await pg.fill('[data-testid=fd-q]', 'invoices over 1000 from sunrise health'); await pg.keyboard.press('Enter'); await pg.wait_for_selector('[data-testid=fd-results]')
        nums = await ev("[...document.querySelectorAll('[data-testid=fd-results] tbody tr')].map(r => r.children[2].textContent.trim()).sort().join()")
        check(nums == '7001,7162', 'Plain words: type, amount, customer — every date, 2024 included', nums)
        rd = await pg.inner_text('[data-testid=fd-read]')
        check('Sunrise Health' in rd and 'all dates' in rd, 'It says how it read the search', rd)
        check(await pg.locator('[data-testid=fd-sec-ct]').count() == 1, 'The customer is listed too')
        await pg.fill('[data-testid=fd-q]', 'courier'); await pg.keyboard.press('Enter'); await pg.wait_for_function("(document.querySelector('[data-testid=fd-read]') || {}).textContent.includes('courier')")
        why = await pg.inner_text('[data-testid=fd-results] .fd-why')
        check('Line 2: Courier' in why, 'Line descriptions are searched and the match is shown', why)
        await pg.fill('[data-testid=fd-q]', '30000'); await pg.keyboard.press('Enter'); await pg.wait_for_selector('[data-testid=fd-sec-bl]')
        check(True, 'A bank feed line is found by amount')
        await pg.fill('[data-testid=fd-q]', 'memo:"old year"'); await pg.keyboard.press('Enter'); await pg.wait_for_function("(document.querySelector('[data-testid=fd-read]') || {}).textContent.includes('old year')")
        check(await pg.locator('[data-testid=fd-results] tbody tr').count() == 1, 'memo:"…" field search')

        # Change in Advanced keeps the conditions; add one; match any
        await pg.fill('[data-testid=fd-q]', 'invoices sunrise health'); await pg.keyboard.press('Enter'); await pg.wait_for_selector('[data-testid=fd-to-adv]')
        await pg.click('[data-testid=fd-to-adv]'); await pg.wait_for_selector('[data-testid=fd-conds]')
        check(await pg.locator('.fd-cond').count() == 2 and await pg.locator('[data-testid=fd-results] tbody tr').count() == 2, 'Change in Advanced brings the conditions and results')
        await pg.click('[data-testid=fd-add]'); last = pg.locator('.fd-cond').last
        await last.locator('[data-cf]').select_option('amount'); await pg.wait_for_timeout(100)
        last = pg.locator('.fd-cond').last
        await last.locator('[data-co]').select_option('gt'); await pg.wait_for_timeout(100)
        last = pg.locator('.fd-cond').last
        await last.locator('[data-cv]').fill('100000'); await pg.click('[data-testid=fd-find]'); await pg.wait_for_selector('[data-testid=fd-read]')
        check(await pg.locator('[data-testid=fd-results] tbody tr').count() == 1, 'Adding "amount > 100,000" narrows to one invoice')
        await pg.check('[name=fd-m][value=any]'); await pg.click('[data-testid=fd-find]'); await pg.wait_for_timeout(400)
        n_any = await pg.locator('[data-testid=fd-results] tbody tr').count()
        check(n_any > 2, 'Match any widens the results', n_any)
        await pg.check('[name=fd-m][value=all]'); await pg.click('[data-testid=fd-find]'); await pg.wait_for_timeout(400)
        # period
        await pg.select_option('#fd-ap', 'custom'); await pg.fill('.fd-custom [data-pf]', '2024-01-01'); await pg.fill('.fd-custom [data-pt]', '2024-12-31')
        await pg.locator('.fd-cond').last.locator('[data-crm]').click(); await pg.click('[data-testid=fd-find]'); await pg.wait_for_timeout(400)
        n = await ev("[...document.querySelectorAll('[data-testid=fd-results] tbody tr')].map(r => r.children[2].textContent.trim()).join()")
        check(n == '7001', 'A custom period (2024) finds only that year', n)
        # sort, save, reuse
        await pg.select_option('#fd-ap', 'all'); await pg.click('[data-testid=fd-find]'); await pg.wait_for_timeout(400)
        await pg.click('[data-testid=fd-sort-amount]'); await pg.wait_for_timeout(300)
        first = await ev("document.querySelector('[data-testid=fd-results] tbody tr').children[2].textContent.trim()")
        check(first == '7001', 'Sort by amount (smallest first)', first)
        await pg.click('[data-testid=fd-save]'); await pg.wait_for_selector('.modal input'); await pg.fill('.modal input', 'Sunrise invoices'); await pg.click('.modal .btn.primary'); await pg.wait_for_selector('[data-testid=fd-saved]')
        await go('#/find?tab=adv'); await pg.wait_for_selector('[data-testid=fd-saved]')
        await pg.select_option('[data-testid=fd-saved]', '0'); await pg.wait_for_selector('[data-testid=fd-results]')
        check(await pg.locator('[data-testid=fd-results] tbody tr').count() == 2, 'A saved search runs again from the list')
        await pg.click('[data-testid=fd-export]'); await pg.wait_for_selector('.modal'); check('2 transactions' in await pg.inner_text('.modal'), 'Export offers CSV and Excel'); await pg.keyboard.press('Escape')

        # Simple
        await go('#/find?tab=simple'); await pg.wait_for_selector('[data-testid=fd-simple]')
        await pg.select_option('[data-testid=fd-simple] select[name=type]', 'invoice'); await pg.select_option('[data-testid=fd-simple] select[name=name]', ids['c'])
        await pg.fill('[data-testid=fd-simple] input[name=amt]', '340199.75'); await pg.click('[data-testid=fd-find]'); await pg.wait_for_selector('[data-testid=fd-results]')
        check(await pg.locator('[data-testid=fd-results] tbody tr').count() == 1, 'Simple: type, name and amount')
        await pg.click('[data-testid=fd-results] tbody tr'); await pg.wait_for_function("location.hash.indexOf('#/txn/') === 0")
        check(True, 'A result opens the transaction')

        # command bar row
        await go('#/transactions'); await pg.wait_for_timeout(600); await ev('OB.ui.openPalette()'); await pg.wait_for_selector('#pal-q')
        await pg.keyboard.type('sunrise courier'); await pg.wait_for_timeout(400)
        check(await pg.locator('text=Search all company data for').count() >= 1, 'The command bar offers "Search all company data"')
        await pg.locator('text=Search all company data for').first.click(); await pg.wait_for_selector('[data-testid=fd-results]')
        check(await pg.locator('[data-testid=fd-results] tbody tr').count() == 1, 'and opens Find with the words')

        # Ctrl+F on the Sales Register still filters the register (TallyPrime); elsewhere it opens Find (QuickBooks)
        await go('#/vreg/sales'); await pg.wait_for_selector('[data-testid=vr-vouchers], .vr-months, #vr-side-t'); await pg.wait_for_timeout(300)
        await pg.keyboard.press('Control+f'); await pg.wait_for_timeout(500)
        check((await ev("location.hash")).startswith('#/vreg') and await ev("document.activeElement && document.activeElement.id") == 'vr-contact', 'Ctrl+F on the Sales Register opens its filter')
        await go('#/report/pnl'); await pg.wait_for_selector('#st-table table'); await pg.locator('#main').click(position={'x': 5, 'y': 5}); await pg.keyboard.press('Control+f'); await pg.wait_for_selector('[data-testid=fd-q]')
        check(True, 'Ctrl+F on other screens opens Find')

        check(not errors, 'No page errors', errors[:3])
        await ctx.close()
    ok = sum(1 for r in results if r[0]); print('\n%d passed, %d failed' % (ok, len(results) - ok)); sys.exit(0 if ok == len(results) else 1)
asyncio.run(main())

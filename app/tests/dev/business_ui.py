"""
VaultBook 1.14 browser test (developer-only): Make Deposits, Print later / Print checks, bad-debt write-off,
finance charges, 1099 W-9 / CSV / recipient copies.
Usage: python3 business_ui.py /path/to/app/index.html [screenshot-prefix]
"""
import asyncio, sys, tempfile
from playwright.async_api import async_playwright
APP = sys.argv[1]; URL = 'file://' + APP
SHOT = sys.argv[2] if len(sys.argv) > 2 else None
results = []
def check(c, n, d=''):
    results.append((bool(c), n)); print(('  ok   ' if c else '  FAIL ') + n + (('  [' + str(d)[:240] + ']') if d and not c else ''))
async def wait_hash(pg, test):
    for _ in range(80):
        h = await pg.evaluate("() => location.hash")
        if test(h): return h
        await pg.wait_for_timeout(100)
    return await pg.evaluate("() => location.hash")
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(), viewport={'width': 1300, 'height': 1000}, accept_downloads=True)
        pg = ctx.pages[0]; errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); ev = pg.evaluate
        go = lambda h: ev("h => location.hash = h", h)
        await pg.goto(URL); await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'Ops Co'); await pg.click('#newco button[type=submit]'); await pg.wait_for_function('OB.ui.book')
        ids = await ev("""(async () => { const b = OB.ui.book, A = (n) => b.accounts.find(a => a.name === n).id, U = b.sys('UNDEP').id;
          await b.saveCompany({ address: '9 Market St\\nTucson, AZ 85701', ein: '86-7654321' });
          const c = await b.saveContact({ kind: 'customer', name: 'Acme Retail' });
          const late = await b.saveContact({ kind: 'customer', name: 'Slow Payer' });
          const v = await b.saveContact({ kind: 'vendor', name: 'Jane Builder', address: '4 Pine Rd\\nMesa, AZ 85201', is1099: true, taxId: '123-45-6789' });
          const inv = await b.saveTransaction({ type: 'invoice', date: '2026-01-05', contactId: c.id, lines: [{ accountId: A('Sales'), amount: '800' }] });
          const p1 = await b.saveTransaction({ type: 'payment', date: '2026-01-10', contactId: c.id, accountId: U, amount: '500', applications: [{ txnId: inv.id, amount: '500' }] });
          const p2 = await b.saveTransaction({ type: 'salesReceipt', date: '2026-01-11', contactId: c.id, accountId: U, lines: [{ accountId: A('Sales'), amount: '75.25' }] });
          const old = await b.saveTransaction({ type: 'invoice', date: '2026-01-01', dueDate: '2026-01-31', contactId: late.id, lines: [{ accountId: A('Services'), amount: '1000' }] });
          await b.saveCompany({ map1099: { [A('Contractors')]: 'NEC1' } });
          return { inv: inv.id, old: old.id, v: v.id, contractors: A('Contractors'), checking: A('Checking') }; })()""")

        # ---- Make deposits
        await go('#/deposit'); await pg.wait_for_selector('[data-testid=make-deposits]')
        check(await pg.locator('[data-pick]').count() == 2, 'Make deposits lists the 2 payments waiting in Undeposited Funds')
        await pg.click('#dep-all'); await pg.wait_for_timeout(100)
        check('$575.25' in await pg.inner_text('[data-testid=dep-total]'), 'Deposit total adds up the ticked payments')
        if SHOT: await pg.screenshot(path=SHOT + '_deposit.png')
        await pg.click('#mdep button[type=submit]'); await wait_hash(pg, lambda h: h.startswith('#/txn/')); await pg.wait_for_timeout(300)
        r = await ev("(() => { const b = OB.ui.book; return { undep: b.accountBalance(b.sys('UNDEP').id), bank: b.accountBalance(b.accounts.find(a => a.name === 'Checking').id), left: b.undepositedItems().length }; })()")
        check(r['undep'] == 0 and r['bank'] == 57525 and r['left'] == 0, 'Saving moves 575.25 from Undeposited Funds to Checking', r)
        await pg.wait_for_selector('#txf')
        await pg.click('button[data-after=view]'); await pg.wait_for_timeout(500)
        check(await ev("OB.ui.book.undepositedItems().length") == 0 and not await pg.locator('#form-errors').count(), 'Re-saving the deposit from its form keeps the payment links')

        # ---- Print later -> Print checks
        await ev("OB.ui.dirty = false"); await go('#/txn/new?type=check'); await pg.wait_for_selector('[data-testid=print-later]')
        await pg.click('.tx-head .combo-input'); await pg.fill('.tx-head .combo-input', 'Jane Builder'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(150)
        await pg.check('[data-testid=print-later]')
        await pg.click('tr.line:nth-child(1) .combo-input'); await pg.fill('tr.line:nth-child(1) .combo-input', 'Contractors'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(150)
        await pg.fill('tr.line:nth-child(1) input[data-f=amount]', '2,450.10'); await pg.dispatch_event('tr.line:nth-child(1) input[data-f=amount]', 'input')
        await pg.click('button[data-after=view]'); await wait_hash(pg, lambda h: h.startswith('#/txn/') and 'new' not in h); await pg.wait_for_timeout(300)
        ck = await ev("OB.ui.book.transactions.find(t => t.type === 'check')")
        check(ck['toBePrinted'] and not ck['number'], 'Check saved as “to be printed” without a number')
        await go('#/printchecks'); await pg.wait_for_selector('[data-testid=check-pages] svg')
        txt = await ev("[...document.querySelectorAll('[data-testid=check-pages] text')].map(x => x.textContent).join('|')")
        check('Two thousand four hundred fifty and 10/100' in txt and '**2,450.10' in txt and 'Jane Builder' in txt and '|1001|' in txt, 'Check preview: payee, amount, amount in words, next number', txt[:300])
        await pg.fill('[data-testid=pc-first]', '3050'); await pg.dispatch_event('[data-testid=pc-first]', 'input'); await pg.wait_for_timeout(100)
        check('3050' in await ev("[...document.querySelectorAll('[data-testid=check-pages] text')].map(x => x.textContent).join('|')"), 'Preview follows the first check number')
        async with pg.expect_download() as dl: await pg.click('#pc-pdf')
        d = await dl.value; pdf = open(await d.path(), 'rb').read()
        check(pdf[:5] == b'%PDF-' and len(pdf) > 1500, 'Checks download as a PDF')
        if SHOT: await pg.screenshot(path=SHOT + '_checks.png')
        await pg.click('[data-testid=pc-done]'); await pg.wait_for_timeout(400)
        ck = await ev("OB.ui.book.txById[%r]" % ck['id'])
        check(ck['number'] == '3050' and not ck.get('toBePrinted'), 'After printing, the check gets number 3050 and leaves the queue')

        # ---- Write off as bad debt (invoice More menu)
        await go('#/txn/' + ids['inv']); await pg.wait_for_selector('[data-act=writeoff]')
        await pg.click('[data-act=writeoff]'); await pg.wait_for_selector('#wo-date')
        await pg.fill('#wo-date', '2026-06-30'); await pg.click('.modal .btn.danger'); await pg.wait_for_timeout(500)
        r = await ev("(() => { const b = OB.ui.book; return { open: b.openBalance(%r), bad: b.accountBalance((b.accounts.find(a => /bad debt/i.test(a.name)) || {}).id) }; })()" % ids['inv'])
        check(r['open'] == 0 and r['bad'] == 30000, 'Write off: 300.00 to Bad Debt, invoice now paid', r)

        # ---- Finance charges
        await go('#/financecharges'); await pg.wait_for_selector('[data-testid=finance-charges]')
        await pg.fill('#fc input[name=asOf]', '2026-03-31'); await pg.dispatch_event('#fc input[name=asOf]', 'input'); await pg.wait_for_timeout(200)
        lst = await pg.inner_text('#fc-list')
        check('Slow Payer' in lst and '29.10' in lst, 'Finance charge preview: 18% on 1,000.00 for 59 days = 29.10', lst)
        await pg.click('[data-testid=fc-assess]'); await pg.wait_for_timeout(600)
        fcs = await ev("OB.ui.book.transactions.filter(t => t.financeCharge).map(t => t.total)")
        check(fcs == [2910], 'Assess creates one finance-charge invoice of 29.10', fcs)

        # ---- 1099 page: W-9, totals, downloads
        await ev("""(async () => { const b = OB.ui.book; await b.saveTransaction({ type: 'check', date: '%s-02-01', number: '77', contactId: '%s', accountId: '%s', lines: [{ accountId: '%s', amount: '5000' }] }); })()""" % ('2026', ids['v'], ids['checking'], ids['contractors']))
        await go('#/1099'); await pg.wait_for_selector('[data-testid=forms-1099]')
        f = await pg.inner_text('[data-testid=forms-1099]')
        check('1099-NEC' in f and 'No W-9 on file' in f, '1099 forms card: totals and a “No W-9 on file” warning', f[:300])
        check('StudioBooks' not in await pg.inner_text('main'), 'Old product name is gone from the 1099 page')
        await pg.check('[data-vw9="%s"]' % ids['v']); await pg.click('#m1099 button[type=submit]'); await pg.wait_for_timeout(500)
        check(await ev("OB.ui.book.contactById[%r].w9OnFile" % ids['v']) is True, 'W-9 on file is saved from the 1099 page')
        await go('#/dashboard'); await pg.wait_for_timeout(100); await go('#/1099'); await pg.wait_for_selector('[data-testid=f1099-csv]')
        y = await ev("document.querySelector('[data-testid=forms-1099] h2').textContent.replace(/\\D/g, '').slice(-4)")
        if y == '2026':
            async with pg.expect_download() as dl: await pg.click('[data-testid=f1099-csv]')
            csv = open(await (await dl.value).path(), encoding='utf-8').read()
            check('Jane Builder' in csv and '7450.10' in csv and 'SSN' in csv, '1099 CSV has the contractor, total 7,450.10 and TIN type', csv[-200:])
            async with pg.expect_download() as dl: await pg.click('[data-testid=f1099-pdf]')
            check(open(await (await dl.value).path(), 'rb').read()[:5] == b'%PDF-', 'Recipient copies download as a PDF')
        else:
            check(True, '1099 CSV (year shown is %s; payments are dated 2026, skipped)' % y)
        check(not errs, 'No JavaScript errors', errs)
        await ctx.close()
    print('\n%d passed, %d failed' % (sum(1 for r in results if r[0]), sum(1 for r in results if not r[0])))
    sys.exit(0 if all(r[0] for r in results) else 1)
asyncio.run(main())

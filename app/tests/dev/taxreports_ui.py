"""
VaultBook 1.18 browser test (developer-only): combined sales tax rate (settings), exemption certificate,
Pay Sales Tax, Sales Tax Return by Agency, A/R Collections, Missing Checks, Voided/Changed, Cash Flow Forecast.
Usage: python3 taxreports_ui.py /path/to/app/index.html
"""
import asyncio, sys, tempfile
from playwright.async_api import async_playwright
APP = sys.argv[1]; URL = 'file://' + APP
results = []
def check(c, n, d=''):
    results.append((bool(c), n)); print(('  ok   ' if c else '  FAIL ') + n + (('  [' + str(d)[:240] + ']') if d and not c else ''))
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(), viewport={'width': 1400, 'height': 1000})
        pg = ctx.pages[0]; errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); ev = pg.evaluate
        go = lambda h: ev("h => location.hash = h", h)
        report = lambda key, q='': go('#/report/' + key + q)
        await pg.goto(URL); await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'Tax Two Co'); await pg.click('#newco button[type=submit]'); await pg.wait_for_function('OB.ui.book')

        # ---- combined rate in Settings
        await go('#/settings?tab=salestax'); await pg.wait_for_selector('[data-testid=stx-new]'); await pg.click('[data-testid=stx-new]'); await pg.wait_for_selector('#stx-parts')
        await pg.fill('#stx input[name=name]', 'Tucson combined')
        parts = [('Arizona', 'Arizona DOR', '5.6'), ('Pima County', 'Arizona DOR', '0.5'), ('Tucson', 'City of Tucson', '2.6')]
        for i, (n, a, r) in enumerate(parts):
            row = '#stx-parts tbody tr:nth-child(%d) ' % (i + 1)
            await pg.fill(row + '[data-p=name]', n); await pg.fill(row + '[data-p=agency]', a); await pg.fill(row + '[data-p=rate]', r)
        await pg.click('.modal .btn.primary'); await pg.wait_for_timeout(500)
        t = await pg.inner_text('[data-testid=salestax-card]')
        check('8.7%' in t and 'City of Tucson' in t, 'Combined rate saved: 8.7% made of three parts', t)

        ids = await ev("""(async () => { const b = OB.ui.book, A = (n) => b.accounts.find(a => a.name === n).id, tx = b.company.salesTaxes[0];
          const c = await b.saveContact({ kind: 'customer', name: 'Buyer', phone: '555-0199' });
          const ex = await b.saveContact({ kind: 'customer', name: 'County School', taxExempt: true, exemptCert: { number: 'AZ-77', state: 'AZ', reason: 'government', expires: '2025-06-30' } });
          const inv = await b.saveTransaction({ type: 'invoice', date: '2026-07-01', dueDate: '2026-07-31', contactId: c.id, taxId: tx.id, lines: [{ accountId: A('Sales'), amount: '2000', taxable: true }] });
          const v = await b.saveContact({ kind: 'vendor', name: 'Paper' });
          for (const n of ['500', '501', '503']) await b.saveTransaction({ type: 'check', date: '2026-07-0' + (+n % 7 + 1), number: n, contactId: v.id, accountId: A('Checking'), lines: [{ accountId: A('Office Supplies & Software'), amount: '5' }] });
          const e = await b.saveTransaction({ type: 'expense', date: '2026-07-05', accountId: A('Checking'), lines: [{ accountId: A('Meals'), amount: '30' }] });
          await b.voidTransaction(e.id, 'entered twice');
          return { c: c.id, ex: ex.id, inv: inv.id }; })()""")

        # ---- exemption certificate banner (expired)
        await go('#/contact/' + ids['ex']); await pg.wait_for_selector('[data-testid=cert]')
        ct = await pg.inner_text('[data-testid=cert]')
        check('AZ-77' in ct and 'expired' in ct, 'Customer page shows the exemption certificate and that it has expired', ct)
        check(await pg.locator('[data-testid=attachments]').count() == 1, 'Customer page has an Attachments card for the certificate copy')

        # ---- Sales Tax Return by Agency
        await report('taxagency', '?from=2026-07-01&to=2026-09-30'); await pg.wait_for_selector('[data-testid=taxagency]')
        ta = await pg.inner_text('[data-testid=taxagency]')
        check('Arizona DOR' in ta and '122.00' in ta and 'City of Tucson' in ta and '52.00' in ta, 'Return by agency: Arizona DOR 122.00 (6.1% of 2,000), City of Tucson 52.00', ta)

        # ---- Pay sales tax
        await go('#/paysalestax'); await pg.wait_for_selector('[data-testid=pay-sales-tax]')
        await pg.click('[data-testid=pst-pay]'); await pg.wait_for_timeout(800)
        r = await ev("(() => { const b = OB.ui.book; return { stax: b.accountBalance(b.sys('STAX').id), checks: b.transactions.filter(t => t.type === 'check' && t.lines.some(l => l.taxAgency)).map(t => t.total).sort((x, y) => x - y) }; })()")
        check(r == {'stax': 0, 'checks': [5200, 12200]}, 'Pay sales tax: one check per agency (52.00 and 122.00), liability cleared', r)

        # ---- A/R Collections
        await report('collections', '?asOf=2026-09-01'); await pg.wait_for_selector('[data-testid=collections]')
        co = await pg.inner_text('[data-testid=collections]')
        check('Buyer' in co and '555-0199' in co and '2,174.00' in co and '32' in co, 'A/R Collections: Buyer, phone, 2,174.00, 32 days overdue', co)

        # ---- Missing checks
        await report('missingchecks'); await pg.wait_for_selector('[data-testid=missingchecks]')
        mc = await pg.inner_text('[data-testid=missingchecks]')
        check('Missing 502' in mc, 'Missing Checks flags check 502', mc[:300])

        # ---- Voided / changed
        y = await ev("new Date().toISOString().slice(0, 10)")
        await report('changed', '?from=%s&to=%s' % (y, y)); await pg.wait_for_selector('[data-testid=changed]')
        ch = await pg.inner_text('[data-testid=changed]')
        check('Voided' in ch and '30.00' in ch, 'Voided/Changed lists the voided expense', ch[:300])

        # ---- Cash flow forecast
        await report('forecast', '?asOf=2026-07-15'); await pg.wait_for_selector('[data-testid=forecast]')
        fc = await pg.inner_text('[data-testid=forecast]')
        check('2,174.00' in fc, 'Cash Flow Forecast expects the open invoice (2,174.00) when due', fc[:400])
        check(await ev("OB.ui.book.checkIntegrity().issues.length") == 0, 'Data integrity check passes')
        check(not errs, 'No JavaScript errors', errs)
        await ctx.close()
    print('\n%d passed, %d failed' % (sum(1 for r in results if r[0]), sum(1 for r in results if not r[0])))
    sys.exit(0 if all(r[0] for r in results) else 1)
asyncio.run(main())

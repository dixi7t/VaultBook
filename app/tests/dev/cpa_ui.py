"""CPA audit fixes (1.19.0) in the browser: discounts on Receive Payment, save warnings, bounced payment,
void as of a date, fixed asset disposal, vendor refund form.
Usage: python3 cpa_ui.py /path/to/app/index.html"""
import asyncio, sys, os, tempfile
from playwright.async_api import async_playwright
APP = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'index.html'))
res = []
def check(ok, msg, info=''):
    res.append(ok); print(('  ok   ' if ok else '  FAIL ') + msg + ('' if ok else '  -> ' + str(info)))
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(), viewport={'width': 1500, 'height': 900})
        pg = ctx.pages[0]; ev = pg.evaluate; errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        async def go(h, wait=900): await ev(f"OB.ui.dirty = false; location.hash = '{h}'"); await pg.wait_for_timeout(wait)
        await pg.goto('file://' + APP); await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'CPA UI Co'); await pg.click('#newco button[type=submit]'); await pg.wait_for_function('OB.ui.book')
        today = await ev("OB.util.today()")
        ids = await ev("""(async () => { const b = OB.ui.book, A = (n) => b.accounts.find(a => a.name === n).id;
          const c = await b.saveContact({ kind: 'customer', name: 'Disc Cust', terms: 30, discountPct: 2, discountDays: 10 });
          const v = await b.saveContact({ kind: 'vendor', name: 'Bill Vendor' });
          const inv = await b.saveTransaction({ type: 'invoice', date: OB.util.today(), contactId: c.id, terms: 30, discountPct: 2, discountDays: 10, lines: [{ accountId: A('Services'), amount: '1000' }] });
          await b.saveTransaction({ type: 'bill', date: OB.util.today(), contactId: v.id, number: 'X-9', lines: [{ accountId: A('Rent & Lease'), amount: '10' }] });
          const fa = await b.saveFixedAsset({ name: 'Laptop', inService: '2025-01-15', cost: '1200', method: 'SL', lifeMonths: 36, accountId: A('Vehicles'), accumAccountId: A('Accumulated Depreciation'), expenseAccountId: A('Depreciation') });
          return { c: c.id, v: v.id, inv: inv.id, fa: fa.id, bank: A('Checking') }; })()""")

        # ---- early-payment discount on Receive Payment ----
        await go('#/txn/new?type=payment')
        await ev(f"(() => {{ document.activeElement.blur(); const h = document.querySelector('[name=contactId]'); h.value = '{ids['c']}'; h.dispatchEvent(new Event('change', {{ bubbles: true }})); }})()"); await pg.wait_for_timeout(500)
        dl = pg.locator(f"[data-disc='{ids['inv']}']")
        check(await dl.count() == 1 and '20.00' in await dl.locator('xpath=..').inner_text(), 'Receive Payment offers the 2% discount on the invoice', await pg.inner_text('#apply-area'))
        await dl.check(); await pg.wait_for_timeout(200)
        check(await pg.input_value(f"[data-app='{ids['inv']}']") in ('980.00', '980'), 'Taking the discount applies the rest of the balance', await pg.input_value(f"[data-app='{ids['inv']}']"))
        await ev(f"(() => {{ const h = document.querySelector('[name=accountId]'); h.value = '{ids['bank']}'; h.dispatchEvent(new Event('change', {{ bubbles: true }})); const a = document.querySelector('[name=amount]'); a.value = '980'; a.dispatchEvent(new Event('input', {{ bubbles: true }})); }})()")
        await pg.keyboard.press('Control+s'); await pg.wait_for_timeout(1200)
        r = await ev(f"(() => {{ const b = OB.ui.book; return {{ open: b.openBalance(b.txById['{ids['inv']}']), cms: b.transactions.filter(t => t.type === 'creditMemo' && t.discountOf === '{ids['inv']}').length }}; }})()")
        check(r == {'open': 0, 'cms': 1}, 'Saving posts the payment and the discount credit; the invoice is paid', r)

        # ---- save warning: duplicate bill number ----
        await go('#/txn/new?type=bill')
        await ev(f"(() => {{ document.activeElement.blur(); const h = document.querySelector('[name=contactId]'); h.value = '{ids['v']}'; h.dispatchEvent(new Event('change', {{ bubbles: true }})); }})()")
        await pg.fill('[name=number]', 'X-9')
        await ev("""(() => { const b = OB.ui.book, tr = document.querySelector('tr.line'), hid = tr.querySelector('[data-f=accountId]'); hid.value = b.accounts.find(a => a.name === 'Rent & Lease').id; hid.dispatchEvent(new Event('change', { bubbles: true }));
          const am = tr.querySelector('[data-f=amount]'); am.value = '15'; am.dispatchEvent(new Event('input', { bubbles: true })); })()""")
        await pg.keyboard.press('Control+s'); await pg.wait_for_timeout(700)
        w = pg.locator('[data-testid=save-warnings]')
        check(await w.count() == 1 and 'X-9' in await w.inner_text(), 'A duplicate bill number asks "Save anyway?"')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)

        # ---- bounced payment from the payment's More menu ----
        pay = await ev("OB.ui.book.transactions.find(t => t.type === 'payment').id")
        await go('#/txn/' + pay)
        await pg.click('[data-act=more]'); await pg.wait_for_timeout(200)
        check(await pg.locator('[data-act=bounce]').count() == 1, 'A posted payment offers Record bounced payment')
        await pg.click('[data-act=bounce]'); await pg.wait_for_timeout(300)
        await pg.fill('#bnc [name=bankFee]', '12'); await pg.click('.modal button.primary'); await pg.wait_for_timeout(1200)
        r = await ev(f"(() => {{ const b = OB.ui.book; return {{ bal: b.contactBalance('{ids['c']}'), charge: b.transactions.some(t => t.bounceOf === '{pay}') }}; }})()")
        check(r['charge'] and r['bal'] == 98000, 'Bounced payment re-opens the customer balance', r)

        # ---- void as of a date for a closed period ----
        old = await ev("""(async () => { const b = OB.ui.book; const t = await b.saveTransaction({ type: 'expense', date: '2025-03-01', accountId: b.accounts.find(a => a.name === 'Checking').id, lines: [{ accountId: b.accounts.find(a => a.name === 'Meals').id, amount: '40' }] });
          await b.saveCompany({ closingDate: '2025-12-31' }); return t.id; })()""")
        await go('#/txn/' + old)
        await pg.click('[data-act=more]'); await pg.wait_for_timeout(200); await pg.click('[data-act=void]'); await pg.wait_for_timeout(300)
        check(await pg.locator('#vasof').is_checked() and await pg.locator('#vasof').is_disabled(), 'Voiding a closed-period transaction must keep its original period')
        await pg.click('.modal button.danger'); await pg.wait_for_timeout(1200)
        r = await ev(f"(() => {{ const t = OB.ui.book.txById['{old}']; const je = OB.ui.book.txById[t.voidedBy]; return {{ st: t.status, je: je && je.date > '2025-12-31' }}; }})()")
        check(r == {'st': 'posted', 'je': True}, 'Void as of posts a reversing entry in the open period', r)
        check('Voided as of' in await pg.inner_text('#main'), 'The original shows it was voided as of a later date')

        # ---- fixed asset disposal ----
        await go('#/fixedassets')
        await pg.click(f"[data-dispose='{ids['fa']}']"); await pg.wait_for_timeout(300)
        await pg.fill('#fad [name=proceeds]', '500'); await pg.click('.modal button.primary'); await pg.wait_for_timeout(1500)
        r = await ev(f"(() => {{ const b = OB.ui.book, row = OB.reports.fixedAssets(b, {{ asOf: OB.util.today() }}).rows[0]; return {{ cost: row.cost, acc: row.recorded, disp: !!row.disposalId }}; }})()")
        check(r == {'cost': 0, 'acc': 0, 'disp': True}, 'Dispose clears cost and accumulated depreciation', r)
        check(await pg.locator('text=Disposal entry').count() == 1, 'The register links to the disposal entry')

        # ---- vendor refund form ----
        await go('#/txn/new?type=vendorRefund')
        check('Vendor Refund' in await pg.inner_text('#main') and await pg.locator('#apply-area').count() == 1, 'The Vendor Refund form opens with its credits list')

        check(not errs, 'No JavaScript errors', errs)
        await ctx.close()
    print(f'\n{sum(res)} passed, {len(res) - sum(res)} failed')
asyncio.run(main())

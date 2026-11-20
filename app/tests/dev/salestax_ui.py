"""
VaultBook 1.13 browser test (developer-only): sales tax, estimates -> invoices, purchase orders -> bills,
closing-date password, audit chain in Data integrity, credit-limit warning.
Usage: python3 salestax_ui.py /path/to/app/index.html [screenshot-prefix]
"""
import asyncio, sys, tempfile
from playwright.async_api import async_playwright

async def pick_item(pg, row, item_id):
    """Type the item's name in the line's Item box and press Enter (type-ahead item list)."""
    name = await pg.evaluate("id => OB.ui.book.itemById[id].name", item_id)
    box = row + ' .combo:has(input[data-f=itemId]) .combo-input'
    await pg.click(box); await pg.fill(box, name); await pg.wait_for_timeout(120); await pg.keyboard.press('Enter')

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
async def pick(pg, sel, text):
    await pg.click(sel); await pg.fill(sel, text); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(150)
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(), viewport={'width': 1300, 'height': 1000})
        pg = ctx.pages[0]; errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); ev = pg.evaluate
        go = lambda h: ev("h => location.hash = h", h)
        await pg.goto(URL); await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'Tax Test Co'); await pg.click('#newco button[type=submit]'); await pg.wait_for_function('OB.ui.book')
        await ev("""(async () => { const b = OB.ui.book;
          await b.saveContact({ kind: 'customer', name: 'Main Street Shop', address: '1 Main St', creditLimit: '500' });
          await b.saveContact({ kind: 'customer', name: 'City School', taxExempt: true });
          await b.saveContact({ kind: 'vendor', name: 'Paper Supply' });
          await b.saveItem({ name: 'Widget', type: 'noninventory', incomeAccountId: b.accounts.find(a => a.name === 'Sales').id, price: '100', taxable: true });
          await b.saveItem({ name: 'Labor', type: 'service', incomeAccountId: b.accounts.find(a => a.name === 'Services').id, price: '50', taxable: false }); })()""")

        # ---- Settings > Sales tax
        await go('#/settings?tab=salestax'); await pg.wait_for_selector('[data-testid=salestax-card]')
        await pg.click('[data-testid=stx-new]'); await pg.wait_for_selector('#stx')
        await pg.fill('#stx input[name=name]', 'AZ + Tucson'); await pg.fill('#stx input[name=rate]', '8.7'); await pg.fill('#stx input[name=agency]', 'Arizona DOR')
        await pg.click('.modal .btn.primary'); await pg.wait_for_timeout(400)
        txt = await pg.inner_text('[data-testid=salestax-card]')
        check('AZ + Tucson' in txt and '8.7%' in txt and 'Default' in txt and 'Sales Tax Payable' in txt, 'Settings → Sales tax: new rate saved as the default, owed in Sales Tax Payable', txt)
        await pg.click('[data-testid=stx-new]'); await pg.wait_for_selector('#stx')
        await pg.fill('#stx input[name=name]', 'Bad'); await pg.fill('#stx input[name=rate]', '150'); await pg.click('.modal .btn.primary'); await pg.wait_for_timeout(400)
        check(await pg.locator('#stx').count() == 1 and await ev("OB.ui.book.company.salesTaxes.length") == 1, 'An invalid rate is refused and the dialog stays open')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)

        # ---- Estimate with tax
        await go('#/txn/new?type=estimate'); await pg.wait_for_selector('[data-testid=qb-invoice]')
        t = await pg.inner_text('.qbi-title')
        check('Estimate' in t, 'Estimate opens in the QuickBooks layout with the title "Estimate"', t)
        check(await pg.locator('th.tx-cell').count() == 1 and await pg.locator('[data-testid=tax-select]').count() == 1, 'Tax column and SALES TAX choice appear once a rate exists')
        await pick(pg, '.qbi-cust .combo-input', 'Main Street')
        check(await ev("document.querySelector('[data-testid=tax-select]').selectedOptions[0].textContent") == 'AZ + Tucson (8.7%)', 'Customer gets the default rate')
        wid = await ev("OB.ui.book.items.find(x => x.name === 'Widget').id"); lab = await ev("OB.ui.book.items.find(x => x.name === 'Labor').id")
        await pick_item(pg, 'tr.line:nth-child(1)', wid); await pg.wait_for_timeout(150)
        await pg.fill('tr.line:nth-child(1) input[data-f=qty]', '2'); await pg.dispatch_event('tr.line:nth-child(1) input[data-f=qty]', 'input')
        await pick_item(pg, 'tr.line:nth-child(2)', lab); await pg.wait_for_timeout(150)
        await pg.wait_for_timeout(200)
        c1 = await pg.is_checked('tr.line:nth-child(1) input[data-f=taxable]'); c2 = await pg.is_checked('tr.line:nth-child(2) input[data-f=taxable]')
        check(c1 and not c2, 'Choosing an item sets the line taxable from the item')
        tot = await pg.inner_text('#totals')
        check('250.00' in tot and '17.40' in tot and '267.40' in tot, 'Totals: subtotal 250.00, tax 8.7% on 200.00 = 17.40, total 267.40', tot)
        if SHOT:
            await ev("document.querySelector('[data-testid=qb-invoice]').scrollIntoView()"); await pg.screenshot(path=SHOT + '_estimate.png')
        await pg.click('button[data-after=view]')
        h = await wait_hash(pg, lambda h: h.startswith('#/txn/') and 'new' not in h)
        est = await ev("OB.ui.book.transactions.find(t => t.type === 'estimate')")
        check(est and est['status'] == 'open' and est['total'] == 26740 and est['tax'] == 1740 and est['splits'] == [], 'Estimate saved: open, total 267.40, no ledger postings', est and {k: est[k] for k in ('status', 'total', 'tax')})
        check(await ev("R => OB.reports.trialBalance(OB.ui.book, {}).totalDebit", None) == 0, 'Trial balance is untouched by the estimate')
        await pg.wait_for_selector('[data-testid=doc-status]')
        check('Open.' in await pg.inner_text('[data-testid=doc-status]'), 'Saved estimate shows Open and "does not affect your books"')

        # ---- Create invoice from estimate
        await pg.click('[data-testid=convert]'); await pg.wait_for_selector('.modal'); await pg.click('.modal .btn.primary'); await pg.wait_for_selector('[data-testid=from-doc]')
        check(await pg.input_value('tr.line:nth-child(1) input[data-f=amount]') == '200.00' and await pg.is_checked('tr.line:nth-child(1) input[data-f=taxable]'), 'Create Invoice copies the lines and their tax flags')
        tot = await pg.inner_text('#totals')
        check('BALANCE DUE' in tot and '267.40' in tot, 'Invoice totals include the tax', tot)
        hint = await pg.locator('[data-testid=credit-hint]').count()
        check(hint == 0, 'No credit warning while under the 500.00 limit')
        await pg.fill('tr.line:nth-child(2) input[data-f=qty]', '6'); await pg.dispatch_event('tr.line:nth-child(2) input[data-f=qty]', 'input'); await pg.wait_for_timeout(200)
        check(await pg.locator('[data-testid=credit-hint]').count() == 1 and 'Over credit limit' in await pg.inner_text('[data-testid=credit-hint]'), 'Credit limit warning appears when the invoice would pass the limit (517.40 > 500.00)')
        await pg.fill('tr.line:nth-child(2) input[data-f=qty]', '1'); await pg.dispatch_event('tr.line:nth-child(2) input[data-f=qty]', 'input'); await pg.wait_for_timeout(200)
        await pg.click('button[data-after=view]')
        await wait_hash(pg, lambda h: h.startswith('#/txn/') and 'new' not in h)
        await pg.wait_for_timeout(300)
        inv = await ev("OB.ui.book.transactions.find(t => t.type === 'invoice')")
        check(inv and inv['total'] == 26740 and inv['sourceId'] == est['id'], 'Invoice saved from the estimate with tax', inv and inv.get('total'))
        check(await ev("OB.ui.book.txById[%r].status" % est['id']) == 'closed', 'The estimate is now closed')
        check(await ev("OB.ui.book.accountBalance(OB.ui.book.sys('STAX').id)") == 1740, 'Sales Tax Payable holds the 17.40')

        # ---- printed invoice shows subtotal + tax
        await go('#/print/' + inv['id']); await pg.wait_for_selector('[data-testid=invoice-doc] svg')
        pt = await ev("[...document.querySelectorAll('[data-testid=invoice-doc] text')].map(x => x.textContent).join('|')")
        check('Subtotal' in pt and 'Sales tax — AZ + Tucson (8.7% on $200.00)' in pt and '$267.40' in pt, 'Printed invoice: Subtotal and Sales tax rows, Total includes tax', pt[-300:])

        # ---- exempt customer gets no tax by default
        await go('#/txn/new?type=salesReceipt'); await pg.wait_for_selector('[data-testid=tax-select]')
        await pick(pg, '.tx-head .combo-input', 'City School')
        check(await pg.input_value('[data-testid=tax-select]') == '', 'Tax-exempt customer: sales tax set to "No sales tax"')

        # ---- Purchase order -> bill (discard the unsaved sales receipt first)
        await ev("OB.ui.dirty = false")
        await go('#/txn/new?type=purchaseOrder'); await pg.wait_for_selector('#txf')
        check(await pg.locator('[data-testid=tax-select]').count() == 0, 'Purchase orders have no sales tax')
        await pick(pg, '.tx-head .combo-input', 'Paper Supply')
        await pick(pg, 'tr.line:nth-child(1) .combo:has(input[data-f=accountId]) .combo-input', 'Office Supplies')
        await pg.fill('tr.line:nth-child(1) input[data-f=amount]', '75'); await pg.dispatch_event('tr.line:nth-child(1) input[data-f=amount]', 'input')
        await pg.click('button[data-after=view]'); await wait_hash(pg, lambda h: h.startswith('#/txn/') and 'new' not in h)
        await pg.wait_for_selector('[data-testid=convert]')
        check('Create bill' in await pg.inner_text('[data-testid=convert]'), 'Saved PO offers "Create bill"')
        await pg.click('[data-testid=convert]'); await pg.wait_for_selector('.modal'); await pg.click('.modal .btn.primary'); await pg.wait_for_selector('[data-testid=from-doc]')
        await pg.click('button[data-after=view]'); await wait_hash(pg, lambda h: h.startswith('#/txn/') and 'new' not in h); await pg.wait_for_timeout(300)
        po = await ev("OB.ui.book.transactions.find(t => t.type === 'purchaseOrder')")
        check(po['status'] == 'closed' and await ev("OB.ui.book.accountBalance(OB.ui.book.sys('AP').id)") == 7500, 'Bill made from the PO: PO closed, A/P 75.00')

        # ---- Sales Tax Liability report
        await go('#/report/salestax'); await pg.wait_for_selector('[data-testid=salestax-rates]')
        rt = await pg.inner_text('[data-testid=salestax-rates]'); ow = await pg.inner_text('[data-testid=salestax-owed]')
        check('AZ + Tucson' in rt and '200.00' in rt and '17.40' in rt and '17.40' in ow, 'Sales Tax Liability shows taxable sales, tax and the balance owed', rt + ' / ' + ow)
        if SHOT: await pg.screenshot(path=SHOT + '_report.png')

        # ---- closing date password
        await go('#/settings?tab=company'); await pg.wait_for_selector('[data-testid=closing-card]')
        await pg.fill('[data-testid=new-closing-pw]', 'secret1'); await pg.click('#cpw button[type=submit]'); await pg.wait_for_timeout(400)
        check(await ev("!!OB.ui.book.company.closingPasswordHash"), 'Closing date password set')
        await pg.wait_for_selector('[data-testid=closing-pw]')
        await pg.fill('#co input[name=closingDate]', '2025-12-31'); await pg.click('#co button[type=submit]'); await pg.wait_for_timeout(500)
        check(await ev("OB.ui.book.company.closingDate") == '', 'Changing the closing date without the password is refused')
        await pg.fill('[data-testid=closing-pw]', 'secret1'); await pg.click('#co button[type=submit]'); await pg.wait_for_timeout(500)
        check(await ev("OB.ui.book.company.closingDate") == '2025-12-31', 'With the password the closing date changes')
        await go('#/settings?tab=audit'); await pg.wait_for_timeout(200); await go('#/settings?tab=company'); await pg.wait_for_selector('[data-testid=closing-history]')
        check('12/31/2025' in await pg.inner_text('[data-testid=closing-history]'), 'Closing date history is listed')

        # ---- integrity check shows the audit chain
        await go('#/settings?tab=integrity'); await pg.wait_for_timeout(300)
        run = pg.locator('#tab button', has_text='Run')
        if await run.count(): await run.first.click(); await pg.wait_for_timeout(500)
        it = await pg.inner_text('#tab')
        check('Audit trail intact' in it and 'SHA-256' in it, 'Data integrity reports the audit chain as intact', it[:300])

        # ---- new menu lists estimates and purchase orders
        nm = await ev("(() => { OB.ui.newMenu(); const t = document.querySelector('.newmenu').innerText; document.querySelector('.modal-backdrop').remove(); return t; })()")
        check('Estimate' in nm and 'Purchase Order' in nm, 'Create menu lists Estimate and Purchase Order')
        check(not errs, 'No JavaScript errors', errs)
        await ctx.close()
    print('\n%d passed, %d failed' % (sum(1 for r in results if r[0]), sum(1 for r in results if not r[0])))
    sys.exit(0 if all(r[0] for r in results) else 1)
asyncio.run(main())

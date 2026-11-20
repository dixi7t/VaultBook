"""
VaultBook 1.17 browser test (developer-only): progress invoicing from an estimate, sales order → invoice,
customer deposit applied on an invoice, price levels on invoice lines, batch invoicing.
Usage: python3 sales_ui.py /path/to/app/index.html
"""
import asyncio, sys, tempfile
from playwright.async_api import async_playwright

async def pick_item(pg, row, item_id):
    """Type the item's name in the line's Item box and press Enter (type-ahead item list)."""
    name = await pg.evaluate("id => OB.ui.book.itemById[id].name", item_id)
    box = row + ' .combo:has(input[data-f=itemId]) .combo-input'
    await pg.click(box); await pg.fill(box, name); await pg.wait_for_timeout(120); await pg.keyboard.press('Enter')

APP = sys.argv[1]; URL = 'file://' + APP
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
async def save_new(pg):
    await pg.click('button[data-after=view]'); await wait_hash(pg, lambda h: h.startswith('#/txn/') and 'new' not in h); await pg.wait_for_timeout(300)
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(), viewport={'width': 1400, 'height': 1000})
        pg = ctx.pages[0]; errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); ev = pg.evaluate
        go = lambda h: ev("h => location.hash = h", h)
        await pg.goto(URL); await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'Sales Co'); await pg.click('#newco button[type=submit]'); await pg.wait_for_function('OB.ui.book')
        ids = await ev("""(async () => { const b = OB.ui.book, A = (n) => b.accounts.find(a => a.name === n).id;
          const c = await b.saveContact({ kind: 'customer', name: 'Owner' });
          const est = await b.saveTransaction({ type: 'estimate', date: '2026-04-01', contactId: c.id, lines: [{ accountId: A('Services'), description: 'Design', amount: '1000' }, { accountId: A('Services'), description: 'Build', amount: '3000' }] });
          const it = await b.saveItem({ name: 'Plan', type: 'service', incomeAccountId: A('Services'), price: '200' });
          return { c: c.id, est: est.id, it: it.id }; })()""")

        # ---- progress invoice: 25%
        await go('#/txn/' + ids['est']); await pg.wait_for_selector('[data-testid=convert]'); await pg.click('[data-testid=convert]'); await pg.wait_for_selector('[data-testid=pm-pct]')
        await pg.check('input[name=pm][value=pct]'); await pg.fill('[data-testid=pm-pct]', '25'); await pg.click('.modal .btn.primary')
        await pg.wait_for_selector('[data-testid=from-doc]')
        amts = await ev("[...document.querySelectorAll('tr.line input[data-f=amount]')].map(x => x.value).filter(Boolean)")
        check(amts == ['250.00', '750.00'], 'Create Invoice at 25%: 250.00 and 750.00', amts)
        await save_new(pg)
        r = await ev("(() => { const b = OB.ui.book, e = b.txById[%r]; return { st: e.status, pr: b.sourceProgress(e.id).billed }; })()" % ids['est'])
        check(r == {'st': 'open', 'pr': 100000}, 'Estimate stays open with 1,000.00 of 4,000.00 invoiced', r)
        await go('#/txn/' + ids['est']); await pg.wait_for_selector('[data-testid=doc-status]')
        check('Invoiced $1,000.00 of $4,000.00' in await pg.inner_text('[data-testid=doc-status]'), 'Estimate shows its progress')
        await pg.click('[data-testid=convert]'); await pg.wait_for_selector('.modal'); await pg.click('.modal .btn.primary'); await pg.wait_for_selector('[data-testid=from-doc]')
        await save_new(pg)
        check(await ev("OB.ui.book.txById[%r].status" % ids['est']) == 'closed', 'Invoicing the rest closes the estimate')

        # ---- sales order -> invoice
        await go('#/txn/new?type=salesOrder'); await pg.wait_for_selector('[data-testid=qb-invoice]')
        check('Sales Order' in await pg.inner_text('.qbi-title'), 'Sales order uses the invoice layout titled “Sales Order”')
        await pick(pg, '.qbi-cust .combo-input', 'Owner')
        await pick_item(pg, 'tr.line:nth-child(1)', ids['it']); await pg.wait_for_timeout(200)
        await save_new(pg)
        so = await ev("OB.ui.book.transactions.find(t => t.type === 'salesOrder')")
        check(so['number'] == 'SO-1001' and so['total'] == 20000 and so['status'] == 'open', 'Sales order SO-1001 saved (no ledger effect)', so and so.get('number'))

        # ---- deposit: receive on the customer page, apply on an invoice
        await go('#/contact/' + ids['c']); await pg.wait_for_selector('[data-testid=receive-deposit]'); await pg.click('[data-testid=receive-deposit]'); await pg.wait_for_selector('[data-testid=rd-amt]')
        await pg.fill('[data-testid=rd-amt]', '150'); await pg.click('.modal .btn.primary'); await pg.wait_for_timeout(600)
        check('$150.00' in await pg.inner_text('[data-testid=deposits-held]'), 'Customer page shows $150.00 of deposits held')
        await go('#/txn/' + so['id']); await pg.wait_for_selector('[data-testid=convert]'); await pg.click('[data-testid=convert]'); await pg.wait_for_selector('.modal'); await pg.click('.modal .btn.primary')
        await pg.wait_for_selector('[data-testid=apply-deposit]')
        btn = pg.locator('[data-testid=apply-deposit]')
        check(await btn.is_visible() and '$150.00' in await btn.inner_text(), 'Invoice offers “+ Apply deposit ($150.00 held)”')
        await btn.click(); await pg.wait_for_timeout(200)
        tot = await pg.inner_text('#totals')
        check('50.00' in tot and 'BALANCE DUE' in tot, 'Applying the deposit leaves 50.00 due', tot)
        await save_new(pg)
        r = await ev("(() => { const b = OB.ui.book, inv = b.transactions.find(t => t.type === 'invoice' && t.sourceId === %r); return { open: b.openBalance(inv), held: b.depositsHeld(%r, true), so: b.txById[%r].status }; })()" % (so['id'], ids['c'], so['id']))
        check(r == {'open': 5000, 'held': 0, 'so': 'closed'}, 'Invoice from the sales order: 50.00 open, deposit used, sales order closed', r)

        # ---- price level used on invoice lines
        await go('#/pricelevels'); await pg.wait_for_selector('[data-testid=pl-new]'); await pg.click('[data-testid=pl-new]'); await pg.wait_for_selector('#pl-name')
        await pg.fill('#pl-name', 'Wholesale'); await pg.fill('#pl-pct', '-25'); await pg.click('.modal .btn.primary'); await pg.wait_for_timeout(400)
        plid = await ev("OB.ui.book.company.priceLevels[0].id")
        await ev("(async () => { const b = OB.ui.book; await b.saveContact({ kind: 'customer', name: 'Wholesale Buyer', priceLevelId: %r }); await b.saveContact({ kind: 'customer', name: 'Retail Buyer' }); })()" % plid)
        await go('#/txn/new?type=invoice'); await pg.wait_for_selector('[data-testid=qb-invoice]')
        await pick(pg, '.qbi-cust .combo-input', 'Wholesale Buyer')
        await pick_item(pg, 'tr.line:nth-child(1)', ids['it']); await pg.wait_for_timeout(200)
        check(await pg.input_value('tr.line:nth-child(1) input[data-f=rate]') == '150.00', 'Price level: 200.00 item at −25% fills 150.00')
        await ev("OB.ui.dirty = false")

        # ---- batch invoicing
        await go('#/batchinvoice'); await pg.wait_for_selector('[data-testid=batch-invoice]')
        await pg.select_option('tr.bl:nth-child(1) select[data-f=itemId]', ids['it']); await pg.wait_for_timeout(100)
        for name in ['Wholesale Buyer', 'Retail Buyer']:
            cid = await ev("OB.ui.book.contacts.find(c => c.name === %r).id" % name); await pg.check('[data-c="%s"]' % cid)
        await pg.click('[data-testid=bi-create]'); await pg.wait_for_timeout(800)
        tots = await ev("(() => { const b = OB.ui.book; return ['Wholesale Buyer', 'Retail Buyer'].map(n => b.transactions.filter(t => t.type === 'invoice' && b.contactById[t.contactId].name === n).map(t => t.total)); })()")
        check(tots == [[15000], [20000]], 'Batch invoicing: one invoice each, at each customer’s price (150.00 and 200.00)', tots)
        check(await ev("OB.ui.book.checkIntegrity().issues.length") == 0, 'Data integrity check passes')
        check(not errs, 'No JavaScript errors', errs)
        await ctx.close()
    print('\n%d passed, %d failed' % (sum(1 for r in results if r[0]), sum(1 for r in results if not r[0])))
    sys.exit(0 if all(r[0] for r in results) else 1)
asyncio.run(main())

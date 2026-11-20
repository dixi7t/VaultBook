"""
VaultBook 1.15 browser test (developer-only): inventory (item editor with opening quantity, bill with Qty/Cost,
invoice posts COGS, adjustment form, valuation and stock reports) and fixed assets (add, post depreciation, register).
Usage: python3 inventory_ui.py /path/to/app/index.html [screenshot-prefix]
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
        bal = lambda n: ev("n => { const b = OB.ui.book; return b.accountBalance(b.accounts.find(a => a.name === n).id); }", n)
        await pg.goto(URL); await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'Stock Co'); await pg.click('#newco button[type=submit]'); await pg.wait_for_function('OB.ui.book')
        await ev("""(async () => { const b = OB.ui.book; await b.saveContact({ kind: 'vendor', name: 'Supplier' }); await b.saveContact({ kind: 'customer', name: 'Buyer' }); })()""")

        # ---- item editor: inventory part with opening quantity
        await go('#/items'); await pg.wait_for_selector('[data-testid=item-new]'); await pg.click('[data-testid=item-new]'); await pg.wait_for_selector('[data-testid=item-name]')
        await pg.fill('[data-testid=item-name]', 'Gadget'); await pg.select_option('#it-type', 'inventory'); await pg.wait_for_timeout(100)
        check(await pg.is_visible('#it-inv') and await pg.is_checked('[data-testid=item-track]'), 'Inventory part shows the Inventory section with Track quantity ticked')
        await pg.fill('#it-price', '40'); await pg.select_option('#it-inc', label='4000 Sales')
        await pg.fill('[data-testid=item-oqty]', '10'); await pg.fill('[data-testid=item-oval]', '200'); await pg.fill('#it-odate', '2026-01-01'); await pg.fill('#it-reorder', '8')
        await pg.click('.modal .btn.primary'); await pg.wait_for_timeout(700)
        st = await ev("(() => { const b = OB.ui.book, it = b.items.find(x => x.name === 'Gadget'); const s = b.inventoryState()[it.id]; return { q: s.qty, v: s.value, track: it.trackQty }; })()")
        check(st == {'q': 10, 'v': 20000, 'track': True}, 'Saved with 10 on hand worth 200.00 (opening adjustment)', st)
        check(await bal('Inventory Asset') == 20000 and await bal('Opening Balance Equity') == 20000, 'Opening quantity posts Inventory Asset / Opening Balance Equity')
        check('10' in await pg.inner_text('[data-testid=items-table]'), 'Products list shows quantity on hand')

        # ---- bill with Qty / Cost
        await go('#/txn/new?type=bill'); await pg.wait_for_selector('#txf')
        await pick(pg, '.tx-head .combo-input', 'Supplier')
        gid = await ev("OB.ui.book.items.find(x => x.name === 'Gadget').id")
        await pick_item(pg, 'tr.line:nth-child(1)', gid); await pg.wait_for_timeout(200)
        check(await pg.locator('th', has_text='Cost').count() >= 1 and await pg.locator('tr.line:nth-child(1) input[data-f=qty]').count() == 1, 'Bill lines show Qty and Cost when items are in use')
        acct = await ev("(() => { const h = document.querySelector('tr.line:nth-child(1) [data-f=accountId]'); return OB.ui.book.accById[h.value].name; })()")
        check(acct == 'Inventory Asset', 'Choosing the tracked item puts the bill line in Inventory Asset', acct)
        await pg.fill('tr.line:nth-child(1) input[data-f=qty]', '10'); await pg.fill('tr.line:nth-child(1) input[data-f=rate]', '26'); await pg.dispatch_event('tr.line:nth-child(1) input[data-f=rate]', 'input')
        check(await pg.input_value('tr.line:nth-child(1) input[data-f=amount]') == '260.00', 'Qty × Cost fills the amount')
        await pg.click('button[data-after=view]'); await wait_hash(pg, lambda h: h.startswith('#/txn/') and 'new' not in h); await pg.wait_for_timeout(300)
        st = await ev("(() => { const b = OB.ui.book, s = b.inventoryState()[%r]; return [s.qty, s.value, Math.round(s.avg)]; })()" % gid)
        check(st == [20, 46000, 2300], 'After the bill: 20 on hand, 460.00, average 23.00', st)

        # ---- invoice: COGS at average cost
        await ev("OB.ui.dirty = false"); await go('#/txn/new?type=invoice'); await pg.wait_for_selector('[data-testid=qb-invoice]')
        await pick(pg, '.qbi-cust .combo-input', 'Buyer')
        await pick_item(pg, 'tr.line:nth-child(1)', gid); await pg.wait_for_timeout(200)
        await pg.fill('tr.line:nth-child(1) input[data-f=qty]', '13'); await pg.dispatch_event('tr.line:nth-child(1) input[data-f=qty]', 'input')
        await pg.click('button[data-after=view]'); await wait_hash(pg, lambda h: h.startswith('#/txn/') and 'new' not in h); await pg.wait_for_timeout(300)
        check(await bal('Cost of Goods Sold') == 29900 and await bal('Inventory Asset') == 16100 and await bal('Sales') == 52000, 'Invoice of 13: sales 520.00, COGS 299.00 (13 × 23.00), inventory 161.00')
        await pg.click('.qbi-tools [data-act=journal]'); await pg.wait_for_selector('.drawer')
        jt = await pg.inner_text('.drawer')
        check('Cost of Goods Sold' in jt and '299.00' in jt, 'Transaction journal shows the cost of goods sold lines', jt[:200])
        await pg.keyboard.press('Escape')

        # ---- stock status (reorder) and valuation
        await go('#/report/stock'); await pg.wait_for_selector('[data-testid=stock]')
        s = await pg.inner_text('[data-testid=stock]')
        check('Gadget' in s and 'Reorder' in s, 'Stock status: 7 on hand ≤ reorder point 8 → Reorder', s)
        await go('#/report/invval'); await pg.wait_for_selector('[data-testid=invval]')
        v = await pg.inner_text('main')
        check('161.00' in v and 'agrees with the valuation' in v, 'Inventory valuation 161.00 agrees with the Inventory Asset account', v[-400:])

        # ---- adjustment form
        await go('#/txn/new?type=invAdjust'); await pg.wait_for_selector('[data-testid=inv-adjust-form]')
        await pg.select_option('tr.adj-row:nth-child(1) select[data-f=itemId]', gid); await pg.wait_for_timeout(100)
        check('7 @ 23.00' in await pg.inner_text('tr.adj-row:nth-child(1)'), 'Adjustment form shows on hand and average cost')
        await pg.fill('tr.adj-row:nth-child(1) input[data-f=qty]', '-1'); await pg.fill('tr.adj-row:nth-child(1) input[data-f=memo]', 'Damaged')
        await pg.click('#txf button[type=submit]'); await wait_hash(pg, lambda h: 'stock' in h); await pg.wait_for_timeout(300)
        check(await ev("OB.ui.book.inventoryState()[%r].qty" % gid) == 6 and await bal('Cost of Goods Sold') == 32200, 'Adjustment of −1 valued at 23.00 to Cost of Goods Sold')
        if SHOT: await pg.screenshot(path=SHOT + '_stock.png')

        # ---- fixed assets
        await go('#/fixedassets'); await pg.wait_for_selector('[data-testid=fa-new]')
        await pg.click('[data-testid=fa-new]'); await pg.wait_for_selector('#fa')
        await pg.fill('#fa input[name=name]', 'Delivery van'); await pg.fill('#fa input[name=inService]', '2026-01-10'); await pg.fill('#fa input[name=cost]', '30000')
        await pg.fill('#fa input[name=lifeYears]', '5'); await pg.fill('#fa input[name=salvage]', '6000')
        await pg.click('.modal .btn.primary'); await pg.wait_for_timeout(500)
        check(await pg.locator('[data-testid=fa-table]').count() == 1 and 'Delivery van' in await pg.inner_text('[data-testid=fa-table]'), 'Asset saved and listed')
        await pg.fill('#fa-through', '2026-06-30'); await pg.dispatch_event('#fa-through', 'input'); await pg.wait_for_timeout(100)
        check('2,400.00' in await pg.inner_text('#fa-due'), 'Due through June: 6 × 400.00 = 2,400.00 ((30,000 − 6,000) ÷ 60)')
        await pg.click('[data-testid=fa-post]'); await pg.wait_for_timeout(500)
        check(await bal('Depreciation') == 240000 and await bal('Accumulated Depreciation') == -240000, 'Depreciation entry posted: expense 2,400.00 / accumulated 2,400.00')
        if SHOT: await pg.screenshot(path=SHOT + '_assets.png')
        await go('#/report/fixedassets?asOf=2026-06-30'); await pg.wait_for_selector('[data-testid=fa-register]')
        fr = await pg.inner_text('[data-testid=fa-register]')
        check('Delivery van' in fr and '27,600.00' in fr, 'Fixed Asset Register: book value 27,600.00', fr)
        check(await ev("OB.ui.book.checkIntegrity().issues.length") == 0, 'Data integrity check passes')
        check(not errs, 'No JavaScript errors', errs)
        await ctx.close()
    print('\n%d passed, %d failed' % (sum(1 for r in results if r[0]), sum(1 for r in results if not r[0])))
    sys.exit(0 if all(r[0] for r in results) else 1)
asyncio.run(main())

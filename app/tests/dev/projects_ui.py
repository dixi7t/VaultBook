"""
VaultBook 1.16 browser test (developer-only): Customer:Job, billable costs re-billed on an invoice, attachments,
tax-line mapping and Income Tax Summary, Unbilled Costs report.
Usage: python3 projects_ui.py /path/to/app/index.html [screenshot-prefix]
"""
import asyncio, sys, tempfile, os
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
async def pick(pg, sel, text):
    await pg.click(sel); await pg.fill(sel, text); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(150)
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(), viewport={'width': 1400, 'height': 1000}, accept_downloads=True)
        pg = ctx.pages[0]; errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); ev = pg.evaluate
        go = lambda h: ev("h => location.hash = h", h)
        await pg.goto(URL); await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'Builders Co'); await pg.click('#newco button[type=submit]'); await pg.wait_for_function('OB.ui.book')
        cid = await ev("(async () => { const b = OB.ui.book; await b.saveContact({ kind: 'vendor', name: 'Lumber Yard' }); return (await b.saveContact({ kind: 'customer', name: 'Smith Family', address: '1 Oak St' })).id; })()")

        # ---- New job from the customer page
        await go('#/contact/' + cid); await pg.wait_for_selector('[data-testid=new-job]'); await pg.click('[data-testid=new-job]'); await pg.wait_for_selector('#ct-name')
        check(await pg.input_value('[data-testid=ct-parent]') == cid, 'New job: “Job of” is preset to the customer')
        await pg.fill('#ct-name', 'Kitchen'); await pg.select_option('#ct-jobstatus', 'in progress'); await pg.click('.modal .btn.primary')
        await wait_hash(pg, lambda h: h.startswith('#/contact/') and not h.endswith(cid)); await pg.wait_for_timeout(300)
        check('Smith Family:Kitchen' in await pg.inner_text('main h1'), 'Job page is titled Customer:Job')
        jid = await ev("OB.ui.book.contacts.find(c => c.name === 'Kitchen').id")
        await go('#/customers'); await pg.wait_for_timeout(300)
        check('Smith Family:Kitchen' in await pg.inner_text('main') and 'in progress' in await pg.inner_text('main'), 'Customer list shows the job under its customer with its status')

        # ---- bill with a billable line for the job
        await go('#/txn/new?type=bill'); await pg.wait_for_selector('#txf')
        await pick(pg, '.tx-head .combo-input', 'Lumber')
        await pick(pg, 'tr.line:nth-child(1) td:not(.bill-cust) .combo-input', 'Repairs')
        await pg.fill('tr.line:nth-child(1) input[data-f=description]', 'Cabinets'); await pg.fill('tr.line:nth-child(1) input[data-f=amount]', '400'); await pg.dispatch_event('tr.line:nth-child(1) input[data-f=amount]', 'input')
        await pick(pg, 'tr.line:nth-child(1) .bill-cust .combo-input', 'Smith Family:Kit')
        await pg.check('tr.line:nth-child(1) input[data-f=billable]')
        await pg.click('button[data-after=view]'); await wait_hash(pg, lambda h: h.startswith('#/txn/') and 'new' not in h); await pg.wait_for_timeout(300)
        bill = await ev("OB.ui.book.transactions.find(t => t.type === 'bill')")
        check(bill['lines'][0].get('billable') and bill['lines'][0]['contactId'] == jid, 'Bill line saved as billable to the job')

        # ---- attachments on the bill
        await pg.wait_for_selector('[data-testid=attachments]')
        f = os.path.join(tempfile.mkdtemp(), 'receipt.txt'); open(f, 'w').write('Lumber receipt 400.00')
        await pg.set_input_files('[data-testid=attach-file]', f); await pg.wait_for_timeout(600)
        check('receipt.txt' in await pg.inner_text('[data-testid=attachments]'), 'File attached to the bill and listed')
        async with pg.expect_download() as dl: await pg.click('[data-testid=attachments] [data-open]')
        check(open(await (await dl.value).path()).read() == 'Lumber receipt 400.00', 'Attachment opens with the original content')

        # ---- invoice the job: add billable costs
        await ev("OB.ui.dirty = false"); await go('#/txn/new?type=invoice'); await pg.wait_for_selector('[data-testid=qb-invoice]')
        await pick(pg, '.qbi-cust .combo-input', 'Smith Family:Kit')
        btn = pg.locator('[data-testid=add-billables]')
        check(await btn.is_visible() and '(1)' in await btn.inner_text(), 'Invoice offers “+ Billable costs (1)” for the job')
        await btn.click(); await pg.wait_for_selector('.modal [data-bk]'); await pg.click('.modal .btn.primary'); await pg.wait_for_timeout(300)
        check(await pg.input_value('tr.line:nth-child(1) input[data-f=amount]') == '400.00' and not await btn.is_visible(), 'The cost is added as an invoice line and the button hides')
        await pg.click('button[data-after=view]'); await wait_hash(pg, lambda h: h.startswith('#/txn/') and 'new' not in h); await pg.wait_for_timeout(300)
        r = await ev("(() => { const b = OB.ui.book; return { unb: b.unbilledCosts().length, rep: b.accountBalance(b.accounts.find(a => a.name === 'Repairs & Maintenance').id), ar: b.contactBalance(%r) }; })()" % jid)
        check(r == {'unb': 0, 'rep': 0, 'ar': 40000}, 'Billed: no unbilled costs, expense nets to 0, the job owes 400.00', r)
        await go('#/report/unbilled'); await pg.wait_for_timeout(400)
        check('No unbilled costs' in await pg.inner_text('main'), 'Unbilled Costs by Job is empty after billing')

        # ---- tax lines
        await go('#/taxlines'); await pg.wait_for_selector('[data-testid=taxlines]')
        await pg.select_option('#tl-form', '1040C'); await pg.wait_for_selector('[data-testid=tl-suggest]')
        await pg.click('[data-testid=tl-suggest]')
        adv = await ev("document.querySelector('[data-tl=\"' + OB.ui.book.accounts.find(a => a.name === 'Advertising & Marketing').id + '\"]').value")
        check(adv == 'C8', 'Suggest maps Advertising & Marketing to Schedule C line 8', adv)
        await pg.click('#tl button[type=submit]'); await pg.wait_for_timeout(400)
        check(len(await ev("Object.keys(OB.ui.book.company.taxLines)")) > 20, 'Tax lines saved')
        await ev("(async () => { const b = OB.ui.book; const A = (n) => b.accounts.find(a => a.name === n).id; await b.saveTransaction({ type: 'salesReceipt', date: new Date().toISOString().slice(0, 10), contactId: %r, accountId: A('Checking'), lines: [{ accountId: A('Sales'), amount: '900' }] }); await b.saveTransaction({ type: 'expense', date: new Date().toISOString().slice(0, 10), accountId: A('Checking'), lines: [{ accountId: A('Advertising & Marketing'), amount: '120' }] }); })()" % cid)
        y = await ev("new Date().toISOString().slice(0, 4)")
        await go('#/report/taxsum?from=%s-01-01&to=%s-12-31' % (y, y)); await pg.wait_for_selector('[data-testid=taxsum]')
        ts = await pg.inner_text('[data-testid=taxsum]')
        check('1 Gross receipts or sales' in ts and '900.00' in ts and '8 Advertising' in ts and '120.00' in ts, 'Income Tax Summary lists Schedule C lines', ts[:300])
        if SHOT: await pg.screenshot(path=SHOT + '_taxsum.png')
        check(not errs, 'No JavaScript errors', errs)
        await ctx.close()
    print('\n%d passed, %d failed' % (sum(1 for r in results if r[0]), sum(1 for r in results if not r[0])))
    sys.exit(0 if all(r[0] for r in results) else 1)
asyncio.run(main())

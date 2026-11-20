"""
VaultBook invoice entry screen test (developer-only, 1.12): the QuickBooks Desktop style Create Invoices layout.
Usage: python3 qbinvoice_ui.py /path/to/app/index.html [screenshot.png]
"""
import asyncio, sys, tempfile
from playwright.async_api import async_playwright
APP = sys.argv[1]; URL = 'file://' + APP
SHOT = sys.argv[2] if len(sys.argv) > 2 else None
results = []
def check(c, n, d=''):
    results.append((bool(c), n)); print(('  ok   ' if c else '  FAIL ') + n + (('  [' + str(d)[:200] + ']') if d and not c else ''))
async def wait_hash(pg, test):
    for _ in range(60):
        h = await pg.evaluate("() => location.hash")
        if test(h): return h
        await pg.wait_for_timeout(100)
    return await pg.evaluate("() => location.hash")
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(), viewport={'width': 1300, 'height': 1000})
        pg = ctx.pages[0]; errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); ev = pg.evaluate
        await pg.goto(URL); await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'Screen Test Co'); await pg.click('#newco button[type=submit]'); await pg.wait_for_function('OB.ui.book')
        await ev("""(async () => { const b = OB.ui.book;
          await b.saveContact({ kind: 'customer', name: 'Example Hospital', company: 'Example Health LLC', address: '9 Care Rd\\nTucson, AZ 85701', terms: 30 });
          await b.saveContact({ kind: 'customer', name: 'Walk-in Clinic' }); })()""")
        await ev("h => location.hash = h", '#/txn/new?type=invoice'); await pg.wait_for_selector('[data-testid=qb-invoice]')
        txt = await pg.inner_text('[data-testid=qb-invoice]')
        check(all(x in txt for x in ['Customer:Job', 'Invoice', 'DATE', 'INVOICE #', 'BILL TO', 'TERMS', 'ITEM', 'DESCRIPTION', 'QTY', 'RATE', 'AMOUNT', 'CUSTOMER MESSAGE', 'MEMO', 'TOTAL', 'PAYMENTS APPLIED', 'BALANCE DUE', 'Save & Close', 'Save & New', 'Revert']), 'Screen has the QuickBooks Create Invoices sections and labels', txt[:300])
        check(all(x in txt for x in ['Find', 'New', 'Save']) and 'Email' not in txt and 'Attach' not in txt, 'Toolbar shows only working commands (no Email/Attach placeholders)')
        check(await pg.locator('tbody.lines tr.line').count() == 3, 'Grid starts with 3 blank lines; more appear as the last one is used')
        opts = await ev("[...document.querySelectorAll('#qbi-msg option')].map(o => o.textContent)")
        check(opts[1:6] == ['All work is complete!', 'It’s been a pleasure working with you!', 'Please remit to above address.', 'Thank you for your business.', 'We appreciate your prompt payment.'] and opts[-1] == '< Add New >' and await pg.input_value('#qbi-msg') == 'Thank you for your business.', 'Customer message list matches QuickBooks, new invoices default to "Thank you for your business."', opts)
        terms = await ev("[...document.querySelectorAll('select[name=terms] option')].map(o => o.textContent)")
        check('Due on receipt' in terms and 'Net 30' in terms, 'Terms dropdown offers Due on receipt and Net terms', terms)
        await pg.click('.qbi-cust .combo-input'); await pg.fill('.qbi-cust .combo-input', 'Example Hosp'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(200)
        addr = await pg.inner_text('#qbi-addr')
        check('Example Hospital' in addr and 'Example Health LLC' in addr and 'Tucson, AZ 85701' in addr, 'Picking the customer fills the BILL TO box', addr)
        check(await pg.input_value('select[name=terms]') == '30', 'Picking the customer applies their terms (Net 30)')
        await pg.fill('input[name=date]', '2026-10-01'); await pg.dispatch_event('input[name=date]', 'change'); await pg.wait_for_timeout(100)
        await pg.select_option('select[name=terms]', '0'); await pg.wait_for_timeout(100)
        check(await pg.input_value('input[name=dueDate]') == '2026-10-01', 'Due on receipt sets the due date to the invoice date', await pg.input_value('input[name=dueDate]'))
        await pg.click('tr.line:nth-child(1) .combo-input'); await pg.fill('tr.line:nth-child(1) .combo-input', 'Services'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(120)
        await pg.fill('tr.line:nth-child(1) input[data-f=description]', 'Radiology reading')
        await pg.fill('tr.line:nth-child(1) input[data-f=qty]', '4'); await pg.fill('tr.line:nth-child(1) input[data-f=rate]', '125'); await pg.wait_for_timeout(150)
        check(await pg.input_value('tr.line:nth-child(1) input[data-f=amount]') == '500.00', 'QTY × RATE fills AMOUNT', await pg.input_value('tr.line:nth-child(1) input[data-f=amount]'))
        tot = await pg.inner_text('#totals')
        check('500.00' in tot and 'BALANCE DUE' in tot, 'TOTAL and BALANCE DUE follow the lines', tot)
        await pg.select_option('#qbi-msg', '__add'); await pg.wait_for_selector('.modal #pval')
        await pg.fill('.modal #pval', 'Payment due within 10 days.'); await pg.click('.modal .btn.primary'); await pg.wait_for_timeout(300)
        check(await pg.input_value('#qbi-msg') == 'Payment due within 10 days.' and 'Payment due within 10 days.' in await ev("OB.ui.book.company.customerMessages"), '< Add New > saves a new customer message to the company list and selects it')
        await pg.fill('input[name=memo]', 'October reads')
        if SHOT:
            await ev("document.querySelector('[data-testid=qb-invoice]').scrollIntoView()"); await pg.screenshot(path=SHOT)
            await ev("document.documentElement.setAttribute('data-theme', 'dark')"); await pg.wait_for_timeout(200); await pg.screenshot(path=SHOT.replace('.png', '_dark.png')); await ev("document.documentElement.removeAttribute('data-theme')")
        await pg.click('button[data-after=new]')
        await pg.wait_for_function("() => OB.ui.book.transactions.some(t => t.type === 'invoice')", timeout=10000)
        await pg.wait_for_timeout(400)
        t = await ev("(() => { const t = OB.ui.book.transactions.find(t => t.type === 'invoice'); return { total: t.total, msg: t.message, memo: t.memo, terms: t.terms, due: t.dueDate, n: t.lines.length }; })()")
        check(t['total'] == 50000 and t['msg'] == 'Payment due within 10 days.' and t['memo'] == 'October reads' and t['due'] == '2026-10-01' and t['n'] == 1, 'Save & New stores the invoice with message, memo, terms and only the filled line', t)
        check(await pg.input_value('input[name=memo]') == '' and await pg.locator('[data-testid=qb-invoice]').count() == 1, 'Save & New opens a blank invoice')
        await ev("""(async () => { const b = OB.ui.book; const c = b.contacts.find(c => c.name === 'Walk-in Clinic'); const s = b.accounts.find(a => a.name === 'Services').id;
          await b.saveTransaction({ type: 'invoice', date: '2026-10-05', contactId: c.id, lines: [{ accountId: s, description: 'Second', amount: '80' }] }); })()""")
        ids = await ev("OB.ui.book.posted().filter(t => t.type === 'invoice').sort(OB.Book.cmpTxn).map(t => t.id)")
        await ev("h => location.hash = h", '#/txn/' + ids[1]); await pg.wait_for_selector('[data-testid=qb-invoice] [data-act=findPrev]')
        check('See History' in await pg.inner_text('.qbi-title'), 'Saved invoices show the See History link')
        check(await pg.is_disabled('[data-act=findNext]') and not await pg.is_disabled('[data-act=findPrev]'), 'Find ‹ › is enabled only where there is a previous / next invoice')
        await pg.click('[data-act=findPrev]'); h = await wait_hash(pg, lambda h: h.endswith(ids[0]))
        check(h.endswith(ids[0]), 'Find ‹ goes to the previous invoice', h)
        await pg.wait_for_selector('[data-testid=qb-invoice] input[name=memo]')
        for _ in range(40):
            if await ev("(document.querySelector('input[name=memo]') || {}).value") == 'October reads': break
            await pg.wait_for_timeout(100)
        check(await pg.input_value('#qbi-msg') == 'Payment due within 10 days.', 'Saved customer message shows when the invoice is reopened')
        await pg.fill('input[name=memo]', 'changed'); await pg.dispatch_event('input[name=memo]', 'input')
        await pg.click('[data-act=revert]'); await pg.wait_for_selector('.modal'); await pg.click('.modal .btn.danger'); await pg.wait_for_timeout(400)
        check(await pg.input_value('input[name=memo]') == 'October reads', 'Revert discards unsaved edits')
        await ev("h => location.hash = h", '#/print/' + ids[0]); await pg.wait_for_selector('[data-testid=invoice-doc] svg')
        pt = await ev("[...document.querySelectorAll('[data-testid=invoice-doc] text')].map(x => x.textContent).join('\\n')")
        check('Payment due within 10 days.' in pt and 'Thank you for your business.' not in pt, 'The chosen customer message prints on the invoice')
        await ev("h => location.hash = h", '#/txn/' + ids[0]); await pg.wait_for_selector('[data-testid=qb-invoice] button[data-after=close]')
        await pg.fill('input[name=memo]', 'October reads (final)'); await pg.keyboard.press('Control+s')
        h = await wait_hash(pg, lambda h: not h.startswith('#/txn/'))
        check(not h.startswith('#/txn/') and await ev("OB.ui.book.txById[%r].memo" % ids[0]) == 'October reads (final)', 'Ctrl+S is Save & Close', h)
        await pg.set_viewport_size({'width': 400, 'height': 900}); await ev("h => location.hash = h", '#/txn/new?type=invoice'); await pg.wait_for_selector('[data-testid=qb-invoice]')
        ow = await ev("document.documentElement.scrollWidth <= window.innerWidth + 1")
        check(ow, 'Phone width: the page itself does not scroll sideways (the line grid scrolls inside its box)')
        check(not errs, 'No JavaScript errors', errs)
        await ctx.close()
    print('\n%d passed, %d failed' % (sum(1 for r in results if r[0]), sum(1 for r in results if not r[0])))
    sys.exit(0 if all(r[0] for r in results) else 1)
asyncio.run(main())

"""Bank feed part 2 and reconciliation (1.23.0) in the browser: lines already in the books found on import, auto-add
rules, a deposit of several payments, the rules v2 editor with preview, reconcile find, finish with adjustment and the
frozen reconciliation report. Usage: python3 bankplus_ui.py /path/to/app/index.html"""
import asyncio, sys, os, tempfile
from playwright.async_api import async_playwright
APP = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'index.html'))
res = []
def check(ok, msg, info=''):
    res.append(bool(ok)); print(('  ok   ' if ok else '  FAIL ') + msg + ('' if ok else '  -> ' + str(info)))
async def main():
    tmp = tempfile.mkdtemp()
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(os.path.join(tmp, 'p'), viewport={'width': 1440, 'height': 900})
        pg = ctx.pages[0]; ev = pg.evaluate; errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        async def go(h, w=800): await ev(f"OB.ui.dirty = false; location.hash = '{h}'"); await pg.wait_for_timeout(w)
        await pg.goto('file://' + APP); await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'Bank Plus Co'); await pg.click('#newco button[type=submit]'); await pg.wait_for_function('OB.ui.book'); await pg.wait_for_timeout(800)
        ck = await ev("""(async () => { const b = OB.ui.book, A = (n) => b.accounts.find((a) => a.name === n).id; const c = await b.saveContact({ kind: 'customer', name: 'Acme Dental' });
          const inv = (x) => ({ type: 'invoice', date: '2026-10-20', contactId: c.id, lines: [{ accountId: A('Services'), amount: x }] });
          const iv = await b.saveTransactions([inv('500'), inv('1200'), inv('300')]);
          await b.saveTransactions(iv.map((t) => ({ type: 'payment', date: '2026-10-25', contactId: c.id, accountId: b.sys('UNDEP').id, amount: t.total, applications: [{ txnId: t.id, amount: t.total }] })));
          for (let i = 0; i < 5; i++) await b.saveTransaction({ type: 'check', date: '2026-10-0' + (i + 1), accountId: A('Checking'), number: String(1100 + i), lines: [{ accountId: A('Rent & Lease'), amount: String(100 + i) }] });
          await b.saveRule({ name: 'Bank fee', conditions: [{ field: 'desc', op: 'contains', value: 'SERVICE FEE' }], accountId: A('Bank Charges & Fees'), autoAdd: true });
          return A('Checking'); })()""")
        csv = os.path.join(tmp, 'bank.csv')
        open(csv, 'w').write('Date,Description,Amount,Check\n' + ''.join(f'10/{6 + i:02d}/2026,CHECK {1100 + i},-{100 + i}.00,{1100 + i}\n' for i in range(5)) + '10/27/2026,REMOTE DEPOSIT,2000.00,\n10/28/2026,AMAZON MKTPLACE,-45.99,\n10/31/2026,SERVICE FEE,-12.00,\n')
        await go('#/bankfeed?import=1&account=' + ck)
        await pg.select_option('#bfi-acc', ck)
        await pg.set_input_files('[data-testid=bf-file-input]', csv); await pg.wait_for_timeout(600)
        if await pg.locator('[data-testid=bf-map-next]').count(): await pg.click('[data-testid=bf-map-next]'); await pg.wait_for_timeout(500)
        pv = await pg.inner_text('[data-testid=bf-preview]')
        check('5' in await pg.inner_text('[data-testid=bf-inbooks]') and 'auto-add' in pv, 'Preview: 5 checks already in the books, 1 auto-add line', pv)
        await pg.click('[data-testid=bf-import-go]'); await pg.wait_for_timeout(1300)
        r = await ev(f"(() => {{ const b = OB.ui.book; return {{ review: b.bankLinesFor('{ck}', 'review').length, books: b.bankLines.filter((l) => l.auto === 'books').length, txns: b.transactions.filter((t) => t.status === 'posted').length }}; }})()")
        check(r['review'] == 2 and r['books'] == 5 and r['txns'] == 12, 'Import matched the 5 checks, posted the fee, left 2 for review (nothing doubled)', r)
        mid = await ev("[...document.querySelectorAll('tr.bf-row')].find((x) => /REMOTE DEPOSIT/.test(x.textContent)).querySelector('.bf-mid').textContent")
        check('Deposit of 3 payments' in mid, 'The $2,000 deposit is matched to the 3 payments waiting in Undeposited Funds', mid)
        await ev("[...document.querySelectorAll('tr.bf-row')].find((x) => /REMOTE DEPOSIT/.test(x.textContent)).querySelector('[data-act=post]').click()"); await pg.wait_for_timeout(1000)
        check(await ev('OB.ui.book.undepositedItems().length') == 0 and await ev(f"OB.ui.book.accountBalance('{ck}')") == 200000 - 51000 - 1200, 'Match records the deposit; Undeposited Funds is empty')
        await pg.click('[data-testid=bf-tab-posted]') if await pg.locator('[data-testid=bf-tab-posted]').count() else await ev("[...document.querySelectorAll('button')].find((x) => /^Posted/.test(x.textContent.trim())).click()")
        await pg.wait_for_timeout(500)
        check(await ev("document.querySelectorAll('tr.bf-row .badge.ok').length") >= 5, 'Posted tab marks the lines found in the books')

        # rules v2 editor
        await go('#/rules'); await pg.click('#ru-new'); await pg.wait_for_timeout(300)
        await pg.fill('.ru-cond input[data-c=value]', 'AMAZON'); await pg.click('#ru-addc'); await pg.wait_for_timeout(100)
        await pg.select_option('.ru-cond:nth-child(2) [data-c=field]', 'amount'); await pg.wait_for_timeout(200)
        await pg.select_option('.ru-cond:nth-child(2) [data-c=op]', 'lt'); await pg.wait_for_timeout(100)
        await pg.fill('.ru-cond:nth-child(2) [data-c=value]', '100'); await pg.wait_for_timeout(400)
        check('1' in (await pg.inner_text('[data-testid=ru-preview]'))[:3], 'Preview counts the Amazon line under $100', await pg.inner_text('[data-testid=ru-preview]'))
        await pg.click('.modal .combo:has(#ru-acc) .combo-input'); await pg.keyboard.type('Office Supplies'); await pg.wait_for_timeout(300); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(200)
        await pg.click('.modal .btn.primary'); await pg.wait_for_timeout(600)
        check(await ev("OB.ui.book.rules.filter((r) => !r.deleted).length") == 2 and 'Amazon' in await pg.inner_text('.ru-list') or 'AMAZON' in await pg.inner_text('.ru-list'), 'Rule saved and listed with its conditions')
        await go('#/bankfeed?account=' + ck + '&tab=review')
        mid = await ev("[...document.querySelectorAll('tr.bf-row')].find((x) => /AMAZON/.test(x.textContent)).querySelector('.bf-mid').textContent")
        check('Office Supplies' in mid and 'Rule' in mid, 'The new rule suggests the category', mid)

        # reconcile: find, adjustment, report
        await go(f'#/reconcile?account={ck}&date=2026-10-31&ending=1490.00')
        await pg.fill('[data-testid=rc-search]', '1102'); await pg.wait_for_timeout(200)
        check((await ev("document.querySelector('#rc-found').textContent")).startswith('1 of'), 'Find narrows the list to check 1102')
        await pg.fill('[data-testid=rc-search]', ''); await pg.wait_for_timeout(100)
        check(await pg.locator('[data-testid=rc-adjust]').count() == 1, 'A difference offers Finish with adjustment')
        await pg.click('[data-testid=rc-adjust]'); await pg.wait_for_timeout(300); await pg.click('.modal .btn.primary'); await pg.wait_for_timeout(1300)
        check((await ev('location.hash')).startswith('#/recreport/'), 'Finishing opens the reconciliation report', await ev('location.hash'))
        sm = await pg.inner_text('[data-testid=rr-summary]')
        check('Reconciliation adjustment' in sm and '1,490.00' in sm and 'Register balance' in sm, 'Report shows the adjustment, ending and register balances', sm)
        check(await ev("OB.ui.book.accountBalance(OB.ui.book.accounts.find((a) => a.name === 'Reconciliation Discrepancies').id)") != 0, 'Difference posted to Reconciliation Discrepancies')
        rt = await pg.inner_text('[data-testid=rr-table]')
        check('Beginning Balance' in rt and 'Cleared Balance' in rt and 'Ending Balance' in rt and ' items' in rt, 'Report reads like QuickBooks Reconciliation Detail (sections, item counts, balances)', rt[:200])
        check(await ev("[...document.querySelectorAll('[data-testid=rr-table] thead th')].map(t => t.textContent).join('|')") == 'Type|Date|Num|Name|Memo|Clr|Amount|Balance', 'Columns Type, Date, Num, Name, Memo, Clr, Amount, Balance')
        await pg.click('[data-testid=rr-view-summary]'); await pg.wait_for_function("document.querySelector('[data-testid=rr-report] h1').textContent === 'Reconciliation Summary'")
        check('Difference' in await pg.inner_text('[data-testid=rr-table]'), 'Summary view with the difference')
        await pg.click('[data-testid=rr-pdf]'); await pg.wait_for_selector('.modal')
        async with pg.expect_download() as dl: await pg.click('.modal .btn.primary')
        d = await dl.value; pth = await d.path(); data = open(pth, 'rb').read()
        check(data[:5] == b'%PDF-' and b'Reconciliation Summary' in data and b'Period Ending' in data, 'Download PDF gives a real PDF with searchable text')
        await go(f'#/reconcile?account={ck}')
        check(await pg.locator('[data-testid=rc-report-link]').count() == 1, 'History links to the report')
        check(not errs, 'No page errors', errs)
        await ctx.close()
    print('\n%d passed, %d failed' % (res.count(True), res.count(False)))
    sys.exit(0 if all(res) else 1)
asyncio.run(main())

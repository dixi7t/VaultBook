"""VaultBook 1.48.0 — Paste entries page: paste a QuickBooks report from Excel, repeat monthly, create the missing
account and name, post, check the ledger, void. Synthetic names only. Run: python3 tests/dev/paste_ui.py [screenshot dir]"""
import asyncio, os, sys, tempfile
from playwright.async_api import async_playwright
APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'index.html')
SHOT = sys.argv[1] if len(sys.argv) > 1 else ''
QB = '\tType\tDate\tNum\tAdj\tName\tMemo\tClr\tSplit\tDebit\tCredit\tBalance\nRent Expense\n\tCheck\t1/29/2024\t\t\tPine Street LLC\tMonthly rent unit 4\t\tFirst Test Bank 7038\t1,500.00\t\t1,500.00\nTotal Rent Expense\t\t\t\t\t\t\t\t1500\t0\t1500\nTOTAL\t\t\t\t\t\t\t\t1500\t0\t1500\n'
passed = failed = 0
def check(name, ok, extra=''):
    global passed, failed
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok else '  ' + str(extra))); passed += ok; failed += not ok
async def paste(pg, sel, text):
    await pg.evaluate("([s, t]) => { const el = document.querySelector(s); el.focus(); const d = new DataTransfer(); d.setData('text/plain', t); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: d, bubbles: true, cancelable: true })); }", [sel, text])
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(), viewport={'width': 1440, 'height': 900})
        pg = ctx.pages[0]; ev = pg.evaluate; errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://' + APP); await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'Paste Test'); await pg.click('#newco button[type=submit]')
        await pg.wait_for_function("OB.ui.book && OB.ui.book.company.name === 'Paste Test'", timeout=30000)
        rent = await ev("OB.ui.book.saveAccount({ name: 'Rent Expense', type: 'expense' }).then(a => a.id)")
        await ev("location.hash = '#/register/%s'" % rent); await pg.wait_for_selector('[data-testid=reg-paste]')
        await pg.click('[data-testid=reg-paste]'); await pg.wait_for_selector('[data-testid=pe-grid]')
        check('PU-01 opens from the ledger with the ledger chosen', await ev("document.querySelector('#pe-led').value") == rent)
        await paste(pg, 'input[data-r="0"][data-f="date"]', QB); await pg.wait_for_timeout(200)
        row = await ev("['type','date','name','memo','split','debit'].map(f => document.querySelector(`input[data-r='0'][data-f='${f}']`).value)")
        check('PU-02 the report pastes into one row; headings and totals dropped', row == ['Check', '01/29/2024', 'Pine Street LLC', 'Monthly rent unit 4', 'First Test Bank 7038', '1500.00'] and await ev("document.querySelector('input[data-r=\"1\"][data-f=\"date\"]').value") == '', row)
        check('PU-03 the missing bank account is offered, as Bank', await ev("document.querySelector('[data-miss]') && document.querySelector('[data-miss]').value") == 'type:bank')
        check('PU-04 the new vendor is named', 'Pine Street LLC' in await ev("document.querySelector('.pe-names').innerText"))
        check('PU-05 status says Check', 'Check' in await ev("document.querySelector('[data-st=\"0\"]').innerText"))
        await pg.fill('#pe-months', '2'); await pg.click('[data-testid=pe-repeat]'); await pg.wait_for_timeout(200)
        dates = await ev("[0,1,2].map(i => document.querySelector(`input[data-r='${i}'][data-f='date']`).value)")
        check('PU-06 repeat monthly adds Feb and Mar', dates == ['01/29/2024', '02/29/2024', '03/29/2024'], dates)
        inp = 'input[data-r="2"][data-f="memo"]'; await pg.fill(inp, 'March rent'); await pg.press(inp, 'Tab')
        await paste(pg, 'input[data-r="3"][data-f="date"]', '04/29/2024\t\t\tPine Street LLC\tApril rent\t\tFirst Test Bank 7038\t1500'); await pg.wait_for_timeout(200)
        check('PU-07 plain cells paste from the focused column', await ev("document.querySelector('input[data-r=\"3\"][data-f=\"memo\"]').value") == 'April rent' and await ev("document.querySelector('input[data-r=\"3\"][data-f=\"debit\"]').value") == '1500.00')
        await pg.fill('input[data-r="4"][data-f="date"]', '05/29/2024'); await pg.press('input[data-r="4"][data-f="date"]', 'Tab'); await pg.wait_for_timeout(150)
        check('PU-08 a row without amount or split is marked', 'Enter a Debit' in await ev("document.querySelector('[data-st=\"4\"]').innerText"))
        await pg.click('[data-testid=pe-post]'); await pg.wait_for_timeout(300)
        check('PU-09 posting is refused while a row has an error', await ev("OB.ui.book.transactions.length") == 0)
        await pg.click('input.pe-sel[data-r="4"]'); await pg.click('#pe-del'); await pg.wait_for_timeout(150)
        if SHOT: await pg.screenshot(path=os.path.join(SHOT, 'paste-grid.png'), full_page=True)
        check('PU-10 four entries, total 6,000.00', 'Post 4 entries' in await ev("document.querySelector('[data-testid=pe-post]').innerText") and '6,000.00' in await ev("document.querySelector('.pe-sum').innerText"))
        await pg.click('[data-testid=pe-post]'); await pg.wait_for_selector('[data-testid=pe-result]', timeout=10000)
        info = await ev("""(() => { const b = OB.ui.book, bank = b.accounts.find(a => a.name === 'First Test Bank 7038');
          return { n: b.transactions.length, types: b.transactions.map(t => t.type).join(','), bank: bank && bank.type, bal: b.accountBalance('%s'), bankBal: bank && b.accountBalance(bank.id),
            vend: b.contacts.filter(c => c.name === 'Pine Street LLC').map(c => c.kind).join(), memo: b.transactions[2].lines[0].description || b.transactions[2].memo }; })()""" % rent)
        check('PU-11 three checks and a journal (blank Type) from a new bank account to the new vendor', info['n'] == 4 and info['types'] == 'check,check,check,journal' and info['bank'] == 'bank' and info['vend'] == 'vendor', info)
        check('PU-12 rent 6,000 debit, bank 6,000 credit, edited memo kept', info['bal'] == 600000 and info['bankBal'] == -600000 and info['memo'] == 'March rent', info)
        await paste(pg, 'input[data-r="0"][data-f="date"]', QB); await pg.wait_for_timeout(200)
        check('PU-13 pasting the same row again is flagged as a possible duplicate', 'duplicate' in await ev("document.querySelector('[data-st=\"0\"]').innerText") and not await ev("document.querySelector('[data-miss]')"))
        await pg.click('#pe-clear'); await pg.click('.modal button.danger, .modal .btn.danger'); await pg.wait_for_timeout(200)
        await pg.click('[data-testid=pe-void]'); await pg.click('.modal button.danger, .modal .btn.danger'); await pg.wait_for_function("OB.ui.book.transactions.every(t => t.status === 'void')", timeout=10000)
        check('PU-14 Void these entries voids all four', await ev("OB.ui.book.accountBalance('%s')" % rent) == 0)
        await ev("location.hash = '#/paste'"); await pg.wait_for_timeout(300)
        check('PU-15 sidebar and palette entries exist', await ev("!!document.querySelector('[data-testid=nav-paste]')"))
        # one $10,000 payment split 2,000 / 2,000 / 6,000, three ways from Excel, on the Checking ledger
        ck = await ev("OB.ui.book.accounts.find(a => a.name === 'Checking').id")
        await ev("Promise.all(['Rent A', 'Rent B', 'Rent C'].map(n => OB.ui.book.saveAccount({ name: n, type: 'expense' })))")
        await ev("location.hash = '#/paste?account=%s'" % ck); await pg.wait_for_timeout(400)
        await paste(pg, 'input[data-r="0"][data-f="date"]', 'Type\tDate\tName\tMemo\tSplit\tDebit\tCredit\nCheck\t06/01/2024\tPine Street LLC\tJune rent\tRent A 2000; Rent B 2000; Rent C\t\t10,000.00\n'
            'Check\t07/01/2024\tPine Street LLC\tJuly rent\tRent A\t\t2000\n\t\t\tStore B\tRent B\t\t2000\n\t\t\t\tRent C\t\t6000\nTotal\t\t\t\t\t\t10000\n'
            'Check\t08/01/2024\tPine Street LLC\tAug rent\tRent A\t\t2000\nCheck\t08/01/2024\tPine Street LLC\tAug rent\tRent B\t\t2000\nCheck\t08/01/2024\tPine Street LLC\tAug rent\tRent C\t\t6000\n'); await pg.wait_for_timeout(250)
        st = await ev("[0,1,4].map(i => document.querySelector(`[data-st='${i}']`).innerText)")
        check('PU-17 a Split cell with three accounts and blank-date lines each show as one check with 3 lines', st[0] == 'Check · 3 lines' and st[1] == 'Check · 3 lines' and 'Check' in st[2], st)
        for i in (4, 5, 6): await pg.click('input.pe-sel[data-r="%d"]' % i)
        await pg.click('[data-testid=pe-join]'); await pg.wait_for_timeout(200)
        check('PU-18 Join into one entry groups three separate rows', await ev("document.querySelector('[data-st=\"4\"]').innerText") == 'Check · 3 lines' and await ev("document.querySelector('[data-st=\"5\"]').innerText") == '↳ same entry')
        if SHOT: await pg.screenshot(path=os.path.join(SHOT, 'paste-split.png'), full_page=True)
        await pg.click('[data-testid=pe-post]'); await pg.wait_for_selector('[data-testid=pe-result]', timeout=10000)
        got = await ev("""(() => { const b = OB.ui.book, live = b.transactions.filter(t => t.status === 'posted');
          return { n: live.length, lines: live.map(t => t.lines.map(l => l.amount).join('/')), bank: b.accountBalance('%s'),
            c: ['Rent A', 'Rent B', 'Rent C'].map(n => b.accountBalance(b.accounts.find(a => a.name === n).id)) }; })()""" % ck)
        check('PU-19 three $10,000 checks posted, each split 2,000 / 2,000 / 6,000', got['n'] == 3 and got['lines'] == ['200000/200000/600000'] * 3 and got['bank'] == -3000000 and got['c'] == [600000, 600000, 1800000], got)
        check('PU-16 no page errors', not errs, errs)
        print('\n%d passed, %d failed' % (passed, failed)); await ctx.close()
asyncio.run(main())

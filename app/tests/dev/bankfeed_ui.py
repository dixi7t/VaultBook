"""Bank feed (1.20) in the browser: import wizard with the real Chase layout, date-format and bad-file handling,
For review / Posted / Excluded, Add / Match / Transfer / Split, Undo, batch post, keyboard, columns and density,
import history undo, lines surviving a reload, and Reconcile starting from the file's ending balance.
Usage: python3 bankfeed_ui.py /path/to/app/index.html"""
import asyncio, sys, os, tempfile
from playwright.async_api import async_playwright
APP = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'index.html'))
res = []
def check(ok, msg, info=''):
    res.append(bool(ok)); print(('  ok   ' if ok else '  FAIL ') + msg + ('' if ok else '  -> ' + str(info)))
TMP = tempfile.mkdtemp()
def write(name, text):
    p = os.path.join(TMP, name); open(p, 'w').write(text); return p
CHASE = write('chase.csv', 'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\n'
  'DEBIT,11/02/2026,"SQ *BLUE BOTTLE COFFEE 4432 NEW YORK NY",-14.75,DEBIT_CARD,10234.10,\n'
  'DEBIT,11/02/2026,"COMCAST CABLE COMM 800-COMCAST PA",-189.99,ACH_DEBIT,10248.85,\n'
  'CREDIT,11/01/2026,"REMOTE ONLINE DEPOSIT #         1",2450.00,CHECK_DEPOSIT,10438.84,\n'
  'DEBIT,10/31/2026,"CHECK 1042",-850.00,CHECK_PAID,7988.84,1042\n'
  'DEBIT,10/30/2026,"ONLINE TRANSFER TO SAV ...4411",-500.00,ACCT_XFER,8838.84,\n')
SAV = write('savings.csv', 'Date,Description,Amount\n10/30/2026,ONLINE TRANSFER FROM CHK ...9921,500.00\n')
DDMM = write('ddmm.csv', 'Date,Narration,Withdrawal,Deposit\n03/11/2026,Office rent,1500.00,\n05/11/2026,Client payment,,900.00\n')
JUNK = write('junk.csv', 'not,a,bank\nfile,with,junk\n')

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(), viewport={'width': 1440, 'height': 900})
        pg = ctx.pages[0]; ev = pg.evaluate; errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        async def go(h, wait=800): await ev(f"OB.ui.dirty = false; location.hash = '{h}'"); await pg.wait_for_timeout(wait)
        await pg.goto('file://' + APP); await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'Feed UI Co'); await pg.click('#newco button[type=submit]'); await pg.wait_for_function('OB.ui.book')
        ck = await ev("OB.ui.book.accounts.find(a => a.name === 'Checking').id"); sv = await ev("OB.ui.book.accounts.find(a => a.name === 'Savings').id")
        # a check already entered by hand, so the bank's CHECK 1042 has a match
        await ev(f"""OB.ui.book.saveTransaction({{ type: 'check', date: '2026-10-29', accountId: '{ck}', number: '1042', lines: [{{ accountId: OB.ui.book.accounts.find(a => a.name === 'Rent & Lease').id, amount: '850' }}] }})""")

        await go('#/bankfeed')
        tiles = await ev("[...document.querySelectorAll('[data-testid=bf-tile]')].map(t => t.querySelector('.bf-tname').textContent)")
        check(tiles and 'Checking' in tiles[0] and not any('Inventory' in t or 'Undeposited' in t for t in tiles), 'Tiles show bank and card accounts only, Checking first', tiles)
        check(await pg.locator('#nav-bankfeed, [data-testid=nav-bankfeed]').count() == 1, 'Sidebar has a Bank feed link')

        # ---- bad file: plain reason, not a pop-up ----
        await pg.click('[data-testid=bf-import-btn]'); await pg.set_input_files('[data-testid=bf-file-input]', JUNK); await pg.wait_for_timeout(600)
        prob = pg.locator('[data-testid=bf-file-problem]')
        check(await prob.count() == 1 and 'date column' in await prob.inner_text(), 'A non-bank file shows why it is refused', await pg.inner_text('#bf-imp'))
        await pg.click('[data-testid=bf-map-next]'); await pg.wait_for_timeout(300)
        check(await pg.locator('[data-testid=bf-preview]').count() == 0, 'Continue stays on the columns step for a bad file')
        await pg.click('#bfi-back'); await pg.wait_for_timeout(300)

        # ---- dd/mm file: ambiguity flagged, DMY honoured ----
        await pg.set_input_files('[data-testid=bf-file-input]', DDMM); await pg.wait_for_timeout(600)
        check(await pg.locator('[data-testid=bf-date-ambiguous]').count() == 1, 'An ambiguous date file is flagged')
        await pg.select_option('#bfm-df', 'DMY'); await pg.wait_for_timeout(300); await pg.uncheck('#bfm-rem')
        await pg.click('[data-testid=bf-map-next]'); await pg.wait_for_timeout(400)
        check('11/03/2026' in await pg.inner_text('[data-testid=bf-preview]') and '11/05/2026' in await pg.inner_text('[data-testid=bf-preview]'), 'DD/MM dates read as 3 and 5 November', await pg.inner_text('[data-testid=bf-preview]'))
        await pg.click('#bfi-cancel'); await pg.wait_for_timeout(300)

        # ---- Chase CSV: right description, balance check, nothing posted ----
        await pg.click('[data-testid=bf-import-btn]'); await pg.set_input_files('[data-testid=bf-file-input]', CHASE); await pg.wait_for_timeout(600)
        desc = await ev("document.querySelector('#bfm-desc').selectedOptions[0].textContent")
        check(desc.startswith('Description'), 'Chase file: Description column picked (not Details)', desc)
        await pg.click('[data-testid=bf-map-next]'); await pg.wait_for_timeout(400)
        bc = await pg.inner_text('[data-testid=bf-balance-check]')
        check('Checks out' in bc and '10,234.10' in bc, 'Running balance checked; ending balance found', bc)
        n0 = await ev('OB.ui.book.transactions.length')
        ib = pg.locator('[data-testid=bf-inbooks]')
        check(await ib.count() == 1 and '1' in await ib.inner_text(), 'Preview: the hand-entered check is found already in the books', await pg.inner_text('[data-testid=bf-preview]'))
        await pg.uncheck('#bfi-books')   # this test walks the manual Match path; BP-06 covers the automatic one
        await pg.click('[data-testid=bf-import-go]'); await pg.wait_for_timeout(900)
        rows = await ev("[...document.querySelectorAll('tr.bf-row .bf-desc')].map(x => x.textContent)")
        check(len(rows) == 5 and rows[0].startswith('SQ *BLUE BOTTLE') and 'DEBIT' not in rows, 'Five lines in For review with the merchant text', rows)
        check(await ev('OB.ui.book.transactions.length') == n0, 'Nothing posted on import')
        mid = await ev("[...document.querySelectorAll('tr.bf-row')].find(r => r.textContent.includes('CHECK 1042')).querySelector('.bf-mid').textContent")
        check('Match' in mid and 'Check 1042' in mid, 'The hand-entered check is offered as the match', mid)

        # ---- reload: lines are kept ----
        await pg.reload(); await pg.wait_for_function('OB.ui.book', timeout=20000); await go('#/bankfeed?account=' + ck)
        check(await ev("document.querySelectorAll('tr.bf-row').length") == 5, 'For review survives a reload')
        # mapping remembered: the second import of the same layout skips the columns step
        await pg.click('[data-testid=bf-import-btn]'); await pg.set_input_files('[data-testid=bf-file-input]', CHASE); await pg.wait_for_timeout(600)
        pv = await pg.inner_text('#bf-imp')
        check('remembered' in pv and '5 already imported' in pv and await pg.locator('[data-testid=bf-import-go]').is_disabled(), 'Re-import: columns remembered, all lines skipped as already imported', pv[:300])
        await pg.click('#bfi-cancel'); await pg.wait_for_timeout(300)

        # ---- Match (one click) ----
        tr = "[...document.querySelectorAll('tr.bf-row')].find(r => r.textContent.includes('%s'))"
        await ev((tr % 'CHECK 1042') + ".querySelector('[data-act=post]').click()"); await pg.wait_for_timeout(900)
        st = await ev(f"(() => {{ const b = OB.ui.book; const l = b.bankLines.find(x => x.checkNo === '1042'); return [l.status, l.via, b.txById[l.txnId].splits.find(s => s.accountId === '{ck}').cleared]; }})()")
        check(st == ['posted', 'match', 'C'], 'Match links the line to the existing check and clears it', st)

        # ---- open a line, categorize with the combo, Add ----
        await ev((tr % 'COMCAST') + ".querySelector('.bf-desc').click()"); await pg.wait_for_timeout(500)
        check(await pg.locator('.bf-pane').count() == 1, 'Clicking a line opens it inline')
        await pg.click('.bf-pane .combo:has([data-d=categoryId]) .combo-input'); await pg.keyboard.type('Utilities'); await pg.wait_for_timeout(300); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(500)
        await pg.click('[data-testid=bf-detail-add]'); await pg.wait_for_timeout(900)
        t = await ev("(() => { const b = OB.ui.book, l = b.bankLines.find(x => x.description.startsWith('COMCAST')); return [l.status, b.txById[l.txnId].type, b.accById[b.txById[l.txnId].lines[0].accountId].name]; })()")
        check(t == ['posted', 'expense', 'Utilities'], 'Categorize → Add posts an expense to Utilities', t)

        # ---- Transfer, then the savings side matches it ----
        await ev((tr % 'TRANSFER TO SAV') + ".querySelector('.bf-desc').click()"); await pg.wait_for_timeout(400)
        await pg.click(".bf-pane [data-ptab=xfer]"); await pg.wait_for_timeout(300)
        await pg.select_option('.bf-pane [data-d=xferId]', sv); await pg.wait_for_timeout(300)
        await pg.click('[data-testid=bf-detail-xfer]'); await pg.wait_for_timeout(900)
        await pg.click('[data-testid=bf-import-btn]'); await pg.select_option('#bfi-acc', sv); await pg.set_input_files('[data-testid=bf-file-input]', SAV); await pg.wait_for_timeout(600)
        await pg.click('[data-testid=bf-map-next]'); await pg.wait_for_timeout(400)
        if await pg.locator('#bfi-books').count(): await pg.uncheck('#bfi-books')
        await pg.click('[data-testid=bf-import-go]'); await pg.wait_for_timeout(900)
        mid = await ev("document.querySelector('tr.bf-row .bf-mid').textContent")
        check('Match' in mid and 'Transfer' in mid, 'The savings line is offered the transfer as its match', mid)
        await ev("document.querySelector('tr.bf-row [data-act=post]').click()"); await pg.wait_for_timeout(900)
        check(await ev(f"OB.ui.book.accountBalance('{sv}')") == 50000, 'Savings shows $500 once, not twice')

        # ---- Split with a live difference ----
        await go('#/bankfeed?account=' + ck)
        await ev((tr % 'REMOTE ONLINE DEPOSIT') + ".querySelector('.bf-desc').click()"); await pg.wait_for_timeout(400)
        await pg.click(".bf-pane [data-ptab=split]"); await pg.wait_for_timeout(300)
        amts = pg.locator('.bf-split [data-s=amount]')
        await amts.nth(0).fill('2000'); await amts.nth(1).fill('400'); await pg.wait_for_timeout(200)
        check('50.00' in await pg.inner_text('[data-testid=bf-split-diff]') and await pg.locator('[data-testid=bf-detail-split]').is_disabled(), 'Split shows the difference and waits for $0', await pg.inner_text('[data-testid=bf-split-diff]'))
        await amts.nth(1).fill('450'); await pg.wait_for_timeout(200)
        for i, name in ((0, 'Services'), (1, 'Sales')):
            await pg.locator('.bf-split .combo-input').nth(i).click(); await pg.keyboard.type(name); await pg.wait_for_timeout(250); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(400)
            if i == 0: await pg.locator('.bf-split [data-s=amount]').nth(1).fill('450'); await pg.wait_for_timeout(200)
        await pg.click('[data-testid=bf-detail-split]'); await pg.wait_for_timeout(900)
        t = await ev("(() => { const b = OB.ui.book, l = b.bankLines.find(x => x.description.startsWith('REMOTE')); return l.status === 'posted' ? b.txById[l.txnId].lines.length : l.status; })()")
        check(t == 2, 'Split and post creates one deposit with two lines', t)

        # ---- keyboard: ↓ and A post the coffee with its suggestion; X exclude ----
        await ev(f"OB.ui.book.saveRule({{ contains: 'blue bottle', accountId: OB.ui.book.accounts.find(a => a.name === 'Meals').id, direction: 'out' }})"); await go('#/bankfeed?account=' + ck)
        await pg.focus('tr.bf-row'); await pg.keyboard.press('a'); await pg.wait_for_timeout(900)
        t = await ev("(() => { const b = OB.ui.book, l = b.bankLines.find(x => x.description.startsWith('SQ *BLUE')); return [l.status, l.status === 'posted' && b.accById[b.txById[l.txnId].lines[0].accountId].name]; })()")
        check(t == ['posted', 'Meals'], 'Keyboard A posts the focused line with its rule category', t)
        check(await ev("document.querySelectorAll('tr.bf-row').length") == 0, 'For review is empty')

        # ---- Posted tab: Undo; Excluded: exclude and restore ----
        await pg.click('[data-testid=bf-tab-posted]'); await pg.wait_for_timeout(500)
        posted = await ev("document.querySelectorAll('tr.bf-row').length")
        await ev((tr % 'COMCAST') + ".querySelector('[data-act=undo]').click()"); await pg.wait_for_timeout(900)
        t = await ev("(() => { const b = OB.ui.book, l = b.bankLines.find(x => x.description.startsWith('COMCAST')); return [l.status, b.transactions.filter(t => t.status === 'void').length]; })()")
        check(posted == 5 and t == ['review', 1], 'Undo returns the line to For review and voids the expense it created', [posted, t])
        await pg.click('[data-testid=bf-tab-review]'); await pg.wait_for_timeout(400)
        await pg.focus('tr.bf-row'); await pg.keyboard.press('x'); await pg.wait_for_timeout(400)
        await pg.fill('.modal input', 'Duplicate of card feed'); await pg.click('.modal .btn.primary'); await pg.wait_for_timeout(700)
        await pg.click('[data-testid=bf-tab-excluded]'); await pg.wait_for_timeout(400)
        check('Duplicate of card feed' in await pg.inner_text('.bf-table'), 'Excluded tab keeps the reason')
        await ev("document.querySelector('tr.bf-row [data-act=restore]').click()"); await pg.wait_for_timeout(700)

        # ---- batch: select all, set category, post ----
        await pg.click('[data-testid=bf-tab-review]'); await pg.wait_for_timeout(400)
        await pg.check('#bf-all'); await pg.wait_for_timeout(300)
        check(await pg.locator('[data-testid=bf-batch]').is_visible(), 'Selecting lines shows the batch bar')
        await pg.click('.bf-batch .combo-input'); await pg.keyboard.type('Utilities'); await pg.wait_for_timeout(250); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(300)
        await pg.click('[data-testid=bf-batch-post]'); await pg.wait_for_timeout(1000)
        check(await ev("OB.ui.book.bankLinesFor('%s', 'review').length" % ck) == 0, 'Batch post with one category clears For review')

        # ---- columns and density are remembered ----
        await pg.click('[data-testid=bf-tab-posted]'); await pg.wait_for_timeout(300)
        await pg.click('.bf-colmenu summary'); await pg.check('[data-col=balance]'); await pg.wait_for_timeout(300)
        await ev("document.querySelector('[data-density=compact]').click()"); await pg.wait_for_timeout(300)
        await pg.reload(); await pg.wait_for_function('OB.ui.book', timeout=20000); await go('#/bankfeed?account=' + ck + '&tab=posted')
        hdr = await ev("[...document.querySelectorAll('.bf-table th')].map(t => t.textContent.trim())")
        check('Balance' in hdr and await ev("document.querySelector('.bf-table').classList.contains('compact')"), 'Column choice and compact density survive a reload', hdr)

        # ---- imports tab: history and undo (refused while posted) ----
        await pg.click('[data-testid=bf-tab-imports]'); await pg.wait_for_timeout(400)
        check(await ev("document.querySelectorAll('[data-testid=bf-imports] tbody tr').length") == 1, 'Imports tab lists the file')
        await pg.click('[data-testid=bf-undo-import]'); await pg.wait_for_timeout(300); await pg.click('.modal .btn.danger, .modal .btn.primary'); await pg.wait_for_timeout(700)
        check('posted' in (await ev("[...document.querySelectorAll('.toast')].map(t => t.textContent).join(' ')")).lower(), 'Undo import is refused while its lines are posted')

        # ---- reconcile starts from the file's ending balance; posted lines are ticked ----
        await go('#/bankfeed?account=' + ck); await pg.click('[data-testid=bf-reconcile-btn]'); await pg.wait_for_timeout(900)
        h = await ev('location.hash')
        check('ending=10234.10' in h and 'date=2026-11-02' in h, 'Reconcile opens with the statement date and ending balance from the file', h)
        ticked = await ev("document.querySelectorAll('.recon-cols input[type=checkbox]:checked').length")
        check(ticked >= 5, 'Lines posted from the bank feed are already ticked', ticked)

        # ---- export to QuickBooks: .iif for Desktop, period and account choice, nothing goes twice ----
        await go('#/bankfeed?account=' + ck)
        check(not await pg.locator('[data-testid=bf-export-btn]').is_visible(), 'Export to QuickBooks is tucked away, not on the toolbar')
        await pg.click('[data-testid=bf-more]'); await pg.wait_for_timeout(200)
        await pg.click('[data-testid=bf-export-btn]'); await pg.wait_for_timeout(500)
        check(await pg.locator('[data-testid=bf-export-panel]').count() == 1 and await pg.locator('#bfx-rev').count() == 0, 'More → Export opens its panel (posted transactions only)')
        cnt = int(await pg.inner_text('[data-testid=bf-export-count]'))
        check(cnt >= 4, 'Preview counts the posted transactions to send', cnt)
        await pg.fill(f'[data-xname="{ck}"]', 'Chase Checking'); await pg.keyboard.press('Tab'); await pg.wait_for_timeout(400)
        await pg.select_option('#bfx-preset', 'custom'); await pg.wait_for_timeout(300)
        # typing a year digit by digit must not throw the cursor out of the date box (each digit is a "change" to the browser)
        await pg.focus('#bfx-from'); await pg.keyboard.type('11012026', delay=60)
        check(await ev("document.activeElement && document.activeElement.id") == 'bfx-from' and await pg.input_value('#bfx-from') == '2026-11-01', 'Typing the year keeps the cursor in the date box', await pg.input_value('#bfx-from'))
        await pg.evaluate("document.activeElement.blur()"); await pg.wait_for_timeout(350)
        await pg.fill('#bfx-to', '2026-11-30'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(400)
        nov = int(await pg.inner_text('[data-testid=bf-export-count]'))
        check(0 < nov < cnt, 'A custom period narrows the export', [nov, cnt])
        async with pg.expect_download() as dl:
            await pg.click('[data-testid=bf-export-go]')
        d = await dl.value; path = await d.path(); txt = open(path, 'rb').read().decode('cp1252')
        check(d.suggested_filename.endswith('.iif') and '\tChase Checking\t' in txt and '!TRNS' in txt and '10/31/2026' not in txt, 'The .iif uses the QuickBooks account name and only November', d.suggested_filename)
        await pg.wait_for_timeout(600)
        check(int(await pg.inner_text('[data-testid=bf-export-count]')) == 0, 'Exported lines are not offered again')
        await pg.click('.bf-xhist summary'); await pg.click('[data-xundo]'); await pg.wait_for_timeout(600)
        check(int(await pg.inner_text('[data-testid=bf-export-count]')) == nov, 'Mark as not exported brings them back')
        await ev("document.querySelector('[data-xfmt=csv]').click()"); await pg.wait_for_timeout(400)
        async with pg.expect_download() as dl:
            await pg.click('[data-testid=bf-export-go]')
        d = await dl.value; txt = open(await d.path()).read()
        check(txt.startswith('Date,Description,Amount') and d.suggested_filename.endswith('.csv'), 'QuickBooks Online CSV download', txt[:80])
        check(await ev("OB.ui.book.company.qbNames && OB.ui.book.company.qbNames['%s']" % ck) == 'Chase Checking', 'The QuickBooks account name is remembered')
        check(not errs, 'No JavaScript errors', errs)
        await ctx.close()
    print(f'\n{sum(res)} passed, {len(res) - sum(res)} failed')
asyncio.run(main())

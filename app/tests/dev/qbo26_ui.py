"""
VaultBook 1.26 UI test (developer-only): QuickBooks Online patterns — bookmarks (Ctrl+D, edit and reorder), the
gear menu, the compact side menu, Ctrl+Alt keys, bank line date and note, the Posted tab, the modern report bar
with chart and the Classic layout switch, Business overview Customize and Privacy, the customer hub tabs, and the
on-form preview. Synthetic sample company only.
Requires: Python 3 + Playwright (Chromium).
Usage: python3 qbo26_ui.py /path/to/app/index.html
"""
import json
import asyncio, os, sys, tempfile
from playwright.async_api import async_playwright

APP = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'index.html'))
results = []
def check(cond, name, detail=''):
    results.append((bool(cond), name)); print(('  ok   ' if cond else '  FAIL ') + name + (('  [' + str(detail) + ']') if detail and not cond else ''))

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='vb_q26_'), viewport={'width': 1440, 'height': 900})
        pg = ctx.pages[0]; errors = []; pg.on('pageerror', lambda e: errors.append(str(e))); ev = pg.evaluate
        await pg.goto('file://' + APP)
        await pg.evaluate("localStorage.setItem('OfflineBooksUS.prefs.v1', JSON.stringify({ menubarSeen: true, sidebarCollapsed: false }))"); await pg.reload()   # 1.51.0: these checks use the side menu, which is now off by default
        await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'Q26 Co'); await pg.check('#newco input[name=sample]')
        await pg.click('#newco button[type=submit]'); await pg.wait_for_function('OB.ui.book'); await pg.wait_for_timeout(1500)
        go = lambda h: ev("h => location.hash = h", h)

        # bookmarks
        await go('#/accounts'); await pg.wait_for_selector('#main h1'); await pg.locator('#main').click(position={'x': 5, 'y': 5})
        await pg.keyboard.press('Control+d'); await pg.wait_for_timeout(200)
        check(await pg.locator('[data-testid=bm-link][href="#/accounts"]').count() == 1, 'Ctrl+D bookmarks the page into the side menu')
        check(await ev("document.getElementById('st-bmbtn').getAttribute('aria-pressed')") == 'true', 'The star in the top bar shows the page is bookmarked')
        await go('#/vendors'); await pg.wait_for_selector('#main h1'); await pg.click('#st-bmbtn'); await pg.wait_for_timeout(150)
        await pg.click('[data-bm-edit]'); await pg.wait_for_selector('[data-testid=bm-edit]')
        await pg.locator('.st-bme').nth(1).locator('[data-mv="-1"]').click()
        await pg.locator('.st-bme').nth(0).locator('input').fill('My vendors')
        await pg.click('.modal .btn.primary'); await pg.wait_for_timeout(200)
        names = await ev("[...document.querySelectorAll('[data-testid=bm-link]')].map(a => a.textContent.trim())")
        check([n[1:].lower() for n in names] == ['my vendors', 'chart of accounts'], 'Edit bookmarks: rename and reorder', names)
        await pg.keyboard.press('Control+d'); await pg.wait_for_timeout(150)
        check(await pg.locator('[data-testid=bm-link]').count() == 1, 'Ctrl+D again removes the bookmark')

        # gear menu
        await pg.click('#st-gear'); await pg.wait_for_selector('[data-testid=gear-menu]')
        txt = await pg.inner_text('[data-testid=gear-menu]')
        check(all(w in txt for w in ['YOUR COMPANY', 'LISTS', 'TOOLS', 'Chart of accounts', 'Import from QuickBooks']), 'Gear menu: your company, lists, tools', txt[:80])
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(100)
        check(await pg.locator('[data-testid=gear-menu]').count() == 0, 'Esc closes the gear menu')
        await pg.keyboard.press('Control+Alt+l'); await pg.wait_for_selector('[data-testid=gear-menu]')
        check(True, 'Ctrl+Alt+L opens the gear menu')
        await pg.click('[data-testid=gear-menu] [data-g=compact]'); await pg.wait_for_timeout(250)
        w = await ev("document.getElementById('sidebar').getBoundingClientRect().width")
        check(await ev("document.documentElement.classList.contains('nav-compact')") and w <= 70, 'Compact side menu: icons only', w)
        await pg.hover('[data-testid=nav-group-banking]'); await pg.wait_for_timeout(250)
        fl = await ev("(() => { const f = document.querySelector('.nav-flyout.open'); return f ? f.getBoundingClientRect().left : -1; })()")
        check(fl >= w - 4, 'Its menus open beside the rail, not over it', (fl, w))
        await ev("OB.ui.setCompactNav(false)")

        # Ctrl+Alt keys
        await go('#/gateway'); await pg.wait_for_selector('.gw-item')
        await pg.keyboard.press('Control+Alt+i'); await pg.wait_for_function("location.hash.indexOf('type=invoice') > 0")
        check(True, 'Ctrl+Alt+I opens a new invoice')
        await pg.wait_for_selector('#main form'); await pg.keyboard.press('Control+Alt+c'); await pg.wait_for_function("location.hash.indexOf('#/txn/') < 0", timeout=4000)
        check(True, 'On a form Ctrl+Alt+C closes it')
        await pg.keyboard.press('Control+Alt+v'); await pg.wait_for_function("location.hash === '#/vendors'")
        check(True, 'Ctrl+Alt+V opens vendors')
        await pg.keyboard.press('Control+Alt+/'); await pg.wait_for_selector('[data-testid=shortcuts-panel]')
        check('QuickBooks Online keys' in await ev("document.querySelector('[data-testid=shortcuts-panel]').textContent"), 'Shortcut list shows the QuickBooks Online keys')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(150)

        # bank feed: Posted tab, date and note on a waiting line
        acct = await ev("(() => { const b = OB.ui.book, l = b.bankLines.find(x => x.status === 'review'); return l ? l.accountId : ''; })()")
        if not acct:
            acct = await ev("(() => { const b = OB.ui.book; return b.accounts.find(a => a.type === 'bank').id; })()")
            await ev("a => OB.ui.book.importBankLines(a, [{ date: '2026-11-03', description: 'COFFEE SHOP', amount: -1475 }], { fileName: 't.csv' })", acct)
        await go('#/bankfeed?account=' + acct); await pg.wait_for_selector('[data-testid=bf-tab-posted]')
        check((await pg.inner_text('[data-testid=bf-tab-posted]')).startswith('Posted'), 'Bank tabs: For review / Posted / Excluded')
        lid = await ev("a => OB.ui.book.bankLinesFor(a, 'review')[0].id", acct)
        await pg.click(f'tr.bf-row[data-id="{lid}"] .bf-desc'); await pg.wait_for_selector('.bf-linefix')
        await pg.click('.bf-linefix summary'); await pg.fill('[data-testid=bf-line-note]', 'Ask the owner')
        await pg.fill('[data-testid=bf-line-date]', '2026-10-30'); await pg.click('[data-testid=bf-line-save]'); await pg.wait_for_timeout(400)
        l = await ev("id => OB.ui.book.bankLineById[id]", lid)
        check(l['note'] == 'Ask the owner' and l['date'] == '2026-10-30' and l.get('bankDate'), 'A waiting bank line keeps a note and a corrected date (bank date kept)', l)
        check(await pg.locator(f'tr.bf-row[data-id="{lid}"] [data-testid=bf-note]').count() == 1, 'The note shows under the bank text')

        # report: modern bar, chart, classic switch
        await go('#/report/pnl'); await pg.wait_for_selector('#st-table table')
        check(await pg.locator('#st-customize').is_visible() and not await pg.locator('#st-hdr').is_visible(), 'Report: slim bar with Customize; header and row tools moved to More')
        await pg.click('#st-chart'); await pg.wait_for_selector('[data-testid=st-chart]')
        check(await pg.locator('.sb-cbar').count() >= 2, 'Chart switch draws income and expense bars above the report')
        await pg.click('#st-customize'); await pg.wait_for_selector('.sb-drawer')
        check('Filters' in await pg.inner_text('.sb-drawer'), 'Customize opens the panel on the right with filters')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(150)
        await pg.click('#st-more'); await pg.click('[data-testid=st-layout]'); await pg.wait_for_selector('#st-customize')
        check((await pg.inner_text('#st-customize')) == 'Customize Report' and await pg.locator('#st-hdr').is_visible(), 'Classic layout keeps the QuickBooks Desktop toolbar')
        await ev("OB.prefs.set('reportLayout', 'modern'); OB.prefs.set('reportChart', false)")

        # Business overview: customize and privacy
        await go('#/dashboard'); await pg.wait_for_selector('[data-testid=w-pnl]')
        await pg.click('[data-testid=home-customize]'); await pg.wait_for_selector('[data-testid=home-customize-list]')
        await pg.locator('#st-wlist li[data-id=tasks] input').uncheck()
        await pg.locator('#st-wlist li[data-id=banks] [data-mv="-1"]').click(); await pg.locator('#st-wlist li[data-id=banks] [data-mv="-1"]').click()
        await pg.click('.modal .btn.primary'); await pg.wait_for_selector('[data-testid=w-pnl]')
        ids = await ev("[...document.querySelectorAll('.st-widgets > section')].map(s => s.dataset.testid)")
        check(ids[0] == 'w-banks' and 'w-tasks' not in ids, 'Customize: hide a widget and change the order', ids)
        await pg.click('[data-testid=home-privacy]'); await pg.wait_for_selector('.st-private')
        f = await ev("getComputedStyle(document.querySelector('.st-private .amt')).filter")
        check('blur' in f, 'Privacy hides the amounts', f)
        await pg.click('[data-testid=home-privacy]'); await ev("OB.prefs.set('homeWidgets', [])")

        # customer hub
        cid = await ev("OB.ui.book.contacts.find(c => c.kind === 'customer').id")
        await go('#/contact/' + cid); await pg.wait_for_selector('[data-testid=ct-tabs]')
        check(await pg.locator('[data-testid=ct-tab-transactions][aria-selected=true]').count() == 1, 'Customer hub opens on Transactions')
        await pg.click('[data-testid=ct-tab-details]'); await pg.wait_for_selector('[data-testid=ct-details]')
        check('Terms' in await pg.inner_text('[data-testid=ct-details]'), 'Details tab')
        await pg.click('[data-testid=ct-tab-statements]'); await pg.wait_for_selector('[data-testid=ct-stmt]')
        check(True, 'Statements tab with a date range')
        await pg.click('[data-testid=ct-tab-notes]'); await pg.fill('[data-testid=ct-notes]', 'Prefers email.'); await pg.click('#ct-notes [type=submit]'); await pg.wait_for_timeout(300)
        check(await ev("id => OB.ui.book.contactById[id].notes", cid) == 'Prefers email.', 'Notes are saved on the customer')

        # on-form preview
        inv = await ev("(OB.ui.book.transactions.find(t => t.type === 'invoice' && t.status === 'posted') || {}).id")
        await go('#/txn/' + inv); await pg.wait_for_selector('[data-testid=form-preview-btn]')
        await pg.click('[data-testid=form-preview-btn]'); await pg.wait_for_selector('[data-testid=form-preview] .inv-svg')
        check(True, 'Preview and customize shows the printed invoice beside the form')
        before = await pg.inner_html('.fm-pages')
        await pg.fill('input[name=memo]', 'Preview memo line'); await pg.wait_for_timeout(500)
        check('Preview memo line' in await pg.inner_html('.fm-pages') and before != await pg.inner_html('.fm-pages'), 'The preview follows what is typed')

        # 1.26.1: one deposit, several invoices — suggested, and picked by hand
        await go('#/gateway'); await pg.wait_for_timeout(400)
        if await pg.locator('.modal button:has-text("Discard changes")').count(): await pg.click('.modal button:has-text("Discard changes")'); await pg.wait_for_timeout(300)
        setup = """async () => {
          const b = OB.ui.book, svc = b.accounts.find(a => a.type === 'income').id, ck = b.accounts.find(a => a.type === 'bank').id;
          const c = await b.saveContact({ kind: 'customer', name: 'MESA HEALTH' });
          const mk = (no, amt) => b.saveTransaction({ type: 'invoice', date: '2026-04-07', number: no, contactId: c.id, lines: [{ accountId: svc, amount: amt }] });
          const i1 = await mk('7162', '3400.75'), i2 = await mk('7170', '300'), i3 = await mk('7180', '500'), i4 = await mk('7190', '250');
          await b.importBankLines(ck, [{ date: '2026-05-04', description: 'Orig CO Name:Mesahealth Supp Ind Name:Acme 7170*7162', amount: 370075 },
                                       { date: '2026-05-05', description: 'REMOTE DEPOSIT', amount: 60000 }], { fileName: 'may-test.csv' });
          return { ck, c: c.id, i1: i1.id, i2: i2.id, i3: i3.id, i4: i4.id };
        }"""
        ids = await ev(setup)
        await go('#/bankfeed?account=' + ids['ck']); await pg.wait_for_selector('[data-testid=bf-tab-posted]')
        l1 = await ev("a => OB.ui.book.bankLinesFor(a, 'review').find(l => l.amount === 370075).id", ids['ck'])
        await pg.click(f'tr.bf-row[data-id="{l1}"] .bf-desc'); await pg.wait_for_selector('.bf-cands')
        txt = await pg.inner_text('.bf-cands')
        check('7162' in txt and '7170' in txt and 'add up' in txt, 'Deposit for two invoices: the pair is offered as the match', txt[:160])
        await pg.click('[data-testid=bf-detail-match]'); await pg.wait_for_timeout(500)
        st = await ev("ids => [OB.ui.book.openBalance(OB.ui.book.txById[ids.i1]), OB.ui.book.openBalance(OB.ui.book.txById[ids.i2])]", ids)
        check(st == [0, 0], 'Match pays both invoices with one payment', st)
        l2 = await ev("a => OB.ui.book.bankLinesFor(a, 'review').find(l => l.amount === 60000).id", ids['ck'])
        await pg.click(f'tr.bf-row[data-id="{l2}"] .bf-desc'); await pg.wait_for_selector('.bf-pane')
        await pg.click('.bf-ptabs [data-ptab=match]'); await pg.wait_for_selector('[data-testid=bf-manual][open]')
        await pg.select_option('[data-testid=bf-manual-contact]', ids['c']); await pg.wait_for_selector('.bf-mtable')
        await pg.check(f'[data-mi="{ids["i3"]}"]')
        check(await pg.input_value(f'[data-ma="{ids["i3"]}"]') == '500.00' and await pg.locator('[data-testid=bf-manual-post]').is_disabled(), 'Ticking an invoice fills its open balance; Match waits until the total equals the deposit')
        await pg.fill(f'[data-ma="{ids["i3"]}"]', '600'); await pg.wait_for_timeout(100)
        s1 = await pg.inner_text('[data-testid=bf-manual-sum]')
        check('600.00' in s1 and 'adds up' in s1 and await pg.locator('[data-testid=bf-manual-post]').is_enabled(), 'Total and difference update as you type', s1)
        await pg.click('[data-testid=bf-manual-post]'); await pg.wait_for_timeout(400)
        err = await pg.locator('.toast, [role=alert]').all_inner_texts()
        check(any('more than' in x for x in err), 'Paying more than an invoice owes is refused', err)
        await pg.fill(f'[data-ma="{ids["i3"]}"]', '500'); await pg.wait_for_timeout(100)
        check(await pg.locator('[data-testid=bf-manual-post]').is_disabled(), 'Back to a difference: Match is off again')
        i4 = ids['i4']
        await pg.fill(f'[data-ma="{ids["i3"]}"]', '350'); await pg.check(f'[data-mi="{i4}"]'); await pg.wait_for_timeout(100)
        check(await pg.input_value(f'[data-ma="{i4}"]') == '250.00', 'The next ticked invoice fills what is still missing')
        await pg.click('[data-testid=bf-manual-post]'); await pg.wait_for_timeout(500)
        st = await ev("([a, b2]) => [OB.ui.book.openBalance(OB.ui.book.txById[a]), OB.ui.book.openBalance(OB.ui.book.txById[b2])]", [ids['i3'], i4])
        check(st == [15000, 0], 'Matched by hand to two invoices, one paid in part ($150 left open)', st)

        # 1.26.2: one invoice paid in two deposits on different days
        sp = await ev("""async () => {
          const b = OB.ui.book, svc = b.accounts.find(a => a.type === 'income').id, ck = b.accounts.find(a => a.type === 'bank').id;
          const c = await b.saveContact({ kind: 'customer', name: 'Sunrise Health' });
          const inv = await b.saveTransaction({ type: 'invoice', date: '2026-09-01', number: '8810', contactId: c.id, lines: [{ accountId: svc, amount: '150' }] });
          await b.importBankLines(ck, [{ date: '2026-09-22', description: 'Orig CO Name:Sunrise Health Ap Payment Trn: 11', amount: 9750 },
                                       { date: '2026-09-23', description: 'Orig CO Name:Sunrise Health Ap Payment Trn: 22', amount: 5250 }], { fileName: 'sep-test.csv' });
          const ls = b.bankLinesFor(ck, 'review');
          return { ck, inv: inv.id, a: ls.find(l => l.amount === 9750).id, b2: ls.find(l => l.amount === 5250).id };
        }""")
        await go('#/bankfeed?account=' + sp['ck'] + '&y=1'); await pg.wait_for_selector('[data-testid=bf-tab-posted]')
        await pg.click(f'tr.bf-row[data-id="{sp["a"]}"] .bf-desc'); await pg.wait_for_selector('.bf-pane')
        await pg.click('.bf-ptabs [data-ptab=match]'); await pg.wait_for_selector('.bf-cands')
        ct = await pg.inner_text('.bf-cands')
        check('Split' in ct and '8810' in ct and '09/23/2026' in ct, 'Split payment offered: this line plus the 09/23 line pay invoice 8810', ct[:200])
        await pg.click('.bf-cands tr:has-text("8810") input[type=radio]'); await pg.click('[data-testid=bf-detail-match]'); await pg.wait_for_timeout(500)
        check(await ev("id => OB.ui.book.openBalance(OB.ui.book.txById[id])", sp['inv']) == 5250, 'First deposit pays $97.50 of the invoice')
        await pg.wait_for_selector(f'tr.bf-row[data-id="{sp["b2"]}"] [data-testid=bf-match-btn]')
        await pg.click(f'tr.bf-row[data-id="{sp["b2"]}"] [data-testid=bf-match-btn]'); await pg.wait_for_timeout(500)
        check(await ev("id => OB.ui.book.openBalance(OB.ui.book.txById[id])", sp['inv']) == 0, 'Second deposit matches what is left: invoice paid')

        # 1.27.1: Posted tab rows ("Already in books", Customer Payment) open their transaction, no review panel
        await go('#/bankfeed?account=' + sp['ck'] + '&tab=posted'); await pg.wait_for_selector('[data-testid=bf-tab-posted][aria-selected=true], [data-testid=bf-tab-posted].on, [data-testid=bf-tab-posted]')
        await pg.click('[data-testid=bf-tab-posted]'); await pg.wait_for_selector(f'tr.bf-row[data-id="{sp["a"]}"]')
        await pg.click(f'tr.bf-row[data-id="{sp["a"]}"] .bf-desc'); await pg.wait_for_timeout(500)
        h = await ev("location.hash")
        check(h.startswith('#/txn/') and not await pg.locator('text=Something went wrong').count(), 'Clicking a posted line opens its transaction (no error)', h)
        await go('#/bankfeed?account=' + sp['ck']); await pg.wait_for_selector('[data-testid=bf-tab-posted]')
        await ev("id => { OB.ui.render(); }", sp['a'])
        check(not await pg.locator('text=Something went wrong').count(), 'Bank feed still shows after that')

        # 1.27.3: export to QuickBooks Desktop: payments as PAYMENT with the invoices, plus the list to apply them
        await go('#/bankfeed?account=' + ids['ck'] + '&z=1'); await pg.wait_for_selector('#bf-export', state='attached')
        await ev("document.getElementById('bf-export').click()"); await pg.wait_for_selector('[data-testid=bfx-pay]')
        check(await pg.input_value('[data-testid=bfx-pay]') == 'payment' and await pg.locator('[data-testid=bfx-pay] option[value=deposit]').count() == 0, 'Payments go as customer payments by default; "deposits to A/R" is gone')
        await pg.select_option('#bfx-preset', 'all'); await pg.wait_for_selector('[data-testid=bf-xpay]')
        xt = await pg.inner_text('[data-testid=bf-xpay-table]')
        check('7162' in xt and '7170' in xt, 'The export lists which invoices each payment pays', xt[:200])
        async with pg.expect_download() as dl1: await pg.click('[data-testid=bf-export-go]')
        f1 = await (await dl1.value).path(); txt = open(f1, 'rb').read().decode('cp1252')
        check('\tPAYMENT\t' in txt and 'Pays invoice 7162' in txt and '\tDEPOSIT\t' not in txt.split('MESA HEALTH')[0][-200:], 'The .iif has a Payment naming the invoices')
        await pg.wait_for_selector('[data-testid=bfx-paylist-old]')
        async with pg.expect_download() as dl2: await pg.click('[data-testid=bfx-paylist-old]')
        f2 = await (await dl2.value).path(); csv = open(f2, encoding='utf-8').read()
        check(csv.startswith('Date,Type,Customer or vendor,Payment no.,Payment amount,Bank account,Apply to') and ',7162,' in csv and ',7170,' in csv, 'Payments to apply for lines already exported (CSV)', csv[:160])
        # 1.28.0: connector batch for QuickBooks Desktop (payments already exported are included)
        async with pg.expect_download() as dl3: await pg.click('[data-testid=bfx-qbbatch]')
        d3 = await dl3.value; bj = json.loads(open(await d3.path(), encoding='utf-8').read())
        invs = [a['invoice'] for p in bj['payments'] for a in p['apply']]
        check(d3.suggested_filename.endswith('.json') and bj['format'] == 'vaultbook-qb-batch' and '7162' in invs and '7170' in invs and all(p['depositTo'] for p in bj['payments']), 'Connector batch names each invoice and the bank account', str(bj)[:200])

        check(not errors, 'No page errors', errors[:3])
        await ctx.close()
    ok = sum(1 for r in results if r[0]); print('\n%d passed, %d failed' % (ok, len(results) - ok)); sys.exit(0 if ok == len(results) else 1)
asyncio.run(main())

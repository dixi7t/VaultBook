"""
VaultBook 1.30 Send to QuickBooks Desktop UI test (developer-only): menu entry, list of invoices and payments,
tick/untick with totals, filters, batch download (v2 with invoices and payments), load result file, sent badges and
status filter. Synthetic company only.
Usage: python3 qbsend_ui.py /path/to/app/index.html
"""
import asyncio, json, os, sys, tempfile
from playwright.async_api import async_playwright

APP = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'index.html'))
results = []
def check(cond, name, detail=''):
    results.append((bool(cond), name)); print(('  ok   ' if cond else '  FAIL ') + name + (('  [' + str(detail) + ']') if detail and not cond else ''))

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='vb_qbs_'), viewport={'width': 1440, 'height': 900}, accept_downloads=True)
        pg = ctx.pages[0]; errors = []; pg.on('pageerror', lambda e: errors.append(str(e))); ev = pg.evaluate
        await pg.goto('file://' + APP); await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'Send Co'); await pg.click('#newco button[type=submit]'); await pg.wait_for_function('OB.ui.book'); await pg.wait_for_timeout(1200)
        go = lambda h: ev("h => location.hash = h", h)
        ids = await ev("""async () => {
          const b = OB.ui.book, svc = b.accounts.find(a => a.type === 'income').id, ck = b.accounts.find(a => a.type === 'bank').id;
          const c = await b.saveContact({ kind: 'customer', name: 'DM RADS, LLC' }), d = await b.saveContact({ kind: 'customer', name: 'Upland Hills' });
          const it = await b.saveItem({ name: 'Radiology Services', type: 'service', incomeAccountId: svc, price: '100' });
          const inv = await b.saveTransactions([
            { type: 'invoice', date: '2026-08-05', number: '1243', contactId: c.id, lines: [{ itemId: it.id, accountId: svc, description: 'Radiology Services - For Holiday', amount: '55830.27' }] },
            { type: 'invoice', date: '2026-08-05', number: '1241', contactId: d.id, lines: [{ accountId: svc, amount: '221068.74' }] },
            { type: 'invoice', date: '2026-09-04', number: '1261', contactId: c.id, lines: [{ accountId: svc, amount: '39713.19' }] }]);
          await b.saveTransactions([
            { type: 'payment', date: '2026-08-11', contactId: c.id, accountId: ck, amount: '55830.27', applications: [{ txnId: inv[0].id, amount: '55830.27' }] },
            { type: 'payment', date: '2026-08-13', contactId: d.id, accountId: ck, amount: '221068.74', applications: [{ txnId: inv[1].id, amount: '221068.74' }] }]);
          return { i1243: inv[0].id, i1241: inv[1].id, i1261: inv[2].id };
        }""")

        check(await pg.locator('[data-testid=nav-qbsend]').count() == 1, 'Banking menu has Send to QuickBooks')
        await go('#/qbsend'); await pg.wait_for_selector('[data-testid=qs-tab-months]')
        check('Start by reading QuickBooks' in await pg.inner_text('.page'), 'Months tab first asks for a QuickBooks snapshot')
        await go('#/qbsend?tab=items'); await pg.wait_for_selector('[data-testid=qs-table]')
        rows = await pg.locator('[data-testid=qs-table] tbody tr').count()
        check(rows == 5, 'Lists 3 invoices and 2 payments, all ticked', rows)
        tot = await pg.inner_text('[data-testid=qs-total]')
        check('593,511.21' in tot, 'Total of the selection', tot)
        txt = await pg.inner_text('[data-testid=qs-table]')
        check('Invoice 1243' in txt and 'Not sent' in txt, 'Payment rows say which invoice they pay; status Not sent')

        await pg.uncheck(f'[data-testid=qs-table] input[data-k="{ids["i1261"]}"]'); await pg.wait_for_timeout(200)
        check('553,798.02' in await pg.inner_text('[data-testid=qs-total]') and 'Download for QuickBooks (4)' in await pg.inner_text('#qs-download'), 'Unticking removes it from the total and the button count')
        async with pg.expect_download() as dl: await pg.click('[data-testid=qs-download]')
        d = await dl.value; batch = json.loads(open(await d.path(), encoding='utf-8').read())
        check(d.suggested_filename.startswith('VaultBook-QB-Send-Co') and batch['format'] == 'vaultbook-qb-batch' and batch['version'] == 2, 'Batch file v2 downloaded', d.suggested_filename)
        nums = sorted(i['number'] for i in batch['invoices'])
        check(nums == ['1241', '1243'] and len(batch['payments']) == 2, 'Batch holds the ticked invoices and payments only', (nums, len(batch['payments'])))
        l = batch['invoices'][[i['number'] for i in batch['invoices']].index('1243')]['lines'][0]
        check(l['item'] == 'Radiology Services' and l['description'] == 'Radiology Services - For Holiday' and l['amount'] == '55830.27', 'Invoice line keeps the item and the typed description', l)
        pay = [x for x in batch['payments'] if x['amount'] == '55830.27'][0]
        check(pay['apply'] == [{'invoice': '1243', 'invoiceDate': '2026-08-05', 'amount': '55830.27'}], 'Payment names its invoice', pay['apply'])

        # filters: payments only, September
        await pg.uncheck('#qs-form [name=kind][value=invoice]'); await pg.click('#qs-form button[type=submit]'); await pg.wait_for_function("location.hash.includes('kinds=payment')"); await pg.wait_for_selector('[data-testid=qs-table]')
        check(await pg.locator('[data-testid=qs-table] tbody tr').count() == 2, 'Payments only')
        await go('#/qbsend?tab=items&kinds=invoice&range=custom&from=2026-09-01&to=2026-09-30'); await pg.wait_for_selector('[data-testid=qs-table]')
        check(await pg.locator('[data-testid=qs-table] tbody tr').count() == 1 and '1261' in await pg.inner_text('[data-testid=qs-table]'), 'Period filter')

        # result file: 1243 recorded, 1241 problem
        res = tempfile.mktemp(suffix='.json')
        open(res, 'w').write(json.dumps({'format': 'vaultbook-qb-result', 'version': 2, 'at': '2026-11-12T22:00:00.000Z', 'items': [
            {'key': ids['i1243'], 'status': 'Recorded', 'txnId': '1F-1731'}, {'key': ids['i1241'], 'status': 'Problem', 'details': "no customer named 'Upland Hills' in QuickBooks"}]}))
        await go('#/qbsend?tab=items&status=all'); await pg.wait_for_selector('[data-testid=qs-table]')
        await pg.set_input_files('[data-testid=qs-result]', res); await pg.wait_for_function("document.querySelector('.qs-sent')")
        txt = await pg.inner_text('[data-testid=qs-table]')
        check('Sent' in txt and 'Problem' in txt, 'Result loaded: Sent and Problem badges', txt[:200])
        title = await ev("document.querySelector('.qs-problem').title")
        check('Upland Hills' in title, 'Problem badge explains why', title)
        await go('#/qbsend?tab=items'); await pg.wait_for_selector('[data-testid=qs-table]')
        txt = await pg.inner_text('[data-testid=qs-table]')
        check('1243' not in txt.split('Payment')[0] and await pg.locator('[data-testid=qs-table] tbody tr').count() == 4, 'Default "Not sent yet" hides the sent invoice, keeps the problem one', txt[:300])
        await go('#/qbsend?tab=items&status=problem'); await pg.wait_for_selector('[data-testid=qs-table]')
        check(await pg.locator('[data-testid=qs-table] tbody tr').count() == 1, 'Status: Problems')

        # 1.31 Months tab: snapshot from the connector (QuickBooks has Aug invoice 1243 + its payment; Sep nothing; a hand-typed Jul check)
        snap = tempfile.mktemp(suffix='.json')
        open(snap, 'w').write(json.dumps({'format': 'vaultbook-qb-snapshot', 'version': 1, 'company': 'Send Co', 'at': '2026-11-12T23:30:00.000Z', 'from': '2026-07-01', 'to': '2026-09-30',
            'txns': [{'txnId': 'Q-A', 'type': 'Invoice', 'date': '2026-08-05', 'num': '1243', 'name': 'DM RADS, LLC', 'amount': '55830.27', 'key': ''},
                     {'txnId': 'Q-B', 'type': 'ReceivePayment', 'date': '2026-08-11', 'num': '', 'name': 'DM RADS, LLC', 'amount': '55830.27', 'key': ''},
                     {'txnId': 'Q-C', 'type': 'Check', 'date': '2026-07-09', 'num': '77', 'name': 'Staples', 'amount': '40.00', 'key': ''}],
            'months': [{'month': '2026-07', 'count': 1}, {'month': '2026-08', 'count': 2}]}))
        await pg.set_input_files('[data-testid=qs-result]', snap); await pg.wait_for_selector('[data-testid=qs-months]')
        mt = await ev("[...document.querySelectorAll('[data-testid=qs-months] tbody tr')].map(r => r.dataset.month + ':' + r.querySelector('.qs-st').textContent).join(',')")
        check(mt == '2026-07:QuickBooks only,2026-08:Partly,2026-09:Not in QuickBooks', 'Months: Jul QuickBooks only, Aug partly, Sep not in QuickBooks', mt)
        aug = await ev("document.querySelector('[data-testid=qs-months] tr[data-month=\"2026-08\"]').innerText.replace(/\\s+/g, ' ')")
        check(aug.endswith('2 4 2 2 0 Partly'), 'Aug: 2 in QuickBooks, 4 in VaultBook, 2 matched, 2 only in VaultBook', aug)
        check(await pg.locator('[data-testid=qs-months] input[data-m="2026-07"]').count() == 0, 'A QuickBooks-only month cannot be ticked')
        await pg.check('[data-testid=qs-months] input[data-m="2026-09"]'); await pg.wait_for_selector('[data-testid=qs-gap]')
        check('Download for QuickBooks (1)' in await pg.inner_text('#qs-download'), 'Ticking September: 1 item to send (invoice 1261)')
        await pg.check('[data-testid=qs-months] input[data-m="2026-08"]'); await pg.wait_for_timeout(200)
        check('Download for QuickBooks (3)' in await pg.inner_text('#qs-download'), 'Plus August: Upland invoice 1241 and its payment', await pg.inner_text('#qs-download'))
        await go('#/qbsend?tab=items&status=sent'); await pg.wait_for_selector('[data-testid=qs-table]')
        txt = await pg.inner_text('[data-testid=qs-table]')
        check('1243' in txt and 'Q-A' in await ev("document.querySelector('.qs-sent').title"), 'Matched items are remembered as Sent with the QuickBooks id', txt[:200])

        # bank transactions: a check and a transfer are offered, filtered by account, and written to the file
        await ev("""(async () => { const b = OB.ui.book, id = (n) => b.accounts.find(a => a.name === n).id, v = await b.saveContact({ kind: 'vendor', name: 'Paper Co' });
            await b.saveTransactions([{ type: 'check', date: '2026-05-08', number: '501', contactId: v.id, accountId: id('Checking'), lines: [{ accountId: id('Meals'), amount: '250' }] },
              { type: 'transfer', date: '2026-05-09', accountId: id('Checking'), toAccountId: id('Savings'), amount: '1000' }]); })()""")
        await ev("location.hash = '#/qbsend?tab=items&kinds=bank&status=new'"); await pg.wait_for_selector('[data-testid=qs-table]')
        tb = await pg.inner_text('[data-testid=qs-table]')
        check('Check' in tb and 'Transfer' in tb and 'Paper Co' in tb and '2 bank transactions' in tb, 'Bank transactions listed (check, transfer) with their accounts', tb[:300])
        async with pg.expect_download() as dlb: await pg.click('[data-testid=qs-download]')
        import json as _j
        bt = _j.load(open(await (await dlb.value).path()))
        check(bt['version'] == 3 and sorted(x['kind'] for x in bt['bank']) == ['check', 'transfer'] and bt['accounts'].get('Checking') == 'Bank' and bt['names'].get('Paper Co') == 'vendor', 'The file carries the bank transactions, the accounts and the names', bt.get('bank'))
        sv = await ev("OB.ui.book.accounts.find(a => a.name === 'Savings').id")
        await ev(f"location.hash = '#/qbsend?tab=items&kinds=bank&status=new&account={sv}'"); await pg.wait_for_timeout(500)
        check('1 bank transaction' in await pg.inner_text('[data-testid=qs-table]'), 'Account filter narrows the list')
        check(not errors, 'No page errors', errors[:3])
        await ctx.close()
    ok = sum(1 for r in results if r[0]); print('\n%d passed, %d failed' % (ok, len(results) - ok)); sys.exit(0 if ok == len(results) else 1)
asyncio.run(main())

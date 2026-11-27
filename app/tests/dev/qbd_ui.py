"""
VaultBook 1.32 QuickBooks Desktop section UI test (developer-only): side-menu group, overview with the four steps,
importing the connector's full export into an empty company (preview, Import), payment applied exactly, tie-out
report (ties, then a difference after a change), snapshot loaded from the overview. Synthetic data only.
Usage: python3 qbd_ui.py /path/to/app/index.html
"""
import asyncio, json, os, sys, tempfile
from playwright.async_api import async_playwright

APP = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'index.html'))
results = []
def check(cond, name, detail=''):
    results.append((bool(cond), name)); print(('  ok   ' if cond else '  FAIL ') + name + (('  [' + str(detail) + ']') if detail and not cond else ''))

R = lambda n: {'FullName': n}
FULL = {'format': 'vaultbook-qb-full', 'version': 1, 'at': '2026-11-12T23:00:00.000Z', 'from': '', 'to': '2026-11-12', 'company': {'CompanyName': 'Radiology One Inc'},
  'lists': {
    'Account': [
      {'FullName': 'Chase 6863', 'AccountType': 'Bank', 'AccountNumber': '10100', 'Balance': '1150.00'},
      {'FullName': 'Accounts Receivable', 'AccountType': 'AccountsReceivable', 'Balance': '300.00', 'SpecialAccountType': 'AccountsReceivable'},
      {'FullName': 'Accounts Payable', 'AccountType': 'AccountsPayable', 'Balance': '0.00', 'SpecialAccountType': 'AccountsPayable'},
      {'FullName': 'Opening Balance Equity', 'AccountType': 'Equity', 'Balance': '1000.00', 'SpecialAccountType': 'OpeningBalanceEquity'},
      {'FullName': 'Income', 'AccountType': 'Income', 'AccountNumber': '43000'},
      {'FullName': 'Income:Fee for Professional Services', 'AccountType': 'Income', 'AccountNumber': '43700'},
      {'FullName': 'Consulting Fees', 'AccountType': 'Expense', 'AccountNumber': '60100'}],
    'Customer': [{'FullName': 'DM RADS, LLC', 'Email': 'ap@dmrads.example'}],
    'Vendor': [{'Name': 'Dr. Smith', 'IsVendorEligibleFor1099': 'true'}],
    'Item': [{'_type': 'ItemServiceRet', 'FullName': 'Radiology Services', 'SalesOrPurchase': {'Price': '100.00', 'AccountRef': R('Income:Fee for Professional Services')}}],
    'Class': [], 'StandardTerms': [{'Name': 'Net 15', 'StdDueDays': '15'}]},
  'txns': {
    'Invoice': [
      {'TxnID': 'I-1', 'TxnDate': '2026-08-05', 'RefNumber': '1243', 'CustomerRef': R('DM RADS, LLC'), 'InvoiceLineRet': [{'ItemRef': R('Radiology Services'), 'Desc': 'Radiology Services - For Holiday', 'Amount': '500.00'}]},
      {'TxnID': 'I-2', 'TxnDate': '2026-09-04', 'RefNumber': '1261', 'CustomerRef': R('DM RADS, LLC'), 'InvoiceLineRet': {'ItemRef': R('Radiology Services'), 'Desc': 'Reads', 'Amount': '300.00'}}],
    'ReceivePayment': [{'TxnID': 'P-1', 'TxnDate': '2026-08-11', 'RefNumber': 'ACH', 'CustomerRef': R('DM RADS, LLC'), 'TotalAmount': '500.00', 'DepositToAccountRef': R('Chase 6863'), 'AppliedToTxnRet': {'TxnID': 'I-1', 'Amount': '500.00'}}],
    'Check': [{'TxnID': 'C-1', 'TxnDate': '2026-08-15', 'RefNumber': '5011', 'AccountRef': R('Chase 6863'), 'PayeeEntityRef': R('Dr. Smith'), 'ExpenseLineRet': {'AccountRef': R('Consulting Fees'), 'Amount': '350.00'}}],
    'Deposit': [{'TxnID': 'D-1', 'TxnDate': '2026-08-01', 'DepositToAccountRef': R('Chase 6863'), 'DepositLineRet': {'AccountRef': R('Opening Balance Equity'), 'Amount': '1000.00'}}]}}

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='vb_qbd_'), viewport={'width': 1440, 'height': 900}, accept_downloads=True)
        pg = ctx.pages[0]; errors = []; pg.on('pageerror', lambda e: errors.append(str(e))); ev = pg.evaluate
        await pg.goto('file://' + APP)
        await pg.evaluate("localStorage.setItem('OfflineBooksUS.prefs.v1', JSON.stringify({ menubarSeen: true, sidebarCollapsed: false }))"); await pg.reload()   # 1.51.0: these checks use the side menu, which is now off by default
        await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'Radiology One Inc'); await pg.click('#newco button[type=submit]'); await pg.wait_for_function('OB.ui.book'); await pg.wait_for_timeout(1200)
        go = lambda h: ev("h => location.hash = h", h)

        check(await pg.locator('[data-testid="nav-group-quickbooks desktop"]').count() == 1 and await pg.locator('[data-testid=nav-qbd]').count() == 1 and await pg.locator('[data-testid=nav-qbd-tieout]').count() == 1, 'Side menu has a QuickBooks Desktop group (Overview, Months & send, Tie-out)')
        await pg.click('[data-testid="nav-group-quickbooks desktop"]'); await pg.wait_for_timeout(300)
        if await pg.locator('[data-testid=nav-qbd]').is_visible(): await pg.click('[data-testid=nav-qbd]')
        else: await go('#/qbd')
        await pg.wait_for_selector('[data-testid=qbd-step-4]')
        txt = await pg.inner_text('.page')
        check(all(s in txt for s in ['Import everything from QuickBooks', 'Read QuickBooks and see the gap', 'Send what QuickBooks is missing', 'Load what happened', 'Tie-out report', 'The connector', 'QuickBooks -> VaultBook', 'Connect to VaultBook']), 'Overview lists the four steps, reports and the connector menu')
        check('Not yet' in await pg.inner_text('[data-testid=qbd-glance]'), 'Status strip: nothing imported yet')

        f = tempfile.mktemp(suffix='.json', prefix='VaultBook-QB-full-'); open(f, 'w').write(json.dumps(FULL))
        await pg.set_input_files('[data-testid=qbd-full]', f)
        await pg.wait_for_selector('#mg-go', timeout=15000)
        prev = await pg.inner_text('.page')
        check('connector' in prev.lower() and 'Import into Radiology One Inc' in prev, 'Empty company: the export opens the import preview for this company', prev[:300])
        await pg.click('#mg-go'); await pg.wait_for_function("document.body.innerText.includes('Import complete')", timeout=30000)
        ok = await ev("""() => { const b = OB.ui.book, inv = b.transactions.find(t => t.number === '1243'), pay = b.transactions.find(t => t.type === 'payment');
          return pay && pay.applications.length === 1 && pay.applications[0].txnId === inv.id && b.openBalanceAsOf(inv, '2026-12-31') === 0 && /TxnID I-1/.test(inv.importRef); }""")
        check(ok, 'Imported: the payment is applied to invoice 1243 exactly, QuickBooks id kept')

        await go('#/qbd/tieout'); await pg.wait_for_selector('[data-testid=qbd-tie]')
        tie = await pg.inner_text('[data-testid=qbd-tie]')
        check('ties' in tie, 'Tie-out: every balance ties', tie)
        cnt = await pg.inner_text('[data-testid=qbd-count-table]')
        check('Invoice' in cnt and '2' in cnt, 'Tie-out lists transaction counts per type', cnt[:200])
        await ev("""async () => { const b = OB.ui.book, ck = b.accounts.find(a => a.name === 'Chase 6863').id;
          await b.saveTransaction({ type: 'check', date: '2026-11-01', number: '6000', accountId: ck, lines: [{ accountId: b.accounts.find(a => a.name === 'Consulting Fees').id, amount: '25' }] }); }""")
        await go('#/qbd'); await go('#/qbd/tieout'); await pg.wait_for_selector('[data-testid=qbd-tie]')
        tie = await pg.inner_text('[data-testid=qbd-tie]'); row = await ev("[...document.querySelectorAll('[data-testid=qbd-tie-table] tbody tr')].find(r => r.textContent.includes('Chase')).innerText")
        check('do not tie' in tie or 'does not tie' in tie, 'A later entry shows as a difference', tie)
        check('-25.00' in row or '(25.00)' in row, 'Bank row shows the 25.00 difference', row)
        async with pg.expect_download() as dl: await pg.click('button[data-x=csv]')
        csv = open(await (await dl.value).path(), encoding='utf-8-sig').read()
        check('Chase 6863' in csv and 'QuickBooks' in csv, 'Tie-out exports to CSV')

        # overview now shows step 1 done; a snapshot loaded from the overview opens the months
        await go('#/qbd'); await pg.wait_for_selector('[data-testid=qbd-step-1]')
        check('Done' in await pg.inner_text('[data-testid=qbd-step-1]'), 'Step 1 shows Done after the import')
        snap = tempfile.mktemp(suffix='.json')
        open(snap, 'w').write(json.dumps({'format': 'vaultbook-qb-snapshot', 'version': 1, 'company': 'Radiology One Inc', 'at': '2026-11-12T23:30:00.000Z', 'from': '2026-08-01', 'to': '2026-11-30',
            'txns': [{'txnId': x, 'type': t, 'date': d, 'num': '', 'name': '', 'amount': '0.00', 'key': ''} for x, t, d in [('I-1', 'Invoice', '2026-08-05'), ('I-2', 'Invoice', '2026-09-04'), ('P-1', 'ReceivePayment', '2026-08-11'), ('C-1', 'Check', '2026-08-15'), ('D-1', 'Deposit', '2026-08-01')]],
            'months': []}))
        await pg.set_input_files('[data-testid=qbd-snap]', snap); await pg.wait_for_selector('[data-testid=qs-months]')
        mt = await ev("[...document.querySelectorAll('[data-testid=qs-months] tbody tr')].map(r => r.dataset.month + ':' + r.querySelector('.qs-st').textContent).join(',')")
        check(mt.startswith('2026-08:Done,2026-09:Done') and '2026-11:Not in QuickBooks' in mt, 'Imported transactions match QuickBooks by id; only the new November check is missing', mt)

        check(not errors, 'No page errors', errors[:3])
        await ctx.close()
    ok = sum(1 for r in results if r[0]); print('\n%d passed, %d failed' % (ok, len(results) - ok)); sys.exit(0 if ok == len(results) else 1)
asyncio.run(main())

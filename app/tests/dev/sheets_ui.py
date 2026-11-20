"""VaultBook 1.47.1 — bank and card files in 13 common layouts (Debit/Credit columns, Dr/Cr and type columns, title rows,
real Excel dates, UK dates, CR/DR/trailing-minus text, card files) as .xlsx and .csv, through the Bank feed column step
and the statement reader. Synthetic data only. Run: python3 tests/dev/sheets_ui.py"""
import asyncio, sys, tempfile, json, os, glob
import openpyxl, csv, datetime
import tempfile
D = tempfile.mkdtemp()
# six transactions: (iso date, description, signed cents for a BANK account)
T = [('2026-03-02', 'CLIENT DEPOSIT ACME', 10000), ('2026-03-05', 'STAPLES OFFICE', -4510), ('2026-03-13', 'WIRE IN BIG CO', 250050),
     ('2026-03-17', 'RENT MARCH', -120000), ('2026-03-21', 'INTEREST', 99), ('2026-03-28', 'BANK FEE', -333)]
def us(d): return d[5:7] + '/' + d[8:10] + '/' + d[:4]
def uk(d): return d[8:10] + '/' + d[5:7] + '/' + d[:4]
def m(c): return abs(c) / 100
def money(c): return '{:,.2f}'.format(abs(c) / 100)
V = {}
V['v01_debit_credit_cols'] = [['Date', 'Description', 'Debit', 'Credit']] + [[us(d), s, m(c) if c < 0 else None, m(c) if c > 0 else None] for d, s, c in T]
V['v02_withdrawals_negative'] = [['Date', 'Description', 'Withdrawals', 'Deposits']] + [[us(d), s, -m(c) if c < 0 else None, m(c) if c > 0 else None] for d, s, c in T]
V['v03_amount_drcr'] = [['Date', 'Particulars', 'Amount', 'Dr/Cr']] + [[us(d), s, m(c), 'DR' if c < 0 else 'CR'] for d, s, c in T]
V['v04_amount_type_words'] = [['Date', 'Description', 'Transaction Type', 'Amount']] + [[us(d), s, 'Withdrawal' if c < 0 else 'Deposit', m(c)] for d, s, c in T]
V['v05_title_rows_real_dates'] = [['First Community Bank'], ['Account 1234567'], ['Statement 03/01/2026 - 03/31/2026'], [], ['Posting Date', 'Description', 'Amount', 'Balance']] + \
    [[datetime.datetime(int(d[:4]), int(d[5:7]), int(d[8:])), s, c / 100, None] for d, s, c in T]
V['v06_uk_dates'] = [['Date', 'Description', 'Paid out', 'Paid in']] + [[uk(d), s, m(c) if c < 0 else '', m(c) if c > 0 else ''] for d, s, c in T]
V['v07_amount_text_styles'] = [['Date', 'Description', 'Amount']] + [[us(d), s, x] for (d, s, c), x in zip(T, ['$100.00', '(45.10)', '2,500.50 CR', '1,200.00-', '0.99', '3.33 DR'])]
V['v09_chase_style'] = [['Details', 'Posting Date', 'Description', 'Amount', 'Type', 'Balance', 'Check or Slip #']] + [['CREDIT' if c > 0 else 'DEBIT', us(d), s, c / 100, 'ACH_CREDIT' if c > 0 else 'DEBIT_CARD', '', ''] for d, s, c in T]
V['v10_money_in_out_blank'] = [['Transaction Date', 'Narrative', 'Money In', 'Money Out', 'Running Balance']] + [[us(d), s, money(c) if c > 0 else '', money(c) if c < 0 else '', ''] for d, s, c in T]
V['v12_india_style'] = [['Date', 'Narration', 'Chq./Ref.No.', 'Value Dt', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance']] + [[uk(d)[:6] + d[2:4], s, '', uk(d)[:6] + d[2:4], money(c) if c < 0 else '', money(c) if c > 0 else '', ''] for d, s, c in T]
V['v13_signed_type_agree'] = [['Date', 'Description', 'Type', 'Amount']] + [[us(d), s, 'Debit' if c < 0 else 'Credit', c / 100] for d, s, c in T]
V['v14_amount_positive_debit_word_in_type'] = [['Date', 'Description', 'Type', 'Amount']] + [[us(d), s, 'DEBIT' if c < 0 else 'CREDIT', m(c)] for d, s, c in T]
# credit card: charges positive, payments negative (bank sign is the opposite for VaultBook's card account)
C = [('2026-03-03', 'AMAZON MARKETPLACE', 4510), ('2026-03-09', 'PAYMENT THANK YOU', -120000), ('2026-03-15', 'UBER TRIP', 333)]
V['v08_card_charges_positive'] = [['Date', 'Description', 'Amount']] + [[us(d), s, c / 100] for d, s, c in C]
for k, rows in V.items():
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'Transactions'
    for r in rows: ws.append(r)
    wb.save(os.path.join(D, k + '.xlsx'))
    with open(os.path.join(D, k + '.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        for r in rows: w.writerow(['' if x is None else (x.strftime('%m/%d/%Y') if isinstance(x, datetime.datetime) else x) for x in r])
exp = {k: [[d, c] for d, s, c in T] for k in V}; exp['v08_card_charges_positive'] = [[d, -c] for d, s, c in C]   # card: a charge is money out
json.dump(exp, open(os.path.join(D, 'expected.json'), 'w'))


from playwright.async_api import async_playwright
APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'index.html')
EXP = json.load(open(os.path.join(D, 'expected.json')))
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(), viewport={'width': 1400, 'height': 900})
        pg = ctx.pages[0]; ev = pg.evaluate; errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://' + APP); await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'Matrix'); await pg.click('#newco button[type=submit]')
        await pg.wait_for_function("OB.ui.book && OB.ui.book.company.name === 'Matrix'", timeout=30000)
        bad = 0
        for f, path in [(f, p) for f in sorted(glob.glob(D + '/v*')) for p in ('reader', 'feed')]:
            k, ext = os.path.splitext(os.path.basename(f)); acc = await ev("OB.ui.book.saveAccount({name: %s, type: %s}).then(a => a.id)" % (json.dumps(path + k + ext), json.dumps('cc' if 'card' in k else 'bank')))
            await ev("OB.ui.book.bankLines.slice().forEach(l => l.status = 'excluded'); location.hash = '#/home'")
            before = set(await ev("OB.ui.book.bankLines.map(l => l.id)"))
            try:
                if path == 'reader':
                    await ev("location.hash = '#/pdfimport'"); await pg.wait_for_selector('[data-testid=pdfimport-file-input]')
                    c = await pg.query_selector('[data-testid=pdfimport-clear-btn]')
                    if c: await c.click()
                    await pg.select_option('[data-testid=pdfimport-account-select]', acc)
                    await pg.set_input_files('[data-testid=pdfimport-file-input]', f)
                    await pg.click('[data-testid=pdfimport-extract-btn]')   # 1.50.2: one spreadsheet opens the Bank feed column step
                    await pg.wait_for_selector('#bfm-next', timeout=15000)
                    await ev("(document.querySelector('#bfm-rem')||{}).checked = false")
                    await pg.click('#bfm-next'); await pg.wait_for_timeout(300)
                    btn = await pg.query_selector('[data-testid=bf-import-go]:not([disabled])')
                    if not btn: print('FAIL', path, k + ext, 'map step'); bad += 1; continue
                    await btn.click()
                else:
                    await ev("location.hash = '#/bankfeed?account=%s'" % acc); await pg.wait_for_timeout(400)
                    imp = await pg.query_selector('[data-testid=bf-import-btn], #bf-import')
                    if imp: await imp.click()
                    await pg.wait_for_selector('[data-testid=bf-file-input]', state='attached')
                    await pg.set_input_files('[data-testid=bf-file-input]', f); await pg.wait_for_selector('#bfm-next', timeout=10000)
                    await ev("(document.querySelector('#bfm-rem')||{}).checked = false")
                    await pg.click('#bfm-next'); await pg.wait_for_timeout(300)
                    btn = await pg.query_selector('[data-testid=bf-import-go]:not([disabled])')
                    if not btn:
                        print('FAIL', path, k + ext, 'map step:', (await ev("(document.querySelector('.banner')||{}).innerText||''"))[:160]); bad += 1; continue
                    await btn.click()
                await pg.wait_for_timeout(900)
            except Exception as e:
                print('FAIL', path, k + ext, 'error', str(e)[:160]); bad += 1; continue
            got = await ev("OB.ui.book.bankLines.filter(l => !%s.includes(l.id)).map(l => [l.date, l.amount]).sort()" % json.dumps(list(before)))
            want = sorted(EXP[k]); ok = got == want; bad += not ok
            print('ok  ' if ok else 'FAIL', path, k + ext, '' if ok else 'got %s' % got)
        n = len(glob.glob(D + '/v*')) * 2
        print('\n%d passed, %d failed' % (n - bad - len(errs), bad + len(errs))); await ctx.close()
asyncio.run(main())

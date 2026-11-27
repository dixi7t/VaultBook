"""VaultBook 1.57.0 — the Bank feed uses the books' history: sure / to check / no suggestion, sort and show pickers,
select the sure lines and post them, select every line of one payee. Made-up names only.
Run: python3 tests/dev/feedengine_ui.py"""
import asyncio, os, tempfile
from playwright.async_api import async_playwright
APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'index.src.html')
if not os.path.exists(APP): APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'index.html')
passed = failed = 0
def check(name, ok, extra=''):
    global passed, failed
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok else '  ' + str(extra))); passed += ok; failed += not ok
SETUP = """(async () => {
  const b = OB.ui.book, acc = (n) => b.accounts.find((a) => a.name === n).id, ck = acc('Checking'), v = {};
  for (const n of ['Circle K', 'Costco', 'Northwind Staffing']) v[n] = (await b.saveContact({ kind: 'vendor', name: n })).id;
  for (let m = 1; m <= 6; m++) {
    const d = '2024-0' + m + '-05';
    await b.saveTransaction({ type: 'expense', date: d, accountId: ck, contactId: v['Circle K'], lines: [{ accountId: acc('Meals'), amount: '20' }] });
    await b.saveTransaction({ type: 'expense', date: d, accountId: ck, contactId: v['Costco'], lines: [{ accountId: acc('Office Supplies & Software'), amount: '90' }] });
    await b.saveTransaction({ type: 'deposit', date: d, accountId: ck, memo: 'Deposit', lines: [{ accountId: acc('Services'), amount: '5000', contactId: v['Northwind Staffing'] }] });
  }
  const rows = [
    { date: '2025-01-03', description: 'Checkcard 0105 Circlek — CHECKCARD 0105 CIRCLEK #10001 ANYTOWN TX CKCD 5542 XXXXXXXXXXXX1111', amount: -2006 },
    { date: '2025-01-13', description: 'Checkcard 0113 Circlek — CHECKCARD 0113 CIRCLEK #10001 ANYTOWN TX CKCD 5542 XXXXXXXXXXXX1111', amount: -1500 },
    { date: '2025-01-04', description: 'Northwind Staffi DES:EDI — NORTHWIND STAFFI DES:EDI PYMTS ID:PAY0001 INDN:FEED CO', amount: 500000 },
    { date: '2025-01-07', description: 'Costco — PURCHASE REFUND 0224 COSTCO WHSE #1000 ANYTOWN TX', amount: 999 },
    { date: '2025-01-08', description: 'Checkcard 0108 Zenlift — CHECKCARD 0108 ZENLIFT STUDIO FRISCO TX CKCD 7997', amount: -4500 },
    { date: '2025-01-15', description: 'Checkcard 0115 Zenlift — CHECKCARD 0115 ZENLIFT STUDIO FRISCO TX CKCD 7997', amount: -4500 },
    { date: '2025-01-22', description: 'Checkcard 0122 Zenlift — CHECKCARD 0122 ZENLIFT STUDIO FRISCO TX CKCD 7997', amount: -4500 }];
  for (let i = 0; i < +N; i++) rows.push({ date: '2025-02-' + String(1 + i % 27).padStart(2, '0'), description: 'Checkcard 02' + String(i).padStart(4, '0') + ' — CHECKCARD VENDOR' + (i % 40) + ' SHOP TX CKCD 5542', amount: -(1000 + i) });
  await b.importBankLines(ck, rows, { fileName: 'feed.qbo' });
  return ck;
})()"""
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(), viewport={'width': 1440, 'height': 900}, locale='en-US')
        pg = ctx.pages[0]; ev = pg.evaluate; errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://' + APP); await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'Feed Co'); await pg.click('#newco button[type=submit]')
        await pg.wait_for_function("OB.ui.book && OB.ui.book.company.name === 'Feed Co'", timeout=30000); await pg.wait_for_timeout(300)
        ck = await ev(SETUP.replace('+N', '0'))
        await ev("location.hash = '#/bankfeed?account=%s'" % ck); await pg.wait_for_selector('[data-testid=bf-table]')
        counts = await pg.inner_text('[data-testid=bf-counts]')
        check('FE-01 the feed counts sure, to check and no suggestion', counts.replace('\n', ' ') == '3 sure · 1 to check · 3 with no suggestion', counts)
        badges = await ev("[...document.querySelectorAll('.bf-row')].map((r) => [r.querySelector('.bf-desc').textContent.slice(0, 22), (r.querySelector('[data-testid=bf-badge]') || {}).textContent || '', r.querySelector('.bf-mid').textContent])")
        ck_row = [x for x in badges if 'Circlek' in x[0]][0]; dep = [x for x in badges if 'Northwind' in x[0]][0]; back = [x for x in badges if 'Costco' in x[0]][0]
        check('FE-02 a steady payee from the books is Sure with its account; a deposit learns its payer; money back is Check', ck_row[1] == 'Sure' and 'Meals' in ck_row[2] and dep[1] == 'Sure' and 'Services' in dep[2] and back[1] == 'Check', badges)
        await pg.select_option('#bf-sortby', 'payee:a'); await pg.wait_for_timeout(150)
        order = await ev("[...document.querySelectorAll('.bf-row .bf-desc')].map((r) => r.textContent.split(' ')[2] || r.textContent.split(' ')[0])")
        check('FE-03 Sort by Payee keeps one payee\'s lines together', order[:2] == ['Circlek', 'Circlek'] and order[-3:] == ['Zenlift', 'Zenlift', 'Zenlift'], order)
        await pg.select_option('#bf-show', 'none'); await pg.wait_for_timeout(150)
        check('FE-04 Show: No suggestion lists only those lines', await pg.locator('.bf-row').count() == 3)
        await pg.click('.bf-row >> nth=0 >> [data-act=open]'); await pg.wait_for_selector('[data-testid=bf-like]')
        check('FE-05 an opened line offers every line of the same payee', (await pg.inner_text('[data-testid=bf-like]')) == 'Select the 3 lines of this payee')
        await ev("(() => { const id = document.querySelector('.bf-row.open').dataset.id; OB.ui.book && (window.__d = id); })()")
        await pg.click('[data-testid=bf-like]'); await pg.wait_for_selector('[data-testid=bf-batch]:not([hidden])')
        check('FE-06 they are selected together', (await pg.inner_text('[data-testid=bf-batch] strong')) == '3 selected')
        await ev("(() => { const b = OB.ui.book; window.__cat = b.accounts.find((a) => a.name === 'Meals').id; })()")
        await pg.select_option('#bf-show', 'all'); await pg.wait_for_timeout(150)
        await pg.click('#bf-bclear'); await pg.click('[data-testid=bf-sel-sure]'); await pg.wait_for_timeout(150)
        check('FE-07 Select the sure lines ticks exactly those', (await pg.inner_text('[data-testid=bf-batch] strong')) == '3 selected')
        await pg.click('[data-testid=bf-batch-post]'); await pg.wait_for_function("OB.ui.book.bankLines.filter((l) => l.status === 'posted').length === 3", timeout=20000)
        posted = await ev("OB.ui.book.bankLines.filter((l) => l.status === 'posted').map((l) => OB.ui.book.accById[l.categoryId].name).sort()")
        check('FE-08 Post selected posts them to the accounts the books always used', posted == ['Meals', 'Meals', 'Services'], posted)
        check('FE-09 the counts follow', (await pg.inner_text('[data-testid=bf-counts]')).replace('\n', ' ') == '0 sure · 1 to check · 3 with no suggestion', await pg.inner_text('[data-testid=bf-counts]'))
        # a long statement must redraw fast (it took about 10 seconds for 1,300 lines before 1.57)
        await ev(SETUP.replace('+N', '900').replace("for (const n of ['Circle K', 'Costco', 'Northwind Staffing']) v[n] = (await b.saveContact({ kind: 'vendor', name: n })).id;", "b.contacts.forEach((c) => { v[c.name] = c.id; });")
                 .replace("for (let m = 1; m <= 6; m++) {", "for (let m = 1; m <= 0; m++) {"))
        ms = await ev("(() => { OB.ui.render(); const t = performance.now(); OB.ui.render(); OB.ui.render(); return (performance.now() - t) / 2; })()")
        check('FE-10 with 900 more lines a redraw stays under 400 ms', ms < 400, ms)
        check('FE-11 no page errors', not errs, errs)
        print('\n%d passed, %d failed' % (passed, failed)); await ctx.close()
asyncio.run(main())

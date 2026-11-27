"""Bank feed extra help (other clients / common merchants): python3 tests/dev/hints_ui.py /abs/path/app/index.html"""
import asyncio, sys, tempfile
from playwright.async_api import async_playwright
APP = sys.argv[1]; res = []
def check(ok, msg, info=''):
    res.append(ok); print(('  ok   ' if ok else '  FAIL ') + msg + ('' if ok else '  -> ' + str(info)))
SETUP_A = """(async () => {
  const b = await OB.db.createCompany({ name: 'Firm Client A' }), acc = (n) => b.accounts.find((a) => a.name === n).id;
  const v = await b.saveContact({ kind: 'vendor', name: 'Maple Street Hardware' });
  for (let i = 1; i <= 3; i++) await b.saveTransaction({ type: 'expense', date: '2025-0' + i + '-05', accountId: acc('Checking'), contactId: v.id, lines: [{ accountId: acc('Repairs & Maintenance'), amount: '40' }] });
  // an empty company, a password-protected one and one saved by an early version (data v2)
  await OB.db.createCompany({ name: 'Firm Empty' });
  const p = await OB.db.createCompany({ name: 'Firm Locked' }), pv = await p.saveContact({ kind: 'vendor', name: 'Secret Supplier' });
  for (let i = 1; i <= 3; i++) await p.saveTransaction({ type: 'expense', date: '2025-0' + i + '-05', accountId: p.accounts.find((a) => a.name === 'Checking').id, contactId: pv.id, lines: [{ accountId: p.accounts.find((a) => a.name === 'Travel').id, amount: '40' }] });
  await OB.db.protect(p, 'Correct-Horse-Battery-77');
  const o = await OB.db.createCompany({ name: 'Firm Old Format' }), ov = await o.saveContact({ kind: 'vendor', name: 'Blue Ridge Bakery' });
  for (let i = 1; i <= 3; i++) await o.saveTransaction({ type: 'expense', date: '2024-0' + i + '-05', accountId: o.accounts.find((a) => a.name === 'Checking').id, contactId: ov.id, lines: [{ accountId: o.accounts.find((a) => a.name === 'Meals').id, amount: '12' }] });
  const data = JSON.parse(JSON.stringify({ company: o.company, accounts: o.accounts, contacts: o.contacts, transactions: o.transactions, rules: [], recurring: [], reconciliations: [], audit: [] }));
  data.company.dataVersion = 2; await OB.db.writeCompanyData(data);
  return b.company.id; })()"""
SETUP_B = """(async () => {
  const b = OB.ui.book, ck = b.accounts.find((a) => a.name === 'Checking').id;
  await b.importBankLines(ck, [
    { date: '2026-10-01', description: 'MAPLE STREET HARDWARE 0042', amount: -5500 },
    { date: '2026-10-02', description: 'SHELL OIL 57444219 DALLAS TX', amount: -4210 },
    { date: '2026-10-03', description: 'STARBUCKS STORE 1234', amount: -615 },
    { date: '2026-10-04', description: 'ZQX UNKNOWN 77', amount: -1000 },
    { date: '2026-10-05', description: 'BLUE RIDGE BAKERY 9', amount: -1200 },
    { date: '2026-10-06', description: 'SECRET SUPPLIER 1', amount: -4000 }], { fileName: 't.csv' });
  return ck; })()"""
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(), viewport={'width': 1500, 'height': 900})
        pg = ctx.pages[0]; ev = pg.evaluate; errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://' + APP); await pg.wait_for_selector('#newco')
        await ev(SETUP_A)
        await ev("OB.db.createCompany({ name: 'Client B' }).then((b) => OB.ui.openCompany(b.company.id))")
        await pg.wait_for_function("OB.ui.book && OB.ui.book.company.name === 'Client B'", timeout=30000)
        ck = await ev(SETUP_B)
        await ev("location.hash = '#/bankfeed?account=" + ck + "'"); await pg.wait_for_selector('[data-testid=bf-table]')
        mid = lambda: ev("[...document.querySelectorAll('.bf-row .bf-mid')].map(x => x.innerText).join(' | ')")
        check('Choose a category' in await mid() and not await pg.locator('[data-testid=bf-help-count]').count(), 'Off: lines with no history show no suggestion', await mid())
        t = (await pg.inner_text('[data-testid=bf-counts]')).replace('\n', ' '); m = await mid()   # 1.57: common merchants are part of the feed itself
        check(t == '0 sure · 2 to check · 4 with no suggestion', 'Common merchants are counted as lines to check', t)
        check('Car & Truck' in m and 'Meals' in m and 'Common merchant' in m, 'Shell and Starbucks get a category with a Common merchant badge', m)
        check(not await pg.locator('[data-testid=bf-sel-sure]').count(), 'A common merchant is never offered as sure')
        await pg.click('[data-testid=bf-help-clients]')
        await pg.wait_for_function("(document.querySelector('[data-testid=bf-help-count]') || {}).innerText && !document.querySelector('[data-testid=bf-help-count]').innerText.includes('Reading')", timeout=15000)
        t = await ev("document.querySelector('[data-testid=bf-help-count]').innerText"); m = await mid()
        check('Identified 2 of 4' in t and 'learned from 3 clients, 1 password-protected skipped' in t, 'Other clients: learns from new, empty and old-format companies; skips the password-protected one', t)
        check('Repairs & Maintenance' in m and 'Other clients' in m, 'Maple Street Hardware gets the account the other client used', m)
        row = lambda txt: ev("[...document.querySelectorAll('.bf-row')].find(r => r.innerText.includes('" + txt + "')).querySelector('.bf-mid').innerText")
        check('Meals' in await row('BLUE RIDGE'), 'The old-format company was read (upgraded in memory)', await row('BLUE RIDGE'))
        check('Choose a category' in await row('SECRET SUPPLIER'), "The password-protected company's habits are not used", await row('SECRET SUPPLIER'))
        ver = await ev("(async () => { const ad = await OB.db.openCompanyAdapter((await OB.db.listCompanies()).find(c => c.name === 'Firm Old Format').id); const d = await ad.loadAll(); ad.close(); return d.company.dataVersion; })()")
        check(ver == 2, 'Reading another company changes nothing in it (still saved as data v2)', ver)
        await pg.locator('.bf-row', has_text='MAPLE STREET').locator('[data-act=post]').click(); await pg.wait_for_timeout(500)
        n = await ev("OB.ui.book.transactions.filter(t => t.type === 'expense').length")
        check(n == 1, 'One click adds the suggested line', n)
        if len(sys.argv) > 2: await pg.locator('main').screenshot(path=sys.argv[2])
        await pg.click('[data-testid=bf-help-off]'); await pg.wait_for_timeout(200)
        check('Other clients' not in await mid() and 'Common merchant' in await mid(), 'Off removes the suggestions from other clients', await mid())
        check(not errs, 'No page errors', errs)
        await ctx.close()
    print('\n%d passed, %d failed' % (res.count(True), res.count(False))); sys.exit(0 if all(res) else 1)
asyncio.run(main())

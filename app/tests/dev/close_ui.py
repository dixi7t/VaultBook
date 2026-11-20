"""Close the books page: python3 tests/dev/close_ui.py /abs/path/app/index.html [screenshot-prefix]"""
import asyncio, sys, tempfile
from playwright.async_api import async_playwright
APP = sys.argv[1]; SHOT = sys.argv[2] if len(sys.argv) > 2 else ''; res = []
def check(ok, msg, info=''):
    res.append(ok); print(('  ok   ' if ok else '  FAIL ') + msg + ('' if ok else '  -> ' + str(info)))
SETUP = """(async () => {
  const b = await OB.db.createCompany({ name: 'Harbor Close Co' }), acc = (n) => b.accounts.find((a) => a.name === n).id, ck = acc('Checking'), v = {};
  for (const n of ['Costco', 'Home Depot', 'Amazon', 'Granite Property', 'Shell']) v[n] = (await b.saveContact({ kind: 'vendor', name: n })).id;
  const rows = [];
  for (let y = 2022; y <= 2024; y++) for (let m = 1; m <= 12; m++) { const mm = String(m).padStart(2, '0');
    rows.push([y + '-' + mm + '-03', 'Costco', 'Office Supplies & Software', 120]); rows.push([y + '-' + mm + '-06', 'Shell', 'Car & Truck', 45]);
    if (y === 2024) { rows.push([y + '-' + mm + '-09', 'Home Depot', m % 2 ? 'Repairs & Maintenance' : 'Office Supplies & Software', 80]); rows.push([y + '-' + mm + '-15', 'Amazon', "Owner's Draw", 60]); }
    rows.push([y + '-' + mm + '-20', 'Granite Property', 'Rent & Lease', 2000]); }
  for (const r of rows) await b.saveTransaction({ type: 'expense', date: r[0], accountId: ck, contactId: v[r[1]], memo: r[1].toUpperCase() + ' PURCHASE', lines: [{ accountId: acc(r[2]), amount: String(r[3]) }] });
  await b.importBankLines(ck, [
    { date: '2025-01-03', description: 'COSTCO WHSE #1097 FRISCO TX', amount: -12345 }, { date: '2025-01-06', description: 'SHELL OIL 57444219', amount: -4500 },
    { date: '2025-01-09', description: 'THE HOME DEPOT #6512', amount: -8800 }, { date: '2025-01-15', description: 'AMAZON MKTPLACE PMTS', amount: -6000 },
    { date: '2025-01-20', description: 'GRANITE PROPERTY RENT', amount: -200000 }, { date: '2025-01-25', description: 'ZQX TRADING 7781', amount: -4100 },
    { date: '2025-02-03', description: 'COSTCO WHSE #1097 FRISCO TX', amount: -9900 }], { fileName: 'jan-feb.csv', endingBalance: 100000, endingDate: '2025-02-28' });
  await OB.ui.openCompany(b.company.id); })()"""
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(), viewport={'width': 1440, 'height': 940})
        pg = ctx.pages[0]; ev = pg.evaluate; errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://' + APP); await pg.wait_for_selector('#newco')
        await ev(SETUP); await pg.wait_for_function("OB.ui.book && OB.ui.book.company.name === 'Harbor Close Co'", timeout=30000)
        check(await pg.locator('[data-testid=nav-close]').count() == 1, 'Close the books is in the side menu')
        await ev("location.hash = '#/close'"); await pg.wait_for_selector('[data-testid=cl-pane]')
        await pg.select_option('#cl-year', '2025'); await pg.wait_for_timeout(300)
        steps = await ev("[...document.querySelectorAll('.cl-steps button')].map(b => b.innerText.replace(/\\s+/g, ' ').trim())")
        check(len(steps) == 8 and steps[0].startswith('1 Statements received') and steps[7].startswith('8 Sign off'), 'Eight checklist steps in CPA words', steps)
        t = await ev("document.querySelector('[data-testid=cl-pane]').innerText")
        check('Missing' in t and 'Import statement' in t, 'Statements: months after February show as missing with an import button', t[:300])
        await pg.click('[data-testid=cl-step-prepare]'); await pg.wait_for_timeout(200)
        await pg.click('[data-testid=cl-run-test]'); await pg.wait_for_selector('[data-testid=cl-test]')
        t = await ev("document.querySelector('[data-testid=cl-test]').innerText")
        check('predicting 2024' in t and 'right 100.0%' in t, 'Self-test on 2024 learned from 2022–2023', t)
        check('clear' in await ev("document.querySelector('[data-testid=cl-pane]').innerText"), 'A clear self-test allows auto-posting')
        await pg.check('[data-testid=cl-auto]'); await pg.wait_for_timeout(300)
        check(not await pg.locator('.modal').count() and await ev("OB.ui.book.company.close.auto === true"), 'Auto-posting turned on without a warning after a clear test')
        if SHOT: await pg.locator('main').screenshot(path=SHOT + '-prepare.png')
        await pg.click('[data-testid=cl-prepare]'); await pg.wait_for_selector('[data-testid=cl-groups]', timeout=15000)
        posted = await ev("OB.ui.book.bankLines.filter(l => l.prepared).map(l => l.description + ' | ' + l.prepared)")
        check(len(posted) == 4 and all(any(k in x for k in ('COSTCO', 'SHELL', 'GRANITE')) for x in posted) and all('24 of 24' in x for x in posted), 'Prepare posted only the sure lines (Costco twice, Shell, rent), each with its reason', posted)
        labels = await ev("[...document.querySelectorAll('.cl-g')].map(r => r.cells[0].innerText.split('\\n')[0] + ' ' + r.cells[2].innerText)")
        check([x.split(' ')[0] for x in labels] == ['Home', 'Amazon', 'ZQX'], 'Review groups by payee, largest dollars first', labels)
        am = await ev("[...document.querySelectorAll('.cl-g')].find(r => r.innerText.includes('Amazon')).innerText")
        check('balance sheet' in am, 'Amazon to the owner account waits, and says why', am)
        hd = await ev("[...document.querySelectorAll('.cl-g')].find(r => r.innerText.includes('Home Depot')).querySelectorAll('.chip').length")
        check(hd == 2, 'Home Depot shows both accounts it was used for', hd)
        if SHOT: await pg.locator('main').screenshot(path=SHOT + '-review.png')
        await pg.locator('.cl-g', has_text='Home Depot').locator('.chip').first.click(); await pg.wait_for_timeout(150)
        await pg.locator('.cl-g', has_text='Home Depot').locator('[data-testid=cl-accept]').click(); await pg.wait_for_timeout(600)
        check(await ev("OB.ui.book.bankLines.find(l => /HOME DEPOT/.test(l.description)).status") == 'posted', 'Accept posts the group with the chosen account')
        await pg.locator('.cl-g', has_text='ZQX').locator('[data-ask]').click(); await pg.wait_for_timeout(500)
        await pg.click('[data-testid=cl-step-questions]'); await pg.wait_for_selector('[data-testid=cl-questions]')
        await pg.fill('[data-testid=cl-answer]', 'Packing boxes'); await pg.press('[data-testid=cl-answer]', 'Tab'); await pg.wait_for_timeout(500)
        check(await ev("OB.ui.book.bankLines.find(l => /ZQX/.test(l.description)).answer") == 'Packing boxes', 'The client answer is kept on the line')
        await pg.click('[data-testid=cl-step-review]'); await pg.wait_for_timeout(300)
        check('Client: Packing boxes' in await ev("document.querySelector('[data-testid=cl-groups]').innerText"), 'Review shows the client answer next to the payee')
        await pg.click('[data-testid=cl-step-flux]'); await pg.wait_for_selector('[data-testid=cl-flux]')
        n0 = await ev("document.querySelectorAll('.cl-flag').length")
        await pg.locator('.cl-flag').first.locator('input').fill('Only two months posted so far'); await pg.locator('.cl-flag').first.locator('input').press('Tab'); await pg.wait_for_timeout(500)
        check(n0 > 0 and await ev("Object.values(OB.ui.book.company.close.periods)[0].notes") != {}, 'Compare to last year: flagged lines take a reason', n0)
        await pg.click('[data-testid=cl-step-signoff]'); await pg.wait_for_selector('[data-testid=cl-blockers]')
        bl = await ev("document.querySelector('[data-testid=cl-blockers]').innerText")
        check('still to review' in bl and 'not reconciled' in bl and 'statement missing' in bl, 'Sign-off lists what still stands in the way', bl)
        # a period that ties (a new company with nothing open): sign off and lock
        await ev("OB.db.createCompany({ name: 'Quiet Co' }).then((b) => OB.ui.openCompany(b.company.id))"); await pg.wait_for_function("OB.ui.book.company.name === 'Quiet Co'")
        await ev("location.hash = '#/close'"); await pg.wait_for_selector('[data-testid=cl-pane]'); await pg.select_option('#cl-month', '1'); await pg.wait_for_timeout(300)
        await pg.click('[data-testid=cl-step-signoff]'); await pg.click('[data-testid=cl-sign]'); await pg.wait_for_selector('[data-testid=cl-signed]')
        cd = await ev("OB.ui.book.company.closingDate")
        check(cd.endswith('-01-31'), 'Sign off locks the books through the period end (January)', cd)
        check('Done' in await ev("document.querySelector('[data-testid=cl-step-signoff]').innerText"), 'The sign-off step shows done')
        check(not errs, 'No page errors', errs)
        await ctx.close()
    print('\n%d passed, %d failed' % (res.count(True), res.count(False))); sys.exit(0 if all(res) else 1)
asyncio.run(main())

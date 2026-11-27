"""VaultBook 1.64.0 — .iif beside CSV on reports: tick entries (or all in the report), download one .iif with a
progress indicator, then mark them as in QuickBooks. Made-up names only.
Run: python3 tests/dev/reportiif_ui.py"""
import asyncio, os, tempfile
from playwright.async_api import async_playwright
APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'index.src.html')
passed = failed = 0
def check(name, ok, extra=''):
    global passed, failed
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok else '  ' + str(extra))); passed += ok; failed += not ok
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(), viewport={'width': 1440, 'height': 900}, locale='en-US', accept_downloads=True)
        pg = ctx.pages[0]; ev = pg.evaluate; errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://' + APP); await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'Report Co'); await pg.click('#newco button[type=submit]')
        await pg.wait_for_function("OB.ui.book && OB.ui.book.company.name === 'Report Co'", timeout=30000)
        ck = await ev("""(async () => { const b = OB.ui.book, acc = (n) => b.accounts.find((a) => a.name === n).id, ck = acc('Checking');
          await b.saveTransactions([
            { type: 'expense', date: '2026-01-02', accountId: ck, memo: 'Card \\u2014 coffee', lines: [{ accountId: acc('Meals'), amount: '18.50' }] },
            { type: 'expense', date: '2026-01-05', accountId: ck, lines: [{ accountId: acc('Meals'), amount: '40' }] },
            { type: 'deposit', date: '2026-01-06', accountId: ck, lines: [{ accountId: acc('Services'), amount: '900' }] },
            { type: 'expense', date: '2026-02-10', accountId: ck, lines: [{ accountId: acc('Meals'), amount: '7' }] }]);
          return ck; })()""")
        await ev("location.hash = '#/report/gl?range=custom&from=2026-01-01&to=2026-01-31&basis=accrual&account=%s'" % ck)
        await pg.wait_for_selector('[data-testid=rp-iif]')
        check('RI-01 .iif sits beside CSV, and no tick boxes until it is pressed', await ev("document.querySelector('#rp-iif').nextElementSibling.textContent") == 'CSV' and await pg.locator('.rp-pick').count() == 0)
        await pg.click('[data-testid=rp-iif]'); await pg.wait_for_selector('.rp-pick')
        check('RI-02 pressed: one tick box per entry in the report (January: 3)', await pg.locator('.rp-pick').count() == 3 and (await pg.inner_text('[data-testid=rp-iifbar]')).startswith('0 of 3 selected'))
        await pg.locator('.rp-pick').nth(1).check(); await pg.wait_for_timeout(100)
        check('RI-03 a tick selects that entry without opening it', (await ev("location.hash")).startswith('#/report/gl') and await pg.inner_text('[data-testid=rp-iif-count]') == '1')
        await pg.click('[data-testid=rp-iif-all]')
        check('RI-04 Select all ticks every entry in the report', await pg.inner_text('[data-testid=rp-iif-count]') == '3' and await ev("[...document.querySelectorAll('.rp-pick')].every((c) => c.checked)"))
        await ev("window.__saw = false; new MutationObserver(() => { if (document.querySelector('.rp-gen .pr-spin')) window.__saw = true; }).observe(document.body, { subtree: true, childList: true })")
        async with pg.expect_download() as dl: await pg.click('[data-testid=rp-iif-go]')
        d = await dl.value; raw = open(await d.path(), 'rb').read()
        trns = [l.split(b'\t')[2] for l in raw.split(b'\r\n') if l.startswith(b'TRNS\t')]
        check('RI-05 a progress indicator showed while the file was made', await ev("window.__saw"))
        check('RI-06 the .iif holds the three January entries, named for the report and period', sorted(trns) == [b'CHECK', b'CHECK', b'DEPOSIT'] and d.suggested_filename == 'Report-Co-General-Ledger-01-01-2026-01-31-2026.iif' and b'Card - coffee' in raw, (trns, d.suggested_filename))
        await pg.wait_for_selector('[data-testid=rp-iif-yes]')
        check('RI-07 it asks whether QuickBooks imported it', 'Saved' in await pg.inner_text('[data-testid=rp-iif-note]'))
        await pg.click('[data-testid=rp-iif-yes]'); await pg.wait_for_function("document.querySelector('[data-testid=rp-iif-note]').innerText.includes('marked')")
        check('RI-08 Yes marks them as in QuickBooks', await ev("Object.values(OB.ui.book.company.qbSent || {}).filter((s) => s.iif).length") == 3)
        await pg.click('[data-testid=rp-iif-go]'); await pg.wait_for_selector('.toast', timeout=5000)
        check('RI-09 a second download of the same entries is refused: they are already in QuickBooks', 'already in QuickBooks' in await pg.inner_text('.toast'))
        await ev("location.hash = '#/report/gl?range=custom&from=2026-02-01&to=2026-02-28&basis=accrual&account=%s'" % ck); await pg.wait_for_selector('.rp-pick')
        check('RI-10 another period starts with nothing selected', await pg.locator('.rp-pick').count() == 1 and await pg.inner_text('[data-testid=rp-iif-count]') == '0')
        await pg.click('[data-testid=rp-iif]'); await pg.wait_for_timeout(150)
        check('RI-11 pressing .iif again hides the boxes', await pg.locator('.rp-pick').count() == 0 and await pg.locator('[data-testid=rp-iifbar]').count() == 0)
        await ev("location.hash = '#/report/pnl'"); await pg.wait_for_selector('article.report')
        check('RI-12 a summary report with no entries has no .iif button', await pg.locator('[data-testid=rp-iif]').count() == 0)
        check('RI-13 no page errors', not errs, errs)
        print('\n%d passed, %d failed' % (passed, failed)); await ctx.close()
asyncio.run(main())

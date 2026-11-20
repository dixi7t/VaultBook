"""VaultBook 1.50.2 — typing a date never redraws mid-typing (P&L and Balance Sheet; U.dateCommit everywhere).
Typed MM/DD/YYYY applies on Enter or on leaving the box; a calendar pick applies at once. Run: python3 tests/dev/dates_ui.py"""
import asyncio, os, tempfile
from playwright.async_api import async_playwright
APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'index.html')
passed = failed = 0
def check(name, ok, extra=''):
    global passed, failed
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok else '  ' + str(extra))); passed += ok; failed += not ok
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(), viewport={'width': 1440, 'height': 900}, locale='en-US')
        pg = ctx.pages[0]; ev = pg.evaluate; errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://' + APP); await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'Date Test'); await pg.click('#newco button[type=submit]')
        await pg.wait_for_function("OB.ui.book && OB.ui.book.company.name === 'Date Test'", timeout=30000)
        async def typed(route, sel, how, keys='03152025'):
            await ev("location.hash = '%s'" % route); await pg.wait_for_selector(sel); await pg.wait_for_timeout(300)
            await ev("window.__r = 0; const r0 = OB.ui.render; if (!r0.__w) { OB.ui.render = function () { window.__r++; return r0.apply(this, arguments); }; OB.ui.render.__w = 1; }")
            bx = await pg.locator(sel).bounding_box(); await pg.mouse.click(bx['x'] + 12, bx['y'] + bx['height'] / 2)
            await pg.keyboard.type(keys, delay=60); await pg.wait_for_timeout(250)
            mid = await ev("window.__r")
            if how == 'enter': await pg.keyboard.press('Enter')
            else: await pg.keyboard.press('Tab'); await pg.keyboard.press('Tab')
            await pg.wait_for_timeout(600)
            return mid, await ev("document.querySelector('%s').value" % sel), await ev("location.hash")
        for route, sel, how, name, keys, want in [('#/report/pnl', '#st-from', 'enter', 'P&L From', '03152025', '2025-03-15'), ('#/report/pnl', '#st-to', 'tab', 'P&L To', '12312026', '2026-12-31'),
                                                  ('#/report/bs', '#st-to', 'enter', 'Balance Sheet As of', '03152025', '2025-03-15')]:
            mid, val, hsh = await typed(route, sel, how, keys)
            check('DT %s: no redraw while typing, %s applies on %s' % (name, want, 'Enter' if how == 'enter' else 'leaving the box'), mid == 0 and val == want and want in hsh, (mid, val, hsh))
        # 1.50.3: no Enter at all: the report follows once the date is complete, and the cursor stays in the box
        await ev("location.hash = '#/report/bs'"); await pg.wait_for_selector('#st-to'); await pg.wait_for_timeout(300)
        bx = await pg.locator('#st-to').bounding_box(); await pg.mouse.click(bx['x'] + 12, bx['y'] + bx['height'] / 2)
        await pg.keyboard.type('06302024', delay=60); await pg.wait_for_timeout(1300)
        check('DT the report follows a complete typed date by itself', 'to=2024-06-30' in await ev("location.hash") and await ev("document.activeElement.id") == 'st-to', (await ev("location.hash"), await ev("document.activeElement.id")))
        await ev("location.hash = '#/report/pnl'"); await pg.wait_for_selector('#st-from'); await pg.wait_for_timeout(300)
        await ev("(() => { const i = document.querySelector('#st-from'); i.value = '2024-07-01'; i.dispatchEvent(new Event('change', { bubbles: true })); })()"); await pg.wait_for_timeout(500)
        check('DT a calendar pick applies at once', 'from=2024-07-01' in await ev("location.hash"), await ev("location.hash"))
        check('DT no page errors', not errs, errs)
        print('\n%d passed, %d failed' % (passed, failed)); await ctx.close()
asyncio.run(main())

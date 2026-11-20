"""VaultBook 1.51.0 — menu bar and icon toolbar at the top (File ... Help), side menu off by default, Home is the dashboard.
Run: python3 tests/dev/menubar_ui.py"""
import asyncio, os, tempfile
from playwright.async_api import async_playwright
APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'index.html')
passed = failed = 0
def check(name, ok, extra=''):
    global passed, failed
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok else '  ' + str(extra))); passed += ok; failed += not ok
MENUS = ['File', 'Edit', 'View', 'Lists', 'Company', 'Customers', 'Vendors', 'Employees', 'Banking', 'Accountant', 'Reports', 'Window', 'Help']
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(), viewport={'width': 1440, 'height': 900}, locale='en-US')
        pg = ctx.pages[0]; ev = pg.evaluate; errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://' + APP); await pg.wait_for_selector('#newco')
        check('MB-01 no menu bar before a company is open', not await pg.is_visible('#mbar'))
        await pg.fill('#newco input[name=name]', 'Menu Test'); await pg.click('#newco button[type=submit]')
        await pg.wait_for_function("OB.ui.book && OB.ui.book.company.name === 'Menu Test'", timeout=30000); await pg.wait_for_timeout(300)
        names = await ev("[...document.querySelectorAll('#mbar .mb-top')].map((b) => b.textContent)")
        check('MB-02 the menu bar shows the thirteen menus', names == MENUS and await pg.is_visible('#mbar'), names)
        check('MB-03 a new company opens on Home (the dashboard) with the side menu hidden', await ev("location.hash") == '#/dashboard' and not await pg.is_visible('#sidebar'), await ev("location.hash"))
        check('MB-04 the company name shows on the menu bar', await ev("document.getElementById('mb-co').textContent") == 'Menu Test')
        await pg.click('#mbar .mb-top >> text=Banking')
        check('MB-05 a click opens a menu', await pg.is_visible('#mbar .mb-menu') and await ev("document.querySelector('#mbar .mb-top[aria-expanded=true]').textContent") == 'Banking')
        await pg.hover('#mbar .mb-top >> text=Reports'); await pg.wait_for_timeout(100)
        check('MB-06 moving along the bar switches menus', await ev("document.querySelector('#mbar .mb-top[aria-expanded=true]').textContent") == 'Reports' and await pg.locator('#mbar .mb-menu').count() == 1)
        await pg.click('#mbar .mb-menu >> text=Profit and loss'); await pg.wait_for_timeout(300)
        check('MB-07 a menu item opens its screen and the menu closes', (await ev("location.hash")).startswith('#/report/pnl') and await pg.locator('#mbar .mb-menu').count() == 0, await ev("location.hash"))
        bad = await ev("""(() => { const out = []; document.querySelectorAll('#mbar .mb-top').forEach((b) => { b.click(); document.querySelectorAll('#mbar .mb-menu a').forEach((a) => {
            const n = a.getAttribute('href').slice(2).split(/[/?]/)[0]; if (!OB.ui.routes[n]) out.push(a.getAttribute('href')); }); }); document.body.click(); return out; })()""")
        check('MB-08 every menu link leads to a real screen', bad == [], bad)
        await pg.click('#tbar a[href="#/bankfeed"]'); await pg.wait_for_timeout(300)
        check('MB-09 the toolbar opens Bank feed and marks it', await ev("location.hash") == '#/bankfeed' and await ev("document.querySelector('#tbar a[href=\"#/bankfeed\"]').getAttribute('aria-current')") == 'page')
        check('MB-10 toolbar buttons carry an icon and a label', await ev("[...document.querySelectorAll('#tbar a')].every((a) => a.querySelector('svg') && a.textContent.trim())") and await pg.locator('#tbar a').count() >= 12)
        await pg.click('#mbar .mb-top >> text=View'); await pg.click('#mbar .mb-menu >> text=Show the side menu'); await pg.wait_for_timeout(150)
        shown = await pg.is_visible('#sidebar')
        await pg.click('#mbar .mb-top >> text=View'); await pg.click('#mbar .mb-menu >> text=Hide the side menu'); await pg.wait_for_timeout(150)
        check('MB-11 View shows and hides the side menu', shown and not await pg.is_visible('#sidebar'))
        await pg.click('#mbar .mb-top >> text=Window')
        wins = await ev("[...document.querySelectorAll('#mbar .mb-menu [data-win]')].map((b) => b.textContent.trim())")
        check('MB-12 Window lists the open screens', len(wins) >= 2 and any('Bank feed' in w for w in wins), wins)
        await pg.keyboard.press('Escape'); h0 = await ev("location.hash")
        await pg.focus('#mbar .mb-top'); await pg.keyboard.press('ArrowDown')
        k1 = await ev("document.activeElement.closest('.mb-menu') && document.querySelector('#mbar .mb-top[aria-expanded=true]').textContent")
        await pg.keyboard.press('ArrowRight')
        k2 = await ev("document.activeElement.closest('.mb-menu') && document.querySelector('#mbar .mb-top[aria-expanded=true]').textContent")
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(100)
        check('MB-13 arrow keys open and move between menus; Esc closes without leaving the screen', k1 == 'File' and k2 == 'Edit' and await pg.locator('#mbar .mb-menu').count() == 0 and await ev("location.hash") == h0, (k1, k2, await ev("location.hash")))
        await pg.click('#mbar .mb-top >> text=File'); await pg.click('#mbar .mb-menu >> text=Print'); await pg.wait_for_timeout(200)
        check('MB-14 File, Print opens the print choices', await ev("!!document.querySelector('.cmd-menu:not([hidden])')"))
        await pg.keyboard.press('Escape')
        check('MB-15 the accent is the new blue, not green', (await ev("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()")).lower() == '#2452c7')
        await pg.set_viewport_size({'width': 1024, 'height': 768}); await pg.wait_for_timeout(150)
        check('MB-16 at 1024 wide nothing overflows sideways', await ev("document.documentElement.scrollWidth <= window.innerWidth"), await ev("document.documentElement.scrollWidth"))
        check('MB-17 no page errors', not errs, errs)
        print('\n%d passed, %d failed' % (passed, failed)); await ctx.close()
asyncio.run(main())

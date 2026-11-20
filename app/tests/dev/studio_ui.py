"""
VaultBook Studio look UI test (1.25, developer-only): top bar (search, period, + New), the + New menu (filter,
arrow keys, Enter, F-keys inside it, duplicate a recent entry), home tabs, Business overview widgets, the Banking
badge, the Posted tab, dark mode. Synthetic sample company only.
Requires: Python 3 + Playwright (Chromium).
Usage: python3 studio_ui.py /path/to/app/index.html
"""
import asyncio, os, sys, tempfile
from playwright.async_api import async_playwright

APP = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'index.html'))
results = []
def check(cond, name, detail=''):
    results.append((bool(cond), name)); print(('  ok   ' if cond else '  FAIL ') + name + (('  [' + str(detail) + ']') if detail and not cond else ''))

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='vb_st_'), viewport={'width': 1440, 'height': 900})
        pg = ctx.pages[0]; errors = []; pg.on('pageerror', lambda e: errors.append(str(e))); ev = pg.evaluate
        await pg.goto('file://' + APP); await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'Studio Co'); await pg.check('#newco input[name=sample]')
        await pg.click('#newco button[type=submit]'); await pg.wait_for_function('OB.ui.book'); await pg.wait_for_timeout(1500)

        # top bar
        per = await pg.inner_text('#st-period-text')
        p0 = await ev('(() => { const p = OB.ui.currentPeriod(); return OB.util.fmtDate(p.from) + " – " + OB.util.fmtDate(p.to); })()')
        check(per == p0, 'Top bar shows the current period', (per, p0))
        await pg.click('#st-period'); await pg.wait_for_selector('.modal-backdrop', timeout=4000)
        check('period' in (await pg.inner_text('.modal h2')).lower(), 'Period button opens the Alt+F2 period dialog')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
        check(await pg.locator('#top-search .ts-label').is_visible(), 'Search is a visible field in the top bar')

        # home tabs
        await ev("location.hash = '#/gateway'"); await pg.wait_for_selector('[data-testid=home-tabs]')
        check(await ev("document.querySelector('[data-testid=home-tab-gateway]').getAttribute('aria-current')") == 'page', 'Gateway is the "Get things done" tab')
        check(await pg.locator('.gw-item.on').count() == 1, 'Gateway keyboard cursor still there')
        await pg.click('[data-testid=home-tab-dashboard]'); await pg.wait_for_selector('[data-testid=w-pnl]')
        ids = await ev("[...document.querySelectorAll('.st-widgets > section')].map(s => s.dataset.testid)")
        check(ids == ['w-pnl', 'w-expenses', 'w-banks', 'w-invoices', 'w-tasks', 'w-year', 'w-recent'], 'Business overview widgets in order', ids)
        check(await pg.locator('[data-testid=kpi-income]').count() == 1 and await pg.locator('[data-testid=bar-in]').count() == 12, 'Fiscal-year totals and the 12-month chart with drill-down bars kept')
        net = await ev("(() => { const p = OB.ui.currentPeriod(), h = OB.reports.home(OB.ui.book, OB.ui.workDate(), { from: p.from, to: p.to }); return OB.util.fmt(h.pnl.net, { symbol: true }); })()")
        pnl = await ev("(() => { const p = OB.ui.currentPeriod(), t = OB.ui.workDate(); return OB.util.fmt(OB.reports.pnl(OB.ui.book, { from: p.from, to: p.to < t ? p.to : t, basis: OB.ui.book.company.basis }).netIncome[0], { symbol: true }); })()")
        check(net == pnl and net in await pg.inner_text('[data-testid=w-pnl]'), 'Profit and loss widget shows the engine number for the app period, the same as the P&L', (net, pnl))
        check(await pg.locator('[data-testid=w-expenses] svg[role=img]').count() == 1, 'Expenses ring chart has a text label')
        check(await pg.locator('[data-testid=home-shortcuts] a').count() == 6, 'Six shortcuts')
        await pg.click('[data-testid=home-shortcuts] a >> nth=0'); await pg.wait_for_function("location.hash.indexOf('type=invoice') > 0")
        check(True, 'Create invoice shortcut opens a new invoice')
        await ev("OB.ui.dirty = false; location.hash = '#/dashboard'"); await pg.wait_for_selector('[data-testid=w-pnl]')

        # + New menu
        await pg.click('#st-new'); await pg.wait_for_selector('[data-testid=new-menu]')
        check(await ev('document.activeElement.id') == 'nm-q', 'The filter box has focus')
        txt = await ev("document.querySelector('[data-testid=new-menu]').textContent")
        check(all(w in txt for w in ['Invoice', 'Bill', 'Journal Entry', 'Import bank file', 'Recently used']) and 'F8' in txt and 'Alt+F9' in txt, 'Grouped forms with their keys')
        await pg.keyboard.type('bill'); await pg.wait_for_timeout(150)
        shown = await ev("[...document.querySelectorAll('[data-nm]')].filter(a => !a.hidden).map(a => a.innerText.split('\\n')[0])")
        check(shown[:2] == ['Bill', 'Bill Payment'] and 'Invoice' not in shown, 'Filter narrows the list', shown)
        await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('Enter'); await pg.wait_for_function("location.hash.indexOf('type=billPayment') > 0", timeout=5000)
        check(not await pg.locator('.modal-backdrop').count(), 'Arrow down + Enter opens the second match and closes the menu')
        await ev("OB.ui.dirty = false; location.hash = '#/dashboard'"); await pg.wait_for_selector('[data-testid=w-pnl]')
        await pg.keyboard.press('F10'); await pg.wait_for_selector('[data-testid=new-menu]')
        check(True, 'F10 opens the same menu')
        await pg.keyboard.press('F8'); await pg.wait_for_function("location.hash.indexOf('type=invoice') > 0", timeout=5000)
        check(True, 'F8 inside the menu opens an invoice')
        await ev("OB.ui.dirty = false; location.hash = '#/dashboard'"); await pg.wait_for_selector('[data-testid=w-pnl]')
        await pg.click('#st-new'); await pg.wait_for_selector('[data-testid=new-menu]')
        dup = await ev("(document.querySelector('a.st-recent') || {}).getAttribute ? document.querySelector('a.st-recent').getAttribute('href') : ''")
        check('copy=' in dup, 'Recently used entries open as a duplicate', dup)
        await pg.keyboard.type('zzzz'); await pg.wait_for_timeout(100)
        check(await pg.locator('.st-nm-none').is_visible(), 'No match says so')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(150)
        check(not await pg.locator('.modal-backdrop').count(), 'Esc closes the menu')

        # Banking badge and the Posted tab
        await ev("""(async () => { const b = OB.ui.book, chk = b.accounts.find(a => a.name === 'Checking').id;
          await b.importBankLines(chk, [{ date: '2026-11-09', description: 'POS DEBIT HOME DEPOT', amount: -41266 }, { date: '2026-11-05', description: 'SQ *CAFE', amount: -3875 }], { fileName: 'x.csv', matchBooks: false });
          location.hash = '#/bankfeed?account=' + chk; })()"""); await pg.wait_for_selector('[data-testid=bf-table]')
        check(await ev("document.querySelector('[data-testid=nav-bankfeed-count]').textContent") == '2', 'Bank feed link shows 2 to review')
        check(await pg.locator('.nav-parent .st-badge').count() == 1, 'The folded Banking group shows the count too')
        check((await pg.inner_text('[data-testid=bf-tab-posted]')).startswith('Posted'), 'Posted tab is called Posted (QuickBooks Online 2026)')
        await ev("location.hash = '#/dashboard'"); await pg.wait_for_selector('[data-testid=w-banks]')
        check('2 to review' in await pg.inner_text('[data-testid=w-banks]') and 'Review 2 bank lines' in await pg.inner_text('[data-testid=w-tasks]'), 'Bank accounts widget and Tasks show the lines to review')

        # registers: options panel folded until asked for, month graph for sales and purchases
        await ev("location.hash = '#/vreg/sales'"); await pg.wait_for_selector('[data-testid=vr-months]')
        check(await pg.locator('#vr-side').is_hidden() and await ev("document.querySelector('#vr-side-t').getAttribute('aria-expanded')") == 'false', 'Register options are folded away')
        check(await pg.locator('[data-testid=vr-chart] .vr-bar').count() == 12, 'Sales Register shows a bar per month')
        await pg.click('[data-testid=vr-chart] .vr-bar >> nth=5'); await pg.wait_for_selector('[data-testid=vr-vouchers]', timeout=5000)
        check('month=' in await ev('location.hash'), 'A bar opens that month')
        await ev("location.hash = '#/vreg/purchase'"); await pg.wait_for_selector('[data-testid=vr-months]')
        check(await pg.locator('[data-testid=vr-chart]').count() == 1 and 'Purchases by month' in await ev("document.querySelector('[data-testid=vr-chart] figcaption').textContent"), 'Purchase Register has its graph')
        await pg.click('#vr-side-t'); await pg.wait_for_selector('#vr-side:not([hidden])')
        check(await ev("document.querySelector('#vr-side-t').getAttribute('aria-expanded')") == 'true', 'Filters and options opens the panel')
        await pg.click('#vr-side-t'); await pg.wait_for_selector('#vr-side[hidden]', state='attached')
        await ev("document.querySelector('#main').focus()"); await pg.keyboard.press('Control+f'); await pg.wait_for_selector('#vr-side:not([hidden])')
        check(await ev('document.activeElement.id') == 'vr-contact', 'Ctrl+F opens the panel on the name filter')
        await pg.select_option('#vr-contact', index=1); await pg.wait_for_function("location.hash.indexOf('contact=') > 0")
        await ev("OB.prefs.set('vregSide', false); OB.ui.render()"); await pg.wait_for_timeout(200)
        check(await pg.locator('#vr-side').is_visible() and await pg.locator('#vr-side-t .st-badge').count() == 1, 'With a filter on, the panel stays open and the button shows the count')
        await ev("location.hash = '#/vreg/bank'"); await pg.wait_for_selector('.vr-table')
        check(await pg.locator('[data-testid=vr-chart]').count() == 0, 'Cash/Bank Book has no graph')

        # Gateway: the shorter home menu, Company sub-menu, no key hints on the tabs, no backup banner
        await ev("location.hash = '#/gateway'"); await pg.wait_for_selector('.gw-item')
        items = await ev("[...document.querySelectorAll('.gw-item')].map(x => x.textContent.trim().replace(/\\s*›$/, ''))")
        check(len(items) == 12 and 'Company' in items and 'Dashboard' not in items, 'Gateway home menu is shorter', items)
        await pg.keyboard.press('o'); await pg.wait_for_function("location.hash === '#/gateway?m=company'")
        try: await pg.wait_for_function("(document.querySelector('.gw-menu') || {}).textContent.includes('Features')", timeout=4000)
        except Exception: pass
        txt = await pg.inner_text('.gw-menu')
        check(all(w in txt for w in ['Features', 'Configure', 'Settings and backup', 'Import from QuickBooks']), 'Company sub-menu holds the moved items')
        await ev("location.hash = '#/gateway?m=vouchers'"); await pg.wait_for_selector('.gw-item')
        check('Reclassify transactions' in await pg.inner_text('.gw-menu'), 'Recurring and Reclassify are under Vouchers')
        await ev("location.hash = '#/dashboard'"); await pg.wait_for_selector('[data-testid=w-pnl]')
        tabs = await pg.inner_text('[data-testid=home-tabs]')
        check('G H' not in tabs and 'G D' not in tabs, 'Home tabs show no key hints')
        check('No backup yet' not in await pg.inner_text('#main'), 'No backup banner on Business overview')
        hgt = await ev("document.querySelector('.dash-chart').getBoundingClientRect().height")
        check(hgt <= 205, 'The 12-month chart is at most 200px tall', hgt)

        # dark mode
        await ev("OB.ui.setTheme('dark')"); await pg.wait_for_timeout(200)
        bg = await ev("getComputedStyle(document.querySelector('.topbar')).backgroundColor")
        check(bg != 'rgb(255, 255, 255)', 'Top bar goes dark in dark mode', bg)
        await ev("OB.ui.setTheme('light')")
        check(not errors, 'No page errors', errors[:3])
        await ctx.close()
    ok = sum(1 for r in results if r[0]); print('\n%d passed, %d failed' % (ok, len(results) - ok)); sys.exit(0 if ok == len(results) else 1)
asyncio.run(main())

"""TallyPrime-style keyboard work (1.22.0) in the browser: F2 date / Alt+F2 period with typed shorthand, the clickable
Gateway header, report button panel (Alt+N, Alt+C, Ctrl+B, Alt+F5), one P&L / Balance Sheet entry, Sales/Purchase/Bank
registers, row cursor on more screens, the keyboard company list, and Reclassify Transactions.
Usage: python3 tally_ui.py /path/to/app/index.html"""
import asyncio, sys, os, tempfile
from playwright.async_api import async_playwright
APP = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'index.html'))
res = []
def check(ok, msg, info=''):
    res.append(bool(ok)); print(('  ok   ' if ok else '  FAIL ') + msg + ('' if ok else '  -> ' + str(info)))
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(), viewport={'width': 1500, 'height': 900})
        pg = ctx.pages[0]; ev = pg.evaluate; errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        async def go(h, w=700): await ev(f"OB.ui.dirty = false; location.hash = '{h}'"); await pg.wait_for_timeout(w)
        async def key(k, w=300): await pg.keyboard.press(k); await pg.wait_for_timeout(w)
        q = lambda s: ev(f"(() => {{ const x = document.querySelector({s!r}); return x ? x.textContent.trim() : null; }})()")
        await pg.goto('file://' + APP); await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'Tally UI Co'); await pg.check('#newco input[name=sample]')
        await pg.click('#newco button[type=submit]'); await pg.wait_for_function('OB.ui.book'); await pg.wait_for_timeout(1500)

        await go('#/gateway')
        check(await ev("[...document.querySelectorAll('.gw-stat')].map(x => x.dataset.act).join()") == 'period,date,company,last', 'Gateway header items are buttons')
        check(await ev("!document.querySelector('.gw-recent') && !document.getElementById('btn-new') && !document.querySelector('.fk-hint')"), 'Recent entries, sidebar New button and key-hint remark are gone')
        await key('F2'); check(await q('.modal h2') == 'Change current date (F2)', 'F2 on the Gateway asks for the current date')
        await pg.keyboard.type('june20'); await pg.wait_for_timeout(100)
        check('June 20' in (await q('#sd-a-out') or ''), 'Typing june20 reads as June 20 of this year', await q('#sd-a-out'))
        await key('Enter', 500)
        y = (await ev('OB.util.today()'))[:4]
        check(await ev('OB.ui.workDate()') == y + '-06-20', 'Current date set', await ev('OB.ui.workDate()'))
        await go('#/txn/new?type=expense'); check(await pg.input_value('[name=date]') == y + '-06-20', 'New entries are dated on the current date')
        await go('#/gateway'); await key('Alt+F2'); await pg.keyboard.type('0401'); await key('Enter', 100); await pg.keyboard.type('6.30'); await key('Enter', 500)
        check(await ev('OB.ui.period()') == {'from': y + '-04-01', 'to': y + '-06-30'}, 'Alt+F2 sets the period from 0401 and 6.30', await ev('OB.ui.period()'))
        await pg.click('[data-act=date]'); await pg.wait_for_timeout(300)
        check(await q('.modal h2') == 'Change current date (F2)', 'Clicking Current date opens the same dialog'); await pg.keyboard.type('t'); await key('Enter', 500)
        check(await ev('OB.ui.workDate() === OB.util.today()'), '"t" sets it back to today')

        await go('#/report/pnl')
        check(await ev("document.querySelector('#st-range').value") == 'period', 'Reports open on the current period')
        panel = await ev("[...document.querySelectorAll('#fkeys .fk')].map(x => x.textContent).join('|')")
        check(all(k in panel for k in ['F2Period', 'Alt+NAuto column', 'Alt+CNew column', 'Ctrl+BBasis of values']), 'P&L shows the report buttons on the right', panel[:200])
        await key('Alt+n'); check(await q('.modal h2') == 'Auto column — show columns by', 'Alt+N offers auto columns')
        await ev("(() => { const x = [...document.querySelectorAll('.ch-opt input')].find(i => i.value === 'month'); x.focus(); x.checked = true; })()"); await key('Enter', 800)
        check(await ev("document.querySelector('#st-by').value") == 'month', 'Months chosen with the keyboard')
        await key('Alt+c'); await ev("(() => { const x = [...document.querySelectorAll('.ch-opt input')].find(i => i.value === 'inc'); x.focus(); })()"); await key('Space', 100); await key('Enter', 800)
        check('cmp=inc' in await ev('location.hash'), 'Alt+C adds % of income', await ev('location.hash'))
        await key('Control+b'); await ev("(() => { const x = [...document.querySelectorAll('.ch-opt input')].find(i => i.value === 'cash'); x.focus(); x.checked = true; })()"); await key('Enter', 800)
        check('basis=cash' in await ev('location.hash'), 'Ctrl+B changes the basis')
        await go('#/gateway?m=reports')
        items = await ev("[...document.querySelectorAll('.gw-item')].map(x => x.textContent.trim())")
        check(not any(x.startswith('Profit and Loss ') for x in items) and 'Balance Sheet Comparison' not in items and 'Profit and Loss' in items, 'One Profit and Loss and one Balance Sheet in Display More Reports')
        await go('#/report/pnlmonth', 900); check('by=month' in await ev('location.hash'), 'Old links to P&L by Month still work')

        await go('#/vreg/sales?range=all')
        check(await ev("document.querySelectorAll('[data-testid=vr-months] tbody tr').length") > 2, 'Sales Register shows months')
        await pg.focus('#main'); await key('ArrowDown', 100); await key('Enter', 700)
        check('month=' in await ev('location.hash') and await ev("document.querySelectorAll('[data-testid=vr-vouchers] tbody tr').length") >= 1, 'Enter on a month opens its vouchers', await ev('location.hash'))
        await key('Alt+F5', 700); check(await ev("document.querySelectorAll('tr.vr-line').length") > 0, 'Alt+F5 shows voucher lines')
        await key('Escape', 700); check('month=' not in await ev('location.hash') or 'det=1' not in await ev('location.hash'), 'Esc goes back')
        await go('#/vreg/purchase?range=all&min=100'); check(await ev("document.querySelector('#vr-min').value") == '100', 'Purchase Register amount filter')
        await go('#/vreg/bank'); check(await ev("document.querySelectorAll('[data-testid=vr-summary] tbody tr').length") >= 2, 'Cash/Bank Summary lists the accounts')

        await go('#/reports'); await pg.focus('#main'); await key('ArrowDown', 100)
        check(await ev("!!document.querySelector('#main li.kb-row')"), 'Arrow keys move through the report list')

        # Reclassify
        await go('#/reclassify?from=2025-01-01&to=2026-12-31', 900)
        n = await ev("document.querySelectorAll('[data-testid=rc-rows] tbody tr').length")
        await pg.focus('#main'); await key('ArrowDown', 100); await key('Space', 100); await key('ArrowDown', 100); await key('Space', 100)
        check('2 selected' in (await q('#rc-count') or ''), 'Space ticks reclassify rows', await q('#rc-count'))
        target = await ev("OB.ui.book.accounts.find(a => a.name === 'Meals').id")
        await ev(f"(() => {{ const h = document.querySelector('#rc-toacc'); h.value = '{target}'; h.dispatchEvent(new Event('change', {{ bubbles: true }})); }})()"); await pg.wait_for_timeout(200)
        check('Will change 2 lines' in (await q('#rc-preview') or ''), 'Preview shows what will move', await q('#rc-preview'))
        await key('Control+Enter', 1000)
        check(await ev('OB.ui.book.reclassBatches().length') == 1 and await ev("document.querySelectorAll('[data-testid=rc-rows] tbody tr').length") == n - 2, 'Reclassify moves the lines off the account')
        await pg.click('#rc-hist'); await pg.wait_for_timeout(300); await pg.click('[data-undo]'); await pg.wait_for_timeout(900)
        check(await ev('!!OB.ui.book.reclassBatches()[0].undone') and await ev('OB.ui.book.checkIntegrity().issues.length') == 0, 'Undo puts them back; books stay in balance')

        # company list keyboard
        await ev("OB.ui.dirty = false; OB.ui.closeCompany()"); await pg.wait_for_timeout(1200)
        check(await ev("document.activeElement.classList.contains('company-open')"), 'Company list: the most recent company is highlighted')
        await key('Alt+c', 100); check(await ev("document.activeElement.name") == 'name', 'Alt+C goes to Create a company')
        await key('Escape', 100); await key('Enter', 100); await pg.wait_for_function('OB.ui.book')
        check(await ev('OB.ui.book.company.name') == 'Tally UI Co', 'Enter opens the company')
        check(not errs, 'No page errors', errs)
        await ctx.close()
    print('\n%d passed, %d failed' % (res.count(True), res.count(False)))
    sys.exit(0 if all(res) else 1)
asyncio.run(main())

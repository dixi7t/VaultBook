"""VaultBook 1.50.1 — Calendar like a desktop calendar, driven with a real mouse and keyboard: drag a bill to a pay date
and undo; click an empty day to add; Ctrl-click several and drag them together; Delete and Ctrl+Z; a deadline cannot
move; draw a timed to-do in the week grid, move it, resize it, drop an all-day to-do into the grid; popovers (post a
recurring entry, mark filed, invoice reminder); agenda; .ics; reminders. Dates relative to today. Synthetic names.
Run: python3 tests/dev/calendar_ui.py [shots]"""
import asyncio, os, sys, tempfile
from playwright.async_api import async_playwright
APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'index.html')
SHOT = sys.argv[1] if len(sys.argv) > 1 else ''
passed = failed = 0
def check(name, ok, extra=''):
    global passed, failed
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok else '  ' + str(extra))); passed += ok; failed += not ok
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(), viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
        pg = ctx.pages[0]; ev = pg.evaluate; errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        async def center(sel, dy=0, fy=None):
            b = await pg.locator(sel).first.bounding_box(); return (b['x'] + b['width'] / 2, (b['y'] + b['height'] * fy) if fy is not None else b['y'] + b['height'] / 2 + dy)
        async def drag(a, bpt, mods=None):
            await pg.mouse.move(*a); await pg.mouse.down(); await pg.mouse.move(a[0] + 8, a[1] + 8, steps=3); await pg.mouse.move(*bpt, steps=12); await pg.mouse.up(); await pg.wait_for_timeout(500)
        await pg.goto('file://' + APP); await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'Cal Test'); await pg.click('#newco button[type=submit]')
        await pg.wait_for_function("OB.ui.book && OB.ui.book.company.name === 'Cal Test'", timeout=30000)
        D = await ev("""(async () => { const b = OB.ui.book, U = OB.util, t = U.today(), d = (n) => U.addDays(t, n);
          const chk = b.accounts.find(a => a.name === 'Checking'), exp = b.accounts.find(a => a.type === 'expense'), inc = b.accounts.find(a => a.type === 'income');
          const ve = await b.saveContact({ name: 'Pine Street LLC', kind: 'vendor' }), cu = await b.saveContact({ name: 'Acme Co', kind: 'customer', email: 'ap@acme.example' });
          await b.saveTransaction({ type: 'deposit', date: d(-20), accountId: chk.id, lines: [{ accountId: inc.id, amount: '1000' }] });
          const bill = await b.saveTransaction({ type: 'bill', date: d(-5), dueDate: d(4), contactId: ve.id, lines: [{ accountId: exp.id, amount: '1500' }] });
          await b.saveTransaction({ type: 'invoice', date: d(-10), dueDate: d(6), contactId: cu.id, lines: [{ accountId: inc.id, amount: '900' }] });
          await b.saveRecurring({ name: 'Internet service', template: { type: 'check', accountId: chk.id, contactId: '', lines: [{ accountId: exp.id, amount: '200' }] }, frequency: 'monthly', nextDate: d(-1) });
          await b.saveSalesTax({ name: 'State Sales Tax', agency: 'State Tax Office', rate: '6' });
          await b.saveCompany({ taxForm: '1120S' }); await OB.cal.saveSettings(b, { salesTax: { 'State Tax Office': { freq: 'monthly', day: 20 } } });
          const first = U.today().slice(0, 8) + '01', dow = (x) => new Date(x + 'T00:00:00Z').getUTCDay(), s = U.addDays(first, -dow(first));
          return { t, bill: bill.id, due: d(4), inv: d(6), move: d(8), s: s }; })()""")
        # use a day in the visible grid that is a Wednesday of the 2nd week for steady layout
        await ev("location.hash = '#/calendar?date=%s'" % D['t']); await pg.wait_for_selector('[data-testid=cal-grid]')
        cell = lambda d: '[data-day="%s"]' % d
        txt = lambda d: ev("(document.querySelector('[data-day=\"%s\"]') || {}).innerText || ''" % d)
        check('CU-01 bill on its due date, amount in its tooltip', 'Pay Pine Street LLC' in await txt(D['due']) and '1,500.00' in await ev("document.querySelector('[data-day=\"%s\"] .cal-k-bill').title" % D['due']))
        check('CU-02 invoice on its due date', 'Acme Co pays invoice' in await txt(D['inv']))
        check('CU-03 low balance warning names the bill day', await ev("(document.querySelector('[data-testid=cal-low] [data-goto]') || {}).dataset.goto") == D['due'])
        check('CU-04 monthly sales tax return shows as a deadline', await ev("[...document.querySelectorAll('.cal-k-tax')].some(x => /Sales tax return to State Tax Office/.test(x.title))"))
        if SHOT: await pg.screenshot(path=os.path.join(SHOT, 'calendar-month.png'), full_page=True)
        # 1. drag a bill with the mouse, then Undo
        await drag(await center(cell(D['due']) + ' .cal-k-bill'), await center(cell(D['move']), 25))
        ok5 = await ev("OB.cal.settings(OB.ui.book).payOn['%s']" % D['bill']) == D['move'] and 'Pay Pine Street LLC' in await txt(D['move']) and await ev("OB.ui.book.txById['%s'].dueDate" % D['bill']) == D['due']
        check('CU-05 dragging the bill plans its pay date; the due date stays', ok5)
        check('CU-06 an Undo button appears', await ev("document.querySelector('#cal-snack').classList.contains('on') && !!document.querySelector('[data-testid=cal-undo]')"))
        await pg.click('[data-testid=cal-undo]'); await pg.wait_for_timeout(500)
        check('CU-07 Undo puts it back', 'Pay Pine Street LLC' in await txt(D['due']) and not await ev("OB.cal.settings(OB.ui.book).payOn['%s']" % D['bill']))
        # 2. click an empty spot to add
        await pg.mouse.click(*(await center(cell(D['inv']), fy=0.85))); await pg.wait_for_selector('[data-testid=cal-quick]')
        await pg.keyboard.type('Ask client for receipts'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(500)
        check('CU-08 click an empty day, type, Enter: the to-do is on that day', 'Ask client for receipts' in await txt(D['inv']))
        # 3. Ctrl-click two to-dos and drag them together
        await ev("OB.cal.saveTodo(OB.ui.book, { date: '%s', title: 'Draft letter' }).then(() => OB.ui.render())" % D['inv']); await pg.wait_for_timeout(300)
        a = '%s .cal-k-todo:has-text("Ask client")' % cell(D['inv']); bsel = '%s .cal-k-todo:has-text("Draft letter")' % cell(D['inv'])
        await pg.click(a, modifiers=['Control']); await pg.click(bsel, modifiers=['Control']); await pg.wait_for_timeout(200)
        check('CU-09 Ctrl-click picks several; a bar says 2 selected', '2 selected' in await ev("(document.querySelector('[data-testid=cal-selbar]') || {}).innerText || ''"))
        two = await ev("OB.util.addDays('%s', 1)" % D['inv'])
        await drag(await center(a), await center(cell(two), 25))
        tx2 = await txt(two)
        check('CU-10 dragging one of them moves both', 'Ask client for receipts' in tx2 and 'Draft letter' in tx2, tx2)
        await pg.click('%s .cal-k-todo:has-text("Ask client")' % cell(two), modifiers=['Shift']); await pg.click('%s .cal-k-todo:has-text("Draft letter")' % cell(two), modifiers=['Shift'])
        await pg.keyboard.press('Delete'); await pg.wait_for_timeout(500)
        check('CU-11 Delete removes the picked to-dos', 'Draft letter' not in await txt(two))
        await pg.keyboard.press('Control+z'); await pg.wait_for_timeout(600)
        check('CU-12 Ctrl+Z brings them back', 'Draft letter' in await txt(two) and 'Ask client' in await txt(two))
        # 4. a deadline does not move
        tk = await ev("document.querySelector('.cal-ev.cal-k-tax').dataset.ev"); td = await ev("document.querySelector('.cal-ev.cal-k-tax').closest('[data-day]').dataset.day")
        await drag(await center('.cal-ev.cal-k-tax'), await center(cell(await ev("OB.util.addDays('%s', 2)" % td)), 25))
        check('CU-13 a tax deadline stays and says why', await ev("document.querySelector('[data-ev=\"%s\"]').closest('[data-day]').dataset.day" % tk) == td and 'set by law' in await ev("document.getElementById('toasts').innerText"))
        # 5. popovers: post the recurring entry; mark the deadline filed
        await pg.click('.cal-ev.cal-k-recurring'); await pg.wait_for_selector('[data-testid=cal-pop]')
        await pg.click('[data-testid=cal-post]'); await pg.wait_for_timeout(500)
        check('CU-14 Post now from the popover posts it and moves the schedule', await ev("OB.ui.book.transactions.filter(t => t.type === 'check').length") == 1)
        await pg.click('[data-ev="%s"]' % tk); await pg.wait_for_selector('[data-testid=cal-pop] [data-done]'); await pg.check('[data-testid=cal-pop] [data-done]'); await pg.wait_for_timeout(400)
        check('CU-15 Filed / paid in the popover ticks the deadline', await ev("!!OB.cal.settings(OB.ui.book).done['%s']" % tk))
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(150)
        await pg.click('.cal-ev.cal-k-invoice'); await pg.click('[data-testid=cal-remind]'); await pg.wait_for_selector('.cal-rem-text')
        check('CU-16 invoice reminder has the amount and an email link', '$900.00' in await ev("document.querySelector('.cal-rem-text').value") and await ev("!!document.querySelector('.modal a[href^=\"mailto:ap@acme.example\"]')"))
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
        # 6. week grid: draw, move, resize, drop an all-day to-do into a time
        await pg.keyboard.press('w'); await pg.keyboard.press('t'); await pg.wait_for_selector('[data-col="%s"]' % D['t'])
        col = '[data-col="%s"]' % D['t']
        await ev("document.querySelector('.cal-scroll').scrollTop = 8 * 44"); await pg.wait_for_timeout(100)
        box = await pg.locator(col).bounding_box(); top = box['y']; x = box['x'] + box['width'] / 2
        y = lambda m: top + m / 60 * 44 + 2
        await pg.mouse.move(x, y(600)); await pg.mouse.down(); await pg.mouse.move(x, y(660), steps=4); await pg.mouse.move(x, y(680), steps=4); await pg.mouse.up(); await pg.wait_for_selector('[data-testid=cal-quick]')
        check('CU-17 dragging in the grid offers 10am – 11:30am', '10am – 11:30am' in await ev("document.querySelector('[data-testid=cal-quick]').innerText"), await ev("document.querySelector('[data-testid=cal-quick]').innerText"))
        await pg.keyboard.type('Client call'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(500)
        blk = '.cal-tev:has-text("Client call")'
        info = lambda: ev("(() => { const e = OB.cal.events(OB.ui.book, { from: OB.util.addDays(OB.util.today(), -7), to: OB.util.addDays(OB.util.today(), 14) }).find(e => e.title === 'Client call'); return e ? [e.date, e.time, e.dur] : null; })()")
        check('CU-18 the timed to-do sits in the grid', await info() == [D['t'], '10:00', 90], await info())
        bb = await pg.locator(blk).bounding_box()
        await drag((bb['x'] + bb['width'] / 2, bb['y'] + 8), (bb['x'] + bb['width'] / 2, bb['y'] + 8 + 44))
        check('CU-19 dragging the block an hour down makes it 11am', await info() == [D['t'], '11:00', 90], await info())
        bb = await pg.locator(blk).bounding_box()
        await drag((bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] - 3), (bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] - 3 + 22))
        check('CU-20 dragging the bottom edge makes it 2 hours', await info() == [D['t'], '11:00', 120], await info())
        await ev("OB.cal.saveTodo(OB.ui.book, { date: '%s', title: 'File receipts' }).then(() => OB.ui.render())" % D['t']); await pg.wait_for_timeout(300)
        await ev("document.querySelector('.cal-scroll').scrollTop = 8 * 44"); await pg.wait_for_timeout(100)
        box = await pg.locator(col).bounding_box()
        await drag(await center('[data-day="%s"] .cal-ev:has-text("File receipts")' % D['t']), (box['x'] + box['width'] / 2, box['y'] + 14 * 44 + 6))
        fr = await ev("OB.cal.events(OB.ui.book, { from: OB.util.today(), to: OB.util.today() }).find(e => e.title === 'File receipts')")
        check('CU-21 an all-day to-do dropped on 2pm gets that time', fr and fr['time'] == '14:00', fr)
        if SHOT: await pg.screenshot(path=os.path.join(SHOT, 'calendar-week.png'), full_page=True)
        # 7. agenda, .ics, reminders, shortcuts
        await pg.keyboard.press('a'); await pg.wait_for_selector('[data-testid=cal-agenda]')
        ag = await ev("document.querySelector('[data-testid=cal-agenda]').innerText")
        check('CU-22 agenda lists the bill, invoice and to-dos', all(s in ag for s in ['Pay Pine Street LLC', 'Acme Co pays invoice', 'Client call']), ag[:200])
        async with pg.expect_download() as dl: await pg.click('[data-testid=cal-ics]')
        ics = open(await (await dl.value).path()).read()
        check('CU-23 the .ics has the bill and the to-do', 'SUMMARY:Cal Test: Pay Pine Street LLC' in ics and 'Client call' in ics)
        await ev("(() => { const n = new Date(Date.now() + 5 * 60000), hh = String(n.getHours()).padStart(2, '0'), mm = String(n.getMinutes()).padStart(2, '0'); return OB.cal.saveTodo(OB.ui.book, { date: OB.util.today(), time: hh + ':' + mm, title: 'Call the bank', remind: 10 }); })()")
        await ev("OB.ui.calendarRemind()"); await pg.wait_for_timeout(300)
        check('CU-24 a to-do reminder fires before its time', 'Reminder: Call the bank' in await ev("document.getElementById('toasts').innerText"))
        await pg.keyboard.press('m'); await pg.wait_for_selector('[data-testid=cal-grid]')
        check('CU-25 M switches back to month; Calendar in the sidebar', await ev("!!document.querySelector('[data-testid=nav-calendar]')"))
        check('CU-26 no page errors', not errs, errs)
        print('\n%d passed, %d failed' % (passed, failed)); await ctx.close()
asyncio.run(main())

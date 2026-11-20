"""Developer tool, not needed to run the app.
Usage: npm install axe-core; AXE_JS=node_modules/axe-core/axe.min.js python a11y_audit.py /path/to/index.html
Accessibility + responsive audit: every page, light & dark, desktop & phone. Dev-only (axe-core from npm)."""
import asyncio, shutil, sys, json
from playwright.async_api import async_playwright
APP = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/ob/index.html'
import os
AXE = open(os.environ.get('AXE_JS', 'node_modules/axe-core/axe.min.js')).read()  # npm install axe-core
PAGES = ['#/gateway', '#/gateway?m=vouchers', '#/gateway?m=reports', '#/dashboard', '#/accounts', '#/customers', '#/vendors', '#/transactions', '#/txn/new?type=invoice', '#/txn/new?type=journal', '#/reports',
         '#/report/pnl?range=all&columns=year', '#/report/bs', '#/import', '#/reconcile', '#/rules', '#/recurring', '#/settings?tab=security', '#/settings?tab=backup', '#/snapshot', '#/snapshot?tab=payments', '#/snapshot?tab=customer', '#/migrate', '#/items', '#/report/openinv', '#/report/custlist']
async def main():
    shutil.rmtree(os.path.join(os.environ.get('TMP', '/tmp'), 'ob_a11y_profile'), ignore_errors=True)
    out = {}
    async with async_playwright() as p:
        for scheme in ['light', 'dark']:
            for vw in [(1366, 900), (390, 844)]:
                ctx = await p.chromium.launch_persistent_context(os.path.join(os.environ.get('TMP', '/tmp'), 'ob_a11y_profile'), viewport={'width': vw[0], 'height': vw[1]}, color_scheme=scheme)
                pg = ctx.pages[0]; errs = []
                pg.on('pageerror', lambda e: errs.append(str(e)))
                await pg.goto('file://' + APP)
                await pg.wait_for_selector('#newco, .dash, .gateway', timeout=20000)
                if await pg.query_selector('#newco'):
                    await pg.fill('#newco input[name=name]', 'Audit Co'); await pg.check('#newco input[name=sample]')
                    await pg.click('#newco button[type=submit]')
                try:
                    await pg.wait_for_selector('.dash, .gateway', timeout=20000)
                except Exception:
                    print('STUCK', scheme, vw, (await pg.inner_text('body'))[:300], errs); raise
                for h in PAGES:
                    await pg.evaluate("h => { location.hash = h }", h); await pg.wait_for_timeout(250)
                    await pg.add_script_tag(content=AXE)
                    res = await pg.evaluate("() => axe.run(document, { resultTypes: ['violations'] }).then(r => r.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, ex: v.nodes[0].target.join(' ') + ' :: ' + (v.nodes[0].failureSummary || '').split('\\n').slice(0,2).join(' ') })))")
                    # horizontal overflow of the page itself (responsive defect)
                    ov = await pg.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
                    key = f'{scheme}/{vw[0]}'
                    for v in res: out.setdefault(key, {}).setdefault(v['id'], {'impact': v['impact'], 'pages': [], 'ex': v['ex']})['pages'].append(h)
                    if ov > 2:
                        who = await pg.evaluate('''() => { const W = innerWidth, r = []; document.querySelectorAll('main *').forEach(el => { const b = el.getBoundingClientRect(); if (b.right > W + 2 && b.width > 0) { let p = el.parentElement, inner = false; while (p) { const ox = getComputedStyle(p).overflowX; if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') { inner = true; break; } p = p.parentElement; } if (!inner) r.push(el.tagName.toLowerCase() + '.' + [...el.classList].join('.') + ' ' + Math.round(b.right - W) + 'px'); } }); return r.slice(0, 4); }''')
                        out.setdefault(key, {}).setdefault('page-overflows-horizontally', {'impact': 'layout', 'pages': [], 'ex': ''})['pages'].append(f'{h} (+{ov}px) {who}')
                # transient UI: command bar with results, a dialog, and a toast
                for label, js in [('snapshot-gallery', "() => { location.hash = '#/snapshot'; }"), ('columns-menu', "() => { location.hash = '#/report/gl?range=all'; }"),
                                  ('leave-dialog', "() => { OB.ui.dirty = true; OB.ui.confirmLeave(() => {}); }"),
                                  ('palette', "() => { OB.ui.dirty = false; document.querySelectorAll('.modal-backdrop').forEach(m => m.remove()); location.hash = '#/dashboard'; }"), ('dialog', "() => OB.ui.newMenu()"), ('toast', "() => { OB.ui.toast('Invoice saved.'); OB.ui.toast('Something went wrong.', 'error'); }")]:
                    await pg.evaluate(js); await pg.wait_for_timeout(250)
                    if label == 'snapshot-gallery':
                        await pg.wait_for_timeout(300); await pg.click('#snap-add'); await pg.wait_for_selector('.gallery')
                    if label == 'columns-menu':
                        await pg.wait_for_timeout(300); await pg.click('[data-columns-for]'); await pg.wait_for_selector('.cols-pop')
                    if label == 'palette':
                        await pg.keyboard.press('Control+k'); await pg.wait_for_selector('#pal-q'); await pg.keyboard.type('harbor'); await pg.wait_for_timeout(200)
                    await pg.add_script_tag(content=AXE)
                    res = await pg.evaluate("() => axe.run(document, { resultTypes: ['violations'] }).then(r => r.violations.map(v => ({ id: v.id, impact: v.impact, ex: v.nodes[0].target.join(' ') + ' :: ' + (v.nodes[0].failureSummary || '').split('\\n').slice(0,2).join(' ') })))")
                    for v in res: out.setdefault(f'{scheme}/{vw[0]}', {}).setdefault(v['id'], {'impact': v['impact'], 'pages': [], 'ex': v['ex']})['pages'].append('[' + label + ']')
                    await pg.keyboard.press('Escape'); await pg.wait_for_timeout(150)
                if errs: out.setdefault(f'{scheme}/{vw[0]}', {})['JS errors'] = {'impact': 'error', 'pages': errs[:3], 'ex': ''}
                await ctx.close()
    total = 0
    for k, v in out.items():
        print('==', k)
        for rid, d in v.items():
            total += 1
            print(f"  [{d['impact']}] {rid}: {len(d['pages'])} pages e.g. {d['pages'][:3]}\n      {d['ex'][:220]}")
    print('TOTAL issue types:', total)
asyncio.run(main())

"""
VaultBook 1.33 Payroll from paystubs UI test (developer-only): side-menu group, first-use banner, standard payroll sub-accounts,
employer tax settings, a SCANNED paystub PDF read with the real offline OCR (tests/fixtures/paystub/sample-biweekly.pdf, made by
make_paystub_fixture.py: made-up people), every figure tied, bi-weekly detected, the journal entry balanced and posted, posted list,
re-reading the same stubs shows them as posted, a learned label, learning accounts from an earlier entry. Synthetic data only.
Usage: python3 payroll_ui.py /path/to/app/index.html
"""
import asyncio, os, sys, tempfile
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
APP = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(os.path.join(HERE, '..', '..', 'index.html'))
PDF = os.path.abspath(os.path.join(HERE, '..', 'fixtures', 'paystub', 'sample-biweekly.pdf'))
results = []
def check(cond, name, detail=''):
    results.append((bool(cond), name)); print(('  ok   ' if cond else '  FAIL ') + name + (('  [' + str(detail) + ']') if detail and not cond else ''))

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='vb_pr_'), viewport={'width': 1440, 'height': 900})
        pg = ctx.pages[0]; errors = []; pg.on('pageerror', lambda e: errors.append(str(e))); ev = pg.evaluate
        await pg.goto('file://' + APP); await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'Sample Clinic LLC'); await pg.click('#newco button[type=submit]'); await pg.wait_for_function('OB.ui.book'); await pg.wait_for_timeout(1200)
        go = lambda h: ev("h => location.hash = h", h)

        check(await pg.locator('[data-testid="nav-group-payroll"]').count() == 1 and await pg.locator('[data-testid=nav-payroll]').count() == 1 and await pg.locator('[data-testid=nav-payroll-settings]').count() == 1, 'Side menu has a Payroll group (Paystubs to journal, Payroll settings)')
        await go('#/payroll'); await pg.wait_for_selector('[data-testid=pr-drop]')
        check(await pg.locator('[data-testid=pr-setup]').count() == 1, 'First use: banner asks to check the payroll accounts')

        # settings: standard sub-accounts, employer taxes, save
        await pg.click('[data-testid=pr-tab-settings]'); await pg.wait_for_selector('[data-testid=pr-mkacc]')
        await pg.click('[data-testid=pr-mkacc]'); await pg.wait_for_function("[...document.querySelectorAll('[data-slot=net] option:checked')].some(o => /Net Pay Clearing/.test(o.textContent))", timeout=10000)
        names = await ev("OB.ui.book.accounts.map(a => a.name)")
        check(all(n in names for n in ['Salaries & Wages', 'Payroll Taxes', 'Federal Withholding', 'Social Security Payable', 'Medicare Payable', 'State Withholding', 'FUTA Payable', 'SUTA Payable', 'Net Pay Clearing']), 'Create standard payroll sub-accounts adds the nine accounts and selects them')
        check(await ev("OB.ui.book.accounts.find(a => a.name === 'Federal Withholding').parentId === OB.ui.book.accounts.find(a => /Payroll Liab/i.test(a.name) && !a.parentId).id"), 'Withholding accounts sit under Payroll Liabilities')
        await pg.fill('#pr-suta-r', '2.0'); await pg.fill('#pr-suta-b', '8000')
        # retirement and benefits go to the parent Payroll Liabilities
        liab = await ev("OB.ui.book.accounts.find(a => /Payroll Liab/i.test(a.name) && !a.parentId).id")
        await pg.select_option('[data-slot=retirement]', liab); await pg.select_option('[data-slot=benefits]', liab)
        await pg.click('[data-testid=pr-save]'); await pg.wait_for_selector('[data-testid=pr-drop]')
        saved = await ev("OB.ui.book.company.payroll")
        check(saved and saved['employer']['suta']['rate'] == '2.0' and saved['accounts']['retirement'] == liab, 'Settings saved on the company (SUTA 2.0% to 8,000; deductions to Payroll Liabilities)', saved)
        check(await pg.locator('[data-testid=pr-setup]').count() == 0, 'Banner gone after saving settings')

        # read the scanned stubs with the real OCR
        await pg.set_input_files('[data-testid=pr-file]', PDF)
        await pg.wait_for_selector('[data-testid=pr-log]', timeout=10000)
        check(True, 'Progress shows while reading')
        await pg.wait_for_function("document.querySelectorAll('[data-testid=pr-stub]').length >= 2 && !document.querySelector('[data-testid=pr-log]')", timeout=300000)
        files = await pg.inner_text('[data-testid=pr-files]')
        check('2 stubs (OCR)' in files, 'Scanned PDF: no text layer, read with OCR, two stubs', files)
        groups = await pg.locator('[data-testid=pr-group]').count()
        gtxt = await pg.inner_text('[data-testid=pr-group]')
        check(groups == 1 and 'bi-weekly' in gtxt and '2 employees' in gtxt, 'One pay date, both employees, bi-weekly from the period 10/03–10/16', gtxt[:200])
        checks = await pg.locator('[data-testid=pr-check]').all_inner_texts()
        check(len(checks) == 2 and all('✓' in c for c in checks), 'Every figure ties on both stubs (columns add to TOTALS, net = gross − taxes − deductions)', checks)
        names = await pg.eval_on_selector_all('.pr-name', 'e => e.map(x => x.value)')
        check(sorted(names) == ['Alex Morgan', 'Jordan Lee'], 'Employee names read', names)
        stubs = await ev("""(() => { const d = document.querySelectorAll('[data-testid=pr-stub]'); return [...d].map(s => ({ name: s.querySelector('.pr-name').value, net: s.querySelector('[data-net]').value,
            cats: [...s.querySelectorAll('[data-cat]')].map(x => x.value), amts: [...s.querySelectorAll('[data-amt]')].map(x => x.value) })); })()""")
        a = next(s for s in stubs if s['name'] == 'Alex Morgan')
        check(a['net'] == '2655.46', 'Alex Morgan net pay 2,655.46', a)
        check(a['cats'] == ['wages', 'subtotal', 'ee_medicare', 'ee_ss', 'fed', 'state', 'retirement', 'benefits'], 'Lines classified: Regular wages, Total Wages subtotal, MCWH, SSWH, FITW, SITW, 401K, HEALTH', a['cats'])
        check(a['amts'][:1] == ['3846.15'] and '523.00' in a['amts'] and '192.31' in a['amts'], 'Amounts read: wages 3,846.15, FITW 523.00, 401K 192.31', a['amts'])
        er = await ev("[...document.querySelectorAll('[data-testid=pr-stub]')].find(s => s.querySelector('.pr-name').value === 'Alex Morgan').querySelector('[data-er$=\"|er_medicare\"]').value")
        check(er == '55.77', 'Employer Medicare = 1.45% of gross (55.77)', er)
        suta = await ev("[...document.querySelectorAll('[data-testid=pr-stub]')].find(s => s.querySelector('.pr-name').value === 'Alex Morgan').querySelector('[data-er$=\"|suta\"]').value")
        check(suta == '0.00', 'SUTA is 0: YTD wages 80,769 are past the 8,000 base', suta)
        je = (await pg.inner_text('[data-testid=pr-je] tr.grand')).split()
        check(len(je) >= 3 and je[-1] == je[-2], 'Journal entry preview balances (debits = credits)', je)

        # other payroll documents are recognised and cross-checked
        FX = os.path.join(HERE, '..', 'fixtures', 'paystub')
        await pg.set_input_files('[data-testid=pr-file]', [os.path.join(FX, 'eftps-oct-2026.pdf'), os.path.join(FX, 'note.pdf')])
        await pg.wait_for_selector('[data-testid=pr-crosscheck]', timeout=60000); await pg.wait_for_function("!document.querySelector('[data-testid=pr-log]')", timeout=60000)
        cc = await pg.inner_text('[data-testid=pr-crosscheck]')
        check('Federal tax deposit (EFTPS)' in cc and 'Not used' in cc and '0 differ' in cc, 'Payroll documents recognised and cross-checked (EFTPS deposit agrees; a letter is not used)', cc[:300])
        check(await pg.locator('[data-testid=pr-stub]').count() == 2, 'Documents do not disturb the paystubs')

        # two pay dates (Jordan Lee moved to 10/30), one combined entry posted to the books
        check(await pg.locator('[data-testid=pr-bar]').count() == 1 and 'Post entry to the books' in await pg.inner_text('[data-testid=pr-bar]'), 'Action bar: post to the books and download .iif')
        await pg.fill('[data-testid=pr-stub]:nth-of-type(2) .pr-date', '2026-10-30'); await pg.evaluate("document.activeElement.blur()")
        await pg.wait_for_function("document.querySelectorAll('[data-testid=pr-group]').length === 2")
        check('Post 2 entries to the books' in await pg.inner_text('[data-testid=pr-bar]'), 'Two pay dates: two entries by default')
        await pg.select_option('[data-testid=pr-merge]', '1'); await pg.wait_for_selector('[data-testid=pr-combined]')
        check('2 pay dates' in await pg.inner_text('[data-testid=pr-combined]') and 'Post combined entry to the books' in await pg.inner_text('[data-testid=pr-bar]'), 'Combined entry preview; button posts it')
        await pg.click('[data-testid=pr-postall]'); await pg.wait_for_function("document.body.innerText.includes('Posted PR-2026-10-30')", timeout=15000)
        check(await ev("OB.ui.book.transactions.filter(x => x.type === 'journal' && /^Paystub payroll/.test(x.importRef || '')).length") == 1, 'One combined journal entry in the books')
        check(await pg.locator('[data-testid=pr-post]').count() == 0 and (await pg.inner_text('#main')).count('Posted PR-2026-10-30') == 2, 'Both pay dates show as posted by the combined entry')
        # .iif for QuickBooks: still available after posting here (VaultBook's books are not QuickBooks)
        async with pg.expect_download() as dd:
            await pg.click('[data-testid=pr-iif]')
        dl = await dd.value; raw = open(await dl.path(), 'rb').read(); rows = [r.split(b'\t') for r in raw.split(b'\r\n') if r]
        acc = [r[1].decode() for r in rows if r[0] == b'ACCNT']; tx = [r for r in rows if r[0] in (b'TRNS', b'SPL')]
        check(dl.suggested_filename.endswith('_Payroll_2026-10-16_to_2026-10-30_combined.iif'), '.iif named for the pay dates, combined', dl.suggested_filename)
        check(acc.index('Payroll Liabilities') < acc.index('Payroll Liabilities:Federal Withholding') and 'Payroll Expenses:Salaries & Wages' in acc, '.iif creates VaultBook\'s accounts in QuickBooks, parents first', acc)
        check(sum(1 for r in rows if r[0] == b'TRNS') == 1 and sum(round(float(r[6]) * 100) for r in tx) == 0 and tx[0][7] == b'PR103026', '.iif: one balanced combined General Journal, number PR103026')
        await pg.uncheck('[data-testid=pr-iif-create]'); await pg.select_option('[data-testid=pr-merge]', '')
        async with pg.expect_download() as dd2:
            await pg.click('[data-testid=pr-iif]')
        raw2 = open(await (await dd2.value).path(), 'rb').read()
        check(b'!ACCNT' not in raw2 and raw2.count(b'\r\nTRNS\t') == 2, '.iif without account rows, one entry per pay date')
        t = await ev("""(() => { const t = OB.ui.book.transactions.find(x => x.type === 'journal' && x.number === 'PR-2026-10-30'); if (!t) return null;
            const d = t.jlines.reduce((s, l) => s + (l.debit || 0), 0), c = t.jlines.reduce((s, l) => s + (l.credit || 0), 0); return { d, c, date: t.date, ref: t.importRef, memo: t.memo, n: t.jlines.length,
            net: t.jlines.filter(l => /Net pay/.test(l.memo)).reduce((s, l) => s + l.credit, 0), wages: t.jlines.filter(l => /Gross wages/.test(l.memo)).reduce((s, l) => s + l.debit, 0) }; })()""")
        check(t and t['d'] == t['c'] and t['date'] == '2026-10-30', 'Combined entry PR-2026-10-30 is balanced and dated the last pay date', t)
        check(t and t['wages'] == 384615 + 250000, 'Wages debit = both gross wages (6,346.15)', t)
        alex_net, jordan_net = 265546, 250000 - (3625 + 15500 + 27500 + 6250) - 8500
        check(t and t['net'] == alex_net + jordan_net, 'Net pay credit = both nets', t)
        check(t and t['ref'].startswith('Paystub payroll 2026-10-16, 2026-10-30') and 'bi-weekly' in t['memo'] and '2 pay dates' in t['memo'], 'Memo names the frequency and pay dates; importRef lists both', t)
        await pg.click('[data-testid=pr-tab-posted]'); await pg.wait_for_selector('[data-testid=pr-posted]')
        check('PR-2026-10-30' in await pg.inner_text('[data-testid=pr-posted]'), 'Posted entries tab lists it')

        # re-reading the same stubs: shown as already posted, no second entry possible
        await pg.click('[data-testid=pr-tab-stubs]'); await pg.wait_for_selector('[data-testid=pr-drop]')
        check(await pg.locator('[data-testid=pr-post]').count() == 0 and 'Posted PR-2026-10-30' in await pg.inner_text('[data-testid=pr-group]') and await pg.is_disabled('[data-testid=pr-postall]'), 'Pay dates show as posted; nothing left to post')

        # a learned label (choose once, remembered for the company)
        learned = await ev("""(async () => { const b = OB.ui.book, S = OB.paystub.settings(b); S.labels[OB.paystub.canon('HEALTH')] = 'otherDed'; await b.savePayroll(S);
            return OB.paystub.classify('HEALTH', 'ded', OB.paystub.settings(b).labels); })()""")
        check(learned == 'otherDed', 'A label chosen once is remembered for this company and wins over the built-in reading', learned)
        await go('#/payroll?tab=settings'); await pg.wait_for_selector('[data-testid=pr-labels]')
        check('Other deduction' in await pg.inner_text('[data-testid=pr-labels]'), 'Settings lists the learned label with Forget')

        # learn accounts from an earlier entry
        await ev("""(async () => { const b = OB.ui.book, S = OB.paystub.settings(b); Object.keys(S.accounts).forEach(k => S.accounts[k] = ''); await b.savePayroll(S); })()""")
        await go('#/payroll?tab=stubs'); await go('#/payroll?tab=settings'); await pg.wait_for_selector('[data-testid=pr-learn]')
        await pg.click('[data-testid=pr-learn-go]'); await pg.wait_for_timeout(400)
        got = await ev("({ fed: document.querySelector('[data-slot=fed] option:checked').textContent, net: document.querySelector('[data-slot=net] option:checked').textContent, wages: document.querySelector('[data-slot=wages] option:checked').textContent })")
        check('Federal Withholding' in got['fed'] and 'Net Pay Clearing' in got['net'] and 'Salaries' in got['wages'], 'Learn from an earlier payroll entry picks its accounts', got)

        check(not errors, 'No page errors', errors)
        await ctx.close()
    bad = [n for ok, n in results if not ok]
    print(f"\n{len(results) - len(bad)}/{len(results)} passed"); sys.exit(1 if bad else 0)

asyncio.run(main())

"""VaultBook 1.49.0 — Doc Center: add files to the inbox (a PDF read for its total), match and attach, sure matches in
bulk, missing documents, clean up, the CPA package zip, Close the books line. Synthetic names. Run: python3 tests/dev/docs_ui.py [shots]"""
import asyncio, os, sys, tempfile, zipfile, io
from playwright.async_api import async_playwright
from reportlab.pdfgen import canvas
from PIL import Image
APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'index.html')
SHOT = sys.argv[1] if len(sys.argv) > 1 else ''
D = tempfile.mkdtemp()
def pdf(name, lines):
    c = canvas.Canvas(os.path.join(D, name)); y = 760
    for l in lines: c.drawString(72, y, l); y -= 18
    c.save(); return os.path.join(D, name)
def png(name, color):
    p = os.path.join(D, name); Image.new('RGB', (40, 30), color).save(p); return p
F = [pdf('scan0001.pdf', ['OFFICE MART #221', 'Invoice Date: 03/05/2024', 'Paper 10.00', 'Subtotal 41.69', 'Tax 3.41', 'TOTAL $45.10']),
     png('Pine Street LLC 1500.00 2024-03-01.png', 'red'), png('Pine Street LLC 1500.00 2024-03-01 copy.png', 'red'), png('IMG_4412.png', 'blue')]
passed = failed = 0
def check(name, ok, extra=''):
    global passed, failed
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok else '  ' + str(extra))); passed += ok; failed += not ok
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(), viewport={'width': 1440, 'height': 900}, accept_downloads=True)
        pg = ctx.pages[0]; ev = pg.evaluate; errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://' + APP); await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'Docs Test'); await pg.click('#newco button[type=submit]')
        await pg.wait_for_function("OB.ui.book && OB.ui.book.company.name === 'Docs Test'", timeout=30000)
        await ev("""(async () => { const b = OB.ui.book, chk = b.accounts.find(a => a.name === 'Checking'), exp = b.accounts.find(a => a.type === 'expense');
          const om = await b.saveContact({ name: 'Office Mart', kind: 'vendor' }), ps = await b.saveContact({ name: 'Pine Street LLC', kind: 'vendor' });
          const ck = (d, c, a, n) => b.saveTransaction({ type: 'check', date: d, number: n || '', accountId: chk.id, contactId: c.id, lines: [{ accountId: exp.id, amount: a }] });
          await ck('2024-03-05', om, '45.10'); await ck('2024-03-01', ps, '1500.00', '1001'); await ck('2024-04-01', ps, '1500.00', '1002'); await ck('2024-03-20', om, '300.00'); })()""")
        await ev("location.hash = '#/docs'"); await pg.wait_for_selector('[data-testid=dc-add]')
        await pg.set_input_files('#dc-file', F); await pg.wait_for_selector('[data-testid=dc-inbox]', timeout=20000); await pg.wait_for_timeout(800)
        await ev("OB.ui.render()"); await pg.wait_for_timeout(300)
        n = await ev("document.querySelectorAll('[data-testid=dc-inbox] tr[data-doc]').length")
        check('DU-01 four files wait in the inbox', n == 4, n)
        info = await ev("OB.docs.inbox(OB.ui.book).map(a => [a.name, a.info.date, a.info.amount, a.info.vendorId ? OB.ui.book.contactById[a.info.vendorId].name : ''])")
        check('DU-02 the PDF text gave the total, date and vendor', ['scan0001.pdf', '2024-03-05', 4510, 'Office Mart'] in info, info)
        check('DU-03 the file name gave the rent receipt\'s details', ['Pine Street LLC 1500.00 2024-03-01.png', '2024-03-01', 150000, 'Pine Street LLC'] in info, info)
        if SHOT: await pg.screenshot(path=os.path.join(SHOT, 'docs-inbox.png'), full_page=True)
        sure = await ev("(document.querySelector('[data-testid=dc-sure]') || {}).innerText")
        check('DU-04 two sure matches offered (receipt and rent; the copy of the rent receipt is not)', sure == 'Attach 2 sure matches', sure)
        await pg.click('[data-testid=dc-sure]'); await pg.wait_for_timeout(500)
        got = await ev("OB.ui.book.attachments.filter(a => a.ownerId).map(a => [a.name, OB.ui.book.txById[a.ownerId].number || OB.ui.book.txById[a.ownerId].date])")
        check('DU-05 attached to the 03/05 check and check 1001', sorted(got) == sorted([['scan0001.pdf', '2024-03-05'], ['Pine Street LLC 1500.00 2024-03-01.png', '1001']]), got)
        check('DU-04b the copy stays in the inbox marked as the same file', 'Same file as Pine Street LLC 1500.00 2024-03-01.png (attached)' in await ev("document.querySelector('[data-testid=dc-inbox]').innerText"))
        row = 'tr[data-doc]:has(a:text("IMG_4412.png"))'
        await pg.fill(row + ' [data-info=amount]', '300'); await pg.press(row + ' [data-info=amount]', 'Tab'); await pg.wait_for_timeout(400)
        opt = await ev("(() => { const tr = [...document.querySelectorAll('tr[data-doc]')].find(t => t.innerText.includes('IMG_4412')); const s = tr && tr.querySelector('[data-pick]'); return s ? s.selectedOptions[0].text : ''; })()")
        check('DU-06 typing the amount finds the $300 check', '300.00' in opt and 'Office Mart' in opt, opt)
        await pg.click(row + ' [data-testid=dc-attach]'); await pg.wait_for_timeout(400)
        await ev("location.hash = '#/docs?tab=missing&from=2024-01-01&to=2024-12-31'"); await pg.wait_for_selector('[data-testid=dc-missing]')
        miss = await ev("[...document.querySelectorAll('[data-testid=dc-missing] tbody tr')].map(r => r.innerText.split('\\t')[1])")
        check('DU-07 missing documents: only check 1002', miss == ['Check 1002'], miss)
        await pg.set_input_files('[data-testid=dc-missing] input[data-direct]', F[2]); await pg.wait_for_timeout(500)
        check('DU-08 attaching from the missing list empties it', not await ev("!!document.querySelector('[data-testid=dc-missing]')"))
        await ev("OB.ui.book.addAttachment({ ownerId: OB.ui.book.transactions.find(t => t.number === '1001').id, name: 'again.png', dataUrl: OB.ui.book.attachments.find(a => a.name.startsWith('Pine Street LLC 1500.00 2024-03-01.png')).data })")
        await ev("location.hash = '#/docs?tab=clean'"); await pg.wait_for_timeout(400)
        check('DU-09 clean up finds the same file twice', 'again.png' in await ev("document.querySelector('[data-clean=dupes]').closest('section').innerText"))
        await pg.click('[data-clean=dupes]'); await pg.click('.modal .btn.danger, .modal button.danger'); await pg.wait_for_timeout(500)
        check('DU-10 removing it keeps the first copy and logs it', await ev("OB.ui.book.attachments.filter(a => !a.deleted && a.ownerId === OB.ui.book.transactions.find(t => t.number === '1001').id).length") == 1 and await ev("OB.ui.book.audit.some(e => /Removed attachment again.png/.test(e.summary))"))
        await ev("location.hash = '#/docs?tab=package&from=2024-03-01&to=2024-03-31'"); await pg.wait_for_selector('[data-testid=dc-zip]')
        async with pg.expect_download() as dl: await pg.click('[data-testid=dc-zip]')
        z = zipfile.ZipFile(io.BytesIO(open(await (await dl.value).path(), 'rb').read()))
        names = z.namelist()
        check('DU-11 the zip has the March documents by date, vendor and amount, and Index.csv', names == ['2024-03-01 - Pine Street LLC - 1500.00 - Check 1001.png', '2024-03-05 - Office Mart - 45.10 - Check.pdf', '2024-03-20 - Office Mart - 300.00 - Check.png', 'Index.csv'] and z.read(names[1])[:4] == b'%PDF', names)
        await ev("location.hash = '#/docs?tab=all'"); await pg.wait_for_selector('[data-testid=dc-all]')
        if SHOT: await pg.screenshot(path=os.path.join(SHOT, 'docs-all.png'), full_page=True)
        check('DU-12 all documents lists 5 (one still in the inbox) with what each is attached to', await ev("document.querySelectorAll('[data-testid=dc-all] tbody tr').length") == 5)
        check('DU-13 Doc Center is in the sidebar', await ev("!!document.querySelector('[data-testid=nav-docs]')"))
        check('DU-14 no page errors', not errs, errs)
        print('\n%d passed, %d failed' % (passed, failed)); await ctx.close()
asyncio.run(main())

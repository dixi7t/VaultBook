"""Update QuickBooks page with a stand-in for the connector's link (same port, code and protocol as VaultBook-QB.ps1 RunLink).
python3 tests/dev/qbupdate_ui.py /abs/path/app/index.html"""
import asyncio, sys, tempfile, json, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from playwright.async_api import async_playwright
APP = sys.argv[1]; res = []; CODE = '482915'; seen = {'apply': None, 'origins': set()}
def check(ok, msg, info=''):
    res.append(ok); print(('  ok   ' if ok else '  FAIL ') + msg + ('' if ok else '  -> ' + str(info)))
R = lambda n: {'FullName': n}
FULL = {'format': 'vaultbook-qb-full', 'version': 1, 'at': '2026-11-18T21:57:52.000Z', 'from': '', 'to': '2026-11-18', 'company': {'CompanyName': 'Corner Candy LLC'},
  'lists': {'Account': [{'FullName': 'Main Bank', 'Name': 'Main Bank', 'AccountType': 'Bank'}, {'FullName': 'Sales', 'Name': 'Sales', 'AccountType': 'Income'},
    {'FullName': 'Ask My Accountant', 'Name': 'Ask My Accountant', 'AccountType': 'OtherExpense'}, {'FullName': 'Utilities', 'Name': 'Utilities', 'AccountType': 'Expense'}],
    'Vendor': [{'Name': 'PSEG'}], 'Customer': [], 'Employee': [], 'OtherName': [], 'Item': [], 'Class': [], 'StandardTerms': []},
  'txns': {'Check': [{'TxnID': 'C-1', 'EditSequence': '111', 'TxnDate': '2025-03-05', 'AccountRef': R('Main Bank'), 'PayeeEntityRef': R('PSEG'), 'Amount': '120.00', 'Memo': 'PSEG bill',
      'ExpenseLineRet': {'TxnLineID': 'C-1-L1', 'AccountRef': R('Ask My Accountant'), 'Amount': '120.00'}}],
    'Deposit': [{'TxnID': 'D-1', 'EditSequence': '555', 'TxnDate': '2025-03-10', 'DepositToAccountRef': R('Main Bank'), 'DepositTotal': '900.00', 'Memo': 'Mobile deposit',
      'DepositLineRet': {'TxnLineID': 'D-1-L1', 'AccountRef': R('Sales'), 'Amount': '900.00', 'Memo': 'Mobile deposit'}}], 'JournalEntry': []}}
state = {'full': FULL}
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def reply(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code)
        for k, v in [('Content-Type', 'application/json; charset=utf-8'), ('Content-Length', str(len(b))), ('Access-Control-Allow-Origin', '*'), ('Access-Control-Allow-Private-Network', 'true')]: self.send_header(k, v)
        self.end_headers(); self.wfile.write(b)
    def do_OPTIONS(self): self.reply(204, {})
    def do_GET(self):
        seen['origins'].add(self.headers.get('Origin'))
        if self.headers.get('Host') != '127.0.0.1:47321': return self.reply(403, {'ok': False, 'error': 'wrong host'})
        if self.path == '/hello': return self.reply(200, {'ok': True, 'app': 'VaultBook QuickBooks'})
        self.reply(404, {'ok': False})
    def do_POST(self):
        seen['origins'].add(self.headers.get('Origin'))
        j = json.loads(self.rfile.read(int(self.headers['Content-Length'])).decode('utf-8'))
        if j.get('code') != CODE: return self.reply(403, {'ok': False, 'error': 'wrong link code'})
        if j['action'] == 'export': return self.reply(200, state['full'])
        b = json.loads(j['batchText']); seen['apply'] = b
        items = [{'key': u['key'], 'kind': 'update', 'label': 'Edit ' + u['label'], 'status': 'Updated', 'txnId': u['txnId'], 'details': '; '.join(u['what'])} for u in b['updates']]
        # QuickBooks now matches: the next export carries the new account
        for u in b['updates']:
            for c in state['full']['txns']['Check']:
                if c['TxnID'] == u['txnId']: c['ExpenseLineRet']['AccountRef'] = R(u['lines'][0]['account']); c['EditSequence'] = '112'
        self.reply(200, {'format': 'vaultbook-qb-result', 'version': 3, 'items': items})
srv = HTTPServer(('127.0.0.1', 47321), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
SETUP = """(async (full) => {
  const b = await OB.db.createCompany({ name: 'Corner Candy LLC' }), p = OB.qbimport.plan(OB.qbimport.read([{ name: 'f.json', text: JSON.stringify(full) }]), b, {});
  await b.importBundle(p.bundle);
  const t = b.transactions.find((x) => /TxnID C-1/.test(x.importRef || '')), r = b.reclassRows({}).find((x) => x.txnId === t.id && x.ref.part === 'line');
  await b.reclassify([r.key], { accountId: b.accounts.find((a) => a.name === 'Utilities').id }, 'client says utilities');
  await OB.ui.openCompany(b.company.id); })"""
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(), viewport={'width': 1400, 'height': 900}, accept_downloads=True)
        pg = ctx.pages[0]; ev = pg.evaluate; errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://' + APP); await pg.wait_for_selector('#newco')
        await ev(SETUP + '(' + json.dumps(FULL) + ')'); await pg.wait_for_function("OB.ui.book && OB.ui.book.company.name === 'Corner Candy LLC'", timeout=30000)
        check(await pg.locator('[data-testid=nav-qbd-update]').count() == 1, 'Update QuickBooks is in the side menu')
        await ev("location.hash = '#/qbd/update'"); await pg.wait_for_selector('[data-testid=qu-step1]')
        check(await pg.locator('[data-testid=qu-open]').get_attribute('href') == 'vaultbook-qb://link', 'Open the QuickBooks tool uses the installed link')
        await pg.fill('[data-testid=qu-code]', '111111'); await pg.click('[data-testid=qu-get]'); await pg.wait_for_timeout(800)
        t = await ev("document.querySelector('[data-testid=qu-step1]').innerText")
        check('wrong link code' in t, 'A wrong link code is refused by the tool', t[-200:])
        await pg.fill('[data-testid=qu-code]', CODE); await pg.click('[data-testid=qu-get]'); await pg.wait_for_timeout(1500)
        check(await pg.locator('[data-testid=qu-linked]').count() == 1, 'Connected to the tool from a page opened as a file (127.0.0.1)')
        check(await ev("document.querySelector('[data-testid=qu-n-edits]').innerText") == '1' and await ev("document.querySelector('[data-testid=qu-n-voids]').innerText") == '0', 'One edit: the reclassified check')
        tt = await ev("document.querySelector('[data-testid=qu-table]').innerText")
        check('Ask My Accountant -> Utilities' in tt, 'The list says what changes', tt)
        async with pg.expect_download() as d: await pg.click('[data-testid=qu-dl]')
        f = await (await d.value).path(); txt = open(f, encoding='utf-8').read(); bt = json.loads(txt)
        check(bt['version'] == 3 and bt['updates'][0]['editSeq'] == '111' and bt['updates'][0]['lines'][0]['lineId'] == 'C-1-L1' and all(ord(c) < 128 for c in txt), 'The update file: version 3, EditSequence and line id, plain ASCII')
        await pg.click('[data-testid=qu-send]'); await pg.wait_for_selector('[data-testid=qu-result]', timeout=8000)
        check(seen['apply'] and seen['apply']['updates'][0]['txnId'] == 'C-1', 'The tool received the edits', seen['apply'])
        check(await ev("document.querySelector('[data-testid=qu-r-upd]').innerText") == '1', 'The result comes back: 1 changed')
        await pg.click('[data-testid=qu-get]'); await pg.wait_for_selector('[data-testid=qu-nothing]', timeout=8000)
        check(True, 'A fresh export afterwards: QuickBooks already matches VaultBook')
        # the file way
        state['full'] = json.loads(json.dumps(FULL)); state['full']['txns']['Check'][0]['ExpenseLineRet']['AccountRef'] = R('Ask My Accountant')
        p2 = tempfile.mktemp(suffix='.json'); open(p2, 'w').write(json.dumps(state['full']))
        await pg.set_input_files('[data-testid=qu-file]', p2); await pg.wait_for_timeout(500)
        check(await ev("document.querySelector('[data-testid=qu-n-edits]').innerText") == '1' and 'qu-source' and '.json' in await ev("document.querySelector('[data-testid=qu-source]').innerText"), 'A loaded export file gives the same comparison')
        await ev("location.hash = '#/qbd'"); await pg.wait_for_selector('[data-testid=qbd-update]')
        check(True, 'The QuickBooks Desktop overview has step 5 Update QuickBooks')
        print('     origins seen by the tool:', seen['origins'])
        check(not errs, 'No page errors', errs)
        await ctx.close()
    srv.shutdown()
    print('\n%d passed, %d failed' % (res.count(True), res.count(False))); sys.exit(0 if all(res) else 1)
asyncio.run(main())

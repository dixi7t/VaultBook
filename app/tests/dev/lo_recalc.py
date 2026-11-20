"""
Developer-only: recalculate .xlsx workbooks in LibreOffice (headless, through UNO) and save the results.
LibreOffice does NOT recalculate Excel files on load by default (it keeps the cached values), so a plain
`soffice --convert-to` proves nothing about formulas. This script loads each file, calls calculateAll(),
and stores a recalculated copy, optionally after setting cells first.

Usage (Python with LibreOffice's uno module, e.g. /usr/bin/python3 on Debian/Ubuntu):
  python3 lo_recalc.py in.xlsx out.xlsx [Sheet!A1=value ...]
Values that look like YYYY-MM-DD are entered as dates.
As a module: recalc(src, dst, sets={('Dashboard', 'C6'): '2025-04-01'})
"""
import os, subprocess, sys, time, tempfile, uno
from com.sun.star.beans import PropertyValue

def _prop(name, value):
    p = PropertyValue(); p.Name = name; p.Value = value; return p

_office = None
def _desktop():
    global _office
    if _office is None:
        port = 2002 + os.getpid() % 1000
        prof = tempfile.mkdtemp(prefix='lo_prof_')
        proc = subprocess.Popen(['soffice', '--headless', '--invisible', '--nologo', '--norestore', '-env:UserInstallation=file://' + prof,
                                 '--accept=socket,host=127.0.0.1,port=%d;urp;' % port], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        local = uno.getComponentContext()
        resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
        for _ in range(120):
            try:
                ctx = resolver.resolve('uno:socket,host=127.0.0.1,port=%d;urp;StarOffice.ComponentContext' % port); break
            except Exception:
                time.sleep(0.5)
        else:
            raise RuntimeError('LibreOffice did not start')
        _office = (proc, ctx.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', ctx))
    return _office[1]

def recalc(src, dst, sets=None):
    desk = _desktop()
    doc = desk.loadComponentFromURL(uno.systemPathToFileUrl(os.path.abspath(src)), '_blank', 0, (_prop('Hidden', True),))
    try:
        for (sheet, ref), val in (sets or {}).items():
            cell = doc.Sheets.getByName(sheet).getCellRangeByName(ref)
            if isinstance(val, str) and len(val) == 10 and val[4] == '-' and val[7] == '-':
                cell.setFormula('=DATE(%d;%d;%d)' % (int(val[:4]), int(val[5:7]), int(val[8:])))
                cell.setValue(cell.getValue())  # keep a plain date value, like a user typing it
            elif isinstance(val, (int, float)):
                cell.setValue(val)
            else:
                cell.setString(val)
        doc.calculateAll()
        doc.storeToURL(uno.systemPathToFileUrl(os.path.abspath(dst)), (_prop('FilterName', 'Calc MS Excel 2007 XML'),))
    finally:
        doc.close(True)

def shutdown():
    global _office
    if _office:
        try: _office[1].terminate()
        except Exception: pass
        _office[0].wait(timeout=30); _office = None

if __name__ == '__main__':
    sets = {}
    for a in sys.argv[3:]:
        k, v = a.split('=', 1); sh, ref = k.rsplit('!', 1); sets[(sh.strip("'"), ref)] = v
    recalc(sys.argv[1], sys.argv[2], sets)
    shutdown()

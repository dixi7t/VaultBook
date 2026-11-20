"""Builds the standalone Paystub to QuickBooks IIF tool: one offline .html file with VaultBook's paystub engine, the PDF reader
and the OCR engine inlined (about 11 MB, almost all of it the OCR engine and its English language data).
Usage: python3 build.py [out.html]   (default: PaystubToIIF.html next to this script)"""
import os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__)); APP = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'PaystubToIIF.html')
src = open(os.path.join(HERE, 'PaystubToIIF.src.html'), encoding='utf-8').read()
def inline(m):
    js = open(os.path.join(APP, m.group(1)), encoding='utf-8').read()
    assert '</script' not in js.lower(), m.group(1)   # would end the inline script early
    return '<script>\n' + js + '\n</script>'
html = re.sub(r'<!--INLINE:([^>]+)-->', inline, src)
open(OUT, 'w', encoding='utf-8').write(html)
print(OUT, round(len(html.encode('utf-8')) / 1e6, 1), 'MB')

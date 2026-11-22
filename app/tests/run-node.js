/* global OB */
/* Developer test runner: node tests/run-node.js  (the app itself needs no Node.js) */
var path = require('path');
['util', 'schema', 'crypto', 'ledger', 'reports', 'statements', 'backup', 'xlsx', 'pdf', 'report-model', 'invoice-layout', 'designer', 'workbook', 'importer', 'sample', 'qbimport', 'paste', 'qbexport', 'business', 'inventory', 'projects', 'doccenter', 'calendar', 'sales', 'taxreports', 'bankfeed', 'bankplus', 'registers', 'reclass', 'find', 'recon-report', 'paydays', 'qbsend', 'qbsync', 'qbfull', 'paystub', 'paydocs', 'intel', 'merchants', 'hints', 'close', 'qbupdate', 'secrets', 'simplefin'].forEach(function (f) { require(path.join(__dirname, '..', 'js', f + '.js')); });
require('./engine.tests.js');
require('./cpa.tests.js');
require('./bankfeed.tests.js');
require('./secrets.tests.js');
require('./simplefin.tests.js');
require('./tally.tests.js');
require('./bankplus.tests.js');
require('./qbo.tests.js');
require('./studio.tests.js');
require('./find.tests.js');
require('./mis.tests.js');
require('./qbsend.tests.js');
require('./qbsync.tests.js');
require('./qbfull.tests.js');
require('./paystub.tests.js');
require('./paydocs.tests.js');
require('./intel.tests.js');
require('./hints.tests.js');
require('./close.tests.js');
require('./qbupdate.tests.js');
require('./sheets.tests.js');
require('./paste.tests.js');
require('./docs.tests.js');
require('./calendar.tests.js');
var pass = 0, fail = 0;
OB.runTests(function (r) {
  if (r.ok) { pass++; console.log('  ok   ' + r.name + ' (' + r.ms + 'ms)' + (r.info ? ' — ' + r.info : '')); }
  else { fail++; console.log('  FAIL ' + r.name + '\n       ' + r.error.split('\n').slice(0, 3).join('\n       ')); }
}).then(function () { console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); });

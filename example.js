/* Cleans one synthetic fixture and prints the report and the cleaned CSV to stdout.
   Run: node example.js
   Reads only fixtures/paypal-activity.csv; writes no files. */
'use strict';

var fs = require('fs');
var path = require('path');
var C = require('./cleaner.js');

var text = fs.readFileSync(path.join(__dirname, 'fixtures', 'paypal-activity.csv'), 'utf8');
var res = C.clean(text, {});

if (!res.ok) {
  console.log('Could not clean the file: ' + res.error);
  process.exit(1);
}

console.log('Input format: ' + res.profileLabel);
console.log('Delimiter: ' + C.DELIMITER_LABELS[res.delimiter] + ', decimal style: ' + res.decimalStyle);
console.log('Rows in: ' + res.counts.rowsIn + ', rows out: ' + res.counts.rowsOut +
  ', duplicates dropped: ' + res.counts.duplicatesDropped + ', footer lines: ' + res.counts.footer +
  ', not parsed: ' + res.counts.unparsed);
res.duplicates.forEach(function (d) {
  console.log('Duplicate: line ' + d.line + ' repeats line ' + d.firstLine);
});
res.unparsed.forEach(function (u) {
  console.log('Not parsed: line ' + u.line + ' (' + u.reason + ')');
});
res.warnings.forEach(function (w) { console.log('Warning: ' + w); });
console.log('');
process.stdout.write(C.buildCsv(res.rows));

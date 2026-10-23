'use strict';
/**
 * Zero-dependency test runner.
 *
 * The Linux and macOS adapters cannot be executed on a Windows dev box, so their
 * parsers are written as pure functions over file contents and exercised here
 * against fixture trees. That is the only way `npm test` can prove those code
 * paths work before a user on those platforms runs them.
 */
const path = require('path');

const FILES = ['linux', 'darwin', 'model', 'power'];

let pass = 0;
let fail = 0;
const failures = [];

for (const f of FILES) {
  let suite;
  try {
    suite = require(path.join(__dirname, `${f}.test.js`));
  } catch (e) {
    fail++;
    failures.push(`${f}: failed to load — ${e.message}`);
    console.log(`\n\x1b[1m${f}\x1b[0m`);
    console.log(`  \x1b[31m✗ suite failed to load: ${e.message}\x1b[0m`);
    continue;
  }
  console.log(`\n\x1b[1m${suite.name}\x1b[0m`);
  for (const [name, fn] of suite.tests) {
    try {
      fn();
      pass++;
      console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    } catch (e) {
      fail++;
      failures.push(`${suite.name} › ${name}\n    ${e.message}`);
      console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    }
  }
}

console.log('');
if (fail) {
  console.log(`\x1b[31m${fail} failed\x1b[0m, ${pass} passed`);
  for (const f of failures) console.log(`\n  ${f}`);
  process.exit(1);
}
console.log(`\x1b[32m${pass} passed\x1b[0m`);

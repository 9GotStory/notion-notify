'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function dateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZone === 'UTC' ? 'UTC' : timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(date));
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function formatDate(date, timeZone, format) {
  const p = dateParts(date, timeZone);
  const replacements = {
    yyyy: p.year,
    yy: p.year.slice(-2),
    MM: p.month,
    dd: p.day,
    HH: p.hour,
    mm: p.minute,
    ss: p.second,
  };
  return format.replace(/yyyy|yy|MM|dd|HH|mm|ss/g, token => replacements[token]);
}

const scriptProperties = new Map();
const context = vm.createContext({
  console,
  Intl,
  Set,
  Map,
  Utilities: { formatDate },
  PropertiesService: {
    getScriptProperties() {
      return { getProperty: name => scriptProperties.get(name) || null };
    },
  },
});

const sourceDir = path.resolve(__dirname, '../apps/main');
fs.readdirSync(sourceDir)
  .filter(name => name.endsWith('.gs'))
  .sort()
  .forEach(name => {
    const source = fs.readFileSync(path.join(sourceDir, name), 'utf8');
    vm.runInContext(source, context, { filename: name });
  });

const result = vm.runInContext('runUnitTests()', context);
if (!result || result.failed !== 0) process.exitCode = 1;

scriptProperties.set('ALLOW_LEGACY_DIRECT', 'TRUE');
const directRequest = vm.runInContext("unwrapGatewayEnvelope_({ apiAction: 'session' })", context);
if (!directRequest || directRequest.apiAction !== 'session') {
  console.error('FAIL testDirectModeBoundary: explicit direct mode did not pass through the request');
  process.exitCode = 1;
} else {
  scriptProperties.delete('ALLOW_LEGACY_DIRECT');
  let rejected = false;
  try {
    vm.runInContext("unwrapGatewayEnvelope_({ apiAction: 'session' })", context);
  } catch (err) {
    rejected = /security gateway/.test(String(err && err.message));
  }
  if (!rejected) {
    console.error('FAIL testDirectModeBoundary: direct request was not rejected when the switch was absent');
    process.exitCode = 1;
  } else {
    console.log('PASS testDirectModeBoundary');
  }
}

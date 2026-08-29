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

const webappContext = vm.createContext({ console, Utilities: { formatDate } });
const webappSource = fs.readFileSync(path.resolve(__dirname, '../apps/webapp/WebApp.gs'), 'utf8');
vm.runInContext(webappSource, webappContext, { filename: 'WebApp.gs' });
const fiscalReportHelpers = vm.runInContext(`({
  beforeBoundary: reportFiscalYearCEForDate_(new Date('2026-09-30T12:00:00+07:00')),
  atBoundary: reportFiscalYearCEForDate_(new Date('2026-10-01T00:00:00+07:00')),
  october: reportFiscalYearCEForMonth_('2026-10'),
  september: reportFiscalYearCEForMonth_('2027-09'),
  bounds: reportFiscalYearBounds_(2027),
})`, webappContext);
if (fiscalReportHelpers.beforeBoundary !== 2026 || fiscalReportHelpers.atBoundary !== 2027 ||
    fiscalReportHelpers.october !== 2027 || fiscalReportHelpers.september !== 2027 ||
    fiscalReportHelpers.bounds.from !== '2026-10-01' || fiscalReportHelpers.bounds.to !== '2027-10-01') {
  console.error('FAIL testWebappFiscalReportHelpers');
  process.exitCode = 1;
} else {
  console.log('PASS testWebappFiscalReportHelpers');
}

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

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

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
  Utilities: {
    formatDate,
    getUuid: () => '123e4567-e89b-42d3-a456-426614174000',
  },
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
const normalizedAdminLeaveType = vm.runInContext(
  "adminNormalizeLeaveType_('ลาช่วยเหลือภริยาคลอดบุตร')", webappContext);
if (normalizedAdminLeaveType !== 'ลาช่วยเหลือภรรยาคลอดบุตร') {
  console.error('FAIL testAdminLeaveTypeSpelling');
  process.exitCode = 1;
} else {
  console.log('PASS testAdminLeaveTypeSpelling');
}
const staffRosterLifecycle = vm.runInContext(`({
  complete: adminStaffRosterComplete_(['นาย', 'สมศักดิ์', 'ใจดี', 'บริหาร', 'นักวิชาการ', '', '', '', 'ข้าราชการ', 'EMP001']),
  missingPosition: adminStaffRosterComplete_(['นาย', 'สมศักดิ์', 'ใจดี', 'บริหาร', '', '', '', '', 'ข้าราชการ', 'EMP001']),
})`, webappContext);
if (!staffRosterLifecycle.complete || staffRosterLifecycle.missingPosition) {
  console.error('FAIL testAdminStaffRosterLifecycle');
  process.exitCode = 1;
} else {
  console.log('PASS testAdminStaffRosterLifecycle');
}
const approverDirectory = vm.runInContext(`(function () {
  var original = readReportStaff_;
  readReportStaff_ = function () { return [
    { key: 'อนุมัติ หนึ่ง', name: 'นาย อนุมัติ หนึ่ง', group: 'งานบริการ', position: 'หัวหน้างาน', lineUserId: 'U1', employmentStatus: 'ACTIVE', bindingStatus: 'APPROVED' },
    { key: 'รอ ผูก', name: 'นาย รอ ผูก', group: 'งานบริการ', position: 'เจ้าหน้าที่', lineUserId: '', employmentStatus: '', bindingStatus: '' },
    { key: 'หยุด ใช้', name: 'นาย หยุด ใช้', group: 'งานบริหาร', position: 'เจ้าหน้าที่', lineUserId: 'U2', employmentStatus: 'INACTIVE', bindingStatus: 'APPROVED' },
  ]; };
  try {
    return {
      directory: adminApproverDirectory_(),
      invalidGroup: api_saveApprovers_([{ group: 'งานนอกระบบ', names: 'อนุมัติ หนึ่ง' }], 'version'),
      invalidStaff: api_saveApprovers_([{ group: 'งานบริการ', names: 'รอ ผูก' }], 'version'),
    };
  } finally {
    readReportStaff_ = original;
  }
})()`, webappContext);
if (approverDirectory.directory.groupOptions.join(',') !== 'งานบริการ,งานบริหาร' ||
    approverDirectory.directory.staffKeys.join(',') !== 'อนุมัติ หนึ่ง' ||
    approverDirectory.directory.staffOptions[0].position !== 'หัวหน้างาน' ||
    approverDirectory.invalidGroup.ok !== false || !/ไม่พบกลุ่มงาน/.test(approverDirectory.invalidGroup.error) ||
    approverDirectory.invalidStaff.ok !== false || !/ไม่พบรายชื่อ/.test(approverDirectory.invalidStaff.error)) {
  console.error('FAIL testAdminApproverDirectory');
  process.exitCode = 1;
} else {
  console.log('PASS testAdminApproverDirectory');
}
const validBalanceError = vm.runInContext(
  "validateBalanceInput_('2570', 'สมศักดิ์ ใจดี', 'ลากิจ', '1', '', 'ปรับตามเอกสาร HR')", webappContext);
const shortBalanceReason = vm.runInContext(
  "validateBalanceInput_('2570', 'สมศักดิ์ ใจดี', 'ลากิจ', '1', '', 'สั้น')", webappContext);
const balanceRowWidth = vm.runInContext(
  "balanceRowValues_('2570', 'สมศักดิ์ ใจดี', 'ลากิจ', '1', '', 'ปรับตามเอกสาร HR', 'request-1', 'ผู้ดูแล').length",
  webappContext);
const balanceRequestMatch = vm.runInContext(
  "balanceRequestMatches_(['2570', 'สมศักดิ์  ใจดี', 'ลากิจ', '1.0', '', 'ปรับตามเอกสาร HR'], '2570', 'สมศักดิ์ ใจดี', 'ลากิจ', '1', '', 'ปรับตามเอกสาร HR')",
  webappContext);
if (validBalanceError !== null || !/5 ตัวอักษร/.test(String(shortBalanceReason)) ||
    balanceRowWidth !== 9 || !balanceRequestMatch) {
  console.error('FAIL testAdminBalanceValidation');
  process.exitCode = 1;
} else {
  console.log('PASS testAdminBalanceValidation');
}
const validRetentionErrors = vm.runInContext("validateSettings_({ logs_retention_days: '90' })", webappContext);
const invalidRetentionErrors = vm.runInContext("validateSettings_({ logs_retention_days: '29' })", webappContext);
if (validRetentionErrors.length || !invalidRetentionErrors.some(error => /30-3650/.test(error))) {
  console.error('FAIL testAdminLogRetentionValidation');
  process.exitCode = 1;
} else {
  console.log('PASS testAdminLogRetentionValidation');
}
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

if (vm.runInContext('allowUnsignedLineWebhook_()', context)) {
  console.error('FAIL testUnsignedLineWebhookBoundary: unsigned webhook was enabled by default');
  process.exitCode = 1;
} else {
  scriptProperties.set('ALLOW_UNSIGNED_LINE_WEBHOOK', 'TRUE');
  const explicitlyEnabled = vm.runInContext('allowUnsignedLineWebhook_()', context);
  scriptProperties.delete('ALLOW_UNSIGNED_LINE_WEBHOOK');
  if (!explicitlyEnabled) {
    console.error('FAIL testUnsignedLineWebhookBoundary: explicit switch did not enable compatibility mode');
    process.exitCode = 1;
  } else {
    console.log('PASS testUnsignedLineWebhookBoundary');
  }
}

try {
  execFileSync(process.execPath, [path.resolve(__dirname, 'test-liff-ui.js')], { stdio: 'inherit' });
} catch (err) {
  process.exitCode = 1;
}

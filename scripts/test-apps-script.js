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
const logPageWindows = vm.runInContext(`({
  first: logPageWindow_(1, 15, 32),
  last: logPageWindow_(3, 15, 32),
  clamped: logPageWindow_(99, 500, 32),
  single: logPageWindow_(1, 1, 32),
  empty: logPageWindow_(1, 15, 0),
})`, webappContext);
if (logPageWindows.first.startRow !== 20 || logPageWindows.first.count !== 15 ||
    logPageWindows.last.page !== 3 || logPageWindows.last.startRow !== 3 || logPageWindows.last.count !== 2 ||
    logPageWindows.clamped.pageSize !== 50 || logPageWindows.clamped.page !== 1 ||
    logPageWindows.single.pageSize !== 1 || logPageWindows.single.startRow !== 34 || logPageWindows.single.count !== 1 ||
    logPageWindows.empty.totalPages !== 1 || logPageWindows.empty.count !== 0) {
  console.error('FAIL testAdminLogPagination');
  process.exitCode = 1;
} else {
  console.log('PASS testAdminLogPagination');
}
const logPageApi = vm.runInContext(`(function () {
  var original = getSheet_;
  var read = null;
  getSheet_ = function () { return {
    getLastRow: function () { return 34; },
    getRange: function (startRow, column, count, width) {
      read = { startRow: startRow, column: column, count: count, width: width };
      return { getValues: function () { return [
        [new Date('2026-09-01T08:00:00+07:00'), '2026-09-01', 'success', 'เก่ากว่า'],
        [new Date('2026-09-01T09:00:00+07:00'), '2026-09-01', 'error', 'ใหม่กว่า'],
      ]; } };
    },
  }; };
  try {
    var result = api_getLogsPage(3, 15);
    return { read: read, result: result };
  } finally {
    getSheet_ = original;
  }
})()`, webappContext);
if (logPageApi.read.startRow !== 3 || logPageApi.read.count !== 2 || logPageApi.read.width !== 4 ||
    logPageApi.result.logs[0].detail !== 'ใหม่กว่า' || logPageApi.result.pagination.page !== 3 ||
    logPageApi.result.pagination.totalItems !== 32) {
  console.error('FAIL testAdminLogPageApi');
  process.exitCode = 1;
} else {
  console.log('PASS testAdminLogPageApi');
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

// ---------- verifyAdminLineToken_ / verifyLineToken_: outage ≠ token ตาย + แคชผลตรวจ 120 วิ ----------
// ใช้ context แยกของโปรเจกต์ละตัว (context หลักด้านบนไม่มี UrlFetchApp/CacheService/digest —
// ห้ามฉีด stub เพิ่มเข้าไปเพราะ test เดิมแชร์ context นั้นอยู่)

const nodeCrypto = require('crypto');

function makeLineStubContext(sources) {
  // สถานะจับได้ทุกอย่างที่ verifier ทำกับโลกภายนอก: จำนวนครั้งที่ยิง LINE / คำตอบ / TTL ที่ put
  const state = {
    verifyStatus: 200,
    verifyBody: { scope: 'profile', client_id: '2000000001', expires_in: 3600 },
    profileStatus: 200,
    profileBody: { userId: 'U123', displayName: 'สมชาย ใจดี' },
    fetchThrows: false,
    calls: [],
    puts: [],
    cache: new Map(),
    props: new Map([['LOGIN_CHANNEL_ID', '2000000001']]),
  };
  const ctx = vm.createContext({
    console, Intl, Set, Map,
    Utilities: {
      formatDate,
      getUuid: () => '123e4567-e89b-42d3-a456-426614174000',
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: (algorithm, value) =>
        Array.from(nodeCrypto.createHash('sha256').update(String(value), 'utf8').digest()),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url'),
    },
    PropertiesService: {
      getScriptProperties() { return { getProperty: name => state.props.get(name) || null }; },
    },
    CacheService: {
      getScriptCache() {
        return {
          get: key => (state.cache.has(key) ? state.cache.get(key) : null),
          put: (key, value, ttl) => { state.puts.push([key, ttl]); state.cache.set(key, value); },
        };
      },
    },
    UrlFetchApp: {
      fetch(url) {
        state.calls.push(url);
        if (state.fetchThrows) throw new Error('network down');
        const isVerify = url.indexOf('/oauth2/v2.1/verify') !== -1;
        return {
          getResponseCode: () => (isVerify ? state.verifyStatus : state.profileStatus),
          getContentText: () => JSON.stringify(isVerify ? state.verifyBody : state.profileBody),
        };
      },
    },
  });
  sources.forEach(source => vm.runInContext(source, ctx, { filename: 'line-verifier-source' }));
  return { ctx, state };
}

// รันชุดกรณีเดียวกันกับ verifier ของทั้งสองโปรเจกต์ — พฤติกรรมต้องตรงกันเป๊ะ (โค้ดคนละโปรเจกต์แต่หน้าตาเหมือน)
function testLineVerifier(label, sources, entryOf) {
  const { ctx, state } = makeLineStubContext(sources);
  const call = token => vm.runInContext(entryOf(token), ctx);
  let failed = false;
  const scenario = (name, fn) => {
    try {
      fn();
      console.log('PASS ' + name);
    } catch (err) {
      failed = true;
      process.exitCode = 1;
      console.error('FAIL ' + name + ': ' + (err && err.message));
    }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const capture = fn => { try { return { value: fn() }; } catch (err) { return { err }; } };

  scenario(label + 'VerifyCacheHit', () => {
    const first = call('token-a');
    assert(state.calls.length === 2, 'ต้องยิง LINE 2 ครั้ง (verify+profile) ได้ ' + state.calls.length);
    assert(first && first.userId === 'U123' && first.displayName === 'สมชาย ใจดี', 'profile ที่คืนไม่ตรง');
    assert(state.puts.length === 1 && state.puts[0][1] === 120,
      'TTL แคชต้องเท่ากับ 120 (expires_in 3600) ได้ ' + JSON.stringify(state.puts));
    state.calls = [];
    const second = call('token-a');
    assert(state.calls.length === 0, 'token เดิมใน 120 วิ ต้องไม่ยิง LINE ซ้ำ');
    assert(second && second.userId === 'U123', 'profile จากแคชไม่ตรง');
  });

  scenario(label + 'VerifyTtlCappedByExpiry', () => {
    state.verifyBody = { scope: 'profile', client_id: '2000000001', expires_in: 30 };
    state.puts = [];
    const result = call('token-b');
    assert(result && result.userId === 'U123', 'ตรวจสำเร็จไม่ได้');
    assert(state.puts.length === 1 && state.puts[0][1] === 30,
      'TTL ต้องถูกหรือด้วยอายุจริง (30) ได้ ' + JSON.stringify(state.puts));
    state.verifyBody = { scope: 'profile', client_id: '2000000001', expires_in: 3600 };
  });

  scenario(label + 'VerifyExpiredTokenIsNotCached', () => {
    state.verifyStatus = 400; // เอกสาร LINE: หมดอายุ/ถูกเพิกถอน = 400 + invalid_request
    state.calls = []; state.puts = [];
    const { err } = capture(() => call('token-c'));
    assert(err && /หมดอายุ/.test(String(err.message)), 'ต้องโยน หมดอายุ ได้: ' + (err && err.message));
    assert(state.calls.length === 1, 'ต้องยิงแค่ verify แล้วตาย (1 ครั้ง) ได้ ' + state.calls.length);
    assert(state.puts.length === 0, 'ผลล้มเหลวห้ามลงแคช');
    state.verifyStatus = 200;
  });

  scenario(label + 'VerifyOutage500IsLineUnavailable', () => {
    state.verifyStatus = 500;
    const { err } = capture(() => call('token-d'));
    assert(err && err.publicCode === 'LINE_UNAVAILABLE',
      '5xx ต้องเป็น LINE_UNAVAILABLE ไม่ใช่หมดอายุ/ไม่มีสิทธิ์ ได้: ' + (err && err.publicCode + ' ' + err.message));
    assert(state.puts.length === 0, 'outage ห้ามลงแคช');
    state.verifyStatus = 200;
  });

  scenario(label + 'VerifyNetworkThrowIsLineUnavailable', () => {
    state.fetchThrows = true;
    const { err } = capture(() => call('token-e'));
    assert(err && err.publicCode === 'LINE_UNAVAILABLE',
      'เน็ตหลุดต้องเป็น LINE_UNAVAILABLE ได้: ' + (err && err.publicCode));
    state.fetchThrows = false;
  });

  scenario(label + 'VerifyChannelMismatchRejected', () => {
    state.verifyBody = { scope: 'profile', client_id: '9999999999', expires_in: 3600 };
    state.calls = []; state.puts = [];
    const { err } = capture(() => call('token-f'));
    assert(err && /ไม่สามารถยืนยันตัวตนได้/.test(String(err.message)),
      'channel ไม่ตรงต้องโยน ไม่สามารถยืนยันตัวตนได้ ได้: ' + (err && err.message));
    assert(state.puts.length === 0, 'channel ไม่ตรงห้ามลงแคช');
    state.verifyBody = { scope: 'profile', client_id: '2000000001', expires_in: 3600 };
  });

  scenario(label + 'VerifyMissingChannelConfig', () => {
    state.props.delete('LOGIN_CHANNEL_ID');
    const { err } = capture(() => call('token-g'));
    assert(err && err.publicCode === 'UNCONFIGURED', 'ต้องเป็น UNCONFIGURED ได้: ' + (err && err.publicCode));
    state.props.set('LOGIN_CHANNEL_ID', '2000000001');
  });

  scenario(label + 'VerifyProfileFailureNotCached', () => {
    state.profileStatus = 401;
    const { err } = capture(() => call('token-h'));
    assert(err && /อ่านข้อมูลโปรไฟล์/.test(String(err.message)),
      'profile 4xx ต้องโยน อ่านข้อมูลโปรไฟล์ ได้: ' + (err && err.message));
    assert(state.puts.length === 0, 'profile พังห้ามลงแคช');
    state.profileStatus = 200;
  });

  scenario(label + 'VerifyCorruptCacheTreatedAsMiss', () => {
    const first = call('token-i');
    assert(first && first.userId === 'U123', 'รอบแรกต้องผ่าน');
    const key = state.puts[state.puts.length - 1][0];
    state.cache.set(key, '{not json'); // แคชเสียต้องถือว่า miss ไม่ใช่พังทั้งหน้า
    state.calls = [];
    const retry = call('token-i');
    assert(state.calls.length === 2, 'แคชเสียต้องกลับไปยิง LINE ใหม่ 2 ครั้ง ได้ ' + state.calls.length);
    assert(retry && retry.userId === 'U123', 'รอบสองต้องผ่านและได้ profile เดิม');
  });

  return failed;
}

const mainDir = path.resolve(__dirname, '../apps/main');
const mainVerifierSources = fs.readdirSync(mainDir)
  .filter(name => name.endsWith('.gs'))
  .sort()
  .map(name => fs.readFileSync(path.join(mainDir, name), 'utf8'));
const webappVerifierSources = [fs.readFileSync(path.resolve(__dirname, '../apps/webapp/WebApp.gs'), 'utf8')];

testLineVerifier('main', mainVerifierSources, token => 'verifyLineToken_("' + token + '")');
testLineVerifier('webapp', webappVerifierSources, token => 'verifyAdminLineToken_("' + token + '")');

try {
  execFileSync(process.execPath, [path.resolve(__dirname, 'test-liff-ui.js')], { stdio: 'inherit' });
} catch (err) {
  process.exitCode = 1;
}

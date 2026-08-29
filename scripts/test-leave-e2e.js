'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// A fixed Bangkok business date keeps boundary and cancellation assertions deterministic.
const FIXED_NOW = '2026-08-29T12:00:00+07:00';
const NativeDate = Date;
class FixedDate extends NativeDate {
  constructor(...args) {
    super(...(args.length ? args : [FIXED_NOW]));
  }
  static now() { return new NativeDate(FIXED_NOW).getTime(); }
}

function dateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new NativeDate(date));
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function formatDate(date, timeZone, format) {
  const p = dateParts(date, timeZone);
  const replacements = {
    yyyy: p.year, yy: p.year.slice(-2), MM: p.month, dd: p.day,
    HH: p.hour, mm: p.minute, ss: p.second,
  };
  return format.replace(/yyyy|yy|MM|dd|HH|mm|ss/g, token => replacements[token]);
}

const state = {
  nextPage: 1,
  pages: new Map(),
  messages: [],
  audits: [],
  logs: [],
  expectedErrors: [],
  settings: {
    leave_database_id: 'leave-db',
    line_group_id: 'group-main',
    leave_system_enabled: 'TRUE',
    leave_approval_enabled: 'TRUE',
    leave_type_options: 'ลาป่วย,ลากิจ,ลาพักร้อน,ลาคลอด,ลาอุปสมบท/ลาบวช,ลาช่วยเหลือภรรยาคลอดบุตร,อื่นๆ',
    second_approvers: 'ชาญ ชำนาญ',
  },
  profiles: {
    'token-owner': { userId: 'U-owner', displayName: 'Owner LINE' },
    'token-other': { userId: 'U-other', displayName: 'Other LINE' },
    'token-first': { userId: 'U-first', displayName: 'First Approver' },
    'token-chief': { userId: 'U-chief', displayName: 'Chief Approver' },
    'token-unknown': { userId: 'U-unknown', displayName: 'Unknown LINE' },
  },
  roster: [
    { prefix: 'นาย', firstName: 'สมชาย', lastName: 'ทดสอบ', groupName: 'งานบริการ', position: 'เจ้าหน้าที่', lineUserId: 'U-owner', employmentType: 'ข้าราชการ' },
    { prefix: 'นางสาว', firstName: 'สมหญิง', lastName: 'ผู้อื่น', groupName: 'งานบริการ', position: 'เจ้าหน้าที่', lineUserId: 'U-other', employmentType: 'ข้าราชการ' },
    { prefix: 'นาย', firstName: 'อนุมัติ', lastName: 'ขั้นแรก', groupName: 'งานบริหาร', position: 'หัวหน้างาน', lineUserId: 'U-first', employmentType: 'ข้าราชการ' },
    { prefix: 'นาย', firstName: 'ชาญ', lastName: 'ชำนาญ', groupName: 'งานบริหาร', position: 'หัวหน้า สสอ.', lineUserId: 'U-chief', employmentType: 'ข้าราชการ' },
  ],
  approvers: [
    { groupName: 'งานบริการ', approverNames: ['อนุมัติ ขั้นแรก'], forward: true },
    { groupName: 'งานบริหาร', approverNames: ['ชาญ ชำนาญ'], forward: false },
  ],
};

const context = vm.createContext({
  console: {
    log: (...args) => console.log(...args),
    warn: (...args) => console.warn(...args),
    error: (...args) => state.expectedErrors.push(args.map(String).join(' ')),
  },
  Date: FixedDate,
  Intl,
  Set,
  Map,
  JSON,
  Math,
  __e2e: state,
  Utilities: { formatDate },
  PropertiesService: {
    getScriptProperties() {
      return { getProperty: () => null, setProperty() {}, deleteProperty() {} };
    },
  },
  LockService: {
    getScriptLock() { return { tryLock: () => true, releaseLock() {} }; },
  },
});

const sourceDir = path.resolve(__dirname, '../apps/main');
fs.readdirSync(sourceDir)
  .filter(name => name.endsWith('.gs'))
  .sort()
  .forEach(name => vm.runInContext(
    fs.readFileSync(path.join(sourceDir, name), 'utf8'), context, { filename: name }));

// Replace only external boundaries. Production authentication and application code remain unchanged.
vm.runInContext(`
  verifyLineToken_ = function(token) {
    var profile = __e2e.profiles[String(token || '')];
    if (!profile) throw new Error('เซสชันหมดอายุ กรุณาปิดแล้วเปิดหน้านี้ใหม่');
    return Object.assign({}, profile);
  };
  getSettings_ = function() { return Object.assign({}, __e2e.settings); };
  readStaffRoster_ = function() { return __e2e.roster.map(function(row) { return Object.assign({}, row); }); };
  readApproversConfig_ = function() { return __e2e.approvers.map(function(row) {
    return { groupName: row.groupName, approverNames: row.approverNames.slice(), forward: row.forward };
  }); };
  readHolidaySet_ = function() { return new Set(); };
  readLeaveBalances_ = function() { return []; };
  readQuotaProfiles_ = function() { return []; };
  appendAssigneeConflictWarning_ = function() {};
  resolveLeaveDataSourceId_ = function(value) { return value; };
  recordLeaveNotificationFailure_ = function() { return 1; };
  clearLeaveNotificationFailure_ = function() {};
  claimSecurityEventOnce_ = function(source, id) { __e2e.audits.push({ type: 'claim', source: source, id: id }); return true; };
  appendAuditEvent_ = function(id, actor, action, target, before, after) {
    __e2e.audits.push({ id: id, actor: actor, action: action, target: target, before: before, after: after });
  };
  logResult_ = function(when, kind, message) { __e2e.logs.push({ kind: kind, message: String(message) }); };
  sendLineMessage_ = function(target, message) { __e2e.messages.push({ target: target, message: message }); };
  sendLineMulticast_ = function(targets, message) {
    targets.forEach(function(target) { __e2e.messages.push({ target: target, message: message }); });
  };

  hydrateNotionText_ = function(page) {
    Object.keys(page.properties || {}).forEach(function(key) {
      var property = page.properties[key] || {};
      ['title', 'rich_text'].forEach(function(field) {
        (property[field] || []).forEach(function(item) {
          if (item.plain_text == null) item.plain_text = String(item.text && item.text.content || '');
        });
      });
    });
    return page;
  };

  createNotionLeavePage_ = function(payload) {
    var id = String(__e2e.nextPage++).padStart(32, '0');
    var page = hydrateNotionText_({
      id: id, url: 'memory://' + id, properties: JSON.parse(JSON.stringify(payload.properties))
    });
    __e2e.pages.set(id, page);
    return JSON.parse(JSON.stringify(page));
  };
  getLeavePage_ = function(pageId) {
    var page = __e2e.pages.get(String(pageId));
    if (!page) throw new Error('ไม่พบใบลา');
    return JSON.parse(JSON.stringify(page));
  };
  updateLeavePage_ = function(pageId, properties) {
    var page = __e2e.pages.get(String(pageId));
    if (!page) throw new Error('ไม่พบใบลา');
    Object.keys(properties).forEach(function(key) {
      page.properties[key] = JSON.parse(JSON.stringify(properties[key]));
    });
    hydrateNotionText_(page);
    return JSON.parse(JSON.stringify(page));
  };
  findLeaveByRequestId_ = function(leaveDatabaseId, requestId) {
    var matches = Array.from(__e2e.pages.values()).map(parseLeavePage_)
      .filter(function(leave) { return leave.requestId === requestId; });
    if (matches.length > 1) throw new Error('พบ Request ID ซ้ำใน Notion กรุณาติดต่อผู้ดูแลระบบ');
    return matches.length ? matches[0] : null;
  };
  getLeaveUsageForYear_ = function(leaveDatabaseId, userId, now) {
    var year = fiscalYearCEForDate_(now);
    var usage = {};
    Array.from(__e2e.pages.values()).map(parseLeavePage_).forEach(function(leave) {
      if (leave.submitterUserId !== userId || !isValidDateStr_(leave.start) ||
          fiscalYearCEForDateStr_(leave.start) !== year ||
          ![LEAVE_STATUS.approved, LEAVE_STATUS.pendingApprover, LEAVE_STATUS.pendingChiefOffice].includes(leave.status)) return;
      usage[leave.leaveType] = (usage[leave.leaveType] || 0) + leaveQuotaDays_(leave);
    });
    return usage;
  };
  getMyLeavesForYears_ = function(leaveDatabaseId, userId) {
    return Array.from(__e2e.pages.values()).map(parseLeavePage_)
      .filter(function(leave) { return leave.submitterUserId === userId; });
  };
`, context);

function call(expression) {
  return vm.runInContext(expression, context);
}

function api(body) {
  context.__body = body;
  return vm.runInContext('handleApiRequest_(__body)', context);
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('PASS ' + name);
  } catch (err) {
    failed++;
    console.error('FAIL ' + name + ': ' + (err && err.stack ? err.stack : err));
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}
function requestId(n) {
  return '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
}
function submit(token, n, overrides) {
  return api(Object.assign({
    apiAction: 'submit', accessToken: token, requestId: requestId(n),
    leaveType: 'ลากิจ', reason: 'ทดสอบระบบ', start: '2026-09-01', end: '2026-09-02', period: 'เต็มวัน',
  }, overrides || {}));
}
function parsed(pageId) {
  context.__pageId = pageId;
  return call('parseLeavePage_(getLeavePage_(__pageId))');
}
function postback(userId, pageId, action, eventId) {
  context.__event = { source: { userId }, postback: { data: JSON.stringify({ t: 'leave', a: action, p: pageId }) } };
  context.__eventId = eventId;
  return call('handleLeavePostback_(__event, __eventId)');
}

test('session requires a valid synthetic LINE token', () => {
  const missing = api({ apiAction: 'session' });
  const invalid = api({ apiAction: 'session', accessToken: 'bad-token' });
  assert(!missing.ok && /ไม่พบข้อมูลการเข้าสู่ระบบ/.test(missing.error), 'missing token was accepted');
  assert(!invalid.ok && /เซสชันหมดอายุ/.test(invalid.error), 'invalid token was accepted');
});

test('session distinguishes registered and unregistered users', () => {
  const registered = api({ apiAction: 'session', accessToken: 'token-owner' });
  const unregistered = api({ apiAction: 'session', accessToken: 'token-unknown' });
  assert(registered.ok && registered.registered && registered.name.includes('สมชาย'), 'registered session mismatch');
  assert(unregistered.ok && !unregistered.registered, 'unregistered session mismatch');
});

let approvalPageId;
test('two-stage leave submission persists pending state and notifies first approver', () => {
  const result = submit('token-owner', 1);
  assert(result.ok && result.needsSecond && !result.autoApproved, 'submission result mismatch');
  approvalPageId = result.pageId;
  const leave = parsed(approvalPageId);
  assert(leave.status === 'รอผู้อนุมัติ', 'wrong initial status');
  assert(leave.currentApprover.userIds.includes('U-first'), 'wrong first approver');
  assert(state.messages.some(item => item.target === 'U-first'), 'first approver was not notified');
});

test('request id is idempotent for owner and rejected for another user', () => {
  const duplicate = submit('token-owner', 1);
  const collision = submit('token-other', 1);
  assert(duplicate.ok && duplicate.duplicate && duplicate.pageId === approvalPageId, 'owner retry created a duplicate');
  assert(!collision.ok && /รหัสคำขอนี้ถูกใช้แล้ว/.test(collision.error), 'cross-user request id collision passed');
  assert(state.pages.size === 1, 'idempotency changed page count');
});

test('unauthorized approver cannot mutate a pending leave', () => {
  postback('U-other', approvalPageId, 'approve', 'evt-wrong');
  assert(parsed(approvalPageId).status === 'รอผู้อนุมัติ', 'unauthorized approval changed status');
  assert(state.messages.some(item => item.target === 'U-other' && /ไม่ใช่ผู้อนุมัติ/.test(item.message.text)),
    'unauthorized approver did not receive a rejection');
});

test('first approval forwards to chief and final approval completes', () => {
  postback('U-first', approvalPageId, 'approve', 'evt-first');
  let leave = parsed(approvalPageId);
  assert(leave.status === 'รอหัวหน้า สสอ.อนุมัติ', 'first approval did not advance stage');
  assert(leave.currentApprover.userIds.includes('U-chief'), 'chief was not assigned');
  postback('U-chief', approvalPageId, 'approve', 'evt-final');
  leave = parsed(approvalPageId);
  assert(leave.status === 'อนุมัติ' && leave.currentApprover === null, 'final approval did not complete');
  postback('U-chief', approvalPageId, 'approve', 'evt-repeat');
  assert(parsed(approvalPageId).status === 'อนุมัติ', 'repeat postback changed final status');
});

test('approved future leave can be cancelled by owner but not another user', () => {
  const wrong = api({ apiAction: 'cancel', accessToken: 'token-other', pageId: approvalPageId, requestId: requestId(20) });
  assert(!wrong.ok && /ไม่ใช่เจ้าของ/.test(wrong.error), 'non-owner cancellation passed');
  const own = api({ apiAction: 'cancel', accessToken: 'token-owner', pageId: approvalPageId, requestId: requestId(21) });
  assert(own.ok && parsed(approvalPageId).status === 'ยกเลิก', 'owner cancellation failed');
});

let editablePageId;
test('pending leave can be edited by owner and is recalculated', () => {
  const created = submit('token-owner', 2, { start: '2026-09-07', end: '2026-09-07' });
  editablePageId = created.pageId;
  const wrong = api({ apiAction: 'update', accessToken: 'token-other', pageId: editablePageId,
    leaveType: 'ลาป่วย', reason: 'แก้โดยคนอื่น', start: '2026-09-08', end: '2026-09-08', period: 'เต็มวัน' });
  assert(!wrong.ok && /ไม่ใช่เจ้าของ/.test(wrong.error), 'non-owner edit passed');
  const own = api({ apiAction: 'update', accessToken: 'token-owner', pageId: editablePageId,
    leaveType: 'ลาป่วย', reason: 'แก้ไขแล้ว', start: '2026-09-08', end: '2026-09-08', period: 'ครึ่งวันเช้า' });
  const leave = parsed(editablePageId);
  assert(own.ok && own.workDays === 0.5 && leave.leaveType === 'ลาป่วย' && leave.period === 'ครึ่งวันเช้า',
    'owner edit was not recalculated');
});

test('fiscal-year crossing and no-workday ranges are rejected', () => {
  const crossing = submit('token-owner', 3, { start: '2026-09-30', end: '2026-10-01' });
  const weekend = submit('token-owner', 4, { start: '2026-08-30', end: '2026-08-30' });
  assert(!crossing.ok && /ปีงบประมาณเดียวกัน/.test(crossing.error), 'fiscal crossing passed');
  assert(!weekend.ok && /ไม่มีวันทำการ/.test(weekend.error), 'weekend-only leave passed');
});

test('rejection is final and blocks editing', () => {
  const created = submit('token-owner', 5, { start: '2026-09-14', end: '2026-09-14' });
  postback('U-first', created.pageId, 'reject', 'evt-reject');
  assert(parsed(created.pageId).status === 'ไม่อนุมัติ', 'rejection did not persist');
  const edit = api({ apiAction: 'update', accessToken: 'token-owner', pageId: created.pageId,
    leaveType: 'ลากิจ', reason: 'ลองแก้', start: '2026-09-15', end: '2026-09-15', period: 'เต็มวัน' });
  assert(!edit.ok && /แก้ไขได้เฉพาะ/.test(edit.error), 'rejected leave could be edited');
});

test('system closure blocks submit and edit but still allows cancellation', () => {
  const created = submit('token-owner', 6, { start: '2026-09-16', end: '2026-09-16' });
  state.settings.leave_system_enabled = 'FALSE';
  const blocked = submit('token-owner', 7, { start: '2026-09-17', end: '2026-09-17' });
  const blockedEdit = api({ apiAction: 'update', accessToken: 'token-owner', pageId: created.pageId,
    leaveType: 'ลาป่วย', reason: 'แก้', start: '2026-09-18', end: '2026-09-18', period: 'เต็มวัน' });
  const cancelled = api({ apiAction: 'cancel', accessToken: 'token-owner', pageId: created.pageId, requestId: requestId(22) });
  assert(!blocked.ok && /ปิดรับคำขอ/.test(blocked.error), 'closed system accepted submit');
  assert(!blockedEdit.ok && /ปิดรับคำขอ/.test(blockedEdit.error), 'closed system accepted edit');
  assert(cancelled.ok && parsed(created.pageId).status === 'ยกเลิก', 'closed system blocked cancellation');
  state.settings.leave_system_enabled = 'TRUE';
});

test('approval-disabled mode auto-approves and sends a notice without approval buttons', () => {
  state.settings.leave_system_enabled = 'TRUE';
  state.settings.leave_approval_enabled = 'FALSE';
  const result = submit('token-owner', 8, { start: '2026-09-21', end: '2026-09-21' });
  const leave = parsed(result.pageId);
  const groupNotice = state.messages.find(item => item.target === 'group-main' &&
    item.message && item.message.type === 'flex' && /แจ้งลาอัตโนมัติ/.test(item.message.altText || ''));
  assert(result.ok && result.autoApproved && leave.status === 'อนุมัติ', 'auto approval failed');
  assert(groupNotice && groupNotice.message.contents.footer.contents.length === 1,
    'auto-approved notice still contains approval controls');
  state.settings.leave_approval_enabled = 'TRUE';
});

test('leave at or before today cannot be cancelled by self-service', () => {
  state.settings.leave_system_enabled = 'TRUE';
  state.settings.leave_approval_enabled = 'TRUE';
  const created = submit('token-owner', 9, { start: '2026-08-28', end: '2026-08-28', leaveType: 'ลาป่วย' });
  assert(created.ok, 'backdated sick leave could not be submitted');
  const cancel = api({ apiAction: 'cancel', accessToken: 'token-owner', pageId: created.pageId, requestId: requestId(23) });
  assert(!cancel.ok && /ถึงวันเริ่มแล้ว/.test(cancel.error), 'past leave cancellation passed');
});

test('myLeaves returns only the authenticated owner records and current fiscal usage', () => {
  const mine = api({ apiAction: 'myLeaves', accessToken: 'token-owner' });
  const other = api({ apiAction: 'myLeaves', accessToken: 'token-other' });
  assert(mine.ok && mine.leaves.length === state.pages.size, 'owner leave history mismatch');
  assert(other.ok && other.leaves.length === 0, 'other user saw owner records');
  assert(mine.usage && mine.usage['ลาป่วย'], 'usage summary was not built');
});

console.log('Synthetic leave E2E: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;

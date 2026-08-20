/**
 * ระบบลางานเจ้าหน้าที่ — ใช้ LIFF เป็นหน้ายื่น (โฮสต์ GitHub Pages), Notion เป็นที่เก็บใบลา,
 * LINE OA เป็นช่องทางแจ้ง/อนุมัติ
 *
 * การระบุตัวตน: ผูก LINE userId กับชื่อในชีต Staff ครั้งเดียว (first-claim-wins — ชื่อที่ถูกผูกแล้ว
 * ใครมาเลือกซ้ำไม่ได้) ทุกคำขอจาก LIFF ต้องแนบ access token และฝั่งเซิร์ฟเวอร์ตรวจกับ LINE จริงทุกครั้ง
 * (api.line.me/oauth2/v2.1/verify + /v2/profile) — ไม่เชื่อข้อมูลใดๆ ที่มาจากฝั่ง browser
 *
 * การอนุมัติสองชั้น: หัวหน้ากลุ่มงาน → ผอ. (เฉพาะประเภทใน Settings "leave_types_needing_director")
 * การ์ดส่งหาผู้อนุมัติแบบ 1:1 พร้อมปุ่ม postback อนุมัติ/ไม่อนุมัติ
 * การตรวจสิทธิ์คนกดปุ่มอ้างอิง "ผู้อนุมัติปัจจุบัน" ที่เก็บในหน้า Notion (ดู canApproveLeave_)
 * — เป็นชั้นป้องกันหลักแทนการตรวจ X-Line-Signature ที่ Apps Script เข้าถึง header นี้ไม่ได้
 *
 * โครงสร้างชีต Staff (สร้างอัตโนมัติด้วยเมนู "เตรียมระบบลางาน"):
 *   แถว 1: ชื่อตาราง / แถว 2: หัวคอลัมน์ / เริ่มข้อมูลแถว 3 (ตามแบบชีต Settings/Holidays)
 *   ชื่อ-สกุล | กลุ่มงาน | ระดับ (เจ้าหน้าที่/หัวหน้ากลุ่มงาน/ผอ.) | คำนำหน้า (ผู้ใช้กรอก)
 *   | LINE User ID | ชื่อที่แสดงใน LINE | วันที่ลงทะเบียน
 *
 * โครงสร้าง Notion database "ใบลา" (ชื่อ property อ้างอิงผ่าน PROPS_LEAVE):
 *   ผู้ลา (title, เก็บชื่อเต็ม คำนำหน้า+ชื่อ-สกุล) / กลุ่มงาน (rich_text)
 *   / ผู้ยื่น (ระบบ) (rich_text, เก็บ LINE userId ของผู้ยื่น) / ประเภทการลา (select)
 *   / วันที่ลา (date) / เหตุผล (rich_text) / สถานะ (select) / ผู้อนุมัติปัจจุบัน (rich_text, JSON ภายใน)
 *   / บันทึกการอนุมัติ (rich_text, audit) / จำนวนวันทำการ (number)
 */

const PROPS_LEAVE = {
  title: 'ผู้ลา',
  groupName: 'กลุ่มงาน',
  submitter: 'ผู้ยื่น (ระบบ)',
  type: 'ประเภทการลา',
  date: 'วันที่ลา',
  reason: 'เหตุผล',
  status: 'สถานะ',
  currentApprover: 'ผู้อนุมัติปัจจุบัน',
  audit: 'บันทึกการอนุมัติ',
  workDays: 'จำนวนวันทำการ',
};

const LEAVE_STATUS = {
  pendingChief: 'รอหัวหน้าอนุมัติ',
  pendingDirector: 'รอ ผอ.อนุมัติ',
  approved: 'อนุมัติ',
  rejected: 'ไม่อนุมัติ',
  cancelled: 'ยกเลิก',
};

const LEAVE_TYPES = ['ลาป่วย', 'ลากิจ', 'ลาพักร้อน', 'ลาคลอด', 'ลาบวช', 'อื่นๆ'];

const STAFF_LEVEL = {
  staff: 'เจ้าหน้าที่',
  chief: 'หัวหน้ากลุ่มงาน',
  director: 'ผอ.',
};

const STAFF_SHEET_COLUMNS = [
  'ชื่อ-สกุล', 'กลุ่มงาน', 'ระดับ', 'คำนำหน้า (ผู้ใช้กรอก)',
  'LINE User ID', 'ชื่อที่แสดงใน LINE', 'วันที่ลงทะเบียน',
];

// ขอบเขตวันที่ยื่นได้: ย้อนหลัง (ลาป่วยมักแจ้งย้อน) และล่วงหน้า
const LEAVE_MAX_DAYS_BACK = 90;
const LEAVE_MAX_DAYS_AHEAD = 365;
const LEAVE_MAX_SPAN_DAYS = 365;

// ---------- ช่องทางเข้า API จาก LIFF (เรียกจาก doPost ใน Webhook.gs) ----------

function handleApiRequest_(body) {
  try {
    switch (body.apiAction) {
      case 'session': return apiSession_(body);
      case 'bind': return apiBind_(body);
      case 'submit': return apiSubmit_(body);
      case 'calendar': return apiCalendar_(body);
      default:
        return { ok: false, error: 'ไม่รู้จักคำสั่งนี้' };
    }
  } catch (err) {
    // error กลับไปหน้า LIFF เป็นข้อความไทยสุภาพเสมอ ไม่ปล่อย stack/รายละเอียดระบบรั่วออกไป
    return { ok: false, error: err && err.message ? err.message : 'เกิดข้อผิดพลาด ลองอีกครั้ง' };
  }
}

function requireAccessToken_(body) {
  const token = String((body && body.accessToken) || '').trim();
  if (!token) throw new Error('ไม่พบข้อมูลการเข้าสู่ระบบ กรุณาปิดแล้วเปิดหน้านี้ใหม่');
  return token;
}

// ---------- ตรวจ access token กับ LINE จริงทุกครั้ง ----------

function verifyLineToken_(accessToken) {
  const verifyResp = UrlFetchApp.fetch(
    'https://api.line.me/oauth2/v2.1/verify?access_token=' + encodeURIComponent(accessToken),
    { muteHttpExceptions: true }
  );
  if (verifyResp.getResponseCode() >= 300) {
    throw new Error('เซสชันหมดอายุ กรุณาปิดแล้วเปิดหน้านี้ใหม่');
  }
  const verified = JSON.parse(verifyResp.getContentText());
  if (!verified.expires_in || verified.expires_in <= 0) {
    throw new Error('เซสชันหมดอายุ กรุณาปิดแล้วเปิดหน้านี้ใหม่');
  }
  // กัน token ที่ออกจากแอปคนละตัว: ถ้าตั้ง LOGIN_CHANNEL_ID ไว้ต้องตรงกับ channel ของเรา
  const expectedChannelId = PropertiesService.getScriptProperties().getProperty('LOGIN_CHANNEL_ID');
  if (expectedChannelId && String(expectedChannelId).trim() &&
      verified.client_id !== String(expectedChannelId).trim()) {
    throw new Error('ไม่สามารถยืนยันตัวตนได้ ติดต่อผู้ดูแลระบบ');
  }

  const profileResp = UrlFetchApp.fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: 'Bearer ' + accessToken },
    muteHttpExceptions: true,
  });
  if (profileResp.getResponseCode() >= 300) {
    throw new Error('อ่านข้อมูลโปรไฟล์ LINE ไม่สำเร็จ ลองอีกครั้ง');
  }
  const profile = JSON.parse(profileResp.getContentText());
  return { userId: profile.userId, displayName: profile.displayName || '' };
}

// ---------- ทำเนียบ Staff ----------

function readStaffRoster_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName('Staff');
  if (!sheet) {
    throw new Error('ยังไม่ได้เตรียมระบบลางาน — ใช้เมนู "ระบบแจ้งเตือนปฏิทิน > เตรียมระบบลางาน" ก่อน');
  }
  const lastRow = sheet.getLastRow();
  const data = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, STAFF_SHEET_COLUMNS.length).getDisplayValues() : [];
  return data
    .filter(row => String(row[0]).trim())
    .map((row, i) => ({
      row: 3 + i,
      name: String(row[0]).trim(),
      groupName: String(row[1]).trim(),
      level: String(row[2]).trim(),
      prefix: String(row[3]).trim(),
      lineUserId: String(row[4]).trim(),
      lineDisplayName: String(row[5]).trim(),
      registeredAt: String(row[6]).trim(),
    }));
}

function findStaffByUserId_(roster, userId) {
  return (roster || []).find(s => s.lineUserId && s.lineUserId === userId) || null;
}

function findStaffByName_(roster, name) {
  return (roster || []).find(s => s.name === String(name || '').trim()) || null;
}

function findDirectors_(roster) {
  return (roster || []).filter(s => s.level === STAFF_LEVEL.director && s.lineUserId);
}

// ชื่อเต็มสำหรับแสดงผล = คำนำหน้า (ผู้ใช้กรอกเองตอนลงทะเบียน) + ชื่อ-สกุล (จากทำเนียบ)
function staffDisplayName_(staff) {
  if (!staff) return '';
  return (staff.prefix ? staff.prefix + ' ' : '') + staff.name;
}

/**
 * บันไดเลือกผู้อนุมัติขั้นแรกของใบลา:
 *   หัวหน้ากลุ่มงานเดียวกันที่ลงทะเบียนแล้ว → ผอ. ที่ลงทะเบียนแล้ว → ไม่มีเลย (ส่งกลุ่มหลัก)
 * ผู้ยื่นเป็นหัวหน้ากลุ่มงานเองจะข้ามขั้นหัวหน้าไป ผอ. ทันที (ไม่อนุมัติใบลาของตัวเอง)
 * คืน { mode:'user', level, approvers:[staff...] } หรือ { mode:'level', level } เมื่อต้องส่งเข้ากลุ่มหลัก
 */
function findApproverForStaff_(roster, staff) {
  if (staff.level !== STAFF_LEVEL.chief && staff.level !== STAFF_LEVEL.director) {
    const chief = (roster || []).find(s =>
      s.level === STAFF_LEVEL.chief && s.groupName === staff.groupName && s.lineUserId);
    if (chief) return { mode: 'user', level: STAFF_LEVEL.chief, approvers: [chief] };
  }
  const directors = findDirectors_(roster);
  if (directors.length) return { mode: 'user', level: STAFF_LEVEL.director, approvers: directors };
  return { mode: 'level', level: STAFF_LEVEL.chief };
}

/**
 * ตรวจสิทธิ์ผู้กดปุ่มอนุมัติตาม "ผู้อนุมัติปัจจุบัน" ที่เก็บในหน้า Notion
 *   mode 'user'  = ต้องมี userId ตรงกับรายการใดรายการหนึ่งใน userIds
 *   mode 'level' = การ์ดถูกส่งเข้ากลุ่มหลัก (ไม่มีผู้อนุมัติรายคน) ยอมให้หัวหน้ากลุ่มงาน/ผอ. ที่ลงทะเบียนแล้วกดได้
 * คืน { ok:true, staff } หรือ { ok:false, reason:'not-approver'|'done' }
 */
function canApproveLeave_(approverInfo, tapperUserId, roster) {
  if (!approverInfo) return { ok: false, reason: 'done' };
  const tapper = findStaffByUserId_(roster, tapperUserId);
  if (approverInfo.mode === 'level') {
    const allowed = tapper && (tapper.level === STAFF_LEVEL.chief || tapper.level === STAFF_LEVEL.director);
    return allowed ? { ok: true, staff: tapper } : { ok: false, reason: 'not-approver' };
  }
  if (!tapper || !(approverInfo.userIds || []).includes(tapperUserId)) {
    return { ok: false, reason: 'not-approver' };
  }
  return { ok: true, staff: tapper };
}

// ---------- วันที่ / วันทำการ ----------

function bangkokTodayStr_() {
  return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
}

function isValidDateStr_(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function daysBetweenDateStrs_(startStr, endStr) {
  return Math.round(
    (new Date(endStr + 'T00:00:00Z') - new Date(startStr + 'T00:00:00Z')) / 86400000
  );
}

function isWeekendDateStr_(dateStr) {
  const dow = new Date(dateStr + 'T00:00:00Z').getUTCDay();
  return dow === 0 || dow === 6;
}

/** ตรวจ + มาตรฐานช่วงวันที่ของใบลา — throw เป็นภาษาไทยเมื่อไม่ผ่าน */
function parseLeaveDateRange_(start, end, todayStr) {
  const startStr = String(start || '').trim();
  const endStr = String(end || start || '').trim();
  if (!isValidDateStr_(startStr) || !isValidDateStr_(endStr)) {
    throw new Error('รูปแบบวันที่ไม่ถูกต้อง');
  }
  if (daysBetweenDateStrs_(startStr, endStr) < 0) {
    throw new Error('วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น');
  }
  if (daysBetweenDateStrs_(todayStr, startStr) > LEAVE_MAX_DAYS_AHEAD) {
    throw new Error('ยื่นล่วงหน้าได้ไม่เกิน ' + LEAVE_MAX_DAYS_AHEAD + ' วัน');
  }
  if (daysBetweenDateStrs_(startStr, todayStr) > LEAVE_MAX_DAYS_BACK) {
    throw new Error('ยื่นย้อนหลังได้ไม่เกิน ' + LEAVE_MAX_DAYS_BACK + ' วัน');
  }
  if (daysBetweenDateStrs_(startStr, endStr) > LEAVE_MAX_SPAN_DAYS) {
    throw new Error('ช่วงวันที่ยาวเกิน ' + LEAVE_MAX_SPAN_DAYS + ' วัน');
  }
  return { start: startStr, end: endStr };
}

/** นับวันทำการในช่วง (ข้ามเสาร์-อาทิตย์และวันหยุดใน holidaySet) — pure, รับ holidaySet เป็น Set ของ 'yyyy-MM-dd' */
function countBusinessDays_(startStr, endStr, holidaySet) {
  const holidays = holidaySet || new Set();
  let count = 0;
  for (let d = new Date(startStr + 'T00:00:00Z');
       d.getTime() <= new Date(endStr + 'T00:00:00Z').getTime();
       d = new Date(d.getTime() + 86400000)) {
    const dateStr = Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
    if (!isWeekendDateStr_(dateStr) && !holidays.has(dateStr)) count++;
  }
  return count;
}

/** ใบลาคร่อมวัน todayStr หรือไม่ (pure) */
function leaveRangeOverlap_(startStr, endStr, todayStr) {
  const effectiveEnd = endStr || startStr;
  return startStr <= todayStr && effectiveEnd >= todayStr;
}

function readHolidaySet_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName('Holidays');
  const lastRow = sheet.getLastRow();
  const data = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, 1).getDisplayValues() : [];
  const set = new Set();
  data.forEach(([cell]) => {
    const dateStr = String(cell || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) set.add(dateStr);
  });
  return set;
}

const THAI_MONTH_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

function thaiShortDate_(dateStr) {
  const parts = String(dateStr).split('-').map(Number);
  return parts[2] + ' ' + THAI_MONTH_SHORT[parts[1] - 1] + ' ' + (parts[0] + 543);
}

/** ป้ายวันที่ของใบลา เช่น "20 ส.ค. 2569" หรือ "20–22 ส.ค. 2569" หรือข้ามเดือน "30 ส.ค. – 2 ก.ย. 2569" */
function leaveDateLabel_(startStr, endStr) {
  if (!endStr || endStr === startStr) return thaiShortDate_(startStr);
  const s = startStr.split('-').map(Number);
  const e = endStr.split('-').map(Number);
  if (s[0] === e[0] && s[1] === e[1]) {
    return s[2] + '–' + e[2] + ' ' + THAI_MONTH_SHORT[s[1] - 1] + ' ' + (s[0] + 543);
  }
  return thaiShortDate_(startStr) + ' – ' + thaiShortDate_(endStr);
}

// ---------- API actions ----------

function apiSession_(body) {
  const profile = verifyLineToken_(requireAccessToken_(body));
  const roster = readStaffRoster_();
  const staff = findStaffByUserId_(roster, profile.userId);
  if (staff) {
    return {
      ok: true, registered: true,
      name: staffDisplayName_(staff), groupName: staff.groupName, level: staff.level,
    };
  }
  return {
    ok: true, registered: false,
    staffNames: roster.filter(s => !s.lineUserId).map(s => s.name),
  };
}

function apiBind_(body) {
  const profile = verifyLineToken_(requireAccessToken_(body));
  const staffName = String(body.staffName || '').trim();
  const prefix = String(body.prefix || '').trim().substring(0, 30);
  if (!staffName) throw new Error('กรุณาเลือกชื่อของคุณ');
  if (!prefix) throw new Error('กรุณากรอกคำนำหน้าชื่อ');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('ระบบ busy ลองอีกครั้ง');
  try {
    const roster = readStaffRoster_();
    const staff = findStaffByName_(roster, staffName);
    if (!staff) throw new Error('ไม่พบชื่อนี้ในทำเนียบ — ตรวจการสะกดหรือติดต่อผู้ดูแล');
    if (staff.lineUserId && staff.lineUserId !== profile.userId) {
      throw new Error('ชื่อนี้ถูกลงทะเบียนไปแล้ว — หากคุณคือเจ้าของชื่อนี้จริง ติดต่อผู้ดูแลให้ล้างการลงทะเบียนเดิม');
    }
    const todayStr = bangkokTodayStr_();
    const sheet = SpreadsheetApp.getActive().getSheetByName('Staff');
    sheet.getRange(staff.row, 4).setValue(prefix);
    sheet.getRange(staff.row, 5).setValue(profile.userId);
    sheet.getRange(staff.row, 6).setValue(profile.displayName);
    sheet.getRange(staff.row, 7).setValue(todayStr);

    const fullName = (prefix ? prefix + ' ' : '') + staff.name;
    // แจ้งเข้ากลุ่มหลักทุกครั้งที่มีการผูกชื่อ ให้ผู้ดูแลเทียบ "ชื่อใน LINE" กับ "ชื่อที่เลือก" เป็นชั้นตรวจ
    try {
      sendLineMessage_(getSettings_().line_group_id, {
        type: 'text',
        text: '🔔 ระบบลางาน: ' + (profile.displayName || '(ไม่ทราบชื่อ LINE)') +
          ' ลงทะเบียนเป็น ' + fullName +
          (staff.groupName ? ' (' + staff.groupName + ')' : '') + ' แล้ว',
      });
    } catch (notifyErr) {
      logResult_(new Date(), 'leave-bind', 'แจ้งกลุ่มไม่สำเร็จ: ' + notifyErr);
    }
    logResult_(new Date(), 'leave-bind', fullName + ' ← ' + profile.userId);
    return {
      ok: true, registered: true,
      name: fullName, groupName: staff.groupName, level: staff.level,
    };
  } finally {
    lock.releaseLock();
  }
}

function splitDirectorTypes_(settingValue) {
  return String(settingValue || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function apiSubmit_(body) {
  const profile = verifyLineToken_(requireAccessToken_(body));
  const roster = readStaffRoster_();
  const staff = findStaffByUserId_(roster, profile.userId);
  if (!staff) throw new Error('ยังไม่ได้ลงทะเบียน — ปิดหน้านี้แล้วเปิดใหม่เพื่อเลือกชื่อของคุณก่อน');
  if (staff.level === STAFF_LEVEL.director) {
    throw new Error('การลาของ ' + STAFF_LEVEL.director + ' ยื่นผ่านช่องทางเดิมของหน่วยงาน (นอกระบบนี้)');
  }

  const leaveType = String(body.leaveType || '').trim();
  if (!LEAVE_TYPES.includes(leaveType)) throw new Error('ประเภทการลาไม่ถูกต้อง');
  const reason = String(body.reason || '').trim().substring(0, 500);
  const range = parseLeaveDateRange_(body.start, body.end, bangkokTodayStr_());

  const settings = getSettings_();
  const leaveDbId = String(settings.leave_database_id || '').trim();
  if (!leaveDbId || leaveDbId === 'your_leave_database_id') {
    throw new Error('ระบบยังไม่พร้อมใช้งาน (ผู้ดูแลยังไม่ได้ตั้งค่า leave_database_id)');
  }

  const needsDirector = splitDirectorTypes_(settings.leave_types_needing_director).includes(leaveType);
  const workDays = countBusinessDays_(range.start, range.end, readHolidaySet_());
  const approver = findApproverForStaff_(roster, staff);

  const payload = buildLeavePagePayload_({
    dataSourceId: resolveLeaveDataSourceId_(leaveDbId),
    fullName: staffDisplayName_(staff),
    groupName: staff.groupName,
    submitterUserId: staff.lineUserId,
    leaveType: leaveType,
    start: range.start,
    end: range.end,
    reason: reason,
    workDays: workDays,
    initialStatus: approver.level === STAFF_LEVEL.chief
      ? LEAVE_STATUS.pendingChief
      : LEAVE_STATUS.pendingDirector,
    currentApprover: serializeApproverInfo_(approver),
  });

  const page = createNotionLeavePage_(payload);
  const leavePage = parseLeavePage_(page);

  const card = buildLeaveApprovalBubble_(leavePage);
  let approverLabel;
  if (approver.mode === 'user') {
    const userIds = approver.approvers.map(s => s.lineUserId);
    approverLabel = approver.approvers.map(s => staffDisplayName_(s) + ' (' + s.level + ')').join(', ');
    pushApproverCardWithFallback_(userIds, card, leavePage);
  } else {
    // ไม่มีผู้อนุมัติรายคนเลย — การ์ดเข้ากลุ่มหลัก ให้หัวหน้า/ผอ. ที่ลงทะเบียนแล้วกดปุ่มแทน
    approverLabel = 'กลุ่ม LINE หลัก (หัวหน้ากลุ่มงาน/ผอ. กดอนุมัติได้)';
    try {
      sendLineMessage_(settings.line_group_id, card);
    } catch (err) {
      logResult_(new Date(), 'error', 'ส่งการ์ดขออนุมัติเข้ากลุ่มไม่สำเร็จ: ' + err);
      throw new Error('ส่งเรื่องให้ผู้อนุมัติไม่สำเร็จ โปรดลองอีกครั้ง (หากยังไม่สำเร็จติดต่อผู้ดูแล)');
    }
    logResult_(new Date(), 'leave', 'ใบลา ' + leavePage.fullName + ' ส่งเข้ากลุ่มหลัก (ไม่มีผู้อนุมัติรายคน)');
  }

  logResult_(new Date(), 'leave',
    leavePage.fullName + ' ยื่น' + leaveType + ' ' + leaveDateLabel_(range.start, range.end) +
    ' (' + workDays + ' วันทำการ) → ' + approverLabel);

  return {
    ok: true,
    workDays: workDays,
    approverName: approverLabel,
    needsDirector: needsDirector,
  };
}

function apiCalendar_(body) {
  verifyLineToken_(requireAccessToken_(body)); // ปิดกั้นคนที่ไม่ได้เข้าผ่าน LINE แม้ข้อมูลวันหยุดไม่ละเอียดอ่อน
  return { ok: true, holidays: Array.from(readHolidaySet_()), today: bangkokTodayStr_() };
}

// ---------- Notion: สร้าง/อ่าน/แก้ใบลา ----------

function resolveLeaveDataSourceId_(databaseId) {
  if (!databaseId || String(databaseId).trim() === 'your_leave_database_id') {
    throw new Error('ยังไม่ได้ตั้งค่า leave_database_id ในชีต Settings');
  }
  return resolveDataSourceId_(databaseId);
}

function richTextValue_(text) {
  return { rich_text: [{ text: { content: String(text == null ? '' : text) } }] };
}

/** สร้าง payload สร้างหน้าใบลา (pure — ทดสอบได้โดยไม่ยิง Notion) */
function buildLeavePagePayload_(leave) {
  return {
    parent: { data_source_id: leave.dataSourceId },
    properties: {
      [PROPS_LEAVE.title]: { title: [{ text: { content: leave.fullName } }] },
      [PROPS_LEAVE.groupName]: richTextValue_(leave.groupName),
      [PROPS_LEAVE.submitter]: richTextValue_(leave.submitterUserId),
      [PROPS_LEAVE.type]: { select: { name: leave.leaveType } },
      [PROPS_LEAVE.date]: { date: { start: leave.start, end: leave.end } },
      [PROPS_LEAVE.reason]: richTextValue_(leave.reason),
      [PROPS_LEAVE.status]: { select: { name: leave.initialStatus } },
      [PROPS_LEAVE.currentApprover]: richTextValue_(leave.currentApprover),
      [PROPS_LEAVE.workDays]: { number: leave.workDays },
    },
  };
}

function serializeApproverInfo_(approver) {
  if (approver.mode === 'level') {
    return JSON.stringify({ mode: 'level', level: approver.level });
  }
  return JSON.stringify({
    mode: 'user',
    level: approver.level,
    userIds: approver.approvers.map(s => s.lineUserId),
    names: approver.approvers.map(s => staffDisplayName_(s)),
  });
}

function createNotionLeavePage_(payload) {
  const response = UrlFetchApp.fetch('https://api.notion.com/v1/pages', {
    method: 'post',
    contentType: 'application/json',
    headers: notionHeaders_(),
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() >= 300) {
    throw new Error('บันทึกใบลาลง Notion ไม่สำเร็จ (' + response.getResponseCode() + '): ' +
      response.getContentText().substring(0, 200));
  }
  return JSON.parse(response.getContentText());
}

function getLeavePage_(pageId) {
  const response = UrlFetchApp.fetch('https://api.notion.com/v1/pages/' + pageId, {
    method: 'get',
    headers: notionHeaders_(),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() >= 300) {
    throw new Error('เปิดใบลาจาก Notion ไม่ได้ (' + response.getResponseCode() + '): ' +
      response.getContentText().substring(0, 200));
  }
  return JSON.parse(response.getContentText());
}

function updateLeavePage_(pageId, properties) {
  const response = UrlFetchApp.fetch('https://api.notion.com/v1/pages/' + pageId, {
    method: 'patch',
    contentType: 'application/json',
    headers: notionHeaders_(),
    payload: JSON.stringify({ properties: properties }),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() >= 300) {
    throw new Error('อัปเดตใบลาใน Notion ไม่สำเร็จ (' + response.getResponseCode() + '): ' +
      response.getContentText().substring(0, 200));
  }
  return JSON.parse(response.getContentText());
}

/** แปลงหน้า Notion เป็นข้อมูลใบลาที่ใช้ภายใน (pure) */
function parseLeavePage_(page) {
  const props = (page && page.properties) || {};
  const dateProp = (props[PROPS_LEAVE.date] && props[PROPS_LEAVE.date].date) || {};
  let approverInfo = null;
  try {
    approverInfo = JSON.parse(plainText_(props[PROPS_LEAVE.currentApprover] && props[PROPS_LEAVE.currentApprover].rich_text)) || null;
  } catch (err) {
    approverInfo = null;
  }
  return {
    pageId: (page && page.id) || '',
    pageUrl: (page && page.url) || '',
    fullName: plainText_(props[PROPS_LEAVE.title] && props[PROPS_LEAVE.title].title),
    groupName: plainText_(props[PROPS_LEAVE.groupName] && props[PROPS_LEAVE.groupName].rich_text),
    submitterUserId: plainText_(props[PROPS_LEAVE.submitter] && props[PROPS_LEAVE.submitter].rich_text),
    leaveType: ((props[PROPS_LEAVE.type] && props[PROPS_LEAVE.type].select) || {}).name || '',
    start: dateProp.start || '',
    end: dateProp.end || '',
    reason: plainText_(props[PROPS_LEAVE.reason] && props[PROPS_LEAVE.reason].rich_text),
    status: ((props[PROPS_LEAVE.status] && props[PROPS_LEAVE.status].select) || {}).name || '',
    currentApprover: approverInfo,
    audit: plainText_(props[PROPS_LEAVE.audit] && props[PROPS_LEAVE.audit].rich_text),
    workDays: (props[PROPS_LEAVE.workDays] && props[PROPS_LEAVE.workDays].number) || 0,
  };
}

// ---------- การ์ดขออนุมัติ (Flex) ----------

/** สร้างการ์ดขออนุมัติจากข้อมูลหน้า Notion ล้วนๆ — ใช้ได้ทั้งขั้นหัวหน้าและขั้นส่งต่อ ผอ. */
function buildLeaveApprovalBubble_(leavePage) {
  const dateLabel = leaveDateLabel_(leavePage.start, leavePage.end);
  const fields = [
    { label: 'กลุ่มงาน', value: leavePage.groupName },
    { label: 'ประเภท', value: leavePage.leaveType },
    { label: 'วันที่ลา', value: dateLabel },
    { label: 'วันทำการ', value: String(leavePage.workDays) + ' วัน' },
    { label: 'เหตุผล', value: leavePage.reason || '—' },
  ].filter(f => f.value);

  const fieldBoxes = fields.map(f => ({
    type: 'box',
    layout: 'baseline',
    margin: 'sm',
    contents: [
      { type: 'text', text: f.label + ':', size: 'xs', weight: 'bold', color: '#717875', flex: 2, wrap: true },
      { type: 'text', text: f.value, size: 'xs', color: '#4A4A4A', wrap: true, flex: 5 },
    ],
  }));

  const postbackData = action => JSON.stringify({ t: 'leave', a: action, p: leavePage.pageId });

  return {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#B45309',
      paddingAll: '16px',
      contents: [
        { type: 'text', text: 'คำขออนุมัติการลา', color: '#FDE8CD', size: 'xxs' },
        { type: 'text', text: leavePage.fullName, color: '#FFFFFF', weight: 'bold', size: 'lg', wrap: true, margin: 'sm' },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '0px',
      contents: [
        { type: 'box', layout: 'vertical', height: '3px', backgroundColor: '#9AA6A1', contents: [{ type: 'filler' }] },
        { type: 'box', layout: 'vertical', paddingAll: '16px', contents: fieldBoxes },
      ],
    },
    footer: {
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      paddingAll: '12px',
      contents: [
        {
          type: 'button',
          height: 'sm',
          style: 'primary',
          action: { type: 'postback', label: 'อนุมัติ', displayText: 'อนุมัติ', data: postbackData('approve') },
        },
        {
          type: 'button',
          height: 'sm',
          style: 'danger',
          action: { type: 'postback', label: 'ไม่อนุมัติ', displayText: 'ไม่อนุมัติ', data: postbackData('reject') },
        },
      ],
    },
    styles: { footer: { separator: true, separatorColor: '#DCE5E1' } },
  };
}

// ---------- ส่งข้อความ LINE ----------

function sendLineMulticast_(userIds, messageObj) {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) throw new Error('ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN ใน Script Properties');
  const response = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/multicast', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ to: userIds, messages: [messageObj] }),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() >= 300) {
    throw new Error('LINE multicast ล้มเหลว (' + response.getResponseCode() + '): ' + response.getContentText());
  }
}

/**
 * push การ์ดขออนุมัติหาผู้อนุมัติรายคน — ถ้าพัง (ยังไม่แอดบอท/บล็อก) ให้ fallback เข้ากลุ่มหลัก
 * (ใช้กับการ์ดขออนุมัติเท่านั้น เพราะเป็นข้อมูลที่หน่วยงานเห็นได้อยู่แล้วผ่านข้อความเช้า)
 */
function pushApproverCardWithFallback_(userIds, messageObj, leavePage) {
  try {
    if (userIds.length === 1) sendLineMessage_(userIds[0], messageObj);
    else sendLineMulticast_(userIds, messageObj);
    return true;
  } catch (err) {
    logResult_(new Date(), 'leave-push-fallback',
      'push หาผู้อนุมัติไม่สำเร็จ (อาจยังไม่แอดบอท) ส่งเข้ากลุ่มหลักแทน: ' + err);
    sendLineMessage_(getSettings_().line_group_id, messageObj);
    return false;
  }
}

/** push ข้อความส่วนตัวหาคนเดียว — ไม่ fallback เข้ากลุ่มเด็ดขาด (ผลการลาเป็นเรื่องส่วนตัว) */
function pushPrivateMessage_(userId, messageObj) {
  if (!userId) return false;
  try {
    sendLineMessage_(userId, messageObj);
    return true;
  } catch (err) {
    logResult_(new Date(), 'leave-push-fail', 'push หา ' + userId + ' ไม่สำเร็จ (อาจยังไม่แอดบอท/บล็อก): ' + err);
    return false;
  }
}

// ---------- รับปุ่มอนุมัติจาก webhook (เรียกจาก doPost ใน Webhook.gs) ----------

function formatAuditLine_(approverStaff, actionLabel) {
  const stamp = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'dd/MM/yy HH:mm');
  return stamp + ' ' + staffDisplayName_(approverStaff) + '(' + approverStaff.level + ') ' + actionLabel;
}

function leaveSummaryText_(leavePage) {
  return 'ประเภท: ' + leavePage.leaveType +
    '\nวันที่: ' + leaveDateLabel_(leavePage.start, leavePage.end) +
    (leavePage.workDays ? ' (' + leavePage.workDays + ' วันทำการ)' : '');
}

function handleLeavePostback_(event, webhookEventId) {
  try {
    // LINE ยิง webhook ซ้ำเมื่อตอบช้า — เก็บ webhookEventId กันประมวลผลซ้ำ
    if (webhookEventId) {
      const cache = CacheService.getScriptCache();
      const dedupKey = 'wh_' + webhookEventId;
      if (cache.get(dedupKey)) return;
      cache.put(dedupKey, '1', 600);
    }

    const data = JSON.parse(event.postback.data || '{}');
    if (data.t !== 'leave') return;
    const tapperUserId = (event.source || {}).userId || '';

    const page = getLeavePage_(data.p);
    const leavePage = parseLeavePage_(page);
    const roster = readStaffRoster_();

    const isPending = leavePage.status === LEAVE_STATUS.pendingChief || leavePage.status === LEAVE_STATUS.pendingDirector;
    if (!isPending) {
      pushPrivateMessage_(tapperUserId, {
        type: 'text',
        text: 'ใบลานี้ดำเนินการไปแล้ว (สถานะปัจจุบัน: ' + (leavePage.status || 'ไม่ทราบ') + ')',
      });
      return;
    }

    const verdict = canApproveLeave_(leavePage.currentApprover, tapperUserId, roster);
    if (!verdict.ok) {
      pushPrivateMessage_(tapperUserId, {
        type: 'text',
        text: 'คุณไม่ใช่ผู้อนุมัติของใบลานี้',
      });
      logResult_(new Date(), 'leave-approve', 'ผู้ไม่มีสิทธิ์กดปุ่มใบลา ' + leavePage.fullName + ': ' + tapperUserId);
      return;
    }
    const tapper = verdict.staff;
    const settings = getSettings_();

    const auditBase = leavePage.audit ? leavePage.audit + '\n' : '';
    const isApprove = data.a === 'approve';
    const actionLabel = isApprove ? 'อนุมัติ' : 'ไม่อนุมัติ';
    const auditText = auditBase + formatAuditLine_(tapper, actionLabel);

    // อนุมัติขั้นหัวหน้า + ประเภทนี้ต้องไปต่อ ผอ. → เปลี่ยนขั้นแทนจบ
    const needsDirector = splitDirectorTypes_(settings.leave_types_needing_director).includes(leavePage.leaveType);
    if (isApprove && leavePage.status === LEAVE_STATUS.pendingChief && needsDirector) {
      const directors = findDirectors_(roster);
      const nextApprover = directors.length
        ? { mode: 'user', level: STAFF_LEVEL.director, approvers: directors }
        : { mode: 'level', level: STAFF_LEVEL.director };
      updateLeavePage_(leavePage.pageId, {
        [PROPS_LEAVE.status]: { select: { name: LEAVE_STATUS.pendingDirector } },
        [PROPS_LEAVE.currentApprover]: richTextValue_(serializeApproverInfo_(nextApprover)),
        [PROPS_LEAVE.audit]: richTextValue_(auditText),
      });

      if (directors.length) {
        pushApproverCardWithFallback_(
          directors.map(s => s.lineUserId),
          buildLeaveApprovalBubble_(Object.assign({}, leavePage, { status: LEAVE_STATUS.pendingDirector })),
          leavePage
        );
      } else {
        try {
          sendLineMessage_(settings.line_group_id, buildLeaveApprovalBubble_(
            Object.assign({}, leavePage, { status: LEAVE_STATUS.pendingDirector })));
        } catch (err) {
          logResult_(new Date(), 'error', 'ส่งการ์ดขั้น ผอ. เข้ากลุ่มไม่สำเร็จ: ' + err);
        }
      }
      pushPrivateMessage_(leavePage.submitterUserId, {
        type: 'text',
        text: '⏳ หัวหน้ากลุ่มงานอนุมัติแล้ว รอ ' + STAFF_LEVEL.director + ' พิจารณาต่อ\n' + leaveSummaryText_(leavePage),
      });
      logResult_(new Date(), 'leave-approve', leavePage.fullName + ' ผ่านขั้นหัวหน้า รอ ' + STAFF_LEVEL.director);
      return;
    }

    // จบการอนุมัติ (อนุมัติขั้นสุดท้าย หรือไม่อนุมัติทุกขั้น)
    const finalStatus = isApprove ? LEAVE_STATUS.approved : LEAVE_STATUS.rejected;
    updateLeavePage_(leavePage.pageId, {
      [PROPS_LEAVE.status]: { select: { name: finalStatus } },
      [PROPS_LEAVE.currentApprover]: richTextValue_(''),
      [PROPS_LEAVE.audit]: richTextValue_(auditText),
    });
    pushPrivateMessage_(leavePage.submitterUserId, {
      type: 'text',
      text: (isApprove ? '✅ ใบลาของคุณได้รับการอนุมัติ' : '❌ ใบลาไม่ได้รับการอนุมัติ') +
        '\n' + leaveSummaryText_(leavePage) +
        '\nโดย: ' + staffDisplayName_(tapper) + ' (' + tapper.level + ')',
    });
    pushPrivateMessage_(tapperUserId, {
      type: 'text',
      text: 'บันทึกแล้ว: ' + actionLabel + 'ใบลาของ ' + leavePage.fullName,
    });
    logResult_(new Date(), 'leave-approve', leavePage.fullName + ' ' + finalStatus + ' โดย ' + staffDisplayName_(tapper));
  } catch (err) {
    // ไม่ throw กลับไปหา LINE (เดี๋ยวถูก retry รัวๆ) — เก็บไว้ดูใน Logs/Executions
    logResult_(new Date(), 'error', 'ประมวลผลปุ่มใบลาไม่สำเร็จ: ' + err);
  }
}

// ---------- ดึงใบลาที่อนุมัติแล้วสำหรับสรุปเช้า (เรียกจาก Code.gs) ----------

/**
 * คืนใบลาสถานะ "อนุมัติ" ที่คร่อม todayStr (แสดงเฉพาะที่อนุมัติแล้ว — ใบที่ยังรอไม่เปิดเผย
 * ให้สอดคล้องกับหลักความเป็นส่วนตัวของการอนุมัติแบบ 1:1)
 * ถ้ายังไม่ได้ตั้งค่า leave_database_id จะคืน [] พร้อม log ให้เห็นว่าข้ามส่วนนี้ไป (ไม่กระทบการส่งเช้าหลัก)
 */
function getApprovedLeavesForDay_(now, leaveDatabaseId) {
  const dbId = String(leaveDatabaseId || '').trim();
  if (!dbId || dbId === 'your_leave_database_id') {
    logResult_(now, 'skip-leave', 'ยังไม่ได้ตั้งค่า leave_database_id — ข้ามส่วนผู้ลาวันนี้');
    return [];
  }
  const todayStr = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd');
  const dataSourceId = resolveLeaveDataSourceId_(dbId);
  const payload = {
    filter: { property: PROPS_LEAVE.status, select: { equals: LEAVE_STATUS.approved } },
    sorts: [{ property: PROPS_LEAVE.date, direction: 'descending' }],
    page_size: 100,
  };
  const response = UrlFetchApp.fetch('https://api.notion.com/v1/data_sources/' + dataSourceId + '/query', {
    method: 'post',
    contentType: 'application/json',
    headers: notionHeaders_(),
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() >= 300) {
    throw new Error('ดึงใบลาจาก Notion ไม่สำเร็จ (' + response.getResponseCode() + '): ' + response.getContentText());
  }
  const data = JSON.parse(response.getContentText());
  return (data.results || [])
    .map(parseLeavePage_)
    // กรอง overlap ฝั่งโค้ดแทนฝาก semantics ของ date-range filter ไว้กับ Notion (ดูหมายเหตุใน getNotionItemsForDay_)
    .filter(leave => leave.start && leaveRangeOverlap_(leave.start, leave.end, todayStr))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'th'));
}

/** ป้ายแสดงผลในสรุปเช้า เช่น "นายสมศักดิ์ ใจดี (กลุ่มงานคลัง) — ลากิจ 20–22 ส.ค. 2569" */
function leaveSummaryLabel_(leave) {
  return leave.fullName +
    (leave.groupName ? ' (' + leave.groupName + ')' : '') +
    ' — ' + leave.leaveType + ' ' + leaveDateLabel_(leave.start, leave.end);
}

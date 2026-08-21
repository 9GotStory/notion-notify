/**
 * ระบบลางานเจ้าหน้าที่ — ใช้ LIFF เป็นหน้ายื่น (โฮสต์ GitHub Pages), Notion เป็นที่เก็บใบลา,
 * LINE OA เป็นช่องทางแจ้ง/อนุมัติ
 *
 * การระบุตัวตน: ผูก LINE userId กับชื่อในชีต Staff ครั้งเดียว (first-claim-wins — ชื่อที่ถูกผูกแล้ว
 * ใครมาเลือกซ้ำไม่ได้) ทุกคำขอจาก LIFF ต้องแนบ access token และฝั่งเซิร์ฟเวอร์ตรวจกับ LINE จริงทุกครั้ง
 * (api.line.me/oauth2/v2.1/verify + /v2/profile) — ไม่เชื่อข้อมูลใดๆ ที่มาจากฝั่ง browser
 *
 * การอนุมัติสองชั้น (คอนฟิกทั้งหมดในชีต ไม่มี hardcode): ผู้อนุมัติของกลุ่มงาน → หัวหน้า สสอ.
 * (ชีต Approvers กำหนดว่ากลุ่มงานไหนใครอนุมัติ + ต้องส่งต่อ หัวหน้า สสอ. ไหม; รายชื่อ หัวหน้า สสอ. อยู่ใน Settings คีย์ second_approvers)
 * การ์ดส่งหาผู้อนุมัติแบบ 1:1 พร้อมปุ่ม postback อนุมัติ/ไม่อนุมัติ
 * การตรวจสิทธิ์คนกดปุ่มอ้างอิง "ผู้อนุมัติปัจจุบัน" ที่เก็บในหน้า Notion (ดู canApproveLeave_)
 * — เป็นชั้นป้องกันหลักแทนการตรวจ X-Line-Signature ที่ Apps Script เข้าถึง header นี้ไม่ได้
 *
 * โครงสร้างชีต Staff (สร้างหัวตารางโดยเมนู "เตรียม/ตรวจสอบชีตทั้งหมด" — แถวข้อมูลเกิดจากการลงทะเบียน
 * ของแต่ละคนผ่านฟอร์มเอง ไม่ต้องกรอกล่วงหน้า):
 *   แถว 1: ชื่อตาราง / แถว 2: หัวคอลัมน์ / เริ่มข้อมูลแถว 3 (ตามแบบชีต Settings/Holidays)
 *   คำนำหน้า | ชื่อ | สกุล | กลุ่มงาน | ตำแหน่ง | LINE User ID | ชื่อที่แสดงใน LINE | วันที่ลงทะเบียน
 *
 * โครงสร้างชีต Approvers (ผู้ดูแลกรอกเอง — เป็นทั้งคอนฟิกผู้อนุมัติและรายชื่อกลุ่มงานสำหรับ dropdown):
 *   กลุ่มงาน | ผู้อนุมัติ (ชื่อ สกุล ตามที่ลงทะเบียน หลายคนคั่นจุลภาค ใครกดก่อนได้ก่อน)
 *   | ส่งต่อให้ หัวหน้า สสอ. (TRUE ถ้าใบลาของกลุ่มงานนี้ต้องผ่าน หัวหน้า สสอ. ด้วย)
 *   รายชื่อ หัวหน้า สสอ. อยู่ใน Settings คีย์ second_approvers (คั่นจุลภาค)
 *   ตัวเลือก dropdown ของฟอร์มลงทะเบียน (คำนำหน้า/กลุ่มงาน/ตำแหน่ง) มาจาก prefix_options /
 *   ชีต Approvers (คอลัมน์กลุ่มงาน) / position_options ตามลำดับ — แก้ที่ชีตได้ทั้งหมด
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
  pendingApprover: 'รอผู้อนุมัติ',
  pendingChiefOffice: 'รอหัวหน้า สสอ.อนุมัติ',
  approved: 'อนุมัติ',
  rejected: 'ไม่อนุมัติ',
  cancelled: 'ยกเลิก',
};

const LEAVE_TYPES = ['ลาป่วย', 'ลากิจ', 'ลาพักร้อน', 'ลาคลอด', 'ลาบวช', 'อื่นๆ'];

// การอนุมัติไม่ hardcode ในโค้ด — อ่านจากชีต Approvers (กลุ่มงาน → ผู้อนุมัติ → ส่งต่อ หัวหน้า สสอ. ไหม)
// และ Settings คีย์ second_approvers (รายชื่อ หัวหน้า สสอ.) — แก้ที่ชีตได้เสมอไม่ต้องแตะโค้ด
const APPROVERS_SHEET_COLUMNS = [
  'กลุ่มงาน',
  'ผู้อนุมัติ (ชื่อ สกุล — หลายคนคั่นด้วยจุลภาค)',
  'ส่งต่อให้ หัวหน้า สสอ. (TRUE)',
];

const STAFF_SHEET_COLUMNS = [
  'คำนำหน้า', 'ชื่อ', 'สกุล', 'กลุ่มงาน', 'ตำแหน่ง',
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

// ---------- ทำเนียบ Staff (เกิดจากการลงทะเบียนผ่านฟอร์ม ไม่ต้องกรอกล่วงหน้า) ----------

function readStaffRoster_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName('Staff');
  if (!sheet) {
    throw new Error('ยังไม่ได้เตรียมระบบลางาน — ใช้เมนู "ระบบแจ้งเตือนปฏิทิน > เตรียม/ตรวจสอบชีตทั้งหมด" ก่อน');
  }
  const lastRow = sheet.getLastRow();
  const data = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, STAFF_SHEET_COLUMNS.length).getDisplayValues() : [];
  return data
    .filter(row => String(row[1]).trim() && String(row[2]).trim()) // ต้องมีทั้งชื่อและสกุลจึงนับ
    .map((row, i) => ({
      row: 3 + i,
      prefix: String(row[0]).trim(),
      firstName: String(row[1]).trim(),
      lastName: String(row[2]).trim(),
      groupName: String(row[3]).trim(),
      position: String(row[4]).trim(),
      lineUserId: String(row[5]).trim(),
      lineDisplayName: String(row[6]).trim(),
      registeredAt: String(row[7]).trim(),
    }));
}

function findStaffByUserId_(roster, userId) {
  return (roster || []).find(s => s.lineUserId && s.lineUserId === userId) || null;
}

// "ชื่อ สกุล" — key ที่ใช้อ้างอิงคนในชีต Approvers และ Settings (second_approvers)
// ยุบช่องว่างซ้ำให้เหลือช่องเดียว เพื่อให้ "สมศักดิ์  ใจดี" (เว้น2ช่อง) จับคู่กับที่ผู้ดูแลพิมพ์ได้
function staffKey_(staff) {
  return staff ? (staff.firstName + ' ' + staff.lastName).trim().replace(/\s+/g, ' ') : '';
}

// ชื่อเต็มสำหรับแสดงผล = คำนำหน้า + ชื่อ + สกุล
function staffDisplayName_(staff) {
  if (!staff) return '';
  return (staff.prefix ? staff.prefix + ' ' : '') + staffKey_(staff);
}

// ---------- คอนฟิกผู้อนุมัติ (ชีต Approvers + Settings) — ไม่มีการ hardcode ระดับใดๆ ในโค้ด ----------

function readApproversConfig_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName('Approvers');
  if (!sheet) {
    throw new Error('ยังไม่มีชีต Approvers — ใช้เมนู "ระบบแจ้งเตือนปฏิทิน > เตรียม/ตรวจสอบชีตทั้งหมด" ก่อน');
  }
  const lastRow = sheet.getLastRow();
  const data = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, APPROVERS_SHEET_COLUMNS.length).getDisplayValues() : [];
  return data
    .filter(row => String(row[0]).trim())
    .map((row, i) => ({
      row: 3 + i,
      groupName: String(row[0]).trim(),
      approverNames: splitConfigNames_(row[1]),
      forward: String(row[2]).trim().toUpperCase() === 'TRUE',
    }));
}

// แยกรายชื่อ/ตัวเลือกที่คั่นด้วยจุลภาคจากชีต (pure) — ยุบช่องว่างซ้ำให้ตรงกับ staffKey_
function splitConfigNames_(value) {
  return String(value || '')
    .split(',')
    .map(s => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}

// รายชื่อ หัวหน้า สสอ. จาก Settings
function secondApproverNames_(settings) {
  return splitConfigNames_(settings.second_approvers);
}

// คนที่ลงทะเบียนแล้วและชื่อตรงกับรายชื่อที่กำหนด (เอา userId ไม่ได้ = ยังไม่พร้อมรับการ์ด)
function registeredStaffByNames_(roster, names) {
  return (roster || []).filter(s => s.lineUserId && names.includes(staffKey_(s)));
}

// พูลผู้อนุมัติทั้งหมดที่กำหนดไว้ในระบบ (ทุกกลุ่มงาน + หัวหน้า สสอ.) ที่ลงทะเบียนแล้ว
// ใช้เป็นเฟืองพื้นสุดท้ายเมื่อผู้อนุมัติเฉพาะกลุ่มยังไม่พร้อม (การ์ดเข้ากลุ่มหลัก ใครในพูลกดได้)
function allApproverPool_(config, settings, roster, excludeKey) {
  const names = new Set();
  config.forEach(c => c.approverNames.forEach(n => names.add(n)));
  secondApproverNames_(settings).forEach(n => names.add(n));
  return (roster || []).filter(s =>
    s.lineUserId && names.has(staffKey_(s)) && staffKey_(s) !== excludeKey);
}

/**
 * คำนวณเส้นทางการอนุมัติของใบลาใหม่จากคอนฟิกทั้งหมด (pure — ทดสอบได้):
 * คืน { stage:'first'|'second', targets:[staff...], needsSecond } หรือ throw เป็นภาษาไทยเมื่อคอนฟิกยังใช้ไม่ได้
 *   stage 'first'  = เริ่มที่ผู้อนุมัติของกลุ่มงาน (หรือพูลสำรองเมื่อผู้อนุมัติของกลุ่มยังไม่ลงทะเบียน)
 *   stage 'second' = ข้ามไป หัวหน้า สสอ. เลย (ผู้ยื่นคือผู้อนุมัติของกลุ่มตัวเอง หรือกลุ่มส่งต่อและผู้อนุมัติไม่พร้อม)
 */
function resolveApprovalChain_(config, settings, roster, submitter) {
  const submitterKey = staffKey_(submitter);
  if (secondApproverNames_(settings).includes(submitterKey)) {
    throw new Error('การลาของ หัวหน้า สสอ. ยื่นผ่านช่องทางเดิมของหน่วยงาน (นอกระบบนี้)');
  }
  const row = (config || []).find(c => c.groupName === submitter.groupName);
  if (!row) {
    throw new Error('กลุ่มงาน ' + submitter.groupName + ' ยังไม่ได้ตั้งค่าผู้อนุมัติในชีต Approvers — ติดต่อผู้ดูแล');
  }

  const needsSecond = row.forward;
  const second = registeredStaffByNames_(roster, secondApproverNames_(settings))
    .filter(s => staffKey_(s) !== submitterKey);
  const first = registeredStaffByNames_(roster, row.approverNames)
    .filter(s => staffKey_(s) !== submitterKey);
  const submitterIsApprover = row.approverNames.includes(submitterKey);

  // ผู้ยื่นคือผู้อนุมัติของกลุ่มตัวเอง → ไม่อนุมัติใบลาของตัวเอง ส่งต่อ หัวหน้า สสอ. ทันที
  if (submitterIsApprover) {
    if (needsSecond && second.length) return { stage: 'second', targets: second, needsSecond: true };
    throw new Error('คุณเป็นผู้อนุมัติของกลุ่มงานนี้ — ให้เปิดช่อง "ส่งต่อให้ หัวหน้า สสอ." ในชีต Approvers ก่อนจึงจะยื่นลาได้');
  }

  if (first.length) return { stage: 'first', targets: first, needsSecond: needsSecond };

  // ผู้อนุมัติของกลุ่มยังไม่ลงทะเบียน → ขึ้นไปเริ่มที่ หัวหน้า สสอ. แทน ถ้าเปิดส่งต่อไว้
  if (needsSecond && second.length) {
    return { stage: 'second', targets: second, needsSecond: true, viaFallback: true };
  }
  // ยังไม่มีใครพร้อมเป็นการ์ดแรก → ใช้พูลผู้อนุมัติทั้งหมด (การ์ดจะเข้ากลุ่มหลัก)
  const pool = allApproverPool_(config, settings, roster, submitterKey);
  if (pool.length) {
    return { stage: 'first', targets: pool, needsSecond: needsSecond, viaPool: true };
  }
  throw new Error('ผู้อนุมัติของกลุ่มงานคุณยังไม่ได้ลงทะเบียนในระบบ — ให้ผู้อนุมัติเปิดฟอร์มลงทะเบียนก่อน');
}

/**
 * ตรวจสิทธิ์ผู้กดปุ่มอนุมัติตาม "ผู้อนุมัติปัจจุบัน" ที่เก็บในหน้า Notion
 * (JSON {stage, userIds, names} — เขียนตอนส่งการ์ด/เปลี่ยนขั้น ผู้ปลอมต้องรู userId ของผู้อนุมัติจริงจึงผ่านได้)
 * คืน true เมื่อ userId ของผู้กดอยู่ในรายการ
 */
function canApproveLeave_(approverInfo, tapperUserId) {
  return !!(approverInfo && (approverInfo.userIds || []).includes(tapperUserId));
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

// ---------- สวิตช์เปิด/ปิดระบบลา ----------
// leave_system_enabled ในชีต Settings: ใส่ FALSE เพื่อปิด — ค่าอื่นทั้งหมด (รวมถึงยังไม่มีแถว) = เปิด
// ปิดแล้ว: ลงทะเบียน/ยื่นลาถูกปฏิเสธพร้อมข้อความ (แก้ข้อความได้ที่ leave_closed_message)
// ยังทำงานต่อ: ปุ่มอนุมัติใบลาเดิมที่ค้างอยู่ + สรุปเช้า "ผู้ลาวันนี้" (ไม่ทิ้งงานที่ไหลอยู่กลางคัน)

function isLeaveSystemEnabled_(settings) {
  return String((settings && settings.leave_system_enabled) || '').trim().toUpperCase() !== 'FALSE';
}

function leaveClosedMessage_(settings) {
  const custom = String((settings && settings.leave_closed_message) || '').trim();
  return custom || 'ระบบลาปิดรับคำขอชั่วคราว — หากเร่งด่วนติดต่อผู้ดูแลระบบ';
}

function requireLeaveSystemEnabled_(settings) {
  if (!isLeaveSystemEnabled_(settings)) {
    throw new Error(leaveClosedMessage_(settings));
  }
}

// สวิตช์แยก: ปิดการอนุมัติ (leave_approval_enabled = FALSE) = โหมด "แจ้งลาอัตโนมัติ"
// ยื่นแล้วบันทึกเป็น "อนุมัติ" ทันที ไม่ต้องเรียกตัวผู้อนุมัติ แต่ยังส่งการ์ดแจ้งเข้ากลุ่มหลัก
// (ค่าอื่นใด/แถวหาย = เปิดการอนุมัติตามปกติ เพื่อไม่เปลี่ยนพฤติกรรมระบบที่ติดตั้งไว้แล้วโดยไม่ตั้งใจ)
function isLeaveApprovalEnabled_(settings) {
  return String((settings && settings.leave_approval_enabled) || '').trim().toUpperCase() !== 'FALSE';
}

// ---------- API actions ----------

// ตัวเลือก dropdown ทั้งหมดมาจากชีต — แก้ที่ Settings ได้เลยไม่ต้องแตะโค้ด
function optionList_(settingValue, fallback) {
  const list = splitConfigNames_(settingValue);
  return list.length ? list : splitConfigNames_(fallback);
}

function apiSession_(body) {
  const profile = verifyLineToken_(requireAccessToken_(body));
  const settings = getSettings_();
  const leaveStatus = {
    leaveEnabled: isLeaveSystemEnabled_(settings),
    leaveClosedMessage: isLeaveSystemEnabled_(settings) ? '' : leaveClosedMessage_(settings),
    approvalEnabled: isLeaveApprovalEnabled_(settings),
  };
  const roster = readStaffRoster_();
  const staff = findStaffByUserId_(roster, profile.userId);
  if (staff) {
    return Object.assign({
      ok: true, registered: true,
      name: staffDisplayName_(staff), groupName: staff.groupName, position: staff.position,
    }, leaveStatus);
  }
  const config = readApproversConfig_();
  return Object.assign({
    ok: true, registered: false,
    options: {
      prefixes: optionList_(settings.prefix_options, 'นาย,นาง,นางสาว,อื่นๆ'),
      groups: config.map(c => c.groupName), // รายชื่อกลุ่มงาน = คอลัมน์แรกของชีต Approvers
      positions: optionList_(settings.position_options, 'อื่นๆ'),
    },
  }, leaveStatus);
}

function apiBind_(body) {
  const profile = verifyLineToken_(requireAccessToken_(body));
  const settings = getSettings_();
  requireLeaveSystemEnabled_(settings); // ปิดระบบ = หยุดรับลงทะเบียนใหม่ด้วย
  const prefix = String(body.prefix || '').trim().substring(0, 30);
  const firstName = String(body.firstName || '').trim().substring(0, 50);
  const lastName = String(body.lastName || '').trim().substring(0, 50);
  const groupName = String(body.groupName || '').trim();
  const position = String(body.position || '').trim().substring(0, 50);
  if (!firstName || !lastName) throw new Error('กรุณากรอกชื่อและสกุล');
  if (!prefix) throw new Error('กรุณาเลือกคำนำหน้าชื่อ');
  if (!position) throw new Error('กรุณาเลือกตำแหน่ง');
  // ชื่อ/สกุลเป็น key ที่นำไปเทียบกับ cell รายชื่อ (คั่นจุลภาค) ในชีต Approvers —
  // มีจุลภาคปนมาจะทำให้การจับคู่ผู้อนุมัติพังทั้งสาย จึงบล็อกตั้งแต่ต้นทาง
  if (firstName.indexOf(',') !== -1 || lastName.indexOf(',') !== -1) {
    throw new Error('ชื่อและสกุลห้ามมีเครื่องหมายจุลภาค (,) กรุณาตรวจอีกครั้ง');
  }

  const config = readApproversConfig_();
  const prefixes = optionList_(settings.prefix_options, 'นาย,นาง,นางสาว,อื่นๆ');
  const positions = optionList_(settings.position_options, 'อื่นๆ');
  // 'อื่นๆ' ในลิสต์ = เปิดช่องพิมพ์เอง จึงยอมรับค่าใดๆ ที่ไม่ว่าง; ถ้าไม่มี 'อื่นๆ' ต้องตรงลิสต์เป๊ะ
  if (!prefixes.includes(prefix) && !prefixes.includes('อื่นๆ')) throw new Error('คำนำหน้าชื่อไม่ถูกต้อง');
  if (!positions.includes(position) && !positions.includes('อื่นๆ')) throw new Error('ตำแหน่งไม่ถูกต้อง');
  if (!groupName || !config.some(c => c.groupName === groupName)) {
    throw new Error('กลุ่มงานไม่ถูกต้อง หรือยังไม่ได้ตั้งค่าในระบบ — ตรวจอีกครั้งหรือติดต่อผู้ดูแล');
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('ระบบ busy ลองอีกครั้ง');
  try {
    const roster = readStaffRoster_();
    const myKey = staffKey_({ firstName: firstName, lastName: lastName });
    const sameName = roster.find(s => staffKey_(s) === myKey);
    if (sameName && sameName.lineUserId && sameName.lineUserId !== profile.userId) {
      throw new Error('มีผู้ใช้ชื่อนี้ลงทะเบียนแล้ว — หากคุณคือคนเดียวกัน ติดต่อผู้ดูแลให้ล้างการลงทะเบียนเดิม');
    }
    const sameUser = findStaffByUserId_(roster, profile.userId);
    if (sameUser && staffKey_(sameUser) !== myKey) {
      throw new Error('บัญชี LINE นี้ลงทะเบียนเป็นชื่ออื่นไปแล้ว — ติดต่อผู้ดูแลให้ล้างก่อนจึงจะลงทะเบียนใหม่ได้');
    }

    const todayStr = bangkokTodayStr_();
    const sheet = SpreadsheetApp.getActive().getSheetByName('Staff');
    if (sameName) {
      // มีแถวชื่อนี้อยู่ก่อนแต่ยังไม่ผูกบัญชี → เติมข้อมูลให้ครบในแถวเดิม (ไม่สร้างซ้ำ)
      sheet.getRange(sameName.row, 1, 1, 8).setValues([[
        prefix, firstName, lastName, groupName, position,
        profile.userId, profile.displayName, todayStr,
      ]]);
    } else {
      sheet.appendRow([
        prefix, firstName, lastName, groupName, position,
        profile.userId, profile.displayName, todayStr,
      ]);
    }

    const fullName = (prefix ? prefix + ' ' : '') + myKey;
    // แจ้งเข้ากลุ่มหลักทุกครั้งที่มีการลงทะเบียน ให้ผู้ดูแลเทียบ "ชื่อใน LINE" กับ "ชื่อที่กรอก" เป็นชั้นตรวจ
    try {
      sendLineMessage_(settings.line_group_id, {
        type: 'text',
        text: '🔔 ระบบลางาน: ' + (profile.displayName || '(ไม่ทราบชื่อ LINE)') +
          ' ลงทะเบียนเป็น ' + fullName +
          ' (' + groupName + (position ? ' · ' + position : '') + ') แล้ว',
      });
    } catch (notifyErr) {
      logResult_(new Date(), 'leave-bind', 'แจ้งกลุ่มไม่สำเร็จ: ' + notifyErr);
    }
    logResult_(new Date(), 'leave-bind', fullName + ' ← ' + profile.userId);
    return {
      ok: true, registered: true,
      name: fullName, groupName: groupName, position: position,
    };
  } finally {
    lock.releaseLock();
  }
}

function apiSubmit_(body) {
  const profile = verifyLineToken_(requireAccessToken_(body));
  const roster = readStaffRoster_();
  const staff = findStaffByUserId_(roster, profile.userId);
  if (!staff) throw new Error('ยังไม่ได้ลงทะเบียน — ปิดหน้านี้แล้วเปิดใหม่เพื่อลงทะเบียนก่อน');

  const leaveType = String(body.leaveType || '').trim();
  if (!LEAVE_TYPES.includes(leaveType)) throw new Error('ประเภทการลาไม่ถูกต้อง');
  const reason = String(body.reason || '').trim().substring(0, 500);
  const range = parseLeaveDateRange_(body.start, body.end, bangkokTodayStr_());

  const settings = getSettings_();
  requireLeaveSystemEnabled_(settings); // ปิดระบบ = ปฏิเสธการยื่นลาใหม่ทั้งหมด
  const leaveDbId = String(settings.leave_database_id || '').trim();
  if (!leaveDbId || leaveDbId === 'your_leave_database_id') {
    throw new Error('ระบบยังไม่พร้อมใช้งาน (ผู้ดูแลยังไม่ได้ตั้งค่า leave_database_id)');
  }

  const workDays = countBusinessDays_(range.start, range.end, readHolidaySet_());

  // โหมดปิดการอนุมัติ ("แจ้งลาอัตโนมัติ"): บันทึกเป็น "อนุมัติ" ทันที ไม่ต้องตั้งค่าผู้อนุมัติ
  // แจ้งการ์ด (ไม่มีปุ่ม) เข้ากลุ่มหลัก + แจ้งผู้ยื่นกลับ — ใบลาขึ้นสรุปเช้า "ผู้ลาวันนี้" ทันทีเพราะอนุมัติแล้ว
  if (!isLeaveApprovalEnabled_(settings)) {
    const autoPayload = buildLeavePagePayload_({
      dataSourceId: resolveLeaveDataSourceId_(leaveDbId),
      fullName: staffDisplayName_(staff),
      groupName: staff.groupName,
      submitterUserId: staff.lineUserId,
      leaveType: leaveType,
      start: range.start,
      end: range.end,
      reason: reason,
      workDays: workDays,
      initialStatus: LEAVE_STATUS.approved,
      currentApprover: '',
    });
    const autoPage = parseLeavePage_(createNotionLeavePage_(autoPayload));
    try {
      sendLineMessage_(settings.line_group_id, {
        type: 'flex',
        altText: '🏖️ แจ้งลาอัตโนมัติ: ' + autoPage.fullName + ' — ' + leaveType + ' ' +
          leaveDateLabel_(range.start, range.end),
        contents: buildLeaveNoticeBubble_(autoPage),
      });
    } catch (notifyErr) {
      logResult_(new Date(), 'error', 'ส่งการ์ดแจ้งลาเข้ากลุ่มไม่สำเร็จ: ' + notifyErr);
    }
    pushPrivateMessage_(staff.lineUserId, {
      type: 'text',
      text: '✅ บันทึกการลาแล้ว (ไม่ต้องรออนุมัติ — ระบบปิดการอนุมัติอยู่)\n' + leaveSummaryText_(autoPage),
    });
    logResult_(new Date(), 'leave',
      autoPage.fullName + ' ยื่น' + leaveType + ' ' + leaveDateLabel_(range.start, range.end) +
      ' (' + workDays + ' วันทำการ) — อัตโนมัติ ไม่ต้องอนุมัติ');
    return {
      ok: true,
      workDays: workDays,
      approverName: 'ไม่ต้องอนุมัติ — แจ้งเข้ากลุ่มหลักแล้ว',
      needsSecond: false,
      autoApproved: true,
    };
  }

  const config = readApproversConfig_();
  const chain = resolveApprovalChain_(config, settings, roster, staff); // throw ไทยสุภาพเมื่อคอนฟิกยังไม่พร้อม

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
    initialStatus: chain.stage === 'second'
      ? LEAVE_STATUS.pendingChiefOffice
      : LEAVE_STATUS.pendingApprover,
    currentApprover: serializeApproverInfo_(chain.stage, chain.targets),
  });

  const page = createNotionLeavePage_(payload);
  const leavePage = parseLeavePage_(page);

  const card = buildLeaveApprovalBubble_(leavePage);
  let approverLabel = chain.targets.map(s => staffDisplayName_(s)).join(', ');
  if (chain.viaPool) {
    // ผู้อนุมัติของกลุ่มยังไม่ลงทะเบียน — การ์ดเข้ากลุ่มหลัก ให้ผู้อนุมัติที่ลงทะเบียนแล้วรายอื่นกดแทน
    approverLabel += ' (เข้ากลุ่มหลัก — ผู้อนุมัติของกลุ่มยังไม่ลงทะเบียน)';
    try {
      sendLineMessage_(settings.line_group_id, card);
    } catch (err) {
      logResult_(new Date(), 'error', 'ส่งการ์ดขออนุมัติเข้ากลุ่มไม่สำเร็จ: ' + err);
      throw new Error('ส่งเรื่องให้ผู้อนุมัติไม่สำเร็จ โปรดลองอีกครั้ง (หากยังไม่สำเร็จติดต่อผู้ดูแล)');
    }
    logResult_(new Date(), 'leave', 'ใบลา ' + leavePage.fullName + ' ส่งเข้ากลุ่มหลัก (ผู้อนุมัติของกลุ่มยังไม่ลงทะเบียน)');
  } else {
    if (chain.viaFallback) {
      logResult_(new Date(), 'leave', 'ใบลา ' + leavePage.fullName + ' ขึ้น หัวหน้า สสอ. ทันที (ผู้อนุมัติของกลุ่มยังไม่ลงทะเบียน)');
    }
    pushApproverCardWithFallback_(chain.targets.map(s => s.lineUserId), card, leavePage);
  }
  if (chain.needsSecond && chain.stage === 'first') {
    approverLabel += ' → ส่งต่อ หัวหน้า สสอ.';
  }

  logResult_(new Date(), 'leave',
    leavePage.fullName + ' ยื่น' + leaveType + ' ' + leaveDateLabel_(range.start, range.end) +
    ' (' + workDays + ' วันทำการ) → ' + approverLabel);

  return {
    ok: true,
    workDays: workDays,
    approverName: approverLabel,
    needsSecond: chain.needsSecond && chain.stage === 'first',
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

// "ผู้อนุมัติปัจจุบัน" เก็บในหน้าใบลาเป็น JSON {stage, userIds, names} —
// stage 'first' = ผู้อนุมัติของกลุ่มงาน, 'second' = หัวหน้า สสอ.
function serializeApproverInfo_(stage, targets) {
  return JSON.stringify({
    stage: stage,
    userIds: (targets || []).map(s => s.lineUserId),
    names: (targets || []).map(s => staffDisplayName_(s)),
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

/** การ์ด "แจ้งลา" สำหรับโหมดปิดการอนุมัติ — เหมือนการ์ดขออนุมัติแต่ไม่มีปุ่ม (เป็นการแจ้งเพื่อทราบ) */
function buildLeaveNoticeBubble_(leavePage) {
  const bubble = buildLeaveApprovalBubble_(leavePage);
  bubble.header.contents[0].text = 'แจ้งการลา (ไม่ต้องอนุมัติ)';
  bubble.footer = {
    type: 'box',
    layout: 'vertical',
    paddingAll: '12px',
    contents: [
      { type: 'text', text: 'ระบบปิดการอนุมัติอยู่ — บันทึกอัตโนมัติ ไม่ต้องกดอนุมัติ', size: 'xxs', color: '#6F7874', align: 'center', wrap: true },
    ],
  };
  return bubble;
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
  const who = staffDisplayName_(approverStaff) +
    (approverStaff && approverStaff.position ? '(' + approverStaff.position + ')' : '');
  return stamp + ' ' + who + ' ' + actionLabel;
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
    const settings = getSettings_();

    const isPending = leavePage.status === LEAVE_STATUS.pendingApprover ||
      leavePage.status === LEAVE_STATUS.pendingChiefOffice;
    if (!isPending) {
      pushPrivateMessage_(tapperUserId, {
        type: 'text',
        text: 'ใบลานี้ดำเนินการไปแล้ว (สถานะปัจจุบัน: ' + (leavePage.status || 'ไม่ทราบ') + ')',
      });
      return;
    }

    // ชั้นป้องกันหลัก: userId ของผู้กดต้องตรงกับ "ผู้อนุมัติปัจจุบัน" ที่เก็บในหน้า Notion
    if (!canApproveLeave_(leavePage.currentApprover, tapperUserId)) {
      pushPrivateMessage_(tapperUserId, {
        type: 'text',
        text: 'คุณไม่ใช่ผู้อนุมัติของใบลานี้',
      });
      logResult_(new Date(), 'leave-approve', 'ผู้ไม่มีสิทธิ์กดปุ่มใบลา ' + leavePage.fullName + ': ' + tapperUserId);
      return;
    }
    const tapper = findStaffByUserId_(roster, tapperUserId);

    const auditBase = leavePage.audit ? leavePage.audit + '\n' : '';
    const isApprove = data.a === 'approve';
    const actionLabel = isApprove ? 'อนุมัติ' : 'ไม่อนุมัติ';
    const auditText = auditBase + formatAuditLine_(tapper, actionLabel);

    // อนุมัติขั้นแรก + กลุ่มงานนี้ตั้งค่าให้ส่งต่อ หัวหน้า สสอ. → เปลี่ยนขั้นแทนจบ
    // (อ่านธงส่งต่อสดๆ จากชีต Approvers ทุกครั้ง — ผู้ดูแลสลับค่ากลางทางได้)
    if (isApprove && leavePage.status === LEAVE_STATUS.pendingApprover) {
      const submitter = findStaffByUserId_(roster, leavePage.submitterUserId);
      const config = readApproversConfig_();
      const configRow = config.find(c => c.groupName === (submitter ? submitter.groupName : ''));
      const needsSecond = !!(configRow && configRow.forward);

      if (needsSecond) {
        const submitterKey = submitter ? staffKey_(submitter) : '';
        const second = registeredStaffByNames_(roster, secondApproverNames_(settings))
          .filter(s => staffKey_(s) !== submitterKey);
        const nextTargets = second.length
          ? second
          : allApproverPool_(config, settings, roster, submitterKey)
              .filter(s => s.lineUserId !== tapperUserId);

        if (!nextTargets.length) {
          // ยังไม่มี หัวหน้า สสอ. ที่ลงทะเบียน — ไม่แตะสถานะ ให้อนุมัติใหม่ภายหลังเมื่อพร้อม
          pushPrivateMessage_(tapperUserId, {
            type: 'text',
            text: 'ยังส่งต่อให้ หัวหน้า สสอ. ไม่ได้ เพราะยังไม่มีรายชื่อที่ลงทะเบียนพร้อม — ติดต่อผู้ดูแล (ใบลายังอยู่ที่สถานะเดิม)',
          });
          logResult_(new Date(), 'error',
            'ส่งต่อขั้น หัวหน้า สสอ. ไม่ได้ (ไม่มีเป้าหมายพร้อม) ใบลา ' + leavePage.fullName);
          return;
        }

        updateLeavePage_(leavePage.pageId, {
          [PROPS_LEAVE.status]: { select: { name: LEAVE_STATUS.pendingChiefOffice } },
          [PROPS_LEAVE.currentApprover]: richTextValue_(serializeApproverInfo_('second', nextTargets)),
          [PROPS_LEAVE.audit]: richTextValue_(auditText),
        });

        const secondCard = buildLeaveApprovalBubble_(
          Object.assign({}, leavePage, { status: LEAVE_STATUS.pendingChiefOffice }));
        if (second.length) {
          pushApproverCardWithFallback_(second.map(s => s.lineUserId), secondCard, leavePage);
        } else {
          // ไม่มี หัวหน้า สสอ. ที่ลงทะเบียน — การ์ดเข้ากลุ่มหลักให้ผู้อนุมัติรายอื่นที่กำหนดไว้กดแทน
          try {
            sendLineMessage_(settings.line_group_id, secondCard);
          } catch (err) {
            logResult_(new Date(), 'error', 'ส่งการ์ดขั้น หัวหน้า สสอ. เข้ากลุ่มไม่สำเร็จ: ' + err);
          }
        }
        pushPrivateMessage_(leavePage.submitterUserId, {
          type: 'text',
          text: '⏳ ผู้อนุมัติอนุมัติแล้ว รอ หัวหน้า สสอ. พิจารณาต่อ\n' + leaveSummaryText_(leavePage),
        });
        pushPrivateMessage_(tapperUserId, {
          type: 'text',
          text: 'บันทึกแล้ว: อนุมัติขั้นแรก — ส่งต่อให้ หัวหน้า สสอ. พิจารณาต่อแล้ว (ใบลาของ ' + leavePage.fullName + ')',
        });
        logResult_(new Date(), 'leave-approve', leavePage.fullName + ' ผ่านขั้นแรก รอ หัวหน้า สสอ.');
        return;
      }
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
        '\nโดย: ' + staffDisplayName_(tapper) +
        (tapper && tapper.position ? ' (' + tapper.position + ')' : ''),
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

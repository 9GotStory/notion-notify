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
 *   / วันที่ลา (date) / ช่วงวัน (rich_text: เต็มวัน/ครึ่งวันเช้า/ครึ่งวันบ่าย — เพิ่มภายหลังได้)
 *   / เหตุผล (rich_text) / สถานะ (select) / ผู้อนุมัติปัจจุบัน (rich_text, JSON ภายใน)
 *   / บันทึกการอนุมัติ (rich_text, audit) / หมายเหตุระบบ (rich_text: ยอดสิทธิ์+คำเตือนตามระเบียบ)
 *   / จำนวนวันทำการ (number, ครึ่งวัน = 0.5)
 */

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
 *   / วันที่ลา (date) / ช่วงวัน (rich_text: เต็มวัน/ครึ่งวันเช้า/ครึ่งวันบ่าย — เพิ่มภายหลังได้)
 *   / เหตุผล (rich_text) / สถานะ (select) / ผู้อนุมัติปัจจุบัน (rich_text, JSON ภายใน)
 *   / บันทึกการอนุมัติ (rich_text, audit) / หมายเหตุระบบ (rich_text: ยอดสิทธิ์+คำเตือนตามระเบียบ)
 *   / จำนวนวันทำการ (number, ครึ่งวัน = 0.5)
 */

const PROPS_LEAVE = {
  title: 'ผู้ลา',
  groupName: 'กลุ่มงาน',
  submitter: 'ผู้ยื่น (ระบบ)',
  type: 'ประเภทการลา',
  date: 'วันที่ลา',
  period: 'ช่วงวัน',
  reason: 'เหตุผล',
  status: 'สถานะ',
  currentApprover: 'ผู้อนุมัติปัจจุบัน',
  audit: 'บันทึกการอนุมัติ',
  systemNote: 'หมายเหตุระบบ',
  workDays: 'จำนวนวันทำการ',
};

const LEAVE_STATUS = {
  pendingApprover: 'รอผู้อนุมัติ',
  pendingChiefOffice: 'รอหัวหน้า สสอ.อนุมัติ',
  approved: 'อนุมัติ',
  rejected: 'ไม่อนุมัติ',
  cancelled: 'ยกเลิก',
};

// ประเภทการลา default ตามระเบียบสำนักนายกฯ ว่าด้วยการลาฯ (แก้รายการได้ที่ Settings คีย์ leave_type_options)
const LEAVE_TYPES_DEFAULT = [
  'ลาป่วย', 'ลากิจ', 'ลาพักร้อน', 'ลาคลอด',
  'ลาอุปสมบถ/ลาบวช', 'ลาช่วยเหลือภริยาคลอดบุตร', 'อื่นๆ',
];

// สิทธิ์สูงสุดต่อปีตามระเบียบฯ (นับเป็นวันทำการ) — ใช้ "เตือน" ไม่บล็อกการยื่น (ตัดสินใจโดยผู้อนุมัติ)
// ลาพักร้อนตามระเบียบสะสมได้ไม่เกิน 2 ปี รวมต่อครั้งไม่เกิน 45 วันทำการ จึงเตือนเป็นรายกรณีแทนการล็อกตัวเลข
const LEAVE_QUOTAS = {
  'ลากิจ': 10,
  'ลาพักร้อน': 10,
  'ลาคลอด': 90,
  'ลาอุปสมบถ/ลาบวช': 15,
  'ลาช่วยเหลือภริยาคลอดบุตร': 15,
};

// ประเภทที่ลาครึ่งวัน (เช้า/บ่าย นับเป็น ½ วัน) ได้ตามระเบียบ
const HALF_DAY_TYPES = ['ลาป่วย', 'ลากิจ', 'ลาพักร้อน'];
const LEAVE_PERIODS = ['เต็มวัน', 'ครึ่งวันเช้า', 'ครึ่งวันบ่าย'];

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

// รายการประเภทการลา (แก้ได้ที่ Settings คีย์ leave_type_options)
function leaveTypeList_(settings) {
  return optionList_(settings && settings.leave_type_options, LEAVE_TYPES_DEFAULT.join(','));
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

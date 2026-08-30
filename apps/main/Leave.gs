/**
 * ระบบลางานเจ้าหน้าที่ — ใช้ LIFF เป็นหน้ายื่น (โฮสต์ GitHub Pages), Notion เป็นที่เก็บใบลา,
 * LINE OA เป็นช่องทางแจ้ง/อนุมัติ
 *
 * การระบุตัวตน: ผู้ดูแลเตรียม Staff จากทำเนียบที่รับรอง ผู้ใช้ส่งรหัสบุคลากรเพื่อขอผูก LINE
 * และยื่นลาได้หลังผู้ดูแลอนุมัติเท่านั้น ทุกคำขอจาก LIFF ต้องแนบ access token และตรวจกับ LINE จริงทุกครั้ง
 * (api.line.me/oauth2/v2.1/verify + /v2/profile) — ไม่เชื่อข้อมูลใดๆ ที่มาจากฝั่ง browser
 *
 * การอนุมัติสองชั้น (คอนฟิกทั้งหมดในชีต ไม่มี hardcode): ผู้อนุมัติของกลุ่มงาน → หัวหน้า สสอ.
 * (ชีต Approvers กำหนดว่ากลุ่มงานไหนใครอนุมัติ + ต้องส่งต่อ หัวหน้า สสอ. ไหม; รายชื่อ หัวหน้า สสอ. อยู่ใน Settings คีย์ second_approvers)
 * การ์ดส่งหาผู้อนุมัติแบบ 1:1 พร้อมปุ่ม postback อนุมัติ/ไม่อนุมัติ
 * gateway ตรวจ X-Line-Signature ก่อนส่งต่อ และการตรวจสิทธิ์คนกดปุ่มยังอ้างอิง
 * "ผู้อนุมัติปัจจุบัน" ที่เก็บในหน้า Notion อีกชั้น (ดู canApproveLeave_)
 *
 * โครงสร้างชีต Staff (สร้างหัวตารางโดยเมนู "เตรียม/ตรวจสอบชีตทั้งหมด" และผู้ดูแล preload ข้อมูล):
 *   แถว 1: ชื่อตาราง / แถว 2: หัวคอลัมน์ / เริ่มข้อมูลแถว 3 (ตามแบบชีต Settings/Holidays)
 *   คำนำหน้า | ชื่อ | สกุล | กลุ่มงาน | ตำแหน่ง | LINE User ID | ชื่อที่แสดงใน LINE | วันที่ลงทะเบียน
 *
 * โครงสร้างชีต Approvers (ผู้ดูแลกรอกเอง — เป็นคอนฟิกผู้อนุมัติ):
 *   กลุ่มงาน | ผู้อนุมัติ (ชื่อ สกุล ตามที่ลงทะเบียน หลายคนคั่นจุลภาค ใครกดก่อนได้ก่อน)
 *   | ส่งต่อให้ หัวหน้า สสอ. (TRUE ถ้าใบลาของกลุ่มงานนี้ต้องผ่าน หัวหน้า สสอ. ด้วย)
 *   รายชื่อ หัวหน้า สสอ. อยู่ใน Settings คีย์ second_approvers (คั่นจุลภาค)
 *   ชื่อกลุ่มงานใน Staff ต้องตรงกับคอลัมน์กลุ่มงานใน Approvers เพื่อ resolve สายอนุมัติ
 *
 * โครงสร้าง Notion database "ใบลา" (ชื่อ property อ้างอิงผ่าน PROPS_LEAVE):
 *   ผู้ลา (title, เก็บชื่อเต็ม คำนำหน้า+ชื่อ-สกุล) / กลุ่มงาน (rich_text)
 *   / ผู้ยื่น (ระบบ) (rich_text, เก็บ LINE userId ของผู้ยื่น) / ประเภทการลา (select)
 *   / วันที่ลา (date) / ช่วงวัน (rich_text: เต็มวัน/ครึ่งวันเช้า/ครึ่งวันบ่าย — เพิ่มภายหลังได้)
 *   / ผู้ปฏิบัติงานแทน (rich_text, JSON ของบุคลากรที่ลงทะเบียนแล้ว; เว้นว่างได้)
 *   / เหตุผล (rich_text) / สถานะ (select) / ผู้อนุมัติปัจจุบัน (rich_text, JSON ภายใน)
 *   / บันทึกการอนุมัติ (rich_text, audit) / หมายเหตุระบบ (rich_text: ยอดสิทธิ์+คำเตือนตามระเบียบ)
 *   / จำนวนวันทำการ (number, ครึ่งวัน = 0.5)
 */

/**
 * ระบบลางานเจ้าหน้าที่ — ใช้ LIFF เป็นหน้ายื่น (โฮสต์ GitHub Pages), Notion เป็นที่เก็บใบลา,
 * LINE OA เป็นช่องทางแจ้ง/อนุมัติ
 *
 * การระบุตัวตน: ผู้ดูแลเตรียม Staff จากทำเนียบที่รับรอง ผู้ใช้ส่งรหัสบุคลากรเพื่อขอผูก LINE
 * และยื่นลาได้หลังผู้ดูแลอนุมัติเท่านั้น ทุกคำขอจาก LIFF ต้องแนบ access token และตรวจกับ LINE จริงทุกครั้ง
 * (api.line.me/oauth2/v2.1/verify + /v2/profile) — ไม่เชื่อข้อมูลใดๆ ที่มาจากฝั่ง browser
 *
 * การอนุมัติสองชั้น (คอนฟิกทั้งหมดในชีต ไม่มี hardcode): ผู้อนุมัติของกลุ่มงาน → หัวหน้า สสอ.
 * (ชีต Approvers กำหนดว่ากลุ่มงานไหนใครอนุมัติ + ต้องส่งต่อ หัวหน้า สสอ. ไหม; รายชื่อ หัวหน้า สสอ. อยู่ใน Settings คีย์ second_approvers)
 * การ์ดส่งหาผู้อนุมัติแบบ 1:1 พร้อมปุ่ม postback อนุมัติ/ไม่อนุมัติ
 * gateway ตรวจ X-Line-Signature ก่อนส่งต่อ และการตรวจสิทธิ์คนกดปุ่มยังอ้างอิง
 * "ผู้อนุมัติปัจจุบัน" ที่เก็บในหน้า Notion อีกชั้น (ดู canApproveLeave_)
 *
 * โครงสร้างชีต Staff (สร้างหัวตารางโดยเมนู "เตรียม/ตรวจสอบชีตทั้งหมด" และผู้ดูแล preload ข้อมูล):
 *   แถว 1: ชื่อตาราง / แถว 2: หัวคอลัมน์ / เริ่มข้อมูลแถว 3 (ตามแบบชีต Settings/Holidays)
 *   คำนำหน้า | ชื่อ | สกุล | กลุ่มงาน | ตำแหน่ง | LINE User ID | ชื่อที่แสดงใน LINE | วันที่ลงทะเบียน
 *
 * โครงสร้างชีต Approvers (ผู้ดูแลกรอกเอง — เป็นคอนฟิกผู้อนุมัติ):
 *   กลุ่มงาน | ผู้อนุมัติ (ชื่อ สกุล ตามที่ลงทะเบียน หลายคนคั่นจุลภาค ใครกดก่อนได้ก่อน)
 *   | ส่งต่อให้ หัวหน้า สสอ. (TRUE ถ้าใบลาของกลุ่มงานนี้ต้องผ่าน หัวหน้า สสอ. ด้วย)
 *   รายชื่อ หัวหน้า สสอ. อยู่ใน Settings คีย์ second_approvers (คั่นจุลภาค)
 *   ชื่อกลุ่มงานใน Staff ต้องตรงกับคอลัมน์กลุ่มงานใน Approvers เพื่อ resolve สายอนุมัติ
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
  substitute: 'ผู้ปฏิบัติงานแทน',
  reason: 'เหตุผล',
  status: 'สถานะ',
  currentApprover: 'ผู้อนุมัติปัจจุบัน',
  audit: 'บันทึกการอนุมัติ',
  systemNote: 'หมายเหตุระบบ',
  workDays: 'จำนวนวันทำการ',
  requestId: 'Request ID',
  notificationState: 'สถานะการแจ้ง',
};

const LEAVE_NOTIFICATION_STATE = {
  pending: 'รอแจ้ง',
  sent: 'แจ้งแล้ว',
  failed: 'แจ้งไม่สำเร็จ',
  manual: 'ต้องตรวจสอบ',
};

const LEAVE_STATUS = {
  pendingApprover: 'รอผู้อนุมัติ',
  pendingChiefOffice: 'รอหัวหน้า สสอ.อนุมัติ',
  approved: 'อนุมัติ',
  rejected: 'ไม่อนุมัติ',
  cancelled: 'ยกเลิก',
};

// ประเภทการลา default ตามระเบียบสำนักนายกฯ ว่าด้วยการลาฯ (แก้รายการได้ที่ Settings คีย์ leave_type_options)
const LEGACY_LEAVE_TYPE_NAMES = {
  'ลาอุปสมบถ/ลาบวช': 'ลาอุปสมบท/ลาบวช',
  'ลาช่วยเหลือภริยาคลอดบุตร': 'ลาช่วยเหลือภรรยาคลอดบุตร',
};

function normalizeLeaveTypeName_(value) {
  const name = String(value || '').trim();
  return LEGACY_LEAVE_TYPE_NAMES[name] || name;
}

const LEAVE_TYPES_DEFAULT = [
  'ลาป่วย', 'ลากิจ', 'ลาพักร้อน', 'ลาคลอด',
  'ลาอุปสมบท/ลาบวช', 'ลาช่วยเหลือภรรยาคลอดบุตร', 'อื่นๆ',
];

// สิทธิ์สูงสุดต่อปีตามระเบียบฯ — ใช้ "เตือน" ไม่บล็อกการยื่น (ตัดสินใจโดยผู้อนุมัติ)
// ลาคลอดและลาอุปสมบท/ลาบวชนับเป็นวันปฏิทินต่อเนื่อง ประเภทอื่นนับเป็นวันทำการ
// ลากิจ: ระเบียบ สนง.นายกฯ (แก้ไขเพิ่มเติม) ไม่จำกัดวันลา แต่ได้รับเงินเดือนระหว่างลาไม่เกิน 45 วันทำการ/ปี → เตือนที่ 45
// ลาอุปสมบท: ไม่เกิน 120 วัน (รับราชการมาแล้ว ≥12 เดือน)
// ลาพักร้อนตามระเบียบสะสมได้ รวมกับปีปัจจุบันไม่เกิน 20 วันทำการ จึงเตือนเป็นรายกรณีแทนการล็อกตัวเลข
// (ค่านี้เป็นค่าทั่วไปเมื่อไม่ระบุประเภทบุคลากร — ระบุแล้วใช้ QUOTA_PROFILE_SEED ด้านล่างแทน)
const LEAVE_QUOTAS = {
  'ลากิจ': 45,
  'ลาพักร้อน': 10,
  'ลาคลอด': 90,
  'ลาอุปสมบท/ลาบวช': 120,
  'ลาช่วยเหลือภรรยาคลอดบุตร': 15,
};

// ประเภทที่ลาครึ่งวัน (เช้า/บ่าย นับเป็น ½ วัน) ได้ตามระเบียบ
const HALF_DAY_TYPES = ['ลาป่วย', 'ลากิจ', 'ลาพักร้อน'];
const LEAVE_PERIODS = ['เต็มวัน', 'ครึ่งวันเช้า', 'ครึ่งวันบ่าย'];
const CALENDAR_DAY_QUOTA_TYPES = ['ลาคลอด', 'ลาอุปสมบท/ลาบวช'];
const MANUAL_REVIEW_QUOTA_TYPES = [
  'ลาคลอด', 'ลาอุปสมบท/ลาบวช', 'ลาช่วยเหลือภรรยาคลอดบุตร',
];

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
  // คอลัมน์ที่ 9 เพิ่มภายหลัง (ปรับปรุงระบบโควตาตามประเภทบุคลากร) — ต่อท้ายแทนการแทรกกลาง
  // เพื่อไม่ให้ชีตที่ติดตั้งไว้แล้วข้อมูลเพี้ยนจากคอลัมน์ขยับ / setupSheet เติมหัวคอลัมน์ให้ชีตเดิมเอง
  'ประเภทบุคลากร',
  'รหัสบุคลากร', 'สถานะบุคลากร', 'สถานะการผูก LINE',
  'LINE User ID ที่รออนุมัติ', 'ชื่อ LINE ที่รออนุมัติ', 'ขอผูกเมื่อ',
  'ผู้อนุมัติการผูก', 'อนุมัติการผูกเมื่อ', 'Binding Request ID',
];

const STAFF_ACTIVE_STATUS = 'ACTIVE';
const STAFF_BINDING_STATUS = {
  pending: 'PENDING',
  approved: 'APPROVED',
  rejected: 'REJECTED',
};

// ตารางโควตาต่อประเภทบุคลากร (ชีต QuotaProfiles) — สิทธิ์พื้นฐานต่างกันตามสถานะ
// (ข้าราชการ/พนักงานราชการ/ลูกจ้างประจำ/ลูกจ้างชั่วคราว ฯลฯ) และต่างกันได้รายปี
const QUOTA_PROFILE_SHEET_TITLE = 'โควตาสิทธิ์ตามประเภทบุคลากร แยกตามปีงบประมาณ (ว่างทั้งชีต = ทุกคนใช้ค่าเริ่มต้นตามระเบียบราชการ)';
const QUOTA_PROFILE_COLUMNS = [
  'ปีงบประมาณ (พ.ศ. เว้นว่าง = ทุกปี)', 'ประเภทบุคลากร', 'ประเภทการลา', 'เกณฑ์วันใช้สิทธิ์', 'หมายเหตุ',
];

// ค่าเริ่มต้นเชิงปฏิบัติการจากระเบียบ/ประกาศ — ต้องให้ HR ทบทวนกับสถานะจ้าง สัญญา
// และฉบับแก้ไขล่าสุดของหน่วยงานก่อนใช้จริง โดยบันทึกวันที่ไว้ที่ Settings: leave_policy_reviewed_at
// หน่วยเป็นวันใช้สิทธิ์: ลาคลอดและลาอุปสมบท/ลาบวช = วันปฏิทินต่อเนื่อง; ประเภทอื่น = วันทำการ
// ตัวเลข = เกณฑ์ "ได้รับเงินเดือน/ค่าตอบแทน/ค่าจ้าง" (จุดที่ควรเตือน) ส่วนเงื่อนไขพิเศษ (ปีแรก/วันสะสม/อายุงานขั้นต่ำ) อยู่ในหมายเหตุ
// ผู้ดูแลแก้ได้เสมอที่ชีต/หน้าเว็บ — seedLeaveQuotaDefaults() เติมเฉพาะแถวที่ยังไม่มี (ประเภทบุคลากร+ประเภทการลา)
const QUOTA_PROFILE_SEED = [
  // ข้าราชการ — ระเบียบสำนักนายกรัฐมนตรีว่าด้วยการลาของข้าราชการ พ.ศ. 2555 (และที่แก้ไขเพิ่มเติม)
  ['', 'ข้าราชการ', 'ลาป่วย', 120, 'เท่าที่ป่วยจริง เงินเดือน/ปี ≤60 วันทำการ ผู้มีอำนาจอนุมัติต่อได้อีก ≤60 (รวม ≤120)'],
  ['', 'ข้าราชการ', 'ลากิจ', 45, 'ได้รับเงินเดือนไม่เกิน 45 วันทำการ/ปี (ปีแรกที่เริ่มรับราชการ ≤15 วันทำการ)'],
  ['', 'ข้าราชการ', 'ลาพักร้อน', 10, '10 วันทำการ/ปี สะสมรวมกับปีปัจจุบันได้ ≤20 วัน (รับราชการติดต่อกัน ≥10 ปี ≤30) วันสะสมบันทึกผ่านสมุดยอด'],
  ['', 'ข้าราชการ', 'ลาคลอด', 90, 'ครั้งคลอดหนึ่งไม่เกิน 90 วัน รวมวันหยุด ได้รับเงินเดือนเต็มจำนวนตลอดการลา'],
  ['', 'ข้าราชการ', 'ลาอุปสมบท/ลาบวช', 120, 'ลาได้ไม่เกิน 120 วัน ต้องรับราชการมาแล้วไม่น้อยกว่า 12 เดือน'],
  ['', 'ข้าราชการ', 'ลาช่วยเหลือภรรยาคลอดบุตร', 15, 'ไม่เกิน 15 วันทำการ ต้องขอภายใน 90 วันนับแต่วันที่ภรรยาคลอดบุตร ได้รับเงินเดือนระหว่างลา'],
  // พนักงานราชการ — รวมประกาศสิทธิประโยชน์ (ฉบับที่ 4) พ.ศ. 2566
  ['', 'พนักงานราชการ', 'ลาป่วย', 30, 'เท่าที่ป่วยจริง ได้รับค่าตอบแทนปีหนึ่งไม่เกิน 30 วันทำการ'],
  ['', 'พนักงานราชการ', 'ลากิจ', 10, 'ได้รับค่าตอบแทนไม่เกิน 10 วันทำการ/ปี'],
  ['', 'พนักงานราชการ', 'ลาพักร้อน', 10, '10 วันทำการ/ปี (ปีแรกต้องปฏิบัติงานมาแล้ว ≥6 เดือน) สะสมรวมกับปีปัจจุบันได้ ≤15 วันทำการ'],
  ['', 'พนักงานราชการ', 'ลาคลอด', 90, 'ลาได้ 90 วัน — หน่วยงานจ่ายค่าตอบแทน 45 วัน อีก 45 วันรับเงินสงเคราะห์จากกองทุนประกันสังคม'],
  ['', 'พนักงานราชการ', 'ลาอุปสมบท/ลาบวช', 120, 'ลาได้ไม่เกิน 120 วัน ต้องได้รับการจ้างต่อเนื่องมาแล้ว ≥4 ปี ลาได้ 1 ครั้งตลอดสถานภาพ'],
  ['', 'พนักงานราชการ', 'ลาช่วยเหลือภรรยาคลอดบุตร', 15, 'ไม่เกิน 15 วันทำการติดต่อกัน ต้องลาภายใน 90 วันนับแต่วันที่ภรรยาโดยชอบด้วยกฎหมายคลอดบุตร (ประกาศสิทธิประโยชน์ ฉบับที่ 4 พ.ศ. 2566)'],
  // พนักงานกระทรวงสาธารณสุข — ประกาศคณะกรรมการบริหารพนักงานกระทรวงสาธารณสุข เรื่อง สิทธิประโยชน์ของ พกส.ทั่วไป พ.ศ. 2556 และฉบับแก้ไข พ.ศ. 2561
  ['', 'พนักงานกระทรวงสาธารณสุข', 'ลาป่วย', 60, 'ได้รับค่าจ้างระหว่างลาป่วยปีละไม่เกิน 60 วันทำการ'],
  ['', 'พนักงานกระทรวงสาธารณสุข', 'ลากิจ', 15, 'ได้รับค่าจ้างไม่เกิน 15 วันทำการ/ปี'],
  ['', 'พนักงานกระทรวงสาธารณสุข', 'ลาพักร้อน', 10, '10 วันทำการ/ปี — บางหน่วยบริการกำหนดสะสมได้ ≤15 วันตามอายุงานและคู่มือหน่วยงาน'],
  ['', 'พนักงานกระทรวงสาธารณสุข', 'ลาคลอด', 90, 'ไม่เกิน 90 วัน ได้รับค่าจ้างจากหน่วยงาน ≤45 วัน และมีสิทธิเบิกเงินสงเคราะห์จากประกันสังคม'],
  ['', 'พนักงานกระทรวงสาธารณสุข', 'ลาอุปสมบท/ลาบวช', 0, 'ประกาศ ก.บริหาร พกส. ไม่ระบุสิทธิลาอุปสมบท — ปรับได้ตามนโยบายหน่วยงาน'],
  ['', 'พนักงานกระทรวงสาธารณสุข', 'ลาช่วยเหลือภรรยาคลอดบุตร', 15, 'ลาได้ 15 วันทำการต่อการคลอดบุตร 1 ครั้ง โดยได้รับค่าจ้างระหว่างลา'],
  // ลูกจ้างประจำ — ระเบียบกระทรวงการคลังว่าด้วยลูกจ้างประจำของส่วนราชการ พ.ศ. 2537 (การลาอนุโลมตามระเบียบการลาของข้าราชการ)
  ['', 'ลูกจ้างประจำ', 'ลาป่วย', 60, 'ได้รับค่าจ้างปีละไม่เกิน 60 วันทำการ (อธิบดีขยายให้ได้อีกไม่เกิน 60 วันทำการ)'],
  ['', 'ลูกจ้างประจำ', 'ลากิจ', 45, 'ได้รับค่าจ้างไม่เกิน 45 วันทำการ (ปีแรกที่ทำงานไม่เกิน 15 วัน)'],
  ['', 'ลูกจ้างประจำ', 'ลาพักร้อน', 10, '10 วันทำการ/ปี สะสมรวมกับปีปัจจุบันได้ ≤20 วัน (ปฏิบัติงาน ≥10 ปี ≤30) วันสะสมบันทึกผ่านสมุดยอด'],
  ['', 'ลูกจ้างประจำ', 'ลาคลอด', 90, 'ลาได้ไม่เกิน 90 วัน ได้รับค่าจ้างเต็มตลอดการลา (อนุโลมเสมือนข้าราชการ)'],
  ['', 'ลูกจ้างประจำ', 'ลาอุปสมบท/ลาบวช', 120, 'อนุโลมตามระเบียบการลาของข้าราชการ — ทำงานมาแล้ว ≥12 เดือน จึงลาได้'],
  ['', 'ลูกจ้างประจำ', 'ลาช่วยเหลือภรรยาคลอดบุตร', 15, 'ไม่เกิน 15 วันทำการ; การได้รับค่าจ้างให้ตรวจเงื่อนไขตามระเบียบการจ่ายค่าจ้างและวันที่ยื่นลา'],
  // ลูกจ้างชั่วคราวรายเดือน — ระเบียบกระทรวงการคลังว่าด้วยการจ้างลูกจ้างชั่วคราวฯ + พ.ร.บ.คุ้มครองแรงงาน พ.ศ. 2541 (ฉบับปรับปรุง)
  ['', 'ลูกจ้างชั่วคราวรายเดือน', 'ลาป่วย', 15, 'จ้างต่อเนื่อง ≤15 วันทำการ/ปี (จ้าง 6 เดือน-1 ปี ได้ 8 วัน; ไม่ถึง 6 เดือนไม่มีสิทธิค่าจ้างระหว่างลา)'],
  ['', 'ลูกจ้างชั่วคราวรายเดือน', 'ลากิจ', 3, 'เอกสารหลักไม่ระบุ — ใช้สิทธิขั้นต่ำได้ค่าจ้าง ≥3 วันทำงาน/ปี ตาม พ.ร.บ.คุ้มครองแรงงาน'],
  ['', 'ลูกจ้างชั่วคราวรายเดือน', 'ลาพักร้อน', 10, '10 วันทำการ ต้องปฏิบัติงานมาแล้ว ≥6 เดือน ไม่มีสิทธิสะสมวันลา'],
  ['', 'ลูกจ้างชั่วคราวรายเดือน', 'ลาคลอด', 90, 'ลาได้ 90 วัน ได้รับค่าจ้างจากหน่วยงาน ≤45 วัน + เงินสงเคราะห์จากกองทุนประกันสังคม'],
  ['', 'ลูกจ้างชั่วคราวรายเดือน', 'ลาอุปสมบท/ลาบวช', 0, 'ไม่มีสิทธิตามระเบียบ — หากหน่วยงานอนุญาต ปรับได้'],
  ['', 'ลูกจ้างชั่วคราวรายเดือน', 'ลาช่วยเหลือภรรยาคลอดบุตร', 15, 'ลาได้ไม่เกิน 15 วันทำการ; สิทธิค่าจ้างขึ้นกับสัญญาและกฎหมายปัจจุบัน ให้ HR ยืนยันก่อนใช้จริง'],
  // ลูกจ้างรายวัน — ระเบียบกระทรวงการคลังว่าด้วยการจ้างลูกจ้างชั่วคราวฯ + พ.ร.บ.คุ้มครองแรงงาน พ.ศ. 2541 (ฉบับปรับปรุง)
  ['', 'ลูกจ้างรายวัน', 'ลาป่วย', 15, 'จ้างต่อเนื่อง ≤15 วันทำการ/ปี (จ้าง 6 เดือน-1 ปี ได้ 8 วัน; ไม่ถึง 6 เดือนไม่มีสิทธิค่าจ้างระหว่างลา)'],
  ['', 'ลูกจ้างรายวัน', 'ลากิจ', 3, 'เอกสารหลักไม่ระบุ — ใช้สิทธิขั้นต่ำได้ค่าจ้าง ≥3 วันทำงาน/ปี ตาม พ.ร.บ.คุ้มครองแรงงาน'],
  ['', 'ลูกจ้างรายวัน', 'ลาพักร้อน', 10, '10 วันทำการ ต้องปฏิบัติงานมาแล้ว ≥6 เดือน ไม่มีสิทธิสะสมวันลา'],
  ['', 'ลูกจ้างรายวัน', 'ลาคลอด', 90, 'ลาได้ 90 วัน ได้รับค่าจ้างจากหน่วยงาน ≤45 วัน + เงินสงเคราะห์จากกองทุนประกันสังคม'],
  ['', 'ลูกจ้างรายวัน', 'ลาอุปสมบท/ลาบวช', 0, 'ไม่มีสิทธิตามระเบียบ — หากหน่วยงานอนุญาต ปรับได้'],
  ['', 'ลูกจ้างรายวัน', 'ลาช่วยเหลือภรรยาคลอดบุตร', 15, 'ลาได้ไม่เกิน 15 วันทำการ; สิทธิค่าจ้างขึ้นกับสัญญาและกฎหมายปัจจุบัน ให้ HR ยืนยันก่อนใช้จริง'],
];

// สมุดรายการปรับยอดวันลา (ชีต LeaveBalances — ผู้ดูแลเพิ่ม/แก้/ลบผ่านหน้าเว็บตั้งค่าหรือชีตตรงๆ)
// ยอดที่แสดงทุกจุด = (ผลรวมจากใบลาจริงใน Notion) + (รายการปรับของปีนั้น) — ใบลายังเป็น source of truth
// "ยกมา" เพิ่มเข้าโควตา (เช่น พักร้อนสะสมจากปีก่อน) / "ใช้เพิ่ม" เพิ่มเข้ายอดใช้ (เช่น ลาก่อนมีระบบ)
const BALANCE_SHEET_COLUMNS = [
  'ปีงบประมาณ (พ.ศ.)', 'ชื่อ สกุล', 'ประเภทการลา',
  'ยกมา (วันใช้สิทธิ์)', 'ใช้เพิ่ม (วันใช้สิทธิ์)', 'เหตุผล', 'บันทึกเมื่อ',
  'Request ID', 'ผู้ดำเนินการ',
];

// ขอบเขตวันที่ยื่นได้: ย้อนหลัง (ลาป่วยมักแจ้งย้อน) และล่วงหน้า
const LEAVE_MAX_DAYS_BACK = 90;
const LEAVE_MAX_DAYS_AHEAD = 365;
const LEAVE_MAX_SPAN_DAYS = 365;

// ---------- ทำเนียบ Staff (ผู้ดูแล preload; ผู้ใช้ขอผูก LINE แล้วรออนุมัติ) ----------

function readStaffRoster_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName('Staff');
  if (!sheet) {
    throw new Error('ยังไม่ได้เตรียมระบบลางาน — ใช้เมนู "ระบบแจ้งเตือนปฏิทิน > เตรียม/ตรวจสอบชีตทั้งหมด" ก่อน');
  }
  const lastRow = sheet.getLastRow();
  const data = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, STAFF_SHEET_COLUMNS.length).getDisplayValues() : [];
  return data
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
      employmentType: String(row[8] || '').trim(), // คอลัมน์ที่ 9 — ว่าง = ยังไม่ระบุ (ใช้โควตาเริ่มต้นของระบบ)
      employeeId: String(row[9] || '').trim(),
      employmentStatus: String(row[10] || '').trim().toUpperCase(),
      bindingStatus: String(row[11] || '').trim().toUpperCase(),
      pendingLineUserId: String(row[12] || '').trim(),
      pendingLineDisplayName: String(row[13] || '').trim(),
      bindingRequestedAt: String(row[14] || '').trim(),
      bindingApprovedBy: String(row[15] || '').trim(),
      bindingApprovedAt: String(row[16] || '').trim(),
      bindingRequestId: String(row[17] || '').trim(),
    }))
    .filter(staff => staff.firstName && staff.lastName); // ต้องมีทั้งชื่อและสกุลจึงนับ
}

// ---------- ตารางโควตาตามประเภทบุคลากร (ชีต QuotaProfiles) ----------

/** อ่านแถวโควตาทั้งหมด (คืน [] ถ้ายังไม่มีชีต — ทุกคนใช้โควตาเริ่มต้นของระบบตามระเบียบราชการ)
 *  แถวที่ประเภท/ตัวเลขไม่ valid ถูกข้ามเงียบๆ เหมือนสมุดรายการปรับ */
function readQuotaProfiles_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName('QuotaProfiles');
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  const data = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, QUOTA_PROFILE_COLUMNS.length).getDisplayValues() : [];
  const byPolicyKey = new Map();
  data.forEach((row, i) => {
    const yearRaw = String(row[0]).trim();
    const employmentType = String(row[1] || '').trim();
    const rawLeaveType = String(row[2] || '').trim();
    const leaveType = normalizeLeaveTypeName_(rawLeaveType);
    const quota = Number(String(row[3]).trim());
    if (!employmentType || !leaveType || !Number.isFinite(quota) || quota < 0) return;
    if (yearRaw && !/^(25|26)\d{2}$/.test(yearRaw)) return; // ปีที่พิมพ์ผิดต้องไม่กลายเป็น "ทุกปี"
    const yearBE = yearRaw ? Number(yearRaw) : null;
    const item = {
      row: 3 + i,
      yearBE: yearBE,
      employmentType: employmentType,
      leaveType: leaveType,
      quota: quota,
      note: String(row[4] || '').trim(),
      legacyName: rawLeaveType !== leaveType,
    };
    const key = String(yearBE) + '|' + employmentType + '|' + leaveType;
    const existing = byPolicyKey.get(key);
    // ถ้ามีทั้งคำสะกดเก่าและใหม่ ให้แถวคำสะกดถูกต้องชนะ เพื่อไม่คิดโควตาซ้ำ/ขึ้นกับลำดับแถว
    if (!existing || (existing.legacyName && !item.legacyName)) byPolicyKey.set(key, item);
  });
  return Array.from(byPolicyKey.values()).map(item => {
    delete item.legacyName;
    return item;
  });
}

function isActiveStaff_(staff) {
  return !!staff && staff.employmentStatus === STAFF_ACTIVE_STATUS;
}

function isApprovedStaffBinding_(staff) {
  return isActiveStaff_(staff) && staff.bindingStatus === STAFF_BINDING_STATUS.approved &&
    !!staff.lineUserId;
}

function findAnyStaffByUserId_(roster, userId) {
  return (roster || []).find(s => s.lineUserId && s.lineUserId === userId) || null;
}

function findStaffByUserId_(roster, userId) {
  return (roster || []).find(s => isApprovedStaffBinding_(s) && s.lineUserId === userId) || null;
}

function findPendingStaffByUserId_(roster, userId) {
  return (roster || []).find(s =>
    (s.pendingLineUserId === userId && s.bindingStatus === STAFF_BINDING_STATUS.pending) ||
    (s.lineUserId === userId && s.bindingStatus !== STAFF_BINDING_STATUS.approved)) || null;
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

// ---------- สมุดรายการปรับยอดวันลา (ชีต LeaveBalances — ดูความหมายคอลัมน์ที่ BALANCE_SHEET_COLUMNS) ----------

/** อ่านรายการปรับยอดทั้งหมด (คืน [] ถ้ายังไม่มีชีต — ระบบทำงานได้ปกติเหมือนไม่มีรายการปรับ)
 *  แถวที่ปี/ตัวเลขไม่ valid ถูกข้ามเงียบๆ (กันพิมพ์ผิดทำให้ทั้งระบบยอดพัง) */
function readLeaveBalances_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName('LeaveBalances');
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  const data = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, BALANCE_SHEET_COLUMNS.length).getDisplayValues() : [];
  const rows = [];
  data.forEach((row, i) => {
    const yearBE = Number(String(row[0]).trim());
    const name = String(row[1] || '').trim().replace(/\s+/g, ' ');
    const leaveType = normalizeLeaveTypeName_(row[2]);
    const carryRaw = String(row[3]).trim();
    const usedRaw = String(row[4]).trim();
    const carryIn = carryRaw ? Number(carryRaw) : 0;
    const usedExtra = usedRaw ? Number(usedRaw) : 0;
    // ปีเป็น พ.ศ. (ช่วงเดียวกับหน้า Admin; กันพิมพ์ ค.ศ. ปน) ชื่อ-ประเภทต้องมี และต้องมีตัวเลขอย่างน้อยหนึ่งคอลัมน์
    if (!(yearBE >= 2500 && yearBE <= 2699) || !name || !leaveType ||
        !Number.isFinite(carryIn) || !Number.isFinite(usedExtra) ||
        carryIn < 0 || usedExtra < 0 || (carryIn === 0 && usedExtra === 0)) return;
    rows.push({
      row: 3 + i,
      yearBE: yearBE,
      name: name,
      leaveType: leaveType,
      carryIn: carryIn,
      usedExtra: usedExtra,
      reason: String(row[5] || '').trim(),
      recordedAt: String(row[6] || '').trim(),
      requestId: String(row[7] || '').trim(),
      actor: String(row[8] || '').trim(),
    });
  });
  return rows;
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
  return (roster || []).filter(s => isApprovedStaffBinding_(s) && names.includes(staffKey_(s)));
}

// พูลผู้อนุมัติทั้งหมดที่กำหนดไว้ในระบบ (ทุกกลุ่มงาน + หัวหน้า สสอ.) ที่ลงทะเบียนแล้ว
// ใช้เป็นเฟืองพื้นสุดท้ายเมื่อผู้อนุมัติเฉพาะกลุ่มยังไม่พร้อม (การ์ดเข้ากลุ่มหลัก ใครในพูลกดได้)
function allApproverPool_(config, settings, roster, excludeKey) {
  const names = new Set();
  config.forEach(c => c.approverNames.forEach(n => names.add(n)));
  secondApproverNames_(settings).forEach(n => names.add(n));
  return (roster || []).filter(s =>
    isApprovedStaffBinding_(s) && names.has(staffKey_(s)) && staffKey_(s) !== excludeKey);
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
  return !!(approverInfo && Array.isArray(approverInfo.userIds) &&
    approverInfo.userIds.includes(String(tapperUserId || '')));
}

// รายการประเภทการลา (แก้ได้ที่ Settings คีย์ leave_type_options)
function leaveTypeList_(settings) {
  return Array.from(new Set(
    optionList_(settings && settings.leave_type_options, LEAVE_TYPES_DEFAULT.join(','))
      .map(normalizeLeaveTypeName_)
  ));
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

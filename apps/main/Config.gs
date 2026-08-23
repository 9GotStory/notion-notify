/** การตั้งค่าระบบ: อ่าน/เขียนชีต Settings, เตรียมชีตทั้งหมด, เมนูใน Sheet,
 *  health check ความพร้อม และเมนูทดสอบต่างๆ (แยกจากโค้ดเดิม Code.gs ตามโดเมน —
 *  Apps Script merge ทุกไฟล์ .gs เป็น namespace เดียวตอนรัน การแยกไฟล์จึงเชิงจัดระเบียบ) */

function normalizeScheduleTime_(value) {
  const text = String(value == null ? '' : value).trim();
  const match = text.match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d(?:\.\d{1,3})?)?$/);
  if (!match || Number(match[1]) > 23) return text;
  return String(Number(match[1])).padStart(2, '0') + ':' + match[2];
}

function getSettings_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName('Settings');
  const lastRow = sheet.getLastRow();
  // Read display strings so time-formatted cells do not become Date objects.
  const data = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, 2).getDisplayValues() : [];
  const settings = {};
  data.forEach(([key, value]) => {
    const normalizedKey = String(key).trim();
    if (!normalizedKey) return;
    settings[normalizedKey] = normalizedKey === 'notify_time'
      ? normalizeScheduleTime_(value)
      : String(value).trim();
  });
  return settings;
}

function isHoliday_(date) {
  const sheet = SpreadsheetApp.getActive().getSheetByName('Holidays');
  const lastRow = sheet.getLastRow();
  const data = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, 1).getValues() : [];
  const target = Utilities.formatDate(date, 'Asia/Bangkok', 'yyyy-MM-dd');
  return data.some(([cell]) => {
    if (!cell) return false;
    const cellDate = cell instanceof Date
      ? Utilities.formatDate(cell, 'Asia/Bangkok', 'yyyy-MM-dd')
      : String(cell).trim();
    return cellDate === target;
  });
}

// ---------- เมนูในชีต ----------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ระบบแจ้งเตือนปฏิทิน')
    .addItem('ทดสอบส่งตอนนี้', 'testSendNow')
    .addItem('ทดสอบการ์ดใบลา', 'testLeaveCardNow')
    .addItem('ทดสอบสรุปรายเดือน', 'testMonthlyLeaveSummaryNow')
    .addItem('รัน Unit Tests', 'runUnitTests')
    .addItem('ติดตั้ง/อัปเดตเวลาส่งอัตโนมัติ', 'installTrigger')
    .addSeparator()
    .addItem('เตรียม/ตรวจสอบชีตทั้งหมด', 'setupSheet')
    .addItem('เปิด/ปิดระบบลา', 'toggleLeaveSystem')
    .addItem('เปิด/ปิดการอนุมัติใบลา', 'toggleLeaveApproval')
    .addToUi();
}

// ---------- เตรียมสเปรดชีตทั้งหมด (รันครั้งแรก หรือรันซ้ำเพื่อเติมของที่ขาด) ----------

// สร้าง/ตรวจสอบชีตทั้ง 4 (Settings/Holidays/Logs/Staff) ให้พร้อมใช้ — ทำให้ติดตั้งระบบบน
// สเปรดชีตเปล่าได้โดยไม่ต้องใช้ไฟล์ template เลย และรันซ้ำกี่ครั้งก็ปลอดภัย:
// ชีต/หัวตาราง/ค่า default เติมเฉพาะที่ยังไม่มี ค่าที่ผู้ใช้แก้ไว้แล้วไม่ถูกแตะทั้งสิ้น
function setupSheet() {
  const ss = SpreadsheetApp.getActive();
  const status = [];

  ensureSheet_(ss, 'Settings', 'การตั้งค่าระบบแจ้งเตือน + ระบบลางาน', ['คีย์', 'ค่า', 'คำอธิบาย'], status);
  ensureSheet_(ss, 'Holidays', 'วันหยุดราชการ (ตรวจทานกับ soc.go.th ทุกต้นปี)', ['วันที่', 'ชื่อวันหยุด', 'ประเภท'], status);
  ensureSheet_(ss, 'Logs', 'บันทึกการทำงานของระบบ (เขียนอัตโนมัติ ไม่ต้องแก้ไข)', ['เวลาที่บันทึก', 'วันที่', 'สถานะ', 'รายละเอียด'], status);
  ensureSheet_(ss, 'Approvers', 'ผู้อนุมัติระบบลางาน — กลุ่มงานไหน ใครอนุมัติ ส่งต่อ หัวหน้า สสอ. ไหม', APPROVERS_SHEET_COLUMNS, status);
  ensureSheet_(ss, 'Staff', 'ทำเนียบเจ้าหน้าที่ — เพิ่มอัตโนมัติเมื่อแต่ละคนลงทะเบียนผ่านฟอร์มเอง', STAFF_SHEET_COLUMNS, status);

  // บังคับรูปแบบวันที่ให้แสดงเป็น yyyy-MM-dd — โค้ดอ่านค่าตามที่แสดงบนจอ (readHolidaySet_)
  // ถ้าปล่อยให้ Sheet จัดรูปแบบภาษาไทย วันหยุดจะหลุดจากการนับวันทำการของใบลา
  const holidays = ss.getSheetByName('Holidays');
  holidays.getRange('A3:A').setNumberFormat('yyyy-MM-dd');
  ss.getSheetByName('Staff').getRange('H3:H').setNumberFormat('yyyy-MM-dd');
  // คอลัมน์ที่มีข้อความยาว กำหนดความกว้างให้อ่านง่าย (แตะได้ทุกครั้ง ไม่กระทบข้อมูล)
  ss.getSheetByName('Settings').setColumnWidth(3, 320); // คำอธิบาย
  ss.getSheetByName('Approvers').setColumnWidth(2, 260); // รายชื่อผู้อนุมัติ

  // เติมค่าตั้งต้นของ Settings เฉพาะ key ที่ยังไม่มี (พร้อมคำอธิบายในคอลัมน์ C — โค้ดอ่านแค่ A/B)
  const addedKeys = [];
  [
    ['enabled', 'TRUE', 'เปิด/ปิดระบบแจ้งเตือน (TRUE หรือ FALSE)'],
    ['notify_time', '08:30', 'เวลาส่งข้อความเช้า (HH:mm) — แก้แล้วต้องกดเมนู "ติดตั้ง/อัปเดตเวลาส่งอัตโนมัติ" ทุกครั้ง'],
    ['notion_database_id', 'your_notion_database_id', 'Database ID ของ "ปฏิทินการปฏิบัติงาน" ใน Notion'],
    ['line_group_id', '', 'เติมอัตโนมัติเมื่อบอทเข้ากลุ่ม LINE และมีคนพิมพ์ข้อความ 1 ครั้ง (ต้อง deploy webhook ก่อน)'],
    ['message_format', 'text', 'รูปแบบข้อความเช้า: text หรือ flex'],
    ['advance_notice_days', '1', 'แสดงส่วน "ล่วงหน้า" (งาน+ผู้ลาของ N วันถัดไป) ต่อท้ายข้อความเช้า: ใส่ 1-7 (เว้นว่าง = ปิด) — รวมในข้อความเดียวกับของวันนี้ จึงไม่เพิ่มโควตาข้อความ LINE'],
    ['leave_database_id', 'your_leave_database_id', 'Database ID ของ "ใบลา" ใน Notion (ระบบลางาน)'],
    ['leave_system_enabled', 'TRUE', 'สวิตช์ระบบลา: FALSE = ปิดรับลงทะเบียน/ยื่นลาใหม่ (ใช้เมนู "เปิด/ปิดระบบลา" สลับให้ได้) — ค่าอื่นใด/แถวหาย = เปิด'],
    ['leave_approval_enabled', 'TRUE', 'โหมดการอนุมัติ: FALSE = แจ้งลาอัตโนมัติ (บันทึกเป็นอนุมัติทันที แจ้งเข้ากลุ่มหลัก ไม่ต้องมีผู้อนุมัติ) — ใช้เมนู "เปิด/ปิดการอนุมัติใบลา" สลับได้'],
    ['leave_type_options', 'ลาป่วย,ลากิจ,ลาพักร้อน,ลาคลอด,ลาอุปสมบถ/ลาบวช,ลาช่วยเหลือภริยาคลอดบุตร,อื่นๆ', 'รายการประเภทการลาในฟอร์ม (คั่นด้วยจุลภาค) — ชื่อที่ตรงตามระเบียบจะได้รับการตรวจสิทธิ์/คำเตือนอัตโนมัติ'],
    ['leave_closed_message', '', 'ข้อความที่แสดงตอนระบบลาถูกปิด (เว้นว่าง = ใช้ข้อความมาตรฐาน เช่น ระบุช่วงเวลาปิดและผู้ติดต่อได้)'],
    ['monthly_leave_summary_enabled', 'TRUE', 'สรุปวันลารายเดือน (FALSE = ปิด): วันทำการแรกของแต่ละเดือน แนบสรุปใบลาที่อนุมัติของเดือนก่อนท้ายข้อความเช้า — รวมข้อความเดียวกัน ไม่เพิ่มโควตา LINE'],
    ['second_approvers', '', 'หัวหน้า สสอ. — รายชื่อ "ชื่อ สกุล" ของผู้อนุมัติขั้นสอง คั่นด้วยจุลภาค (ต้องลงทะเบียนในระบบแล้ว)'],
    ['prefix_options', 'นาย,นาง,นางสาว,อื่นๆ', 'ตัวเลือกคำนำหน้าชื่อในฟอร์มลงทะเบียน (คั่นด้วยจุลภาค — มี "อื่นๆ" = เปิดช่องพิมพ์เอง)'],
    ['position_options', 'นักวิชาการสาธารณสุข,นักวิชาการอนามัย,นักวิชาการคอมพิวเตอร์,นักบริหารงานสาธารณสุข,พยาบาลวิชาชีพ,พยาบาลช่วยแพทย์,เจ้าพนักงานธุรการ,ลูกจ้างชั่วคราว,อื่นๆ', 'ตัวเลือกตำแหน่งในฟอร์มลงทะเบียน (แก้ให้ตรงหน่วยงานได้เลย คั่นด้วยจุลภาค)'],
  ].forEach(row => {
    if (upsertSettingRow_(row[0], row[1], row[2])) addedKeys.push(row[0]);
  });

  // ตรวจความพร้อมระบบทั้งสายหลังสร้าง/เติมชีต — ให้ผู้ดูแลเห็นว่าขาดอะไรในคลิกเดียว
  const findings = collectSystemHealth_();

  const warnings = findings.filter(f => f[0] === 'warn');
  const infos = findings.filter(f => f[0] === 'info');
  const summary =
    'ผลการตรวจสอบชีต:\n' + status.join('\n') + '\n\n' +
    (addedKeys.length
      ? 'เติมค่าตั้งต้นใน Settings เพิ่ม: ' + addedKeys.join(', ') + '\n\n'
      : 'ค่าใน Settings ครบอยู่แล้ว (ไม่แตะของเดิม)\n\n') +
    'ความพร้อมของระบบ:\n' +
    (warnings.length
      ? warnings.map(f => '⚠ ' + f[1]).join('\n')
      : '✅ ทุกอย่างพร้อมใช้งาน') +
    (infos.length ? '\n' + infos.map(f => '• ' + f[1]).join('\n') : '');
  // ถ้ารันจากเมนูในชีต → เด้ง popup แต่ถ้ารันจากปุ่ม Run ใน editor (ไม่มี UI) → log แทน
  // แบบเดียวกับ runUnitTests ใน Tests.gs (งานจริงทำเสร็จก่อนถึงตรงนี้เสมอ จึงไม่ใช่จุดพังของข้อมูล)
  try {
    SpreadsheetApp.getUi().alert('เตรียมสเปรดชีตเรียบร้อย', summary, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    console.log(summary);
  }
}

// ตรวจทุนย่อยของระบบ — คืน [{ระดับ: 'warn'|'info', ข้อความ}] (ไม่ throw แม้ชีต/ค่ายังไม่ครบ เพราะจุดประสงค์คือรายงาน)
function collectSystemHealth_() {
  const findings = [];
  const settings = getSettings_();

  // Settings จำเป็น
  if (!settings.notion_database_id || String(settings.notion_database_id).trim() === 'your_notion_database_id') {
    findings.push(['warn', 'ยังไม่ใส่ notion_database_id — ข้อความสรุปเช้าจะไม่ออก']);
  }
  if (!settings.leave_database_id || String(settings.leave_database_id).trim() === 'your_leave_database_id') {
    findings.push(['warn', 'ยังไม่ใส่ leave_database_id — ระบบลาใช้ไม่ได้จนกว่าจะวาง ID ของ database "ใบลา"']);
  }
  if (!String(settings.line_group_id || '').trim()) {
    findings.push(['warn', 'ยังไม่มี line_group_id — เชิญบอทเข้ากลุ่ม LINE แล้วพิมพ์ข้อความ 1 ครั้ง (ต้อง deploy webhook ก่อน)']);
  }

  // Secret ใน Script Properties
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('LINE_CHANNEL_ACCESS_TOKEN')) {
    findings.push(['warn', 'ยังไม่ตั้ง LINE_CHANNEL_ACCESS_TOKEN ใน Script Properties — ส่งข้อความเข้า LINE ไม่ได้']);
  }
  if (!props.getProperty('NOTION_TOKEN')) {
    findings.push(['warn', 'ยังไม่ตั้ง NOTION_TOKEN ใน Script Properties — อ่าน/เขียน Notion ไม่ได้']);
  }
  if (!props.getProperty('LOGIN_CHANNEL_ID')) {
    findings.push(['info', 'ยังไม่ตั้ง LOGIN_CHANNEL_ID (ไม่บังคับ — ตั้งแล้วเพิ่มความเข้มงวดการตรวจ token ของ LIFF)']);
  }

  // ชีต Approvers
  let config = [];
  try { config = readApproversConfig_(); } catch (err) { /* ยังไม่มีชีต/ยังไม่มีแถว */ }
  if (!config.length) {
    findings.push(['warn', 'ชีต Approvers ยังไม่มีแถว — ฟอร์มลงทะเบียนจะไม่มีกลุ่มงานให้เลือก']);
  }
  const secondNames = splitConfigNames_(settings.second_approvers);
  config.forEach(c => {
    if (c.forward && !secondNames.length) {
      findings.push(['warn', 'กลุ่ม "' + c.groupName + '" ตั้งค่าส่งต่อ หัวหน้า สสอ. แต่ยังไม่ใส่รายชื่อใน second_approvers']);
    }
  });
  const dupGroups = findDuplicates_(config.map(c => c.groupName));
  if (dupGroups.length) findings.push(['warn', 'ชื่อกลุ่มงานซ้ำกันในชีต Approvers: ' + dupGroups.join(', ')]);

  // ชีต Staff (ชื่อซ้ำ + สถานะการลงทะเบียน)
  let roster = [];
  try { roster = readStaffRoster_(); } catch (err) { /* ยังไม่มีชีต */ }
  const dupNames = findDuplicates_(roster.map(s => staffKey_(s)));
  if (dupNames.length) findings.push(['warn', 'ชื่อ-สกุลซ้ำกันในชีต Staff: ' + dupNames.join(', ')]);
  if (roster.length) {
    const registered = roster.filter(s => s.lineUserId).length;
    findings.push(['info', 'ทำเนียบ Staff: ลงทะเบียนแล้ว ' + registered + '/' + roster.length + ' คน']);
  }

  // ผู้อนุมัติที่อ้างในคอนฟิกแต่ยังไม่มีชื่อนี้ใน Staff (ยังไม่ลงทะเบียน หรือพิมพ์ไม่ตรง)
  const staffKeys = new Set(roster.map(s => staffKey_(s)));
  const unknownApprovers = [];
  config.forEach(c => c.approverNames.forEach(n => {
    if (!staffKeys.has(n)) unknownApprovers.push(n + ' (กลุ่ม ' + c.groupName + ')');
  }));
  secondNames.forEach(n => {
    if (!staffKeys.has(n)) unknownApprovers.push(n + ' (หัวหน้า สสอ.)');
  });
  if (unknownApprovers.length) {
    findings.push(['info', 'ผู้อนุมัติที่ยังไม่มีชื่อนี้ในชีต Staff (ยังไม่ลงทะเบียน หรือสะกดไม่ตรงกัน): ' + unknownApprovers.join(', ')]);
  }

  // Trigger เวลาส่งเช้า
  const hasTrigger = ScriptApp.getProjectTriggers().some(
    t => t.getHandlerFunction() === 'checkAndSendNotification');
  if (!hasTrigger) {
    findings.push(['warn', 'ยังไม่ตั้งเวลาส่งอัตโนมัติ — กดเมนู "ติดตั้ง/อัปเดตเวลาส่งอัตโนมัติ"']);
  }

  // สถานะสวิตช์ระบบลา
  if (!isLeaveSystemEnabled_(settings)) {
    findings.push(['warn', 'ระบบลาถูกปิดอยู่ (leave_system_enabled = FALSE) — กดเมนู "เปิด/ปิดระบบลา" เพื่อเปิดกลับ']);
  }
  if (isLeaveSystemEnabled_(settings) && !isLeaveApprovalEnabled_(settings)) {
    findings.push(['info', 'โหมดแจ้งลาอัตโนมัติ: การอนุมัติถูกปิดอยู่ — ยื่นแล้วบันทึกเป็นอนุมัติทันที แจ้งเข้ากลุ่มหลัก (ไม่ใช้ผู้อนุมัติในชีต Approvers)']);
  }

  return findings;
}

// หาค่าที่ซ้ำในลิสต์ (pure — ใช้ตรวจชื่อกลุ่มงาน/ชื่อคนซ้ำ)
function findDuplicates_(values) {
  const seen = new Set();
  const dup = new Set();
  (values || []).forEach(v => {
    if (v && seen.has(v)) dup.add(v);
    seen.add(v);
  });
  return Array.from(dup);
}

// สร้างชีตถ้ายังไม่มี + ใส่หัวตารางถ้ายังไม่ใส่ (แถว 1 = ชื่อตาราง, แถว 2 = หัวคอลัมน์, ข้อมูลเริ่มแถว 3)
// ถ้าชีตมีอยู่แล้วแต่หัวตารางไม่ตรง "และ" มีข้อมูลอยู่ (เช่นโครงคอลัมน์รุ่นเก่า) จะไม่แตะ
// แล้วแจ้งเตือนให้จัดการย้ายข้อมูลเองก่อน — กันพังข้อมูลเงียบๆ
function ensureSheet_(ss, name, title, headers, status) {
  let sheet = ss.getSheetByName(name);
  const isNew = !sheet;
  if (isNew) sheet = ss.insertSheet(name);

  const currentHeader = String(sheet.getRange(2, 1).getDisplayValue()).trim();
  const hasData = sheet.getLastRow() > 2;
  if (currentHeader && currentHeader !== String(headers[0]).trim() && hasData) {
    status.push('⚠ ชีต ' + name + ' ใช้หัวตารางโครงเดิมและมีข้อมูลอยู่ — ไม่แตะ ให้ย้ายข้อมูลเองแล้วลบหัวเดิม (ดู SETUP.md)');
    return;
  }
  if (currentHeader !== String(headers[0]).trim()) {
    sheet.getRange(1, 1).setValue(title);
    headers.forEach((header, i) => sheet.getRange(2, i + 1).setValue(header));
    sheet.getRange(2, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(2);
    status.push((isNew ? 'สร้างใหม่: ' : 'เติมหัวตาราง: ') + name);
  } else {
    status.push((isNew ? 'สร้างใหม่: ' : 'พร้อมอยู่แล้ว: ') + name);
  }
}

// ---------- สวิตช์เปิด/ปิดระบบลา (สลับค่า leave_system_enabled ในชีต Settings) ----------

// กดแล้วสลับสถานะ + log ทุกครั้ง — ปิดระบบ = หยุดรับลงทะเบียน/ยื่นลาใหม่
// (ใบลาเดิมที่รออนุมัติยังกดปุ่มได้ตามปกติ และสรุปเช้ายังแสดงผู้ลาที่อนุมัติแล้ว)
function toggleLeaveSystem() {
  const settings = getSettings_();
  const nowEnabled = !isLeaveSystemEnabled_(settings); // สลับจากสถานะปัจจุบัน
  setSettingValue_('leave_system_enabled', nowEnabled ? 'TRUE' : 'FALSE');
  logResult_(new Date(), 'leave',
    'ผู้ดูแล' + (nowEnabled ? 'เปิด' : 'ปิด') + 'ระบบลา' + (nowEnabled ? '' : ' (ข้อความที่แสดง: ' + leaveClosedMessage_(settings) + ')'));

  const summary =
    'ระบบลา: ' + (nowEnabled ? '🟢 เปิดใช้งาน' : '🔴 ปิดใช้งาน') + '\n\n' +
    (nowEnabled
      ? 'เจ้าหน้าที่ลงทะเบียนและยื่นใบลาได้ตามปกติ'
      : 'การลงทะเบียนและการยื่นใบลาใหม่ถูกปฏิเสธทันที\n' +
        'ใบลาเดิมที่รออนุมัติอยู่ ยังกดปุ่มอนุมัติได้ตามปกติ\n' +
        'สรุปเช้า "ผู้ลาวันนี้" ยังแสดงผลจากใบที่อนุมัติแล้ว\n\n' +
        'ข้อความที่ผู้ยื่นเห็นตอนปิดอยู่นี้:\n"' + leaveClosedMessage_(settings) + '"\n' +
        '(แก้ได้ที่คีย์ leave_closed_message ในชีต Settings)');
  try {
    SpreadsheetApp.getUi().alert('สถานะระบบลา', summary, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    console.log(summary); // รันจาก editor ไม่มี UI
  }
}

// สลับโหมดการอนุมัติ: เปิด = ใช้ผู้อนุมัติตามชีต Approvers ตามปกติ
// ปิด = "แจ้งลาอัตโนมัติ" ยื่นแล้วบันทึกเป็นอนุมัติทันที แจ้งการ์ดเข้ากลุ่มหลัก ไม่ต้องเรียกผู้อนุมัติ
function toggleLeaveApproval() {
  const settings = getSettings_();
  const nowEnabled = !isLeaveApprovalEnabled_(settings); // สลับจากสถานะปัจจุบัน
  setSettingValue_('leave_approval_enabled', nowEnabled ? 'TRUE' : 'FALSE');
  logResult_(new Date(), 'leave', 'ผู้ดูแล' + (nowEnabled ? 'เปิด' : 'ปิด') + 'การอนุมัติใบลา');

  const summary =
    'การอนุมัติใบลา: ' + (nowEnabled ? '🟢 เปิด (ใช้ผู้อนุมัติตามชีต Approvers)' : '🔵 ปิด — โหมดแจ้งลาอัตโนมัติ') + '\n\n' +
    (nowEnabled
      ? 'ใบลาใหม่จะส่งการ์ดให้ผู้อนุมัติตามปกติ'
      : 'ใบลาใหม่จะบันทึกเป็น "อนุมัติ" ทันทีโดยไม่ต้องมีใครกดปุ่ม\n' +
        'และแจ้งการ์ด (ไม่มีปุ่ม) เข้ากลุ่มหลัก + แจ้งผู้ยื่นกลับ\n' +
        'ใบลาเดิมที่กำลังรออนุมัติอยู่ ยังกดปุ่มได้ตามปกติจนกว่าจะจบ\n' +
        'ไม่ต้องมีคอนฟิกผู้อนุมัติในชีต Approvers ก็ยื่นลาได้ในโหมดนี้');
  try {
    SpreadsheetApp.getUi().alert('โหมดการอนุมัติใบลา', summary, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    console.log(summary); // รันจาก editor ไม่มี UI
  }
}

// เขียนทับค่าของ key ที่มีอยู่ (ต่างจาก upsertSettingRow_ ที่ไม่แตะของเดิม) — ไม่มีแถวก็เพิ่มใหม่
function setSettingValue_(key, value) {
  const sheet = SpreadsheetApp.getActive().getSheetByName('Settings');
  const lastRow = sheet.getLastRow();
  const data = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, 1).getValues() : [];
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === key) {
      sheet.getRange(3 + i, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value, '']);
}

// เติม key/value/description ลงชีต Settings ถ้ายังไม่มี key นั้น — คืน true ถ้าเพิ่ม, false ถ้ามีอยู่แล้ว
function upsertSettingRow_(key, value, description) {
  const sheet = SpreadsheetApp.getActive().getSheetByName('Settings');
  const lastRow = sheet.getLastRow();
  const data = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, 1).getValues() : [];
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === key) return false;
  }
  sheet.appendRow([key, value, description || '']);
  return true;
}

// ส่งการ์ดขออนุมัติใบลาตัวอย่างเข้ากลุ่มหลัก เพื่อเช็คหน้าตา/ปุ่มก่อนใช้จริง (ไม่แตะ Notion)
function testLeaveCardNow() {
  const settings = getSettings_();
  if (!settings.line_group_id) {
    SpreadsheetApp.getUi().alert('ยังไม่มี line_group_id ในชีต Settings');
    return;
  }
  try {
    const samplePage = {
      pageId: 'sample-page-for-preview-only',
      fullName: 'นายสมศักดิ์ ใจดี (ตัวอย่าง)',
      groupName: 'กลุ่มงานคลังสินค้า',
      leaveType: 'ลากิจ',
      start: bangkokTodayStr_(),
      end: bangkokTodayStr_(),
      reason: 'ไปต่อด่านที่ว่าการอำเภอ (ข้อมูลตัวอย่าง)',
      status: LEAVE_STATUS.pendingApprover,
      workDays: 1,
    };
    const bubble = buildLeaveApprovalBubble_(samplePage);
    sendLineMessage_(settings.line_group_id, {
      type: 'flex',
      altText: '🧪 การ์ดขออนุมัติใบลา (ตัวอย่าง) — ' + samplePage.fullName,
      contents: bubble,
    });
    logResult_(new Date(), 'success (manual test)', 'ส่งการ์ดใบลาตัวอย่างแล้ว');
    SpreadsheetApp.getUi().alert('ส่งการ์ดตัวอย่างแล้ว ลองเช็คในกลุ่ม LINE (ปุ่มบนการ์ดตัวอย่างกดแล้วจะไม่มีผลกับข้อมูลจริง)');
  } catch (err) {
    logResult_(new Date(), 'error (manual test)', String(err));
    SpreadsheetApp.getUi().alert('ส่งการ์ดตัวอย่างไม่สำเร็จ: ' + err);
  }
}

// ส่งส่วนสรุปวันลารายเดือนเดี่ยวๆ เข้ากลุ่มหลักเพื่อดูหน้าตาโดยไม่ต้องรอข้ามเดือน
// (สรุปเดือนก่อนหน้าเสมอ — เหมือนที่ระบบจะส่งจริงในเช้าวันทำการแรกของเดือนถัดไป)
// ไม่ upsert marker last_monthly_leave_summary: การส่งจริงของเดือนยังทำงานตามปกติ
function testMonthlyLeaveSummaryNow() {
  const settings = getSettings_();
  if (!settings.line_group_id) {
    SpreadsheetApp.getUi().alert('ยังไม่มี line_group_id ในชีต Settings');
    return;
  }
  try {
    const now = new Date();
    const currentMonth = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM');
    const targetMonth = previousMonthKey_(currentMonth);
    const summary = buildMonthlyLeaveSummary_(targetMonth,
      aggregateLeavesByPersonMonth_(getApprovedLeavesForMonth_(now, settings.leave_database_id, targetMonth)));
    if (!summary) {
      SpreadsheetApp.getUi().alert('เดือน ' + targetMonth + ' ไม่มีใบลาที่อนุมัติแล้วเลย จึงไม่มีสรุปให้ทดสอบ');
      return;
    }
    sendLineMessage_(settings.line_group_id, {
      type: 'text',
      text: summary.title + '\n' + summary.lines.join('\n') + '\n' + summary.totalLine,
    });
    logResult_(now, 'success (manual test)', 'ส่งสรุปวันลารายเดือนตัวอย่างแล้ว (' + targetMonth + ')');
    SpreadsheetApp.getUi().alert('ส่งสรุปรายเดือนแล้ว ลองเช็คในกลุ่ม LINE');
  } catch (err) {
    logResult_(new Date(), 'error (manual test)', String(err));
    SpreadsheetApp.getUi().alert('ทดสอบสรุปรายเดือนไม่สำเร็จ: ' + err);
  }
}

function testSendNow() {
  const settings = getSettings_();
  if (!settings.notion_database_id || !settings.line_group_id) {
    SpreadsheetApp.getUi().alert('กรอก notion_database_id และ line_group_id ในชีต Settings ให้ครบก่อน');
    return;
  }
  try {
    const now = new Date();
    const items = getNotionItemsForDay_(now, settings.notion_database_id);
    const leaves = getApprovedLeavesForDay_(now, settings.leave_database_id);
    const advance = collectAdvanceNotice_(now, settings);
    // ปุ่มทดสอบนี้ส่งข้อความเสมอแม้วันนี้ไม่มีงาน/ผู้ลา เพื่อยืนยันว่าต่อ LINE สำเร็จจริง
    // ต่างจากตอนรันจริงตอนเช้า ซึ่งถ้าไม่มีงาน ไม่มีผู้ลา และไม่มีส่วนล่วงหน้าเลยจะไม่ส่งข้อความ
    const messageObj = items.length === 0 && leaves.length === 0 && !advance
      ? { type: 'text', text: '🧪 ข้อความทดสอบ — เชื่อมต่อ LINE และ Notion สำเร็จ\n\n(วันนี้ไม่มีงานในระบบ ถ้าเป็นการรันจริงตอนเช้า ระบบจะไม่ส่งข้อความในกรณีนี้)' }
      : buildLineMessage_(now, items, leaves, settings.message_format, advance);
    sendLineMessage_(settings.line_group_id, messageObj);
    logResult_(now, 'success (manual test)', messagePreview_(messageObj).substring(0, 300));
    SpreadsheetApp.getUi().alert('ส่งข้อความทดสอบแล้ว ลองเช็คในกลุ่ม LINE');
  } catch (err) {
    logResult_(new Date(), 'error (manual test)', String(err));
    SpreadsheetApp.getUi().alert('ทดสอบส่งไม่สำเร็จ: ' + err);
  }
}

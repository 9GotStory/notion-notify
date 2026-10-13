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
    .addItem('ตรวจใบลาคร่อมปีงบประมาณ', 'auditFiscalYearCrossingLeaves')
    .addItem('ร่างยอดยกมาปีถัดไป', 'draftCarryOverNextYear')
    .addItem('รัน Unit Tests', 'runUnitTests')
    .addItem('ติดตั้ง/อัปเดตเวลาส่งอัตโนมัติ', 'installTrigger')
    .addItem('สร้างรหัสจับคู่กลุ่ม LINE', 'startLineGroupPairing')
    .addSeparator()
    .addItem('เตรียม/ตรวจสอบชีตทั้งหมด', 'setupSheet')
    .addItem('เติมสิทธิ์วันลาตามระเบียบ', 'seedLeaveQuotaDefaults')
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

  migrateFiscalYearHeaders_(ss, status);

  ensureSheet_(ss, 'Settings', 'การตั้งค่าระบบแจ้งเตือน + ระบบลางาน', ['คีย์', 'ค่า', 'คำอธิบาย'], status);
  ensureSheet_(ss, 'Holidays', 'วันหยุดราชการ (ตรวจทานกับ soc.go.th ทุกต้นปี)', ['วันที่', 'ชื่อวันหยุด', 'ประเภท'], status);
  ensureSheet_(ss, 'Logs', 'บันทึกการทำงานของระบบ (เขียนอัตโนมัติ ไม่ต้องแก้ไข)', ['เวลาที่บันทึก', 'วันที่', 'สถานะ', 'รายละเอียด'], status);
  ensureSheet_(ss, 'Approvers', 'ผู้อนุมัติระบบลางาน — กลุ่มงานไหน ใครอนุมัติ ส่งต่อ หัวหน้า สสอ. ไหม', APPROVERS_SHEET_COLUMNS, status);
  ensureSheet_(ss, 'Staff', 'ทำเนียบเจ้าหน้าที่ที่ผู้ดูแลรับรอง — ผู้ใช้ขอผูก LINE ด้วยรหัสบุคลากรและรออนุมัติ', STAFF_SHEET_COLUMNS, status);
  ensureSheet_(ss, 'LeaveBalances', 'สมุดรายการปรับยอดวันลา — ยอดที่แสดงทุกจุด = ใบลาจริง + รายการในนี้ (จัดการผ่านหน้าเว็บตั้งค่าหรือแก้ตรงนี้)', BALANCE_SHEET_COLUMNS, status);
  ensureSheet_(ss, 'QuotaProfiles', QUOTA_PROFILE_SHEET_TITLE, QUOTA_PROFILE_COLUMNS, status);
  // migration: เติมหัวคอลัมน์ Staff ที่ต่อท้ายภายหลัง โดยไม่ขยับข้อมูลเดิม
  const staffSheet = ss.getSheetByName('Staff');
  if (staffSheet) {
    const currentHeaders = staffSheet.getRange(2, 1, 1, STAFF_SHEET_COLUMNS.length).getDisplayValues()[0];
    const migrateExistingBindings = !String(currentHeaders[10] || '').trim() &&
      !String(currentHeaders[11] || '').trim();
    const missingHeaders = [];
    STAFF_SHEET_COLUMNS.forEach((header, index) => {
      if (!String(currentHeaders[index] || '').trim()) {
        staffSheet.getRange(2, index + 1).setValue(header);
        missingHeaders.push(header);
      }
    });
    if (missingHeaders.length) status.push('เติมหัวคอลัมน์ใหม่ให้ชีต Staff: ' + missingHeaders.join(', '));
    // การติดตั้งเดิมมีเฉพาะบัญชีที่ใช้งานจริง: grandfather แถวเดิมหนึ่งครั้งเมื่อเพิ่มคอลัมน์สถานะ
    // เพื่อไม่ล็อกผู้ใช้ทั้งหมดทันที ส่วนรหัสบุคลากรยังต้องให้ผู้ดูแลเติมจากแหล่งข้อมูล HR
    if (migrateExistingBindings && staffSheet.getLastRow() >= 3) {
      const existing = staffSheet.getRange(3, 1, staffSheet.getLastRow() - 2, STAFF_SHEET_COLUMNS.length)
        .getDisplayValues();
      let migrated = 0;
      existing.forEach((row, index) => {
        if (!String(row[1]).trim() || !String(row[2]).trim()) return;
        staffSheet.getRange(3 + index, 11).setValue(STAFF_ACTIVE_STATUS);
        if (String(row[5]).trim()) {
          staffSheet.getRange(3 + index, 12).setValue(STAFF_BINDING_STATUS.approved);
          migrated++;
        }
      });
      status.push('รับรองบัญชี LINE เดิม ' + migrated + ' คนจากโครงชีตก่อน migration; ผู้ดูแลต้องเติมรหัสบุคลากร');
    }
  }

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
    ['line_group_id', '', 'Group ID ที่ผู้ดูแลยืนยันแล้ว — จับคู่ด้วยรหัสใช้ครั้งเดียวจากเมนู ห้ามรับทุกข้อความใน webhook'],
    ['message_format', 'text', 'รูปแบบข้อความเช้า: text หรือ flex'],
    ['logs_retention_days', '90', 'จำนวนวันที่เก็บชีต Logs: 30-3650 วัน (ค่าเริ่มต้น 90) — ลบอัตโนมัติวันละครั้ง ไม่กระทบ AuditLog/SecurityEvents'],
    ['advance_notice_days', '1', 'แสดงส่วน "ล่วงหน้า" (งาน+ผู้ลาของ N วันถัดไป) ต่อท้ายข้อความเช้า: ใส่ 1-7 (เว้นว่าง = ปิด) — รวมในข้อความเดียวกับของวันนี้ จึงไม่เพิ่มโควตาข้อความ LINE'],
    ['leave_database_id', 'your_leave_database_id', 'Database ID ของ "ใบลา" ใน Notion (ระบบลางาน)'],
    ['leave_system_enabled', 'TRUE', 'สวิตช์ระบบลา: FALSE = ปิดรับลงทะเบียน/ยื่นลาใหม่ (ใช้เมนู "เปิด/ปิดระบบลา" สลับให้ได้) — ค่าอื่นใด/แถวหาย = เปิด'],
    ['leave_approval_enabled', 'TRUE', 'โหมดการอนุมัติ: FALSE = แจ้งลาอัตโนมัติ (บันทึกเป็นอนุมัติทันที แจ้งเข้ากลุ่มหลัก ไม่ต้องมีผู้อนุมัติ) — ใช้เมนู "เปิด/ปิดการอนุมัติใบลา" สลับได้'],
    ['leave_type_options', 'ลาป่วย,ลากิจ,ลาพักร้อน,ลาคลอด,ลาอุปสมบท/ลาบวช,ลาช่วยเหลือภรรยาคลอดบุตร,อื่นๆ', 'รายการประเภทการลาในฟอร์ม (คั่นด้วยจุลภาค) — ชื่อที่ตรงตามระเบียบจะได้รับการตรวจสิทธิ์/คำเตือนอัตโนมัติ'],
    ['leave_closed_message', '', 'ข้อความที่แสดงตอนระบบลาถูกปิด (เว้นว่าง = ใช้ข้อความมาตรฐาน เช่น ระบุช่วงเวลาปิดและผู้ติดต่อได้)'],
    ['monthly_leave_summary_enabled', 'TRUE', 'สรุปวันลารายเดือน (FALSE = ปิด): วันทำการแรกของแต่ละเดือน แนบสรุปใบลาที่อนุมัติของเดือนก่อนท้ายข้อความเช้า — รวมข้อความเดียวกัน ไม่เพิ่มโควตา LINE'],
    ['second_approvers', '', 'หัวหน้า สสอ. — รายชื่อ "ชื่อ สกุล" ของผู้อนุมัติขั้นสอง คั่นด้วยจุลภาค (ต้องลงทะเบียนในระบบแล้ว)'],
    ['leave_pending_reminder_hours', '24', 'เตือนผู้อนุมัติปัจจุบันเมื่อใบลารอครบ N ชั่วโมง (1-720)'],
    ['leave_pending_escalation_hours', '48', 'แจ้ง หัวหน้า สสอ. เพื่อทราบเมื่อใบลารอครบ N ชั่วโมง (1-720; ไม่เปลี่ยนผู้อนุมัติอัตโนมัติ)'],
    ['employment_type_options', 'ข้าราชการ,พนักงานราชการ,พนักงานกระทรวงสาธารณสุข,ลูกจ้างประจำ,ลูกจ้างชั่วคราวรายเดือน,ลูกจ้างรายวัน,อื่นๆ', 'ตัวเลือกประเภทบุคลากรในฟอร์มลงทะเบียน (คั่นจุลภาค) — ใช้จับคู่โควตาจากชีต QuotaProfiles'],
    ['leave_policy_reviewed_at', '', 'วันที่ HR ตรวจทานโควตา/เงื่อนไขกับระเบียบ สัญญาจ้าง และประกาศล่าสุดแล้ว (YYYY-MM-DD) — ทบทวนอย่างน้อยปีละครั้ง'],
    ['prefix_options', 'นาย,นาง,นางสาว,อื่นๆ', 'ตัวเลือกคำนำหน้าชื่อในฟอร์มลงทะเบียน (คั่นด้วยจุลภาค — มี "อื่นๆ" = เปิดช่องพิมพ์เอง)'],
    ['position_options', 'นักวิชาการสาธารณสุข,นักวิชาการอนามัย,นักวิชาการคอมพิวเตอร์,นักบริหารงานสาธารณสุข,พยาบาลวิชาชีพ,พยาบาลช่วยแพทย์,เจ้าพนักงานธุรการ,ลูกจ้างชั่วคราว,อื่นๆ', 'ตัวเลือกตำแหน่งในฟอร์มลงทะเบียน (แก้ให้ตรงหน่วยงานได้เลย คั่นด้วยจุลภาค)'],
    ['admin_staff', '', 'รายชื่อผู้ดูแลระบบ — "ชื่อ สกุล" คั่นลูกน้ำ (เช่น สมชาย ใจดี, สมหญิง มีสุข): ใครอยู่ในรายชื่อและผูก LINE กับทำเนียบแล้ว ล็อกอินหน้าผู้ดูแลด้วย LINE ได้ · ต้องใส่ทั้งชื่อและสกุล (ชื่อต้นซ้ำกันได้จึงใช้เทียบเต็ม) · เว้นว่าง = ใช้รหัส ADMIN_TOKEN อย่างเดียว (แก้ได้จากหน้าเว็บผู้ดูแล > ตั้งค่าระบบ)'],
  ].forEach(row => {
    if (upsertSettingRow_(row[0], row[1], row[2])) addedKeys.push(row[0]);
  });

  // เปลี่ยนเฉพาะข้อความหัวคอลัมน์ ไม่แตะข้อมูล: สิทธิ์บางประเภทนับวันปฏิทิน จึงห้ามเรียกรวมว่า "วันทำการ"
  const quotaSheet = ss.getSheetByName('QuotaProfiles');
  if (quotaSheet && String(quotaSheet.getRange(2, 1).getDisplayValue()).trim() === QUOTA_PROFILE_COLUMNS[0]) {
    quotaSheet.getRange(2, 4).setValue(QUOTA_PROFILE_COLUMNS[3]);
  }
  const balanceSheet = ss.getSheetByName('LeaveBalances');
  if (balanceSheet) {
    const balanceHeaders = balanceSheet.getRange(2, 1, 1, BALANCE_SHEET_COLUMNS.length).getDisplayValues()[0];
    const missingBalanceHeaders = [];
    BALANCE_SHEET_COLUMNS.forEach((header, index) => {
      if (!String(balanceHeaders[index] || '').trim()) {
        balanceSheet.getRange(2, index + 1).setValue(header);
        missingBalanceHeaders.push(header);
      }
    });
    if (missingBalanceHeaders.length) {
      status.push('เติมหัวคอลัมน์ใหม่ให้ชีต LeaveBalances: ' + missingBalanceHeaders.join(', '));
    }
    if (String(balanceSheet.getRange(2, 1).getDisplayValue()).trim() === BALANCE_SHEET_COLUMNS[0]) {
      balanceSheet.getRange(2, 4, 1, 2).setValues([[BALANCE_SHEET_COLUMNS[3], BALANCE_SHEET_COLUMNS[4]]]);
    }
  }
  const spellingMigration = migrateLeaveTypeSpelling_();
  if (spellingMigration.updated) {
    status.push('แก้คำสะกดประเภทการลาในข้อมูลตั้งค่าเดิม ' + spellingMigration.updated + ' จุด');
  }
  if (spellingMigration.conflicts) {
    status.push('⚠ พบโควตาที่มีทั้งคำสะกดเก่าและใหม่ ' + spellingMigration.conflicts +
      ' แถว — ระบบใช้แถวคำสะกดใหม่ ให้ HR ตรวจและลบแถวเก่าที่ซ้ำ');
  }

  // เติมแถวสิทธิ์อ้างอิงระเบียบลงชีต QuotaProfiles (เฉพาะคู่ ประเภทบุคลากร+ประเภทการลา ที่ยังไม่มี — ไม่แตะของที่แก้ไว้แล้ว)
  const seeded = seedLeaveQuotaDefaults_();
  if (seeded.blocked) status.push('⚠ ' + seeded.blocked);
  else if (seeded.added) status.push('เติมสิทธิ์วันลาตามระเบียบ ' + seeded.added + ' รายการ ลงชีต QuotaProfiles');
  if (seeded.migrated) status.push('ปรับสิทธิ์ลาช่วยเหลือภรรยาคลอดบุตรจาก seed เก่าที่ยังไม่เคยแก้ ' + seeded.migrated + ' รายการ');

  // migration: ตัวเลือกประเภทบุคลากรเดิมยังไม่มี "พนักงานกระทรวงสาธารณสุข" — เติมให้โดยแทรกก่อน "อื่นๆ"
  // (ระบบโควตาใช้ชื่อนี้จับคู่แถวใน QuotaProfiles — รายการอื่นที่ผู้ดูแลปรับไว้เองไม่ถูกแตะ)
  const empRaw = String(getSettings_().employment_type_options || '');
  if (empRaw && empRaw.indexOf('พนักงานกระทรวงสาธารณสุข') === -1) {
    const list = empRaw.split(',').map(s => s.trim()).filter(Boolean);
    const at = list.indexOf('อื่นๆ');
    if (at >= 0) list.splice(at, 0, 'พนักงานกระทรวงสาธารณสุข');
    else list.push('พนักงานกระทรวงสาธารณสุข');
    setSettingValue_('employment_type_options', list.join(','));
    status.push('เติมตัวเลือก "พนักงานกระทรวงสาธารณสุข" ใน Settings (employment_type_options)');
  }

  try {
    if (ensurePendingLeaveReminderTrigger_()) status.push('ติดตั้ง trigger ตรวจใบลาค้างทุกชั่วโมง');
  } catch (triggerErr) {
    status.push('⚠ ติดตั้ง trigger เตือนใบลาค้างไม่สำเร็จ: ' + triggerErr);
  }
  try {
    if (ensureLogCleanupTrigger_()) status.push('ติดตั้ง trigger บำรุงรักษารายวันเวลา 03:00 น.');
  } catch (triggerErr) {
    status.push('⚠ ติดตั้ง trigger บำรุงรักษารายวันไม่สำเร็จ: ' + triggerErr);
  }

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

/** สร้างรหัสจับคู่กลุ่มแบบใช้ครั้งเดียว อายุ 10 นาที; ไม่บันทึกรหัสลง Logs */
function startLineGroupPairing() {
  const code = Utilities.getUuid().replace(/-/g, '').substring(0, 8).toUpperCase();
  const props = PropertiesService.getScriptProperties();
  props.setProperty('LINE_GROUP_PAIRING_CODE', code);
  props.setProperty('LINE_GROUP_PAIRING_EXPIRES_AT', String(Date.now() + 10 * 60 * 1000));
  const message = 'ส่งข้อความต่อไปนี้ในกลุ่ม LINE เป้าหมายภายใน 10 นาที:\n\nเชื่อมกลุ่ม ' + code +
    '\n\nระบบจะใช้รหัสได้ครั้งเดียวและไม่เปลี่ยนกลุ่มจากข้อความอื่น';
  try {
    SpreadsheetApp.getUi().alert('จับคู่กลุ่ม LINE', message, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    console.log('สร้างรหัสจับคู่กลุ่ม LINE แล้ว กรุณาเปิดจากเมนูใน Google Sheet เพื่อดูรหัส');
  }
}

/** เปลี่ยนเฉพาะหัวคอลัมน์เดิมให้ระบุว่าเป็นปีงบประมาณ ข้อมูลและเลขปีเดิมไม่ถูกแตะ */
function migrateFiscalYearHeaders_(ss, status) {
  [
    ['LeaveBalances', 'ปี (พ.ศ.)', BALANCE_SHEET_COLUMNS[0],
      'สมุดรายการปรับยอดวันลาแยกตามปีงบประมาณ — ยอดที่แสดงทุกจุด = ใบลาจริง + รายการในนี้'],
    ['QuotaProfiles', 'ปี (พ.ศ. เว้นว่าง = ทุกปี)', QUOTA_PROFILE_COLUMNS[0], QUOTA_PROFILE_SHEET_TITLE],
  ].forEach(function (item) {
    const sheet = ss.getSheetByName(item[0]);
    if (!sheet || String(sheet.getRange(2, 1).getDisplayValue()).trim() !== item[1]) return;
    sheet.getRange(1, 1).setValue(item[3]);
    sheet.getRange(2, 1).setValue(item[2]);
    status.push('ปรับหัวคอลัมน์ปีเป็นปีงบประมาณ: ' + item[0]);
  });
}

/** รายงานใบเดิมที่ต้องให้ HR แยก ไม่แก้หรือลบข้อมูลใน Notion อัตโนมัติ */
function auditFiscalYearCrossingLeaves() {
  try {
    const settings = getSettings_();
    const dbId = String(settings.leave_database_id || '').trim();
    if (!dbId || dbId === 'your_leave_database_id') {
      throw new Error('ยังไม่ได้ตั้งค่า leave_database_id ในชีต Settings');
    }
    const leaves = getFiscalYearCrossingLeaves_(new Date(), dbId);
    const text = leaves.length
      ? 'พบใบลาที่ยังมีผลและคร่อม 30 กันยายน/1 ตุลาคม ' + leaves.length + ' ใบ:\n\n' +
        leaves.slice(0, 20).map(leave =>
          '• ' + (leave.fullName || leave.pageId) + ' — ' + leave.start.substring(0, 10) +
          ' ถึง ' + String(leave.end || leave.start).substring(0, 10)).join('\n') +
        (leaves.length > 20 ? '\n…และอีก ' + (leaves.length - 20) + ' ใบ' : '') +
        '\n\nให้ HR แยกเป็นใบสิ้นสุด 30 กันยายน และใบเริ่ม 1 ตุลาคม ก่อนใช้ยอดหรือร่างยอดยกมา'
      : 'ไม่พบใบลาที่ยังมีผลซึ่งคร่อม 30 กันยายน/1 ตุลาคม';
    SpreadsheetApp.getUi().alert('ตรวจใบลาคร่อมปีงบประมาณ', text, SpreadsheetApp.getUi().ButtonSet.OK);
    return { count: leaves.length, leaves: leaves };
  } catch (err) {
    logResult_(new Date(), 'error (manual test)', 'ตรวจใบลาคร่อมปีงบประมาณไม่สำเร็จ: ' + err);
    try { SpreadsheetApp.getUi().alert('ตรวจใบลาคร่อมปีงบประมาณไม่สำเร็จ: ' + err); } catch (e2) { console.error(String(err)); }
    throw err;
  }
}

// เติมแถวสิทธิ์จาก QUOTA_PROFILE_SEED ลงชีต QuotaProfiles — เฉพาะคู่ (ประเภทบุคลากร+ประเภทการลา)
// ที่ยังไม่มีแถวใดๆ แถวที่ผู้ดูแลเพิ่ม/แก้เองไว้แล้วจะไม่ถูกแตะ (idempotent — รันซ้ำกี่ครั้งก็ปลอดภัย)
// สร้างชีตให้เองถ้ายังไม่มี จึงรันจากเมนูเฉพาะตัวได้แม้ยังไม่เคยรัน setupSheet
// คืน {added, kept, blocked?} — blocked ตอนชีตเป็นโครงคอลัมน์รุ่นเก่า (เขียนไม่ได้ ไม่เสียข้อมูล)
function seedLeaveQuotaDefaults_() {
  const ensureStatus = [];
  migrateFiscalYearHeaders_(SpreadsheetApp.getActive(), ensureStatus);
  const usable = ensureSheet_(SpreadsheetApp.getActive(), 'QuotaProfiles',
    QUOTA_PROFILE_SHEET_TITLE, QUOTA_PROFILE_COLUMNS, ensureStatus);
  if (!usable) {
    return { added: 0, kept: 0, blocked: 'ชีต QuotaProfiles ใช้หัวตารางโครงเดิม — ย้ายข้อมูลตาม SETUP.md ก่อนแล้วรันใหม่' };
  }
  SpreadsheetApp.getActive().getSheetByName('QuotaProfiles').getRange(2, 4).setValue(QUOTA_PROFILE_COLUMNS[3]);

  const existing = new Set(readQuotaProfiles_().map(p => p.employmentType + '|' + p.leaveType));
  const rows = QUOTA_PROFILE_SEED.filter(r => !existing.has(String(r[1]).trim() + '|' + String(r[2]).trim()));
  if (rows.length) {
    const sheet = SpreadsheetApp.getActive().getSheetByName('QuotaProfiles');
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, QUOTA_PROFILE_COLUMNS.length).setValues(rows);
  }
  const migrated = migrateKnownQuotaDefaults_();
  return { added: rows.length, kept: QUOTA_PROFILE_SEED.length - rows.length, migrated: migrated };
}

/** migration คำสะกด: แก้เฉพาะค่า exact ใน LEGACY_LEAVE_TYPE_NAMES และไม่ทับแถวโควตาที่มีคำสะกดใหม่อยู่แล้ว */
function migrateLeaveTypeSpelling_() {
  let updated = 0;
  let conflicts = 0;
  const settings = getSettings_();
  const rawOptions = String(settings.leave_type_options || '');
  const rawOptionList = rawOptions.split(',').map(s => s.trim()).filter(Boolean);
  if (rawOptionList.some(name => normalizeLeaveTypeName_(name) !== name)) {
    const normalized = Array.from(new Set(rawOptions.split(',').map(normalizeLeaveTypeName_).filter(Boolean)));
    setSettingValue_('leave_type_options', normalized.join(','));
    updated++;
  }

  const quotaSheet = SpreadsheetApp.getActive().getSheetByName('QuotaProfiles');
  if (quotaSheet && quotaSheet.getLastRow() >= 3) {
    const values = quotaSheet.getRange(3, 1, quotaSheet.getLastRow() - 2, 3).getDisplayValues();
    const canonicalKeys = new Set(values.filter(row => {
      const name = String(row[2]).trim();
      return name && normalizeLeaveTypeName_(name) === name;
    }).map(row => [String(row[0]).trim(), String(row[1]).trim(), String(row[2]).trim()].join('|')));
    values.forEach((row, index) => {
      const oldName = String(row[2]).trim();
      const newName = normalizeLeaveTypeName_(oldName);
      if (!oldName || oldName === newName) return;
      const key = [String(row[0]).trim(), String(row[1]).trim(), newName].join('|');
      if (canonicalKeys.has(key)) {
        conflicts++;
        return;
      }
      quotaSheet.getRange(index + 3, 3).setValue(newName);
      canonicalKeys.add(key);
      updated++;
    });
  }

  const balanceSheet = SpreadsheetApp.getActive().getSheetByName('LeaveBalances');
  if (balanceSheet && balanceSheet.getLastRow() >= 3) {
    const values = balanceSheet.getRange(3, 3, balanceSheet.getLastRow() - 2, 1).getDisplayValues();
    values.forEach((row, index) => {
      const oldName = String(row[0]).trim();
      const newName = normalizeLeaveTypeName_(oldName);
      if (oldName && oldName !== newName) {
        balanceSheet.getRange(index + 3, 3).setValue(newName);
        updated++;
      }
    });
  }
  return { updated: updated, conflicts: conflicts };
}

/** แก้เฉพาะค่า seed เก่าที่พิสูจน์ได้ว่าไม่เคยถูกผู้ดูแลปรับเอง */
function migrateKnownQuotaDefaults_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName('QuotaProfiles');
  if (!sheet || sheet.getLastRow() < 3) return 0;
  const legacyNotes = {
    'พนักงานราชการ': 'ประกาศไม่ระบุให้ได้รับสิทธิแบบข้าราชการ — ปรับได้ตามนโยบายหน่วยงาน',
    'ลูกจ้างประจำ': 'ระเบียบ ก.คลัง ไม่ระบุสิทธินี้ — ปรับได้ตามนโยบายหน่วยงาน',
    'ลูกจ้างชั่วคราวรายเดือน': 'ไม่มีสิทธิตามระเบียบ',
    'ลูกจ้างรายวัน': 'ไม่มีสิทธิตามระเบียบ',
  };
  const values = sheet.getRange(3, 1, sheet.getLastRow() - 2, QUOTA_PROFILE_COLUMNS.length).getDisplayValues();
  let migrated = 0;
  values.forEach((row, index) => {
    const employmentType = String(row[1]).trim();
    const target = QUOTA_PROFILE_SEED.find(seed =>
      seed[1] === employmentType && seed[2] === 'ลาช่วยเหลือภรรยาคลอดบุตร');
    if (target && String(row[2]).trim() === 'ลาช่วยเหลือภรรยาคลอดบุตร' &&
        String(row[3]).trim() === '0' && String(row[4]).trim() === legacyNotes[employmentType]) {
      sheet.getRange(index + 3, 4, 1, 2).setValues([[target[3], target[4]]]);
      migrated++;
    }
  });
  return migrated;
}

// จุดรันจากเมนู — เติมสิทธิ์อ้างอิงระเบียบลงชีต QuotaProfiles แล้วรายงานผล
function seedLeaveQuotaDefaults() {
  const result = seedLeaveQuotaDefaults_();
  const msg = result.blocked
    ? '⚠ ' + result.blocked
    : 'เติมสิทธิ์วันลาตามระเบียบแล้ว ' + result.added + ' รายการ' +
      (result.kept ? '\nข้าม ' + result.kept + ' รายการที่มีอยู่แล้ว (ไม่แตะของเดิม)' : '') +
      (result.migrated ? '\nปรับค่า seed เก่าที่ไม่เคยแก้เอง ' + result.migrated + ' รายการ' : '') +
      '\n\nค่าเหล่านี้เป็นข้อมูลตั้งต้น ไม่ใช่คำรับรองสิทธิทางกฎหมาย\n' +
      'HR ต้องตรวจทาน/ปรับที่ชีต QuotaProfiles แล้วใส่วันที่ใน Settings: leave_policy_reviewed_at';
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (err) {
    console.log(msg); // รันจาก editor ไม่มี UI → log แทน
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
    findings.push(['warn', 'ยังไม่มี line_group_id — ใช้เมนู "สร้างรหัสจับคู่กลุ่ม LINE" แล้วส่งข้อความจับคู่ในกลุ่มเป้าหมาย']);
  }
  const policyFinding = leavePolicyReviewFinding_(settings.leave_policy_reviewed_at, bangkokTodayStr_());
  if (policyFinding) findings.push(['warn', policyFinding]);

  // Secret ใน Script Properties
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('LINE_CHANNEL_ACCESS_TOKEN')) {
    findings.push(['warn', 'ยังไม่ตั้ง LINE_CHANNEL_ACCESS_TOKEN ใน Script Properties — ส่งข้อความเข้า LINE ไม่ได้']);
  }
  if (!props.getProperty('NOTION_TOKEN')) {
    findings.push(['warn', 'ยังไม่ตั้ง NOTION_TOKEN ใน Script Properties — อ่าน/เขียน Notion ไม่ได้']);
  }
  if (!props.getProperty('LOGIN_CHANNEL_ID')) {
    findings.push(['warn', 'ยังไม่ตั้ง LOGIN_CHANNEL_ID — ระบบปฏิเสธการเข้าสู่ระบบ LIFF จนกว่าจะตั้งค่าให้ตรงกับ LINE Login channel']);
  }
  if (allowLegacyDirectRequests_()) {
    findings.push(['info', 'Direct mode สำหรับ browser เปิดอยู่ตามความเสี่ยงที่เจ้าของระบบยอมรับ']);
  }
  if (allowUnsignedLineWebhook_()) {
    findings.push(['warn', 'ALLOW_UNSIGNED_LINE_WEBHOOK=TRUE — LINE webhook ตรงตรวจลายเซ็นไม่ได้ ควรใช้ gateway แล้วลบค่านี้']);
  } else if (!props.getProperty('GATEWAY_SHARED_SECRET')) {
    findings.push(['warn', 'LINE webhook ต้องผ่าน gateway แต่ยังไม่ตั้ง GATEWAY_SHARED_SECRET ใน Script Properties']);
  }

  // ชีต Approvers
  let config = [];
  try { config = readApproversConfig_(); } catch (err) { /* ยังไม่มีชีต/ยังไม่มีแถว */ }
  if (!config.length) {
    findings.push(['warn', 'ชีต Approvers ยังไม่มีแถว — ระบบหาเส้นทางผู้อนุมัติไม่ได้']);
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
  const dupEmployeeIds = findDuplicates_(roster.map(s => s.employeeId).filter(Boolean));
  if (dupEmployeeIds.length) findings.push(['warn', 'รหัสบุคลากรซ้ำกันในชีต Staff: ' + dupEmployeeIds.join(', ')]);
  const incompleteRoster = roster.filter(s => !isCompleteStaffRosterEntry_(s)).length;
  if (incompleteRoster) findings.push(['warn', 'Staff มีข้อมูลทำเนียบไม่ครบ ' + incompleteRoster +
    ' คน — ตรวจคำนำหน้า ชื่อ สกุล กลุ่มงาน ตำแหน่ง ประเภทบุคลากร และรหัสบุคลากร']);
  if (roster.length) {
    const registered = roster.filter(isApprovedStaffBinding_).length;
    const pending = roster.filter(s => s.bindingStatus === STAFF_BINDING_STATUS.pending).length;
    findings.push(['info', 'ทำเนียบ Staff: อนุมัติการผูกแล้ว ' + registered + '/' + roster.length +
      ' คน' + (pending ? ' · รอตรวจสอบ ' + pending + ' คน' : '')]);
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
  const notificationEnabled = String(settings.enabled || '').toUpperCase() === 'TRUE';
  if (notificationEnabled && !hasTrigger) {
    findings.push(['warn', 'ยังไม่ตั้งเวลาส่งอัตโนมัติ — กดเมนู "ติดตั้ง/อัปเดตเวลาส่งอัตโนมัติ"']);
  } else if (!notificationEnabled && hasTrigger) {
    findings.push(['info', 'การแจ้งเตือนปิดอยู่แต่ยังมี trigger เดิม — กดเมนูติดตั้ง/อัปเดตหนึ่งครั้งเพื่อลบ trigger']);
  }

  const hasDailyMaintenance = ScriptApp.getProjectTriggers().some(
    t => t.getHandlerFunction() === LOG_CLEANUP_TRIGGER_HANDLER);
  if (!hasDailyMaintenance) {
    findings.push(['warn', 'ยังไม่มี trigger บำรุงรักษารายวัน — งานที่พ้นวันจะไม่เปลี่ยนเป็นเสร็จสิ้นอัตโนมัติ กรุณากดเมนู "ติดตั้ง/อัปเดตเวลาส่งอัตโนมัติ"']);
  }

  // สถานะสวิตช์ระบบลา
  if (!isLeaveSystemEnabled_(settings)) {
    findings.push(['warn', 'ระบบลาถูกปิดอยู่ (leave_system_enabled = FALSE) — กดเมนู "เปิด/ปิดระบบลา" เพื่อเปิดกลับ']);
  }
  if (isLeaveSystemEnabled_(settings) && !isLeaveApprovalEnabled_(settings)) {
    findings.push(['info', 'โหมดแจ้งลาอัตโนมัติ: การอนุมัติถูกปิดอยู่ — ยื่นแล้วบันทึกเป็นอนุมัติทันที แจ้งเข้ากลุ่มหลัก (ไม่ใช้ผู้อนุมัติในชีต Approvers)']);
  }
  const hasPendingLeaveReminder = ScriptApp.getProjectTriggers().some(
    t => t.getHandlerFunction() === LEAVE_PENDING_REMINDER_HANDLER);
  if (isLeaveSystemEnabled_(settings) && isLeaveApprovalEnabled_(settings) && !hasPendingLeaveReminder) {
    findings.push(['warn', 'ยังไม่มี trigger เตือนใบลาค้าง — กดเมนู "ติดตั้ง/อัปเดตเวลาส่งอัตโนมัติ"']);
  }

  return findings;
}

function leavePolicyReviewFinding_(value, todayStr) {
  const reviewDate = String(value || '').trim();
  if (!reviewDate) {
    return 'HR ยังไม่ได้ยืนยันนโยบายวันลา — ตรวจ QuotaProfiles กับประกาศ/สัญญาจ้างล่าสุด แล้วใส่ leave_policy_reviewed_at (YYYY-MM-DD)';
  }
  if (!isValidDateStr_(reviewDate)) return 'leave_policy_reviewed_at ต้องเป็นวันที่จริงรูปแบบ YYYY-MM-DD';
  const age = daysBetweenDateStrs_(reviewDate, todayStr);
  if (age < 0) return 'leave_policy_reviewed_at ต้องไม่เป็นวันที่ในอนาคต';
  if (age > 366) return 'นโยบายวันลาไม่ได้รับการทบทวนเกิน 1 ปี — ให้ HR ตรวจประกาศ/สัญญาจ้างล่าสุดอีกครั้ง';
  return '';
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
    return false; // โครงคอลัมน์ไม่ตรงมาตรฐาน — ผู้เรียกต้องไม่เขียนข้อมูลลงชีตนี้
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
  return true;
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
    SpreadsheetApp.getUi().alert('ส่งการ์ดตัวอย่างแล้ว โปรดตรวจสอบในกลุ่ม LINE (ปุ่มบนการ์ดตัวอย่างกดแล้วจะไม่มีผลกับข้อมูลจริง)');
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
    SpreadsheetApp.getUi().alert('ส่งสรุปรายเดือนแล้ว โปรดตรวจสอบในกลุ่ม LINE');
  } catch (err) {
    logResult_(new Date(), 'error (manual test)', String(err));
    SpreadsheetApp.getUi().alert('ทดสอบสรุปรายเดือนไม่สำเร็จ: ' + err);
  }
}

// ร่างยอด "ลาพักร้อนยกมา" ของปีถัดไปให้ผู้ดูแลอ่าน — ตั้งใจไม่บันทึกอัตโนมัติ
// (การตัดสินใจสะสมตามระเบียบจริงของแต่ละคนเป็นของผู้ดูแล ระบบช่วยคำนวณตัวเลขตั้งต้นเท่านั้น)
// ใช้ query ใบลาทั้งปีครั้งเดียว (getActiveLeavesForYear_) — ไม่วนรายคน กันกระหน่ำ rate limit ของ Notion
function draftCarryOverNextYear() {
  try {
    const settings = getSettings_();
    const now = new Date();
    const year = fiscalYearCEForDate_(now);
    const roster = readStaffRoster_();
    const balances = readLeaveBalances_();
    const profiles = readQuotaProfiles_();
    const crossingLeaves = getFiscalYearCrossingLeaves_(now, settings.leave_database_id);
    if (crossingLeaves.length) {
      throw new Error('พบใบลาคร่อม 30 กันยายน/1 ตุลาคม ' + crossingLeaves.length +
        ' ใบ กรุณารันเมนู "ตรวจใบลาคร่อมปีงบประมาณ" และให้ HR แยกใบก่อน');
    }
    const leaves = getActiveLeavesForYear_(now, settings.leave_database_id, year);

    const lines = [];
    roster.forEach(staff => {
      const myLeaves = leaves.filter(leave => leave.submitterUserId === staff.lineUserId);
      const summary = buildUsageSummaryWithBalances_(usageFromLeaves_(myLeaves), balances, year,
        baseQuotaMap_(profiles, staff.employmentType, year), staffKey_(staff));
      const cell = summary && summary['ลาพักร้อน'];
      if (!cell || cell.quota == null) return;
      const remaining = Math.max(0, cell.quota - cell.used);
      // ระเบียบให้สะสมได้ไม่เกินสิทธิ์รายปี และรวมทุกปีไม่เกิน 45 วันทำการ — ระบบจำกัดที่รายปีไว้ก่อน
      // ส่วนกรณีสะสมหลายปีให้ผู้ดูแลปรับตัวเลขขึ้นเองตามสถานะจริงของแต่ละคน (ใช้โควตาตามประเภทบุคลากรของคนนั้น)
      const baseQuota = Math.max(0, cell.quota - (cell.carryIn || 0));
      const carry = Math.min(remaining, baseQuota);
      if (carry > 0) {
        lines.push('• ' + staffKey_(staff) + ' — ยกมา ' + workDaysLabel_(carry) +
          ' (เหลือสิ้นปี ' + workDaysLabel_(remaining) + ', ใช้ไป ' + workDaysLabel_(cell.used) + ')');
      }
    });

    const text = lines.length
      ? 'ร่างรายการ "ยกมา" ลาพักร้อน ปีงบประมาณ ' + (year + 1 + 543) + ' (ยังไม่ได้บันทึก):\n\n' + lines.join('\n') +
        '\n\nบันทึกจริงที่: หน้าเว็บตั้งค่า > แท็บ "ยอดวันลา" หรือเพิ่มแถวในชีต LeaveBalances เอง' +
        '\nหมายเหตุ: ระบบจำกัดยอดยกมาไว้ไม่เกินสิทธิ์รายปี (' + LEAVE_QUOTAS['ลาพักร้อน'] + ' วันทำการ) — กรณีสะสมหลายปี (รวมไม่เกิน 45) ปรับตัวเลขเองตามระเบียบจริง'
      : 'ไม่มีใครเหลือวันลาพักร้อนให้ยกมาในปีงบประมาณ ' + (year + 543) +
        (String(settings.leave_database_id || '').trim() === 'your_leave_database_id' ? ' (หรือยังไม่ได้ตั้งค่า leave_database_id)' : '');
    SpreadsheetApp.getUi().alert(text);
    logResult_(now, 'success (manual test)', 'ร่างยอดยกมาปีงบประมาณ ' + (year + 1 + 543) + ': ' + lines.length + ' รายชื่อ');
  } catch (err) {
    logResult_(new Date(), 'error (manual test)', 'คำนวณร่างยกมาไม่สำเร็จ: ' + err);
    try { SpreadsheetApp.getUi().alert('คำนวณร่างยกมาไม่สำเร็จ: ' + err); } catch (e2) { console.error(String(err)); }
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
      : buildLineMessage_(now, items, leaves, settings.message_format, advance,
          undefined, buildAssigneeLeaveConflicts_(items, leaves));
    sendLineMessage_(settings.line_group_id, messageObj);
    logResult_(now, 'success (manual test)', messagePreview_(messageObj).substring(0, 300));
    SpreadsheetApp.getUi().alert('ส่งข้อความทดสอบแล้ว โปรดตรวจสอบในกลุ่ม LINE');
  } catch (err) {
    logResult_(new Date(), 'error (manual test)', String(err));
    SpreadsheetApp.getUi().alert('ทดสอบส่งไม่สำเร็จ: ' + err);
  }
}

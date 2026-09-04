/**
 * ระบบแจ้งเตือนงานเข้ากลุ่ม LINE รายวัน — ดึงข้อมูลจาก Notion database "ปฏิทินการปฏิบัติงาน"
 * - ใช้ one-time trigger นัดเวลาส่งครั้งถัดไปตาม notify_time โดยตรง
 *   เมื่อทำงานเสร็จจะสร้าง trigger สำหรับวันถัดไป และ retry เฉพาะเมื่อส่งล้มเหลว
 * - อ่านค่าตั้งค่าและวันหยุดจากชีต "Settings" / "Holidays" ทุกครั้งที่รัน
 *   หน้า admin จะนัด trigger ใหม่อัตโนมัติ; ถ้าแก้ notify_time ในชีตโดยตรงให้กดเมนูติดตั้ง/อัปเดตเวลา
 * - ถ้าวันนั้นไม่มีงานเลย จะไม่ส่งข้อความเข้ากลุ่มใดๆ ทั้งสิ้น (เงียบ)
 *   แต่ยังบันทึกไว้ในชีต Logs ว่าเช็คแล้วและไม่มีงาน เพื่อยืนยันว่าระบบยังทำงานปกติ
 *   (ระบบลางาน: เงียบเฉพาะเมื่อไม่มีงาน "และ" ไม่มีผู้ลาที่อนุมัติแล้วคร่อมวันนั้น — ดู Leave.gs)
 * - ถ้าตั้งค่าที่จำเป็น (notify_time/notion_database_id/line_group_id) ไม่ครบ ก็จะ log ไว้วันละครั้ง
 *   เช่นกัน (ไม่ return เงียบแบบไม่มีร่องรอย) ยกเว้นตอนปิดใช้งานไว้ตั้งใจ (enabled=FALSE) ที่จะไม่ log อะไรเลย
 * - รูปแบบข้อความเลือกได้จากชีต Settings คีย์ message_format: 'text' (ข้อความธรรมดา ค่าเริ่มต้น)
 *   หรือ 'flex' (การ์ด Flex Message) สลับได้ทุกเมื่อผ่านชีตโดยไม่ต้องแก้โค้ด
 * - การ์ด Flex: พื้นหลัง header เปลี่ยนสีตามวันในสัปดาห์ตามธรรมเนียมสีประจำวันของไทย (ดู DAY_THEMES)
 *   คู่สีตัวหนังสือ/eyebrow จับคู่ไว้ให้ contrast อ่านออกเสมอในแต่ละวันแล้ว ไม่ต้องแก้เพิ่ม
 * - สคริปต์นี้ต้องผูกกับสเปรดชีตที่มีชีต Settings / Holidays / Logs
 *   (เปิดจาก Extensions > Apps Script ภายในชีตนั้นโดยตรง ไม่ต้องตั้ง Spreadsheet ID เอง)
 * - Secret (LINE token, Notion token) เก็บใน Script Properties เท่านั้น ห้ามใส่ในชีต
 *
 * โครงสร้าง Notion database ที่โค้ดนี้อ้างอิงตรงๆ (เปลี่ยนชื่อ property ในตัวแปร PROPS ด้านล่างได้
 * ถ้าเปลี่ยนชื่อ property ใน Notion แต่ห้ามเปลี่ยนแค่ฝั่งเดียว ไม่งั้นดึงข้อมูลไม่ตรง):
 *   งาน (title) / วันที่ - เวลา (date) / สถานะงาน (status) / ผู้รับผิดชอบ (multi_select) / สถานที่ (rich_text)
 *   รายละเอียด (rich_text) / หมายเหตุ (rich_text)
 */

// สีพื้นหลัง header ของการ์ด Flex ตามวันในสัปดาห์ (ธรรมเนียมสีประจำวันของไทย)
// index ตรงกับ Date.getUTCDay(): 0=อาทิตย์ 1=จันทร์ 2=อังคาร 3=พุธ 4=พฤหัสบดี 5=ศุกร์ 6=เสาร์
// ทุกคู่สี (bg/text และ bg/eyebrow) คำนวณ WCAG contrast ratio จริงแล้วผ่านเกณฑ์ AA (>= 4.5:1) ทั้งหมด
// ไม่ได้กะด้วยสายตา — จันทร์/อังคาร/ศุกร์ พื้นสว่างเลยใช้ตัวหนังสือเข้ม ส่วนพฤหัสบดีต้องปรับให้เข้มขึ้นจากส้มเดิม
// เพราะส้มโทนที่เลือกไว้แต่แรกไม่เข้มพอจะให้ตัวหนังสือขาวอ่านออกตามเกณฑ์เลยแม้แต่สีขาวล้วน
const DAY_THEMES = [
  { bg: '#B0413E', text: '#FFFFFF', eyebrow: '#F6DFDE' }, // อาทิตย์ - แดง (date 5.72:1, eyebrow 4.50:1)
  { bg: '#E8B923', text: '#4A3A05', eyebrow: '#604B0C' }, // จันทร์ - เหลือง (date 6.00:1, eyebrow 4.54:1)
  { bg: '#E8A0B4', text: '#5C1F2E', eyebrow: '#683744' }, // อังคาร - ชมพู (date 5.99:1, eyebrow 4.56:1)
  { bg: '#0F6E56', text: '#FFFFFF', eyebrow: '#BFE4D7' }, // พุธ - เขียว (date 6.20:1, eyebrow 4.52:1)
  { bg: '#974F25', text: '#FFFFFF', eyebrow: '#F2DAC8' }, // พฤหัสบดี - ส้ม เข้มขึ้นจากเดิม (date 6.07:1, eyebrow 4.52:1)
  { bg: '#7EC1E0', text: '#0D3A52', eyebrow: '#214E66' }, // ศุกร์ - ฟ้า (date 6.07:1, eyebrow 4.51:1)
  { bg: '#6B4C7A', text: '#FFFFFF', eyebrow: '#DCC8E0' }, // เสาร์ - ม่วง (date 7.14:1, eyebrow 4.55:1)
];

// สีคงที่สำหรับแยกวันนี้ออกจากข้อมูลล่วงหน้า โดยไม่พึ่งสี header ประจำวัน
// contrast ของ text/bg = 5.56:1 และ 6.27:1 ตามลำดับ ผ่าน WCAG AA สำหรับข้อความปกติ
const TODAY_SECTION_THEME = { bg: '#EAF5F1', text: '#0F6E56' };
const ADVANCE_SECTION_THEME = { bg: '#EAF3F8', text: '#1F5F7A' };

const THAI_WEEKDAY_NAMES = [
  'อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์',
];
const THAI_MONTH_NAMES = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

// ---------- อ่านค่าตั้งค่า ----------

const FAIL_LIMIT = 3; // ลองส่งไม่เกินกี่ครั้ง/วัน ก่อนหยุดลองและรอวันถัดไป (หรือกด "ทดสอบส่งตอนนี้" เองหลังแก้ปัญหา)

function notificationConfigurationReady_(settings) {
  const s = settings || {};
  const notionId = String(s.notion_database_id || '').trim().replace(/-/g, '');
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(normalizeScheduleTime_(s.notify_time)) &&
    /^[0-9a-f]{32}$/i.test(notionId) &&
    /^C[0-9a-f]{32}$/i.test(String(s.line_group_id || '').trim());
}

// วันเสาร์-อาทิตย์ของวันที่กำหนด อิงเวลา Asia/Bangkok เสมอ ไม่พึ่ง timezone ของเซิร์ฟเวอร์ที่รันสคริปต์
// (แปลงเป็นสตริง yyyy-MM-dd ในโซนกรุงเทพฯ ก่อน แล้วอ่านซ้ำแบบ UTC midnight เพื่อไม่ให้ผูกกับ timezone ของเครื่องที่รัน)
function isWeekend_(date) {
  const dateStr = Utilities.formatDate(date, 'Asia/Bangkok', 'yyyy-MM-dd');
  const dow = new Date(dateStr + 'T00:00:00Z').getUTCDay(); // 0=อาทิตย์ ... 6=เสาร์
  return dow === 0 || dow === 6;
}

// สีธีมของวัน (ใช้กับ header การ์ด Flex) — เทคนิคหา day-of-week เดียวกับ isWeekend_ เพื่อความสอดคล้อง
function dayThemeFor_(date) {
  const dateStr = Utilities.formatDate(date, 'Asia/Bangkok', 'yyyy-MM-dd');
  const dow = new Date(dateStr + 'T00:00:00Z').getUTCDay();
  return DAY_THEMES[dow];
}

function thaiDateLabel_(date) {
  const dateStr = Utilities.formatDate(date, 'Asia/Bangkok', 'yyyy-MM-dd');
  const parts = dateStr.split('-').map(Number);
  const dow = new Date(dateStr + 'T00:00:00Z').getUTCDay();
  return THAI_WEEKDAY_NAMES[dow] + ' ' + parts[2] + ' ' +
    THAI_MONTH_NAMES[parts[1] - 1] + ' ' + (parts[0] + 543);
}

// ---------- ฟังก์ชันหลัก: ทำงานเมื่อถึงเวลาที่ one-time trigger นัดไว้ ----------

function checkAndSendNotification() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    scheduleRetryNotification_(new Date());
    return;
  }

  let shouldRetryToday = false;

  try {
    const settings = getSettings_();
    if (String(settings.enabled).toUpperCase() !== 'TRUE') return; // ปิดใช้งานไว้ตั้งใจ ไม่ต้อง log

    const now = new Date();
    const todayStr = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd');
    const props = PropertiesService.getScriptProperties();

    cleanupOldFailCounts_(props, todayStr);

    if (!notificationConfigurationReady_(settings)) {
      // ตั้งค่าไม่ครบ — log วันละครั้ง ให้เห็นใน Logs/หน้าเว็บว่าทำไมระบบไม่ส่ง
      // return เงียบแบบไม่มีร่องรอยเลยถ้าลืมกรอกอะไรสักฟิลด์
      if (props.getProperty('LAST_CHECKED_DATE') !== todayStr) {
        logResult_(now, 'skip', 'ตั้งค่าไม่ครบหรือรูปแบบไม่ถูกต้อง (notify_time/notion_database_id/line_group_id) — เปิดชีต Settings หรือหน้าเว็บตั้งค่าเพื่อตรวจสอบ');
        props.setProperty('LAST_CHECKED_DATE', todayStr);
      }
      return;
    }

    // ทำไปแล้ววันนี้หรือยัง (ไม่ว่าผลจะเป็นส่งข้อความหรือข้ามแบบเงียบๆ ก็ตาม)
    // กัน trigger ซ้ำหรือการเรียกซ้ำโดยไม่ตั้งใจไม่ให้ยิงข้อความซ้ำในวันเดียวกัน
    if (props.getProperty('LAST_CHECKED_DATE') === todayStr) return;

    const items = getNotionItemsForDay_(now, settings.notion_database_id);
    // ส่วนผู้ลาวันนี้ — ถ้ายังไม่ได้ตั้งค่าระบบลา จะคืน [] พร้อม log เอง ไม่กระทบการส่งเช้าหลัก
    const leaves = getApprovedLeavesForDay_(now, settings.leave_database_id);
    // ส่วนล่วงหน้า (พรุ่งนี้ หรือ N วันถัดไปตาม advance_notice_days)
    const advance = collectAdvanceNotice_(now, settings);
    // สรุปวันลารายเดือน: การรันเช้าครั้งแรกของแต่ละเดือน
    const monthly = maybeCollectMonthlyLeaveSummary_(now, settings, props);

    const isDayOff = isWeekend_(now) || isHoliday_(now);
    
    // ถ้าเป็นวันหยุด จะแจ้งเตือนเฉพาะเมื่อมีรายการของวันนี้ (งานหรือวันเกิด) หรือมีสรุปรายเดือนต้องส่ง
    // หากไม่มี จะไม่ส่งแจ้งเตือน (แม้จะมีล่วงหน้า advance ก็จะถูกข้ามไปส่งในวันทำการถัดไป)
    if (isDayOff && items.length === 0 && !(monthly && monthly.summary)) {
      const dayType = isWeekend_(now) ? 'วันเสาร์-อาทิตย์' : 'วันหยุดราชการ';
      logResult_(now, 'skip', dayType + ' (ไม่มีงาน/วันเกิด/สรุปเดือนสำหรับวันนี้)');
      if (monthly) props.setProperty('last_monthly_leave_summary', monthly.currentMonth);
      props.setProperty('LAST_CHECKED_DATE', todayStr);
      return;
    }

    if (items.length === 0 && leaves.length === 0 && !advance && !(monthly && monthly.summary)) {
      // ไม่มีงานและไม่มีผู้ลา ทั้งวันนี้และวันล่วงหน้า -> ไม่ส่งข้อความเข้ากลุ่มเลย แต่ยังบันทึก log ไว้เป็นหลักฐานว่าเช็คแล้วจริง
      logResult_(now, 'skip', 'ไม่มีงาน/ผู้ลาในระบบทั้งวันนี้และวันล่วงหน้า — ไม่ส่งข้อความ');
      // เดือนก่อนไม่มีใครลาเลย → ไม่มีสรุปให้ส่ง แต่ถือว่าจัดการเดือนนี้แล้ว กัน query ซ้ำทุกเช้า
      if (monthly) props.setProperty('last_monthly_leave_summary', monthly.currentMonth);
      props.setProperty('LAST_CHECKED_DATE', todayStr);
      return;
    }

    // งานวันนี้ที่ผู้รับผิดชอบกำลังลา — เตือนให้กลุ่มรู้ไว้จัดคนไปแทน (รวมข้อความเดิม โควตาเพิ่ม 0)
    const conflicts = buildAssigneeLeaveConflicts_(items, leaves);
    const messageObj = buildLineMessage_(now, items, leaves, settings.message_format, advance,
      monthly && monthly.summary, conflicts);
    sendLineMessage_(settings.line_group_id, messageObj);

    props.setProperty('LAST_CHECKED_DATE', todayStr);
    if (monthly) props.setProperty('last_monthly_leave_summary', monthly.currentMonth);
    logResult_(now, 'success', messagePreview_(messageObj).substring(0, 300));
  } catch (err) {
    // นับจำนวนครั้งที่ล้มเหลวของวันนี้ (คีย์แยกตามวันที่ ลบของเก่าทิ้งทุกรอบผ่าน cleanupOldFailCounts_ ด้านบน)
    const props = PropertiesService.getScriptProperties();
    const todayStr = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
    const failKey = 'FAIL_COUNT_' + todayStr;
    const failCount = Number(props.getProperty(failKey) || '0') + 1;
    props.setProperty(failKey, String(failCount));
    shouldRetryToday = failCount < FAIL_LIMIT;

    if (failCount >= FAIL_LIMIT) {
      // ลองครบจำนวนที่กำหนดแล้วยังไม่สำเร็จ เลิกลองสำหรับวันนี้
      // แก้ปัญหาแล้วอยากส่งวันนี้เลย ใช้เมนู "ทดสอบส่งตอนนี้" ได้ตามปกติ
      props.setProperty('LAST_CHECKED_DATE', todayStr);
      logResult_(new Date(), 'error', `ลองครบ ${failCount} ครั้งแล้วไม่สำเร็จ หยุดลองสำหรับวันนี้: ` + String(err));
    } else {
      logResult_(new Date(), 'error', `ลองครั้งที่ ${failCount}/${FAIL_LIMIT}: ` + String(err));
    }

    throw err; // ให้ Apps Script ส่งอีเมลแจ้งเจ้าของสคริปต์อัตโนมัติตามค่าเริ่มต้นของ installable trigger
  } finally {
    lock.releaseLock();
    try {
      if (shouldRetryToday) scheduleRetryNotification_(new Date());
      else syncNotificationTrigger_(new Date());
    } catch (scheduleErr) {
      console.error('ตั้ง trigger ครั้งถัดไปไม่สำเร็จ: ' + (scheduleErr.stack || scheduleErr));
    }
  }
}

// เก็บ FAIL_COUNT_<วันที่> ไว้แค่ของวันนี้ กันไม่ให้ Script Properties สะสมคีย์เก่าไปเรื่อยๆ ทุกวันที่เคย error
function cleanupOldFailCounts_(props, todayStr) {
  const todayKey = 'FAIL_COUNT_' + todayStr;
  props.getKeys().forEach(k => {
    if (k.indexOf('FAIL_COUNT_') === 0 && k !== todayKey) {
      props.deleteProperty(k);
    }
  });
}

// ---------- จัดข้อความ ----------

// เรียกเมื่อ items.length > 0 หรือ leaves.length > 0 หรือ advance ไม่เป็น null (ผู้เรียกเป็นคนกรองกรณีว่างทั้งหมดไปแล้ว)
// message_format ในชีต Settings เลือกได้ 'text' (ค่าเริ่มต้นถ้าเว้นว่างหรือใส่ค่าอื่น) หรือ 'flex'
// leaves คือใบลาที่อนุมัติแล้วและคร่อมวันนี้ (จาก getApprovedLeavesForDay_ ใน LeaveReports.gs)
// advance (ไม่บังคับ) คือข้อมูลวันล่วงหน้าจาก collectAdvanceNotice_ — ส่งมาเมื่อไรจะต่อท้ายเป็นอีกส่วน
// monthly (ไม่บังคับ) คือสรุปวันลารายเดือนจาก buildMonthlyLeaveSummary_ — แนบท้ายเป็นส่วนสุดท้าย
function buildLineMessage_(date, items, leaves, format, advance, monthly, conflicts) {
  if (String(format).trim().toLowerCase() === 'flex') {
    const dateLabel = thaiDateLabel_(date);
    let altText = `ปฏิทินการปฏิบัติงาน · ${dateLabel} (${items.length} รายการ)`;
    if (leaves.length) altText += ` — ผู้ลา ${leaves.length} คน`;
    if (advance) altText += ` — ล่วงหน้า ${advance.items.length + advance.leaves.length} รายการ`;
    if (monthly) altText += ' — สรุปใบลาเดือนที่แล้ว';
    if (conflicts && conflicts.length) altText += ` — ⚠ งานชนผู้ลา ${conflicts.length}`;
    return {
      type: 'flex',
      altText: altText, // ข้อความสำรองตอนแจ้งเตือน/เครื่องที่ไม่รองรับ Flex
      contents: buildFlexBubble_(date, items, leaves, advance, monthly, conflicts),
    };
  }
  return { type: 'text', text: buildTextMessage_(date, items, leaves, advance, monthly, conflicts) };
}

// หัวข้อส่วนล่วงหน้า — เลือกคำตามระยะจริง: ถัดจากวันข้อความ 1 วันใช้ "วันพรุ่งนี้" (อ่านเข้าใจทันที)
// ไกลกว่านั้นใช้ "ล่วงหน้า" เพราะ "วันพรุ่งนี้" จะผิดความหมายเมื่อ advance_notice_days ตั้งมากกว่า 1
function advanceSectionTitle_(date, advanceDate) {
  const nextDayStr = Utilities.formatDate(new Date(date.getTime() + 86400000), 'Asia/Bangkok', 'yyyy-MM-dd');
  const targetStr = Utilities.formatDate(advanceDate, 'Asia/Bangkok', 'yyyy-MM-dd');
  return (nextDayStr === targetStr ? 'วันพรุ่งนี้ · ' : 'ล่วงหน้า · ') + thaiDateLabel_(advanceDate);
}

function todaySectionTitle_(date) {
  return 'วันนี้ · ' + thaiDateLabel_(date);
}

// แปลงงานหนึ่งรายการเป็นบล็อกบูลเล็ต (พร้อมฟิลด์ย่อยแบบย่อหน้า) — ใช้ทั้งส่วนวันนี้และส่วนล่วงหน้า
// งานแบบหลายวันต่อท้ายช่วงวันที่แบบวงเล็บ เพื่อให้รู้ว่ารายการนี้คร่อมกี่วัน/ถึงวันไหน
function textItemBlock_(item) {
  if (item.isBirthday) {
    return `• 🎉 ${item.title} — ${item.details || 'สุขสันต์วันเกิด!'}`;
  }
  const range = itemRangeLabel_(item);
  const lines = [`• ${itemTimeLabel_(item)} — ${item.title}${range ? ' (' + range + ')' : ''}`];
  itemSubFields_(item).forEach(f => lines.push(`   ${f.label}: ${f.value}`));
  return lines.join('\n');
}

function buildTextMessage_(date, items, leaves, advance, monthly, conflicts) {
  const sections = [];
  const todayParts = [];

  if (items.length) todayParts.push(items.map(textItemBlock_).join('\n\n'));

  if (leaves && leaves.length) {
    todayParts.push(`ผู้ลาวันนี้ (${leaves.length} คน)\n` +
      leaves.map(leave => '• ' + (leave.firstName || '') + ' ' + leaveSummaryLabel_(leave)).join('\n'));
  }

  // งานวันนี้ที่ผู้รับผิดชอบกำลังลา — ให้กลุ่มเห็นตั้งแต่เช้าเพื่อจัดคนไปแทนได้ทัน
  if (conflicts && conflicts.length) {
    todayParts.push(`⚠ งานที่ผู้รับผิดชอบกำลังลา (${conflicts.length} งาน)\n` +
      conflicts.map(c => '• ' + c.timeLabel + ' ' + c.title + ' — ' + c.names.join(', ') + ' ลาอยู่').join('\n'));
  }

  if (todayParts.length) {
    sections.push(todaySectionTitle_(date) + `\n\n${todayParts.join('\n\n')}`);
  }

  // ส่วนล่วงหน้า: งาน+ผู้ลาของอีก N วันถัดไป — มีหัวข้อกำกับวันเป้าหมายชัดๆ กันสับสนกับของวันนี้
  if (advance) {
    const parts = [];
    if (advance.items.length) parts.push(advance.items.map(textItemBlock_).join('\n\n'));
    if (advance.leaves.length) {
      parts.push(`ผู้ลา (${advance.leaves.length} คน)\n` +
        advance.leaves.map(leave => '• ' + (leave.firstName || '') + ' ' + leaveSummaryLabel_(leave)).join('\n'));
    }
    sections.push(advanceSectionTitle_(date, advance.date) + `\n\n${parts.join('\n\n')}`);
  }

  // สรุปวันลารายเดือน (วันทำการแรกของเดือนเท่านั้น) — ส่วนสุดท้ายของข้อความเดียวกัน
  if (monthly) {
    sections.push(monthly.title + '\n' + monthly.lines.join('\n') + '\n' + monthly.totalLine);
  }

  return `ปฏิทินการปฏิบัติงาน\n\n${sections.join('\n\n')}`;
}

// กล่องรายการงาน (เวลาใช้สี accent ของส่วนวันนั้น + ชื่องาน + ฟิลด์ย่อย) — ใช้ทั้งวันนี้และล่วงหน้า
function flexItemBoxes_(items, accentColor) {
  const boxes = [];
  const accent = accentColor || TODAY_SECTION_THEME.text;
  items.forEach((item, i) => {
    if (i > 0) boxes.push({ type: 'separator', margin: 'lg' });

    if (item.isBirthday) {
      boxes.push({
        type: 'box', layout: 'vertical', margin: 'md', contents: [
          {
            type: 'box', layout: 'baseline', contents: [
              { type: 'text', text: '🎉', size: 'sm', flex: 0, adjustMode: 'shrink-to-fit' },
              { type: 'text', text: item.title, size: 'sm', weight: 'bold', wrap: true, flex: 1, margin: 'md', color: '#D946EF' }
            ]
          },
          { type: 'text', text: item.details || 'สุขสันต์วันเกิด!', size: 'xs', color: '#C026D3', wrap: true, margin: 'sm', offsetStart: 'xl' }
        ]
      });
      return;
    }

    const itemContents = [
      {
        type: 'box',
        layout: 'baseline',
        contents: [
          {
            type: 'text',
            text: itemTimeLabel_(item),
            size: 'sm',
            color: accent,
            weight: 'bold',
            flex: 0,
            adjustMode: 'shrink-to-fit',
          },
          {
            type: 'text',
            text: item.title,
            size: 'sm',
            weight: 'bold',
            wrap: true,
            flex: 1,
            margin: 'md',
            color: '#333333',
          },
        ],
      },
    ];

    // งานแบบหลายวัน: บรรทัดเล็กใต้ชื่อบอกช่วงเต็ม ให้รู้ว่ารายการนี้กำลังคร่อมอยู่ถึงวันไหน
    const rangeLabel = itemRangeLabel_(item);
    if (rangeLabel) {
      itemContents.push({
        type: 'text',
        text: 'ต่อเนื่อง ' + rangeLabel,
        size: 'xs',
        color: '#717875',
        wrap: true,
        margin: 'xs',
      });
    }

    itemSubFields_(item).forEach(f => {
      itemContents.push({
        type: 'box',
        layout: 'baseline',
        margin: 'sm',
        contents: [
          { type: 'text', text: f.label + ':', size: 'xs', weight: 'bold', color: '#717875', flex: 2, wrap: true },
          { type: 'text', text: f.value, size: 'xs', color: '#4A4A4A', wrap: true, flex: 5 },
        ],
      });
    });

    boxes.push({ type: 'box', layout: 'vertical', margin: 'md', contents: itemContents });
  });
  return boxes;
}

// แถวผู้ลา: ชื่อเฉพาะ (หนา) แล้วตามด้วยบรรทัดรายละเอียดถ้อยคำทางการ — ใช้ทั้งส่วนวันนี้และส่วนล่วงหน้า
function flexLeaveRows_(leaves) {
  const rows = [];
  leaves.forEach((leave, i) => {
    if (i > 0) rows.push({ type: 'separator', margin: 'sm' });
    rows.push({
      type: 'box',
      layout: 'vertical',
      margin: 'md',
      contents: [
        { type: 'text', text: leave.firstName || leave.fullName, size: 'sm', weight: 'bold', color: '#333333', wrap: true },
        { type: 'text', text: leaveSummaryLabel_(leave), size: 'xs', color: '#717875', wrap: true, margin: 'xs' },
      ],
    });
  });
  return rows;
}

// โครงสร้าง Flex Message ("bubble") ตามสเปกของ LINE Messaging API
// สไตล์ทางการ: header สีตามวัน (หัวจดหมาย) + เส้นคาดเทากลาง + รายการงาน (label/value แยกกล่องแบบเดียวกับแถวเวลา
// เพื่อให้ label เข้มขึ้นได้แบบชัวร์ว่า render ถูก แทนการลองใช้ span ผสมสไตล์ในบรรทัดเดียวที่ยังไม่ได้ทดสอบจริง)
// + หัวข้อผู้ลาวันนี้ (ถ้ามี) + footer ชื่อหน่วยงาน
// items อาจว่างได้ในวันที่มีแต่ผู้ลา — โครงการ์ดยังเหมือนเดิม แค่ไม่มีกล่องรายการงาน
function buildFlexBubble_(date, items, leaves, advance, monthly, conflicts) {
  const theme = dayThemeFor_(date);

  const itemBoxes = flexItemBoxes_(items);
  const hasTodayContent = itemBoxes.length || (leaves && leaves.length) || (conflicts && conflicts.length);

  const bodyContents = [
    // เส้นคาดบางๆ คั่นระหว่าง header กับเนื้อหา ใช้ filler เป็น content ของกล่อง (กล่องว่างเปล่าอาจไม่ผ่าน validation)
    // เป็นเทากลาง ไม่ใช่สีทอง เพราะทองชนกับ header สีเหลือง(จันทร์)จนแทบมองไม่เห็นเส้น เทาเข้ากับ header ได้ทุกสี
    { type: 'box', layout: 'vertical', height: '3px', backgroundColor: '#9AA6A1', contents: [{ type: 'filler' }] },
  ];

  if (hasTodayContent) {
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      backgroundColor: TODAY_SECTION_THEME.bg,
      paddingAll: '12px',
      contents: [
        { type: 'text', text: todaySectionTitle_(date), size: 'sm', weight: 'bold', color: TODAY_SECTION_THEME.text, wrap: true },
      ],
    });
  }

  if (itemBoxes.length) {
    bodyContents.push({ type: 'box', layout: 'vertical', paddingAll: '16px', contents: itemBoxes });
  }

  if (leaves && leaves.length) {
    // เมื่อมีรายการงานอยู่ก่อน คั่นด้วย separator เต็มความกว้างการ์ด (แบบเดียวกับเส้นคาดใต้ header)
    if (itemBoxes.length) bodyContents.push({ type: 'separator' });
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      paddingAll: '16px',
      contents: [
        { type: 'text', text: 'ผู้ลาวันนี้ (' + leaves.length + ' คน)', size: 'sm', weight: 'bold', color: TODAY_SECTION_THEME.text },
      ].concat(flexLeaveRows_(leaves)),
    });
  }

  // งานวันนี้ที่ผู้รับผิดชอบกำลังลา — กล่องเตือนโทนอำพัน (สีเดียวกับการ์ดลาบนหน้าเว็บ) ให้เห็นแยกจากข้อมูลปกติ
  if (conflicts && conflicts.length) {
    bodyContents.push({ type: 'separator' });
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      paddingAll: '16px',
      contents: [
        { type: 'text', text: '⚠ งานที่ผู้รับผิดชอบกำลังลา (' + conflicts.length + ' งาน)', size: 'sm', weight: 'bold', color: '#B45309' },
      ].concat(conflicts.map(c => ({
        type: 'text',
        text: '• ' + c.timeLabel + ' ' + c.title + ' — ' + c.names.join(', ') + ' ลาอยู่',
        size: 'xs', color: '#92400E', wrap: true, margin: 'sm',
      }))),
    });
  }

  // ส่วนล่วงหน้า: งาน+ผู้ลาของอีก N วันถัดไป อยู่ท้ายการ์ด — ใช้พื้นฟ้าและ accent น้ำเงินคงที่
  // พร้อมหัวข้อวันที่ เพื่อให้แยกจากวันนี้ได้ทั้งด้วยสีและข้อความ
  if (advance) {
    const advContents = [
      { type: 'text', text: advanceSectionTitle_(date, advance.date), size: 'sm', weight: 'bold', color: ADVANCE_SECTION_THEME.text, wrap: true },
    ].concat(flexItemBoxes_(advance.items, ADVANCE_SECTION_THEME.text));
    if (advance.leaves.length) {
      if (advance.items.length) advContents.push({ type: 'separator', margin: 'lg' });
      advContents.push({ type: 'text', text: 'ผู้ลา (' + advance.leaves.length + ' คน)', size: 'xs', weight: 'bold', color: ADVANCE_SECTION_THEME.text, margin: 'md' });
      flexLeaveRows_(advance.leaves).forEach(row => advContents.push(row));
    }
    if (hasTodayContent) bodyContents.push({ type: 'separator' });
    bodyContents.push({
      type: 'box', layout: 'vertical', backgroundColor: ADVANCE_SECTION_THEME.bg,
      paddingAll: '16px', contents: advContents,
    });
  }

  // สรุปวันลารายเดือน (วันทำการแรกของเดือนเท่านั้น) — กล่องสุดท้าย โครงเดียวกับส่วนผู้ลา:
  // หัวข้อหนาสีเขียว แล้วบรรทัดรายคนตัวเล็ก ปิดท้ายยอดรวมทั้งเดือน
  if (monthly) {
    const monthlyContents = [
      { type: 'text', text: monthly.title, size: 'sm', weight: 'bold', color: '#0F6E56', wrap: true },
    ].concat(monthly.lines.map(line => ({
      type: 'text', text: line, size: 'xs', color: '#4A4A4A', wrap: true, margin: 'sm',
    })));
    monthlyContents.push({
      type: 'text', text: monthly.totalLine, size: 'xs', weight: 'bold', color: '#717875', margin: 'md',
    });
    bodyContents.push({ type: 'separator' });
    bodyContents.push({ type: 'box', layout: 'vertical', paddingAll: '16px', contents: monthlyContents });
  }

  return {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: theme.bg,
      paddingAll: '16px',
      contents: [
        {
          type: 'text', text: 'ปฏิทินการปฏิบัติงานประจำวัน',
          color: theme.text, weight: 'bold', size: 'md', wrap: true,
        },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '0px', // padding เป็น 0 ที่นี่ เพื่อให้เส้นคาดด้านล่างเต็มความกว้างการ์ดพอดี ไม่มีขอบขาว
      contents: bodyContents,
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '12px',
      contents: [
        { type: 'text', text: 'สำนักงานสาธารณสุขอำเภอสอง จังหวัดแพร่', size: 'xxs', color: '#6F7874', align: 'center' },
      ],
    },
    styles: {
      footer: { separator: true, separatorColor: '#DCE5E1' },
    },
  };
}

// ใช้เก็บ log แบบสั้นๆ ได้ทั้งสองฟอร์แมต (flex ใช้ altText แทนเนื้อหาเต็ม)
function messagePreview_(messageObj) {
  return messageObj.type === 'flex' ? messageObj.altText : messageObj.text;
}

// ---------- ส่งเข้า LINE ----------

function sendLineMessage_(groupId, messageObj) {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) throw new Error('ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN ใน Script Properties');

  const response = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ to: groupId, messages: [messageObj] }),
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() >= 300) {
    throw new Error('LINE push ล้มเหลว (' + response.getResponseCode() + '): ' + response.getContentText());
  }
}

// ---------- บันทึก log ----------

const LOG_RETENTION_DAYS_DEFAULT = 90;
const LOG_RETENTION_DAYS_MIN = 30;
const LOG_RETENTION_DAYS_MAX = 3650;

function logRetentionDays_(value) {
  const days = Number(String(value == null ? '' : value).trim());
  return Number.isInteger(days) && days >= LOG_RETENTION_DAYS_MIN && days <= LOG_RETENTION_DAYS_MAX
    ? days
    : LOG_RETENTION_DAYS_DEFAULT;
}

// คืนช่วงแถวที่หมดอายุจากล่างขึ้นบน เพื่อ deleteRows แล้วเลขแถวของช่วงที่เหลือไม่เลื่อน
function expiredLogRowRuns_(timestampRows, cutoffMs) {
  const expiredRows = [];
  (timestampRows || []).forEach((row, index) => {
    const value = Array.isArray(row) ? row[0] : row;
    const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
    if (Number.isFinite(timestamp) && timestamp < cutoffMs) expiredRows.push(index + 3);
  });

  const runs = [];
  for (let i = expiredRows.length - 1; i >= 0; i--) {
    const endRow = expiredRows[i];
    let startRow = endRow;
    while (i > 0 && expiredRows[i - 1] === startRow - 1) {
      startRow = expiredRows[--i];
    }
    runs.push({ startRow: startRow, count: endRow - startRow + 1 });
  }
  return runs;
}

function cleanupOldLogs_(sheet, now, retentionValue) {
  if (!sheet || sheet.getLastRow() < 3) return 0;
  const days = logRetentionDays_(retentionValue);
  const todayStr = Utilities.formatDate(now || new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  const cutoffMs = new Date(todayStr + 'T00:00:00+07:00').getTime() - days * 86400000;
  const timestampRows = sheet.getRange(3, 1, sheet.getLastRow() - 2, 1).getValues();
  const runs = expiredLogRowRuns_(timestampRows, cutoffMs);
  runs.forEach(run => sheet.deleteRows(run.startRow, run.count));
  return runs.reduce((total, run) => total + run.count, 0);
}

function logResult_(date, status, detail) {
  const sheet = SpreadsheetApp.getActive().getSheetByName('Logs');
  const safeDetail = String(detail == null ? '' : detail).substring(0, 500); // กัน cell ยาวเกินไปถ้า error message ยาวผิดปกติ
  sheet.appendRow([new Date(), Utilities.formatDate(date, 'Asia/Bangkok', 'yyyy-MM-dd'), status, safeDetail]);
}

// ---------- นัดหมาย one-time trigger ----------

const NOTIFICATION_TRIGGER_HANDLER = 'checkAndSendNotification';
const LOG_CLEANUP_TRIGGER_HANDLER = 'cleanupLogsDaily';
const RETRY_DELAY_MS = 5 * 60 * 1000;

function cleanupLogsDaily() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    const settings = getSettings_();
    const now = new Date();
    cleanupOldLogs_(SpreadsheetApp.getActive().getSheetByName('Logs'), now, settings.logs_retention_days);
    try {
      const completed = completePastScheduleItems_(now, settings.notion_database_id);
      if (completed) logResult_(now, 'schedule-status', 'เปลี่ยนงานที่พ้นวันสิ้นสุดเป็นเสร็จสิ้น ' + completed + ' รายการ');
    } catch (err) {
      logResult_(now, 'error', 'อัปเดตสถานะงานที่พ้นวันไม่สำเร็จ: ' + String(err));
      throw err;
    }
  } finally {
    lock.releaseLock();
  }
}

function ensureLogCleanupTrigger_() {
  const exists = ScriptApp.getProjectTriggers()
    .some(trigger => trigger.getHandlerFunction() === LOG_CLEANUP_TRIGGER_HANDLER);
  if (!exists) {
    ScriptApp.newTrigger(LOG_CLEANUP_TRIGGER_HANDLER)
      .timeBased()
      .everyDays(1)
      .atHour(3)
      .create();
    return true;
  }
  return false;
}

function nextScheduledDate_(now, notifyTime) {
  const normalizedTime = normalizeScheduleTime_(notifyTime);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(normalizedTime)) {
    throw new Error('notify_time ต้องเป็นรูปแบบ HH:mm เช่น 08:00');
  }

  const todayStr = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd');
  let nextRun = new Date(todayStr + 'T' + normalizedTime + ':00+07:00');
  if (nextRun.getTime() <= now.getTime()) {
    const tomorrow = new Date(nextRun.getTime() + 86400000);
    const tomorrowStr = Utilities.formatDate(tomorrow, 'Asia/Bangkok', 'yyyy-MM-dd');
    nextRun = new Date(tomorrowStr + 'T' + normalizedTime + ':00+07:00');
  }
  return nextRun;
}

function replaceNotificationTrigger_(runAt) {
  removeNotificationTriggers_();

  ScriptApp.newTrigger(NOTIFICATION_TRIGGER_HANDLER)
    .timeBased()
    .at(runAt)
    .create();
  return runAt;
}

function removeNotificationTriggers_() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === NOTIFICATION_TRIGGER_HANDLER)
    .forEach(t => ScriptApp.deleteTrigger(t));
}

function scheduleNextNotification_(now) {
  const settings = getSettings_();
  return replaceNotificationTrigger_(nextScheduledDate_(now || new Date(), settings.notify_time));
}

function syncNotificationTrigger_(now) {
  const settings = getSettings_();
  if (String(settings.enabled || '').toUpperCase() !== 'TRUE') {
    removeNotificationTriggers_();
    return null;
  }
  if (!notificationConfigurationReady_(settings)) {
    throw new Error('ตั้งค่า notify_time, notion_database_id หรือ line_group_id ไม่ครบ/รูปแบบไม่ถูกต้อง');
  }
  return replaceNotificationTrigger_(nextScheduledDate_(now || new Date(), settings.notify_time));
}

function scheduleRetryNotification_(now) {
  const retryAt = new Date((now || new Date()).getTime() + RETRY_DELAY_MS);
  return replaceNotificationTrigger_(retryAt);
}

// รันเมื่อตั้งระบบครั้งแรกและทุกครั้งที่แก้ notify_time

function installTrigger() {
  try {
    ensureLogCleanupTrigger_();
    ensurePendingLeaveReminderTrigger_();
    const nextRun = syncNotificationTrigger_(new Date());
    if (!nextRun) {
      SpreadsheetApp.getUi().alert('ระบบแจ้งเตือนปิดอยู่ จึงลบ trigger ส่งข้อความเดิมแล้ว\n\nติดตั้ง trigger บำรุงรักษารายวันและตรวจใบลาค้างทุกชั่วโมงแล้ว');
      return;
    }
    const nextLabel = thaiDateLabel_(nextRun) + ' เวลา ' +
      Utilities.formatDate(nextRun, 'Asia/Bangkok', 'HH:mm');
    SpreadsheetApp.getUi().alert('ตั้งเวลาส่งอัตโนมัติแล้ว\n\nครั้งถัดไป: ' + nextLabel +
      '\nติดตั้ง trigger บำรุงรักษารายวันและตรวจใบลาค้างทุกชั่วโมงแล้ว');
  } catch (err) {
    SpreadsheetApp.getUi().alert('ติดตั้ง trigger ไม่สำเร็จ: ' + err);
  }
}

function notificationRuntimeHealth_() {
  const settings = getSettings_();
  const enabled = String(settings.enabled || '').toUpperCase() === 'TRUE';
  const configReady = notificationConfigurationReady_(settings);
  const triggerInstalled = ScriptApp.getProjectTriggers().some(
    trigger => trigger.getHandlerFunction() === NOTIFICATION_TRIGGER_HANDLER);
  return {
    enabled: enabled,
    configReady: configReady,
    triggerInstalled: triggerInstalled,
    healthy: !enabled || (configReady && triggerInstalled),
  };
}

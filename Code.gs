/**
 * ระบบแจ้งเตือนงานเข้ากลุ่ม LINE รายวัน — ดึงข้อมูลจาก Notion database "ปฏิทินการปฏิบัติงาน"
 * - ใช้ one-time trigger นัดเวลาส่งครั้งถัดไปตาม notify_time โดยตรง
 *   เมื่อทำงานเสร็จจะสร้าง trigger สำหรับวันถัดไป และ retry เฉพาะเมื่อส่งล้มเหลว
 * - อ่านค่าตั้งค่าและวันหยุดจากชีต "Settings" / "Holidays" ทุกครั้งที่รัน
 *   เมื่อแก้ notify_time ให้กดเมนูติดตั้ง/อัปเดตเวลาส่งอัตโนมัติเพื่อนัด trigger ใหม่
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

const PROPS_NOTION = {
  title: 'งาน',
  date: 'วันที่ - เวลา',
  status: 'สถานะงาน',
  assignee: 'ผู้รับผิดชอบ',
  location: 'สถานที่',
  details: 'รายละเอียด',
  notes: 'หมายเหตุ',
};
const NOTION_VERSION = '2025-09-03'; // API version ที่รองรับ data sources — ดู developers.notion.com/docs/upgrade-faqs-2025-09-03
const NOTION_SEND_STATUSES = ['ยืนยันแล้ว'];
const NOTION_STATUS_PROPERTY_TYPE = 'select'; // ใช้ 'status' หากเปลี่ยนชนิด property ใน Notion

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

const THAI_WEEKDAY_NAMES = [
  'อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์',
];
const THAI_MONTH_NAMES = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

// ---------- อ่านค่าตั้งค่า ----------

const FAIL_LIMIT = 3; // ลองส่งไม่เกินกี่ครั้ง/วัน ก่อนหยุดลองและรอวันถัดไป (หรือกด "ทดสอบส่งตอนนี้" เองหลังแก้ปัญหา)

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

    if (!settings.notify_time || !settings.notion_database_id || !settings.line_group_id) {
      // ตั้งค่าไม่ครบ — log วันละครั้ง ให้เห็นใน Logs/หน้าเว็บว่าทำไมระบบไม่ส่ง
      // return เงียบแบบไม่มีร่องรอยเลยถ้าลืมกรอกอะไรสักฟิลด์
      if (props.getProperty('LAST_CHECKED_DATE') !== todayStr) {
        logResult_(now, 'skip', 'ตั้งค่าไม่ครบ (notify_time/notion_database_id/line_group_id) — เปิดชีต Settings หรือหน้าเว็บตั้งค่าเพื่อกรอกให้ครบ');
        props.setProperty('LAST_CHECKED_DATE', todayStr);
      }
      return;
    }

    // ทำไปแล้ววันนี้หรือยัง (ไม่ว่าผลจะเป็นส่งข้อความหรือข้ามแบบเงียบๆ ก็ตาม)
    // กัน trigger ซ้ำหรือการเรียกซ้ำโดยไม่ตั้งใจไม่ให้ยิงข้อความซ้ำในวันเดียวกัน
    if (props.getProperty('LAST_CHECKED_DATE') === todayStr) return;

    if (isWeekend_(now)) {
      logResult_(now, 'skip', 'วันเสาร์-อาทิตย์');
      props.setProperty('LAST_CHECKED_DATE', todayStr);
      return;
    }
    if (isHoliday_(now)) {
      logResult_(now, 'skip', 'วันหยุดราชการ (ตาราง Holidays)');
      props.setProperty('LAST_CHECKED_DATE', todayStr);
      return;
    }

    const items = getNotionItemsForDay_(now, settings.notion_database_id);
    // ส่วนผู้ลาวันนี้ — ถ้ายังไม่ได้ตั้งค่าระบบลา จะคืน [] พร้อม log เอง ไม่กระทบการส่งเช้าหลัก
    const leaves = getApprovedLeavesForDay_(now, settings.leave_database_id);

    if (items.length === 0 && leaves.length === 0) {
      // ไม่มีงานและไม่มีผู้ลา -> ไม่ส่งข้อความเข้ากลุ่มเลย แต่ยังบันทึก log ไว้เป็นหลักฐานว่าเช็คแล้วจริง
      logResult_(now, 'skip', 'ไม่มีงาน/ผู้ลาในระบบวันนี้ — ไม่ส่งข้อความ');
      props.setProperty('LAST_CHECKED_DATE', todayStr);
      return;
    }

    const messageObj = buildLineMessage_(now, items, leaves, settings.message_format);
    sendLineMessage_(settings.line_group_id, messageObj);

    props.setProperty('LAST_CHECKED_DATE', todayStr);
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
      else scheduleNextNotification_(new Date());
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

// ---------- อ่านข้อมูลจาก Notion ----------

function notionHeaders_() {
  const token = PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
  if (!token) throw new Error('ยังไม่ได้ตั้งค่า NOTION_TOKEN ใน Script Properties');
  return { Authorization: 'Bearer ' + token, 'Notion-Version': NOTION_VERSION };
}

// database มี "data source" ซ่อนอยู่ข้างใน (Notion API ตั้งแต่เวอร์ชัน 2025-09-03) ต้อง resolve ก่อนค่อย query ได้
// ฐานข้อมูลทั่วไปที่ไม่ได้ตั้งค่าซับซ้อนจะมี data source เดียว จึงหยิบตัวแรกมาใช้ตรงๆ
function resolveDataSourceId_(databaseId) {
  if (!databaseId || String(databaseId).trim() === 'your_notion_database_id') {
    throw new Error('ยังไม่ได้ตั้งค่า notion_database_id ในชีต Settings (ยังเป็นค่าตัวอย่างอยู่)');
  }
  const response = UrlFetchApp.fetch('https://api.notion.com/v1/databases/' + databaseId, {
    method: 'get',
    headers: notionHeaders_(),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() >= 300) {
    throw new Error('เปิด Notion database ไม่ได้ (' + response.getResponseCode() + '): ' + response.getContentText());
  }
  const data = JSON.parse(response.getContentText());
  if (!data.data_sources || !data.data_sources.length) {
    throw new Error('database นี้ไม่มี data source ที่เข้าถึงได้ — เช็คว่าแชร์ database ให้ integration แล้วหรือยัง (Connections ในเมนู "...")');
  }
  return data.data_sources[0].id;
}

function buildNotionQueryPayload_(todayStr, tomorrowStr) {
  if (!['select', 'status'].includes(NOTION_STATUS_PROPERTY_TYPE)) {
    throw new Error('NOTION_STATUS_PROPERTY_TYPE ต้องเป็น select หรือ status');
  }
  const allowedStatusFilters = NOTION_SEND_STATUSES.map(status => {
    const filter = { property: PROPS_NOTION.status };
    filter[NOTION_STATUS_PROPERTY_TYPE] = { equals: status };
    return filter;
  });
  return {
    filter: {
      and: [
        { property: PROPS_NOTION.date, date: { on_or_after: todayStr + 'T00:00:00+07:00' } },
        { property: PROPS_NOTION.date, date: { before: tomorrowStr + 'T00:00:00+07:00' } },
        { or: allowedStatusFilters },
      ],
    },
    sorts: [{ property: PROPS_NOTION.date, direction: 'ascending' }],
    page_size: 100,
  };
}

function getNotionItemsForDay_(date, databaseId) {
  const dataSourceId = resolveDataSourceId_(databaseId);

  const todayStr = Utilities.formatDate(date, 'Asia/Bangkok', 'yyyy-MM-dd');
  const tomorrowStr = Utilities.formatDate(new Date(date.getTime() + 86400000), 'Asia/Bangkok', 'yyyy-MM-dd');

  const payload = buildNotionQueryPayload_(todayStr, tomorrowStr);

  const response = UrlFetchApp.fetch('https://api.notion.com/v1/data_sources/' + dataSourceId + '/query', {
    method: 'post',
    contentType: 'application/json',
    headers: notionHeaders_(),
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() >= 300) {
    throw new Error('ดึงข้อมูลจาก Notion ไม่สำเร็จ (' + response.getResponseCode() + '): ' + response.getContentText());
  }

  const data = JSON.parse(response.getContentText());
  return (data.results || []).map(parseNotionPage_);
  // หมายเหตุ: ตัวกรองนี้เช็คว่า "วันเริ่ม" ของแต่ละงานตรงกับวันนี้ ถ้างานไหนตั้งเป็นช่วงวันที่ (มีวันสิ้นสุดด้วย)
  // ยังไม่ยืนยัน 100% ว่า Notion จะรวมงานนั้นในทุกวันของช่วงหรือแค่วันเริ่มวันเดียว — ยังไม่เจอเคสแบบนี้จริง
  // ในข้อมูลตอนตรวจสอบ ถ้าเจอว่างานหลายวันหายไปจากการแจ้งเตือนวันถัดๆ ไป ให้บอกแล้วจะปรับ filter เพิ่ม
}

function parseNotionPage_(page) {
  const props = page.properties || {};
  const dateProp = (props[PROPS_NOTION.date] && props[PROPS_NOTION.date].date) || null;
  const statusProp = props[PROPS_NOTION.status] || {};
  const statusValue = statusProp.select || statusProp.status || null;
  const isDatetime = !!(dateProp && dateProp.start && dateProp.start.indexOf('T') !== -1);
  return {
    title: plainText_(props[PROPS_NOTION.title] && props[PROPS_NOTION.title].title) || '(ไม่มีชื่องาน)',
    start: dateProp ? dateProp.start : null,
    end: dateProp ? dateProp.end : null,
    isDatetime: isDatetime,
    status: statusValue ? statusValue.name : '',
    assignees: ((props[PROPS_NOTION.assignee] && props[PROPS_NOTION.assignee].multi_select) || []).map(o => o.name),
    location: plainText_(props[PROPS_NOTION.location] && props[PROPS_NOTION.location].rich_text),
    details: plainText_(props[PROPS_NOTION.details] && props[PROPS_NOTION.details].rich_text),
    notes: plainText_(props[PROPS_NOTION.notes] && props[PROPS_NOTION.notes].rich_text),
  };
}

function plainText_(richTextArray) {
  return (richTextArray || []).map(t => t.plain_text).join('').trim();
}

function formatNotionTime_(value) {
  if (!value) return '';
  const text = String(value);
  const hasExplicitOffset = /[+-]\d{2}:\d{2}$|Z$/.test(text);
  if (hasExplicitOffset) {
    return Utilities.formatDate(new Date(text), 'Asia/Bangkok', 'HH:mm');
  }
  const match = text.match(/T(\d{2}):(\d{2})/);
  return match ? match[1] + ':' + match[2] : '';
}

function itemTimeLabel_(item) {
  if (!item.isDatetime || !item.start) return 'ทั้งวัน';
  const startTime = formatNotionTime_(item.start);
  if (!startTime) return 'ทั้งวัน';
  const endTime = formatNotionTime_(item.end);
  return endTime ? startTime + '–' + endTime : startTime;
}

// ---------- จัดข้อความ ----------

// เรียกเมื่อ items.length > 0 หรือ leaves.length > 0 (อย่างน้อยหนึ่งด้าน — ผู้เรียกเป็นคนกรองกรณีว่างทั้งคู่ไปแล้ว)
// message_format ในชีต Settings เลือกได้ 'text' (ค่าเริ่มต้นถ้าเว้นว่างหรือใส่ค่าอื่น) หรือ 'flex'
// leaves คือใบลาที่อนุมัติแล้วและคร่อมวันนี้ (จาก getApprovedLeavesForDay_ ใน Leave.gs)
function buildLineMessage_(date, items, leaves, format) {
  if (String(format).trim().toLowerCase() === 'flex') {
    const dateLabel = thaiDateLabel_(date);
    let altText = `📅 ปฏิทินงานวันที่ ${dateLabel} (${items.length} รายการ)`;
    if (leaves.length) altText += ` — ผู้ลา ${leaves.length} คน`;
    return {
      type: 'flex',
      altText: altText, // ข้อความสำรองตอนแจ้งเตือน/เครื่องที่ไม่รองรับ Flex
      contents: buildFlexBubble_(date, items, leaves),
    };
  }
  return { type: 'text', text: buildTextMessage_(date, items, leaves) };
}

// รายละเอียดย่อย (ผู้รับผิดชอบ/สถานที่/รายละเอียด/หมายเหตุ) คืนเป็น {label, value} เฉพาะฟิลด์ที่มีค่าเท่านั้น
// ฟิลด์ว่างจะไม่ถูกรวมมาเลย ให้ผู้เรียก (text/flex) จัดรูปแบบการแสดงผลของตัวเองต่อ
function itemSubFields_(item) {
  const fields = [];
  if (item.assignees.length) fields.push({ label: 'ผู้รับผิดชอบ', value: item.assignees.join(', ') });
  if (item.location) fields.push({ label: 'สถานที่', value: item.location });
  if (item.details) fields.push({ label: 'รายละเอียด', value: item.details });
  if (item.notes) fields.push({ label: 'หมายเหตุ', value: item.notes });
  return fields;
}

function buildTextMessage_(date, items, leaves) {
  const dateLabel = thaiDateLabel_(date);
  const sections = [];

  if (items.length) {
    const blocks = items.map(item => {
      const lines = [`• ${itemTimeLabel_(item)} — ${item.title}`];
      itemSubFields_(item).forEach(f => lines.push(`   ${f.label}: ${f.value}`));
      return lines.join('\n');
    });
    sections.push(blocks.join('\n\n'));
  }

  if (leaves && leaves.length) {
    sections.push(`🏖️ ผู้ลาวันนี้ (${leaves.length} คน)\n` +
      leaves.map(leave => '• ' + leaveSummaryLabel_(leave)).join('\n'));
  }

  return `📅 ปฏิทินงานวันที่ ${dateLabel}\n\n${sections.join('\n\n')}`;
}

// โครงสร้าง Flex Message ("bubble") ตามสเปกของ LINE Messaging API
// สไตล์ทางการ: header สีตามวัน (หัวจดหมาย) + เส้นคาดเทากลาง + รายการงาน (label/value แยกกล่องแบบเดียวกับแถวเวลา
// เพื่อให้ label เข้มขึ้นได้แบบชัวร์ว่า render ถูก แทนการลองใช้ span ผสมสไตล์ในบรรทัดเดียวที่ยังไม่ได้ทดสอบจริง)
// + หัวข้อผู้ลาวันนี้ (ถ้ามี) + footer ชื่อหน่วยงาน
// items อาจว่างได้ในวันที่มีแต่ผู้ลา — โครงการ์ดยังเหมือนเดิม แค่ไม่มีกล่องรายการงาน
function buildFlexBubble_(date, items, leaves) {
  const dateLabel = thaiDateLabel_(date);
  const theme = dayThemeFor_(date);

  const itemBoxes = [];
  items.forEach((item, i) => {
    if (i > 0) itemBoxes.push({ type: 'separator', margin: 'lg' });

    const itemContents = [
      {
        type: 'box',
        layout: 'baseline',
        contents: [
          {
            type: 'text',
            text: itemTimeLabel_(item),
            size: 'sm',
            color: '#0F6E56',
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

    itemBoxes.push({ type: 'box', layout: 'vertical', margin: 'md', contents: itemContents });
  });

  const bodyContents = [
    // เส้นคาดบางๆ คั่นระหว่าง header กับเนื้อหา ใช้ filler เป็น content ของกล่อง (กล่องว่างเปล่าอาจไม่ผ่าน validation)
    // เป็นเทากลาง ไม่ใช่สีทอง เพราะทองชนกับ header สีเหลือง(จันทร์)จนแทบมองไม่เห็นเส้น เทาเข้ากับ header ได้ทุกสี
    { type: 'box', layout: 'vertical', height: '3px', backgroundColor: '#9AA6A1', contents: [{ type: 'filler' }] },
  ];

  if (itemBoxes.length) {
    bodyContents.push({ type: 'box', layout: 'vertical', paddingAll: '16px', contents: itemBoxes });
  }

  if (leaves && leaves.length) {
    const leaveRows = leaves.map(leave => ({
      type: 'box',
      layout: 'baseline',
      margin: 'sm',
      contents: [
        { type: 'text', text: leave.fullName, size: 'xs', weight: 'bold', color: '#333333', flex: 3, wrap: true },
        { type: 'text', text: leave.leaveType, size: 'xs', color: '#4A4A4A', flex: 2, wrap: true, margin: 'md' },
        {
          type: 'text',
          text: leaveDateLabel_(leave.start, leave.end),
          size: 'xs',
          color: '#717875',
          flex: 4,
          wrap: true,
          margin: 'md',
          adjustMode: 'shrink-to-fit',
        },
      ],
    }));

    // เมื่อมีรายการงานอยู่ก่อน คั่นด้วย separator เต็มความกว้างการ์ด (แบบเดียวกับเส้นคาดใต้ header)
    if (itemBoxes.length) bodyContents.push({ type: 'separator' });
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      paddingAll: '16px',
      contents: [
        { type: 'text', text: '🏖️ ผู้ลาวันนี้ (' + leaves.length + ' คน)', size: 'sm', weight: 'bold', color: '#0F6E56' },
      ].concat(leaveRows),
    });
  }

  return {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: theme.bg,
      paddingAll: '16px',
      contents: [
        { type: 'text', text: 'ปฏิทินการปฏิบัติงานประจำวัน', color: theme.eyebrow, size: 'xxs' },
        { type: 'text', text: dateLabel, color: theme.text, weight: 'bold', size: 'lg', wrap: true, margin: 'sm' },
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

function logResult_(date, status, detail) {
  const sheet = SpreadsheetApp.getActive().getSheetByName('Logs');
  const safeDetail = String(detail == null ? '' : detail).substring(0, 500); // กัน cell ยาวเกินไปถ้า error message ยาวผิดปกติ
  sheet.appendRow([new Date(), Utilities.formatDate(date, 'Asia/Bangkok', 'yyyy-MM-dd'), status, safeDetail]);
}

// ---------- นัดหมาย one-time trigger ----------

const NOTIFICATION_TRIGGER_HANDLER = 'checkAndSendNotification';
const RETRY_DELAY_MS = 5 * 60 * 1000;

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
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === NOTIFICATION_TRIGGER_HANDLER)
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger(NOTIFICATION_TRIGGER_HANDLER)
    .timeBased()
    .at(runAt)
    .create();
  return runAt;
}

function scheduleNextNotification_(now) {
  const settings = getSettings_();
  return replaceNotificationTrigger_(nextScheduledDate_(now || new Date(), settings.notify_time));
}

function scheduleRetryNotification_(now) {
  const retryAt = new Date((now || new Date()).getTime() + RETRY_DELAY_MS);
  return replaceNotificationTrigger_(retryAt);
}

// รันเมื่อตั้งระบบครั้งแรกและทุกครั้งที่แก้ notify_time

function installTrigger() {
  try {
    const nextRun = scheduleNextNotification_(new Date());
    const nextLabel = thaiDateLabel_(nextRun) + ' เวลา ' +
      Utilities.formatDate(nextRun, 'Asia/Bangkok', 'HH:mm');
    SpreadsheetApp.getUi().alert('ตั้งเวลาส่งอัตโนมัติแล้ว\n\nครั้งถัดไป: ' + nextLabel);
  } catch (err) {
    SpreadsheetApp.getUi().alert('ติดตั้ง trigger ไม่สำเร็จ: ' + err);
  }
}

// ---------- เมนูในชีต ----------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ระบบแจ้งเตือนปฏิทิน')
    .addItem('ทดสอบส่งตอนนี้', 'testSendNow')
    .addItem('ทดสอบการ์ดใบลา', 'testLeaveCardNow')
    .addItem('รัน Unit Tests', 'runUnitTests')
    .addItem('ติดตั้ง/อัปเดตเวลาส่งอัตโนมัติ', 'installTrigger')
    .addSeparator()
    .addItem('เตรียม/ตรวจสอบชีตทั้งหมด', 'setupSheet')
    .addItem('เปิด/ปิดระบบลา', 'toggleLeaveSystem')
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

  // เติมค่าตั้งต้นของ Settings เฉพาะ key ที่ยังไม่มี (พร้อมคำอธิบายในคอลัมน์ C — โค้ดอ่านแค่ A/B)
  const addedKeys = [];
  [
    ['enabled', 'TRUE', 'เปิด/ปิดระบบแจ้งเตือน (TRUE หรือ FALSE)'],
    ['notify_time', '08:30', 'เวลาส่งข้อความเช้า (HH:mm) — แก้แล้วต้องกดเมนู "ติดตั้ง/อัปเดตเวลาส่งอัตโนมัติ" ทุกครั้ง'],
    ['notion_database_id', 'your_notion_database_id', 'Database ID ของ "ปฏิทินการปฏิบัติงาน" ใน Notion'],
    ['line_group_id', '', 'เติมอัตโนมัติเมื่อบอทเข้ากลุ่ม LINE และมีคนพิมพ์ข้อความ 1 ครั้ง (ต้อง deploy webhook ก่อน)'],
    ['message_format', 'text', 'รูปแบบข้อความเช้า: text หรือ flex'],
    ['leave_database_id', 'your_leave_database_id', 'Database ID ของ "ใบลา" ใน Notion (ระบบลางาน)'],
    ['leave_system_enabled', 'TRUE', 'สวิตช์ระบบลา: FALSE = ปิดรับลงทะเบียน/ยื่นลาใหม่ (ใช้เมนู "เปิด/ปิดระบบลา" สลับให้ได้) — ค่าอื่นใด/แถวหาย = เปิด'],
    ['leave_closed_message', '', 'ข้อความที่แสดงตอนระบบลาถูกปิด (เว้นว่าง = ใช้ข้อความมาตรฐาน เช่น ระบุช่วงเวลาปิดและผู้ติดต่อได้)'],
    ['second_approvers', '', 'หัวหน้า สสอ. — รายชื่อ "ชื่อ สกุล" ของผู้อนุมัติขั้นสอง คั่นด้วยจุลภาค (ต้องลงทะเบียนในระบบแล้ว)'],
    ['prefix_options', 'นาย,นาง,นางสาว,อื่นๆ', 'ตัวเลือกคำนำหน้าชื่อในฟอร์มลงทะเบียน (คั่นด้วยจุลภาค — มี "อื่นๆ" = เปิดช่องพิมพ์เอง)'],
    ['position_options', 'นักวิชาการสาธารณสุข,นักวิชาการอนามัย,นักวิชาการคอมพิวเตอร์,นักบริหารงานสาธารณสุข,พยาบาลวิชาชีพ,พยาบาลช่วยแพทย์,เจ้าพนักงานธุรการ,ลูกจ้างชั่วคราว,อื่นๆ', 'ตัวเลือกตำแหน่งในฟอร์มลงทะเบียน (แก้ให้ตรงหน่วยงานได้เลย คั่นด้วยจุลภาค)'],
  ].forEach(row => {
    if (upsertSettingRow_(row[0], row[1], row[2])) addedKeys.push(row[0]);
  });

  const summary =
    'ผลการตรวจสอบชีต:\n' + status.join('\n') + '\n\n' +
    (addedKeys.length
      ? 'เติมค่าตั้งต้นใน Settings เพิ่ม: ' + addedKeys.join(', ') + '\n\n'
      : 'ค่าใน Settings ครบอยู่แล้ว (ไม่แตะของเดิม)\n\n') +
    'สิ่งที่ต้องทำต่อ (ครั้งแรกเท่านั้น):\n' +
    '1. วาง Database ID ของ "ปฏิทินการปฏิบัติงาน" ในแถว notion_database_id\n' +
    '2. สร้าง database "ใบลา" ใน Notion แล้ววาง ID ในแถว leave_database_id (สเปกใน SETUP.md ข้อ 11.2)\n' +
    '3. กรอกชีต Approvers: กลุ่มงาน | ผู้อนุมัติ (ชื่อ สกุล) | ส่งต่อให้ หัวหน้า สสอ. (TRUE ถ้าต้องส่งต่อ)\n' +
    '4. ใส่รายชื่อ หัวหน้า สสอ. ในแถว second_approvers ของชีต Settings (ถ้ามีกลุ่มงานที่ส่งต่อ)\n' +
    '5. ใส่วันหยุดในชีต Holidays (ตรวจกับประกาศทางการ)\n' +
    '6. ตั้งค่า Secret ใน Script Properties แล้ว deploy ตาม SETUP.md\n' +
    '(ชีต Staff ไม่ต้องกรอก — เพิ่มอัตโนมัติเมื่อเจ้าหน้าที่ลงทะเบียนผ่านฟอร์มเอง)';
  // ถ้ารันจากเมนูในชีต → เด้ง popup แต่ถ้ารันจากปุ่ม Run ใน editor (ไม่มี UI) → log แทน
  // แบบเดียวกับ runUnitTests ใน Tests.gs (งานจริงทำเสร็จก่อนถึงตรงนี้เสมอ จึงไม่ใช่จุดพังของข้อมูล)
  try {
    SpreadsheetApp.getUi().alert('เตรียมสเปรดชีตเรียบร้อย', summary, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    console.log(summary);
  }
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
    // ปุ่มทดสอบนี้ส่งข้อความเสมอแม้วันนี้ไม่มีงาน/ผู้ลา เพื่อยืนยันว่าต่อ LINE สำเร็จจริง
    // ต่างจากตอนรันจริงตอนเช้า ซึ่งถ้าไม่มีงานและไม่มีผู้ลาเลยจะไม่ส่งข้อความ
    const messageObj = items.length === 0 && leaves.length === 0
      ? { type: 'text', text: '🧪 ข้อความทดสอบ — เชื่อมต่อ LINE และ Notion สำเร็จ\n\n(วันนี้ไม่มีงานในระบบ ถ้าเป็นการรันจริงตอนเช้า ระบบจะไม่ส่งข้อความในกรณีนี้)' }
      : buildLineMessage_(now, items, leaves, settings.message_format);
    sendLineMessage_(settings.line_group_id, messageObj);
    logResult_(now, 'success (manual test)', messagePreview_(messageObj).substring(0, 300));
    SpreadsheetApp.getUi().alert('ส่งข้อความทดสอบแล้ว ลองเช็คในกลุ่ม LINE');
  } catch (err) {
    logResult_(new Date(), 'error (manual test)', String(err));
    SpreadsheetApp.getUi().alert('ทดสอบส่งไม่สำเร็จ: ' + err);
  }
}

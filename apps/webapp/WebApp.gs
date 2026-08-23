/**
 * เว็บแอปหน้าตั้งค่าแยกต่างหาก (มี URL ของตัวเอง) สำหรับระบบแจ้งเตือนปฏิทิน
 *
 * ทำไมต้องเป็นโปรเจกต์ Apps Script "แยก" จากตัวที่ผูกกับชีต (โปรเจกต์หลักใน apps/main)
 * ไม่รวมไว้ในโปรเจกต์เดียวกัน:
 * - Webhook.gs ต้อง deploy แบบ "Who has access: Anyone" (ให้ LINE server ที่ไม่ได้ login ยิงเข้ามาได้)
 * - ถ้า doGet() ของหน้าตั้งค่านี้อยู่โปรเจกต์เดียวกัน การ deploy จะแชร์ระดับสิทธิ์เดียวกันทั้งโปรเจกต์
 *   (doGet/doPost เป็น entry point ระดับโปรเจกต์ ไม่ใช่ระดับ deployment) เท่ากับใครก็เปิดหน้าตั้งค่านี้ได้
 *   โดยไม่ต้อง login เลย ซึ่งไม่ควรเกิดกับหน้าที่แก้ค่าระบบได้
 * - แยกโปรเจกต์ทำให้หน้านี้ deploy แบบจำกัดสิทธิ์ได้อิสระ โดยไม่กระทบ Webhook
 *
 * สำคัญ: deployment ของหน้านี้ต้องตั้ง "Execute as: User accessing the web app"
 * (ไม่ใช่ "Execute as: Me") — เอกสารทางการของ Google ระบุตรงๆ ว่า Session.getActiveUser().getEmail()
 * จะได้ค่าว่างเปล่าสำหรับเว็บแอปที่ deploy แบบ "execute as me" (เว้นแต่ผู้เข้าชมอยู่ Google Workspace
 * domain เดียวกับเจ้าของสคริปต์) ถ้าตั้งผิดเป็น "Me" ฟังก์ชัน isAllowedEditor_() ด้านล่างจะเช็คอีเมลว่าง
 * เทียบกับ ALLOWED_EDITORS ตลอด ทำให้ไม่มีใครผ่านเงื่อนไขได้เลย รวมถึงเจ้าของระบบเอง
 * ผลตามมาของการตั้งเป็น "User accessing the web app": สคริปต์จะทำงานภายใต้สิทธิ์ของคนที่กำลังเข้าเว็บ
 * ไม่ใช่สิทธิ์ของเจ้าของสคริปต์ ดังนั้นทุกคนใน ALLOWED_EDITORS ต้องได้รับสิทธิ์ Editor บนสเปรดชีตหลัก
 * โดยตรงด้วย (แชร์ชีตให้แต่ละคน) ไม่งั้น SpreadsheetApp.openById จะเปิดไม่ได้ ดูขั้นตอนเต็มใน SETUP.md
 *
 * ผลที่ตามมาอีกข้อ: โปรเจกต์นี้ไม่ได้ผูกกับสเปรดชีตโดยตรง (ต้องระบุ SPREADSHEET_ID เอง)
 * และไม่มี LINE_CHANNEL_ACCESS_TOKEN อยู่ใน Script Properties ของโปรเจกต์นี้ (ตั้งใจไม่ให้มี
 * เพื่อลดจุดที่ secret รั่วได้ถ้าหน้านี้มีช่องโหว่) หน้านี้จึงจัดการได้แค่ Settings/Holidays/Logs
 * ส่วน "ทดสอบส่งจริง" ยังคงทำผ่านเมนูในชีต (testSendNow ใน Config.gs ของโปรเจกต์หลัก) เท่านั้น
 */

const SPREADSHEET_ID = '1c4SI6mF1B-qymkIPtdQNprR6cxa4PlWeL5fcjzH_0Kg'; // เอาจาก URL ของชีต ส่วนระหว่าง /d/ กับ /edit

function doGet(e) {
  const email = Session.getActiveUser().getEmail();
  // กันช่องโหว่กรณีไฟล์นี้ไปปนในโปรเจกต์เดียวกับ webhook (ซึ่ง deploy แบบ "execute as: Me + Anyone"):
  // ผู้เข้าชมแบบไม่ login จะได้อีเมลว่างเสมอ และถ้า ALLOWED_EDITORS ยังไม่ได้ตั้งค่า isAllowedEditor_
  // จะปล่อยผ่านทุกคน (= ใครมี URL ก็แก้ Settings/ลบวันหยุดได้) จึงตัดทันทีที่ไม่มีอีเมล
  // หน้าตั้งค่าใช้ได้เฉพาะจากโปรเจกต์แยกตาม SETUP.md ข้อ 10 (deploy แบบ execute as user เท่านั้น)
  if (!email) {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;padding:60px 24px;text-align:center;color:#B3261E">' +
      '<p style="font-size:16px;font-weight:600">หน้าตั้งค่าไม่สามารถใช้จาก deployment นี้ได้</p>' +
      '<p style="font-size:13px;color:#666">deployment นี้ใช้สำหรับ webhook ของ LINE และระบบลางานเท่านั้น — ' +
      'แก้ไขการตั้งค่าได้ที่ Google Sheet โดยตรง หรือใช้หน้าเว็บตั้งค่าจากโปรเจกต์แยกตาม SETUP.md ข้อ 10</p></div>'
    );
  }
  if (!isAllowedEditor_(email)) {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;padding:60px 24px;text-align:center;color:#B3261E">' +
      '<p style="font-size:16px;font-weight:600">ไม่มีสิทธิ์เข้าถึงหน้านี้</p>' +
      '<p style="font-size:13px;color:#666">ติดต่อผู้ดูแลระบบให้เพิ่มอีเมลนี้ใน ALLOWED_EDITORS: ' +
      (email || '(ไม่พบอีเมล — เช็คว่า deployment ตั้ง Execute as เป็น "User accessing the web app" หรือยัง)') + '</p></div>'
    );
  }
  if (SPREADSHEET_ID.indexOf('ใส่ Spreadsheet ID') === 0) {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;padding:60px 24px;text-align:center;color:#B3261E">' +
      '<p style="font-size:16px;font-weight:600">ยังไม่ได้ตั้งค่า SPREADSHEET_ID</p>' +
      '<p style="font-size:13px;color:#666">แก้ค่าคงที่ SPREADSHEET_ID ที่บรรทัดบนสุดของ WebApp.gs ให้เป็น ID จริงของสเปรดชีตก่อน</p></div>'
    );
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('ระบบแจ้งเตือนปฏิทิน')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ว่าง (ยังไม่ตั้ง ALLOWED_EDITORS) = ยังไม่ล็อกสิทธิ์ ใครมี Google account ที่ deployment อนุญาตก็เข้าได้
// แนะนำให้ตั้งค่านี้ทันทีหลัง deploy ครั้งแรก ผ่าน Project Settings > Script Properties
function isAllowedEditor_(email) {
  const allowList = PropertiesService.getScriptProperties().getProperty('ALLOWED_EDITORS') || '';
  if (!allowList.trim()) return true;
  const allowed = allowList.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(String(email).toLowerCase());
}

function getSheet_(name) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('ไม่พบชีตชื่อ ' + name + ' — เช็ค SPREADSHEET_ID ว่าถูกต้อง');
  return sheet;
}

function formatCell_(cell) {
  if (!cell) return '';
  return cell instanceof Date
    ? Utilities.formatDate(cell, 'Asia/Bangkok', 'yyyy-MM-dd')
    : String(cell).trim();
}

// ---------- Settings ----------

function normalizeNotifyTime_(value) {
  const text = String(value == null ? '' : value).trim();
  const match = text.match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d(?:\.\d{1,3})?)?$/);
  if (!match || Number(match[1]) > 23) return text;
  return String(Number(match[1])).padStart(2, '0') + ':' + match[2];
}

function api_getSettings() {
  const sheet = getSheet_('Settings');
  const lastRow = sheet.getLastRow();
  // google.script.run cannot send Date objects back to the browser. A time-formatted
  // notify_time cell is returned by getValues() as a Date, so read display strings.
  const data = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, 2).getDisplayValues() : [];
  const settings = {};
  data.forEach(([key, value]) => {
    const normalizedKey = String(key).trim();
    if (!normalizedKey) return;
    settings[normalizedKey] = normalizedKey === 'notify_time'
      ? normalizeNotifyTime_(value)
      : String(value).trim();
  });
  return settings;
}

function validateSettings_(s) {
  const errors = [];
  if (s.enabled !== undefined && !['TRUE', 'FALSE'].includes(String(s.enabled).toUpperCase())) {
    errors.push('enabled ต้องเป็น TRUE หรือ FALSE');
  }
  if (s.notify_time !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(s.notify_time).trim())) {
    errors.push('เวลาแจ้งเตือนต้องเป็นรูปแบบ HH:mm เช่น 08:30');
  }
  if (s.message_format !== undefined && !['text', 'flex'].includes(String(s.message_format).toLowerCase())) {
    errors.push('รูปแบบข้อความต้องเป็น text หรือ flex');
  }
  if (s.notion_database_id !== undefined && !String(s.notion_database_id).trim()) {
    errors.push('Notion Database ID ห้ามว่าง');
  }
  return errors;
}

function api_saveSettings(newSettings) {
  const errors = validateSettings_(newSettings);
  if (errors.length) return { ok: false, errors };

  const sheet = getSheet_('Settings');
  const lastRow = sheet.getLastRow();
  const data = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, 1).getValues() : [];
  data.forEach(([key], i) => {
    const k = String(key).trim();
    if (Object.prototype.hasOwnProperty.call(newSettings, k)) {
      sheet.getRange(3 + i, 2).setValue(newSettings[k]);
    }
  });
  return { ok: true };
}

// ---------- Holidays ----------

function api_getHolidays() {
  const sheet = getSheet_('Holidays');
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return [];
  const data = sheet.getRange(3, 1, lastRow - 2, 3).getValues();
  return data
    .map((row, i) => ({ row: 3 + i, date: formatCell_(row[0]), name: row[1], type: row[2] }))
    .filter(h => h.date);
}

function api_addHoliday(date, name, type) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date).trim())) {
    return { ok: false, error: 'วันที่ต้องเป็นรูปแบบ yyyy-MM-dd' };
  }
  if (!String(name).trim()) {
    return { ok: false, error: 'กรุณาใส่ชื่อวันหยุด' };
  }
  const allowedTypes = ['ราชการปกติ', 'ชดเชย', 'กรณีพิเศษ'];
  const safeType = allowedTypes.includes(type) ? type : 'ราชการปกติ';
  const sheet = getSheet_('Holidays');
  sheet.appendRow([String(date).trim(), String(name).trim(), safeType]);
  return { ok: true };
}

function api_deleteHoliday(rowNumber) {
  const row = Number(rowNumber);
  if (!row || row < 3) return { ok: false, error: 'แถวไม่ถูกต้อง' };
  const sheet = getSheet_('Holidays');
  sheet.deleteRow(row);
  return { ok: true };
}

// ---------- Logs (อ่านอย่างเดียว) ----------

function api_getLogs(limit) {
  const sheet = getSheet_('Logs');
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return [];
  const n = Math.min(limit || 30, lastRow - 2);
  const startRow = lastRow - n + 1;
  const data = sheet.getRange(startRow, 1, n, 4).getValues();
  return data.reverse().map(row => ({
    timestamp: row[0] instanceof Date ? Utilities.formatDate(row[0], 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss') : String(row[0]),
    date: formatCell_(row[1]),
    status: String(row[2]),
    detail: String(row[3]),
  }));
}

// ---------- รายงานวันลา (แท็บ "รายงานวันลา" — อ่านใบลาจาก Notion ด้วย token แบบอ่านอย่างเดียว) ----------
//
// โปรเจกต์นี้ไม่เก็บ LINE token ตามเหตุผลที่ header ของไฟล์อธิบายไว้ แต่แท็บรายงานต้องอ่านใบลาจาก
// Notion จึงใช้ token ของ integration "แยกต่างหาก" ที่ตั้ง capability เป็นอ่านอย่างเดียว (read content
// only) เท่านั้น — แม้หน้านี้จะมีช่องโหว่ในอนาคต ผู้ไม่ประสงค์ดีก็แอบมา "อ่าน" ได้แค่ใบลา
// แก้/ส่งข้อความแทนใครไม่ได้ ตั้งค่าที่ Script Properties คีย์ NOTION_TOKEN_READONLY (ดู SETUP.md §10)

// subset ของชื่อ property ที่รายงานใช้ (ชื่อเดียวกับ PROPS_LEAVE ใน Leave.gs — คัดเฉพาะที่ต้องอ่าน)
const REPORT_PROPS = {
  title: 'ผู้ลา',
  groupName: 'กลุ่มงาน',
  submitter: 'ผู้ยื่น (ระบบ)',
  type: 'ประเภทการลา',
  date: 'วันที่ลา',
  status: 'สถานะ',
  workDays: 'จำนวนวันทำการ',
};
const REPORT_LEAVE_STATUS_APPROVED = 'อนุมัติ';
const REPORT_NOTION_VERSION = '2025-09-03';
const REPORT_THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

function notionHeadersReadOnly_() {
  const token = PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN_READONLY');
  if (!token) {
    throw new Error('ยังไม่ได้ตั้งค่า NOTION_TOKEN_READONLY ใน Script Properties ของโปรเจกต์นี้ — สร้าง Notion integration แบบอ่านอย่างเดียวแล้ววาง token ตาม SETUP.md หัวข้อ 10');
  }
  return { Authorization: 'Bearer ' + token, 'Notion-Version': REPORT_NOTION_VERSION };
}

// resolve data source เหมือน resolveDataSourceId_ ใน Notion.gs (โปรเจกต์หลัก) แต่ใช้ token อ่านอย่างเดียวของโปรเจกต์นี้
function resolveReportDataSourceId_(databaseId) {
  if (!databaseId || String(databaseId).trim() === 'your_leave_database_id') {
    throw new Error('ยังไม่ได้ตั้งค่า leave_database_id ในชีต Settings');
  }
  const response = UrlFetchApp.fetch('https://api.notion.com/v1/databases/' + databaseId, {
    method: 'get',
    headers: notionHeadersReadOnly_(),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() >= 300) {
    throw new Error('เปิด Notion database "ใบลา" ไม่ได้ (' + response.getResponseCode() + '): ' +
      response.getContentText().substring(0, 200));
  }
  const data = JSON.parse(response.getContentText());
  if (!data.data_sources || !data.data_sources.length) {
    throw new Error('database ใบลาไม่มี data source ที่เข้าถึงได้ — เช็คว่าแชร์ database ให้ integration แบบอ่านอย่างเดียวแล้วหรือยัง (Connections ในเมนู "...")');
  }
  return data.data_sources[0].id;
}

// query วนตาม next_cursor เหมือน queryNotionPages_ ใน Notion.gs (โปรเจกต์หลัก) (เผื่อเดือนที่มีใบลาเกิน 100 ใบ)
function queryReportNotionPages_(dataSourceId, payload, maxPages) {
  const limit = maxPages || 3;
  const results = [];
  let cursor = null;
  for (let i = 0; i < limit; i++) {
    const queryPayload = cursor ? Object.assign({}, payload, { start_cursor: cursor }) : payload;
    const response = UrlFetchApp.fetch('https://api.notion.com/v1/data_sources/' + dataSourceId + '/query', {
      method: 'post',
      contentType: 'application/json',
      headers: notionHeadersReadOnly_(),
      payload: JSON.stringify(queryPayload),
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() >= 300) {
      throw new Error('ดึงใบลาจาก Notion ไม่สำเร็จ (' + response.getResponseCode() + '): ' +
        response.getContentText().substring(0, 200));
    }
    const data = JSON.parse(response.getContentText());
    results.push.apply(results, data.results || []);
    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }
  return results;
}

function plainReportText_(richTextArray) {
  return (richTextArray || []).map(t => t.plain_text).join('').trim();
}

// slim ของ parseLeavePage_ ใน LeaveApproval.gs (โปรเจกต์หลัก) — เอาเฉพาะฟิลด์ที่รายงานใช้
function parseReportLeavePage_(page) {
  const props = (page && page.properties) || {};
  const dateProp = (props[REPORT_PROPS.date] && props[REPORT_PROPS.date].date) || {};
  return {
    fullName: plainReportText_(props[REPORT_PROPS.title] && props[REPORT_PROPS.title].title),
    groupName: plainReportText_(props[REPORT_PROPS.groupName] && props[REPORT_PROPS.groupName].rich_text),
    submitterUserId: plainReportText_(props[REPORT_PROPS.submitter] && props[REPORT_PROPS.submitter].rich_text),
    leaveType: ((props[REPORT_PROPS.type] && props[REPORT_PROPS.type].select) || {}).name || '',
    start: dateProp.start || '',
    workDays: (props[REPORT_PROPS.workDays] && props[REPORT_PROPS.workDays].number) || 0,
  };
}

// ทำเนียบ Staff แบบลีบ (เฉพาะชื่อเต็ม/กลุ่มงาน/userId) — แถวไม่มีชื่อหรือสกุลไม่นับ ตาม readStaffRoster_
function readReportStaff_() {
  const sheet = getSheet_('Staff');
  const lastRow = sheet.getLastRow();
  const data = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, 8).getDisplayValues() : [];
  return data
    .filter(row => String(row[1]).trim() && String(row[2]).trim())
    .map(row => ({
      name: [String(row[0]).trim(), String(row[1]).trim(), String(row[2]).trim()].filter(Boolean).join(' '),
      group: String(row[3]).trim(),
      lineUserId: String(row[5]).trim(),
    }));
}

/** ตารางสรุปวันลา "อนุมัติแล้ว" รายคน×ประเภท ตามปี (+เดือนถ้าเลือก) — นับตามวันเริ่มของใบ
 *  ให้ตรงแนวคิดโควตา/สรุปรายเดือนในระบบหลัก (ใบคร่อมเดือนนับเดือนที่เริ่ม)
 *  year เป็น ค.ศ. — หน้าเว็บแปลงปี พ.ศ. ให้ตอนแสดงผล และส่งกลับมาเป็น ค.ศ.
 *  คืน { ok, year, month, monthLabel, types, rows, columnTotals, grandTotal } */
function api_getLeaveReport(year, month) {
  try {
    const yearNum = Number(year) || Number(Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy'));
    const monthStr = String(month || '').trim(); // '' = ทั้งปี หรือ 'YYYY-MM'
    if (monthStr && !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthStr)) {
      return { ok: false, error: 'รูปแบบเดือนไม่ถูกต้อง (YYYY-MM)' };
    }

    const settings = api_getSettings();
    const dbId = String(settings.leave_database_id || '').trim();
    if (!dbId || dbId === 'your_leave_database_id') {
      return { ok: false, error: 'ยังไม่ได้ตั้งค่า leave_database_id ในชีต Settings' };
    }

    // หน้าต่างช่วงเวลา: ปี หรือ เดือนเดียว [from, to)
    let from;
    let to;
    let monthLabel;
    if (monthStr) {
      const parts = monthStr.split('-').map(Number);
      from = monthStr + '-01';
      to = parts[1] === 12 ? (parts[0] + 1) + '-01-01' : parts[0] + '-' + String(parts[1] + 1).padStart(2, '0') + '-01';
      monthLabel = REPORT_THAI_MONTHS[parts[1] - 1] + ' ' + (parts[0] + 543);
    } else {
      from = yearNum + '-01-01';
      to = (yearNum + 1) + '-01-01';
      monthLabel = 'ปี ' + (yearNum + 543);
    }

    const payload = {
      filter: {
        and: [
          { property: REPORT_PROPS.status, select: { equals: REPORT_LEAVE_STATUS_APPROVED } },
          { property: REPORT_PROPS.date, date: { on_or_after: from + 'T00:00:00+07:00' } },
          { property: REPORT_PROPS.date, date: { before: to + 'T00:00:00+07:00' } },
        ],
      },
      page_size: 100,
    };
    const leaves = queryReportNotionPages_(resolveReportDataSourceId_(dbId), payload)
      .map(parseReportLeavePage_)
      .filter(leave => leave.leaveType);

    // รวมยอดตามคน คีย์ด้วย LINE userId (ใบเก่าไม่มี userId คีย์ด้วยชื่อเต็มแทน)
    const byKey = {};
    leaves.forEach(leave => {
      const key = leave.submitterUserId || 'name:' + leave.fullName;
      if (!byKey[key]) byKey[key] = { name: leave.fullName, group: leave.groupName, byType: {}, total: 0 };
      byKey[key].byType[leave.leaveType] = (byKey[key].byType[leave.leaveType] || 0) + (leave.workDays || 0);
      byKey[key].total += leave.workDays || 0;
    });

    // คอลัมน์ประเภท: เรียงตามลำดับมาตรฐานของระบบก่อน แล้วประเภทพิเศษตามตัวอักษรไทย
    const standardOrder = ['ลาป่วย', 'ลากิจ', 'ลาพักร้อน', 'ลาคลอด', 'ลาอุปสมบถ/ลาบวช', 'ลาช่วยเหลือภริยาคลอดบุตร', 'อื่นๆ'];
    const found = {};
    leaves.forEach(leave => { found[leave.leaveType] = true; });
    const types = standardOrder.filter(t => found[t]);
    Object.keys(found).sort((a, b) => a.localeCompare(b, 'th')).forEach(t => {
      if (!types.includes(t)) types.push(t);
    });

    // แถว = ทุกคนในทำเนียบ (ยอด 0 ก็แสดง เห็นว่าใครยังไม่ได้ใช้) เรียงชื่อ + ใบเก่านอกทำเนียบผนวกท้าย
    const staff = readReportStaff_();
    const makeRow = function (name, group, bucket) {
      return {
        name: name,
        group: group,
        cells: types.map(t => (bucket && bucket.byType[t]) || 0),
        total: bucket ? bucket.total : 0,
      };
    };
    const rows = staff
      .map(s => makeRow(s.name, s.group, byKey[s.lineUserId]))
      .sort((a, b) => a.name.localeCompare(b.name, 'th'));
    Object.keys(byKey).forEach(key => {
      const known = key.indexOf('name:') !== 0 && staff.some(s => s.lineUserId === key);
      if (!known) rows.push(makeRow(byKey[key].name + ' (นอกทำเนียบ)', byKey[key].group, byKey[key]));
    });

    const columnTotals = types.map((t, i) =>
      rows.reduce((sum, row) => sum + (row.cells[i] || 0), 0));
    const grandTotal = rows.reduce((sum, row) => sum + (row.total || 0), 0);

    return {
      ok: true,
      year: String(yearNum),
      month: monthStr,
      monthLabel: monthLabel,
      types: types,
      rows: rows,
      columnTotals: columnTotals,
      grandTotal: grandTotal,
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

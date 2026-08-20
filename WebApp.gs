/**
 * เว็บแอปหน้าตั้งค่าแยกต่างหาก (มี URL ของตัวเอง) สำหรับระบบแจ้งเตือนปฏิทิน
 *
 * ทำไมต้องเป็นโปรเจกต์ Apps Script "แยก" จากตัวที่ผูกกับชีต (Code.gs / Webhook.gs)
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
 * ส่วน "ทดสอบส่งจริง" ยังคงทำผ่านเมนูในชีต (testSendNow ใน Code.gs) เท่านั้น
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

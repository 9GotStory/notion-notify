/**
 * JSON API ของหน้าตั้งค่าผู้ดูแล — UI อยู่บน GitHub Pages (web/admin/) เรียกผ่าน fetch
 *
 * โมเดล: deployment นี้เป็น API ล้วน deploy แบบ "Execute as: Me + Anyone (anonymous)"
 * ทุกคำขอต้องมี token ตรงกับ Script Property ADMIN_TOKEN (fail-closed — ยังไม่ตั้ง = ปฏิเสธทุกคำขอ)
 * เรียกแบบ GET + query params เท่านั้น (ตามข้อจำกัด redirect 302 ของ /exec — ดูคอมเมนต์ใน Webhook.gs โปรเจกต์หลัก)
 * เปิด URL นี้ด้วย browser เอง (ไม่มี apiAction) =  meta-refresh ไปหน้า admin บน GitHub Pages
 *
 * ทำไมต้องเป็นโปรเจกต์แยกจากโปรเจกต์หลัก: doGet/doPost เป็น entry point ระดับโปรเจกต์ การแยกไว้ทำให้
 * webhook หลัก (ต้อง anonymous ให้ LINE ยิงเข้า) กับ API นี้ (มี token คุมทุกคำขอ) แยกระดับ deployment กันได้
 * โปรเจกต์นี้ไม่มี LINE_CHANNEL_ACCESS_TOKEN (ตั้งใจ — แม้ ADMIN_TOKEN รั่ว เสียเพียงสิทธิ์แก้ชีต config)
 */

const SPREADSHEET_ID = '1c4SI6mF1B-qymkIPtdQNprR6cxa4PlWeL5fcjzH_0Kg'; // เอาจาก URL ของชีต ส่วนระหว่าง /d/ กับ /edit
const ADMIN_PAGE_URL = 'https://9gotstory.github.io/notion-notify/web/admin/';
const MAX_JSON_PARAM_LENGTH = 5000; // กัน URL ยาวเกินที่ /exec รับได้ (~8KB) — payload จริง (settings/approvers) < 2KB

// ---------- Router ----------

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.apiAction) {
    const result = handleAdminApiRequest_(params);
    // JSONP สำรองกรณี CORS โดนบล็อก — รูปแบบเดียวกับ Webhook.gs ของโปรเจกต์หลัก
    if (params.callback && /^[A-Za-z0-9_.]{1,64}$/.test(params.callback)) {
      return ContentService
        .createTextOutput(params.callback + '(' + JSON.stringify(result) + ');')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return jsonOutput_(result);
  }
  // เปิดด้วย browser เอง — หน้า UI ย้ายไป GitHub Pages แล้ว พาตามไป (ลิงก์ที่คน bookmark ไว้ไม่ตาย)
  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">' +
    '<meta http-equiv="refresh" content="0; url=' + ADMIN_PAGE_URL + '">' +
    '<title>ระบบแจ้งเตือนปฏิทิน — หน้าตั้งค่า</title></head>' +
    '<body style="font-family:sans-serif;padding:48px 24px;text-align:center;color:#333;line-height:1.8">' +
    '<p style="font-size:16px;font-weight:600">หน้าตั้งค่าย้ายไปที่ใหม่แล้ว — กำลังพาไป</p>' +
    '<p style="font-size:14px"><a href="' + ADMIN_PAGE_URL + '" style="color:#0F6E56">' + ADMIN_PAGE_URL + '</a></p>' +
    '<p style="font-size:12px;color:#999">URL นี้เป็น endpoint ของ API (เรียกพร้อม apiAction + token)</p>' +
    '</body></html>'
  );
}

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ตรวจ token ทุกคำขอ — fail-closed ทุกกรณี (คืน error object ถ้าไม่ผ่าน, null ถ้าผ่าน)
function requireAdminToken_(params) {
  const expected = String(PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN') || '').trim();
  if (!expected) {
    return {
      ok: false, code: 'UNCONFIGURED',
      error: 'ยังไม่ได้ตั้ง ADMIN_TOKEN — เปิดโปรเจกต์ Apps Script นี้ > Project Settings > Script Properties > เพิ่มคีย์ ADMIN_TOKEN (32 ตัวอักษร) แล้วลองใหม่',
    };
  }
  const given = String(params.token || '');
  if (given.length !== expected.length || given !== expected) {
    return { ok: false, code: 'UNAUTHORIZED', error: 'token ไม่ถูกต้อง — ตรวจอีกครั้ง หรือติดต่อผู้ดูแลระบบ' };
  }
  return null;
}

// แปลง param ที่เป็น JSON string (object/array ผ่าน GET ได้) — throw เป็นข้อความไทยให้ router ครอบเป็น {ok:false}
function parseJsonParam_(raw, shape) {
  const text = String(raw || '');
  if (!text) throw new Error('ขาดข้อมูล (พารามิเตอร์ data)');
  if (text.length > MAX_JSON_PARAM_LENGTH) throw new Error('ข้อมูลยาวเกินกำหนด');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error('รูปแบบข้อมูล (JSON) ไม่ถูกต้อง');
  }
  if (shape === 'array' && !Array.isArray(parsed)) throw new Error('ต้องส่งข้อมูลเป็นรายการ (array)');
  if (shape === 'object' && (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null)) {
    throw new Error('ต้องส่งข้อมูลเป็น object');
  }
  return parsed;
}

// api_get* แบบหลายฟิลด์ (balances/quota_profiles) เดิมไม่มี ok เพราะ google.script.run แยก success/failure เอง
// — ตอนเป็น JSON API ต้องมี ok ทุก response จึงห่อให้ตรงนี้
function withOk_(result) {
  return Object.assign({ ok: true }, result || {});
}

// แผนที่ action → adapter: แปลง query params (string ทั้งหมด) เป็น signature เดิมของ api_*
// (api_ เดิมไม่แตะเลย — เป็นจุดเดียวที่รู้เรื่อง HTTP)
const ADMIN_API = {
  get_overview: () => api_getOverview_(),
  get_settings: () => withOk_({ settings: api_getSettings() }),
  // validateSettings_ ตอบ {ok:false, errors:[...]} — พับเป็น error เดียวให้ client แสดงตรงๆ
  save_settings: p => {
    const r = api_saveSettings(parseJsonParam_(p.data, 'object'));
    return r.ok ? r : { ok: false, error: (r.errors || []).join(' · ') || 'บันทึกไม่สำเร็จ' };
  },
  get_holidays: () => withOk_({ holidays: api_getHolidays() }),
  add_holiday: p => api_addHoliday(p.date, p.name, p.type),
  delete_holiday: p => api_deleteHoliday(p.row),
  get_logs: p => withOk_({ logs: api_getLogs(p.limit) }),
  get_leave_report: p => api_getLeaveReport(p.year, p.month),
  get_balances: () => withOk_(api_getBalances()),
  add_balance: p => api_addBalance(p.yearBE, p.name, p.leaveType, p.carryIn, p.usedExtra, p.reason),
  update_balance: p => api_updateBalance(p.row, p.yearBE, p.name, p.leaveType, p.carryIn, p.usedExtra, p.reason),
  delete_balance: p => api_deleteBalance(p.row),
  get_quota_profiles: () => withOk_(api_getQuotaProfiles()),
  add_quota_profile: p => api_addQuotaProfile(p.yearBE, p.employmentType, p.leaveType, p.quota, p.note),
  update_quota_profile: p => api_updateQuotaProfile(p.row, p.yearBE, p.employmentType, p.leaveType, p.quota, p.note),
  delete_quota_profile: p => api_deleteQuotaProfile(p.row),
  set_staff_employment_type: p => api_setStaffEmploymentType(p.staffKey, p.employmentType),
  get_approvers: () => api_getApprovers_(),
  save_approvers: p => api_saveApprovers_(parseJsonParam_(p.data, 'array')),
};

function handleAdminApiRequest_(params) {
  if (SPREADSHEET_ID.indexOf('ใส่ Spreadsheet ID') === 0) {
    return { ok: false, error: 'ยังไม่ได้ตั้งค่า SPREADSHEET_ID ใน WebApp.gs' };
  }
  const authError = requireAdminToken_(params);
  if (authError) return authError;
  const handler = ADMIN_API[params.apiAction];
  if (!handler) return { ok: false, error: 'ไม่รู้จัก action: ' + params.apiAction };
  try {
    return handler(params);
  } catch (err) {
    // ทุก exception ฝั่งเซิร์ฟเวอร์กลายเป็น {ok:false,error} — กัน client ได้ HTML error page ของ Apps Script แทน JSON
    return { ok: false, error: (err && err.message) ? err.message : String(err) };
  }
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

// ทำเนียบ Staff แบบลีบ (เฉพาะชื่อเต็ม/กลุ่มงาน/userId + "ชื่อ สกุล" สำหรับจับคู่กับสมุดยอดวันลา)
// แถวไม่มีชื่อหรือสกุลไม่นับ ตาม readStaffRoster_ ของโปรเจกต์หลัก
function readReportStaff_() {
  const sheet = getSheet_('Staff');
  const lastRow = sheet.getLastRow();
  const data = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, 9).getDisplayValues() : [];
  return data
    .filter(row => String(row[1]).trim() && String(row[2]).trim())
    .map(row => ({
      name: [String(row[0]).trim(), String(row[1]).trim(), String(row[2]).trim()].filter(Boolean).join(' '),
      key: (String(row[1]).trim() + ' ' + String(row[2]).trim()).replace(/\s+/g, ' '),
      group: String(row[3]).trim(),
      lineUserId: String(row[5]).trim(),
      employmentType: String(row[8] || '').trim(),
    }));
}

// ---------- สมุดรายการปรับยอดวันลา (แท็บ "ยอดวันลา") ----------
// โครงสร้างคอลัมน์ตรงกับ BALANCE_SHEET_COLUMNS ของโปรเจกต์หลัก: ปี (พ.ศ.) | ชื่อ สกุล | ประเภทการลา
// | ยกมา (วันทำการ) | ใช้เพิ่ม (วันทำการ) | เหตุผล | บันทึกเมื่อ
// ความหมาย: "ยกมา" เพิ่มเข้าสิทธิ์ของปีนั้น (เช่น พักร้อนสะสม) / "ใช้เพิ่ม" เพิ่มเข้ายอดใช้ (เช่น ลาก่อนมีระบบ)

function validateBalanceInput_(yearBE, name, leaveType, carryIn, usedExtra) {
  if (!/^(25|26)\d{2}$/.test(String(yearBE || '').trim())) return 'ปี (พ.ศ.) ต้องเป็น 4 หลัก เช่น 2569';
  if (!String(name || '').trim()) return 'กรุณาเลือกชื่อ สกุล';
  if (!String(leaveType || '').trim()) return 'กรุณาเลือกประเภทการลา';
  const carry = Number(String(carryIn || '').trim()) || 0;
  const extra = Number(String(usedExtra || '').trim()) || 0;
  if (carry < 0 || extra < 0) return 'ตัวเลขต้องไม่ติดลบ';
  if (carry === 0 && extra === 0) return 'กรอก "ยกมา" หรือ "ใช้เพิ่ม" อย่างน้อยหนึ่งค่า (> 0)';
  return null;
}

function balanceRowValues_(yearBE, name, leaveType, carryIn, usedExtra, reason) {
  return [
    String(yearBE).trim(),
    String(name).trim().replace(/\s+/g, ' '),
    String(leaveType).trim(),
    Number(String(carryIn || '').trim()) || '',
    Number(String(usedExtra || '').trim()) || '',
    String(reason || '').trim(),
    Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm'),
  ];
}

function api_getBalances() {
  const sheet = getSheet_('LeaveBalances');
  const lastRow = sheet.getLastRow();
  const data = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, 7).getDisplayValues() : [];
  const rows = [];
  data.forEach((row, i) => {
    if (!String(row[0]).trim() && !String(row[1]).trim()) return; // แถวว่าง
    rows.push({
      row: 3 + i,
      yearBE: String(row[0]).trim(),
      name: String(row[1]).trim(),
      leaveType: String(row[2]).trim(),
      carryIn: String(row[3]).trim(),
      usedExtra: String(row[4]).trim(),
      reason: String(row[5]).trim(),
      recordedAt: String(row[6]).trim(),
    });
  });
  rows.reverse(); // ใหม่สุดอยู่บน
  const settings = api_getSettings();
  return {
    balances: rows,
    staffKeys: readReportStaff_().map(s => s.key).sort((a, b) => a.localeCompare(b, 'th')),
    leaveTypes: String(settings.leave_type_options || '').split(',').map(s => s.trim()).filter(Boolean),
  };
}

function api_addBalance(yearBE, name, leaveType, carryIn, usedExtra, reason) {
  const err = validateBalanceInput_(yearBE, name, leaveType, carryIn, usedExtra);
  if (err) return { ok: false, error: err };
  getSheet_('LeaveBalances').appendRow(balanceRowValues_(yearBE, name, leaveType, carryIn, usedExtra, reason));
  return { ok: true };
}

function api_updateBalance(rowNumber, yearBE, name, leaveType, carryIn, usedExtra, reason) {
  const row = Number(rowNumber);
  if (!row || row < 3) return { ok: false, error: 'แถวไม่ถูกต้อง' };
  const err = validateBalanceInput_(yearBE, name, leaveType, carryIn, usedExtra);
  if (err) return { ok: false, error: err };
  getSheet_('LeaveBalances').getRange(row, 1, 1, 7).setValues([balanceRowValues_(yearBE, name, leaveType, carryIn, usedExtra, reason)]);
  return { ok: true };
}

function api_deleteBalance(rowNumber) {
  const row = Number(rowNumber);
  if (!row || row < 3) return { ok: false, error: 'แถวไม่ถูกต้อง' };
  getSheet_('LeaveBalances').deleteRow(row);
  return { ok: true };
}

// ---------- โควตาตามประเภทบุคลากร (แท็บ "โควตา") ----------
// โครงสร้างตรงกับ QUOTA_PROFILE_COLUMNS ของโปรเจกต์หลัก:
//   ปี (พ.ศ. เว้นว่าง = ทุกปี) | ประเภทบุคลากร | ประเภทการลา | โควตา (วันทำการ/ปี) | หมายเหตุ
// ไม่มีแถว = ใช้ค่าเริ่มต้นของระบบ (ตามระเบียบข้าราชการ) — ใส่แถวเฉพาะประเภทที่ต่างจากนั้น / โควตา 0 = ไม่มีสิทธิ์

function validateQuotaProfileInput_(yearBE, employmentType, leaveType, quota) {
  const year = String(yearBE || '').trim();
  if (year && !/^(25|26)\d{2}$/.test(year)) return 'ปี (พ.ศ.) ต้องเป็น 4 หลัก เช่น 2569 หรือเว้นว่าง = ทุกปี';
  if (!String(employmentType || '').trim()) return 'กรุณาระบุประเภทบุคลากร';
  if (!String(leaveType || '').trim()) return 'กรุณาเลือกประเภทการลา';
  const q = Number(String(quota || '').trim());
  if (!(q >= 0)) return 'โควตาต้องเป็นตัวเลข ≥ 0 (0 = ไม่มีสิทธิ์)';
  return null;
}

function quotaProfileRowValues_(yearBE, employmentType, leaveType, quota, note) {
  return [
    String(yearBE || '').trim(),
    String(employmentType).trim(),
    String(leaveType).trim(),
    Number(String(quota || '').trim()) || 0,
    String(note || '').trim(),
  ];
}

function api_getQuotaProfiles() {
  const sheet = getSheet_('QuotaProfiles');
  const lastRow = sheet.getLastRow();
  const data = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, 5).getDisplayValues() : [];
  const rows = [];
  data.forEach((row, i) => {
    if (!String(row[1]).trim() && !String(row[2]).trim()) return; // แถวว่าง
    rows.push({
      row: 3 + i,
      yearBE: String(row[0]).trim(),
      employmentType: String(row[1]).trim(),
      leaveType: String(row[2]).trim(),
      quota: String(row[3]).trim(),
      note: String(row[4]).trim(),
    });
  });
  rows.reverse(); // ใหม่สุดอยู่บน
  const settings = api_getSettings();
  const roster = readReportStaff_();
  return {
    profiles: rows,
    employmentTypes: String(settings.employment_type_options || '')
      .split(',').map(s => s.trim()).filter(Boolean),
    leaveTypes: String(settings.leave_type_options || '')
      .split(',').map(s => s.trim()).filter(Boolean),
    staff: roster.map(s => ({
      name: s.name, key: s.key, group: s.group,
      employmentType: s.employmentType, registered: !!s.lineUserId,
    })).sort((a, b) => a.name.localeCompare(b.name, 'th')),
  };
}

function api_addQuotaProfile(yearBE, employmentType, leaveType, quota, note) {
  const err = validateQuotaProfileInput_(yearBE, employmentType, leaveType, quota);
  if (err) return { ok: false, error: err };
  getSheet_('QuotaProfiles').appendRow(quotaProfileRowValues_(yearBE, employmentType, leaveType, quota, note));
  return { ok: true };
}

function api_updateQuotaProfile(rowNumber, yearBE, employmentType, leaveType, quota, note) {
  const row = Number(rowNumber);
  if (!row || row < 3) return { ok: false, error: 'แถวไม่ถูกต้อง' };
  const err = validateQuotaProfileInput_(yearBE, employmentType, leaveType, quota);
  if (err) return { ok: false, error: err };
  getSheet_('QuotaProfiles').getRange(row, 1, 1, 5).setValues([quotaProfileRowValues_(yearBE, employmentType, leaveType, quota, note)]);
  return { ok: true };
}

function api_deleteQuotaProfile(rowNumber) {
  const row = Number(rowNumber);
  if (!row || row < 3) return { ok: false, error: 'แถวไม่ถูกต้อง' };
  getSheet_('QuotaProfiles').deleteRow(row);
  return { ok: true };
}

/** แก้ "ประเภทบุคลากร" ของเจ้าหน้าที่คนหนึ่ง (คอลัมน์ที่ 9 ของชีต Staff) ตาม "ชื่อ สกุล"
 *  ใช้หลัง migration — คนที่ลงทะเบียนไว้ก่อนหน้ายังไม่มีสถานะ ผู้ดูแลเติมให้จากหน้าเว็บ */
function api_setStaffEmploymentType(staffKey, employmentType) {
  const key = String(staffKey || '').trim().replace(/\s+/g, ' ');
  const type = String(employmentType || '').trim();
  if (!key) return { ok: false, error: 'กรุณาระบุชื่อ สกุล' };
  if (!type) return { ok: false, error: 'กรุณาเลือกประเภทบุคลากร' };
  const sheet = getSheet_('Staff');
  const lastRow = sheet.getLastRow();
  const data = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, 2).getDisplayValues() : [];
  for (let i = 0; i < data.length; i++) {
    const rowKey = (String(data[i][0]).trim() + ' ' + String(data[i][1]).trim()).replace(/\s+/g, ' ');
    if (rowKey === key) {
      sheet.getRange(3 + i, 9).setValue(type);
      return { ok: true };
    }
  }
  return { ok: false, error: 'ไม่พบชื่อนี้ในชีต Staff' };
}

// ---------- ภาพรวม + ผู้อนุมัติ (endpoint ใหม่ของหน้า admin) ----------

// จำนวนแถวข้อมูลของชีต (ข้อมูลเริ่มแถว 3 เหมือนกันทุกชีต) — ใช้ทำตัวเลขสรุปหน้าภาพรวม
function countDataRows_(name) {
  return Math.max(0, getSheet_(name).getLastRow() - 2);
}

/** ข้อมูลหน้า "ภาพรวม" — ใช้เป็นการตรวจ token ตอน login ฝั่ง client ด้วย (เรียกผ่าน = token ถูก) */
function api_getOverview_() {
  const logs = api_getLogs(1);
  const settings = api_getSettings();
  const staff = readReportStaff_();
  const today = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  const upcomingHolidays = api_getHolidays().filter(h => String(h.date) >= today).length;
  return withOk_({
    log: logs.length ? logs[0] : null,
    counts: {
      staff: staff.length,
      registered: staff.filter(s => s.lineUserId && String(s.lineUserId).trim()).length,
      groups: countDataRows_('Approvers'),
      upcomingHolidays: upcomingHolidays,
      quotaProfiles: countDataRows_('QuotaProfiles'),
      balances: countDataRows_('LeaveBalances'),
    },
    settings: {
      enabled: settings.enabled,
      notify_time: settings.notify_time,
      message_format: settings.message_format,
    },
  });
}

/** รายการผู้อนุมัติรายกลุ่มงาน (ชีต Approvers: กลุ่มงาน | รายชื่อคั่นจุลภาค | ส่งต่อ หัวหน้า สสอ. = TRUE)
 *  staffKeys ให้ฝั่งหน้าเว็บทำ datalist ช่วยพิมพ์ชื่อให้ตรงกับทำเนียบ */
function api_getApprovers_() {
  const sheet = getSheet_('Approvers');
  const lastRow = sheet.getLastRow();
  const data = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, 3).getValues() : [];
  const approvers = [];
  data.forEach((row, i) => {
    const group = String(row[0] || '').trim();
    const names = String(row[1] || '').trim();
    if (!group && !names) return;
    approvers.push({
      row: 3 + i,
      group: group,
      names: names,
      forward: String(row[2] || '').trim().toUpperCase() === 'TRUE',
    });
  });
  const staffKeys = readReportStaff_().map(s => s.key).sort((a, b) => a.localeCompare(b, 'th'));
  return withOk_({ approvers: approvers, staffKeys: staffKeys });
}

/** บันทึกตารางผู้อนุมัติทั้งตาราง (replace แถว 3 ลงไป) — เลี่ยงการ track เลขแถวรายแถว
 *  ตารางเล็ก (หลักสิบแถว) validate ครบทุกแถวก่อนเขียน แถวไหนพังจะไม่มีอะไรถูกแตะเลย */
function api_saveApprovers_(rows) {
  if (!Array.isArray(rows) || rows.length > 50) {
    return { ok: false, error: 'รายการต้องเป็น array ไม่เกิน 50 แถว' };
  }
  const seen = new Set();
  const values = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    const group = String(r.group || '').trim();
    const names = String(r.names || '').trim();
    if (!group) return { ok: false, error: 'แถวที่ ' + (i + 1) + ': กรุณากรอกชื่อกลุ่มงาน' };
    if (group.length > 100) return { ok: false, error: 'แถวที่ ' + (i + 1) + ': ชื่อกลุ่มงานยาวเกิน 100 ตัวอักษร' };
    if (seen.has(group)) return { ok: false, error: 'ชื่อกลุ่มงานซ้ำกัน: ' + group };
    seen.add(group);
    if (!names) return { ok: false, error: 'แถวที่ ' + (i + 1) + ' (' + group + '): กรุณากรอกชื่อผู้อนุมัติอย่างน้อยหนึ่งคน' };
    if (names.length > 500) return { ok: false, error: 'แถวที่ ' + (i + 1) + ' (' + group + '): รายชื่อยาวเกิน 500 ตัวอักษร' };
    values.push([group, names, r.forward ? 'TRUE' : '']);
  }
  const sheet = getSheet_('Approvers');
  const lastRow = sheet.getLastRow();
  if (lastRow >= 3) sheet.getRange(3, 1, lastRow - 2, 3).clearContent();
  if (values.length) sheet.getRange(3, 1, values.length, 3).setValues(values);
  return { ok: true };
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

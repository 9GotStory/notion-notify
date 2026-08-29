/**
 * JSON API ของหน้าตั้งค่าผู้ดูแล — UI อยู่บน GitHub Pages (web/admin/) เรียกผ่าน fetch
 *
 * โมเดล: deployment นี้เป็น API ล้วน deploy แบบ "Execute as: Me + Anyone (anonymous)"
 * ทุกคำขอต้องมี token ตรงกับ Script Property ADMIN_TOKEN (fail-closed — ยังไม่ตั้ง = ปฏิเสธทุกคำขอ)
 * browser เรียก security gateway ด้วย POST; gateway ส่ง signed envelope มาที่ doPost นี้
 * เปิด URL นี้ด้วย browser เอง (ไม่มี apiAction) =  meta-refresh ไปหน้า admin บน GitHub Pages
 *
 * ทำไมต้องเป็นโปรเจกต์แยกจากโปรเจกต์หลัก: doGet/doPost เป็น entry point ระดับโปรเจกต์ การแยกไว้ทำให้
 * webhook หลัก (ต้อง anonymous ให้ LINE ยิงเข้า) กับ API นี้ (มี token คุมทุกคำขอ) แยกระดับ deployment กันได้
 * โปรเจกต์นี้ไม่มี LINE_CHANNEL_ACCESS_TOKEN (ตั้งใจ — แม้ ADMIN_TOKEN รั่ว เสียเพียงสิทธิ์แก้ชีต config)
 */

const ADMIN_PAGE_URL = 'https://9gotstory.github.io/notion-notify/web/admin/';
const MAX_JSON_PARAM_LENGTH = 5000; // จำกัด JSON ซ้อนในคำขอ admin — payload จริง (settings/approvers) < 2KB

// ---------- Router ----------

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.apiAction) {
    if (adminGatewayRequired_()) {
      return jsonOutput_({ ok: false, code: 'GATEWAY_REQUIRED', error: 'คำขอนี้ต้องส่งผ่าน security gateway ด้วย POST' });
    }
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

function doPost(e) {
  try {
    const params = unwrapAdminGatewayEnvelope_(JSON.parse(e.postData.contents));
    return jsonOutput_(handleAdminApiRequest_(params));
  } catch (err) {
    console.error(err);
    return jsonOutput_({ ok: false, code: 'INVALID_REQUEST', error: 'คำขอไม่ถูกต้องหรือหมดอายุแล้ว' });
  }
}

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function adminGatewaySecret_() {
  return String(PropertiesService.getScriptProperties().getProperty('GATEWAY_SHARED_SECRET') || '').trim();
}

function adminGatewayRequired_() {
  const allowLegacy = String(PropertiesService.getScriptProperties().getProperty('ALLOW_LEGACY_DIRECT') || '')
    .toUpperCase() === 'TRUE';
  return !allowLegacy;
}

function adminSpreadsheetId_() {
  const id = String(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '').trim();
  if (!/^[A-Za-z0-9_-]{20,}$/.test(id)) {
    throw new Error('ยังไม่ได้ตั้งค่า SPREADSHEET_ID ใน Script Properties');
  }
  return id;
}

function adminSecureEqual_(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function claimAdminGatewayNonce_(nonce) {
  const sheetName = 'SecurityEvents';
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('ระบบกำลังตรวจคำขออื่นอยู่');
  try {
    const ss = SpreadsheetApp.openById(adminSpreadsheetId_());
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.getRange(1, 1, 2, 4).setValues([
        ['บันทึกความปลอดภัย', '', '', ''],
        ['เวลา', 'ประเภท', 'รหัส', 'หมดอายุ'],
      ]);
      sheet.hideSheet();
    }
    const now = Date.now();
    const lastRow = sheet.getLastRow();
    const rows = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, 4).getValues() : [];
    for (let i = rows.length - 1; i >= 0; i--) {
      const expiresAt = rows[i][3] instanceof Date ? rows[i][3].getTime() : Number(rows[i][3]);
      if (expiresAt && expiresAt < now) sheet.deleteRow(3 + i);
      else if (String(rows[i][1]) === 'admin-gateway-nonce' && String(rows[i][2]) === nonce) return false;
    }
    sheet.appendRow([new Date(now), 'admin-gateway-nonce', nonce, new Date(now + 10 * 60 * 1000)]);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function unwrapAdminGatewayEnvelope_(body) {
  const secret = adminGatewaySecret_();
  if (!secret) throw new Error('ยังไม่ได้ตั้งค่า GATEWAY_SHARED_SECRET');
  if (!body || !body.gatewayEnvelope) throw new Error('คำขอนี้ต้องผ่าน security gateway');
  const timestamp = String(body.timestamp || '');
  const nonce = String(body.nonce || '');
  const payload = body.payload;
  if (!/^\d{13}$/.test(timestamp) || !/^[0-9a-f-]{36}$/i.test(nonce) ||
      !payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('รูปแบบคำขอไม่ถูกต้อง');
  if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000) throw new Error('คำขอหมดอายุแล้ว');
  const canonical = timestamp + '\n' + nonce + '\n' + JSON.stringify(payload);
  const expected = Utilities.base64Encode(Utilities.computeHmacSha256Signature(
    canonical, secret, Utilities.Charset.UTF_8));
  if (!adminSecureEqual_(expected, body.signature)) throw new Error('ลายเซ็น gateway ไม่ถูกต้อง');
  if (!claimAdminGatewayNonce_(nonce)) throw new Error('คำขอนี้ถูกประมวลผลไปแล้ว');
  return payload;
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
  if (!adminSecureEqual_(given, expected)) {
    return { ok: false, code: 'UNAUTHORIZED', error: 'รหัสผู้ดูแลไม่ถูกต้อง — กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ' };
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

// แผนที่ action → adapter: แปลง HTTP payload เป็น signature ของ api_*
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
  delete_holiday: p => api_deleteHoliday(p.row, p.version),
  get_logs: p => withOk_({ logs: api_getLogs(p.limit) }),
  get_leave_report: p => api_getLeaveReport(p.year, p.month),
  get_balances: () => withOk_(api_getBalances()),
  add_balance: p => api_addBalance(p.yearBE, p.name, p.leaveType, p.carryIn, p.usedExtra, p.reason),
  update_balance: p => api_updateBalance(p.row, p.version, p.yearBE, p.name, p.leaveType, p.carryIn, p.usedExtra, p.reason),
  delete_balance: p => api_deleteBalance(p.row, p.version),
  get_quota_profiles: () => withOk_(api_getQuotaProfiles()),
  add_quota_profile: p => api_addQuotaProfile(p.yearBE, p.employmentType, p.leaveType, p.quota, p.note),
  update_quota_profile: p => api_updateQuotaProfile(p.row, p.version, p.yearBE, p.employmentType, p.leaveType, p.quota, p.note),
  delete_quota_profile: p => api_deleteQuotaProfile(p.row, p.version),
  set_staff_employment_type: p => api_setStaffEmploymentType(p.staffKey, p.employmentType),
  get_approvers: () => api_getApprovers_(),
  save_approvers: p => api_saveApprovers_(parseJsonParam_(p.data, 'array'), p.version),
};

function handleAdminApiRequest_(params) {
  const authError = requireAdminToken_(params);
  if (authError) return authError;
  const handler = ADMIN_API[params.apiAction];
  if (!handler) return { ok: false, error: 'ไม่รู้จัก action: ' + params.apiAction };
  try {
    return handler(params);
  } catch (err) {
    const publicError = publicAdminApiError_(err);
    console.error('Admin API ' + String(params.apiAction || '') + ' failed: ' + String(err && (err.stack || err)));
    return { ok: false, code: publicError.code, error: publicError.message };
  }
}

function publicAdminApiError_(err) {
  const message = String(err && err.message ? err.message : '');
  if (/^ยังไม่ได้ตั้งค่า (?:SPREADSHEET_ID|leave_database_id|NOTION_TOKEN_READONLY)/.test(message) ||
      /^ข้อมูล Notion มีมากกว่าเพดาน/.test(message)) {
    return { code: 'CONFIGURATION_REQUIRED', message: message.substring(0, 300) };
  }
  const unsafe = /Notion|UrlFetch|Exception|HTTP\s*\d|\{[\s\S]*\}|data[_ -]?source|database/i;
  if (!message || unsafe.test(message)) {
    return { code: 'UPSTREAM_ERROR', message: 'เชื่อมต่อระบบภายในไม่สำเร็จ กรุณาลองอีกครั้ง' };
  }
  return { code: 'INVALID_REQUEST', message: message.substring(0, 300) };
}

function getSheet_(name) {
  const ss = SpreadsheetApp.openById(adminSpreadsheetId_());
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('ไม่พบชีตชื่อ ' + name + ' — โปรดตรวจสอบว่า SPREADSHEET_ID ถูกต้อง');
  return sheet;
}

function formatCell_(cell) {
  if (!cell) return '';
  return cell instanceof Date
    ? Utilities.formatDate(cell, 'Asia/Bangkok', 'yyyy-MM-dd')
    : String(cell).trim();
}

function rowVersion_(values) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify((values || []).map(v => String(v == null ? '' : v))),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/, '');
}

function requireCurrentRow_(sheet, rowNumber, width, expectedVersion) {
  const row = Number(rowNumber);
  if (!row || row < 3 || row > sheet.getLastRow()) throw new Error('ไม่พบรายการนี้แล้ว กรุณาโหลดข้อมูลใหม่');
  if (!expectedVersion) throw new Error('ข้อมูลรายการไม่มีเวอร์ชัน กรุณาโหลดข้อมูลใหม่');
  const values = sheet.getRange(row, 1, 1, width).getDisplayValues()[0];
  if (rowVersion_(values) !== String(expectedVersion)) {
    throw new Error('รายการนี้ถูกแก้ไขโดยผู้อื่นแล้ว กรุณาโหลดข้อมูลใหม่ก่อนบันทึก');
  }
  return row;
}

function withAdminWriteLock_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('ระบบกำลังบันทึกข้อมูลอื่นอยู่ กรุณาลองอีกครั้ง');
  try { return callback(); } finally { lock.releaseLock(); }
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
  settings._version = rowVersion_(data.reduce((all, row) => all.concat(row), []));
  return settings;
}

function validateSettings_(s) {
  const errors = [];
  if (s.enabled !== undefined && !['TRUE', 'FALSE'].includes(String(s.enabled).toUpperCase())) {
    errors.push('enabled ต้องเป็น TRUE หรือ FALSE');
  }
  if (String(s.notify_time || '').trim() && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(s.notify_time).trim())) {
    errors.push('เวลาแจ้งเตือนต้องเป็นรูปแบบ HH:mm เช่น 08:30');
  }
  if (s.message_format !== undefined && !['text', 'flex'].includes(String(s.message_format).toLowerCase())) {
    errors.push('รูปแบบข้อความต้องเป็น text หรือ flex');
  }
  if (String(s.enabled || '').toUpperCase() === 'TRUE') {
    if (!String(s.notify_time || '').trim()) errors.push('เมื่อเปิดระบบ ต้องกำหนดเวลาแจ้งเตือน');
    const notionId = String(s.notion_database_id || '').trim().replace(/-/g, '');
    if (!/^[0-9a-f]{32}$/i.test(notionId)) errors.push('Notion Database ID ไม่ถูกต้อง');
    if (!/^C[0-9a-f]{32}$/i.test(String(s.line_group_id || '').trim())) errors.push('LINE Group ID ไม่ถูกต้อง');
  }
  return errors;
}

function api_saveSettings(newSettings) {
  const sheet = getSheet_('Settings');
  return withAdminWriteLock_(function () {
    const currentSettings = api_getSettings();
    if (!newSettings || !newSettings._version || newSettings._version !== currentSettings._version) {
      throw new Error('การตั้งค่าถูกแก้ไขโดยผู้อื่นแล้ว กรุณาโหลดข้อมูลใหม่ก่อนบันทึก');
    }
    const mergedSettings = Object.assign({}, currentSettings, newSettings);
    const errors = validateSettings_(mergedSettings);
    if (errors.length) return { ok: false, errors: errors };
    const lastRow = sheet.getLastRow();
    const rowCount = Math.max(0, lastRow - 2);
    if (rowCount) {
      const keys = sheet.getRange(3, 1, rowCount, 1).getValues();
      const valueRange = sheet.getRange(3, 2, rowCount, 1);
      const currentValues = valueRange.getValues();
      const currentFormulas = valueRange.getFormulas();
      const values = keys.map(([key], i) => {
        const k = String(key).trim();
        if (k && Object.prototype.hasOwnProperty.call(newSettings, k)) return [newSettings[k]];
        // รักษาชนิด Date/Number และสูตรของค่าที่หน้า admin ไม่ได้แก้
        return [currentFormulas[i][0] || currentValues[i][0]];
      });
      valueRange.setValues(values);
    }
    return { ok: true };
  });
}

// ---------- Holidays ----------

function isValidDateInput_(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return false;
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return parsed.getUTCFullYear() === Number(match[1]) &&
    parsed.getUTCMonth() === Number(match[2]) - 1 && parsed.getUTCDate() === Number(match[3]);
}

function api_getHolidays() {
  const sheet = getSheet_('Holidays');
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return [];
  const data = sheet.getRange(3, 1, lastRow - 2, 3).getDisplayValues();
  return data
    .map((row, i) => ({ row: 3 + i, version: rowVersion_(row), date: String(row[0]), name: row[1], type: row[2] }))
    .filter(h => h.date);
}

function api_addHoliday(date, name, type) {
  if (!isValidDateInput_(date)) {
    return { ok: false, error: 'วันที่ไม่ถูกต้อง กรุณาเลือกวันที่จริงในรูปแบบ yyyy-MM-dd' };
  }
  if (!String(name).trim()) {
    return { ok: false, error: 'กรุณาใส่ชื่อวันหยุด' };
  }
  if (String(name).trim().length > 200) return { ok: false, error: 'ชื่อวันหยุดยาวเกิน 200 ตัวอักษร' };
  const allowedTypes = ['ราชการปกติ', 'ชดเชย', 'กรณีพิเศษ'];
  if (!allowedTypes.includes(type)) return { ok: false, error: 'ประเภทวันหยุดไม่ถูกต้อง' };
  const sheet = getSheet_('Holidays');
  withAdminWriteLock_(function () {
    const lastRow = sheet.getLastRow();
    const dates = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, 1).getDisplayValues().flat() : [];
    if (dates.some(value => String(value).trim() === String(date).trim())) {
      throw new Error('วันที่นี้มีอยู่ในรายการวันหยุดแล้ว กรุณาแก้ไขรายการเดิม');
    }
    sheet.appendRow([String(date).trim(), String(name).trim(), type]);
  });
  return { ok: true };
}

function api_deleteHoliday(rowNumber, version) {
  const sheet = getSheet_('Holidays');
  withAdminWriteLock_(function () {
    sheet.deleteRow(requireCurrentRow_(sheet, rowNumber, 3, version));
  });
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
    throw new Error('database ใบลาไม่มี data source ที่เข้าถึงได้ — โปรดตรวจสอบว่าแชร์ database ให้ integration แบบอ่านอย่างเดียวแล้วหรือยัง (Connections ในเมนู "...")');
  }
  return data.data_sources[0].id;
}

// query วนตาม next_cursor เหมือน queryNotionPages_ ใน Notion.gs (โปรเจกต์หลัก) (เผื่อเดือนที่มีใบลาเกิน 100 ใบ)
function queryReportNotionPages_(dataSourceId, payload, maxPages) {
  const limit = maxPages || 20;
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
    if (!data.has_more || !data.next_cursor) return results;
    cursor = data.next_cursor;
  }
  throw new Error('ข้อมูล Notion มีมากกว่าเพดาน ' + limit * 100 + ' รายการ จึงหยุดเพื่อไม่คืนรายงานที่ไม่ครบ');
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
    leaveType: adminNormalizeLeaveType_(((props[REPORT_PROPS.type] && props[REPORT_PROPS.type].select) || {}).name),
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
// | ยกมา (วันใช้สิทธิ์) | ใช้เพิ่ม (วันใช้สิทธิ์) | เหตุผล | บันทึกเมื่อ
// ความหมาย: "ยกมา" เพิ่มเข้าสิทธิ์ของปีนั้น (เช่น พักร้อนสะสม) / "ใช้เพิ่ม" เพิ่มเข้ายอดใช้ (เช่น ลาก่อนมีระบบ)

function adminNormalizeLeaveType_(value) {
  const name = String(value || '').trim();
  return name === 'ลาอุปสมบถ/ลาบวช' ? 'ลาอุปสมบท/ลาบวช' : name;
}

function adminLeaveTypes_(settings) {
  return Array.from(new Set(String((settings && settings.leave_type_options) || '')
    .split(',').map(adminNormalizeLeaveType_).filter(Boolean)));
}

function validateBalanceInput_(yearBE, name, leaveType, carryIn, usedExtra) {
  if (!/^(25|26)\d{2}$/.test(String(yearBE || '').trim())) return 'ปี (พ.ศ.) ต้องเป็น 4 หลัก เช่น 2569';
  if (!String(name || '').trim()) return 'กรุณาเลือกชื่อ สกุล';
  if (!String(leaveType || '').trim()) return 'กรุณาเลือกประเภทการลา';
  if (String(name).trim().length > 150) return 'ชื่อ สกุลยาวเกิน 150 ตัวอักษร';
  if (String(leaveType).trim().length > 100) return 'ประเภทการลายาวเกิน 100 ตัวอักษร';
  const carry = Number(String(carryIn || '').trim()) || 0;
  const extra = Number(String(usedExtra || '').trim()) || 0;
  if ((String(carryIn || '').trim() && !Number.isFinite(Number(carryIn))) ||
      (String(usedExtra || '').trim() && !Number.isFinite(Number(usedExtra)))) return 'กรุณากรอกตัวเลขที่ถูกต้อง';
  if (carry < 0 || extra < 0) return 'ตัวเลขต้องไม่ติดลบ';
  if (carry > 366 || extra > 366) return 'จำนวนวันต้องไม่เกิน 366 วัน';
  if (carry * 2 % 1 !== 0 || extra * 2 % 1 !== 0) return 'จำนวนวันต้องเป็นจำนวนเต็มหรือครึ่งวัน (.5)';
  if (carry === 0 && extra === 0) return 'กรอก "ยกมา" หรือ "ใช้เพิ่ม" อย่างน้อยหนึ่งค่า (> 0)';
  return null;
}

function balanceRowValues_(yearBE, name, leaveType, carryIn, usedExtra, reason) {
  return [
    String(yearBE).trim(),
    String(name).trim().replace(/\s+/g, ' '),
    adminNormalizeLeaveType_(leaveType),
    Number(String(carryIn || '').trim()) || '',
    Number(String(usedExtra || '').trim()) || '',
    String(reason || '').trim(),
    Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm'),
  ];
}

function validateBalanceReferences_(name, leaveType) {
  const settings = api_getSettings();
  const leaveTypes = adminLeaveTypes_(settings);
  if (!leaveTypes.includes(adminNormalizeLeaveType_(leaveType))) return 'ประเภทการลาไม่อยู่ในรายการที่อนุญาต';
  const staffKeys = readReportStaff_().map(staff => staff.key);
  if (!staffKeys.includes(String(name).trim().replace(/\s+/g, ' '))) return 'ไม่พบชื่อ สกุลในชีต Staff';
  return null;
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
      version: rowVersion_(row),
      yearBE: String(row[0]).trim(),
      name: String(row[1]).trim(),
      leaveType: adminNormalizeLeaveType_(row[2]),
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
    leaveTypes: adminLeaveTypes_(settings),
  };
}

function api_addBalance(yearBE, name, leaveType, carryIn, usedExtra, reason) {
  if (String(reason || '').trim().length > 500) return { ok: false, error: 'เหตุผลยาวเกิน 500 ตัวอักษร' };
  const err = validateBalanceInput_(yearBE, name, leaveType, carryIn, usedExtra);
  if (err) return { ok: false, error: err };
  withAdminWriteLock_(function () {
    const referenceError = validateBalanceReferences_(name, leaveType);
    if (referenceError) throw new Error(referenceError);
    getSheet_('LeaveBalances').appendRow(balanceRowValues_(yearBE, name, leaveType, carryIn, usedExtra, reason));
  });
  return { ok: true };
}

function api_updateBalance(rowNumber, version, yearBE, name, leaveType, carryIn, usedExtra, reason) {
  if (String(reason || '').trim().length > 500) return { ok: false, error: 'เหตุผลยาวเกิน 500 ตัวอักษร' };
  const err = validateBalanceInput_(yearBE, name, leaveType, carryIn, usedExtra);
  if (err) return { ok: false, error: err };
  const sheet = getSheet_('LeaveBalances');
  withAdminWriteLock_(function () {
    const referenceError = validateBalanceReferences_(name, leaveType);
    if (referenceError) throw new Error(referenceError);
    const row = requireCurrentRow_(sheet, rowNumber, 7, version);
    sheet.getRange(row, 1, 1, 7).setValues([balanceRowValues_(yearBE, name, leaveType, carryIn, usedExtra, reason)]);
  });
  return { ok: true };
}

function api_deleteBalance(rowNumber, version) {
  const sheet = getSheet_('LeaveBalances');
  withAdminWriteLock_(function () {
    sheet.deleteRow(requireCurrentRow_(sheet, rowNumber, 7, version));
  });
  return { ok: true };
}

// ---------- โควตาตามประเภทบุคลากร (แท็บ "โควตา") ----------
// โครงสร้างตรงกับ QUOTA_PROFILE_COLUMNS ของโปรเจกต์หลัก:
//   ปี (พ.ศ. เว้นว่าง = ทุกปี) | ประเภทบุคลากร | ประเภทการลา | เกณฑ์วันใช้สิทธิ์ | หมายเหตุ
// ไม่มีแถว = ใช้ค่าเริ่มต้นของระบบ (ตามระเบียบข้าราชการ) — ใส่แถวเฉพาะประเภทที่ต่างจากนั้น / โควตา 0 = ไม่มีสิทธิ์

function validateQuotaProfileInput_(yearBE, employmentType, leaveType, quota) {
  const year = String(yearBE || '').trim();
  if (year && !/^(25|26)\d{2}$/.test(year)) return 'ปี (พ.ศ.) ต้องเป็น 4 หลัก เช่น 2569 หรือเว้นว่าง = ทุกปี';
  if (!String(employmentType || '').trim()) return 'กรุณาระบุประเภทบุคลากร';
  if (!String(leaveType || '').trim()) return 'กรุณาเลือกประเภทการลา';
  if (String(employmentType).trim().length > 100) return 'ประเภทบุคลากรยาวเกิน 100 ตัวอักษร';
  if (String(leaveType).trim().length > 100) return 'ประเภทการลายาวเกิน 100 ตัวอักษร';
  const rawQuota = String(quota == null ? '' : quota).trim();
  if (!rawQuota) return 'กรุณากรอกโควตา (ใส่ 0 เมื่อไม่มีสิทธิ์)';
  const q = Number(rawQuota);
  if (!Number.isFinite(q) || q < 0 || q > 366) return 'โควตาต้องเป็นตัวเลข 0–366 วัน';
  if (q * 2 % 1 !== 0) return 'โควตาต้องเป็นจำนวนเต็มหรือครึ่งวัน (.5)';
  return null;
}

function quotaProfileRowValues_(yearBE, employmentType, leaveType, quota, note) {
  return [
    String(yearBE || '').trim(),
    String(employmentType).trim(),
    adminNormalizeLeaveType_(leaveType),
    Number(String(quota || '').trim()) || 0,
    String(note || '').trim(),
  ];
}

function validateQuotaReferences_(employmentType, leaveType) {
  const settings = api_getSettings();
  const employmentTypes = String(settings.employment_type_options || '').split(',').map(s => s.trim()).filter(Boolean);
  const leaveTypes = adminLeaveTypes_(settings);
  if (!employmentTypes.includes(String(employmentType).trim())) return 'ประเภทบุคลากรไม่อยู่ในรายการที่อนุญาต';
  if (!leaveTypes.includes(adminNormalizeLeaveType_(leaveType))) return 'ประเภทการลาไม่อยู่ในรายการที่อนุญาต';
  return null;
}

function requireUniqueQuotaProfile_(sheet, values, excludedRow) {
  const lastRow = sheet.getLastRow();
  const rows = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, 3).getDisplayValues() : [];
  const wanted = values.slice(0, 3).map(value => String(value).trim()).join('|');
  const duplicate = rows.some((row, index) => {
    const normalized = [String(row[0]).trim(), String(row[1]).trim(), adminNormalizeLeaveType_(row[2])];
    return 3 + index !== Number(excludedRow) && normalized.join('|') === wanted;
  });
  if (duplicate) throw new Error('มีโควตาสำหรับปี ประเภทบุคลากร และประเภทการลานี้แล้ว กรุณาแก้ไขรายการเดิม');
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
      version: rowVersion_(row),
      yearBE: String(row[0]).trim(),
      employmentType: String(row[1]).trim(),
      leaveType: adminNormalizeLeaveType_(row[2]),
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
    leaveTypes: adminLeaveTypes_(settings),
    staff: roster.map(s => ({
      name: s.name, key: s.key, group: s.group,
      employmentType: s.employmentType, registered: !!s.lineUserId,
    })).sort((a, b) => a.name.localeCompare(b.name, 'th')),
  };
}

function api_addQuotaProfile(yearBE, employmentType, leaveType, quota, note) {
  if (String(note || '').trim().length > 500) return { ok: false, error: 'หมายเหตุยาวเกิน 500 ตัวอักษร' };
  const err = validateQuotaProfileInput_(yearBE, employmentType, leaveType, quota);
  if (err) return { ok: false, error: err };
  withAdminWriteLock_(function () {
    const referenceError = validateQuotaReferences_(employmentType, leaveType);
    if (referenceError) throw new Error(referenceError);
    const sheet = getSheet_('QuotaProfiles');
    const values = quotaProfileRowValues_(yearBE, employmentType, leaveType, quota, note);
    requireUniqueQuotaProfile_(sheet, values, 0);
    sheet.appendRow(values);
  });
  return { ok: true };
}

function api_updateQuotaProfile(rowNumber, version, yearBE, employmentType, leaveType, quota, note) {
  if (String(note || '').trim().length > 500) return { ok: false, error: 'หมายเหตุยาวเกิน 500 ตัวอักษร' };
  const err = validateQuotaProfileInput_(yearBE, employmentType, leaveType, quota);
  if (err) return { ok: false, error: err };
  const sheet = getSheet_('QuotaProfiles');
  withAdminWriteLock_(function () {
    const referenceError = validateQuotaReferences_(employmentType, leaveType);
    if (referenceError) throw new Error(referenceError);
    const row = requireCurrentRow_(sheet, rowNumber, 5, version);
    const values = quotaProfileRowValues_(yearBE, employmentType, leaveType, quota, note);
    requireUniqueQuotaProfile_(sheet, values, row);
    sheet.getRange(row, 1, 1, 5).setValues([values]);
  });
  return { ok: true };
}

function api_deleteQuotaProfile(rowNumber, version) {
  const sheet = getSheet_('QuotaProfiles');
  withAdminWriteLock_(function () {
    sheet.deleteRow(requireCurrentRow_(sheet, rowNumber, 5, version));
  });
  return { ok: true };
}

/** แก้ "ประเภทบุคลากร" ของเจ้าหน้าที่คนหนึ่ง (คอลัมน์ที่ 9 ของชีต Staff) ตาม "ชื่อ สกุล"
 *  ใช้หลัง migration — คนที่ลงทะเบียนไว้ก่อนหน้ายังไม่มีสถานะ ผู้ดูแลเติมให้จากหน้าเว็บ */
function api_setStaffEmploymentType(staffKey, employmentType) {
  const key = String(staffKey || '').trim().replace(/\s+/g, ' ');
  const type = String(employmentType || '').trim();
  if (!key) return { ok: false, error: 'กรุณาระบุชื่อ สกุล' };
  if (!type) return { ok: false, error: 'กรุณาเลือกประเภทบุคลากร' };
  const allowedTypes = String(api_getSettings().employment_type_options || '')
    .split(',').map(value => value.trim()).filter(Boolean);
  if (!allowedTypes.includes(type)) return { ok: false, error: 'ประเภทบุคลากรไม่อยู่ในรายการที่อนุญาต' };
  return withAdminWriteLock_(function () {
    const sheet = getSheet_('Staff');
    const lastRow = sheet.getLastRow();
    const data = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, 3).getDisplayValues() : [];
    for (let i = 0; i < data.length; i++) {
      const rowKey = (String(data[i][1]).trim() + ' ' + String(data[i][2]).trim()).replace(/\s+/g, ' ');
      if (rowKey === key) {
        sheet.getRange(3 + i, 9).setValue(type);
        return { ok: true };
      }
    }
    return { ok: false, error: 'ไม่พบชื่อนี้ในชีต Staff' };
  });
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
  const data = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, 3).getDisplayValues() : [];
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
  return withOk_({
    approvers: approvers,
    staffKeys: staffKeys,
    version: rowVersion_(data.reduce((all, row) => all.concat(row), [])),
  });
}

/** บันทึกตารางผู้อนุมัติทั้งตาราง (replace แถว 3 ลงไป) — เลี่ยงการ track เลขแถวรายแถว
 *  ตารางเล็ก (หลักสิบแถว) validate ครบทุกแถวก่อนเขียน แถวไหนพังจะไม่มีอะไรถูกแตะเลย */
function api_saveApprovers_(rows, expectedVersion) {
  if (!Array.isArray(rows) || rows.length > 50) {
    return { ok: false, error: 'รายการต้องเป็น array ไม่เกิน 50 แถว' };
  }
  const seen = new Set();
  const staffKeys = new Set(readReportStaff_().map(staff => staff.key));
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
    const unknownNames = names.split(/[,，\n]/).map(name => name.trim().replace(/\s+/g, ' ')).filter(Boolean)
      .filter(name => !staffKeys.has(name));
    if (unknownNames.length) {
      return { ok: false, error: 'แถวที่ ' + (i + 1) + ' (' + group + '): ไม่พบรายชื่อในชีต Staff: ' + unknownNames.join(', ') };
    }
    values.push([group, names, r.forward ? 'TRUE' : '']);
  }
  return withAdminWriteLock_(function () {
    const sheet = getSheet_('Approvers');
    const lastRow = sheet.getLastRow();
    const current = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, 3).getDisplayValues() : [];
    const currentVersion = rowVersion_(current.reduce((all, row) => all.concat(row), []));
    if (!expectedVersion || String(expectedVersion) !== currentVersion) {
      throw new Error('ตารางผู้อนุมัติถูกแก้ไขโดยผู้อื่นแล้ว กรุณาโหลดข้อมูลใหม่ก่อนบันทึก');
    }
    if (lastRow >= 3) sheet.getRange(3, 1, lastRow - 2, 3).clearContent();
    if (values.length) sheet.getRange(3, 1, values.length, 3).setValues(values);
    return { ok: true };
  });
}

/** ตารางสรุปวันลา "อนุมัติแล้ว" รายคน×ประเภท ตามปี (+เดือนถ้าเลือก) — นับตามวันเริ่มของใบ
 *  ให้ตรงแนวคิดโควตา/สรุปรายเดือนในระบบหลัก (ใบคร่อมเดือนนับเดือนที่เริ่ม)
 *  year เป็น ค.ศ. — หน้าเว็บแปลงปี พ.ศ. ให้ตอนแสดงผล และส่งกลับมาเป็น ค.ศ.
 *  คืน { ok, year, month, monthLabel, types, rows, columnTotals, grandTotal } */
function api_getLeaveReport(year, month) {
  try {
    const rawYear = String(year || '').trim();
    const yearNum = rawYear ? Number(rawYear) : Number(Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy'));
    if (!/^\d{4}$/.test(String(yearNum)) || yearNum < 2000 || yearNum > 2200) {
      return { ok: false, error: 'ปีรายงานไม่ถูกต้อง' };
    }
    const monthStr = String(month || '').trim(); // '' = ทั้งปี หรือ 'YYYY-MM'
    if (monthStr && !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthStr)) {
      return { ok: false, error: 'รูปแบบเดือนไม่ถูกต้อง (YYYY-MM)' };
    }
    if (monthStr && monthStr.substring(0, 4) !== String(yearNum)) {
      return { ok: false, error: 'เดือนรายงานต้องอยู่ในปีที่เลือก' };
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
    const standardOrder = ['ลาป่วย', 'ลากิจ', 'ลาพักร้อน', 'ลาคลอด', 'ลาอุปสมบท/ลาบวช', 'ลาช่วยเหลือภริยาคลอดบุตร', 'อื่นๆ'];
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
    // ให้ router ส่วนกลางบันทึกรายละเอียดไว้ฝั่งระบบและแปลงเป็นข้อความสาธารณะ
    // ห้ามคืน err.message ตรง ๆ เพราะอาจมี response body/รหัสจาก Notion ปะปนอยู่
    throw err;
  }
}

/** รองรับ direct mode ที่เปิดอย่างชัดเจน และตรวจ signed gateway envelope เมื่อใช้งาน gateway */

const SECURITY_EVENTS_SHEET = 'SecurityEvents';
const AUDIT_LOG_SHEET = 'AuditLog';

function securityEventsSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(SECURITY_EVENTS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(SECURITY_EVENTS_SHEET);
    sheet.getRange(1, 1, 1, 4).setValues([['บันทึกความปลอดภัย', '', '', '']]);
    sheet.getRange(2, 1, 1, 4).setValues([['เวลา', 'ประเภท', 'รหัส', 'หมดอายุ']]);
    sheet.hideSheet();
  }
  return sheet;
}

function secureEqual_(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function claimSecurityEventOnce_(type, id, ttlMs) {
  const eventId = String(id || '').trim();
  if (!eventId) return false;
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) throw new Error('ระบบกำลังตรวจคำขออื่นอยู่ กรุณาลองอีกครั้ง');
  try {
    // สร้างชีตภายใน lock ด้วย เพื่อไม่ให้คำขอแรกสองรายการแข่งกัน insert sheet ชื่อเดียวกัน
    const sheet = securityEventsSheet_();
    const now = Date.now();
    const lastRow = sheet.getLastRow();
    const rows = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, 4).getValues() : [];
    for (let i = rows.length - 1; i >= 0; i--) {
      const expiresAt = rows[i][3] instanceof Date ? rows[i][3].getTime() : Number(rows[i][3]);
      if (expiresAt && expiresAt < now) sheet.deleteRow(3 + i);
      else if (String(rows[i][1]) === type && String(rows[i][2]) === eventId) return false;
    }
    sheet.appendRow([new Date(now), type, eventId, new Date(now + ttlMs)]);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function gatewaySharedSecret_() {
  return String(PropertiesService.getScriptProperties().getProperty('GATEWAY_SHARED_SECRET') || '').trim();
}

function allowLegacyDirectRequests_() {
  return String(PropertiesService.getScriptProperties().getProperty('ALLOW_LEGACY_DIRECT') || '').toUpperCase() === 'TRUE';
}

function gatewayRequired_() {
  // ปฏิเสธ direct request โดยปริยาย ต้องเปิดด้วย ALLOW_LEGACY_DIRECT=TRUE อย่างชัดเจน
  return !allowLegacyDirectRequests_();
}

function unwrapGatewayEnvelope_(input) {
  const body = input || {};
  const secret = gatewaySharedSecret_();
  if (!body.gatewayEnvelope) {
    if (gatewayRequired_()) throw new Error('คำขอนี้ต้องผ่าน security gateway');
    return body; // direct mode ที่เจ้าของระบบยอมรับความเสี่ยงแล้ว
  }
  if (!secret) throw new Error('ยังไม่ได้ตั้งค่า GATEWAY_SHARED_SECRET');
  const timestamp = String(body.timestamp || '');
  const nonce = String(body.nonce || '');
  const payload = body.payload;
  if (!/^\d{13}$/.test(timestamp) || !/^[0-9a-f-]{36}$/i.test(nonce) ||
      !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('รูปแบบ gateway envelope ไม่ถูกต้อง');
  }
  if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000) throw new Error('คำขอหมดอายุแล้ว');
  const canonical = timestamp + '\n' + nonce + '\n' + JSON.stringify(payload);
  const expected = Utilities.base64Encode(Utilities.computeHmacSha256Signature(
    canonical, secret, Utilities.Charset.UTF_8));
  if (!secureEqual_(expected, body.signature)) throw new Error('ลายเซ็น gateway ไม่ถูกต้อง');
  // timestamp ใช้ได้ 5 นาที เก็บ nonce 10 นาทีจึงครอบคลุม replay window และไม่ปล่อยชีตโตตามคำขอทั้งวัน
  if (!claimSecurityEventOnce_('gateway-nonce', nonce, 10 * 60 * 1000)) {
    throw new Error('คำขอนี้ถูกประมวลผลไปแล้ว');
  }
  return payload;
}

function appendAuditEvent_(requestId, actorId, action, entityId, beforeState, afterState) {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(AUDIT_LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(AUDIT_LOG_SHEET);
    sheet.getRange(1, 1, 2, 7).setValues([
      ['ประวัติการเปลี่ยนแปลงระบบลา', '', '', '', '', '', ''],
      ['เวลา', 'Request ID', 'ผู้ดำเนินการ', 'การกระทำ', 'รายการ', 'ก่อน', 'หลัง'],
    ]);
    sheet.hideSheet();
  }
  sheet.appendRow([
    new Date(), String(requestId || ''), String(actorId || ''), String(action || ''), String(entityId || ''),
    String(beforeState || '').substring(0, 500), String(afterState || '').substring(0, 500),
  ]);
}

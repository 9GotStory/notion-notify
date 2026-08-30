/**
 * จุดเข้าเดียวของ deployment นี้ รับ 2 อย่าง (แยกเส้นทางด้วยโครงสร้าง body):
 * 1. Webhook จาก LINE — เดิมใช้แค่จับ Group ID ตอนติดตั้ง ตอนนี้เพิ่มรองรับปุ่มอนุมัติใบลา (postback)
 *    ดังนั้น deployment นี้ต้องค้างไว้ถาวรแล้ว (ไม่ใช่จับ Group ID แล้วปิดตามคำแนะนำเดิม)
 * 2. API จากหน้าเว็บโดยตรงเมื่อเปิด ALLOW_LEGACY_DIRECT=TRUE
 *    (หรือ signed envelope จาก security gateway หากย้ายสถาปัตยกรรมในอนาคต)
 *
 * ข้อจำกัดของ direct mode: Apps Script อ่าน X-Line-Signature ไม่ได้ จึงปฏิเสธ LINE webhook ตรง
 * โดยค่าเริ่มต้น ต้องผ่าน signed gateway หรือเปิด ALLOW_UNSIGNED_LINE_WEBHOOK=TRUE แยกอย่างชัดเจน:
 *   - ทุก apiAction ต้องแนบ LINE access token ที่ระบบตรวจกับ api.line.me จริง (verifyLineToken_ ใน LeaveApi.gs)
 *   - ปุ่มอนุมัติตรวจว่า userId ของผู้กดตรงกับ "ผู้อนุมัติปัจจุบัน" ที่เก็บในหน้า Notion ของใบลานั้น
 *     (ผู้ปลอมต้องรูทั้ง pageId และ userId ของผู้อนุมัติจริงจึงจะผ่านได้)
 *   - dedup ด้วย webhookEventId กัน LINE ยิงซ้ำ (ตอบช้า) ทำให้ประมวลผลซ้ำสองรอบ
 * ต้องใช้ ADMIN/LINE token แบบสุ่มและตรวจ Apps Script Executions/Logs เป็นระยะ
 *
 * วิธีติดตั้ง (ครั้งแรก/จับ Group ID):
 * 1. Deploy > New deployment > เลือกประเภท "Web app"
 *    - Execute as: Me, Who has access: Anyone → กด Deploy แล้วคัดลอก Web app URL
 * 2. แนะนำวาง URL gateway ที่ตรวจ X-Line-Signature ใน LINE Developers Console
 *    เปิด "Use webhook" และ "Allow bot to join group chats"
 * 3. สร้างรหัสจับคู่จากเมนูใน Sheet แล้วส่ง "เชื่อมกลุ่ม <รหัส>" ในกลุ่มเป้าหมายภายใน 10 นาที
 * 4. หลังจากนั้นปล่อย deployment นี้ค้างไว้ถาวร (LINE, LIFF และตารางงานใช้ URL เดียวกันนี้)
 *    ถ้าแก้โค้ดให้ Deploy > Manage deployments > Edit > New version เสมอ (URL ไม่เปลี่ยน)
 */

// Direct GET เปิดได้เมื่อเจ้าของระบบตั้ง ALLOW_LEGACY_DIRECT=TRUE อย่างชัดเจน
function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.apiAction) {
    if (gatewayRequired_()) {
      return jsonOutput_({ ok: false, code: 'GATEWAY_REQUIRED', error: 'คำขอนี้ต้องส่งผ่าน security gateway ด้วย POST' });
    }
    const result = handleApiRequest_(params); // รูปทรงเดียวกับ body ของ POST จึงใช้ router เดิมได้เลย
    if (params.callback && /^[A-Za-z0-9_.]{1,64}$/.test(params.callback)) {
      return ContentService
        .createTextOutput(params.callback + '(' + JSON.stringify(result) + ');')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return jsonOutput_(result);
  }
  // คนเปิด URL นี้ด้วย browser เอง (ไม่ได้ส่ง apiAction) — อธิบายว่า endpoint นี้คืออะไร
  return HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;padding:48px 24px;max-width:560px;margin:auto;color:#333;line-height:1.7">' +
    '<h2 style="margin:0 0 12px;color:#0F6E56">ระบบแจ้งเตือนปฏิทิน + ระบบลางาน</h2>' +
    '<p>URL นี้คือ <b>endpoint ของ webhook และ API</b> (ให้ LINE และหน้าฟอร์ม LIFF เรียกใช้) ' +
    'ไม่ใช่หน้าเว็บสำหรับเปิดดูด้วยตนเอง — ตั้งค่าระบบได้จากช่องทางต่อไปนี้:</p>' +
    '<ol style="padding-left:20px">' +
    '<li><b>Google Sheet หลัก</b> — แก้ชีต Settings/Approvers/Holidays ได้ตรงๆ หรือใช้เมนู "ระบบแจ้งเตือนปฏิทิน"</li>' +
    '<li><b>หน้าเว็บตั้งค่า (ถ้าต้องการ)</b> — deploy จากโปรเจกต์ Apps Script แยกตามคู่มือ SETUP.md ข้อ 10</li>' +
    '</ol></div>'
  ).setTitle('ระบบแจ้งเตือนปฏิทิน');
}

function doPost(e) {
  let requestKind = 'unknown';
  try {
    const rawBody = JSON.parse(e.postData.contents);
    if (rawBody && Array.isArray(rawBody.events)) requestKind = 'line';
    const viaGateway = !!rawBody.gatewayEnvelope;
    const body = unwrapGatewayEnvelope_(rawBody);
    if (body && Array.isArray(body.events) && !viaGateway && !allowUnsignedLineWebhook_()) {
      throw new Error('LINE webhook ต้องผ่าน security gateway');
    }

    if (body && body.internalAction === 'reschedule-notification') {
      if (!viaGateway) throw new Error('คำสั่งภายในต้องผ่าน security gateway');
      const nextRun = syncNotificationTrigger_(new Date());
      return jsonOutput_({ ok: true, nextRun: nextRun ? nextRun.toISOString() : null });
    }
    if (body && body.internalAction === 'notification-health') {
      if (!viaGateway) throw new Error('คำสั่งภายในต้องผ่าน security gateway');
      return jsonOutput_({ ok: true, health: notificationRuntimeHealth_() });
    }

    // API จากหน้า LIFF (สัญญา: มีฟิลด์ apiAction) — ตอบ JSON กลับไปให้ browser
    if (body && body.apiAction) {
      requestKind = 'api';
      return jsonOutput_(handleApiRequest_(body));
    }

    // Webhook จาก LINE (สัญญา: มีฟิลด์ events)
    requestKind = 'line';
    const events = body.events || [];
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      // เหตุการณ์ mode "standby" คือช่วง channel กำลังถูก migrate — เอกสาร LINE ให้เมินได้เลย
      if (event.mode === 'standby') continue;
      const source = event.source || {};
      if (source.type === 'group' && source.groupId && event.type === 'message' &&
          event.message && event.message.type === 'text') {
        recordGroupId_(source.groupId, event.message.text);
      }
      if (event.type === 'postback') {
        handleLeavePostback_(event, event.webhookEventId || '');
      }
    }
  } catch (err) {
    console.error(err);
    if (requestKind === 'line') {
      // gateway แปลงผลนี้เป็น HTTP 502 เพื่อให้ LINE retry เหตุการณ์ที่ล้มเหลวชั่วคราว
      return jsonOutput_({ status: 'error', code: 'PROCESSING_FAILED' });
    }
    return jsonOutput_({ ok: false, code: 'REQUEST_REJECTED', error: 'คำขอไม่ผ่านการตรวจสอบ' });
  }

  return jsonOutput_({ status: 'ok' });
}

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function allowUnsignedLineWebhook_() {
  return String(PropertiesService.getScriptProperties().getProperty('ALLOW_UNSIGNED_LINE_WEBHOOK') || '')
    .trim().toUpperCase() === 'TRUE';
}

/** จับคู่กลุ่มด้วยรหัสใช้ครั้งเดียวอายุ 10 นาทีเท่านั้น — event กลุ่มทั่วไปห้ามแก้ปลายทาง */
function recordGroupId_(groupId, messageText) {
  const id = String(groupId || '').trim();
  if (!/^C[0-9a-f]{32}$/i.test(id)) return false;
  const props = PropertiesService.getScriptProperties();
  const code = String(props.getProperty('LINE_GROUP_PAIRING_CODE') || '').trim();
  const expiresAt = Number(props.getProperty('LINE_GROUP_PAIRING_EXPIRES_AT') || '0');
  const message = String(messageText || '').trim();
  if (!code || Date.now() > expiresAt || message !== 'เชื่อมกลุ่ม ' + code) return false;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('ระบบกำลังจับคู่กลุ่มอื่นอยู่ กรุณาลองใหม่');
  try {
    // ตรวจซ้ำหลังได้ lock กันข้อความรหัสเดียวกันจากสองกลุ่มพร้อมกัน
    if (props.getProperty('LINE_GROUP_PAIRING_CODE') !== code ||
        Date.now() > Number(props.getProperty('LINE_GROUP_PAIRING_EXPIRES_AT') || '0')) return false;
    setSettingValue_('line_group_id', id);
    SpreadsheetApp.flush();
    props.deleteProperty('LINE_GROUP_PAIRING_CODE');
    props.deleteProperty('LINE_GROUP_PAIRING_EXPIRES_AT');
    logResult_(new Date(), 'line-group-pairing', 'จับคู่กลุ่ม LINE สำเร็จด้วยรหัสใช้ครั้งเดียว');
    return true;
  } finally {
    lock.releaseLock();
  }
}

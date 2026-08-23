/**
 * จุดเข้าเดียวของ deployment นี้ รับ 2 อย่าง (แยกเส้นทางด้วยโครงสร้าง body):
 * 1. Webhook จาก LINE — เดิมใช้แค่จับ Group ID ตอนติดตั้ง ตอนนี้เพิ่มรองรับปุ่มอนุมัติใบลา (postback)
 *    ดังนั้น deployment นี้ต้องค้างไว้ถาวรแล้ว (ไม่ใช่จับ Group ID แล้วปิดตามคำแนะนำเดิม)
 * 2. API ของหน้าฟอร์ม LIFF — body มีฟิลด์ apiAction (session/bind/submit/myLeaves/cancel/update/calendar/schedule)
 *    เรียกจาก GitHub Pages ด้วย POST Content-Type: text/plain (เลี่ยง CORS preflight ที่ Apps Script
 *    ตอบ OPTIONS ไม่ได้) — การตอบกลับเป็น JSON ที่ Apps Script ใส่ Access-Control-Allow-Origin: * ให้
 *
 * หมายเหตุด้านความปลอดภัย: endpoint นี้เป็น public URL และไม่สามารถตรวจ X-Line-Signature ได้
 * (Apps Script เข้าถึง custom request header ไม่ได้โดยตรง) จึงใช้ชั้นป้องกันแทน 3 ชั้น:
 *   - ทุก apiAction ต้องแนบ LINE access token ที่ระบบตรวจกับ api.line.me จริง (verifyLineToken_ ใน LeaveApi.gs)
 *   - ปุ่มอนุมัติตรวจว่า userId ของผู้กดตรงกับ "ผู้อนุมัติปัจจุบัน" ที่เก็บในหน้า Notion ของใบลานั้น
 *     (ผู้ปลอมต้องรูทั้ง pageId และ userId ของผู้อนุมัติจริงจึงจะผ่านได้)
 *   - dedup ด้วย webhookEventId กัน LINE ยิงซ้ำ (ตอบช้า) ทำให้ประมวลผลซ้ำสองรอบ
 * ผลกระทบของคนนอกยิงเข้ามาเองจึงจำกัดอยู่ที่ "ได้รับข้อความปฏิเสธ" เท่านั้น
 *
 * วิธีติดตั้ง (ครั้งแรก/จับ Group ID):
 * 1. Deploy > New deployment > เลือกประเภท "Web app"
 *    - Execute as: Me, Who has access: Anyone → กด Deploy แล้วคัดลอก Web app URL
 * 2. LINE Developers Console > channel (Messaging API tab): วาง URL ลงช่อง Webhook URL กด Verify
 *    เปิด "Use webhook" และ "Allow bot to join group chats"
 * 3. เชิญบอทเข้ากลุ่ม LINE แล้วพิมพ์ข้อความอะไรก็ได้ 1 ข้อความ — line_group_id จะถูกเติมในชีต Settings
 * 4. หลังจากนั้นปล่อย deployment นี้ค้างไว้ถาวร (ปุ่มอนุมัติใบลาและ API ของ LIFF วิ่งผ่าน URL เดียวกันนี้)
 *    ถ้าแก้โค้ดให้ Deploy > Manage deployments > Edit > New version เสมอ (URL ไม่เปลี่ยน)
 */

// API จากหน้า LIFF ใช้ GET (query params) — เพราะบาง WebView ตาม redirect 302 ของ POST ไปไม่ได้
// (browser ต้อง rewrite POST→GET ตาม spec ซึ่งเป็นจุดที่เพี้ยนได้ใน WebView รุ่นเก่า)
// รองรับ JSONP ด้วยผ่าน ?callback=fn — เหลือกสำรองกรณี CORS ถูกบล็อกทั้งคู่
function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.apiAction) {
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
    'ไม่ใช่หน้าเว็บสำหรับเปิดดูด้วยตนเอง — การตั้งค่าระบบทำที่ใดึ่งนี้แทน:</p>' +
    '<ol style="padding-left:20px">' +
    '<li><b>Google Sheet หลัก</b> — แก้ชีต Settings/Approvers/Holidays ได้ตรงๆ หรือใช้เมนู "ระบบแจ้งเตือนปฏิทิน"</li>' +
    '<li><b>หน้าเว็บตั้งค่า (ถ้าต้องการ)</b> — deploy จากโปรเจกต์ Apps Script แยกตามคู่มือ SETUP.md ข้อ 10</li>' +
    '</ol></div>'
  ).setTitle('ระบบแจ้งเตือนปฏิทิน');
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    // API จากหน้า LIFF (สัญญา: มีฟิลด์ apiAction) — ตอบ JSON กลับไปให้ browser
    if (body && body.apiAction) {
      return jsonOutput_(handleApiRequest_(body));
    }

    // Webhook จาก LINE (สัญญา: มีฟิลด์ events)
    const events = body.events || [];
    const webhookEventId = body.webhookEventId || '';
    events.forEach(event => {
      // เหตุการณ์ mode "standby" คือช่วง channel กำลังถูก migrate — เอกสาร LINE ให้เมินได้เลย
      if (event.mode === 'standby') return;
      const source = event.source || {};
      if (source.type === 'group' && source.groupId) {
        recordGroupId_(source.groupId);
      }
      if (event.type === 'postback') {
        handleLeavePostback_(event, webhookEventId);
      }
    });
  } catch (err) {
    // เก็บ error ไว้ดูใน Executions/Logs; ไม่ throw กลับไปหา LINE เพราะ LINE จะ retry รัวๆ ถ้าเห็น error
    console.error(err);
  }

  return jsonOutput_({ status: 'ok' });
}

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function recordGroupId_(groupId) {
  const sheet = SpreadsheetApp.getActive().getSheetByName('Settings');
  const lastRow = sheet.getLastRow();
  const data = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, 1).getValues() : [];

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === 'line_group_id') {
      sheet.getRange(3 + i, 2).setValue(groupId);
      return;
    }
  }
}

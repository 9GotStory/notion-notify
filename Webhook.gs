/**
 * รับ webhook จาก LINE ใช้ครั้งเดียวเพื่อดึง Group ID มาเติมในชีต Settings อัตโนมัติ
 *
 * วิธีใช้:
 * 1. Deploy > New deployment > เลือกประเภท "Web app"
 *    - Execute as: Me
 *    - Who has access: Anyone
 *    กด Deploy แล้วคัดลอก Web app URL ที่ได้
 * 2. ไปที่ LINE Developers Console > channel ที่ใช้ (Messaging API tab)
 *    - วาง URL จากข้อ 1 ลงช่อง Webhook URL แล้วกด Verify
 *    - เปิด "Use webhook"
 *    - เปิด "Allow bot to join group chats" (ค่าเริ่มต้นปิดไว้ ถ้าไม่เปิดจะเชิญบอทเข้ากลุ่มไม่ได้)
 * 3. เชิญบอทเข้ากลุ่ม LINE ที่จะใช้แจ้งเตือน แล้วพิมพ์ข้อความอะไรก็ได้ 1 ข้อความในกลุ่มนั้น
 * 4. เปิดชีต Settings จะเห็นค่า line_group_id ถูกเติมให้อัตโนมัติ
 *
 * หมายเหตุด้านความปลอดภัย: endpoint นี้เป็น public URL และไม่ได้ตรวจสอบ signature จาก LINE
 * (Apps Script Web App เข้าถึง custom request header อย่าง X-Line-Signature ไม่ได้โดยตรง
 * จึงไม่สามารถ verify แบบที่ LINE แนะนำในเอกสารทางการได้)
 * ผลกระทบที่เป็นไปได้จำกัดอยู่แค่การเขียนทับค่า line_group_id 1 ช่องในชีต Settings เท่านั้น
 * แนะนำให้ลบ/ปิด deployment นี้หลังจับ Group ID เสร็จ แล้วค่อย deploy ใหม่หากต้องจับ Group ID รอบใหม่
 * (เช่น ย้ายกลุ่ม หรือบอทถูกเตะออกแล้วเชิญกลับเข้าไปใหม่)
 *
 * หมายเหตุอีกข้อ: ฟังก์ชันนี้เขียนทับ line_group_id ทุกครั้งที่มีข้อความจากกลุ่มใดๆ ก็ตามที่บอทอยู่
 * (ข้อความล่าสุดชนะเสมอ) ถ้าบอทอยู่มากกว่า 1 กลุ่มพร้อมกัน (เช่น ระหว่างทดสอบ) group_id อาจถูกสลับ
 * ไปมาโดยไม่ตั้งใจ — ให้บอทอยู่กลุ่มเป้าหมายกลุ่มเดียวตลอดเวลาที่ deployment นี้ยัง active อยู่
 */

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const events = body.events || [];

    events.forEach(event => {
      const source = event.source || {};
      if (source.type === 'group' && source.groupId) {
        recordGroupId_(source.groupId);
      }
    });
  } catch (err) {
    // เก็บ error ไว้ดูใน Executions ของ Apps Script; ไม่ throw กลับไปหา LINE เพราะ LINE จะ retry รัวๆ ถ้าเห็น error
    console.error(err);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok' }))
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

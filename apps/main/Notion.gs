/** Notion HTTP client ร่วม: headers/resolve data source/query แบบวน cursor
 *  และ helper แปลงค่าจาก Notion (แชร์ทั้งปฏิทินงานและระบบลา) */

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
    throw new Error('database นี้ไม่มี data source ที่เข้าถึงได้ — โปรดตรวจสอบว่าแชร์ database ให้ integration แล้วหรือยัง (Connections ในเมนู "...")');
  }
  return data.data_sources[0].id;
}

// ยิง data-source query วนตาม next_cursor จนครบ (Notion ให้สูงสุด 100 รายการ/หน้า)
// กัน runaway ด้วยเพดานหน้า แต่ห้ามคืนข้อมูลบางส่วน: ถึงเพดานแล้ว throw ให้ caller แสดงว่าอ่านไม่ครบ
function queryNotionPages_(dataSourceId, payload, maxPages) {
  const limit = maxPages || 20;
  const results = [];
  let cursor = null;
  for (let i = 0; i < limit; i++) {
    const queryPayload = cursor ? Object.assign({}, payload, { start_cursor: cursor }) : payload;
    const response = UrlFetchApp.fetch('https://api.notion.com/v1/data_sources/' + dataSourceId + '/query', {
      method: 'post',
      contentType: 'application/json',
      headers: notionHeaders_(),
      payload: JSON.stringify(queryPayload),
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() >= 300) {
      throw new Error('ดึงข้อมูลจาก Notion ไม่สำเร็จ (' + response.getResponseCode() + '): ' + response.getContentText());
    }
    const data = JSON.parse(response.getContentText());
    results.push.apply(results, data.results || []);
    if (!data.has_more || !data.next_cursor) return results;
    cursor = data.next_cursor;
  }
  throw new Error('ข้อมูล Notion มีมากกว่าเพดาน ' + limit * 100 + ' รายการ จึงหยุดเพื่อไม่คืนผลลัพธ์ที่ไม่ครบ');
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

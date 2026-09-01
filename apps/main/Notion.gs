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
// แยกสถานะตามหน้าที่: LINE แจ้งเฉพาะงานที่ยังยืนยันอยู่ ส่วนปฏิทินต้องเก็บประวัติงานที่เสร็จแล้วด้วย
const NOTION_SEND_STATUSES = ['ยืนยันแล้ว'];
const NOTION_SCHEDULE_STATUSES = ['ยืนยันแล้ว', 'เสร็จสิ้น'];
const NOTION_STATUS_PROPERTY_TYPE = 'select'; // ใช้ 'status' หากเปลี่ยนชนิด property ใน Notion
const NOTION_DATA_SOURCE_CACHE_ = {};
const NOTION_MAX_ATTEMPTS_ = 4;

// ---------- อ่านข้อมูลจาก Notion ----------

function notionHeaders_() {
  const token = PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
  if (!token) throw new Error('ยังไม่ได้ตั้งค่า NOTION_TOKEN ใน Script Properties');
  return { Authorization: 'Bearer ' + token, 'Notion-Version': NOTION_VERSION };
}

function shouldRetryNotion_(responseCode, idempotent) {
  const code = Number(responseCode);
  return code === 429 || (!!idempotent && (code === 529 || (code >= 500 && code <= 599)));
}

function notionRetryDelayMs_(response, attempt) {
  const headers = response && typeof response.getHeaders === 'function' ? response.getHeaders() : {};
  const retryAfter = Number(headers['Retry-After'] || headers['retry-after']);
  const base = Number.isFinite(retryAfter) && retryAfter >= 0
    ? retryAfter * 1000
    : Math.min(4000, 500 * Math.pow(2, attempt));
  return Math.min(10000, base) + Math.floor(Math.random() * 250);
}

/** Retry 429 เสมอ; retry 5xx/529 และ network error เฉพาะคำขอที่ทำซ้ำแล้วผลเดิม */
function notionFetch_(url, options, idempotent) {
  let lastError = null;
  for (let attempt = 0; attempt < NOTION_MAX_ATTEMPTS_; attempt++) {
    try {
      const response = UrlFetchApp.fetch(url, options);
      if (!shouldRetryNotion_(response.getResponseCode(), idempotent) || attempt === NOTION_MAX_ATTEMPTS_ - 1) {
        return response;
      }
      Utilities.sleep(notionRetryDelayMs_(response, attempt));
    } catch (err) {
      lastError = err;
      if (!idempotent || attempt === NOTION_MAX_ATTEMPTS_ - 1) throw err;
      Utilities.sleep(Math.min(4000, 500 * Math.pow(2, attempt)) + Math.floor(Math.random() * 250));
    }
  }
  throw lastError || new Error('เรียก Notion ไม่สำเร็จ');
}

// database มี "data source" ซ่อนอยู่ข้างใน (Notion API ตั้งแต่เวอร์ชัน 2025-09-03) ต้อง resolve ก่อนค่อย query ได้
// ฐานข้อมูลทั่วไปที่ไม่ได้ตั้งค่าซับซ้อนจะมี data source เดียว จึงหยิบตัวแรกมาใช้ตรงๆ
function resolveDataSourceId_(databaseId) {
  if (!databaseId || String(databaseId).trim() === 'your_notion_database_id') {
    throw new Error('ยังไม่ได้ตั้งค่า notion_database_id ในชีต Settings (ยังเป็นค่าตัวอย่างอยู่)');
  }
  const cacheKey = String(databaseId).trim();
  if (NOTION_DATA_SOURCE_CACHE_[cacheKey]) return NOTION_DATA_SOURCE_CACHE_[cacheKey];
  const response = notionFetch_('https://api.notion.com/v1/databases/' + encodeURIComponent(cacheKey), {
    method: 'get',
    headers: notionHeaders_(),
    muteHttpExceptions: true,
  }, true);
  if (response.getResponseCode() >= 300) {
    throw new Error('เปิด Notion database ไม่ได้ (' + response.getResponseCode() + '): ' + response.getContentText());
  }
  const data = JSON.parse(response.getContentText());
  if (!data.data_sources || !data.data_sources.length) {
    throw new Error('database นี้ไม่มี data source ที่เข้าถึงได้ — โปรดตรวจสอบว่าแชร์ database ให้ integration แล้วหรือยัง (Connections ในเมนู "...")');
  }
  NOTION_DATA_SOURCE_CACHE_[cacheKey] = data.data_sources[0].id;
  return NOTION_DATA_SOURCE_CACHE_[cacheKey];
}

// ยิง data-source query วนตาม next_cursor จนครบ (Notion ให้สูงสุด 100 รายการ/หน้า)
// กัน runaway ด้วยเพดานหน้า แต่ห้ามคืนข้อมูลบางส่วน: ถึงเพดานแล้ว throw ให้ caller แสดงว่าอ่านไม่ครบ
function queryNotionPages_(dataSourceId, payload, maxPages) {
  const limit = maxPages || 20;
  const results = [];
  let cursor = null;
  for (let i = 0; i < limit; i++) {
    const queryPayload = cursor ? Object.assign({}, payload, { start_cursor: cursor }) : payload;
    const response = notionFetch_('https://api.notion.com/v1/data_sources/' + encodeURIComponent(dataSourceId) + '/query', {
      method: 'post',
      contentType: 'application/json',
      headers: notionHeaders_(),
      payload: JSON.stringify(queryPayload),
      muteHttpExceptions: true,
    }, true);
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

/** อัปเดตสถานะของงานในปฏิทินแบบ idempotent — ใช้เฉพาะ page ID ที่ได้จาก Notion query */
function updateNotionWorkStatus_(pageId, status) {
  const id = String(pageId || '').trim();
  const value = String(status || '').trim();
  if (!/^[0-9a-f-]{32,36}$/i.test(id)) throw new Error('Notion page ID ของงานไม่ถูกต้อง');
  if (!NOTION_SCHEDULE_STATUSES.includes(value)) throw new Error('สถานะงานปลายทางไม่ถูกต้อง');
  const statusValue = {};
  statusValue[NOTION_STATUS_PROPERTY_TYPE] = { name: value };
  const properties = {};
  properties[PROPS_NOTION.status] = statusValue;
  const response = notionFetch_('https://api.notion.com/v1/pages/' + encodeURIComponent(id), {
    method: 'patch',
    contentType: 'application/json',
    headers: notionHeaders_(),
    payload: JSON.stringify({ properties: properties }),
    muteHttpExceptions: true,
  }, true);
  if (response.getResponseCode() >= 300) {
    throw new Error('อัปเดตสถานะงานใน Notion ไม่สำเร็จ (' + response.getResponseCode() + '): ' +
      response.getContentText().substring(0, 200));
  }
}

/** เตรียม property เสริมของใบลาเมื่อมีการใช้ครั้งแรก — ไม่แก้ property อื่นของฐานข้อมูล */
function ensureLeaveSubstituteProperty_(dataSourceId) {
  const id = String(dataSourceId || '').trim();
  if (!id) throw new Error('ไม่พบ data source ของใบลา');
  const getResponse = notionFetch_('https://api.notion.com/v1/data_sources/' + encodeURIComponent(id), {
    method: 'get', headers: notionHeaders_(), muteHttpExceptions: true,
  }, true);
  if (getResponse.getResponseCode() >= 300) {
    throw new Error('ตรวจโครงสร้างฐานใบลาไม่สำเร็จ (' + getResponse.getResponseCode() + ')');
  }
  const data = JSON.parse(getResponse.getContentText());
  const existing = (data.properties || {})[PROPS_LEAVE.substitute];
  if (existing) {
    if (existing.type !== 'rich_text') throw new Error('property "' + PROPS_LEAVE.substitute + '" ใน Notion ต้องเป็น rich_text');
    return false;
  }
  const properties = {};
  properties[PROPS_LEAVE.substitute] = { rich_text: {} };
  const patchResponse = notionFetch_('https://api.notion.com/v1/data_sources/' + encodeURIComponent(id), {
    method: 'patch', contentType: 'application/json', headers: notionHeaders_(),
    payload: JSON.stringify({ properties: properties }), muteHttpExceptions: true,
  }, true);
  if (patchResponse.getResponseCode() >= 300) {
    throw new Error('เพิ่ม property "' + PROPS_LEAVE.substitute + '" ใน Notion ไม่สำเร็จ (' +
      patchResponse.getResponseCode() + ')');
  }
  return true;
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

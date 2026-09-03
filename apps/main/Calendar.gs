/** ปฏิทินการปฏิบัติงาน (Notion): query รายวัน/ล่วงหน้า + ตัวขยายงานหลายวัน
 *  + API ให้หน้าเว็บ /web/schedule/ (apiAction: schedule) */

function notionStatusFilters_(statuses) {
  if (!['select', 'status'].includes(NOTION_STATUS_PROPERTY_TYPE)) {
    throw new Error('NOTION_STATUS_PROPERTY_TYPE ต้องเป็น select หรือ status');
  }
  return (statuses || NOTION_SEND_STATUSES).map(status => {
    const filter = { property: PROPS_NOTION.status };
    filter[NOTION_STATUS_PROPERTY_TYPE] = { equals: status };
    return filter;
  });
}

function buildNotionQueryPayload_(todayStr, tomorrowStr, statuses) {
  const allowedStatusFilters = notionStatusFilters_(statuses);
  return {
    filter: {
      and: [
        { property: PROPS_NOTION.date, date: { on_or_after: todayStr + 'T00:00:00+07:00' } },
        { property: PROPS_NOTION.date, date: { before: tomorrowStr + 'T00:00:00+07:00' } },
        { or: allowedStatusFilters },
      ],
    },
    sorts: [{ property: PROPS_NOTION.date, direction: 'ascending' }],
    page_size: 100,
  };
}

// งานยืนยันแล้วที่วันเริ่มอยู่ก่อนวันนี้ — กรองวันสิ้นสุดจริงอีกครั้งก่อนเปลี่ยนสถานะ
function buildPastConfirmedSchedulePayload_(todayStr) {
  const statusFilters = notionStatusFilters_(NOTION_SEND_STATUSES);
  return {
    filter: { and: [
      { property: PROPS_NOTION.date, date: { before: todayStr + 'T00:00:00+07:00' } },
      { or: statusFilters },
    ] },
    sorts: [{ property: PROPS_NOTION.date, direction: 'ascending' }],
    page_size: 100,
  };
}

function getNotionItemsForDay_(date, databaseId) {
  const dataSourceId = resolveDataSourceId_(databaseId);

  const todayStr = Utilities.formatDate(date, 'Asia/Bangkok', 'yyyy-MM-dd');
  const tomorrowStr = Utilities.formatDate(new Date(date.getTime() + 86400000), 'Asia/Bangkok', 'yyyy-MM-dd');

  // หน้าต่างย้อนหลัง 92 วันเพื่อเก็บ "งานแบบช่วงวันที่" ที่เริ่มก่อนหน้าแต่ยังครอบคลุมวันนี้
  // (Notion filter เทียบวันเริ่มเท่านั้น) แล้วกรอง overlap จริงด้วย itemOverlapsRange_ อีกชั้น
  const payload = buildNotionQueryPayload_(shiftDateStr_(todayStr, -RANGE_PADDING_DAYS), tomorrowStr);

  return queryNotionPages_(dataSourceId, payload)
    .map(parseNotionPage_)
    .filter(item => itemOverlapsRange_(item, todayStr, tomorrowStr));
}

// ดึงข้อมูลส่วน "ล่วงหน้า" ตามค่า advance_notice_days ใน Settings (1–7, เว้นว่าง/ค่าอื่น = ปิด)
// คืน {date, items, leaves} เมื่อวันเป้าหมายมีงานหรือผู้ลาอย่างน้อยหนึ่งอย่าง ถ้าวันเป้าหมายว่างเปล่าคืน null
// (กลายเป็น null เองในวันศุกร์ที่มองไปเสาร์-อาทิตย์ เพราะไม่มีงาน/ผู้ลาในวันหยุด)
function collectAdvanceNotice_(now, settings) {
  const n = parseInt(String(settings.advance_notice_days || '').trim(), 10);
  if (!(n >= 1 && n <= 7)) return null;
  const targetDate = new Date(now.getTime() + n * 86400000);
  const items = getNotionItemsForDay_(targetDate, settings.notion_database_id);
  const leaves = getApprovedLeavesForDay_(targetDate, settings.leave_database_id);
  return items.length || leaves.length ? { date: targetDate, items: items, leaves: leaves } : null;
}

// ---------- งานแบบช่วงวันที่ (มีวันสิ้นสุด) ต้องนับทุกวันที่ครอบคลุม ----------

// Notion date filter เทียบได้เฉพาะ "วันเริ่ม" ของ property (ยืนยันจากเอกสาร API — ธง use_end
// มีเฉพาะ meeting-notes) งานที่เริ่มก่อนหน้าต่างที่สนใจแต่ยังไม่จบจึงตกไปตอน query
// วิธีแก้ตามแบบเดียวกับ getApprovedLeavesForDay_: ขยายหน้าต่าง query ย้อนหลัง PADDING_DAYS
// วัน แล้วกรอง overlap จริงฝั่งโค้ดด้วย itemOverlapsRange_ ข้างล่าง
const RANGE_PADDING_DAYS = 92; // ~3 เดือน — ครอบคลุมงานยาวข้ามเดือนในทางปฏิบัติ

// เลื่อนวันที่แบบ 'yyyy-MM-dd' ไปข้างหน้า/ข้างหลัง N วัน (UTC ล้วน ไม่พึ่ง timezone เครื่องรัน) — pure
function shiftDateStr_(dayStr, days) {
  return new Date(Date.parse(dayStr + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}

// งานคร่อมช่วง [fromStr, toStr) หรือไม่ (toStr เป็น exclusive — วันแรกที่ "ไม่"นับ) — pure
// รับได้ทั้งวันที่ล้วนและ datetime แบบ 'yyyy-MM-ddTHH:mm:ss+07:00' (ตัดเอาแค่ส่วนวันที่)
function itemOverlapsRange_(item, fromStr, toStr) {
  if (!item.start) return false;
  const startDay = item.start.slice(0, 10);
  const lastDay = (item.end || item.start).slice(0, 10);
  return startDay < toStr && lastDay >= fromStr;
}

// จบเมื่อ "วันสิ้นสุด" ผ่านไปแล้ว; งานหลายวันจึงไม่ถูกปิดตั้งแต่วันแรก
function scheduleItemEndedBefore_(item, todayStr) {
  if (!item || !item.start) return false;
  return String(item.end || item.start).slice(0, 10) < todayStr;
}

/** เปลี่ยนเฉพาะงานยืนยันแล้วที่พ้นวันสิ้นสุดเป็นเสร็จสิ้น คืนจำนวนที่อัปเดต */
function completePastScheduleItems_(now, databaseId) {
  const id = String(databaseId || '').trim();
  if (!id || id === 'your_notion_database_id') return 0;
  const todayStr = Utilities.formatDate(now || new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  const pages = queryNotionPages_(resolveDataSourceId_(id), buildPastConfirmedSchedulePayload_(todayStr));
  let updated = 0;
  pages.forEach(page => {
    const item = parseNotionPage_(page);
    if (!scheduleItemEndedBefore_(item, todayStr)) return;
    updateNotionWorkStatus_(item.pageId, 'เสร็จสิ้น');
    updated++;
  });
  return updated;
}

// ---------- ตารางงานสำหรับหน้าเว็บ /schedule/ (apiAction: schedule) ----------

// แปลง 'YYYY-MM' เป็นช่วงวันที่ [วันแรกของเดือน, วันแรกของเดือนถัดไป) — pure
function scheduleMonthBounds_(month) {
  const parts = month.split('-').map(Number);
  const from = parts[0] + '-' + String(parts[1]).padStart(2, '0') + '-01';
  const to = parts[1] === 12
    ? (parts[0] + 1) + '-01-01'
    : parts[0] + '-' + String(parts[1] + 1).padStart(2, '0') + '-01';
  return { from: from, to: to };
}

// วงเดือนที่ให้ดู (นับจากเดือนปัจจุบัน): โหมดสาธารณะแคบ — endpoint สาธารณะไม่ควรถูกใช้ดึงตาราง
// ย้อนหลังเป็นปีๆ / โหมดเจ้าหน้าที่ (ตรวจ token ผ่าน) กว้าง ±12 เดือน
// ค่าวงถูกส่งกลับไปกับ response (viewMonths) ให้หน้าเว็บสร้างรายการเดือนจากค่าเดียวกัน — ไม่มิเรอร์ค่าคงที่อีกฝั่ง
const SCHEDULE_VIEW_BACK_PUBLIC = -1;
const SCHEDULE_VIEW_FWD_PUBLIC = 6;
const SCHEDULE_VIEW_BACK_FULL = -12;
const SCHEDULE_VIEW_FWD_FULL = 12;

// เดือนอยู่ในวง [back, fwd] นับจากเดือนปัจจุบันไหม — pure (รับเดือนแบบ 'YYYY-MM')
function scheduleMonthAllowed_(currentMonth, month, back, fwd) {
  const [cy, cm] = currentMonth.split('-').map(Number);
  const [y, m] = month.split('-').map(Number);
  const diff = (y - cy) * 12 + (m - cm);
  return diff >= back && diff <= fwd;
}

// แถวตารางงานของงานหนึ่งรายการ "ในวันใดวันหนึ่ง" — โหมดสาธารณะ (full=false) ตัดฟิลด์ภายในออก
// (ผู้รับผิดชอบ/รายละเอียด/หมายเหตุ เก็บไว้ให้บัญชี LINE ที่ลงทะเบียนแล้วเท่านั้น)
function toScheduleItem_(item, dateStr, full) {
  const row = {
    date: dateStr,
    title: item.title,
    time: itemTimeLabel_(item),
    // ป้ายช่วงวันที่ของงานหลายวัน (ว่าง = งานวันเดียว) — เป็นข้อมูลตารางงาน ไม่ใช่ฟิลด์ภายใน จึงส่งทั้งโหมดสาธารณะ
    range: itemRangeLabel_(item),
    location: item.location || '',
  };
  if (full) {
    row.assignees = item.assignees.join(', ');
    row.details = item.details || '';
    row.notes = item.notes || '';
  }
  return row;
}

// ขยายงานเป็นรายการรายวันทุกวันที่มันครอบคลุม ภายในหน้าต่าง [fromStr, toStr) เท่านั้น
// งานวันเดียวคืน 1 แถว / งานคร่อมข้ามเดือนคืนเฉพาะวันที่อยู่ในหน้าต่าง — pure
// (กันลูปยาวผิดปกติด้วยเพดาน 370 วัน ≈ 1 ปี ต่อหนึ่งงาน)
function expandScheduleRows_(item, fromStr, toStr, full) {
  const rows = [];
  if (!item.start) return rows;
  const lastDay = (item.end || item.start).slice(0, 10);
  let cursor = item.start.slice(0, 10);
  if (cursor < fromStr) cursor = fromStr;
  for (let i = 0; i < 370 && cursor <= lastDay && cursor < toStr; i++) {
    rows.push(toScheduleItem_(item, cursor, full));
    cursor = shiftDateStr_(cursor, 1);
  }
  return rows;
}

/** งานนี้มีผู้รับผิดชอบตรงกับชื่อที่กำหนดไหม (รวม "ทุกคน") — pure
 *  แนติกนี้ถูกมิเรอร์ไว้ที่หน้าเว็บ /schedule/ (isMine) สำหรับชิปกรอง "เฉพาะงานที่ฉันรับผิดชอบ" */
function assigneeMatches_(assignees, firstName) {
  return (assignees || []).some(name => name === firstName || name === 'ทุกคน');
}

/** งาน (สถานะยืนยันแล้ว) ที่คร่อมช่วง [fromStr, toStr) และมีผู้รับผิดชอบตรงกับชื่อที่กำหนด (รวม "ทุกคน")
 *  ใช้เตือนตอนยื่น/แก้ไขใบลาว่า "ในช่วงลามีงานที่คุณรับผิดชอบอยู่" — เตือนเท่านั้น ไม่บล็อก */
function getItemsForAssigneeInRange_(settings, firstName, fromStr, toStr) {
  if (!firstName || !settings.notion_database_id ||
      String(settings.notion_database_id).trim() === 'your_notion_database_id') return [];
  const payload = buildNotionQueryPayload_(shiftDateStr_(fromStr, -RANGE_PADDING_DAYS), toStr);
  return queryNotionPages_(resolveDataSourceId_(settings.notion_database_id), payload)
    .map(parseNotionPage_)
    .filter(item => itemOverlapsRange_(item, fromStr, toStr))
    .filter(item => assigneeMatches_(item.assignees, firstName));
}

function apiSchedule_(body) {
  const month = String((body && body.month) || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return { ok: false, error: 'รูปแบบเดือนไม่ถูกต้อง (YYYY-MM)' };
  }

  // โหมดเต็ม: บัญชี LINE ที่ตรวจ token ผ่าน + ลงทะเบียนในทำเนียบแล้วเท่านั้น
  // ตรวจก่อนเพราะ "วงเดือนที่ดูได้" ขึ้นกับโหมด / token หมดอายุ-ไม่ถูกต้อง → เงียบๆ ให้ดูแบบสาธารณะไปก่อน
  let full = false;
  let viewer = '';
  const token = String((body && body.accessToken) || '').trim();
  if (token) {
    try {
      const profile = verifyLineToken_(token);
      const staff = findStaffByUserId_(readStaffRoster_(), profile.userId);
      if (staff) {
        full = true;
        // ชื่อต้นของผู้ดู — key เดียวกับผู้รับผิดชอบใน Notion ให้หน้าเว็บกรอง "เฉพาะงานที่ฉันรับผิดชอบ"
        viewer = staff.firstName;
      }
    } catch (err) { /* ไม่มี token ที่ใช้ได้ → โหมดสาธารณะ */ }
  }

  const currentMonth = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM');
  const viewBack = full ? SCHEDULE_VIEW_BACK_FULL : SCHEDULE_VIEW_BACK_PUBLIC;
  const viewFwd = full ? SCHEDULE_VIEW_FWD_FULL : SCHEDULE_VIEW_FWD_PUBLIC;
  if (!scheduleMonthAllowed_(currentMonth, month, viewBack, viewFwd)) {
    return { ok: false, error: full
      ? 'ดูได้ย้อนหลังและล่วงหน้าไม่เกิน 12 เดือน'
      : 'ดูได้ย้อนหลัง 1 เดือน และล่วงหน้าไม่เกิน 6 เดือน' };
  }

  const settings = getSettings_();
  if (!settings.notion_database_id || String(settings.notion_database_id).trim() === 'your_notion_database_id') {
    return { ok: false, error: 'ยังไม่ได้ตั้งค่า notion_database_id — ติดต่อผู้ดูแลระบบ' };
  }
  const bounds = scheduleMonthBounds_(month);
  // endpoint นี้เป็นสาธารณะ (ไม่ต้อง login) — กันถูกยิงรัวจนกระทบโควตา UrlFetch/Notion ของทั้งระบบ
  // ด้วย cache ฝั่งสคริปต์ 5 นาที แยกตามเดือน+โหมด (สาธารณะ/เต็ม) — ตารางงานเปลี่ยนไม่บ่อยกว่านี้อยู่แล้ว
  const cache = CacheService.getScriptCache();
  const cacheKey = 'schedule_' + month + (full ? '_full' : '_pub');
  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      // viewer เป็นข้อมูลรายบุคคล — cache โหมดเต็มแชร์กันทุกเจ้าหน้าที่ จึงต่อชื่อตอนคืนค่า ไม่เก็บลง cache
      const result = JSON.parse(cached);
      if (viewer) result.viewer = viewer;
      return result;
    } catch (err) { /* ค่าใน cache เสีย → ดึงใหม่ด้านล่าง */ }
  }

  // หน้าต่างย้อนหลัง 92 วันเพื่อเก็บงานแบบช่วงวันที่ที่เริ่มก่อนเดือนนี้แต่ยังครอบคลุมอยู่
  const payload = buildNotionQueryPayload_(
    shiftDateStr_(bounds.from, -RANGE_PADDING_DAYS), bounds.to, NOTION_SCHEDULE_STATUSES);
  const dataSourceId = resolveDataSourceId_(settings.notion_database_id);
  const results = queryNotionPages_(dataSourceId, payload);

  // งานแบบช่วงวันที่ถูกขยายเป็นรายวัน แสดงเฉพาะวันที่อยู่ในเดือนที่กำลังดู
  const items = [];
  results.forEach(page => {
    expandScheduleRows_(parseNotionPage_(page), bounds.from, bounds.to, full).forEach(row => items.push(row));
  });
  items.sort((a, b) => a.date === b.date
    ? a.title.localeCompare(b.title, 'th')
    : (a.date < b.date ? -1 : 1));

  // ส่วนผู้ลา (ใบอนุมัติแล้วเท่านั้น): ส่งเฉพาะโหมดเจ้าหน้าที่ — ชื่อบุคลากรเป็นข้อมูลภายใน
  // เหมือนผู้รับผิดชอบ/รายละเอียด/หมายเหตุ (โหมดสาธารณะได้ items เท่านั้น จึงไม่ต้องกังวลเรื่อง cache รั่ว)
  const leaves = [];
  if (full) {
    getApprovedLeavesForRange_(new Date(), settings.leave_database_id, bounds.from, bounds.to)
      .forEach(leave => expandScheduleLeaveRows_(leave, bounds.from, bounds.to, readHolidaySet_()).forEach(row => leaves.push(row)));
    leaves.sort((a, b) => a.date === b.date
      ? a.name.localeCompare(b.name, 'th')
      : (a.date < b.date ? -1 : 1));

    // คนลาชนงานที่รับผิดชอบ: ต่องานแต่ละวันด้วยชื่อผู้รับผิดชอบที่กำลังลาในวันนั้น (ให้หน้าเว็บขึ้น ⚠)
    const leaveNamesByDate = {};
    leaves.forEach(row => {
      (leaveNamesByDate[row.date] = leaveNamesByDate[row.date] || new Set()).add(row.name);
    });
    items.forEach(row => {
      const onLeave = conflictingAssignees_(row.assignees, leaveNamesByDate[row.date]);
      if (onLeave.length) row.assigneesOnLeave = onLeave;
    });
  }
  const result = { ok: true, month: month, full: full, viewMonths: { back: viewBack, fwd: viewFwd }, items: items, leaves: leaves };
  // เหตุผลเดียวกับด้านบน: cache เก็บข้อมูลตารางรวมได้ แต่ชื่อผู้ดูต่อท้ายตอนคืนค่าเท่านั้น
  try { cache.put(cacheKey, JSON.stringify(result), 300); } catch (err) { /* เกินขนาด cache → ข้าม */ }
  if (viewer) result.viewer = viewer;
  return result;
}

function parseNotionPage_(page) {
  const props = page.properties || {};
  const dateProp = (props[PROPS_NOTION.date] && props[PROPS_NOTION.date].date) || null;
  const statusProp = props[PROPS_NOTION.status] || {};
  const statusValue = statusProp.select || statusProp.status || null;
  const isDatetime = !!(dateProp && dateProp.start && dateProp.start.indexOf('T') !== -1);
  return {
    pageId: String(page.id || ''),
    title: plainText_(props[PROPS_NOTION.title] && props[PROPS_NOTION.title].title) || '(ไม่มีชื่องาน)',
    start: dateProp ? dateProp.start : null,
    end: dateProp ? dateProp.end : null,
    isDatetime: isDatetime,
    status: statusValue ? statusValue.name : '',
    assignees: ((props[PROPS_NOTION.assignee] && props[PROPS_NOTION.assignee].multi_select) || []).map(o => o.name),
    location: plainText_(props[PROPS_NOTION.location] && props[PROPS_NOTION.location].rich_text),
    details: plainText_(props[PROPS_NOTION.details] && props[PROPS_NOTION.details].rich_text),
    notes: plainText_(props[PROPS_NOTION.notes] && props[PROPS_NOTION.notes].rich_text),
  };
}

function itemTimeLabel_(item) {
  if (!item.isDatetime || !item.start) return 'ทั้งวัน';
  const startTime = formatNotionTime_(item.start);
  if (!startTime) return 'ทั้งวัน';
  const endTime = formatNotionTime_(item.end);
  return endTime ? startTime + '–' + endTime : startTime;
}

// รายละเอียดย่อย (ผู้รับผิดชอบ/สถานที่/รายละเอียด/หมายเหตุ) คืนเป็น {label, value} เฉพาะฟิลด์ที่มีค่าเท่านั้น
// ฟิลด์ว่างจะไม่ถูกรวมมาเลย ให้ผู้เรียก (text/flex) จัดรูปแบบการแสดงผลของตัวเองต่อ
function itemSubFields_(item) {
  const fields = [];
  if (item.assignees.length) fields.push({ label: 'ผู้รับผิดชอบ', value: item.assignees.join(', ') });
  if (item.location) fields.push({ label: 'สถานที่', value: item.location });
  if (item.details) fields.push({ label: 'รายละเอียด', value: item.details });
  if (item.notes) fields.push({ label: 'หมายเหตุ', value: item.notes });
  return fields;
}

// ป้ายช่วงวันที่ของงานแบบหลายวัน ("30–31 ส.ค. 2569" / ข้ามเดือน "30 ส.ค. – 2 ก.ย. 2569")
// คืน '' เมื่องานวันเดียว — ใช้ฟอร์แมตเดียวกับการ์ดใบลา (leaveDateLabel_) ให้ทั้งระบบสม่ำเสมอกัน
function itemRangeLabel_(item) {
  if (!item.start || !item.end) return '';
  const startDay = item.start.slice(0, 10);
  const endDay = item.end.slice(0, 10);
  if (endDay === startDay) return '';
  return leaveDateLabel_(startDay, endDay);
}

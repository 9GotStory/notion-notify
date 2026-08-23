/** ดึงใบลาเพื่อรายงาน/แสดงผล: ผู้ลาวันนี้ (สรุปเช้า), ผู้ลาในหน้าตารางงาน,
 *  และสรุปวันลารายเดือนแนบข้อความเช้า */

// ---------- Notion: สร้าง/อ่าน/แก้ใบลา ----------

function resolveLeaveDataSourceId_(databaseId) {
  if (!databaseId || String(databaseId).trim() === 'your_leave_database_id') {
    throw new Error('ยังไม่ได้ตั้งค่า leave_database_id ในชีต Settings');
  }
  return resolveDataSourceId_(databaseId);
}

// ---------- ดึงใบลาที่อนุมัติแล้วสำหรับสรุปเช้า (เรียกจาก Summary.gs) ----------

/**
 * คืนใบลาสถานะ "อนุมัติ" ที่คร่อม todayStr (แสดงเฉพาะที่อนุมัติแล้ว — ใบที่ยังรอไม่เปิดเผย
 * ให้สอดคล้องกับหลักความเป็นส่วนตัวของการอนุมัติแบบ 1:1)
 * ถ้ายังไม่ได้ตั้งค่า leave_database_id จะคืน [] พร้อม log ให้เห็นว่าข้ามส่วนนี้ไป (ไม่กระทบการส่งเช้าหลัก)
 */
function getApprovedLeavesForDay_(now, leaveDatabaseId) {
  const dbId = String(leaveDatabaseId || '').trim();
  if (!dbId || dbId === 'your_leave_database_id') {
    logResult_(now, 'skip-leave', 'ยังไม่ได้ตั้งค่า leave_database_id — ข้ามส่วนผู้ลาวันนี้');
    return [];
  }
  const todayStr = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd');
  const dataSourceId = resolveLeaveDataSourceId_(dbId);
  const payload = {
    filter: { property: PROPS_LEAVE.status, select: { equals: LEAVE_STATUS.approved } },
    sorts: [{ property: PROPS_LEAVE.date, direction: 'descending' }],
    page_size: 100,
  };
  const response = UrlFetchApp.fetch('https://api.notion.com/v1/data_sources/' + dataSourceId + '/query', {
    method: 'post',
    contentType: 'application/json',
    headers: notionHeaders_(),
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() >= 300) {
    throw new Error('ดึงใบลาจาก Notion ไม่สำเร็จ (' + response.getResponseCode() + '): ' + response.getContentText());
  }
  const data = JSON.parse(response.getContentText());
  const holidays = readHolidaySet_();
  let roster = null;
  try { roster = readStaffRoster_(); } catch (err) { /* ไม่มีชีต Staff → ตัดชื่อจากชื่อเต็มแทน */ }
  return (data.results || [])
    .map(parseLeavePage_)
    // กรอง overlap ฝั่งโค้ดแทนฝาก semantics ของ date-range filter ไว้กับ Notion (ดูหมายเหตุใน getNotionItemsForDay_)
    .filter(leave => leave.start && leaveRangeOverlap_(leave.start, leave.end, todayStr))
    // เก็บข้อมูลเชิงบริบทสำหรับสรุปเช้า: ชื่อเฉพาะ / ครึ่งวัน / วันที่เท่าไหร่ของช่วง / กลับวันทำการถัดไป
    .map(leave => enrichLeaveForDisplay_(leave, todayStr, holidays, roster))
    // เรียงตามชื่อ (ส่วนแสดงผลเป็นบรรทัดเดียวต่อคน ไม่มีกลุ่มงาน จึงเรียงชื่อให้อ่านไล่ง่าย)
    .sort((a, b) => (a.firstName || a.fullName).localeCompare(b.firstName || b.fullName, 'th'));
}

// ---------- ผู้ลาในหน้าตารางงาน /schedule/ (โหมดเจ้าหน้าที่เท่านั้น — ชื่อบุคลากรเป็นข้อมูลภายใน) ----------

/**
 * ใบลาสถานะ "อนุมัติ" ที่ช่วงวันคร่อม [fromStr, toStr) — สำหรับแสดงในหน้าตารางงาน
 * แสดงเฉพาะใบอนุมัติแล้วเหมือนสรุปเช้า (ใบที่รออนุมัติไม่เปิดเผย)
 * คืน [] เงียบๆ ถ้ายังไม่ตั้ง leave_database_id หรืออ่านไม่สำเร็จ (หน้าตารางงานต้องไม่พังเพราะระบบลา)
 * ใบแต่ละใบจะมี firstName ติดมาด้วย (จากชีต Staff ตาม userId — เหมือนส่วน "ผู้ลาวันนี้")
 */
function getApprovedLeavesForRange_(now, leaveDatabaseId, fromStr, toStr) {
  const dbId = String(leaveDatabaseId || '').trim();
  if (!dbId || dbId === 'your_leave_database_id') return [];
  try {
    // Notion date filter เทียบวันเริ่มเท่านั้น — ต้องขยายหน้าต่างย้อนหลังแบบเดียวกับ query ปฏิทินงาน
    // เพื่อเก็บใบลายาวที่เริ่มก่อนเดือนที่ดูแต่ยังคร่อมอยู่ (กรอง overlap จริงอีกทีที่ตัวขยายรายวัน)
    const payload = {
      filter: {
        and: [
          { property: PROPS_LEAVE.status, select: { equals: LEAVE_STATUS.approved } },
          { property: PROPS_LEAVE.date, date: { on_or_after: shiftDateStr_(fromStr, -RANGE_PADDING_DAYS) + 'T00:00:00+07:00' } },
          { property: PROPS_LEAVE.date, date: { before: toStr + 'T00:00:00+07:00' } },
        ],
      },
      page_size: 100,
    };
    const leaves = queryNotionPages_(resolveLeaveDataSourceId_(dbId), payload).map(parseLeavePage_);
    let roster = null;
    try { roster = readStaffRoster_(); } catch (err) { /* ไม่มีชีต Staff → ใช้ชื่อเต็มแทน */ }
    return leaves
      .filter(leave => leave.start)
      .map(leave => Object.assign({}, leave, { firstName: leaveFirstName_(leave, roster) }));
  } catch (err) {
    logResult_(now, 'error', 'ดึงผู้ลาสำหรับหน้าตารางงานไม่สำเร็จ: ' + err);
    return [];
  }
}

/** ขยายใบลาหนึ่งใบเป็นแถวรายวัน ภายในหน้าต่าง [fromStr, toStr) เฉพาะ "วันที่นับเป็นวันลา" (pure)
 *  = วันทำการเท่านั้น (ข้ามเสาร์-อาทิตย์และวันหยุดใน holidaySet จากชีต Holidays) ให้ตรงกับวิธีนับ
 *  จำนวนวันทำการของใบลา — ไม่ใช่ทุกวันปฏิทินแบบงานปฏิทิน เพราะวันหยุดไม่เคยมีงาน การ์ดลาในวันหยุด
 *  จึงทำให้เกิดหัวข้อวันเปล่าๆ (มีเพดาน 370 วันกันลูปยาวผิดปกติเหมือน expandScheduleRows_) */
function expandScheduleLeaveRows_(leave, fromStr, toStr, holidaySet) {
  const rows = [];
  if (!leave.start) return rows;
  const holidays = holidaySet || new Set();
  const lastDay = leave.end || leave.start;
  let cursor = leave.start < fromStr ? fromStr : leave.start;
  for (let i = 0; i < 370 && cursor <= lastDay && cursor < toStr; i++) {
    if (!isWeekendDateStr_(cursor) && !holidays.has(cursor)) {
      rows.push({
        date: cursor,
        name: leave.firstName || leave.fullName,
        type: leave.leaveType,
        // ใบหลายวันแสดงช่วงเต็มทุกวัน (เหมือนงานหลายวัน) / ครึ่งวันแสดงเฉพาะใบวันเดียว
        range: lastDay !== leave.start ? leaveDateLabel_(leave.start, lastDay) : '',
        period: (leave.period === 'ครึ่งวันเช้า' || leave.period === 'ครึ่งวันบ่าย') ? leave.period : '',
      });
    }
    cursor = shiftDateStr_(cursor, 1);
  }
  return rows;
}

// ---------- สรุปวันลารายเดือน (แนบท้ายข้อความเช้าวันทำการแรกของแต่ละเดือน) ----------

// เดือนก่อนหน้าจาก 'YYYY-MM' — pure
function previousMonthKey_(monthKey) {
  const parts = String(monthKey).split('-').map(Number);
  return parts[1] === 1 ? (parts[0] - 1) + '-12' : parts[0] + '-' + String(parts[1] - 1).padStart(2, '0');
}

/** ใบลาสถานะ "อนุมัติ" ที่เริ่มในเดือนที่กำหนด (นับตามวันเริ่มของใบ — semantics เดียวกับยอดใช้รายปี
 *  ใบคร่อมเดือนจึงรวมอยู่เดือนที่เริ่มเท่านั้น ไม่หักแยกข้ามเดือน)
 *  ถ้ายังไม่ตั้งค่า leave_database_id คืน [] พร้อม log (แบบเดียวกับ getApprovedLeavesForDay_) */
function getApprovedLeavesForMonth_(now, leaveDatabaseId, monthKey) {
  const dbId = String(leaveDatabaseId || '').trim();
  if (!dbId || dbId === 'your_leave_database_id') {
    logResult_(now, 'skip-leave-monthly', 'ยังไม่ได้ตั้งค่า leave_database_id — ข้ามสรุปวันลารายเดือน');
    return [];
  }
  const bounds = scheduleMonthBounds_(monthKey); // {from, to} — to เป็นวันแรกของเดือนถัดไป (exclusive)
  const payload = {
    filter: {
      and: [
        { property: PROPS_LEAVE.status, select: { equals: LEAVE_STATUS.approved } },
        { property: PROPS_LEAVE.date, date: { on_or_after: bounds.from + 'T00:00:00+07:00' } },
        { property: PROPS_LEAVE.date, date: { before: bounds.to + 'T00:00:00+07:00' } },
      ],
    },
    page_size: 100,
  };
  return queryNotionPages_(resolveLeaveDataSourceId_(dbId), payload).map(parseLeavePage_);
}

/** รวมใบลาเป็นรายคน×ประเภทสำหรับสรุปเดือน (pure) — เรียงชื่อไทยเหมือนส่วน "ผู้ลาวันนี้" */
function aggregateLeavesByPersonMonth_(leaves) {
  const byPerson = {};
  (leaves || []).forEach(leave => {
    if (!leave.start || !leave.leaveType) return;
    const name = leave.fullName || '(ไม่ทราบชื่อ)';
    if (!byPerson[name]) byPerson[name] = { name: name, byType: {}, total: 0 };
    byPerson[name].byType[leave.leaveType] = (byPerson[name].byType[leave.leaveType] || 0) + (leave.workDays || 0);
    byPerson[name].total += leave.workDays || 0;
  });
  return Object.keys(byPerson)
    .map(k => byPerson[k])
    .sort((a, b) => a.name.localeCompare(b.name, 'th'));
}

// ตัวเลขวันลาแบบไม่มีหน่วยติดมา (เช่น "2", "1½") — คู่กับ workDaysLabel_ ที่ติด " วัน" มาให้
// ใช้เมื่อผู้เรียกจะต่อหน่วยเอง เช่น "1½ วันทำการ"
function workDaysShortLabel_(days) {
  const whole = Math.floor(days);
  const half = days - whole >= 0.5;
  return (whole > 0 ? whole : '') + (half ? '½' : '');
}

/** สรุปเดือนแบบโครงสร้าง (ใช้ทั้งข้อความ text และแถว flex) — pure
 *  คืน { title, lines, totalLine, grandTotal } หรือ null เมื่อเดือนนั้นไม่มีใบลาเลย */
function buildMonthlyLeaveSummary_(monthKey, aggregates) {
  if (!aggregates || !aggregates.length) return null;
  const parts = String(monthKey).split('-').map(Number);
  const title = '📊 สรุปวันลาประจำเดือน' + THAI_MONTH_NAMES[parts[1] - 1] + ' ' + (parts[0] + 543);
  let grandTotal = 0;
  const lines = aggregates.map(row => {
    grandTotal += row.total;
    const types = Object.keys(row.byType)
      .map(type => type + ' ' + workDaysLabel_(row.byType[type]))
      .join(', ');
    return '• ' + row.name + ' — ' + types + ' (รวม ' + workDaysShortLabel_(row.total) + ' วันทำการ)';
  });
  return {
    title: title,
    lines: lines,
    totalLine: 'รวมทั้งเดือน ' + workDaysShortLabel_(grandTotal) + ' วันทำการ',
    grandTotal: grandTotal,
  };
}

/** เตรียมส่วนสรุปวันลารายเดือนสำหรับข้อความเช้า — คืน { currentMonth, summary } หรือ null
 *  เงื่อนไข: สวิตช์ monthly_leave_summary_enabled ไม่ใช่ FALSE + ยังไม่เคยส่งสรุปของเดือนปัจจุบัน
 *  (เดือนที่สรุปคือเดือนก่อนหน้าที่เพิ่งจบ; วันทำการแรกของเดือน = การรันเช้าครั้งแรกของเดือนนั้น
 *  เพราะการรันเช้าข้ามวันหยุดไปแล้ว) — summary เป็น null ได้เมื่อเดือนก่อนไม่มีใครลาเลย
 *  ไม่ upsert marker เอง: ผู้เรียก mark หลังส่งสำเร็จเท่านั้น (ผิดพลาดวันนั้น = ลองใหม่วันถัดไป) */
function maybeCollectMonthlyLeaveSummary_(now, settings, props) {
  if (String(settings.monthly_leave_summary_enabled || '').trim().toUpperCase() === 'FALSE') return null;
  const currentMonth = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM');
  if (props.getProperty('last_monthly_leave_summary') === currentMonth) return null;
  const targetMonth = previousMonthKey_(currentMonth);
  const summary = buildMonthlyLeaveSummary_(
    targetMonth,
    aggregateLeavesByPersonMonth_(getApprovedLeavesForMonth_(now, settings.leave_database_id, targetMonth)));
  return { currentMonth: currentMonth, summary: summary };
}

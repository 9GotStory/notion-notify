/** คณิตศาสตร์วันลาตามระเบียบสำนักนายกฯ: วันทำการ/ครึ่งวัน/สิทธิ์ต่อปี/คำเตือน
 *  + ยอดใช้จริงจากใบลาใน Notion + ป้ายวันที่/ถ้อยคำทางการสำหรับแสดงผล */

// ---------- วันที่ / วันทำการ ----------

function bangkokTodayStr_() {
  return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
}

function isValidDateStr_(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function daysBetweenDateStrs_(startStr, endStr) {
  return Math.round(
    (new Date(endStr + 'T00:00:00Z') - new Date(startStr + 'T00:00:00Z')) / 86400000
  );
}

function isWeekendDateStr_(dateStr) {
  const dow = new Date(dateStr + 'T00:00:00Z').getUTCDay();
  return dow === 0 || dow === 6;
}

/** ตรวจ + มาตรฐานช่วงวันที่ของใบลา — throw เป็นภาษาไทยเมื่อไม่ผ่าน */
function parseLeaveDateRange_(start, end, todayStr) {
  const startStr = String(start || '').trim();
  const endStr = String(end || start || '').trim();
  if (!isValidDateStr_(startStr) || !isValidDateStr_(endStr)) {
    throw new Error('รูปแบบวันที่ไม่ถูกต้อง');
  }
  if (daysBetweenDateStrs_(startStr, endStr) < 0) {
    throw new Error('วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น');
  }
  if (daysBetweenDateStrs_(todayStr, startStr) > LEAVE_MAX_DAYS_AHEAD) {
    throw new Error('ยื่นล่วงหน้าได้ไม่เกิน ' + LEAVE_MAX_DAYS_AHEAD + ' วัน');
  }
  if (daysBetweenDateStrs_(startStr, todayStr) > LEAVE_MAX_DAYS_BACK) {
    throw new Error('ยื่นย้อนหลังได้ไม่เกิน ' + LEAVE_MAX_DAYS_BACK + ' วัน');
  }
  if (daysBetweenDateStrs_(startStr, endStr) > LEAVE_MAX_SPAN_DAYS) {
    throw new Error('ช่วงวันที่ยาวเกิน ' + LEAVE_MAX_SPAN_DAYS + ' วัน');
  }
  return { start: startStr, end: endStr };
}

/** นับวันทำการในช่วง (ข้ามเสาร์-อาทิตย์และวันหยุดใน holidaySet) — pure, รับ holidaySet เป็น Set ของ 'yyyy-MM-dd' */
function countBusinessDays_(startStr, endStr, holidaySet) {
  const holidays = holidaySet || new Set();
  let count = 0;
  for (let d = new Date(startStr + 'T00:00:00Z');
       d.getTime() <= new Date(endStr + 'T00:00:00Z').getTime();
       d = new Date(d.getTime() + 86400000)) {
    const dateStr = Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
    if (!isWeekendDateStr_(dateStr) && !holidays.has(dateStr)) count++;
  }
  return count;
}

/** ใบลาคร่อมวัน todayStr หรือไม่ (pure) */
function leaveRangeOverlap_(startStr, endStr, todayStr) {
  const effectiveEnd = endStr || startStr;
  return startStr <= todayStr && effectiveEnd >= todayStr;
}

// ---------- การคำนวณวันลาตามระเบียบสำนักนายกฯ ว่าด้วยการลาฯ (pure — ทดสอบได้) ----------

// ตรวจความถูกต้องของช่วงวัน + จับคู่กับประเภทที่ลาครึ่งวันได้ (ครึ่งวันใช้ได้เฉพาะลา 1 วัน)
function normalizeLeavePeriod_(period, leaveType, startStr, endStr) {
  const value = LEAVE_PERIODS.includes(period) ? period : 'เต็มวัน';
  const singleDay = !endStr || endStr === startStr;
  if (value !== 'เต็มวัน' && (!singleDay || !HALF_DAY_TYPES.includes(leaveType))) {
    return 'เต็มวัน'; // ครึ่งวันใช้ไม่ได้กับประเภท/ช่วงหลายวัน → คืนเป็นเต็มวันเงียบๆ
  }
  return value;
}

// จำนวนวันทำการของใบลา (ฐานวันทำการตามระเบียบ + ครึ่งวัน = 0.5 เมื่อลา 1 วัน)
function computeWorkDays_(startStr, endStr, holidaySet, period) {
  const days = countBusinessDays_(startStr, endStr || startStr, holidaySet);
  if (days === 1 && period !== 'เต็มวัน') return 0.5;
  return days;
}

// แปลงเป็นข้อความ เช่น 0.5 → "½ วัน" / 1 → "1 วัน" / 2.5 → "2½ วัน"
function workDaysLabel_(days) {
  const whole = Math.floor(days);
  const half = days - whole >= 0.5;
  if (days === 0.5) return '½ วัน';
  return (whole > 0 ? whole : '') + (half ? '½' : '') + ' วัน';
}

/**
 * คำเตือนตามระเบียบฯ สำหรับใบลาที่กำลังยื่น (pure)
 * usage = ยอดวันทำการที่ใช้ไปแล้วของปีนี้แยกตามประเภท (จาก getLeaveUsageForYear_) หรือ null ถ้าหาไม่ได้
 * effectiveQuota (ไม่บังคับ) = สิทธิ์สูงสุดหลังรวม "ยกมา" จากสมุดรายการปรับ (LeaveBalances) —
 *   ไม่ส่งมาใช้โควตาตามระเบียบ (LEAVE_QUOTAS) ตรงๆ ส่งมาเมื่อคนนั้นมีสิทธิ์สะสม/ปรับพิเศษ
 *   (used ที่เทียบต้องเป็นยอดที่ "รวมใช้เพิ่ม" แล้วด้วย จึงเทียบแอปเปิลกับแอปเปิล)
 * นโยบาย: "เตือนอย่างเดียว" — ไม่มีการบล็อก ให้ผู้อนุมัติใช้ดุลพินิจ (คำเตือนถูกเก็บลงใบลาและแสดงในการ์ด)
 */
function buildLeaveWarnings_(leaveType, workDays, usage, effectiveQuota) {
  const warnings = [];
  const used = usage ? (usage[leaveType] || 0) : 0;
  const quota = effectiveQuota != null ? effectiveQuota : LEAVE_QUOTAS[leaveType];

  if (quota != null && usage) {
    const total = used + workDays;
    if (total > quota) {
      warnings.push('⚠ เกินสิทธิ์ตามระเบียบ: ใช้ไปแล้ว ' + workDaysLabel_(used) + ' + ใบนี้ ' +
        workDaysLabel_(workDays) + ' = ' + workDaysLabel_(total) + ' (สิทธิ์สูงสุด ' + quota + ' วันทำการ/ปี)');
    } else if (total === quota) {
      warnings.push('ℹ ใบนี้ทำให้ครบสิทธิ์ ' + quota + ' วันทำการ/ปี พอดี — ใบถัดไปจะเกินสิทธิ์');
    }
  }
  if (leaveType === 'ลาพักร้อน' && workDays > 10) {
    warnings.push('⚠ ลาพักผ่อนเกิน 10 วันทำการ/ครั้ง — ตามระเบียบต้องเป็นการใช้สิทธิ์สะสม (รวมต่อครั้งไม่เกิน 45 วันทำการ) โปรดตรวจสอบสิทธิ์สะสม');
  }
  if (leaveType === 'ลาป่วย' && workDays > 3 && workDays < 30) {
    warnings.push('⚠ ลาป่วยเกิน 3 วันทำการ ตามระเบียบต้องมีใบรับรองแพทย์แนบประกอบใบลา');
  }
  if (leaveType === 'ลาป่วย' && workDays >= 30) {
    warnings.push('⚠ ลาป่วยตั้งแต่ 30 วันทำการขึ้นไป ต้องมีใบรับรองแพทย์ทุกครั้ง และอาจเข้าเกณฑ์ทางการแพทย์ (โปรดปรึกษาฝ่ายกำลังคน)');
  }
  return warnings;
}

// สรุปยอดใช้/สิทธิ์สำหรับแสดงบนฟอร์ม (pure) — ครอบทุกประเภทมาตรฐานที่มีโควตา + ลาป่วย (ไม่จำกัด)
function buildUsageSummary_(usage) {
  if (!usage) return null;
  const summary = {};
  Object.keys(usage).forEach(type => {
    summary[type] = { used: usage[type], quota: LEAVE_QUOTAS[type] != null ? LEAVE_QUOTAS[type] : null };
  });
  Object.keys(LEAVE_QUOTAS).forEach(type => {
    if (!(type in summary)) summary[type] = { used: 0, quota: LEAVE_QUOTAS[type] };
  });
  return summary;
}

/** แผนที่โควตาพื้นฐานของ "ประเภทบุคลากรหนึ่ง ในปีหนึ่ง" (pure)
 *  profiles = แถวจาก readQuotaProfiles_() / employmentType = สถานะของคนนั้น (ว่างได้) / year = ค.ศ.
 *  กติกา: แถวที่ระบุปีชัดจนถึง (yearBE = ปีนั้น) ชนะแถว "ทุกปี" (yearBE = null) ชนะค่าเริ่มต้น LEAVE_QUOTAS
 *  ประเภทการลาที่ไม่มีแถวเลย = ใช้ค่าเริ่มต้นของระบบ (ระเบียบราชการ) / โควตา 0 = ไม่มีสิทธิ์ (แสดง 0 ไม่ใช่ซ่อน)
 *  คืน {ประเภทการลา: โควตา หรือ null = ไม่จำกัด} */
function baseQuotaMap_(profiles, employmentType, year) {
  const map = {};
  Object.keys(LEAVE_QUOTAS).forEach(type => { map[type] = LEAVE_QUOTAS[type]; });
  const type_ = String(employmentType || '').trim();
  if (!type_) return map;
  const forPerson = (profiles || []).filter(p => p.employmentType === type_);
  forPerson.forEach(p => {
    // แถวระบุปีทับได้: ถ้ามีแถวปีเฉพาะสำหรับ (ประเภทนี้, ประเภทลานี้) แล้วแถว "ทุกปี" ต้องไม่ทับกลับ
    const hasYearSpecific = forPerson.some(q => q.leaveType === p.leaveType && q.yearBE === year + 543);
    if (p.yearBE === null) {
      if (!hasYearSpecific) map[p.leaveType] = p.quota;
    } else if (p.yearBE === year + 543) {
      map[p.leaveType] = p.quota;
    }
  });
  return map;
}

/** แผนที่ยอดใช้ "รวมรายการปรับแล้ว" จากสรุปยอด (pure) — ป้อน buildLeaveWarnings_ คู่กับ effectiveQuota
 *  เพื่อให้ used (รวมใช้เพิ่ม) เทียบกับ quota (รวมยกมา) แบบแอปเปิลกับแอปเปิล */
function usageFromSummary_(summary) {
  const map = {};
  Object.keys(summary || {}).forEach(type => { map[type] = summary[type].used; });
  return map;
}

/** สรุปยอดต่อประเภทของ "ปี" หนึ่ง = ยอดจากใบลาจริง + รายการปรับจากสมุด LeaveBalances (pure)
 *  usage = แผนที่ {ประเภท: วันใช้} จากใบลา (หรือ null — ถ้ามีรายการปรับก็ยังสรุปได้) / balances = ทั้งหมดจาก readLeaveBalances_()
 *  year = ค.ศ. (สมุดเก็บเป็น พ.ศ. จึงเทียบ year+543)
 *  quotaMap (ไม่บังคับ) = โควตาพื้นฐานตามประเภทบุคลากรของคนนั้นจาก baseQuotaMap_ — ไม่ส่ง = ค่าเริ่มต้นระบบ (ระเบียบราชการ)
 *  "ใช้เพิ่ม" รวมเข้า used / "ยกมา" รวมเข้า quota — remaining = quota - used ใช้สูตรเดิมได้ทุกจุด
 *  คืน {ประเภท: {used, quota, carryIn?, usedExtra?}} หรือ null เมื่อไม่มีทั้งยอดใบลาและรายการปรับ */
function buildUsageSummaryWithBalances_(usage, balances, year, quotaMap) {
  const quotaOf = (type) => {
    if (quotaMap && Object.prototype.hasOwnProperty.call(quotaMap, type)) return quotaMap[type];
    return LEAVE_QUOTAS[type] != null ? LEAVE_QUOTAS[type] : null;
  };
  const summary = buildUsageSummary_(usage) || {};
  // สร้างใหม่บนฐานโควตาของคนนั้น (buildUsageSummary_ ใช้ค่าเริ่มต้นระบบ — แทนที่ด้วย quotaMap ทีละช่อง)
  Object.keys(summary).forEach(type => { summary[type].quota = quotaOf(type); });
  const yearRows = (balances || []).filter(b => b.yearBE === year + 543);
  if (!usage) {
    // ใบลาอ่านไม่ได้และไม่มีรายการปรับของปีนี้เลย = ไม่มีข้อมูลจะสรุป (คืน null ให้หน้าเว็บแสดงตามเดิม)
    if (!yearRows.length) return null;
    // มีรายการปรับ — ยังสรุปได้จากฐานโควตาของคนนั้นเพียงลำพัง (กันหน้า "ของฉัน" ว่างเปล่าทั้งที่มีข้อมูลปรับ)
    Object.keys(quotaMap || LEAVE_QUOTAS).forEach(type => {
      if (!(type in summary)) summary[type] = { used: 0, quota: quotaOf(type) };
    });
  }
  yearRows.forEach(b => {
    if (!summary[b.leaveType]) {
      summary[b.leaveType] = { used: 0, quota: quotaOf(b.leaveType) };
    }
    const cell = summary[b.leaveType];
    cell.carryIn = (cell.carryIn || 0) + b.carryIn;
    cell.usedExtra = (cell.usedExtra || 0) + b.usedExtra;
    cell.used += b.usedExtra;
    if (cell.quota != null) cell.quota += b.carryIn;
  });
  return Object.keys(summary).length ? summary : null;
}

/**
 * ยอดวันทำการที่ใช้ไปแล้วของปีปฏิทินปัจจุบัน แยกตามประเภท — อ่านจากใบลาจริงใน Notion ทั้งหมด
 * นับใบสถานะ "อนุมัติ" และใบที่กำลังรออนุมัติ (กันยื่นพร้อมกันหลายใบแล้วทะลุโควตาโดยไม่รู้ตัว)
 * คืน { 'ลากิจ': 3.5, ... } หรือ null ถ้ายังไม่ตั้งค่า/อ่านไม่สำเร็จ (ไม่ throw — การตรวจสิทธิ์ต้องไม่ทำให้ยื่นลาไม่ได้)
 */
function getLeaveUsageForYear_(leaveDbId, submitterUserId, now) {
  const dbId = String(leaveDbId || '').trim();
  if (!dbId || dbId === 'your_leave_database_id' || !submitterUserId) return null;
  try {
    const year = Number(Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy'));
    const dataSourceId = resolveLeaveDataSourceId_(dbId);
    const payload = {
      filter: {
        and: [
          { property: PROPS_LEAVE.submitter, rich_text: { equals: submitterUserId } },
          { property: PROPS_LEAVE.date, date: { on_or_after: year + '-01-01T00:00:00+07:00' } },
          { property: PROPS_LEAVE.date, date: { before: (year + 1) + '-01-01T00:00:00+07:00' } },
          { or: [LEAVE_STATUS.approved, LEAVE_STATUS.pendingApprover, LEAVE_STATUS.pendingChiefOffice].map(s => ({
            property: PROPS_LEAVE.status, select: { equals: s },
          })) },
        ],
      },
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
      logResult_(now, 'error', 'อ่านยอดวันลาสะสมไม่สำเร็จ (' + response.getResponseCode() + '): ' +
        response.getContentText().substring(0, 200));
      return null;
    }
    const data = JSON.parse(response.getContentText());
    const usage = {};
    (data.results || []).forEach(page => {
      const leave = parseLeavePage_(page);
      if (leave.leaveType) usage[leave.leaveType] = (usage[leave.leaveType] || 0) + (leave.workDays || 0);
    });
    return usage;
  } catch (err) {
    logResult_(now, 'error', 'อ่านยอดวันลาสะสมไม่สำเร็จ (ข้ามการตรวจสิทธิ์ใบนี้): ' + err);
    return null;
  }
}

/** คำนวณยอดใช้รายประเภทจาก "ใบลาทั้งหมดของปี" ที่ดึงมาแล้ว (pure) — ใช้แทนการ query ซ้ำใน myLeaves
 *  นับเฉพาะสถานะเดียวกับ getLeaveUsageForYear_ (อนุมัติ + รอทั้งสองขั้น) ผลลัพธ์เทียบเท่ากัน
 *  ทำเพื่อลดจำนวนคำขอต่อ action ลงจาก 4 เหลือ 2 — ไม่ให้ชน rate limit ของ Notion (~3 req/s) */
function usageFromLeaves_(leaves) {
  const counted = [LEAVE_STATUS.approved, LEAVE_STATUS.pendingApprover, LEAVE_STATUS.pendingChiefOffice];
  const usage = {};
  (leaves || []).forEach(leave => {
    if (counted.includes(leave.status) && leave.leaveType) {
      usage[leave.leaveType] = (usage[leave.leaveType] || 0) + (leave.workDays || 0);
    }
  });
  return usage;
}

function readHolidaySet_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName('Holidays');
  const lastRow = sheet.getLastRow();
  const data = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, 1).getDisplayValues() : [];
  const set = new Set();
  data.forEach(([cell]) => {
    const dateStr = String(cell || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) set.add(dateStr);
  });
  return set;
}

const THAI_MONTH_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

function thaiShortDate_(dateStr) {
  const parts = String(dateStr).split('-').map(Number);
  return parts[2] + ' ' + THAI_MONTH_SHORT[parts[1] - 1] + ' ' + (parts[0] + 543);
}

/** ป้ายวันที่ของใบลา เช่น "20 ส.ค. 2569" หรือ "20–22 ส.ค. 2569" หรือข้ามเดือน "30 ส.ค. – 2 ก.ย. 2569" */
function leaveDateLabel_(startStr, endStr) {
  if (!endStr || endStr === startStr) return thaiShortDate_(startStr);
  const s = startStr.split('-').map(Number);
  const e = endStr.split('-').map(Number);
  if (s[0] === e[0] && s[1] === e[1]) {
    return s[2] + '–' + e[2] + ' ' + THAI_MONTH_SHORT[s[1] - 1] + ' ' + (s[0] + 543);
  }
  return thaiShortDate_(startStr) + ' – ' + thaiShortDate_(endStr);
}

/** หักใบลาหนึ่งออกจากยอดใช้ของปี (pure) — ใช้ตอนแก้ไขใบที่ยังรอ เพราะ usage นับใบรออนุมัติรวมอยู่แล้ว
 *  ไม่หักแล้วคำเตือนจะนับใบเดิมซ้ำกับใบที่กำลังแก้ คืน null เมื่อรับ usage เป็น null (ตามสัญญาเดิม) */
function subtractLeaveFromUsage_(usage, leave) {
  if (!usage) return null;
  const next = Object.assign({}, usage);
  if (leave && leave.leaveType) {
    next[leave.leaveType] = Math.max(0, (next[leave.leaveType] || 0) - (leave.workDays || 0));
  }
  return next;
}

function leaveSummaryText_(leavePage) {
  const periodSuffix = leavePage.period && leavePage.period !== 'เต็มวัน' ? ' (' + leavePage.period + ')' : '';
  return 'ประเภท: ' + leavePage.leaveType +
    '\nวันที่: ' + leaveDateLabel_(leavePage.start, leavePage.end) + periodSuffix +
    (leavePage.workDays ? ' (' + workDaysLabel_(leavePage.workDays) + 'ทำการ)' : '');
}

// หา "วันทำการถัดไป" ถัดจากวันที่กำหนด (ข้ามเสาร์-อาทิตย์และวันหยุด) — pure
function nextWorkingDayStr_(afterStr, holidaySet) {
  const holidays = holidaySet || new Set();
  let cursor = new Date(afterStr + 'T00:00:00Z');
  for (let i = 0; i < 30; i++) {
    cursor = new Date(cursor.getTime() + 86400000);
    const dateStr = Utilities.formatDate(cursor, 'UTC', 'yyyy-MM-dd');
    if (!isWeekendDateStr_(dateStr) && !holidays.has(dateStr)) return dateStr;
  }
  return null; // กันเคสผิดปกติ (วันหยุดยาวเกิน 30 วันติดกัน) — ไม่แสดงวันกลับแทนการเดา
}

// เพิ่มข้อมูลเชิงบริบทให้ใบลาสำหรับแสดงในสรุปเช้า (mutate สำเนา ไม่แตะต้นทาง)
function enrichLeaveForDisplay_(leave, todayStr, holidays, roster) {
  const enriched = Object.assign({}, leave);
  enriched.firstName = leaveFirstName_(leave, roster);
  if (enriched.end && enriched.end > todayStr) {
    const returnStr = nextWorkingDayStr_(enriched.end, holidays);
    if (returnStr) enriched.returnLabel = thaiShortDate_(returnStr); // แบบเต็มพร้อมปี พ.ศ. — ถ้อยคำทางการ
  }
  return enriched;
}

/** ชื่อเฉพาะสำหรับสรุปเช้า (ไม่มีคำนำหน้า/นามสกุล) — ดึงจากชีต Staff ด้วย userId ให้แม่น
 *  ถ้าหาไม่ได้ (ไม่มี roster/ไม่ผูกบัญชี) ตัดจากชื่อเต็มแบบทนต่อคำนำหน้าทั่วไป */
function leaveFirstName_(leave, roster) {
  const staff = roster ? findStaffByUserId_(roster, leave.submitterUserId) : null;
  if (staff && staff.firstName) return staff.firstName;
  // Fallback ตัดจากชื่อเต็ม: ภาษาไทยนิยมเขียนคำนำหน้าติดกับชื่อ ("นายสมศักดิ์" คำเดียว)
  // จึงต้องตัดด้วย startsWith เรียงคำยาวก่อนกันสับสน (นางสาว ก่อน นาง) — ใช้เฉพาะกรณี
  // ใบลาเก่าที่ไม่มี userId ผูกกับชีต Staff เท่านั้น เพราะเส้นทางหลักอ่านชื่อจาก Staff ตรงๆ
  const tokens = String(leave.fullName || '').trim().split(/\s+/);
  const prefixes = ['แพทย์หญิง', 'นางสาว', 'นาย', 'นาง', 'ดร.', 'พญ.', 'หมอ'];
  let first = tokens[0] || '';
  for (let i = 0; i < prefixes.length; i++) {
    const p = prefixes[i];
    if (first === p) return tokens[1] || first; // คำนำหน้าคั่นวรรคแยก ("นาย สมศักดิ์")
    if (first.length > p.length && first.indexOf(p) === 0) {
      return first.substring(p.length); // คำนำหน้าเกาะชื่อ ("นายสมศักดิ์")
    }
  }
  return first;
}

/** ส่วนขยายท้ายแถว (ทางการแต่สั้น): ครึ่งวัน / จำนวนวันทำการทั้งช่วง / วันกลับทำการถัดไป */
function leaveFormalSuffix_(leave) {
  const parts = [];
  if (leave.period === 'ครึ่งวันเช้า' || leave.period === 'ครึ่งวันบ่าย') {
    parts.push('ครึ่งวันช่วง' + (leave.period === 'ครึ่งวันเช้า' ? 'เช้า' : 'บ่าย'));
  } else if (leave.workDays > 1) {
    parts.push(leave.workDays + ' วันทำการ');
  }
  if (leave.returnLabel) parts.push('กลับทำงาน ' + leave.returnLabel);
  return parts.join(' ');
}

/** บรรทัดรายละเอียดของผู้ลา = ประเภท + ส่วนขยายทางการ เช่น "ลาพักร้อน วันที่ 2 จาก 5 วันทำการ กลับทำการ 27 ส.ค. 2569" */
function leaveSummaryLabel_(leave) {
  const suffix = leaveFormalSuffix_(leave);
  return leave.leaveType + (suffix ? ' ' + suffix : '');
}

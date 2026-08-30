/** คณิตศาสตร์วันลาตามระเบียบสำนักนายกฯ: วันทำการ/ครึ่งวัน/สิทธิ์ต่อปี/คำเตือน
 *  + ยอดใช้จริงจากใบลาใน Notion + ป้ายวันที่/ถ้อยคำทางการสำหรับแสดงผล */

// ---------- วันที่ / วันทำการ ----------

function bangkokTodayStr_() {
  return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
}

function isValidDateStr_(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
}

function daysBetweenDateStrs_(startStr, endStr) {
  return Math.round(
    (new Date(endStr + 'T00:00:00Z') - new Date(startStr + 'T00:00:00Z')) / 86400000
  );
}

/** ปีงบประมาณไทยของวันที่ (คืนปี ค.ศ. ที่ปีงบประมาณสิ้นสุด)
 *  เช่น 2026-09-30 -> 2026 (พ.ศ. 2569), 2026-10-01 -> 2027 (พ.ศ. 2570) */
function fiscalYearCEForDateStr_(dateStr) {
  if (!isValidDateStr_(dateStr)) throw new Error('รูปแบบวันที่ไม่ถูกต้อง');
  const parts = String(dateStr).split('-').map(Number);
  return parts[1] >= 10 ? parts[0] + 1 : parts[0];
}

function fiscalYearCEForDate_(date) {
  return fiscalYearCEForDateStr_(Utilities.formatDate(date, 'Asia/Bangkok', 'yyyy-MM-dd'));
}

/** ช่วงปีงบประมาณแบบ [from, to) สำหรับ query Notion */
function fiscalYearBounds_(fiscalYearCE) {
  const year = Number(fiscalYearCE);
  if (!Number.isInteger(year) || year < 2000 || year > 2200) {
    throw new Error('ปีงบประมาณไม่ถูกต้อง');
  }
  return { from: (year - 1) + '-10-01', to: year + '-10-01' };
}

/** ใบเก่าที่เริ่มและสิ้นสุดคนละปีงบประมาณต้องให้ HR แยกก่อนนำยอดไปคำนวณ */
function isFiscalYearCrossingLeave_(leave) {
  const start = String((leave && leave.start) || '').substring(0, 10);
  const end = String((leave && (leave.end || leave.start)) || '').substring(0, 10);
  return isValidDateStr_(start) && isValidDateStr_(end) &&
    fiscalYearCEForDateStr_(start) !== fiscalYearCEForDateStr_(end);
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
  if (fiscalYearCEForDateStr_(startStr) !== fiscalYearCEForDateStr_(endStr)) {
    throw new Error('ใบลาต้องอยู่ในปีงบประมาณเดียวกัน กรุณาแยกยื่นที่วันที่ 30 กันยายน/1 ตุลาคม');
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

/** ช่วงวันลาสองช่วงทับซ้อนกันหรือไม่ — นับวันเริ่ม/วันสิ้นสุดรวมทั้งสองด้าน (pure) */
function leaveDateRangesOverlap_(startA, endA, startB, endB) {
  if (!isValidDateStr_(startA) || !isValidDateStr_(startB)) return false;
  const effectiveEndA = endA || startA;
  const effectiveEndB = endB || startB;
  if (!isValidDateStr_(effectiveEndA) || !isValidDateStr_(effectiveEndB)) return false;
  return startA <= effectiveEndB && startB <= effectiveEndA;
}

/** หาใบลาที่ยังมีผลของคนเดียวกันซึ่งทับซ้อนกับช่วงใหม่ (pure)
 *  ใบที่ไม่อนุมัติ/ยกเลิกแล้วไม่บล็อก และ excludePageId ใช้ตอนแก้ไขใบเดิม */
function findOverlappingActiveLeave_(leaves, submitterUserId, startStr, endStr, period, excludePageId) {
  const activeStatuses = [
    LEAVE_STATUS.approved,
    LEAVE_STATUS.pendingApprover,
    LEAVE_STATUS.pendingChiefOffice,
  ];
  const excluded = String(excludePageId || '');
  return (leaves || []).find(function (leave) {
    if (!leave || leave.submitterUserId !== submitterUserId ||
        (excluded && String(leave.pageId || '') === excluded) ||
        !activeStatuses.includes(leave.status) ||
        !leaveDateRangesOverlap_(leave.start, leave.end, startStr, endStr)) return false;

    // ครึ่งวันเช้าและครึ่งวันบ่ายในวันเดียวกันไม่ชนกัน ส่วนเต็มวัน/ช่วงเดียวกันยังชนตามปกติ
    const sameSingleDay = leave.start === (leave.end || leave.start) &&
      startStr === (endStr || startStr) && leave.start === startStr;
    const complementaryHalfDays = sameSingleDay &&
      ((leave.period === 'ครึ่งวันเช้า' && period === 'ครึ่งวันบ่าย') ||
       (leave.period === 'ครึ่งวันบ่าย' && period === 'ครึ่งวันเช้า'));
    return !complementaryHalfDays;
  }) || null;
}

// ---------- การคำนวณวันลาตามระเบียบสำนักนายกฯ ว่าด้วยการลาฯ (pure — ทดสอบได้) ----------

// ตรวจความถูกต้องของช่วงวัน + จับคู่กับประเภทที่ลาครึ่งวันได้ (ครึ่งวันใช้ได้เฉพาะลา 1 วัน)
function normalizeLeavePeriod_(period, leaveType, startStr, endStr) {
  const value = String(period || '').trim();
  if (!value) throw new Error('กรุณาเลือกช่วงวัน');
  if (!LEAVE_PERIODS.includes(value)) {
    throw new Error('ช่วงเวลาการลาไม่ถูกต้อง');
  }
  const singleDay = !endStr || endStr === startStr;
  if (value !== 'เต็มวัน' && (!singleDay || !HALF_DAY_TYPES.includes(leaveType))) {
    throw new Error('เลือกครึ่งวันได้เฉพาะใบลา 1 วันและประเภทที่รองรับ');
  }
  return value;
}

// จำนวนวันทำการของใบลา (ฐานวันทำการตามระเบียบ + ครึ่งวัน = 0.5 เมื่อลา 1 วัน)
function computeWorkDays_(startStr, endStr, holidaySet, period) {
  const days = countBusinessDays_(startStr, endStr || startStr, holidaySet);
  if (days === 1 && period !== 'เต็มวัน') return 0.5;
  return days;
}

function usesCalendarDayQuota_(leaveType) {
  return CALENDAR_DAY_QUOTA_TYPES.includes(String(leaveType || '').trim());
}

/** จำนวนวันที่ใช้ตัดสิทธิ์: ลาคลอด/อุปสมบทนับวันปฏิทินต่อเนื่อง ส่วนประเภทอื่นใช้วันทำการ */
function computeLeaveQuotaDays_(leaveType, startStr, endStr, workDays) {
  const effectiveEnd = endStr || startStr;
  if (usesCalendarDayQuota_(leaveType) &&
      isValidDateStr_(startStr) && isValidDateStr_(effectiveEnd) && effectiveEnd >= startStr) {
    return daysBetweenDateStrs_(startStr, effectiveEnd) + 1;
  }
  const numericWorkDays = Number(workDays);
  return Number.isFinite(numericWorkDays) && numericWorkDays >= 0 ? numericWorkDays : 0;
}

function leaveQuotaDays_(leave) {
  return computeLeaveQuotaDays_(leave && leave.leaveType, leave && leave.start,
    leave && leave.end, leave && leave.workDays);
}

function quotaUnitLabel_(leaveType) {
  return usesCalendarDayQuota_(leaveType) ? 'วันปฏิทิน' : 'วันทำการ';
}

function quotaBasis_(leaveType) {
  return MANUAL_REVIEW_QUOTA_TYPES.includes(String(leaveType || '').trim()) ? 'manual_event' : 'annual';
}

function quotaDaysLabel_(leaveType, days) {
  return workDaysLabel_(days) + (usesCalendarDayQuota_(leaveType) ? 'ปฏิทิน' : 'ทำการ');
}

function quotaUsageNote_(leaveType, year, usedIncludingRequest, quota) {
  if (quota == null) return '';
  const prefix = 'ยอดปีงบประมาณ พ.ศ. ' + (year + 543) + ' (รวมใบนี้): ' +
    quotaDaysLabel_(leaveType, usedIncludingRequest);
  return quotaBasis_(leaveType) === 'manual_event'
    ? prefix + '; เกณฑ์อ้างอิง ' + quota + ' ' + quotaUnitLabel_(leaveType) +
      ' ต่อเหตุการณ์/ตามสถานภาพ — HR ต้องตรวจสิทธิ์จริง'
    : prefix + ' / ' + quota + ' ' + quotaUnitLabel_(leaveType);
}

// แปลงเป็นข้อความ เช่น 0.5 → "½ วัน" / 1 → "1 วัน" / 2.5 → "2½ วัน"
function workDaysLabel_(days) {
  if (Number(days) === 0) return '0 วัน';
  const whole = Math.floor(days);
  const half = days - whole >= 0.5;
  if (days === 0.5) return '½ วัน';
  return (whole > 0 ? whole : '') + (half ? '½' : '') + ' วัน';
}

/**
 * คำเตือนตามระเบียบฯ สำหรับใบลาที่กำลังยื่น (pure)
 * usage = ยอดวันใช้สิทธิ์ของปีงบประมาณนี้แยกตามประเภท (จาก getLeaveUsageForYear_) หรือ null ถ้าหาไม่ได้
 * effectiveQuota (ไม่บังคับ) = สิทธิ์สูงสุดหลังรวม "ยกมา" จากสมุดรายการปรับ (LeaveBalances) —
 *   ไม่ส่งมาใช้โควตาตามระเบียบ (LEAVE_QUOTAS) ตรงๆ ส่งมาเมื่อคนนั้นมีสิทธิ์สะสม/ปรับพิเศษ
 *   (used ที่เทียบต้องเป็นยอดที่ "รวมใช้เพิ่ม" แล้วด้วย จึงเทียบแอปเปิลกับแอปเปิล)
 * นโยบาย: "เตือนอย่างเดียว" — ไม่มีการบล็อก ให้ผู้อนุมัติใช้ดุลพินิจ (คำเตือนถูกเก็บลงใบลาและแสดงในการ์ด)
 */
function buildLeaveWarnings_(leaveType, quotaDays, usage, effectiveQuota) {
  const warnings = [];
  const used = usage ? (usage[leaveType] || 0) : 0;
  const quota = effectiveQuota != null ? effectiveQuota : LEAVE_QUOTAS[leaveType];
  const unit = quotaUnitLabel_(leaveType);
  const manualEvent = quotaBasis_(leaveType) === 'manual_event';

  if (quota != null && usage && !manualEvent) {
    const total = used + quotaDays;
    if (total > quota) {
      warnings.push('⚠ เกินสิทธิ์ตามระเบียบ: ใช้ไปแล้ว ' + workDaysLabel_(used) + ' + ใบนี้ ' +
        workDaysLabel_(quotaDays) + ' = ' + workDaysLabel_(total) + ' (สิทธิ์สูงสุด ' + quota + ' ' + unit + '/ปีงบประมาณ)');
    } else if (total === quota) {
      warnings.push('ℹ ใบนี้ทำให้ครบสิทธิ์ ' + quota + ' ' + unit + '/ปีงบประมาณ พอดี — ใบถัดไปจะเกินสิทธิ์');
    }
  }
  if (quota != null && manualEvent) {
    if (quotaDays > quota) {
      warnings.push('⚠ ใบนี้เกินเกณฑ์อ้างอิง ' + quota + ' ' + unit + ': ใบนี้ ' +
        workDaysLabel_(quotaDays) + ' — ให้ HR ตรวจเงื่อนไขและเอกสารประกอบ');
    }
    warnings.push('ℹ สิทธิ์ประเภทนี้ขึ้นกับเหตุการณ์/อายุงาน/สถานภาพ ไม่ใช่เพดานรายปีทั่วไป ' +
      'ระบบแสดงยอดปีเพื่อประกอบการพิจารณาเท่านั้น ให้ HR ตรวจสิทธิ์จริงก่อนอนุมัติ');
  }
  if (leaveType === 'ลาพักร้อน' && quotaDays > 10) {
    warnings.push('⚠ ลาพักผ่อนเกิน 10 วันทำการ/ครั้ง — ตามระเบียบต้องเป็นการใช้สิทธิ์สะสม (รวมต่อครั้งไม่เกิน 45 วันทำการ) โปรดตรวจสอบสิทธิ์สะสม');
  }
  if (leaveType === 'ลาป่วย' && quotaDays > 3 && quotaDays < 30) {
    warnings.push('⚠ ลาป่วยเกิน 3 วันทำการ ตามระเบียบต้องมีใบรับรองแพทย์แนบประกอบใบลา');
  }
  if (leaveType === 'ลาป่วย' && quotaDays >= 30) {
    warnings.push('⚠ ลาป่วยตั้งแต่ 30 วันทำการขึ้นไป ต้องมีใบรับรองแพทย์ทุกครั้ง และอาจเข้าเกณฑ์ทางการแพทย์ (โปรดปรึกษาฝ่ายกำลังคน)');
  }
  return warnings;
}

function businessDaysBeforeLeave_(todayStr, startStr, holidaySet) {
  if (!isValidDateStr_(todayStr) || !isValidDateStr_(startStr) || startStr <= todayStr) return 0;
  const first = new Date(todayStr + 'T00:00:00Z');
  const last = new Date(startStr + 'T00:00:00Z');
  first.setUTCDate(first.getUTCDate() + 1);
  last.setUTCDate(last.getUTCDate() - 1);
  if (first > last) return 0;
  const from = Utilities.formatDate(first, 'UTC', 'yyyy-MM-dd');
  const to = Utilities.formatDate(last, 'UTC', 'yyyy-MM-dd');
  return countBusinessDays_(from, to, holidaySet || new Set());
}

const LEAVE_ADVANCE_NOTICE_WARNING = '⚠ แจ้งล่วงหน้าไม่ถึง 3 วันทำการ — โปรดตรวจสอบเหตุผลความจำเป็น';

function appendAdvanceNoticeWarning_(leaveType, todayStr, startStr, holidaySet, warnings) {
  if (leaveType === 'ลากิจ' && businessDaysBeforeLeave_(todayStr, startStr, holidaySet) < 3) {
    warnings.push(LEAVE_ADVANCE_NOTICE_WARNING);
  }
}

// สรุปยอดใช้/สิทธิ์สำหรับแสดงบนฟอร์ม (pure) — ครอบทุกประเภทมาตรฐานที่มีโควตา + ลาป่วย (ไม่จำกัด)
function buildUsageSummary_(usage) {
  if (!usage) return null;
  const summary = {};
  Object.keys(usage).forEach(type => {
    summary[type] = {
      used: usage[type],
      quota: LEAVE_QUOTAS[type] != null ? LEAVE_QUOTAS[type] : null,
      unit: quotaUnitLabel_(type),
      basis: quotaBasis_(type),
    };
  });
  Object.keys(LEAVE_QUOTAS).forEach(type => {
    if (!(type in summary)) summary[type] = {
      used: 0, quota: LEAVE_QUOTAS[type], unit: quotaUnitLabel_(type), basis: quotaBasis_(type),
    };
  });
  return summary;
}

/** แผนที่เกณฑ์สิทธิ์พื้นฐานของ "ประเภทบุคลากรหนึ่ง สำหรับนโยบายปีหนึ่ง" (pure)
 *  profiles = แถวจาก readQuotaProfiles_() / employmentType = สถานะของคนนั้น (ว่างได้) / year = ค.ศ.
 *  กติกา: แถวที่ระบุปีชัดจนถึง (yearBE = ปีนั้น) ชนะแถว "ทุกปี" (yearBE = null) ชนะค่าเริ่มต้น LEAVE_QUOTAS
 *  ประเภทการลาที่ไม่มีแถวเลย = ใช้ค่าเริ่มต้นของระบบ (ระเบียบราชการ) / โควตา 0 = ไม่มีสิทธิ์ (แสดง 0 ไม่ใช่ซ่อน)
 *  คืน {ประเภทการลา: เกณฑ์ หรือ null = ไม่จำกัด}; ผู้เรียกดู quotaBasis_ เพื่อแยกรายปีกับรายเหตุการณ์ */
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
 *  year = ปีงบประมาณ ค.ศ. ที่สิ้นสุด (สมุดเก็บเป็น พ.ศ. จึงเทียบ year+543)
 *  quotaMap (ไม่บังคับ) = โควตาพื้นฐานตามประเภทบุคลากรของคนนั้นจาก baseQuotaMap_ — ไม่ส่ง = ค่าเริ่มต้นระบบ (ระเบียบราชการ)
 *  "ใช้เพิ่ม" รวมเข้า used / "ยกมา" รวมเข้า quota — remaining = quota - used ใช้สูตรเดิมได้ทุกจุด
 *  คืน {ประเภท: {used, quota, carryIn?, usedExtra?}} หรือ null เมื่อไม่มีทั้งยอดใบลาและรายการปรับ */
function buildUsageSummaryWithBalances_(usage, balances, year, quotaMap, staffName) {
  const quotaOf = (type) => {
    if (quotaMap && Object.prototype.hasOwnProperty.call(quotaMap, type)) return quotaMap[type];
    return LEAVE_QUOTAS[type] != null ? LEAVE_QUOTAS[type] : null;
  };
  const summary = buildUsageSummary_(usage) || {};
  // สร้างใหม่บนฐานโควตาของคนนั้น (buildUsageSummary_ ใช้ค่าเริ่มต้นระบบ — แทนที่ด้วย quotaMap ทีละช่อง)
  Object.keys(summary).forEach(type => { summary[type].quota = quotaOf(type); });
  const normalizedStaffName = String(staffName || '').trim().replace(/\s+/g, ' ');
  const yearRows = normalizedStaffName
    ? (balances || []).filter(b => b.yearBE === year + 543 && b.name === normalizedStaffName)
    : [];
  // ใบลาอ่านไม่ได้และไม่มีรายการปรับของปีงบประมาณนี้เลย = ไม่มีข้อมูลจะสรุป
  if (!usage && !yearRows.length) return null;
  // เติมทุกประเภทจากโควตาของบุคลากร แม้ยังไม่เคยลาประเภทนั้น — ถ้าเติมเฉพาะประเภทที่มี usage
  // ลาป่วยครั้งแรกจะหาโควตาไม่พบและการ์ด LINE จะไม่มีบรรทัดตรวจสอบสิทธิ์
  Object.keys(quotaMap || LEAVE_QUOTAS).forEach(type => {
    if (!(type in summary)) summary[type] = {
      used: 0, quota: quotaOf(type), unit: quotaUnitLabel_(type), basis: quotaBasis_(type),
    };
  });
  yearRows.forEach(b => {
    if (!summary[b.leaveType]) {
      summary[b.leaveType] = {
        used: 0, quota: quotaOf(b.leaveType), unit: quotaUnitLabel_(b.leaveType),
        basis: quotaBasis_(b.leaveType),
      };
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
 * ยอดวันใช้สิทธิ์ของปีงบประมาณตามวันที่ now แยกตามประเภท — อ่านจากใบลาจริงใน Notion ทั้งหมด
 * นับใบสถานะ "อนุมัติ" และใบที่กำลังรออนุมัติ (กันยื่นพร้อมกันหลายใบแล้วทะลุโควตาโดยไม่รู้ตัว)
 * คืน { 'ลากิจ': 3.5, ... } หรือ null ถ้ายังไม่ตั้งค่า/อ่านไม่สำเร็จ (ไม่ throw — การตรวจสิทธิ์ต้องไม่ทำให้ยื่นลาไม่ได้)
 */
function getLeaveUsageForYear_(leaveDbId, submitterUserId, now) {
  const dbId = String(leaveDbId || '').trim();
  if (!dbId || dbId === 'your_leave_database_id' || !submitterUserId) return null;
  try {
    const year = fiscalYearCEForDate_(now);
    const bounds = fiscalYearBounds_(year);
    const dataSourceId = resolveLeaveDataSourceId_(dbId);
    const payload = {
      filter: {
        and: [
          { property: PROPS_LEAVE.submitter, rich_text: { equals: submitterUserId } },
          { property: PROPS_LEAVE.date, date: { on_or_after: bounds.from + 'T00:00:00+07:00' } },
          { property: PROPS_LEAVE.date, date: { before: bounds.to + 'T00:00:00+07:00' } },
          { or: [LEAVE_STATUS.approved, LEAVE_STATUS.pendingApprover, LEAVE_STATUS.pendingChiefOffice].map(s => ({
            property: PROPS_LEAVE.status, select: { equals: s },
          })) },
        ],
      },
      page_size: 100,
    };
    const usage = {};
    queryNotionPages_(dataSourceId, payload).forEach(page => {
      const leave = parseLeavePage_(page);
      if (leave.leaveType) usage[leave.leaveType] = (usage[leave.leaveType] || 0) + leaveQuotaDays_(leave);
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
      usage[leave.leaveType] = (usage[leave.leaveType] || 0) + leaveQuotaDays_(leave);
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
    next[leave.leaveType] = Math.max(0, (next[leave.leaveType] || 0) - leaveQuotaDays_(leave));
  }
  return next;
}

/** หักใบเดิมออกจากยอดปีงบประมาณเป้าหมายเฉพาะเมื่อใบเดิมอยู่ปีนั้น */
function subtractLeaveFromTargetYearUsage_(usage, leave, targetYear) {
  const start = String((leave && leave.start) || '');
  return isValidDateStr_(start) && fiscalYearCEForDateStr_(start) === Number(targetYear)
    ? subtractLeaveFromUsage_(usage, leave)
    : usage;
}

function leaveSummaryText_(leavePage) {
  const periodSuffix = leavePage.period && leavePage.period !== 'เต็มวัน' ? ' (' + leavePage.period + ')' : '';
  const quotaSuffix = usesCalendarDayQuota_(leavePage.leaveType)
    ? ' (ใช้สิทธิ์ ' + quotaDaysLabel_(leavePage.leaveType, leaveQuotaDays_(leavePage)) + ')' : '';
  return 'ประเภท: ' + leavePage.leaveType +
    '\nวันที่: ' + leaveDateLabel_(leavePage.start, leavePage.end) + periodSuffix +
    (leavePage.workDays ? ' (' + workDaysLabel_(leavePage.workDays) + 'ทำการ)' : '') + quotaSuffix +
    (leavePage.substitute ? '\nผู้ปฏิบัติงานแทน: ' + leavePage.substitute.name : '');
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

/** งานจัดการใบลา: คิวของหัวหน้า สสอ., เปลี่ยนผู้อนุมัติเฉพาะใบ, ปรับผลการลาใช้จริง และเตือนใบค้าง */

const LEAVE_PENDING_REMINDER_HANDLER = 'pendingLeaveReminderJob';

function requireMainAdminToken_(body) {
  const expected = String(PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN') || '').trim();
  if (!expected) {
    const err = new Error('ยังไม่ได้ตั้ง ADMIN_TOKEN ใน Apps Script หลัก');
    err.publicCode = 'UNCONFIGURED';
    throw err;
  }
  if (!secureEqual_(String((body && body.token) || ''), expected)) {
    const err = new Error('รหัสผู้ดูแลไม่ถูกต้อง');
    err.publicCode = 'UNAUTHORIZED';
    throw err;
  }
  return true;
}

function pendingLeaveStatuses_() {
  return [LEAVE_STATUS.pendingApprover, LEAVE_STATUS.pendingChiefOffice];
}

function isPendingLeave_(leave) {
  return !!leave && pendingLeaveStatuses_().includes(leave.status);
}

function queryPendingLeaves_(leaveDatabaseId) {
  return queryNotionPages_(resolveLeaveDataSourceId_(leaveDatabaseId), {
    filter: { or: pendingLeaveStatuses_().map(status => ({
      property: PROPS_LEAVE.status, select: { equals: status },
    })) },
    sorts: [{ property: PROPS_LEAVE.date, direction: 'ascending' }],
    page_size: 100,
  }).map(parseLeavePage_);
}

function managementLeaveRow_(leave) {
  return {
    pageId: leave.pageId,
    fullName: leave.fullName,
    groupName: leave.groupName,
    leaveType: leave.leaveType,
    start: leave.start,
    end: leave.end || leave.start,
    period: leave.period,
    reason: leave.reason,
    status: leave.status,
    workDays: leave.workDays,
    substituteKey: leave.substitute ? leave.substitute.key : '',
    substituteName: leave.substitute ? leave.substitute.name : '',
    currentApproverNames: leave.currentApprover ? (leave.currentApprover.names || []) : [],
    assignedAt: leave.currentApprover ? (leave.currentApprover.assignedAt || '') : '',
  };
}

function requireChiefOfficeStaff_(body) {
  const profile = verifyLineToken_(requireAccessToken_(body));
  const roster = readStaffRoster_();
  const staff = findStaffByUserId_(roster, profile.userId);
  if (!staff) throw new Error('ยังไม่ได้ลงทะเบียน');
  if (!secondApproverNames_(getSettings_()).includes(staffKey_(staff))) {
    throw new Error('เมนูนี้ใช้ได้เฉพาะ หัวหน้า สสอ.');
  }
  return { profile: profile, roster: roster, staff: staff };
}

function apiApprovalQueue_(body) {
  const auth = requireChiefOfficeStaff_(body);
  const settings = getSettings_();
  const dbId = String(settings.leave_database_id || '').trim();
  if (!dbId || dbId === 'your_leave_database_id') throw new Error('ระบบยังไม่ได้ตั้งค่าฐานข้อมูลใบลา');
  return {
    ok: true,
    leaves: queryPendingLeaves_(dbId).map(managementLeaveRow_),
    staffOptions: registeredStaffOptions_(auth.roster, ''),
  };
}

function validateReassignmentReason_(value) {
  const reason = String(value || '').trim();
  if (reason.length < 5) throw new Error('กรุณาระบุเหตุผลการเปลี่ยนผู้อนุมัติอย่างน้อย 5 ตัวอักษร');
  if (reason.length > 500) throw new Error('เหตุผลการเปลี่ยนผู้อนุมัติยาวเกิน 500 ตัวอักษร');
  return reason;
}

function reassignLeaveApprover_(body, actorLabel, actorId) {
  const pageId = normalizeNotionPageId_(body.pageId);
  const requestId = requireSubmissionRequestId_(body);
  const reason = validateReassignmentReason_(body.reason);
  const targetKey = String(body.targetStaffKey || '').trim().replace(/\s+/g, ' ');
  const roster = readStaffRoster_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('ระบบกำลังประมวลผลคำสั่งอื่นอยู่ กรุณาลองอีกครั้ง');
  try {
    const leave = parseLeavePage_(getLeavePage_(pageId));
    if (!isPendingLeave_(leave)) {
      throw new Error('เปลี่ยนผู้อนุมัติได้เฉพาะใบที่กำลังรออนุมัติ (สถานะปัจจุบัน: ' + (leave.status || 'ไม่ทราบ') + ')');
    }
    if (leaveAuditHasMutation_(leave.audit, 'reassign', requestId)) {
      return { ok: true, duplicate: true, leave: managementLeaveRow_(leave) };
    }
    const target = resolveRegisteredStaffChoice_(roster, targetKey, leave.submitterUserId, 'ผู้อนุมัติสำรอง');
    if (!target) throw new Error('กรุณาเลือกผู้อนุมัติสำรอง');
    const oldIds = leave.currentApprover ? (leave.currentApprover.userIds || []).slice() : [];
    const oldNames = leave.currentApprover ? (leave.currentApprover.names || []).slice() : [];
    const stage = leave.currentApprover && leave.currentApprover.stage === 'second' ? 'second' : 'first';
    const actionText = actorLabel + ' เปลี่ยนผู้อนุมัติจาก ' + (oldNames.join(', ') || 'ไม่ระบุ') +
      ' เป็น ' + staffDisplayName_(target) + ' — เหตุผล: ' + reason + ' ' +
      leaveMutationAuditMarker_('reassign', requestId);
    const updated = parseLeavePage_(updateLeavePage_(pageId, {
      [PROPS_LEAVE.currentApprover]: richTextValue_(serializeApproverInfo_(stage, [target], null, null,
        leave.currentApprover ? leave.currentApprover.needsSecond : undefined)),
      [PROPS_LEAVE.audit]: richTextValue_(appendLeaveAuditLine_(leave.audit, formatAuditLine_(null, actionText))),
      [PROPS_LEAVE.notificationState]: { select: { name: LEAVE_NOTIFICATION_STATE.pending } },
    }));
    appendAuditEvent_(requestId, actorId, 'leave.reassign', pageId,
      oldIds.join(','), target.lineUserId);

    oldIds.filter(id => id && id !== target.lineUserId).forEach(id => pushPrivateMessage_(id, {
      type: 'text',
      text: 'ℹ️ ' + actorLabel + ' เปลี่ยนผู้อนุมัติใบนี้แล้ว ปุ่มบนการ์ดเดิมใช้ไม่ได้\n' + leaveSummaryText_(leave) +
        '\nเหตุผล: ' + reason,
    }));
    const notified = pushPrivateMessage_(target.lineUserId, {
      type: 'flex',
      altText: 'คำขออนุมัติการลา: ' + updated.fullName,
      contents: buildLeaveApprovalBubble_(updated),
    });
    pushPrivateMessage_(leave.submitterUserId, {
      type: 'text',
      text: 'ℹ️ เปลี่ยนผู้อนุมัติใบลาของคุณเป็น ' + staffDisplayName_(target) + ' แล้ว\n' +
        leaveSummaryText_(updated) + '\nเหตุผล: ' + reason,
    });
    updateLeavePage_(pageId, {
      [PROPS_LEAVE.notificationState]: { select: { name: notified
        ? LEAVE_NOTIFICATION_STATE.sent : LEAVE_NOTIFICATION_STATE.failed } },
    });
    if (!notified) recordLeaveNotificationFailure_(pageId);
    else clearLeaveNotificationFailure_(pageId);
    return { ok: true, leave: managementLeaveRow_(updated), notificationPending: !notified };
  } finally {
    lock.releaseLock();
  }
}

function apiReassignApprover_(body) {
  const auth = requireChiefOfficeStaff_(body);
  return reassignLeaveApprover_(body, staffDisplayName_(auth.staff) + ' (หัวหน้า สสอ.)', auth.profile.userId);
}

function apiAdminReassignApprover_(body) {
  requireMainAdminToken_(body);
  return reassignLeaveApprover_(body, 'ผู้ดูแลระบบ', 'admin');
}

function queryAdministrativeLeaves_(leaveDatabaseId) {
  const thisYear = fiscalYearCEForDate_(new Date());
  const from = fiscalYearBounds_(thisYear - 1).from;
  const to = fiscalYearBounds_(thisYear + 2).to;
  return queryNotionPages_(resolveLeaveDataSourceId_(leaveDatabaseId), {
    filter: { and: [
      { property: PROPS_LEAVE.date, date: { on_or_after: from + 'T00:00:00+07:00' } },
      { property: PROPS_LEAVE.date, date: { before: to + 'T00:00:00+07:00' } },
    ] },
    sorts: [{ property: PROPS_LEAVE.date, direction: 'descending' }],
    page_size: 100,
  }).map(parseLeavePage_);
}

function apiAdminLeaveList_(body) {
  requireMainAdminToken_(body);
  const settings = getSettings_();
  const dbId = String(settings.leave_database_id || '').trim();
  if (!dbId || dbId === 'your_leave_database_id') throw new Error('ระบบยังไม่ได้ตั้งค่าฐานข้อมูลใบลา');
  const roster = readStaffRoster_();
  return {
    ok: true,
    leaves: queryAdministrativeLeaves_(dbId).map(managementLeaveRow_),
    staffOptions: registeredStaffOptions_(roster, ''),
    leaveTypes: leaveTypeList_(settings),
    periods: LEAVE_PERIODS.slice(),
  };
}

function parseAdministrativeLeaveInput_(body, settings) {
  const leaveType = normalizeLeaveTypeName_(body.leaveType);
  if (!leaveTypeList_(settings).includes(leaveType)) throw new Error('ประเภทการลาไม่ถูกต้อง');
  const start = String(body.start || '').trim();
  const end = String(body.end || body.start || '').trim();
  if (!isValidDateStr_(start) || !isValidDateStr_(end) || end < start) throw new Error('ช่วงวันที่ไม่ถูกต้อง');
  if (fiscalYearCEForDateStr_(start) !== fiscalYearCEForDateStr_(end)) {
    throw new Error('ใบลาต้องอยู่ในปีงบประมาณเดียวกัน');
  }
  if (daysBetweenDateStrs_(start, end) > LEAVE_MAX_SPAN_DAYS) throw new Error('ช่วงวันที่ยาวเกินกำหนด');
  const period = normalizeLeavePeriod_(body.period, leaveType, start, end);
  const resultStatus = String(body.resultStatus || '');
  if (![LEAVE_STATUS.approved, LEAVE_STATUS.cancelled].includes(resultStatus)) {
    throw new Error('ผลการลาใช้จริงไม่ถูกต้อง');
  }
  const reason = String(body.reason || '').trim();
  if (reason.length > 500) throw new Error('เหตุผลการลายาวเกิน 500 ตัวอักษร');
  const adjustmentReason = String(body.adjustmentReason || '').trim();
  if (adjustmentReason.length < 5 || adjustmentReason.length > 500) {
    throw new Error('กรุณาระบุเหตุผลการปรับข้อมูล 5–500 ตัวอักษร');
  }
  return { leaveType: leaveType, start: start, end: end, period: period, reason: reason,
    resultStatus: resultStatus, adjustmentReason: adjustmentReason,
    substituteKey: String(body.substituteKey || '').trim().replace(/\s+/g, ' ') };
}

function apiAdminAdjustLeave_(body) {
  requireMainAdminToken_(body);
  const requestId = requireSubmissionRequestId_(body);
  const pageId = normalizeNotionPageId_(body.pageId);
  const settings = getSettings_();
  const input = parseAdministrativeLeaveInput_(body, settings);
  const roster = readStaffRoster_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('ระบบกำลังประมวลผลคำสั่งอื่นอยู่ กรุณาลองอีกครั้ง');
  try {
    const rawPage = getLeavePage_(pageId);
    const leave = parseLeavePage_(rawPage);
    if (![LEAVE_STATUS.approved, LEAVE_STATUS.cancelled].includes(leave.status)) {
      throw new Error('ปรับผลใช้จริงได้เฉพาะใบที่อนุมัติหรือยกเลิกแล้ว ใบรออนุมัติให้ใช้เมนูเปลี่ยนผู้อนุมัติ');
    }
    if (leaveAuditHasMutation_(leave.audit, 'admin-adjust', requestId)) {
      return { ok: true, duplicate: true, leave: managementLeaveRow_(leave) };
    }
    const submitter = findAnyStaffByUserId_(roster, leave.submitterUserId);
    if (!submitter) throw new Error('ไม่พบผู้ยื่นในทะเบียนบุคลากร');
    const substitute = resolveRegisteredStaffChoice_(roster, input.substituteKey,
      leave.submitterUserId, 'ผู้ปฏิบัติงานแทน');
    if (substitute) ensureLeaveSubstituteProperty_(resolveLeaveDataSourceId_(settings.leave_database_id));
    const year = fiscalYearCEForDateStr_(input.start);
    const yearLeaves = getMyLeavesForYears_(settings.leave_database_id, leave.submitterUserId, year, year + 1);
    if (input.resultStatus === LEAVE_STATUS.approved) {
      requireNoOverlappingLeave_(yearLeaves, leave.submitterUserId,
        input.start, input.end, input.period, pageId);
    }
    const holidays = readHolidaySet_();
    const workDays = computeWorkDays_(input.start, input.end, holidays, input.period);
    const quotaDays = computeLeaveQuotaDays_(input.leaveType, input.start, input.end, workDays);
    if (input.resultStatus === LEAVE_STATUS.approved &&
        (quotaDays <= 0 || (workDays <= 0 && !usesCalendarDayQuota_(input.leaveType)))) {
      throw new Error('ช่วงวันที่ใช้จริงไม่มีวันทำการ');
    }
    const rawUsage = subtractLeaveFromTargetYearUsage_(usageFromLeaves_(yearLeaves), leave, year);
    const summary = buildUsageSummaryWithBalances_(rawUsage, readLeaveBalances_(), year,
      baseQuotaMap_(readQuotaProfiles_(), submitter.employmentType, year), staffKey_(submitter));
    const effectiveQuota = summary && summary[input.leaveType] ? summary[input.leaveType].quota : null;
    const warnings = input.resultStatus === LEAVE_STATUS.approved
      ? buildLeaveWarnings_(input.leaveType, quotaDays, usageFromSummary_(summary), effectiveQuota) : [];
    const usedLabel = input.resultStatus === LEAVE_STATUS.approved && effectiveQuota != null
      ? quotaUsageNote_(input.leaveType, year, (summary[input.leaveType].used || 0) + quotaDays, effectiveQuota) : '';
    const auditLine = 'ผู้ดูแลปรับผลการลาใช้จริงจาก ' + leave.status + ' เป็น ' + input.resultStatus +
      ' — เหตุผล: ' + input.adjustmentReason + ' ' + leaveMutationAuditMarker_('admin-adjust', requestId);
    const properties = {
      [PROPS_LEAVE.type]: { select: { name: input.leaveType } },
      [PROPS_LEAVE.date]: { date: { start: input.start, end: input.end } },
      [PROPS_LEAVE.period]: richTextValue_(input.period === 'เต็มวัน' ? '' : input.period),
      [PROPS_LEAVE.reason]: richTextValue_(input.reason),
      [PROPS_LEAVE.status]: { select: { name: input.resultStatus } },
      [PROPS_LEAVE.currentApprover]: richTextValue_(''),
      [PROPS_LEAVE.workDays]: { number: workDays },
      [PROPS_LEAVE.systemNote]: richTextValue_([usedLabel].concat(warnings).filter(Boolean).join('\n')),
      [PROPS_LEAVE.audit]: richTextValue_(appendLeaveAuditLine_(leave.audit, formatAuditLine_(null, auditLine))),
    };
    if (substitute) properties[PROPS_LEAVE.substitute] = richTextValue_(serializeSubstituteInfo_(substitute));
    else if ((rawPage.properties || {})[PROPS_LEAVE.substitute]) properties[PROPS_LEAVE.substitute] = richTextValue_('');
    const updated = parseLeavePage_(updateLeavePage_(pageId, properties));
    appendAuditEvent_(requestId, 'admin', 'leave.admin-adjust', pageId, leave.status, input.resultStatus);
    pushPrivateMessage_(leave.submitterUserId, {
      type: 'text',
      text: 'ℹ️ ผู้ดูแลปรับข้อมูลการลาใช้จริงแล้ว\n' + leaveSummaryText_(updated) +
        '\nผล: ' + input.resultStatus + '\nเหตุผล: ' + input.adjustmentReason,
    });
    if (leave.substitute && (!updated.substitute || leave.substitute.userId !== updated.substitute.userId)) {
      notifyLeaveSubstitute_(leave, 'ℹ️ ผู้ดูแลปรับผู้ปฏิบัติงานแทนในใบลานี้แล้ว');
    }
    if (updated.substitute) {
      notifyLeaveSubstitute_(updated, 'ℹ️ ผู้ดูแลปรับผลการลาใช้จริงของใบที่ระบุให้คุณปฏิบัติงานแทน');
    }
    approvedCancelNotifyTargets_(readApproversConfig_(), settings, roster, submitter).forEach(target => {
      pushPrivateMessage_(target.lineUserId, {
        type: 'text',
        text: 'ℹ️ ผู้ดูแลปรับข้อมูลการลาใช้จริงของ ' + updated.fullName + '\n' + leaveSummaryText_(updated) +
          '\nผล: ' + input.resultStatus + '\nเหตุผล: ' + input.adjustmentReason,
      });
    });
    return { ok: true, leave: managementLeaveRow_(updated), warnings: warnings };
  } finally {
    lock.releaseLock();
  }
}

function reminderHoursSetting_(settings, key, fallback) {
  const value = Number(String((settings && settings[key]) || '').trim());
  return Number.isFinite(value) && value >= 1 && value <= 720 ? value : fallback;
}

function reminderMarker_(assignmentId, hours) {
  return '[approval-reminder:' + String(assignmentId || 'legacy') + ':' + hours + 'h]';
}

function pendingLeaveReminderJob() {
  const settings = getSettings_();
  if (!isLeaveApprovalEnabled_(settings)) return;
  const dbId = String(settings.leave_database_id || '').trim();
  if (!dbId || dbId === 'your_leave_database_id') return;
  const remindHours = reminderHoursSetting_(settings, 'leave_pending_reminder_hours', 24);
  const escalateHours = reminderHoursSetting_(settings, 'leave_pending_escalation_hours', 48);
  const roster = readStaffRoster_();
  const chiefs = registeredStaffByNames_(roster, secondApproverNames_(settings));
  const now = Date.now();
  queryPendingLeaves_(dbId).forEach(leave => {
    const info = leave.currentApprover || {};
    const assignedAt = info.assignedAt || leave.createdAt || leave.lastEditedAt;
    const assignedMs = new Date(assignedAt || '').getTime();
    if (!Number.isFinite(assignedMs)) return;
    const ageHours = (now - assignedMs) / 3600000;
    let audit = leave.audit || '';
    let changed = false;
    const reminderMarker = reminderMarker_(info.assignmentId, remindHours);
    if (ageHours >= remindHours && audit.indexOf(reminderMarker) === -1) {
      (info.userIds || []).forEach(id => pushPrivateMessage_(id, {
        type: 'text',
        text: '⏰ เตือน: มีใบลารอคุณพิจารณาเกิน ' + remindHours + ' ชั่วโมง\n' + leaveSummaryText_(leave) +
          '\nผู้ลา: ' + leave.fullName,
      }));
      audit = appendLeaveAuditLine_(audit, formatAuditLine_(null,
        'ระบบเตือนผู้อนุมัติเมื่อรอครบ ' + remindHours + ' ชั่วโมง ' + reminderMarker));
      changed = true;
    }
    const escalationMarker = reminderMarker_(info.assignmentId, escalateHours);
    if (ageHours >= escalateHours && audit.indexOf(escalationMarker) === -1) {
      chiefs.forEach(chief => pushPrivateMessage_(chief.lineUserId, {
        type: 'text',
        text: '⚠️ แจ้งเพื่อทราบ: ใบลารออนุมัติเกิน ' + escalateHours + ' ชั่วโมง\nผู้ลา: ' + leave.fullName +
          '\nผู้อนุมัติปัจจุบัน: ' + ((info.names || []).join(', ') || 'ไม่ระบุ') + '\n' + leaveSummaryText_(leave) +
          '\nหากผู้อนุมัติไม่สะดวก สามารถเปลี่ยนผู้อนุมัติสำรองเฉพาะใบได้ในระบบ',
      }));
      audit = appendLeaveAuditLine_(audit, formatAuditLine_(null,
        'ระบบแจ้ง หัวหน้า สสอ. เมื่อรอครบ ' + escalateHours + ' ชั่วโมง ' + escalationMarker));
      changed = true;
    }
    if (changed) updateLeavePage_(leave.pageId, { [PROPS_LEAVE.audit]: richTextValue_(audit) });
  });
}

function ensurePendingLeaveReminderTrigger_() {
  const triggers = ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === LEAVE_PENDING_REMINDER_HANDLER);
  if (triggers.length) return false;
  ScriptApp.newTrigger(LEAVE_PENDING_REMINDER_HANDLER).timeBased().everyHours(1).create();
  return true;
}

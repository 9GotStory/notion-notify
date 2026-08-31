/** API รับคำขอจากหน้า LIFF (apiAction): session/bind/submit/myLeaves/cancel/update/calendar
 *  + ตรวจ LINE access token กับ api.line.me จริงทุกคำขอ */

// ---------- ช่องทางเข้า API จาก LIFF (direct GET หรือ gateway POST ผ่าน Webhook.gs) ----------

function handleApiRequest_(body) {
  try {
    switch (body.apiAction) {
      case 'session': return apiSession_(body);
      case 'bind': return apiBind_(body);
      case 'submit': return apiSubmit_(body);
      case 'myLeaves': return apiMyLeaves_(body);
      case 'cancel': return apiCancelLeave_(body);
      case 'update': return apiUpdateLeave_(body);
      case 'calendar': return apiCalendar_(body);
      case 'schedule': return apiSchedule_(body);
      case 'approvalQueue': return apiApprovalQueue_(body);
      case 'reassignApprover': return apiReassignApprover_(body);
      case 'adminLeaveList': return apiAdminLeaveList_(body);
      case 'adminReassignApprover': return apiAdminReassignApprover_(body);
      case 'adminAdjustLeave': return apiAdminAdjustLeave_(body);
      default:
        return { ok: false, error: 'ไม่รู้จักคำสั่งนี้' };
    }
  } catch (err) {
    const publicError = publicLeaveApiError_(err);
    console.error('API ' + String((body && body.apiAction) || '') + ' failed: ' + String(err && (err.stack || err)));
    return { ok: false, code: publicError.code, error: publicError.message,
      requestId: String((body && body.requestId) || '') };
  }
}

function publicLeaveApiError_(err) {
  const message = String(err && err.message ? err.message : '');
  if (err && (err.publicCode === 'UNAUTHORIZED' || err.publicCode === 'UNCONFIGURED')) {
    return { code: err.publicCode, message: message };
  }
  if (/^ระบบยังไม่พร้อมใช้งาน \(ผู้ดูแลยังไม่ได้ตั้งค่า leave_database_id\)$/.test(message)) {
    return { code: 'CONFIGURATION_REQUIRED', message: message };
  }
  const unsafe = /Notion|LINE push|UrlFetch|Exception|HTTP\s*\d|\{[\s\S]*\}|data[_ -]?source|database/i;
  if (!message || unsafe.test(message)) {
    return { code: 'UPSTREAM_ERROR', message: 'เชื่อมต่อระบบภายในไม่สำเร็จ กรุณาลองอีกครั้ง หากยังไม่สำเร็จให้ติดต่อผู้ดูแล' };
  }
  return { code: 'INVALID_REQUEST', message: message.substring(0, 300) };
}

function requireAccessToken_(body) {
  const token = String((body && body.accessToken) || '').trim();
  if (!token) throw new Error('ไม่พบข้อมูลการเข้าสู่ระบบ กรุณาปิดแล้วเปิดหน้านี้ใหม่');
  return token;
}

// ---------- ตรวจ access token กับ LINE จริงทุกครั้ง ----------

function verifyLineToken_(accessToken) {
  const verifyResp = UrlFetchApp.fetch(
    'https://api.line.me/oauth2/v2.1/verify?access_token=' + encodeURIComponent(accessToken),
    { muteHttpExceptions: true }
  );
  if (verifyResp.getResponseCode() >= 300) {
    throw new Error('เซสชันหมดอายุ กรุณาปิดแล้วเปิดหน้านี้ใหม่');
  }
  const verified = JSON.parse(verifyResp.getContentText());
  if (!verified.expires_in || verified.expires_in <= 0) {
    throw new Error('เซสชันหมดอายุ กรุณาปิดแล้วเปิดหน้านี้ใหม่');
  }
  // กัน token ที่ออกจากแอปคนละตัว: LOGIN_CHANNEL_ID เป็นค่าบังคับและต้องตรงกับ channel ของเรา
  const expectedChannelId = PropertiesService.getScriptProperties().getProperty('LOGIN_CHANNEL_ID');
  if (!expectedChannelId || !String(expectedChannelId).trim()) {
    const err = new Error('ระบบยังไม่ได้ตั้งค่า LOGIN_CHANNEL_ID กรุณาติดต่อผู้ดูแลระบบ');
    err.publicCode = 'UNCONFIGURED';
    throw err;
  }
  if (String(verified.client_id || '') !== String(expectedChannelId).trim()) {
    throw new Error('ไม่สามารถยืนยันตัวตนได้ กรุณาติดต่อผู้ดูแลระบบ');
  }

  const profileResp = UrlFetchApp.fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: 'Bearer ' + accessToken },
    muteHttpExceptions: true,
  });
  if (profileResp.getResponseCode() >= 300) {
    throw new Error('อ่านข้อมูลโปรไฟล์ LINE ไม่สำเร็จ ลองอีกครั้ง');
  }
  const profile = JSON.parse(profileResp.getContentText());
  return { userId: profile.userId, displayName: profile.displayName || '' };
}

function apiSession_(body) {
  const profile = verifyLineToken_(requireAccessToken_(body));
  const settings = getSettings_();
  const leaveStatus = {
    leaveEnabled: isLeaveSystemEnabled_(settings),
    leaveClosedMessage: isLeaveSystemEnabled_(settings) ? '' : leaveClosedMessage_(settings),
    approvalEnabled: isLeaveApprovalEnabled_(settings),
  };
  const roster = readStaffRoster_();
  const staff = findStaffByUserId_(roster, profile.userId);
  // ข้อมูลที่ฟอร์มต้องใช้ทุกกรณี (ทั้งลงทะเบียนแล้ว/ยัง)
  const common = {
    leaveTypes: leaveTypeList_(settings), // รายการประเภทการลา (แก้ได้ที่ leave_type_options)
    halfDayTypes: HALF_DAY_TYPES,
  };
  if (staff) {
    const fiscalYear = fiscalYearCEForDate_(new Date());
    return Object.assign({
      ok: true, registered: true,
      name: staffDisplayName_(staff), groupName: staff.groupName, position: staff.position,
      staffOptions: registeredStaffOptions_(roster, profile.userId),
      canManageApprovals: secondApproverNames_(settings).includes(staffKey_(staff)),
      // ยอดวันลาที่ใช้ไปแล้วของปีงบประมาณนี้จากใบจริงใน Notion
      usage: buildUsageSummaryWithBalances_(
        getLeaveUsageForYear_(settings.leave_database_id, staff.lineUserId, new Date()),
        readLeaveBalances_(),
        fiscalYear,
        baseQuotaMap_(readQuotaProfiles_(), staff.employmentType, fiscalYear),
        staffKey_(staff)),
      leaveYear: String(fiscalYear + 543),
    }, common, leaveStatus);
  }
  const pending = findPendingStaffByUserId_(roster, profile.userId);
  return Object.assign({
    ok: true, registered: false,
    registrationPending: !!pending,
    registrationMessage: pending
      ? 'คำขอผูกบัญชี LINE กำลังรอผู้ดูแลตรวจสอบ กรุณาลองใหม่หลังได้รับการยืนยัน'
      : '',
    options: common,
  }, leaveStatus);
}

function apiBind_(body) {
  const profile = verifyLineToken_(requireAccessToken_(body));
  const settings = getSettings_();
  requireLeaveSystemEnabled_(settings); // ปิดระบบ = หยุดรับลงทะเบียนใหม่ด้วย
  const requestId = requireSubmissionRequestId_(body);
  const employeeId = String(body.employeeId || '').trim();
  if (!/^[A-Za-z0-9._-]{2,50}$/.test(employeeId)) {
    throw new Error('รหัสบุคลากรไม่ถูกต้อง กรุณาตรวจสอบกับผู้ดูแล');
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('ระบบกำลังรับคำขออื่นอยู่ กรุณาลองอีกครั้ง');
  try {
    const roster = readStaffRoster_();
    const matches = roster.filter(s => s.employeeId === employeeId);
    if (matches.length !== 1) throw new Error('ไม่พบรหัสบุคลากรในทำเนียบ หรือข้อมูลซ้ำ กรุณาติดต่อผู้ดูแล');
    const staff = matches[0];
    if (staff.employmentStatus && !isActiveStaff_(staff)) {
      throw new Error('บัญชีบุคลากรนี้ยังไม่เปิดใช้งาน กรุณาติดต่อผู้ดูแล');
    }
    const sameUser = findAnyStaffByUserId_(roster, profile.userId);
    const pendingUser = findPendingStaffByUserId_(roster, profile.userId);
    if ((sameUser && sameUser.row !== staff.row) || (pendingUser && pendingUser.row !== staff.row)) {
      throw new Error('บัญชี LINE นี้มีคำขอผูกกับบุคลากรรายอื่นแล้ว กรุณาติดต่อผู้ดูแล');
    }
    if (isApprovedStaffBinding_(staff)) {
      if (staff.lineUserId === profile.userId) {
        return { ok: true, registered: true, name: staffDisplayName_(staff),
          groupName: staff.groupName, position: staff.position };
      }
      throw new Error('รหัสบุคลากรนี้ถูกผูกกับบัญชีอื่นแล้ว กรุณาติดต่อผู้ดูแล');
    }
    if (staff.bindingStatus === STAFF_BINDING_STATUS.pending) {
      if (staff.pendingLineUserId === profile.userId && staff.bindingRequestId === requestId) {
        return { ok: true, registered: false, pendingApproval: true, duplicate: true };
      }
      throw new Error('รหัสบุคลากรนี้มีคำขอผูกบัญชีที่กำลังรอตรวจสอบ กรุณาติดต่อผู้ดูแล');
    }
    if (!canRequestStaffBinding_(staff)) {
      throw new Error('ข้อมูลทำเนียบบุคลากรไม่ครบ กรุณาให้ผู้ดูแลตรวจคำนำหน้า ชื่อ สกุล กลุ่มงาน ตำแหน่ง ประเภทบุคลากร และรหัสบุคลากร');
    }

    const requestedAt = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm');
    const sheet = SpreadsheetApp.getActive().getSheetByName('Staff');
    sheet.getRange(staff.row, 12, 1, 7).setValues([[
      STAFF_BINDING_STATUS.pending, profile.userId, profile.displayName, requestedAt, '', '', requestId,
    ]]);
    SpreadsheetApp.flush();
    appendAuditEvent_(requestId, profile.userId, 'staff.binding.request', employeeId, '', STAFF_BINDING_STATUS.pending);
    logResult_(new Date(), 'leave-bind', 'รับคำขอผูกบัญชีของ ' + staffDisplayName_(staff) + ' รอผู้ดูแลอนุมัติ');
    return { ok: true, registered: false, pendingApproval: true };
  } finally {
    lock.releaseLock();
  }
}

/** ตรวจ + มาตรฐาน input ใบลาจาก LIFF (ใช้ร่วมทั้งยื่นใหม่และแก้ไขใบเดิม) — pure ต่อ settings ที่ส่งเข้า
 *  throw เป็นภาษาไทยเมื่อไม่ผ่าน คืน { leaveType, reason, start, end, period } */
function parseLeaveSubmissionInput_(body, settings) {
  const leaveType = normalizeLeaveTypeName_(body.leaveType);
  const reason = String(body.reason || '').trim();
  if (leaveType.length > 100) throw new Error('ประเภทการลายาวเกินกำหนด');
  if (reason.length > 500) throw new Error('เหตุผลยาวเกิน 500 ตัวอักษร');
  const range = parseLeaveDateRange_(body.start, body.end, bangkokTodayStr_());
  // ประเภทการลามาจาก Settings (leave_type_options) + ช่วงวัน (ครึ่งวันใช้ได้เฉพาะบางประเภท/ลา 1 วัน)
  if (!leaveTypeList_(settings).includes(leaveType)) throw new Error('ประเภทการลาไม่ถูกต้อง');
  const period = normalizeLeavePeriod_(body.period, leaveType, range.start, range.end);
  const substituteKey = String(body.substituteKey || '').trim().replace(/\s+/g, ' ');
  if (substituteKey.length > 120) throw new Error('รหัสผู้ปฏิบัติงานแทนยาวเกินกำหนด');
  return { leaveType: leaveType, reason: reason, start: range.start, end: range.end,
    period: period, substituteKey: substituteKey };
}

function registeredStaffOptions_(roster, excludeUserId) {
  return (roster || []).filter(staff => isApprovedStaffBinding_(staff) && staff.lineUserId !== excludeUserId)
    .map(staff => ({ key: staffKey_(staff), name: staffDisplayName_(staff),
      groupName: staff.groupName || '', position: staff.position || '' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'th'));
}

function resolveRegisteredStaffChoice_(roster, key, excludeUserId, fieldLabel) {
  if (!key) return null;
  const matches = (roster || []).filter(staff => isApprovedStaffBinding_(staff) && staffKey_(staff) === key);
  if (matches.length !== 1) throw new Error('ไม่พบ' + fieldLabel + 'ในทะเบียน กรุณาเลือกใหม่');
  if (matches[0].lineUserId === excludeUserId) throw new Error(fieldLabel + 'ต้องเป็นบุคคลอื่น');
  return matches[0];
}

/** เติมคำเตือน "ในช่วงลามีงานที่คุณรับผิดชอบ" ลง warnings (mutate โดยตั้งใจ — flow เดิมส่งต่อไปทั้งฟอร์มและการ์ดอนุมัติ)
 *  ตรวจไม่สำเร็จก็แค่ log แล้วข้าม — คำเตือนต้องไม่ทำให้ยื่นลาไม่ได้ เช่นเดียวกับการตรวจสิทธิ์
 *  แสดงสูงสุด 5 รายการแล้วสรุปเป็น "อีก N รายการ" — กันคำเตือนยาวจนหมายเหตุระบบของใบลาโดนตัดที่ขีด 2,000 ของ Notion */
function appendAssigneeConflictWarning_(settings, firstName, startStr, endStr, warnings) {
  try {
    const conflicts = getItemsForAssigneeInRange_(settings, firstName, startStr, shiftDateStr_(endStr, 1));
    if (conflicts.length) {
      const shown = conflicts.slice(0, 5).map(item =>
        item.title + ' (' + leaveDateLabel_((item.start || '').slice(0, 10), (item.end || item.start || '').slice(0, 10)) + ')'
      );
      if (conflicts.length > 5) shown.push('อีก ' + (conflicts.length - 5) + ' รายการ');
      warnings.push('⚠ ในช่วงลามีงานที่คุณเป็นผู้รับผิดชอบ: ' + shown.join(', ') +
        ' — ควรประสานหัวหน้างานเพื่อมอบหมายผู้ไปแทน');
    }
  } catch (err) {
    logResult_(new Date(), 'error', 'ตรวจงานที่รับผิดชอบในช่วงลาไม่สำเร็จ (ข้ามคำเตือนนี้): ' + err);
  }
}

function requireSubmissionRequestId_(body) {
  const requestId = String((body && body.requestId) || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new Error('รหัสคำขอไม่ถูกต้อง กรุณาปิดแล้วเปิดแบบฟอร์มใหม่');
  }
  return requestId;
}

/** รองรับหน้า LIFF รุ่นเก่าระหว่างทยอย deploy: ถ้าส่งมาแล้วต้องเป็น UUID ที่ถูกต้อง
 *  รุ่นใหม่ส่ง requestId เสมอจึง retry แบบ idempotent ได้ ส่วนรุ่นเก่าให้เซิร์ฟเวอร์สร้างแทน */
function mutationRequestId_(body) {
  const requestId = String((body && body.requestId) || '').trim();
  return requestId ? requireSubmissionRequestId_(body) : Utilities.getUuid();
}

function duplicateSubmissionResponse_(leavePage) {
  const pendingNames = leavePage.currentApprover && leavePage.currentApprover.names
    ? leavePage.currentApprover.names.join(', ')
    : '';
  return {
    ok: true,
    duplicate: true,
    requestId: leavePage.requestId,
    pageId: leavePage.pageId,
    workDays: leavePage.workDays,
    workDaysLabel: workDaysLabel_(leavePage.workDays),
    quotaDays: leaveQuotaDays_(leavePage),
    quotaDaysLabel: quotaDaysLabel_(leavePage.leaveType, leaveQuotaDays_(leavePage)),
    period: leavePage.period,
    approverName: pendingNames || (leavePage.status === LEAVE_STATUS.approved ? 'บันทึกเป็นอนุมัติแล้ว' : 'บันทึกใบลาแล้ว'),
    needsSecond: !!(leavePage.currentApprover &&
      (typeof leavePage.currentApprover.needsSecond === 'boolean'
        ? leavePage.currentApprover.needsSecond
        : leavePage.currentApprover.stage === 'first')),
    autoApproved: leavePage.status === LEAVE_STATUS.approved,
    notificationPending: leavePage.notificationState !== LEAVE_NOTIFICATION_STATE.sent,
    warnings: [],
  };
}

function apiSubmit_(body) {
  const requestId = requireSubmissionRequestId_(body);
  const profile = verifyLineToken_(requireAccessToken_(body));
  const settings = getSettings_();
  const leaveDbId = String(settings.leave_database_id || '').trim();
  if (!leaveDbId || leaveDbId === 'your_leave_database_id') {
    throw new Error('ระบบยังไม่พร้อมใช้งาน (ผู้ดูแลยังไม่ได้ตั้งค่า leave_database_id)');
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('ระบบกำลังรับคำขออื่นอยู่ กรุณาลองอีกครั้ง');
  try {
    const existing = findLeaveByRequestId_(leaveDbId, requestId);
    if (existing) {
      if (existing.submitterUserId !== profile.userId) throw new Error('รหัสคำขอนี้ถูกใช้แล้ว กรุณาเปิดแบบฟอร์มใหม่');
      return duplicateSubmissionResponse_(existing);
    }
    return apiSubmitNew_(body, profile, settings, leaveDbId, requestId);
  } finally {
    lock.releaseLock();
  }
}

function apiSubmitNew_(body, profile, settings, leaveDbId, requestId) {
  const roster = readStaffRoster_();
  const staff = findStaffByUserId_(roster, profile.userId);
  if (!staff) throw new Error('ยังไม่ได้ลงทะเบียน — ปิดหน้านี้แล้วเปิดใหม่เพื่อลงทะเบียนก่อน');

  requireLeaveSystemEnabled_(settings); // ปิดระบบ = ปฏิเสธการยื่นลาใหม่ทั้งหมด
  const input = parseLeaveSubmissionInput_(body, settings);
  const leaveType = input.leaveType;
  const reason = input.reason;
  const range = { start: input.start, end: input.end };
  const period = input.period;
  const substitute = resolveRegisteredStaffChoice_(roster, input.substituteKey, staff.lineUserId,
    'ผู้ปฏิบัติงานแทน');
  if (substitute) ensureLeaveSubstituteProperty_(resolveLeaveDataSourceId_(leaveDbId));

  // อ่านใบลาในปีเดียวกันภายใน lock ของ apiSubmit_ แล้วใช้ทั้งตรวจวันทับซ้อนและคำนวณยอดสิทธิ์
  // เพื่อกันคำขอสองรายการของคนเดียวกันที่เข้ามาพร้อมกัน โดยไม่เพิ่มจำนวน query ไปยัง Notion
  const year = fiscalYearCEForDateStr_(range.start);
  const yearLeaves = getMyLeavesForYears_(leaveDbId, staff.lineUserId, year, year + 1);
  requireNoOverlappingLeave_(yearLeaves, staff.lineUserId, range.start, range.end, period, '');

  // จำนวนวันทำการใช้กับตารางกำลังคน ส่วนจำนวนวันใช้สิทธิ์ของคลอด/บวชนับวันปฏิทินต่อเนื่อง
  // ยอดใช้/สิทธิ์รวม "รายการปรับ" จากสมุด LeaveBalances ด้วย (ยกมาเข้าโควตา / ใช้เพิ่มเข้ายอดใช้)
  const holidaySet = readHolidaySet_();
  const workDays = computeWorkDays_(range.start, range.end, holidaySet, period);
  const quotaDays = computeLeaveQuotaDays_(leaveType, range.start, range.end, workDays);
  if (quotaDays <= 0 || (workDays <= 0 && !usesCalendarDayQuota_(leaveType))) {
    throw new Error('ช่วงวันที่เลือกไม่มีวันทำการ กรุณาเลือกวันทำการอย่างน้อย 1 วัน');
  }
  const rawUsage = usageFromLeaves_(yearLeaves);
  const summary = buildUsageSummaryWithBalances_(rawUsage, readLeaveBalances_(), year,
    baseQuotaMap_(readQuotaProfiles_(), staff.employmentType, year), staffKey_(staff));
  const effectiveQuota = summary && summary[leaveType] ? summary[leaveType].quota : null;
  const warnings = buildLeaveWarnings_(leaveType, quotaDays, summary ? usageFromSummary_(summary) : null, effectiveQuota);
  appendAdvanceNoticeWarning_(leaveType, bangkokTodayStr_(), range.start, holidaySet, warnings);
  appendAssigneeConflictWarning_(settings, staff.firstName, range.start, range.end, warnings);
  const usedLabel = summary && effectiveQuota != null
    ? quotaUsageNote_(leaveType, year, (summary[leaveType].used || 0) + quotaDays, effectiveQuota)
    : '';
  const systemNote = [usedLabel].concat(warnings).filter(Boolean).join('\n');

  // โหมดปิดการอนุมัติ ("แจ้งลาอัตโนมัติ"): บันทึกเป็น "อนุมัติ" ทันที ไม่ต้องตั้งค่าผู้อนุมัติ
  // แจ้งการ์ด (ไม่มีปุ่ม) เข้ากลุ่มหลัก + แจ้งผู้ยื่นกลับ — ใบลาขึ้นสรุปเช้า "ผู้ลาวันนี้" ทันทีเพราะอนุมัติแล้ว
  if (!isLeaveApprovalEnabled_(settings)) {
    const autoPayload = buildLeavePagePayload_({
      dataSourceId: resolveLeaveDataSourceId_(leaveDbId),
      fullName: staffDisplayName_(staff),
      groupName: staff.groupName,
      submitterUserId: staff.lineUserId,
      leaveType: leaveType,
      start: range.start,
      end: range.end,
      period: period,
      reason: reason,
      substitute: serializeSubstituteInfo_(substitute),
      workDays: workDays,
      initialStatus: LEAVE_STATUS.approved,
      currentApprover: '',
      systemNote: systemNote,
      requestId: requestId,
    });
    const autoPage = parseLeavePage_(createNotionLeavePage_(autoPayload));
    appendAuditEvent_(requestId, staff.lineUserId, 'leave.submit', autoPage.pageId, '', LEAVE_STATUS.approved);
    let notificationPending = false;
    try {
      sendLineMessage_(settings.line_group_id, {
        type: 'flex',
        altText: '🏖️ แจ้งลาอัตโนมัติ: ' + autoPage.fullName + ' — ' + leaveType + ' ' +
          leaveDateLabel_(range.start, range.end),
        contents: buildLeaveNoticeBubble_(autoPage),
      });
    } catch (notifyErr) {
      notificationPending = true;
      recordLeaveNotificationFailure_(autoPage.pageId);
      logResult_(new Date(), 'error', 'ส่งการ์ดแจ้งลาเข้ากลุ่มไม่สำเร็จ: ' + notifyErr);
    }
    updateLeavePage_(autoPage.pageId, {
      [PROPS_LEAVE.notificationState]: { select: { name: notificationPending
        ? LEAVE_NOTIFICATION_STATE.failed : LEAVE_NOTIFICATION_STATE.sent } },
    });
    pushPrivateMessage_(staff.lineUserId, {
      type: 'text',
      text: '✅ บันทึกการลาแล้ว (ไม่ต้องรออนุมัติ — ระบบปิดการอนุมัติอยู่)\n' + leaveSummaryText_(autoPage),
    });
    notifyLeaveSubstitute_(autoPage, 'ℹ️ มีการระบุให้คุณปฏิบัติงานแทนในช่วงลานี้');
    logResult_(new Date(), 'leave',
      autoPage.fullName + ' ยื่น' + leaveType + ' ' + leaveDateLabel_(range.start, range.end) +
      ' (' + workDays + ' วันทำการ) — อัตโนมัติ ไม่ต้องอนุมัติ');
    return {
      ok: true,
      workDays: workDays,
      workDaysLabel: workDaysLabel_(workDays),
      quotaDays: quotaDays,
      quotaDaysLabel: quotaDaysLabel_(leaveType, quotaDays),
      period: period,
      approverName: 'ไม่ต้องอนุมัติ — แจ้งเข้ากลุ่มหลักแล้ว',
      needsSecond: false,
      autoApproved: true,
      requestId: requestId,
      pageId: autoPage.pageId,
      notificationPending: notificationPending,
      warnings: warnings,
    };
  }

  const config = readApproversConfig_();
  const chain = resolveApprovalChain_(config, settings, roster, staff); // throw ไทยสุภาพเมื่อคอนฟิกยังไม่พร้อม

  const payload = buildLeavePagePayload_({
    dataSourceId: resolveLeaveDataSourceId_(leaveDbId),
    fullName: staffDisplayName_(staff),
    groupName: staff.groupName,
    submitterUserId: staff.lineUserId,
    leaveType: leaveType,
    start: range.start,
    end: range.end,
    period: period,
    reason: reason,
    substitute: serializeSubstituteInfo_(substitute),
    workDays: workDays,
    initialStatus: chain.stage === 'second'
      ? LEAVE_STATUS.pendingChiefOffice
      : LEAVE_STATUS.pendingApprover,
    currentApprover: serializeApproverInfo_(chain.stage, chain.targets, null, null,
      chain.stage === 'first' && chain.needsSecond),
    systemNote: systemNote,
    requestId: requestId,
  });

  const page = createNotionLeavePage_(payload);
  const leavePage = parseLeavePage_(page);
  appendAuditEvent_(requestId, staff.lineUserId, 'leave.submit', leavePage.pageId, '', leavePage.status);

  const card = buildLeaveApprovalBubble_(leavePage);
  let approverLabel = chain.targets.map(s => staffDisplayName_(s)).join(', ');
  let notificationPending = false;
  if (chain.viaPool) {
    // ผู้อนุมัติของกลุ่มยังไม่ลงทะเบียน — การ์ดเข้ากลุ่มหลัก ให้ผู้อนุมัติที่ลงทะเบียนแล้วรายอื่นกดแทน
    approverLabel += ' (เข้ากลุ่มหลัก — ผู้อนุมัติของกลุ่มยังไม่ลงทะเบียน)';
    try {
      sendLineMessage_(settings.line_group_id, buildLeaveGroupApprovalBubble_(leavePage));
    } catch (err) {
      notificationPending = true;
      recordLeaveNotificationFailure_(leavePage.pageId);
      logResult_(new Date(), 'error', 'ส่งการ์ดขออนุมัติเข้ากลุ่มไม่สำเร็จ: ' + err);
    }
    logResult_(new Date(), 'leave', 'ใบลา ' + leavePage.fullName +
      (notificationPending ? ' รอส่งซ้ำเข้ากลุ่มหลัก' : ' ส่งเข้ากลุ่มหลักแล้ว') +
      ' (ผู้อนุมัติของกลุ่มยังไม่ลงทะเบียน)');
  } else {
    if (chain.viaFallback) {
      logResult_(new Date(), 'leave', 'ใบลา ' + leavePage.fullName + ' ขึ้น หัวหน้า สสอ. ทันที (ผู้อนุมัติของกลุ่มยังไม่ลงทะเบียน)');
    }
    try {
      pushApproverCardWithFallback_(chain.targets.map(s => s.lineUserId), card, leavePage);
    } catch (err) {
      notificationPending = true;
      recordLeaveNotificationFailure_(leavePage.pageId);
      logResult_(new Date(), 'error', 'ส่งการ์ดขออนุมัติไม่สำเร็จ: ' + err);
    }
  }
  updateLeavePage_(leavePage.pageId, {
    [PROPS_LEAVE.notificationState]: { select: { name: notificationPending
      ? LEAVE_NOTIFICATION_STATE.failed : LEAVE_NOTIFICATION_STATE.sent } },
  });
  if (chain.needsSecond && chain.stage === 'first') {
    approverLabel += ' → ส่งต่อ หัวหน้า สสอ.';
  }
  notifyLeaveSubstitute_(leavePage, 'ℹ️ มีการระบุให้คุณปฏิบัติงานแทนในใบลาที่กำลังรออนุมัติ');

  logResult_(new Date(), 'leave',
    leavePage.fullName + ' ยื่น' + leaveType + ' ' + leaveDateLabel_(range.start, range.end) +
    ' (' + workDays + ' วันทำการ) → ' + approverLabel);

  return {
    ok: true,
    workDays: workDays,
    workDaysLabel: workDaysLabel_(workDays),
    quotaDays: quotaDays,
    quotaDaysLabel: quotaDaysLabel_(leaveType, quotaDays),
    period: period,
    approverName: approverLabel,
    needsSecond: chain.needsSecond && chain.stage === 'first',
    requestId: requestId,
    pageId: leavePage.pageId,
    notificationPending: notificationPending,
    warnings: warnings,
  };
}

// ---------- ใบลาของฉัน: ดูรายการ / ยกเลิก / แก้ไข (apiAction: myLeaves / cancel / update) ----------

/** ใบลาทั้งหมดของคนหนึ่งตั้งแต่ปีงบประมาณที่กำหนดถึงก่อน endYearExclusive
 *  (ทุกสถานะ — เจ้าของดูประวัติของตัวเองได้ทั้งหมด)
 *  เรียงวันเริ่มลงล่าง (ใบล่าสุดอยู่บน) — ใช้ queryNotionPages_ วน cursor ตามแบบ query ปฏิทิน */
function getMyLeavesForYears_(leaveDbId, userId, year, endYearExclusive) {
  const from = fiscalYearBounds_(year).from;
  const to = fiscalYearBounds_(endYearExclusive).from;
  const payload = {
    filter: {
      and: [
        { property: PROPS_LEAVE.submitter, rich_text: { equals: userId } },
        { property: PROPS_LEAVE.date, date: { on_or_after: from + 'T00:00:00+07:00' } },
        { property: PROPS_LEAVE.date, date: { before: to + 'T00:00:00+07:00' } },
      ],
    },
    sorts: [{ property: PROPS_LEAVE.date, direction: 'descending' }],
    page_size: 100,
  };
  return queryNotionPages_(resolveLeaveDataSourceId_(leaveDbId), payload).map(parseLeavePage_);
}

/** บังคับไม่ให้คนเดียวกันมีใบลาที่ช่วงวันทับซ้อนกัน — เรียกภายใน ScriptLock เท่านั้น */
function requireNoOverlappingLeave_(leaves, submitterUserId, startStr, endStr, period, excludePageId) {
  const conflict = findOverlappingActiveLeave_(
    leaves, submitterUserId, startStr, endStr, period, excludePageId);
  if (!conflict) return;
  throw new Error(
    'พบใบลาเดิมของคุณช่วงวันที่ ' + leaveDateLabel_(conflict.start, conflict.end) +
    ' (สถานะ: ' + (conflict.status || 'ไม่ทราบ') + ') ทับซ้อนกับช่วงที่เลือก ' +
    'กรุณาตรวจสอบใบลาเดิมก่อนยื่นหรือแก้ไข'
  );
}

function leaveMutationAuditMarker_(action, requestId) {
  return '[action:' + action + ' request:' + requestId + ']';
}

function leaveAuditHasMutation_(audit, action, requestId) {
  return String(audit || '').indexOf(leaveMutationAuditMarker_(action, requestId)) !== -1;
}

function duplicateUpdateResponse_(leavePage) {
  const approverNames = leavePage.currentApprover ? (leavePage.currentApprover.names || []) : [];
  return {
    ok: true,
    duplicate: true,
    workDays: leavePage.workDays,
    workDaysLabel: workDaysLabel_(leavePage.workDays),
    quotaDays: leaveQuotaDays_(leavePage),
    quotaDaysLabel: quotaDaysLabel_(leavePage.leaveType, leaveQuotaDays_(leavePage)),
    period: leavePage.period,
    approverName: approverNames.join(', ') ||
      (leavePage.status === LEAVE_STATUS.approved ? 'บันทึกเป็นอนุมัติแล้ว' : 'บันทึกการแก้ไขแล้ว'),
    needsSecond: !!(leavePage.currentApprover &&
      (typeof leavePage.currentApprover.needsSecond === 'boolean'
        ? leavePage.currentApprover.needsSecond
        : leavePage.currentApprover.stage === 'first')),
    autoApproved: leavePage.status === LEAVE_STATUS.approved,
    notificationPending: leavePage.notificationState !== LEAVE_NOTIFICATION_STATE.sent,
    warnings: [],
  };
}

/** แถวใบลาหนึ่งใบสำหรับหน้า "ของฉัน" (pure) — กติกาปุ่มแก้ไข/ยกเลิกอยู่ฝั่งเซิร์ฟเวอร์ ฝั่งหน้าเว็บแค่ตาม
 *  แก้ได้: เฉพาะใบที่ยังรออนุมัติ / ยกเลิกได้: รออนุมัติหรืออนุมัติแล้ว และยังไม่ผ่านไป (end >= วันนี้) */
function buildMyLeaveRow_(leave, todayStr) {
  const isPending = leave.status === LEAVE_STATUS.pendingApprover ||
    leave.status === LEAVE_STATUS.pendingChiefOffice;
  const effectiveEnd = leave.end || leave.start;
  return {
    pageId: leave.pageId,
    leaveType: leave.leaveType,
    start: leave.start,
    end: effectiveEnd,
    period: leave.period,
    status: leave.status,
    workDays: leave.workDays,
    workDaysLabel: workDaysLabel_(leave.workDays),
    quotaDays: leaveQuotaDays_(leave),
    quotaDaysLabel: quotaDaysLabel_(leave.leaveType, leaveQuotaDays_(leave)),
    reason: leave.reason,
    substituteKey: leave.substitute ? leave.substitute.key : '',
    substituteName: leave.substitute ? leave.substitute.name : '',
    canEdit: isPending,
    canCancel: (isPending || leave.status === LEAVE_STATUS.approved) && leave.start > todayStr,
    pendingApproverNames: isPending && leave.currentApprover ? (leave.currentApprover.names || []) : [],
  };
}

function apiMyLeaves_(body) {
  const profile = verifyLineToken_(requireAccessToken_(body));
  const roster = readStaffRoster_();
  const staff = findStaffByUserId_(roster, profile.userId);
  if (!staff) throw new Error('ยังไม่ได้ลงทะเบียน — ปิดหน้านี้แล้วเปิดใหม่เพื่อลงทะเบียนก่อน');

  const settings = getSettings_();
  const now = new Date();
  const todayStr = bangkokTodayStr_();
  const year = fiscalYearCEForDate_(now);

  const leaveDbId = String(settings.leave_database_id || '').trim();
  let leaves = [];
  let usage = null;
  if (leaveDbId && leaveDbId !== 'your_leave_database_id') {
    // ครอบคลุมปีงบประมาณก่อน (ยื่นย้อนหลังได้), ปีนี้ และปีถัดไป (ยื่นล่วงหน้าได้)
    // เพื่อไม่ให้ใบรอที่ข้ามขอบปีหายจากหน้าจัดการของเจ้าของ
    const parsed = getMyLeavesForYears_(leaveDbId, staff.lineUserId, year - 1, year + 2)
      // กันเคส property "ผู้ยื่น (ระบบ)" ถูกแก้ใน Notion จนดึงใบของคนอื่นมาแสดง
      .filter(leave => leave.submitterUserId === profile.userId);
    // ยอดใช้คำนวณจากชุดเดียวกันเลย (ไม่ query ซ้ำ — ก่อนหน้านี้ยิง Notion 4 คำขอ/ครั้งจนโดน rate limit
    // ทำให้การ์ดยอดกลายเป็น "ไม่มีข้อมูล" ทั้งที่รายการด้านล่างแสดงได้) แล้วรวมรายการปรับจากสมุด LeaveBalances
    const currentYearLeaves = parsed.filter(leave =>
      isValidDateStr_(leave.start) && fiscalYearCEForDateStr_(leave.start) === year);
    usage = buildUsageSummaryWithBalances_(usageFromLeaves_(currentYearLeaves), readLeaveBalances_(), year,
      baseQuotaMap_(readQuotaProfiles_(), staff.employmentType, year), staffKey_(staff));
    leaves = parsed.map(leave => buildMyLeaveRow_(leave, todayStr));
  }

  return {
    ok: true,
    leaves: leaves,
    usage: usage,
    leaveYear: String(year + 543),
    today: todayStr,
  };
}

/** ผู้ที่ควรรับรู้เมื่อใบลา "อนุมัติแล้ว" ถูกผู้ยื่นยกเลิก: ผู้อนุมัติของกลุ่ม (+ หัวหน้า สสอ. ถ้ากลุ่มตั้งส่งต่อ)
 *  คำนวณจากคอนฟิกสดในชีต — ไม่ใช้ resolveApprovalChain_ เพราะฟังก์ชันนั้น throw เมื่อคอนฟิกไม่ครบ
 *  ซึ่งห้ามบล็อกการยกเลิก คืน [] เมื่อไม่มีใครพร้อม (ผู้ยื่นยกเลิกได้ ระบบแค่ log ให้ผู้ดูแลเห็น) — pure */
function approvedCancelNotifyTargets_(config, settings, roster, submitter) {
  if (!submitter) return [];
  const submitterKey = staffKey_(submitter);
  const row = (config || []).find(c => c.groupName === submitter.groupName);
  if (!row) return [];
  // รวมผู้อนุมัติของกลุ่ม (+ หัวหน้า สสอ. ถ้ากลุ่มตั้งส่งต่อ) ตัดชื่อซ้ำและตัวผู้ยื่นทิ้ง
  const names = [];
  row.approverNames.concat(row.forward ? secondApproverNames_(settings) : [])
    .forEach(n => { if (!names.includes(n)) names.push(n); });
  return registeredStaffByNames_(roster, names).filter(s => staffKey_(s) !== submitterKey);
}

/** ผู้ยื่นยกเลิกใบลาของตัวเอง — ได้ทั้งใบรออนุมัติและใบอนุมัติแล้ว (ไม่ต้องขออนุมัติยกเลิกซ้ำ)
 *  ใบที่วันที่ผ่านมาแล้วยกเลิกผ่านระบบไม่ได้ (กันแก้ประวัติย้อนหลังด้วยตัวเอง — ติดต่อผู้ดูแลแทน)
 *  ระบบลาปิดอยู่ก็ยกเลิกได้ ตามนโยบายเดียวกับปุ่มอนุมัติ (ปิดแล้วใบค้างยังจบได้) */
function apiCancelLeave_(body) {
  const requestId = mutationRequestId_(body);
  const profile = verifyLineToken_(requireAccessToken_(body));
  const roster = readStaffRoster_();
  const staff = findStaffByUserId_(roster, profile.userId);
  if (!staff) throw new Error('ยังไม่ได้ลงทะเบียน — ปิดหน้านี้แล้วเปิดใหม่เพื่อลงทะเบียนก่อน');

  const pageId = String(body.pageId || '').trim();
  if (!pageId) throw new Error('ไม่พบใบลาที่ต้องการยกเลิก');

  // lock ตัวเดียวกับปุ่มอนุมัติและการแก้ไข กัน "ยกเลิก" แข่งกับ "กดอนุมัติ/แก้ไข" พร้อมกันจนสถานะเพี้ยน
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('ระบบกำลังประมวลผลคำสั่งอื่นอยู่ กรุณาลองอีกครั้ง');
  try {
    const leavePage = parseLeavePage_(getLeavePage_(pageId));

    if (leavePage.submitterUserId !== profile.userId) {
      throw new Error('คุณไม่ใช่เจ้าของใบลานี้');
    }
    if (leavePage.status === LEAVE_STATUS.cancelled &&
        leaveAuditHasMutation_(leavePage.audit, 'cancel', requestId)) {
      return { ok: true, duplicate: true, status: LEAVE_STATUS.cancelled };
    }
    const cancellable = leavePage.status === LEAVE_STATUS.approved ||
      leavePage.status === LEAVE_STATUS.pendingApprover ||
      leavePage.status === LEAVE_STATUS.pendingChiefOffice;
    if (!cancellable) {
      throw new Error('ใบลานี้ดำเนินการไปแล้วและยกเลิกไม่ได้ (สถานะปัจจุบัน: ' +
        (leavePage.status || 'ไม่ทราบ') + ')');
    }
    if (leavePage.start <= bangkokTodayStr_()) {
      throw new Error('ใบลาที่ถึงวันเริ่มแล้ว ยกเลิกผ่านระบบไม่ได้ — ติดต่อผู้ดูแลเพื่อปรับข้อมูลตามวันที่ใช้จริง');
    }

    const wasPending = leavePage.status !== LEAVE_STATUS.approved;
    // เก็บเป้าหมายแจ้งก่อนเคลียร์ "ผู้อนุมัติปัจจุบัน": ใบรออนุมัติแจ้งผู้อนุมัติที่ค้างอยู่
    const pendingUserIds = wasPending && leavePage.currentApprover ? (leavePage.currentApprover.userIds || []) : [];

    updateLeavePage_(pageId, {
      [PROPS_LEAVE.status]: { select: { name: LEAVE_STATUS.cancelled } },
      // เคลียร์ผู้อนุมัติปัจจุบัน = ปุ่มบนการ์ดเก่าที่ยังค้างในแชทใคร กดต่อจะโดน canApproveLeave_ ปฏิเสธ
      [PROPS_LEAVE.currentApprover]: richTextValue_(''),
      [PROPS_LEAVE.audit]: richTextValue_(appendLeaveAuditLine_(leavePage.audit, formatAuditLine_(staff,
        'ยกเลิกโดยผู้ยื่น ' + leaveMutationAuditMarker_('cancel', requestId)))),
    });
    appendAuditEvent_(requestId, staff.lineUserId, 'leave.cancel', pageId,
      leavePage.status, LEAVE_STATUS.cancelled);

    // แจ้งผู้เกี่ยวข้องหลังบันทึกสำเร็จ — 1:1 เท่านั้น ไม่ fallback เข้ากลุ่ม (ใบลาเป็นเรื่องส่วนตัว)
    if (pendingUserIds.length) {
      pendingUserIds.forEach(userId => {
        pushPrivateMessage_(userId, {
          type: 'text',
          text: 'ℹ️ ใบลาที่คุณกำลังพิจารณาถูกผู้ยื่นถอนแล้ว\n' + leaveSummaryText_(leavePage),
        });
      });
    } else if (!wasPending) {
      // ใบอนุมัติแล้ว: แจ้งผู้อนุมัติของกลุ่มปัจจุบัน (จากคอนฟิกสด) ให้ทราบ — ไม่มีใครพร้อมก็ log ไว้ให้ผู้ดูแลเห็น
      const targets = approvedCancelNotifyTargets_(readApproversConfig_(), getSettings_(), roster, staff);
      if (targets.length) {
        targets.forEach(target => {
          pushPrivateMessage_(target.lineUserId, {
            type: 'text',
            text: 'ℹ️ ' + staffDisplayName_(staff) + ' ยกเลิกใบลาที่อนุมัติไปแล้ว\n' + leaveSummaryText_(leavePage),
          });
        });
      } else {
        logResult_(new Date(), 'leave-cancel',
          'ยกเลิกใบอนุมัติแล้วแต่ไม่มีผู้อนุมัติที่ลงทะเบียนพร้อมรับแจ้ง ใบลา ' + leavePage.fullName);
      }
    }
    pushPrivateMessage_(staff.lineUserId, {
      type: 'text',
      text: '✅ ยกเลิกใบลาแล้ว\n' + leaveSummaryText_(leavePage),
    });
    notifyLeaveSubstitute_(leavePage, 'ℹ️ ผู้ยื่นยกเลิกใบลาที่ระบุให้คุณปฏิบัติงานแทนแล้ว');
    logResult_(new Date(), 'leave-cancel',
      leavePage.fullName + ' ยกเลิก' + leavePage.leaveType + ' ' +
      leaveDateLabel_(leavePage.start, leavePage.end) + ' โดยผู้ยื่น');
    // ยอดใช้วันลาคืนอัตโนมัติ: getLeaveUsageForYear_ ไม่นับสถานะ "ยกเลิก" อยู่แล้ว
    return { ok: true, status: LEAVE_STATUS.cancelled };
  } finally {
    lock.releaseLock();
  }
}

/** ผู้ยื่นแก้ไขใบลาของตัวเองที่ยังรออนุมัติ — แก้ในหน้า Notion เดิม: คำนวณใหม่ทั้งใบ
 *  ตั้งสถานะกลับรออนุมัติ (รันเส้นทางผู้อนุมัติใหม่จากคอนฟิกสด) ส่งการ์ดใหม่ และจด audit การแก้ไข */
function apiUpdateLeave_(body) {
  const requestId = mutationRequestId_(body);
  const profile = verifyLineToken_(requireAccessToken_(body));
  const roster = readStaffRoster_();
  const staff = findStaffByUserId_(roster, profile.userId);
  if (!staff) throw new Error('ยังไม่ได้ลงทะเบียน — ปิดหน้านี้แล้วเปิดใหม่เพื่อลงทะเบียนก่อน');

  const settings = getSettings_();
  requireLeaveSystemEnabled_(settings); // การแก้ไข = การยื่นใหม่ จึงถูกปิดพร้อมระบบเหมือนกัน
  const leaveDbId = String(settings.leave_database_id || '').trim();
  if (!leaveDbId || leaveDbId === 'your_leave_database_id') {
    throw new Error('ระบบยังไม่พร้อมใช้งาน (ผู้ดูแลยังไม่ได้ตั้งค่า leave_database_id)');
  }
  const input = parseLeaveSubmissionInput_(body, settings);
  const substitute = resolveRegisteredStaffChoice_(roster, input.substituteKey, staff.lineUserId,
    'ผู้ปฏิบัติงานแทน');
  if (substitute) ensureLeaveSubstituteProperty_(resolveLeaveDataSourceId_(leaveDbId));

  const pageId = String(body.pageId || '').trim();
  if (!pageId) throw new Error('ไม่พบใบลาที่ต้องการแก้ไข');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('ระบบกำลังประมวลผลคำสั่งอื่นอยู่ กรุณาลองอีกครั้ง');
  try {
    const rawPage = getLeavePage_(pageId);
    const leavePage = parseLeavePage_(rawPage);
    if (leavePage.submitterUserId !== profile.userId) {
      throw new Error('คุณไม่ใช่เจ้าของใบลานี้');
    }
    if (leaveAuditHasMutation_(leavePage.audit, 'update', requestId)) {
      return duplicateUpdateResponse_(leavePage);
    }
    const isPending = leavePage.status === LEAVE_STATUS.pendingApprover ||
      leavePage.status === LEAVE_STATUS.pendingChiefOffice;
    if (!isPending) {
      throw new Error('แก้ไขได้เฉพาะใบลาที่ยังรอการอนุมัติ (สถานะปัจจุบัน: ' +
        (leavePage.status || 'ไม่ทราบ') + ') — ใบที่อนุมัติแล้วให้ยกเลิกแล้วยื่นใหม่');
    }

    // อ่านใบลาในปีเป้าหมายภายใน lock แล้วตรวจช่วงทับซ้อน โดยยกเว้นใบที่กำลังแก้ไขเอง
    const year = fiscalYearCEForDateStr_(input.start);
    const yearLeaves = getMyLeavesForYears_(leaveDbId, staff.lineUserId, year, year + 1);
    requireNoOverlappingLeave_(yearLeaves, staff.lineUserId, input.start, input.end, input.period, pageId);

    // คำนวณใหม่ทั้งใบ: หักใบเดิมออกจากยอดใช้ก่อน (usage นับใบรออนุมัติรวมอยู่แล้ว)
    // แล้วรวม "รายการปรับ" จากสมุด LeaveBalances เข้ายอดใช้/สิทธิ์เหมือนตอนยื่นใหม่
    const holidaySet = readHolidaySet_();
    const workDays = computeWorkDays_(input.start, input.end, holidaySet, input.period);
    const quotaDays = computeLeaveQuotaDays_(input.leaveType, input.start, input.end, workDays);
    if (quotaDays <= 0 || (workDays <= 0 && !usesCalendarDayQuota_(input.leaveType))) {
      throw new Error('ช่วงวันที่เลือกไม่มีวันทำการ กรุณาเลือกวันทำการอย่างน้อย 1 วัน');
    }
    const targetYearUsage = usageFromLeaves_(yearLeaves);
    // หักใบเดิมเฉพาะเมื่อยังอยู่ปีงบประมาณเดียวกับวันที่ใหม่
    const rawUsage = subtractLeaveFromTargetYearUsage_(targetYearUsage, leavePage, year);
    const summary = buildUsageSummaryWithBalances_(rawUsage, readLeaveBalances_(), year,
      baseQuotaMap_(readQuotaProfiles_(), staff.employmentType, year), staffKey_(staff));
    const effectiveQuota = summary && summary[input.leaveType] ? summary[input.leaveType].quota : null;
    const warnings = buildLeaveWarnings_(input.leaveType, quotaDays,
      summary ? usageFromSummary_(summary) : null, effectiveQuota);
    appendAdvanceNoticeWarning_(input.leaveType, bangkokTodayStr_(), input.start, holidaySet, warnings);
    appendAssigneeConflictWarning_(settings, staff.firstName, input.start, input.end, warnings);
    const usedLabel = summary && effectiveQuota != null
      ? quotaUsageNote_(input.leaveType, year,
        (summary[input.leaveType].used || 0) + quotaDays, effectiveQuota)
      : '';
    const systemNote = [usedLabel].concat(warnings).filter(Boolean).join('\n');
    const oldUserIds = leavePage.currentApprover ? (leavePage.currentApprover.userIds || []) : [];

    let newStatus;
    let currentApproverJson;
    let approverLabel;
    let needsSecond = false;
    let chainTargets = [];
    let viaPool = false;
    if (!isLeaveApprovalEnabled_(settings)) {
      // โหมดแจ้งลาอัตโนมัติ: คงสถานะ "อนุมัติ" ไว้ (กันใบค้างเป็น "รอ" โดยไม่มีใครได้รับการ์ด)
      newStatus = LEAVE_STATUS.approved;
      currentApproverJson = '';
      approverLabel = 'ไม่ต้องอนุมัติ — แจ้งเข้ากลุ่มหลักแล้ว';
    } else {
      // รันเส้นทางผู้อนุมัติใหม่จากคอนฟิกสด (throw ไทยได้ — ใบเดิมยังอยู่สถานะเดิม ผู้ใช้ยังยกเลิกได้)
      const chain = resolveApprovalChain_(readApproversConfig_(), settings, roster, staff);
      newStatus = chain.stage === 'second' ? LEAVE_STATUS.pendingChiefOffice : LEAVE_STATUS.pendingApprover;
      currentApproverJson = serializeApproverInfo_(chain.stage, chain.targets, null, null,
        chain.stage === 'first' && chain.needsSecond);
      chainTargets = chain.targets;
      viaPool = !!chain.viaPool;
      needsSecond = chain.needsSecond && chain.stage === 'first';
      approverLabel = chain.targets.map(s => staffDisplayName_(s)).join(', ');
      if (viaPool) approverLabel += ' (เข้ากลุ่มหลัก — ผู้อนุมัติของกลุ่มยังไม่ลงทะเบียน)';
    }

    const properties = {
      [PROPS_LEAVE.type]: { select: { name: input.leaveType } },
      [PROPS_LEAVE.date]: { date: { start: input.start, end: input.end } },
      [PROPS_LEAVE.reason]: richTextValue_(input.reason),
      [PROPS_LEAVE.status]: { select: { name: newStatus } },
      [PROPS_LEAVE.currentApprover]: richTextValue_(currentApproverJson),
      [PROPS_LEAVE.workDays]: { number: workDays },
      [PROPS_LEAVE.notificationState]: { select: { name: LEAVE_NOTIFICATION_STATE.pending } },
      [PROPS_LEAVE.audit]: richTextValue_(appendLeaveAuditLine_(leavePage.audit, formatAuditLine_(staff,
        'ผู้ยื่นแก้ไขใบลา — ส่งขออนุมัติใหม่ ' + leaveMutationAuditMarker_('update', requestId)))),
    };
    // เขียน "ช่วงวัน"/"หมายเหตุระบบ" แบบ optional เหมือนตอนสร้างใบ (database รุ่นเก่าอาจยังไม่มีสอง property นี้)
    // เคลียร์ค่าเดิมเฉพาะเมื่อ property มีอยู่จริงในหน้า — ไม่งั้น PATCH จะพังเพราะส่ง property ที่ DB ไม่มี
    const rawProps = rawPage.properties || {};
    if (substitute) {
      properties[PROPS_LEAVE.substitute] = richTextValue_(serializeSubstituteInfo_(substitute));
    } else if (rawProps[PROPS_LEAVE.substitute]) {
      properties[PROPS_LEAVE.substitute] = richTextValue_('');
    }
    if (input.period !== 'เต็มวัน') {
      properties[PROPS_LEAVE.period] = richTextValue_(input.period);
    } else if (rawProps[PROPS_LEAVE.period]) {
      properties[PROPS_LEAVE.period] = richTextValue_('');
    }
    if (systemNote) {
      properties[PROPS_LEAVE.systemNote] = richTextValue_(systemNote);
    } else if (rawProps[PROPS_LEAVE.systemNote]) {
      properties[PROPS_LEAVE.systemNote] = richTextValue_('');
    }

    const updatedPage = parseLeavePage_(updateLeavePage_(pageId, properties));
    appendAuditEvent_(requestId, staff.lineUserId, 'leave.update', pageId,
      leavePage.status, updatedPage.status);

    // แจ้งผู้อนุมัติชุดเก่า "ที่ไม่อยู่ในชุดใหม่" ว่าใบถูกแก้ — การ์ดเก่าในแชทเป็นข้อมูลเก่าแล้ว
    // (ชุดที่ซ้ำกับชุดใหม่จะได้การ์ดใหม่อยู่แล้ว ไม่ต้องเปลือง push ซ้ำ)
    const newUserIds = {};
    chainTargets.forEach(s => { newUserIds[s.lineUserId] = true; });
    oldUserIds.filter(id => id && !newUserIds[id]).forEach(userId => {
      pushPrivateMessage_(userId, {
        type: 'text',
        text: 'ℹ️ ผู้ยื่นแก้ไขใบลาที่คุณกำลังพิจารณา — การ์ดใหม่ส่งให้ผู้อนุมัติปัจจุบันแล้ว (ปุ่มบนการ์ดเก่าใช้ไม่ได้)\n' +
          leaveSummaryText_(updatedPage),
      });
    });
    if (leavePage.substitute && (!updatedPage.substitute ||
        leavePage.substitute.userId !== updatedPage.substitute.userId)) {
      notifyLeaveSubstitute_(leavePage, 'ℹ️ ผู้ยื่นเปลี่ยนผู้ปฏิบัติงานแทนในใบลานี้แล้ว');
    }
    if (updatedPage.substitute) {
      notifyLeaveSubstitute_(updatedPage, 'ℹ️ มีการระบุหรือแก้ไขให้คุณปฏิบัติงานแทนในใบลานี้');
    }

    let notificationPending = false;
    if (newStatus === LEAVE_STATUS.approved) {
      // โหมดแจ้งลาอัตโนมัติ: แจ้งการ์ด (ไม่มีปุ่ม) เข้ากลุ่มหลัก — ใบลาขึ้นสรุปเช้าได้ทันทีเพราะยังเป็น "อนุมัติ"
      try {
        sendLineMessage_(settings.line_group_id, {
          type: 'flex',
          altText: '🏖️ แก้ไขการแจ้งลา: ' + updatedPage.fullName + ' — ' + input.leaveType + ' ' +
            leaveDateLabel_(input.start, input.end),
          contents: buildLeaveNoticeBubble_(updatedPage),
        });
      } catch (notifyErr) {
        notificationPending = true;
        logResult_(new Date(), 'error', 'ส่งการ์ดแจ้งลา (แก้ไข) เข้ากลุ่มไม่สำเร็จ: ' + notifyErr);
      }
    } else if (viaPool) {
      try {
        sendLineMessage_(settings.line_group_id, buildLeaveGroupApprovalBubble_(updatedPage));
      } catch (err) {
        notificationPending = true;
        logResult_(new Date(), 'error', 'ส่งการ์ดขออนุมัติ (แก้ไข) เข้ากลุ่มไม่สำเร็จ: ' + err);
      }
    } else {
      try {
        pushApproverCardWithFallback_(chainTargets.map(s => s.lineUserId),
          buildLeaveApprovalBubble_(updatedPage), updatedPage);
      } catch (err) {
        notificationPending = true;
        logResult_(new Date(), 'error', 'ส่งการ์ดขออนุมัติ (แก้ไข) ไม่สำเร็จ: ' + err);
      }
    }

    updateLeavePage_(updatedPage.pageId, {
      [PROPS_LEAVE.notificationState]: { select: { name: notificationPending
        ? LEAVE_NOTIFICATION_STATE.failed : LEAVE_NOTIFICATION_STATE.sent } },
    });
    if (notificationPending) recordLeaveNotificationFailure_(updatedPage.pageId);
    else clearLeaveNotificationFailure_(updatedPage.pageId);

    logResult_(new Date(), 'leave-edit',
      updatedPage.fullName + ' แก้ไขใบลาเป็น' + input.leaveType + ' ' +
      leaveDateLabel_(input.start, input.end) + ' (' + workDaysLabel_(workDays) + ') → ' + approverLabel);

    return {
      ok: true,
      workDays: workDays,
      workDaysLabel: workDaysLabel_(workDays),
      quotaDays: quotaDays,
      quotaDaysLabel: quotaDaysLabel_(input.leaveType, quotaDays),
      period: input.period,
      approverName: approverLabel,
      needsSecond: needsSecond,
      autoApproved: newStatus === LEAVE_STATUS.approved,
      notificationPending: notificationPending,
      warnings: warnings,
    };
  } finally {
    lock.releaseLock();
  }
}

function apiCalendar_(body) {
  verifyLineToken_(requireAccessToken_(body)); // ปิดกั้นคนที่ไม่ได้เข้าผ่าน LINE แม้ข้อมูลวันหยุดไม่ละเอียดอ่อน
  return { ok: true, holidays: Array.from(readHolidaySet_()), today: bangkokTodayStr_() };
}

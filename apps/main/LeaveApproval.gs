/** การอนุมัติใบลา: การ์ดขออนุมัติ/แจ้ง, ปุ่ม postback จาก webhook,
 *  การเขียน/อ่านหน้าใบลาใน Notion, push แจ้งผล 1:1 และ audit trail */

// Notion จำกัด rich_text 2,000 ตัวอักษรต่อ text object (developers.notion.com/reference/request-limits)
// — ตัดที่ 2,000 กันหลุดขีดทุกจุดที่เขียน (หมายเหตุระบบ/บันทึกการอนุมัติที่ยาวขึ้นตามการใช้งานจริง)
function richTextValue_(text) {
  return { rich_text: [{ text: { content: String(text == null ? '' : text).substring(0, 2000) } }] };
}

/** ต่อ audit โดยรักษารายการล่าสุดไว้เสมอเมื่อชนเพดาน rich_text 2,000 ตัวอักษร */
function appendLeaveAuditLine_(existingAudit, newLine) {
  const combined = (existingAudit ? String(existingAudit) + '\n' : '') + String(newLine || '');
  return combined.length <= 2000 ? combined : '…\n' + combined.slice(-1998);
}

/** สร้าง payload สร้างหน้าใบลา (pure — ทดสอบได้โดยไม่ยิง Notion)
 *  "ช่วงวัน"/"หมายเหตุระบบ" ใส่เฉพาะเมื่อมีค่า เพื่อให้ database รุ่นเก่าที่ยังไม่มีสอง property นี้
 *  ยังบันทึกใบเต็มวันได้ก่อน (เพิ่ม property ใน Notion แล้วของใหม่จะเข้าครบ) */
function buildLeavePagePayload_(leave) {
  const properties = {
    [PROPS_LEAVE.title]: { title: [{ text: { content: leave.fullName } }] },
    [PROPS_LEAVE.groupName]: richTextValue_(leave.groupName),
    [PROPS_LEAVE.submitter]: richTextValue_(leave.submitterUserId),
    [PROPS_LEAVE.type]: { select: { name: leave.leaveType } },
    [PROPS_LEAVE.date]: { date: { start: leave.start, end: leave.end } },
    [PROPS_LEAVE.reason]: richTextValue_(leave.reason),
    [PROPS_LEAVE.status]: { select: { name: leave.initialStatus } },
    [PROPS_LEAVE.currentApprover]: richTextValue_(leave.currentApprover),
    [PROPS_LEAVE.workDays]: { number: leave.workDays },
    [PROPS_LEAVE.requestId]: richTextValue_(leave.requestId),
    [PROPS_LEAVE.notificationState]: { select: { name: LEAVE_NOTIFICATION_STATE.pending } },
  };
  if (leave.period && leave.period !== 'เต็มวัน') {
    properties[PROPS_LEAVE.period] = richTextValue_(leave.period);
  }
  if (leave.substitute) {
    properties[PROPS_LEAVE.substitute] = richTextValue_(leave.substitute);
  }
  if (leave.systemNote) {
    properties[PROPS_LEAVE.systemNote] = richTextValue_(leave.systemNote);
  }
  return { parent: { data_source_id: leave.dataSourceId }, properties: properties };
}

// "ผู้อนุมัติปัจจุบัน" เก็บในหน้าใบลาเป็น JSON {stage, userIds, names} —
// stage 'first' = ผู้อนุมัติของกลุ่มงาน, 'second' = หัวหน้า สสอ.
function serializeApproverInfo_(stage, targets, assignedAt, assignmentId, needsSecond) {
  const timestamp = assignedAt || new Date().toISOString();
  const info = {
    stage: stage,
    userIds: (targets || []).map(s => s.lineUserId),
    names: (targets || []).map(s => staffDisplayName_(s)),
    assignedAt: timestamp,
    assignmentId: assignmentId || Utilities.getUuid(),
  };
  if (typeof needsSecond === 'boolean') info.needsSecond = needsSecond;
  return JSON.stringify(info);
}

function approvalNeedsSecond_(currentApprover, config, groupName) {
  if (currentApprover && typeof currentApprover.needsSecond === 'boolean') {
    return currentApprover.needsSecond;
  }
  const configRow = (config || []).find(c => c.groupName === String(groupName || ''));
  return !!(configRow && configRow.forward);
}

function serializeSubstituteInfo_(staff) {
  if (!staff) return '';
  return JSON.stringify({
    key: staffKey_(staff),
    userId: staff.lineUserId,
    name: staffDisplayName_(staff),
    groupName: staff.groupName || '',
  });
}

function parseSubstituteInfo_(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && parsed.userId && parsed.name ? parsed : null;
  } catch (err) {
    return null;
  }
}

function createNotionLeavePage_(payload) {
  const response = notionFetch_('https://api.notion.com/v1/pages', {
    method: 'post',
    contentType: 'application/json',
    headers: notionHeaders_(),
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  }, false);
  if (response.getResponseCode() >= 300) {
    throw new Error('บันทึกใบลาลง Notion ไม่สำเร็จ (' + response.getResponseCode() + '): ' +
      response.getContentText().substring(0, 200));
  }
  return JSON.parse(response.getContentText());
}

function normalizeNotionPageId_(pageId) {
  const value = String(pageId || '').trim();
  const compact = value.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(compact)) {
    throw new Error('รหัสใบลาไม่ถูกต้อง กรุณาโหลดรายการใหม่');
  }
  return value;
}

function getLeavePage_(pageId) {
  const safePageId = normalizeNotionPageId_(pageId);
  const response = notionFetch_('https://api.notion.com/v1/pages/' + encodeURIComponent(safePageId), {
    method: 'get',
    headers: notionHeaders_(),
    muteHttpExceptions: true,
  }, true);
  if (response.getResponseCode() >= 300) {
    throw new Error('เปิดใบลาจาก Notion ไม่ได้ (' + response.getResponseCode() + '): ' +
      response.getContentText().substring(0, 200));
  }
  return JSON.parse(response.getContentText());
}

function updateLeavePage_(pageId, properties) {
  const safePageId = normalizeNotionPageId_(pageId);
  const response = notionFetch_('https://api.notion.com/v1/pages/' + encodeURIComponent(safePageId), {
    method: 'patch',
    contentType: 'application/json',
    headers: notionHeaders_(),
    payload: JSON.stringify({ properties: properties }),
    muteHttpExceptions: true,
  }, true);
  if (response.getResponseCode() >= 300) {
    throw new Error('อัปเดตใบลาใน Notion ไม่สำเร็จ (' + response.getResponseCode() + '): ' +
      response.getContentText().substring(0, 200));
  }
  return JSON.parse(response.getContentText());
}

/** แปลงหน้า Notion เป็นข้อมูลใบลาที่ใช้ภายใน (pure) */
function parseLeavePage_(page) {
  const props = (page && page.properties) || {};
  const dateProp = (props[PROPS_LEAVE.date] && props[PROPS_LEAVE.date].date) || {};
  let approverInfo = null;
  try {
    approverInfo = JSON.parse(plainText_(props[PROPS_LEAVE.currentApprover] && props[PROPS_LEAVE.currentApprover].rich_text)) || null;
  } catch (err) {
    approverInfo = null;
  }
  return {
    pageId: (page && page.id) || '',
    pageUrl: (page && page.url) || '',
    fullName: plainText_(props[PROPS_LEAVE.title] && props[PROPS_LEAVE.title].title),
    groupName: plainText_(props[PROPS_LEAVE.groupName] && props[PROPS_LEAVE.groupName].rich_text),
    submitterUserId: plainText_(props[PROPS_LEAVE.submitter] && props[PROPS_LEAVE.submitter].rich_text),
    leaveType: normalizeLeaveTypeName_(((props[PROPS_LEAVE.type] && props[PROPS_LEAVE.type].select) || {}).name),
    start: dateProp.start || '',
    end: dateProp.end || '',
    period: plainText_(props[PROPS_LEAVE.period] && props[PROPS_LEAVE.period].rich_text) || 'เต็มวัน',
    substitute: parseSubstituteInfo_(plainText_(props[PROPS_LEAVE.substitute] && props[PROPS_LEAVE.substitute].rich_text)),
    reason: plainText_(props[PROPS_LEAVE.reason] && props[PROPS_LEAVE.reason].rich_text),
    status: ((props[PROPS_LEAVE.status] && props[PROPS_LEAVE.status].select) || {}).name || '',
    currentApprover: approverInfo,
    audit: plainText_(props[PROPS_LEAVE.audit] && props[PROPS_LEAVE.audit].rich_text),
    systemNote: plainText_(props[PROPS_LEAVE.systemNote] && props[PROPS_LEAVE.systemNote].rich_text),
    workDays: (props[PROPS_LEAVE.workDays] && props[PROPS_LEAVE.workDays].number) || 0,
    requestId: plainText_(props[PROPS_LEAVE.requestId] && props[PROPS_LEAVE.requestId].rich_text),
    notificationState: ((props[PROPS_LEAVE.notificationState] && props[PROPS_LEAVE.notificationState].select) || {}).name || '',
    createdAt: (page && page.created_time) || '',
    lastEditedAt: (page && page.last_edited_time) || '',
  };
}

function findLeaveByRequestId_(leaveDatabaseId, requestId) {
  const payload = {
    filter: { property: PROPS_LEAVE.requestId, rich_text: { equals: requestId } },
    page_size: 2,
  };
  const pages = queryNotionPages_(resolveLeaveDataSourceId_(leaveDatabaseId), payload, 1);
  if (pages.length > 1) throw new Error('พบ Request ID ซ้ำใน Notion กรุณาติดต่อผู้ดูแลระบบ');
  return pages.length ? parseLeavePage_(pages[0]) : null;
}

// ---------- การ์ดขออนุมัติ (Flex) ----------

/** สร้างการ์ดขออนุมัติจากข้อมูลหน้า Notion ล้วนๆ — ใช้ได้ทั้งขั้นหัวหน้าและขั้นส่งต่อ ผอ. */
function buildLeaveApprovalBubble_(leavePage) {
  const dateLabel = leaveDateLabel_(leavePage.start, leavePage.end);
  const quotaDays = leaveQuotaDays_(leavePage);
  const fields = [
    { label: 'กลุ่มงาน', value: leavePage.groupName },
    { label: 'ประเภท', value: leavePage.leaveType },
    { label: 'วันที่ลา', value: dateLabel },
    { label: 'ช่วงวัน', value: leavePage.period && leavePage.period !== 'เต็มวัน' ? leavePage.period : '' },
    { label: 'วันทำการ', value: workDaysLabel_(leavePage.workDays) },
    { label: 'วันใช้สิทธิ์', value: usesCalendarDayQuota_(leavePage.leaveType)
      ? quotaDaysLabel_(leavePage.leaveType, quotaDays) : '' },
    { label: 'เหตุผล', value: leavePage.reason || '—' },
    { label: 'ผู้ปฏิบัติงานแทน', value: leavePage.substitute ? leavePage.substitute.name : '' },
    { label: 'ตรวจสอบสิทธิ์', value: leavePage.systemNote || '' },
  ].filter(f => f.value);

  const fieldBoxes = fields.map(f => ({
    type: 'box',
    layout: 'baseline',
    margin: 'sm',
    contents: [
      { type: 'text', text: f.label + ':', size: 'xs', weight: 'bold', color: '#717875', flex: 2, wrap: true },
      { type: 'text', text: f.value, size: 'xs', color: '#4A4A4A', wrap: true, flex: 5 },
    ],
  }));

  const postbackData = action => JSON.stringify({ t: 'leave', a: action, p: leavePage.pageId });

  return {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#B45309',
      paddingAll: '16px',
      contents: [
        { type: 'text', text: 'คำขออนุมัติการลา', color: '#FDE8CD', size: 'xxs' },
        { type: 'text', text: leavePage.fullName, color: '#FFFFFF', weight: 'bold', size: 'lg', wrap: true, margin: 'sm' },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '0px',
      contents: [
        { type: 'box', layout: 'vertical', height: '3px', backgroundColor: '#9AA6A1', contents: [{ type: 'filler' }] },
        { type: 'box', layout: 'vertical', paddingAll: '16px', contents: fieldBoxes },
      ],
    },
    footer: {
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      paddingAll: '12px',
      contents: [
        {
          type: 'button',
          height: 'sm',
          style: 'primary',
          action: { type: 'postback', label: 'อนุมัติ', displayText: 'อนุมัติ', data: postbackData('approve') },
        },
        {
          type: 'button',
          height: 'sm',
          style: 'danger',
          action: { type: 'postback', label: 'ไม่อนุมัติ', displayText: 'ไม่อนุมัติ', data: postbackData('reject') },
        },
      ],
    },
    styles: { footer: { separator: true, separatorColor: '#DCE5E1' } },
  };
}

/** ตัดคำเตือนที่มีประโยชน์กับผู้ยื่นแต่ไม่จำเป็นสำหรับ LINE กลุ่ม เพื่อให้การ์ดกลุ่มกระชับ */
function groupLeaveSystemNote_(systemNote) {
  return String(systemNote || '').split('\n')
    .filter(line => line !== LEAVE_ADVANCE_NOTICE_WARNING)
    .join('\n').trim();
}

function buildLeaveGroupApprovalBubble_(leavePage) {
  return buildLeaveApprovalBubble_(Object.assign({}, leavePage, {
    systemNote: groupLeaveSystemNote_(leavePage && leavePage.systemNote),
  }));
}

/** การ์ด "แจ้งลา" สำหรับโหมดปิดการอนุมัติ — เหมือนการ์ดขออนุมัติแต่ไม่มีปุ่ม (เป็นการแจ้งเพื่อทราบ) */
function buildLeaveNoticeBubble_(leavePage) {
  const bubble = buildLeaveGroupApprovalBubble_(leavePage);
  bubble.header.contents[0].text = 'แจ้งการลา';
  bubble.footer = {
    type: 'box',
    layout: 'vertical',
    paddingAll: '12px',
    contents: [
      { type: 'text', text: 'สำนักงานสาธารณสุขอำเภอสอง จังหวัดแพร่', size: 'xxs', color: '#6F7874', align: 'center', wrap: true },
    ],
  };
  return bubble;
}

// ---------- ส่งข้อความ LINE ----------

function sendLineMulticast_(userIds, messageObj) {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) throw new Error('ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN ใน Script Properties');
  const response = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/multicast', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ to: userIds, messages: [messageObj] }),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() >= 300) {
    throw new Error('LINE multicast ล้มเหลว (' + response.getResponseCode() + '): ' + response.getContentText());
  }
}

/**
 * push การ์ดขออนุมัติหาผู้อนุมัติรายคน — ถ้าพัง (ยังไม่แอดบอท/บล็อก) ให้ fallback เข้ากลุ่มหลัก
 * (ใช้กับการ์ดขออนุมัติเท่านั้น เพราะเป็นข้อมูลที่หน่วยงานเห็นได้อยู่แล้วผ่านข้อความเช้า)
 */
function pushApproverCardWithFallback_(userIds, messageObj, leavePage) {
  try {
    if (userIds.length === 1) sendLineMessage_(userIds[0], messageObj);
    else sendLineMulticast_(userIds, messageObj);
    return true;
  } catch (err) {
    logResult_(new Date(), 'leave-push-fallback',
      'push หาผู้อนุมัติไม่สำเร็จ (อาจยังไม่แอดบอท) ส่งเข้ากลุ่มหลักแทน: ' + err);
    sendLineMessage_(getSettings_().line_group_id, buildLeaveGroupApprovalBubble_(leavePage));
    return false;
  }
}

/** push ข้อความส่วนตัวหาคนเดียว — ไม่ fallback เข้ากลุ่มเด็ดขาด (ผลการลาเป็นเรื่องส่วนตัว) */
function pushPrivateMessage_(userId, messageObj) {
  if (!userId) return false;
  try {
    sendLineMessage_(userId, messageObj);
    return true;
  } catch (err) {
    logResult_(new Date(), 'leave-push-fail', 'push หา ' + userId + ' ไม่สำเร็จ (อาจยังไม่แอดบอท/บล็อก): ' + err);
    return false;
  }
}

function notifyLeaveSubstitute_(leavePage, message) {
  const substitute = leavePage && leavePage.substitute;
  if (!substitute || !substitute.userId) return false;
  return pushPrivateMessage_(substitute.userId, {
    type: 'text',
    text: message + '\nผู้ลา: ' + leavePage.fullName + '\n' + leaveSummaryText_(leavePage),
  });
}

// ---------- Retry การแจ้งใบลาที่บันทึกใน Notion แล้ว แต่ส่ง LINE ไม่สำเร็จ ----------

const LEAVE_NOTIFICATION_RETRY_LIMIT = 5;
const LEAVE_NOTIFICATION_RETRY_KEY_PREFIX = 'LEAVE_NOTIFY_RETRY_';
const LEAVE_NOTIFICATION_RETRY_HANDLER = 'retryFailedLeaveNotificationsJob';
const LEAVE_NOTIFICATION_RETRY_DELAY_MS = 30 * 60 * 1000;

function leaveNotificationRetryKey_(pageId) {
  return LEAVE_NOTIFICATION_RETRY_KEY_PREFIX + String(pageId || '').replace(/[^A-Za-z0-9_-]/g, '');
}

function recordLeaveNotificationFailure_(pageId) {
  const props = PropertiesService.getScriptProperties();
  const key = leaveNotificationRetryKey_(pageId);
  const attempts = Number(props.getProperty(key) || '0') + 1;
  props.setProperty(key, String(attempts));
  try {
    scheduleLeaveNotificationRetry_(false);
  } catch (scheduleErr) {
    console.error('ตั้ง trigger ส่งการแจ้งใบลาซ้ำไม่สำเร็จ: ' + scheduleErr);
  }
  return attempts;
}

function clearLeaveNotificationFailure_(pageId) {
  PropertiesService.getScriptProperties().deleteProperty(leaveNotificationRetryKey_(pageId));
}

function scheduleLeaveNotificationRetry_(replaceExisting) {
  const triggers = ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === LEAVE_NOTIFICATION_RETRY_HANDLER);
  if (triggers.length && !replaceExisting) return;
  triggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger(LEAVE_NOTIFICATION_RETRY_HANDLER)
    .timeBased()
    .at(new Date(Date.now() + LEAVE_NOTIFICATION_RETRY_DELAY_MS))
    .create();
}

function retryFailedLeaveNotificationsJob() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    scheduleLeaveNotificationRetry_(true);
    return;
  }
  let retryAgain = false;
  try {
    const result = retryFailedLeaveNotifications_(getSettings_());
    retryAgain = result.failed > 0;
  } catch (err) {
    retryAgain = true;
    logResult_(new Date(), 'leave-notify-retry', 'ประมวลผลคิวแจ้งใบลาไม่สำเร็จ: ' + err);
    throw err;
  } finally {
    lock.releaseLock();
    if (retryAgain) scheduleLeaveNotificationRetry_(true);
  }
}

function sendStoredLeaveNotification_(leavePage, settings) {
  if (leavePage.status === LEAVE_STATUS.approved) {
    sendLineMessage_(settings.line_group_id, {
      type: 'flex',
      altText: '🏖️ แจ้งลาอัตโนมัติ: ' + leavePage.fullName + ' — ' + leavePage.leaveType + ' ' +
        leaveDateLabel_(leavePage.start, leavePage.end),
      contents: buildLeaveNoticeBubble_(leavePage),
    });
    return;
  }
  if (leavePage.status === LEAVE_STATUS.pendingApprover ||
      leavePage.status === LEAVE_STATUS.pendingChiefOffice) {
    const userIds = leavePage.currentApprover && leavePage.currentApprover.userIds
      ? leavePage.currentApprover.userIds.filter(Boolean) : [];
    const card = buildLeaveApprovalBubble_(leavePage);
    if (userIds.length) pushApproverCardWithFallback_(userIds, card, leavePage);
    else sendLineMessage_(settings.line_group_id, buildLeaveGroupApprovalBubble_(leavePage));
  }
}

/**
 * เรียกจาก retry trigger: ส่งใบที่สถานะการแจ้งเป็น "รอแจ้ง/แจ้งไม่สำเร็จ" สูงสุด 5 ครั้ง
 * ถ้ายังไม่สำเร็จให้เปลี่ยนเป็น "ต้องตรวจสอบ" เพื่อหยุดยิงซ้ำและทำให้ผู้ดูแลเห็น dead-letter ใน Notion
 */
function retryFailedLeaveNotifications_(settings) {
  const leaveDbId = String((settings && settings.leave_database_id) || '').trim();
  if (!leaveDbId || leaveDbId === 'your_leave_database_id') return { retried: 0, failed: 0, manual: 0 };
  const pages = queryNotionPages_(resolveLeaveDataSourceId_(leaveDbId), {
    filter: { or: [LEAVE_NOTIFICATION_STATE.pending, LEAVE_NOTIFICATION_STATE.failed].map(state => ({
      property: PROPS_LEAVE.notificationState, select: { equals: state },
    })) },
    page_size: 100,
  });
  const result = { retried: 0, failed: 0, manual: 0 };
  pages.forEach(page => {
    const leavePage = parseLeavePage_(page);
    const key = leaveNotificationRetryKey_(leavePage.pageId);
    const attempts = Number(PropertiesService.getScriptProperties().getProperty(key) || '0');
    if (attempts >= LEAVE_NOTIFICATION_RETRY_LIMIT) {
      updateLeavePage_(leavePage.pageId, {
        [PROPS_LEAVE.notificationState]: { select: { name: LEAVE_NOTIFICATION_STATE.manual } },
      });
      result.manual++;
      logResult_(new Date(), 'leave-notify-dead-letter',
        'แจ้งใบลาไม่สำเร็จครบ ' + attempts + ' ครั้ง ต้องตรวจสอบใน Notion: ' + leavePage.pageId);
      return;
    }
    try {
      sendStoredLeaveNotification_(leavePage, settings);
      updateLeavePage_(leavePage.pageId, {
        [PROPS_LEAVE.notificationState]: { select: { name: LEAVE_NOTIFICATION_STATE.sent } },
      });
      clearLeaveNotificationFailure_(leavePage.pageId);
      result.retried++;
      logResult_(new Date(), 'leave-notify-retry', 'ส่งซ้ำสำเร็จ: ' + leavePage.pageId);
    } catch (err) {
      const nextAttempts = recordLeaveNotificationFailure_(leavePage.pageId);
      result.failed++;
      logResult_(new Date(), 'leave-notify-retry',
        'ส่งซ้ำครั้งที่ ' + nextAttempts + '/' + LEAVE_NOTIFICATION_RETRY_LIMIT + ' ไม่สำเร็จ: ' + err);
    }
  });
  return result;
}

// ---------- รับปุ่มอนุมัติจาก webhook (เรียกจาก doPost ใน Webhook.gs) ----------

function formatAuditLine_(approverStaff, actionLabel) {
  const stamp = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'dd/MM/yy HH:mm');
  const who = staffDisplayName_(approverStaff) +
    (approverStaff && approverStaff.position ? '(' + approverStaff.position + ')' : '');
  return stamp + ' ' + who + ' ' + actionLabel;
}

function handleLeavePostback_(event, webhookEventId) {
  // lock ตัวเดียวกับ apiCancelLeave_/apiUpdateLeave_ กัน "ผู้อนุมัติกดปุ่ม" แข่งกับ
  // "ผู้ยื่นยกเลิก/แก้ไข" พร้อมกันจนสถานะเพี้ยน — ได้ lock ไม่ทันให้ return เลย (ยังไม่ mark dedup
  // เพื่อให้ webhook retry รอบถัดไปของ LINE มีโอกาสได้ lock; ผู้กดก็กดซ้ำเองได้)
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('ระบบกำลังประมวลผลใบลาอื่นอยู่');
  try {
    const data = JSON.parse(event.postback.data || '{}');
    if (data.t !== 'leave') return;
    if (data.a !== 'approve' && data.a !== 'reject') {
      throw new Error('คำสั่งอนุมัติใบลาไม่ถูกต้อง');
    }
    const tapperUserId = (event.source || {}).userId || '';

    const page = getLeavePage_(data.p);
    const leavePage = parseLeavePage_(page);
    const roster = readStaffRoster_();
    const settings = getSettings_();

    const isPending = leavePage.status === LEAVE_STATUS.pendingApprover ||
      leavePage.status === LEAVE_STATUS.pendingChiefOffice;
    if (!isPending) {
      pushPrivateMessage_(tapperUserId, {
        type: 'text',
        text: 'ใบลานี้ดำเนินการไปแล้ว (สถานะปัจจุบัน: ' + (leavePage.status || 'ไม่ทราบ') + ')',
      });
      return;
    }

    // ชั้นป้องกันหลัก: userId ของผู้กดต้องตรงกับ "ผู้อนุมัติปัจจุบัน" ที่เก็บในหน้า Notion
    if (!canApproveLeave_(leavePage.currentApprover, tapperUserId)) {
      pushPrivateMessage_(tapperUserId, {
        type: 'text',
        text: 'คุณไม่ใช่ผู้อนุมัติของใบลานี้',
      });
      logResult_(new Date(), 'leave-approve', 'ผู้ไม่มีสิทธิ์กดปุ่มใบลา ' + leavePage.fullName + ': ' + tapperUserId);
      return;
    }
    const tapper = findStaffByUserId_(roster, tapperUserId);

    const isApprove = data.a === 'approve';
    const actionLabel = isApprove ? 'อนุมัติ' : 'ไม่อนุมัติ';
    const auditText = appendLeaveAuditLine_(leavePage.audit, formatAuditLine_(tapper, actionLabel));

    // อนุมัติขั้นแรก + แผนที่ snapshot ตอนยื่นกำหนดให้ส่งต่อ หัวหน้า สสอ. → เปลี่ยนขั้นแทนจบ
    // ใบรุ่นเก่าที่ยังไม่มี needsSecond จึง fallback อ่านคอนฟิกสดเพื่อรักษาความเข้ากันได้
    if (isApprove && leavePage.status === LEAVE_STATUS.pendingApprover) {
      const submitter = findAnyStaffByUserId_(roster, leavePage.submitterUserId);
      let config = null;
      let needsSecond;
      if (leavePage.currentApprover && typeof leavePage.currentApprover.needsSecond === 'boolean') {
        needsSecond = approvalNeedsSecond_(leavePage.currentApprover, null,
          submitter ? submitter.groupName : '');
      } else {
        config = readApproversConfig_();
        needsSecond = approvalNeedsSecond_(leavePage.currentApprover, config,
          submitter ? submitter.groupName : '');
      }

      if (needsSecond) {
        if (!config) config = readApproversConfig_();
        const submitterKey = submitter ? staffKey_(submitter) : '';
        const second = registeredStaffByNames_(roster, secondApproverNames_(settings))
          .filter(s => staffKey_(s) !== submitterKey && s.lineUserId !== tapperUserId);
        const nextTargets = second.length
          ? second
          : allApproverPool_(config, settings, roster, submitterKey)
              .filter(s => s.lineUserId !== tapperUserId);

        if (!nextTargets.length) {
          // ยังไม่มี หัวหน้า สสอ. ที่ลงทะเบียน — ไม่แตะสถานะ ให้อนุมัติใหม่ภายหลังเมื่อพร้อม
          pushPrivateMessage_(tapperUserId, {
            type: 'text',
            text: 'ยังส่งต่อให้ หัวหน้า สสอ. ไม่ได้ เพราะยังไม่มีรายชื่อที่ลงทะเบียนพร้อม — ติดต่อผู้ดูแล (ใบลายังอยู่ที่สถานะเดิม)',
          });
          logResult_(new Date(), 'error',
            'ส่งต่อขั้น หัวหน้า สสอ. ไม่ได้ (ไม่มีเป้าหมายพร้อม) ใบลา ' + leavePage.fullName);
          return;
        }

        updateLeavePage_(leavePage.pageId, {
          [PROPS_LEAVE.status]: { select: { name: LEAVE_STATUS.pendingChiefOffice } },
          [PROPS_LEAVE.currentApprover]: richTextValue_(serializeApproverInfo_('second', nextTargets,
            null, null, false)),
          [PROPS_LEAVE.audit]: richTextValue_(auditText),
          [PROPS_LEAVE.notificationState]: { select: { name: LEAVE_NOTIFICATION_STATE.pending } },
        });
        // บันทึก dedup หลัง mutation สำเร็จ สถานะใบลา + lock เป็นตัวกันซ้ำระหว่างทำงาน
        if (webhookEventId) claimSecurityEventOnce_(
          'line-webhook', webhookEventId, 30 * 24 * 60 * 60 * 1000);
        appendAuditEvent_(webhookEventId, tapperUserId, 'leave.approve.first', leavePage.pageId,
          leavePage.status, LEAVE_STATUS.pendingChiefOffice);

        const secondCard = buildLeaveApprovalBubble_(
          Object.assign({}, leavePage, { status: LEAVE_STATUS.pendingChiefOffice }));
        let notificationFailed = false;
        try {
          if (second.length) {
            pushApproverCardWithFallback_(second.map(s => s.lineUserId), secondCard, leavePage);
          } else {
            // ไม่มี หัวหน้า สสอ. ที่ลงทะเบียน — การ์ดเข้ากลุ่มหลักให้ผู้อนุมัติรายอื่นที่กำหนดไว้กดแทน
            sendLineMessage_(settings.line_group_id, buildLeaveGroupApprovalBubble_(leavePage));
          }
        } catch (err) {
          notificationFailed = true;
          recordLeaveNotificationFailure_(leavePage.pageId);
          logResult_(new Date(), 'error', 'ส่งการ์ดขั้น หัวหน้า สสอ. ไม่สำเร็จ: ' + err);
        }
        updateLeavePage_(leavePage.pageId, {
          [PROPS_LEAVE.notificationState]: { select: { name: notificationFailed
            ? LEAVE_NOTIFICATION_STATE.failed : LEAVE_NOTIFICATION_STATE.sent } },
        });
        pushPrivateMessage_(leavePage.submitterUserId, {
          type: 'text',
          text: '⏳ ผู้อนุมัติอนุมัติแล้ว รอ หัวหน้า สสอ. พิจารณาต่อ\n' + leaveSummaryText_(leavePage),
        });
        pushPrivateMessage_(tapperUserId, {
          type: 'text',
          text: 'บันทึกแล้ว: อนุมัติขั้นแรก — ส่งต่อให้ หัวหน้า สสอ. พิจารณาต่อแล้ว (ใบลาของ ' + leavePage.fullName + ')',
        });
        logResult_(new Date(), 'leave-approve', leavePage.fullName + ' ผ่านขั้นแรก รอ หัวหน้า สสอ.');
        return;
      }
    }

    // จบการอนุมัติ (อนุมัติขั้นสุดท้าย หรือไม่อนุมัติทุกขั้น)
    const finalStatus = isApprove ? LEAVE_STATUS.approved : LEAVE_STATUS.rejected;
    updateLeavePage_(leavePage.pageId, {
      [PROPS_LEAVE.status]: { select: { name: finalStatus } },
      [PROPS_LEAVE.currentApprover]: richTextValue_(''),
      [PROPS_LEAVE.audit]: richTextValue_(auditText),
    });
    if (webhookEventId) claimSecurityEventOnce_(
      'line-webhook', webhookEventId, 30 * 24 * 60 * 60 * 1000);
    appendAuditEvent_(webhookEventId, tapperUserId,
      isApprove ? 'leave.approve.final' : 'leave.reject', leavePage.pageId, leavePage.status, finalStatus);
    pushPrivateMessage_(leavePage.submitterUserId, {
      type: 'text',
      text: (isApprove ? '✅ ใบลาของคุณได้รับการอนุมัติ' : '❌ ใบลาไม่ได้รับการอนุมัติ') +
        '\n' + leaveSummaryText_(leavePage) +
        '\nโดย: ' + staffDisplayName_(tapper) +
        (tapper && tapper.position ? ' (' + tapper.position + ')' : ''),
    });
    notifyLeaveSubstitute_(leavePage, isApprove
      ? '✅ ใบลาที่ระบุให้คุณปฏิบัติงานแทนได้รับการอนุมัติแล้ว'
      : 'ℹ️ ใบลาที่ระบุให้คุณปฏิบัติงานแทนไม่ได้รับการอนุมัติ');
    pushPrivateMessage_(tapperUserId, {
      type: 'text',
      text: 'บันทึกแล้ว: ' + actionLabel + 'ใบลาของ ' + leavePage.fullName,
    });
    logResult_(new Date(), 'leave-approve', leavePage.fullName + ' ' + finalStatus + ' โดย ' + staffDisplayName_(tapper));
  } catch (err) {
    logResult_(new Date(), 'error', 'ประมวลผลปุ่มใบลาไม่สำเร็จ: ' + err);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Unit tests for the spreadsheet-bound project. These tests do not call
 * Notion, LINE, or any other external service.
 */

function runUnitTests() {
  const tests = [
    testNormalizeScheduleTime_,
    testNextScheduledDate_,
    testThaiDateLabel_,
    testWeekend_,
    testPlainText_,
    testNotionStatusWhitelist_,
    testParseNotionPage_,
    testTimeLabels_,
    testItemSubFields_,
    testTextMessage_,
    testFlexMessage_,
    testMessagePreview_,
    testCleanupOldFailCounts_,
    testNotionPlaceholder_,
    // ระบบลางาน (ไฟล์ Leave*.gs)
    testStaffDisplayName_,
    testResolveApprovalChain_,
    testCanApproveLeave_,
    testLeaveSystemSwitch_,
    testLeaveApprovalSwitch_,
    testComputeWorkDays_,
    testBuildLeaveWarnings_,
    testBuildUsageSummary_,
    testBuildLeaveNoticeBubble_,
    testLeaveDisplayEnrichment_,
    testFindDuplicates_,
    testCountBusinessDays_,
    testLeaveRangeOverlap_,
    testLeaveDateLabel_,
    testSplitConfigNames_,
    testBuildLeavePagePayload_,
    testParseLeavePage_,
    testBuildLeaveApprovalBubble_,
    testTextMessageWithLeaves_,
    testFlexMessageWithLeaves_,
    testAdvanceNoticeSection_,
    testParseLeaveSubmissionInput_,
    testBuildMyLeaveRow_,
    testApprovedCancelNotifyTargets_,
    testSubtractLeaveFromUsage_,
    testPreviousMonthKey_,
    testAggregateLeavesByPersonMonth_,
    testBuildMonthlyLeaveSummary_,
    testMonthlySummaryInMessages_,
    testScheduleLeaveRows_,
    testScheduleHelpers_,
  ];

  const failures = [];
  tests.forEach(function (test) {
    try {
      test();
      console.log('PASS ' + test.name);
    } catch (err) {
      failures.push(test.name + ': ' + (err.message || err));
      console.error('FAIL ' + test.name + ': ' + (err.stack || err));
    }
  });

  const summary = failures.length
    ? 'ไม่ผ่าน ' + failures.length + '/' + tests.length + ' รายการ\n\n' + failures.join('\n')
    : 'ผ่านทั้งหมด ' + tests.length + '/' + tests.length + ' รายการ';

  try {
    SpreadsheetApp.getUi().alert('Unit Tests', summary, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    console.log(summary);
  }

  if (failures.length) throw new Error(summary);
  return { passed: tests.length, failed: 0 };
}

function testNormalizeScheduleTime_() {
  assertEqual_(normalizeScheduleTime_('8:30'), '08:30');
  assertEqual_(normalizeScheduleTime_('8:30:45'), '08:30');
  assertEqual_(normalizeScheduleTime_('23:59'), '23:59');
  assertEqual_(normalizeScheduleTime_('24:00'), '24:00');
  assertEqual_(normalizeScheduleTime_('ไม่ใช่เวลา'), 'ไม่ใช่เวลา');
}

function testNextScheduledDate_() {
  const beforeTime = nextScheduledDate_(
    new Date('2026-08-06T07:30:00+07:00'),
    '8:00'
  );
  assertEqual_(beforeTime.toISOString(), '2026-08-06T01:00:00.000Z');

  const afterTime = nextScheduledDate_(
    new Date('2026-08-06T16:39:19+07:00'),
    '08:00'
  );
  assertEqual_(afterTime.toISOString(), '2026-08-07T01:00:00.000Z');

  const nextYear = nextScheduledDate_(
    new Date('2026-12-31T09:00:00+07:00'),
    '08:00'
  );
  assertEqual_(nextYear.toISOString(), '2027-01-01T01:00:00.000Z');

  assertThrows_(function () { nextScheduledDate_(new Date(), '25:00'); }, 'notify_time');
}

function testThaiDateLabel_() {
  assertEqual_(
    thaiDateLabel_(new Date('2026-08-06T08:30:00+07:00')),
    'พฤหัสบดี 6 สิงหาคม 2569'
  );
  assertEqual_(
    thaiDateLabel_(new Date('2026-01-01T00:30:00+07:00')),
    'พฤหัสบดี 1 มกราคม 2569'
  );
}

function testWeekend_() {
  assertTrue_(isWeekend_(new Date('2026-08-08T12:00:00+07:00')), 'วันเสาร์ต้องเป็นวันหยุด');
  assertTrue_(isWeekend_(new Date('2026-08-09T12:00:00+07:00')), 'วันอาทิตย์ต้องเป็นวันหยุด');
  assertFalse_(isWeekend_(new Date('2026-08-10T12:00:00+07:00')), 'วันจันทร์ต้องไม่เป็นวันหยุดสุดสัปดาห์');
}

function testPlainText_() {
  assertEqual_(plainText_([{ plain_text: ' งาน ' }, { plain_text: 'ทดสอบ ' }]), 'งาน ทดสอบ');
  assertEqual_(plainText_(null), '');
}

function testNotionStatusWhitelist_() {
  const payload = buildNotionQueryPayload_('2026-08-06', '2026-08-07');
  const filters = payload.filter.and;
  assertEqual_(filters.length, 3);
  assertEqual_(filters[0].date.on_or_after, '2026-08-06T00:00:00+07:00');
  assertEqual_(filters[1].date.before, '2026-08-07T00:00:00+07:00');

  const allowedStatuses = filters[2].or.map(function (filter) {
    assertEqual_(filter.property, 'สถานะงาน');
    assertEqual_(filter.status, undefined);
    return filter.select.equals;
  });
  assertEqual_(allowedStatuses.join(','), 'ยืนยันแล้ว');
  assertFalse_(allowedStatuses.includes('ร่าง'));
  assertFalse_(allowedStatuses.includes('เสร็จสิ้น'));
  assertFalse_(allowedStatuses.includes('ยกเลิก'));
}

function testParseNotionPage_() {
  const properties = {};
  properties[PROPS_NOTION.title] = { title: [{ plain_text: 'ประชุมทีม' }] };
  properties[PROPS_NOTION.date] = {
    date: {
      start: '2026-08-06T08:30:00+07:00',
      end: '2026-08-06T16:00:00+07:00',
    },
  };
  properties[PROPS_NOTION.status] = { select: { name: 'ยืนยันแล้ว' } };
  properties[PROPS_NOTION.assignee] = { multi_select: [{ name: 'สมชาย' }, { name: 'สมหญิง' }] };
  properties[PROPS_NOTION.location] = { rich_text: [{ plain_text: 'ห้องประชุม' }] };
  properties[PROPS_NOTION.details] = { rich_text: [{ plain_text: 'สรุปงาน' }] };
  properties[PROPS_NOTION.notes] = { rich_text: [{ plain_text: 'เตรียมเอกสาร' }] };

  const item = parseNotionPage_({ properties: properties });
  assertEqual_(item.title, 'ประชุมทีม');
  assertEqual_(item.start, '2026-08-06T08:30:00+07:00');
  assertEqual_(item.end, '2026-08-06T16:00:00+07:00');
  assertTrue_(item.isDatetime);
  assertEqual_(item.status, 'ยืนยันแล้ว');
  assertEqual_(item.assignees.join(', '), 'สมชาย, สมหญิง');
  assertEqual_(item.location, 'ห้องประชุม');
  assertEqual_(item.details, 'สรุปงาน');
  assertEqual_(item.notes, 'เตรียมเอกสาร');

  properties[PROPS_NOTION.status] = { status: { name: 'พร้อมแจ้ง' } };
  assertEqual_(parseNotionPage_({ properties: properties }).status, 'พร้อมแจ้ง');
}

function testTimeLabels_() {
  assertEqual_(itemTimeLabel_({ start: '2026-08-06', end: '2026-08-07', isDatetime: false }), 'ทั้งวัน');
  assertEqual_(
    itemTimeLabel_({ start: '2026-08-06T14:05:00', end: '2026-08-06T16:30:00', isDatetime: true }),
    '14:05–16:30'
  );
  assertEqual_(
    itemTimeLabel_({ start: '2026-08-06T01:30:00Z', end: '2026-08-06T09:00:00Z', isDatetime: true }),
    '08:30–16:00'
  );
  assertEqual_(itemTimeLabel_({ start: '2026-08-06T01:30:00Z', end: null, isDatetime: true }), '08:30');
}

function testItemSubFields_() {
  const fields = itemSubFields_({
    assignees: ['สมชาย'],
    location: 'ห้องประชุม',
    details: 'รายละเอียดงาน',
    notes: 'หมายเหตุภายใน',
  });
  assertEqual_(fields.length, 4);
  assertEqual_(fields.map(function (field) { return field.label; }).join(','), 'ผู้รับผิดชอบ,สถานที่,รายละเอียด,หมายเหตุ');

  const empty = itemSubFields_({ assignees: [], location: '', details: '', notes: '' });
  assertEqual_(empty.length, 0);
}

function testTextMessage_() {
  const message = buildLineMessage_(
    new Date('2026-08-06T08:30:00+07:00'),
    [createTestItem_()],
    [],
    'text'
  );
  assertEqual_(message.type, 'text');
  assertContains_(message.text, 'พฤหัสบดี 6 สิงหาคม 2569');
  assertContains_(message.text, '08:30');
  assertContains_(message.text, 'ประชุมทีม');
  assertContains_(message.text, 'ผู้รับผิดชอบ: สมชาย');
}

function testFlexMessage_() {
  const message = buildLineMessage_(
    new Date('2026-08-06T08:30:00+07:00'),
    [createTestItem_()],
    [],
    'flex'
  );
  assertEqual_(message.type, 'flex');
  assertContains_(message.altText, 'พฤหัสบดี 6 สิงหาคม 2569');
  assertContains_(message.altText, '(1 รายการ)');
  assertEqual_(message.contents.type, 'bubble');
  assertEqual_(message.contents.body.contents[1].contents.length, 1);
  const heading = message.contents.body.contents[1].contents[0].contents[0];
  assertEqual_(heading.contents[0].text, '08:30–16:00');
  assertEqual_(heading.contents[0].flex, 0);
  assertEqual_(heading.contents[0].adjustMode, 'shrink-to-fit');
  assertEqual_(heading.contents[1].flex, 1);
  assertTrue_(heading.contents[1].wrap);
}

function testMessagePreview_() {
  assertEqual_(messagePreview_({ type: 'text', text: 'ข้อความ' }), 'ข้อความ');
  assertEqual_(messagePreview_({ type: 'flex', altText: 'ข้อความสำรอง' }), 'ข้อความสำรอง');
}

function testCleanupOldFailCounts_() {
  const values = {
    FAIL_COUNT_2026_08_05: '2',
    FAIL_COUNT_2026_08_06: '1',
    OTHER_KEY: 'คงไว้',
  };
  const props = {
    getKeys: function () { return Object.keys(values); },
    deleteProperty: function (key) { delete values[key]; },
  };

  cleanupOldFailCounts_(props, '2026_08_06');
  assertFalse_(Object.prototype.hasOwnProperty.call(values, 'FAIL_COUNT_2026_08_05'));
  assertTrue_(Object.prototype.hasOwnProperty.call(values, 'FAIL_COUNT_2026_08_06'));
  assertTrue_(Object.prototype.hasOwnProperty.call(values, 'OTHER_KEY'));
}

function testNotionPlaceholder_() {
  assertThrows_(
    function () { resolveDataSourceId_('your_notion_database_id'); },
    'ยังไม่ได้ตั้งค่า notion_database_id'
  );
}

function createTestItem_() {
  return {
    title: 'ประชุมทีม',
    start: '2026-08-06T08:30:00+07:00',
    end: '2026-08-06T16:00:00+07:00',
    isDatetime: true,
    assignees: ['สมชาย'],
    location: 'ห้องประชุม',
    details: 'สรุปงาน',
    notes: '',
  };
}

// ---------- ระบบลางาน (ไฟล์ Leave*.gs) ----------

function createTestRoster_() {
  return [
    { row: 3, prefix: 'นาย', firstName: 'สมศักดิ์', lastName: 'ใจดี', groupName: 'กลุ่มงานคลังสินค้า', position: 'นักวิชาการสาธารณสุข', lineUserId: 'U_SUBMITTER', lineDisplayName: 'Somsak', registeredAt: '2026-08-01' },
    { row: 4, prefix: 'นางสาว', firstName: 'สมหญิง', lastName: 'ใจงาม', groupName: 'กลุ่มงานคลังสินค้า', position: 'นักบริหารงานสาธารณสุข', lineUserId: 'U_CHIEF', lineDisplayName: 'Somying', registeredAt: '2026-08-01' },
    { row: 5, prefix: '', firstName: 'สมชื่น', lastName: 'ใจเย็น', groupName: 'กลุ่มงานแพทย์และการพยาบาล', position: 'พยาบาลวิชาชีพ', lineUserId: 'U_NURSE', lineDisplayName: 'Somchuen', registeredAt: '2026-08-01' },
    { row: 6, prefix: 'นาย', firstName: 'สมชาย', lastName: 'ใจแข็ง', groupName: 'กลุ่มงานแพทย์และการพยาบาล', position: 'พยาบาลวิชาชีพ', lineUserId: '', lineDisplayName: '', registeredAt: '' },
    { row: 7, prefix: 'นาย', firstName: 'สมพร', lastName: 'ผู้อำนวยการดี', groupName: 'บริหาร', position: 'นักบริหารงานสาธารณสุข', lineUserId: 'U_SECOND1', lineDisplayName: 'ChiefOffice1', registeredAt: '2026-08-01' },
    { row: 8, prefix: 'นาง', firstName: 'สมศรี', lastName: 'ผู้อำนวยการดี', groupName: 'บริหาร', position: 'นักบริหารงานสาธารณสุข', lineUserId: 'U_SECOND2', lineDisplayName: 'ChiefOffice2', registeredAt: '2026-08-01' },
  ];
}

// คอนฟิกจำลองตามโครงชีต Approvers: กลุ่มงาน | ผู้อนุมัติ | ส่งต่อ หัวหน้า สสอ.
function createTestApproversConfig_() {
  return [
    { row: 3, groupName: 'กลุ่มงานคลังสินค้า', approverNames: ['สมหญิง ใจงาม'], forward: true },
    { row: 4, groupName: 'กลุ่มงานแพทย์และการพยาบาล', approverNames: ['สมชื่น ใจเย็น'], forward: false },
  ];
}

function createTestSettings_() {
  return { second_approvers: 'สมพร ผู้อำนวยการดี, สมศรี ผู้อำนวยการดี' };
}

function createTestLeave_() {
  return {
    pageId: 'test-page-id',
    pageUrl: 'https://www.notion.so/test-page-id',
    fullName: 'นายสมศักดิ์ ใจดี',
    groupName: 'กลุ่มงานคลังสินค้า',
    submitterUserId: 'U_SUBMITTER',
    leaveType: 'ลากิจ',
    start: '2026-08-20',
    end: '2026-08-21',
    reason: 'ไปต่อด่านที่ว่าการอำเภอ',
    status: LEAVE_STATUS.pendingApprover,
    currentApprover: { stage: 'first', userIds: ['U_CHIEF'], names: ['นางสาวสมหญิง ใจงาม'] },
    audit: '',
    workDays: 2,
  };
}

function testStaffDisplayName_() {
  const roster = createTestRoster_();
  assertEqual_(staffDisplayName_(roster[0]), 'นาย สมศักดิ์ ใจดี');
  assertEqual_(staffDisplayName_(roster[2]), 'สมชื่น ใจเย็น'); // ไม่ได้กรอกคำนำหน้า
  assertEqual_(staffKey_(roster[0]), 'สมศักดิ์ ใจดี'); // key ที่ใช้อ้างในชีต Approvers
  assertEqual_(staffDisplayName_(null), '');
  // ช่องว่างซ้ำต้องยุบเป็นช่องเดียว เพื่อจับคู่กับชื่อที่ผู้ดูแลพิมพ์ในชีตได้
  assertEqual_(staffKey_({ firstName: 'สมศักดิ์', lastName: 'ใจ  ดี' }), 'สมศักดิ์ ใจ ดี');
}

function testResolveApprovalChain_() {
  const roster = createTestRoster_();
  const config = createTestApproversConfig_();
  const settings = createTestSettings_();

  // ปกติ: ผู้อนุมัติของกลุ่ม (ลงทะเบียนแล้ว) และกลุ่มนี้ต้องส่งต่อ หัวหน้า สสอ.
  const normal = resolveApprovalChain_(config, settings, roster, roster[0]);
  assertEqual_(normal.stage, 'first');
  assertEqual_(normal.targets.length, 1);
  assertEqual_(normal.targets[0].lineUserId, 'U_CHIEF');
  assertTrue_(normal.needsSecond);

  // กลุ่มที่ไม่ต้องส่งต่อ (ผู้ยื่นคนละคนกับผู้อนุมัติ)
  const noForward = resolveApprovalChain_(config, settings, roster, roster[3]);
  assertEqual_(noForward.stage, 'first');
  assertFalse_(noForward.needsSecond);
  assertEqual_(noForward.targets[0].lineUserId, 'U_NURSE');

  // ผู้ยื่นคือผู้อนุมัติของกลุ่มตัวเอง + กลุ่มส่งต่อ → ข้ามไป หัวหน้า สสอ. ทันที
  const selfApprover = resolveApprovalChain_(config, settings, roster, roster[1]);
  assertEqual_(selfApprover.stage, 'second');
  assertEqual_(selfApprover.targets.map(s => s.lineUserId).join(','), 'U_SECOND1,U_SECOND2');

  // ผู้ยื่นคือผู้อนุมัติของกลุ่มที่ "ไม่" ส่งต่อ → คอนฟิกไม่สมเหตุสมผล ต้อง throw
  assertThrows_(
    function () { resolveApprovalChain_(config, settings, roster, roster[2]); },
    'ส่งต่อให้ หัวหน้า สสอ.'
  );

  // หัวหน้า สสอ. ยื่นเอง → นอกระบบ
  assertThrows_(
    function () { resolveApprovalChain_(config, settings, roster, roster[4]); },
    'นอกระบบนี้'
  );

  // กลุ่มงานที่ยังไม่มีแถวในชีต Approvers (ต้องเป็นคนที่ไม่อยู่ในลิสต์ หัวหน้า สสอ. ไม่งั้นชนเคสนอกระบบก่อน)
  const orphanStaff = { prefix: 'นาย', firstName: 'สมโชค', lastName: 'ใจสั้น', groupName: 'กลุ่มงานซ่อมบำรุง', position: 'ช่างซ่อมบำรุง', lineUserId: 'U_ORPHAN', lineDisplayName: '', registeredAt: '2026-08-01' };
  assertThrows_(
    function () { resolveApprovalChain_(config, settings, roster, orphanStaff); },
    'ยังไม่ได้ตั้งค่าผู้อนุมัติ'
  );

  // ผู้อนุมัติของกลุ่มยังไม่ลงทะเบียน + กลุ่มส่งต่อ → เริ่มที่ หัวหน้า สสอ. ทันที
  const configUnregistered = [{ groupName: 'กลุ่มงานคลังสินค้า', approverNames: ['สมชาย ใจแข็ง'], forward: true }];
  const escalated = resolveApprovalChain_(configUnregistered, settings, roster, roster[0]);
  assertEqual_(escalated.stage, 'second');
  assertEqual_(escalated.targets.length, 2);

  // ผู้อนุมัต์ของกลุ่มยังไม่ลงทะเบียน + ไม่ส่งต่อ → ใช้พูลผู้อนุมัติอื่นที่ลงทะเบียนแล้ว (การ์ดเข้ากลุ่มหลัก)
  const configUnregisteredNoForward = [{ groupName: 'กลุ่มงานคลังสินค้า', approverNames: ['สมชาย ใจแข็ง'], forward: false }];
  const pooled = resolveApprovalChain_(configUnregisteredNoForward, settings, roster, roster[0]);
  assertEqual_(pooled.stage, 'first');
  assertTrue_(pooled.viaPool);
  assertTrue_(pooled.targets.length >= 2);
}

function testCanApproveLeave_() {
  const approverInfo = { stage: 'first', userIds: ['U_CHIEF'], names: ['นางสาวสมหญิง ใจงาม'] };

  // ต้องตรง userId ของผู้อนุมัติปัจจุบันเท่านั้น (ชั้นป้องกันหลักแทน signature)
  assertTrue_(canApproveLeave_(approverInfo, 'U_CHIEF'));
  assertFalse_(canApproveLeave_(approverInfo, 'U_SUBMITTER'));
  assertFalse_(canApproveLeave_(approverInfo, 'U_SECOND1'));

  // ใบลาจบแล้ว (ไม่มีข้อมูลผู้อนุมัติปัจจุบัน)
  assertFalse_(canApproveLeave_(null, 'U_CHIEF'));
}

function testLeaveSystemSwitch_() {
  // ยังไม่มีแถว / ค่าว่าง / ค่าอื่นใด = เปิด (default เป็น ON เพื่อไม่กระทบระบบที่ติดตั้งไว้ก่อนมีสวิตช์)
  assertTrue_(isLeaveSystemEnabled_({}));
  assertTrue_(isLeaveSystemEnabled_({ leave_system_enabled: '' }));
  assertTrue_(isLeaveSystemEnabled_(null));
  assertTrue_(isLeaveSystemEnabled_({ leave_system_enabled: 'TRUE' }));
  assertTrue_(isLeaveSystemEnabled_({ leave_system_enabled: 'true' }));
  assertTrue_(isLeaveSystemEnabled_({ leave_system_enabled: 'ยังไม่ตั้ง' })); // ค่าแปลกๆ ไม่ปิดระบบเงียบๆ
  assertFalse_(isLeaveSystemEnabled_({ leave_system_enabled: 'FALSE' }));
  assertFalse_(isLeaveSystemEnabled_({ leave_system_enabled: ' false ' }));

  // ข้อความตอนปิด: มี custom ใช้ custom, ไม่มีใช้มาตรฐาน
  assertContains_(leaveClosedMessage_({}), 'ปิดรับคำขอ');
  assertEqual_(leaveClosedMessage_({ leave_closed_message: 'ปิด 15-20 ต.ค. ติดต่อ คุณเอ 0x-xxx-xxxx' }),
    'ปิด 15-20 ต.ค. ติดต่อ คุณเอ 0x-xxx-xxxx');

  // requireLeaveSystemEnabled_ ต้อง throw ด้วยข้อความเดียวกันเมื่อปิด
  assertThrows_(
    function () { requireLeaveSystemEnabled_({ leave_system_enabled: 'FALSE' }); },
    'ปิดรับคำขอ'
  );
}

function testLeaveApprovalSwitch_() {
  // default เป็น "เปิดการอนุมัติ" — ค่าว่าง/แถวหาย/ค่าแปลกๆ ไม่เปลี่ยนพฤติกรรมระบบเดิม
  assertTrue_(isLeaveApprovalEnabled_({}));
  assertTrue_(isLeaveApprovalEnabled_(null));
  assertTrue_(isLeaveApprovalEnabled_({ leave_approval_enabled: '' }));
  assertTrue_(isLeaveApprovalEnabled_({ leave_approval_enabled: 'TRUE' }));
  assertFalse_(isLeaveApprovalEnabled_({ leave_approval_enabled: 'FALSE' }));
  assertFalse_(isLeaveApprovalEnabled_({ leave_approval_enabled: ' false ' }));
  // สองสวิตช์เป็นอิสระกัน
  assertTrue_(isLeaveApprovalEnabled_({ leave_system_enabled: 'FALSE' }));
}

function testBuildLeaveNoticeBubble_() {
  const bubble = buildLeaveNoticeBubble_(createTestLeave_());

  // การ์ดแจ้งลาต้องไม่มีปุ่มกดใดๆ (เป็นการแจ้งเพื่อทราบ)
  assertEqual_(bubble.header.contents[0].text, 'แจ้งการลา');
  const footerText = JSON.stringify(bubble.footer);
  assertFalse_(footerText.indexOf('postback') !== -1);
  assertFalse_(footerText.indexOf('"button"') !== -1);
  // เนื้อหาใบลายังครบเหมือนการ์ดขออนุมัติ (ชื่อเต็มอยู่ใน header, รายละเอียดอยู่ใน body)
  assertContains_(JSON.stringify(bubble), createTestLeave_().fullName);
  assertContains_(JSON.stringify(bubble.body), 'ลากิจ');
}

function testComputeWorkDays_() {
  const holidays = new Set();
  // เต็มวันหลายวัน: 20–24 ส.ค. 2569 (พฤ–จัน ข้ามเสาร์อาทิตย์) = 3 วันทำการ — ครึ่งวันไม่มีผลกับหลายวัน
  assertEqual_(computeWorkDays_('2026-08-20', '2026-08-24', holidays, 'ครึ่งวันเช้า'), 3);
  // ลา 1 วันเต็มวัน
  assertEqual_(computeWorkDays_('2026-08-20', '2026-08-20', holidays, 'เต็มวัน'), 1);
  // ลา 1 วันครึ่งวัน = 0.5 (ไม่สนวันหยุดเพราะครึ่งวันใช้ได้เฉพาะวันทำการอยู่แล้วโดยการเลือกของผู้ใช้)
  assertEqual_(computeWorkDays_('2026-08-20', '2026-08-20', holidays, 'ครึ่งวันบ่าย'), 0.5);
  assertEqual_(computeWorkDays_('2026-08-20', null, holidays, 'ครึ่งวันเช้า'), 0.5);

  // ช่วงวันถูก normalize: ประเภทที่ลาครึ่งวันไม่ได้ / หลายวัน / ค่าไม่รู้จัก → เต็มวันเสมอ
  assertEqual_(normalizeLeavePeriod_('ครึ่งวันเช้า', 'ลาป่วย', '2026-08-20', '2026-08-20'), 'ครึ่งวันเช้า');
  assertEqual_(normalizeLeavePeriod_('ครึ่งวันเช้า', 'ลาคลอด', '2026-08-20', '2026-08-20'), 'เต็มวัน');
  assertEqual_(normalizeLeavePeriod_('ครึ่งวันเช้า', 'ลาป่วย', '2026-08-20', '2026-08-22'), 'เต็มวัน');
  assertEqual_(normalizeLeavePeriod_('ค่าแปลก', 'ลาป่วย', '2026-08-20', '2026-08-20'), 'เต็มวัน');
  assertEqual_(normalizeLeavePeriod_('', 'ลากิจ', '2026-08-20', null), 'เต็มวัน');

  // ป้ายวันทำการแบบครึ่งวัน
  assertEqual_(workDaysLabel_(0.5), '½ วัน');
  assertEqual_(workDaysLabel_(1), '1 วัน');
  assertEqual_(workDaysLabel_(2.5), '2½ วัน');
  assertEqual_(workDaysLabel_(3), '3 วัน');
}

function testBuildLeaveWarnings_() {
  // เกินโควตาลากิจ (ใช้ 8 + ยื่น 3 = 11 > 10)
  let w = buildLeaveWarnings_('ลากิจ', 3, { 'ลากิจ': 8 });
  assertEqual_(w.length, 1);
  assertContains_(w[0], 'เกินสิทธิ์');
  assertContains_(w[0], '11');
  // ครบสิทธิ์พอดี = แจ้งเตือนเตือนล่วงหน้า
  w = buildLeaveWarnings_('ลากิจ', 2, { 'ลากิจ': 8 });
  assertEqual_(w.length, 1);
  assertContains_(w[0], 'ครบสิทธิ์');
  // ยังไม่ถึง = เงียบ
  w = buildLeaveWarnings_('ลากิจ', 1, { 'ลากิจ': 8 });
  assertEqual_(w.length, 0);
  // ไม่มีข้อมูล usage (อ่าน Notion ไม่ได้) = ไม่เตือนเรื่องสิทธิ์ แต่เตือนใบแพทย์ยังทำงาน
  w = buildLeaveWarnings_('ลาป่วย', 5, null);
  assertEqual_(w.length, 1);
  assertContains_(w[0], 'ใบรับรองแพทย์');
  // ลาป่วย 3 วันทำการพอดี = ไม่ต้องมีใบแพทย์ / เกิน = ต้องมี
  assertEqual_(buildLeaveWarnings_('ลาป่วย', 3, null).length, 0);
  assertContains_(buildLeaveWarnings_('ลาป่วย', 4, null)[0], 'ใบรับรองแพทย์');
  // ลาป่วย ≥ 30 วันทำการ = กฎใบแพทย์ทุกครั้ง
  w = buildLeaveWarnings_('ลาป่วย', 30, null);
  assertEqual_(w.length, 1);
  assertContains_(w[0], 'ทุกครั้ง');
  // ลาพักผ่อน 11 วัน = เตือนพร้อมกัน 2 ข้อ: เกิน 10/ปี (ฐานสิทธิ์รายปี) + เกิน 10/ครั้ง (ต้องเป็นสะสม)
  w = buildLeaveWarnings_('ลาพักร้อน', 11, { 'ลาพักร้อน': 0 });
  assertEqual_(w.length, 2);
  assertContains_(w.join(' '), 'สะสม');
  assertContains_(w.join(' '), 'เกินสิทธิ์');
  // ครึ่งวันรวมยอดทศนิยมได้ (ใช้ 9.5 + ยื่น 0.5 = 10 พอดี = ครบสิทธิ์)
  w = buildLeaveWarnings_('ลากิจ', 0.5, { 'ลากิจ': 9.5 });
  assertContains_(w[0], 'ครบสิทธิ์');
}

function testBuildUsageSummary_() {
  const summary = buildUsageSummary_({ 'ลากิจ': 3.5, 'ลาป่วย': 2 });
  assertEqual_(summary['ลากิจ'].used, 3.5);
  assertEqual_(summary['ลากิจ'].quota, 10);
  assertEqual_(summary['ลาป่วย'].quota, null); // ลาป่วยไม่จำกัด
  assertEqual_(summary['ลาคลอด'].used, 0); // ประเภทมีโควตาแต่ยังไม่เคยใช้ก็แสดง
  assertEqual_(summary['ลาคลอด'].quota, 90);
  assertEqual_(buildUsageSummary_(null), null); // ไม่มีข้อมูล = null
}

function testLeaveDisplayEnrichment_() {
  // วันทำการถัดไป: จากศุกร์ 21 ส.ค. 2569 → ข้ามเสาร์-อาทิตย์ → จันทร์ 24 ส.ค.
  assertEqual_(nextWorkingDayStr_('2026-08-21', new Set()), '2026-08-24');
  // ข้ามวันหยุดราชการด้วย (จันทร์ 24 เป็นวันหยุด → อังคาร 25)
  assertEqual_(nextWorkingDayStr_('2026-08-21', new Set(['2026-08-24'])), '2026-08-25');
  // วันธรรมดาปกติ → วันถัดไปเลย
  assertEqual_(nextWorkingDayStr_('2026-08-20', new Set()), '2026-08-21');

  // enrich: ลาช่วง 20–24 ส.ค. (3 วันทำการ) วันนี้คือ 21 (ศุกร์ = วันทำการที่ 2) + กลับวันอังคาร
  const enriched = enrichLeaveForDisplay_({
    fullName: 'นายสมศักดิ์ ใจดี', groupName: 'กลุ่มงานคลังสินค้า', leaveType: 'ลาพักร้อน',
    submitterUserId: 'U_SUBMITTER', start: '2026-08-20', end: '2026-08-24', period: 'เต็มวัน', workDays: 3,
  }, '2026-08-21', new Set());
  // ลาวันสุดท้ายคือจันทร์ 24 → กลับทำการวันถัดไป อังคาร 25 ส.ค. 2569 (ถ้อยคำทางการพร้อมปี)
  assertEqual_(enriched.returnLabel, '25 ส.ค. 2569');
  // ชื่อเฉพาะ: จาก roster ถ้ามี userId ตรง ไม่มี roster ก็ตัดจากชื่อเต็ม (ทนต่อคำนำหน้าทั้งแบบเกาะ/คั่น)
  assertEqual_(enriched.firstName, 'สมศักดิ์');
  assertEqual_(leaveFirstName_({ fullName: 'นางสาวสมหญิง ใจงาม' }, null), 'สมหญิง');
  assertEqual_(leaveFirstName_({ fullName: 'แพทย์หญิงสมพร ดี' }, null), 'สมพร');
  assertEqual_(leaveFirstName_({ fullName: 'สมชาย ใจแข็ง' }, null), 'สมชาย');
  assertEqual_(leaveFirstName_({ fullName: 'นายสมศักดิ์ ใจดี' }, createTestRoster_()), 'สมศักดิ์');
  // ส่วนขยายท้ายแถว (ทางการแต่สั้น) + บรรทัดรายละเอียดเต็ม
  assertEqual_(leaveFormalSuffix_(enriched), '3 วันทำการ กลับทำงาน 25 ส.ค. 2569');
  assertEqual_(leaveSummaryLabel_(enriched), 'ลาพักร้อน 3 วันทำการ กลับทำงาน 25 ส.ค. 2569');

  // ลาครึ่งวัน = ถ้อยคำทางการ "ครึ่งวันช่วงเช้า/บ่าย" ไม่มี dayNo/วันกลับ (จบในวันเดียว)
  const halfDay = enrichLeaveForDisplay_({
    fullName: 'นายสมศักดิ์ ใจดี', groupName: 'กลุ่มงานคลังสินค้า', leaveType: 'ลากิจ',
    start: '2026-08-21', end: '2026-08-21', period: 'ครึ่งวันเช้า', workDays: 0.5,
  }, '2026-08-21', new Set());
  assertEqual_(leaveFormalSuffix_(halfDay), 'ครึ่งวันช่วงเช้า');
  assertFalse_(halfDay.returnLabel ? true : false);

  // วันสุดท้ายของช่วงลา (end == today) = ไม่แสดงวันกลับ เหลือแค่จำนวนวันทั้งช่วง
  const lastDay = enrichLeaveForDisplay_({
    fullName: 'นายสมศักดิ์ ใจดี', start: '2026-08-20', end: '2026-08-21', workDays: 2, period: 'เต็มวัน',
  }, '2026-08-21', new Set());
  assertFalse_(lastDay.returnLabel ? true : false);
  assertEqual_(leaveFormalSuffix_(lastDay), '2 วันทำการ');
}

function testFindDuplicates_() {
  assertEqual_(findDuplicates_(['a', 'b', 'a', 'c', 'b', 'a']).join(','), 'a,b');
  assertEqual_(findDuplicates_(['a', 'b', 'c']).length, 0);
  assertEqual_(findDuplicates_([]).length, 0);
  assertEqual_(findDuplicates_(null).length, 0);
  assertEqual_(findDuplicates_(['', '', 'x']).length, 0); // ค่าว่างไม่นับเป็นซ้ำ
}

function testCountBusinessDays_() {
  // 20–24 ส.ค. 2569 (พฤ–จัน): ข้ามเสาร์ 22 / อาทิตย์ 23 เหลือ 3 วันทำการ
  assertEqual_(countBusinessDays_('2026-08-20', '2026-08-24', new Set()), 3);
  // มีวันหยุดราชการศุกร์ 21 ด้วย → เหลือ 2
  assertEqual_(countBusinessDays_('2026-08-20', '2026-08-24', new Set(['2026-08-21'])), 2);
  // วันเดียววันธรรมดา = 1, วันเสาร์ = 0
  assertEqual_(countBusinessDays_('2026-08-20', '2026-08-20', new Set()), 1);
  assertEqual_(countBusinessDays_('2026-08-22', '2026-08-22', new Set()), 0);
}

function testLeaveRangeOverlap_() {
  assertTrue_(leaveRangeOverlap_('2026-08-18', '2026-08-22', '2026-08-20'));
  assertFalse_(leaveRangeOverlap_('2026-08-18', '2026-08-22', '2026-08-23'));
  assertFalse_(leaveRangeOverlap_('2026-08-18', '2026-08-22', '2026-08-17'));
  // ลาวันเดียว (ไม่มีค่า end)
  assertTrue_(leaveRangeOverlap_('2026-08-20', null, '2026-08-20'));
  assertFalse_(leaveRangeOverlap_('2026-08-20', null, '2026-08-21'));
}

function testLeaveDateLabel_() {
  assertEqual_(leaveDateLabel_('2026-08-20', null), '20 ส.ค. 2569');
  assertEqual_(leaveDateLabel_('2026-08-20', '2026-08-20'), '20 ส.ค. 2569');
  assertEqual_(leaveDateLabel_('2026-08-20', '2026-08-22'), '20–22 ส.ค. 2569');
  assertEqual_(leaveDateLabel_('2026-08-30', '2026-09-02'), '30 ส.ค. 2569 – 2 ก.ย. 2569');
}

function testSplitConfigNames_() {
  assertEqual_(
    splitConfigNames_('นาย, นางสาว ,อื่นๆ').join('|'),
    'นาย|นางสาว|อื่นๆ'
  );
  assertEqual_(splitConfigNames_('').length, 0);
  assertEqual_(splitConfigNames_(null).length, 0);
}

function testBuildLeavePagePayload_() {
  const approvers = [createTestRoster_()[1]];
  const payload = buildLeavePagePayload_({
    dataSourceId: 'DS_ID',
    fullName: 'นายสมศักดิ์ ใจดี',
    groupName: 'กลุ่มงานคลังสินค้า',
    submitterUserId: 'U_SUBMITTER',
    leaveType: 'ลากิจ',
    start: '2026-08-20',
    end: '2026-08-21',
    reason: 'ไปต่อด่าน',
    workDays: 2,
    initialStatus: LEAVE_STATUS.pendingApprover,
    currentApprover: serializeApproverInfo_('first', approvers),
  });

  assertEqual_(payload.parent.data_source_id, 'DS_ID');
  assertEqual_(payload.properties[PROPS_LEAVE.title].title[0].text.content, 'นายสมศักดิ์ ใจดี');
  assertEqual_(payload.properties[PROPS_LEAVE.submitter].rich_text[0].text.content, 'U_SUBMITTER');
  assertEqual_(payload.properties[PROPS_LEAVE.type].select.name, 'ลากิจ');
  assertEqual_(payload.properties[PROPS_LEAVE.date].date.start, '2026-08-20');
  assertEqual_(payload.properties[PROPS_LEAVE.date].date.end, '2026-08-21');
  assertEqual_(payload.properties[PROPS_LEAVE.status].select.name, 'รอผู้อนุมัติ');
  assertEqual_(payload.properties[PROPS_LEAVE.workDays].number, 2);
  // currentApprover เก็บเป็น JSON {stage, userIds, names} ที่อ่านกลับมาได้ครบ
  const parsed = JSON.parse(payload.properties[PROPS_LEAVE.currentApprover].rich_text[0].text.content);
  assertEqual_(parsed.stage, 'first');
  assertEqual_(parsed.userIds.join(','), 'U_CHIEF');

  // กรณีเริ่มที่ หัวหน้า สสอ. ทันที (ผู้ยื่นคือผู้อนุมัติของกลุ่มตัวเอง)
  const directPayload = buildLeavePagePayload_({
    dataSourceId: 'DS_ID', fullName: 'นางสาวสมหญิง ใจงาม', groupName: 'กลุ่มงานคลังสินค้า',
    submitterUserId: 'U_CHIEF', leaveType: 'ลาพักร้อน', start: '2026-08-20', end: '2026-08-20',
    reason: '', workDays: 1,
    initialStatus: LEAVE_STATUS.pendingChiefOffice,
    currentApprover: serializeApproverInfo_('second', []),
  });
  assertEqual_(directPayload.properties[PROPS_LEAVE.status].select.name, 'รอหัวหน้า สสอ.อนุมัติ');
}

function testParseLeavePage_() {
  const leave = createTestLeave_();
  const properties = {};
  properties[PROPS_LEAVE.title] = { title: [{ plain_text: leave.fullName }] };
  properties[PROPS_LEAVE.groupName] = { rich_text: [{ plain_text: leave.groupName }] };
  properties[PROPS_LEAVE.submitter] = { rich_text: [{ plain_text: leave.submitterUserId }] };
  properties[PROPS_LEAVE.type] = { select: { name: leave.leaveType } };
  properties[PROPS_LEAVE.date] = { date: { start: leave.start, end: leave.end } };
  properties[PROPS_LEAVE.reason] = { rich_text: [{ plain_text: leave.reason }] };
  properties[PROPS_LEAVE.status] = { select: { name: leave.status } };
  properties[PROPS_LEAVE.currentApprover] = { rich_text: [{ plain_text: JSON.stringify(leave.currentApprover) }] };
  properties[PROPS_LEAVE.audit] = { rich_text: [{ plain_text: '20/08/69 10:00 นางสาวสมหญิง ใจงาม(หัวหน้ากลุ่มงาน) อนุมัติ' }] };
  properties[PROPS_LEAVE.workDays] = { number: 2 };

  const parsed = parseLeavePage_({ id: leave.pageId, url: leave.pageUrl, properties: properties });
  assertEqual_(parsed.pageId, leave.pageId);
  assertEqual_(parsed.fullName, leave.fullName);
  assertEqual_(parsed.groupName, leave.groupName);
  assertEqual_(parsed.submitterUserId, 'U_SUBMITTER');
  assertEqual_(parsed.leaveType, 'ลากิจ');
  assertEqual_(parsed.start, '2026-08-20');
  assertEqual_(parsed.end, '2026-08-21');
  assertEqual_(parsed.status, 'รอผู้อนุมัติ');
  assertEqual_(parsed.currentApprover.stage, 'first');
  assertEqual_(parsed.currentApprover.userIds.join(','), 'U_CHIEF');
  assertContains_(parsed.audit, 'อนุมัติ');
  assertEqual_(parsed.workDays, 2);

  // currentApprover เป็น JSON เสีย/ว่าง → null ไม่ throw
  properties[PROPS_LEAVE.currentApprover] = { rich_text: [{ plain_text: 'not-json' }] };
  assertEqual_(parseLeavePage_({ properties: properties }).currentApprover, null);
  properties[PROPS_LEAVE.currentApprover] = { rich_text: [] };
  assertEqual_(parseLeavePage_({ properties: properties }).currentApprover, null);
}

function testBuildLeaveApprovalBubble_() {
  const bubble = buildLeaveApprovalBubble_(createTestLeave_());

  assertEqual_(bubble.type, 'bubble');
  assertEqual_(bubble.header.contents[1].text, 'นายสมศักดิ์ ใจดี');

  // footer ต้องมีปุ่ม postback 2 ปุ่ม: อนุมัติ / ไม่อนุมัติ พร้อม pageId ฝังใน data
  const buttons = bubble.footer.contents;
  assertEqual_(buttons.length, 2);
  assertEqual_(buttons[0].action.type, 'postback');
  assertEqual_(buttons[0].action.displayText, 'อนุมัติ');
  const approveData = JSON.parse(buttons[0].action.data);
  assertEqual_(approveData.t, 'leave');
  assertEqual_(approveData.a, 'approve');
  assertEqual_(approveData.p, 'test-page-id');
  const rejectData = JSON.parse(buttons[1].action.data);
  assertEqual_(rejectData.a, 'reject');
  assertTrue_(buttons[0].action.data.length <= 300); // ลิมิต postback data ของ LINE

  // ฟิลด์ข้อมูลครบ: กลุ่มงาน/ประเภท/วันที่/วันทำการ/เหตุผล
  const bodyTexts = JSON.stringify(bubble.body);
  assertContains_(bodyTexts, 'กลุ่มงานคลังสินค้า');
  assertContains_(bodyTexts, 'ลากิจ');
  assertContains_(bodyTexts, '20–21 ส.ค. 2569');
  assertContains_(bodyTexts, '2 วัน');
  assertContains_(bodyTexts, 'ไปต่อด่านที่ว่าการอำเภอ');
}

function testTextMessageWithLeaves_() {
  const date = new Date('2026-08-20T08:00:00+07:00');
  // ผ่าน enrich ก่อนเหมือนเส้นทางจริง (getApprovedLeavesForDay_) เพื่อให้ได้ชื่อเฉพาะ/ป้ายทางการ
  const leave = enrichLeaveForDisplay_(createTestLeave_(), '2026-08-20', new Set());

  // มีทั้งงานและผู้ลา — แถวผู้ลาเป็น "ชื่อเฉพาะ + ประเภท + ถ้อยคำทางการ" ไม่มีกลุ่มงาน/คำนำหน้า/นามสกุล
  const both = buildLineMessage_(date, [createTestItem_()], [leave], 'text');
  assertContains_(both.text, 'ประชุมทีม');
  assertContains_(both.text, 'ผู้ลาวันนี้ (1 คน)');
  assertContains_(both.text, '• สมศักดิ์ ลากิจ');
  assertFalse_(both.text.indexOf('นายสมศักดิ์ ใจดี') !== -1);
  assertFalse_(both.text.indexOf('กลุ่มงานคลังสินค้า') !== -1);

  // ไม่มีงานเลยแต่มีผู้ลา → ยังส่งข้อความได้
  const leaveOnly = buildLineMessage_(date, [], [leave], 'text');
  assertContains_(leaveOnly.text, 'ผู้ลาวันนี้ (1 คน)');
  assertFalse_(leaveOnly.text.indexOf('ประชุมทีม') !== -1);
}

function testFlexMessageWithLeaves_() {
  const date = new Date('2026-08-20T08:00:00+07:00');
  const leave = enrichLeaveForDisplay_(createTestLeave_(), '2026-08-20', new Set());

  const leaveOnly = buildLineMessage_(date, [], [leave], 'flex');
  assertEqual_(leaveOnly.type, 'flex');
  assertContains_(leaveOnly.altText, 'ผู้ลา 1 คน');

  const body = leaveOnly.contents.body.contents;
  // body = [เส้นคาด, กล่องผู้ลา] เมื่อไม่มีรายการงาน (ไม่มี separator คั่น)
  assertEqual_(body.length, 2);
  const leaveBox = body[1];
  assertEqual_(leaveBox.contents[0].text, '🏖️ ผู้ลาวันนี้ (1 คน)');
  // แถวผู้ลา: บรรทัดชื่อเฉพาะ (หนา) + บรรทัดรายละเอียด (ประเภท + ถ้อยคำทางการ)
  assertContains_(JSON.stringify(leaveBox), 'สมศักดิ์');
  assertContains_(JSON.stringify(leaveBox), 'ลากิจ');

  // มีงาน + ผู้ลา → มี separator เต็มความกว้างคั่นกลาง
  const both = buildLineMessage_(date, [createTestItem_()], [leave], 'flex');
  const bothBody = both.contents.body.contents;
  assertEqual_(bothBody.length, 4); // [เส้นคาด, กล่องงาน, separator, กล่องผู้ลา]
  assertEqual_(bothBody[2].type, 'separator');
}

// ส่วน "ล่วงหน้า" ที่ต่อท้ายข้อความเช้า (advance_notice_days ใน Settings)
function testAdvanceNoticeSection_() {
  const date = new Date('2026-08-20T08:00:00+07:00'); // พฤหัสบดี 20 ส.ค. 2569
  const leave = enrichLeaveForDisplay_(createTestLeave_(), '2026-08-20', new Set());
  const advance = {
    date: new Date('2026-08-21T08:00:00+07:00'), // ศุกร์ 21 ส.ค. 2569
    items: [createTestItem_()],
    leaves: [enrichLeaveForDisplay_(createTestLeave_(), '2026-08-21', new Set())],
  };

  // text: ส่วนของวันนี้ครบตามเดิม + ส่วนล่วงหน้าแยกหัวข้อ มีวันเป้าหมายกำกับชัดเจน
  const both = buildLineMessage_(date, [createTestItem_()], [leave], 'text', advance);
  assertContains_(both.text, 'ผู้ลาวันนี้ (1 คน)');
  assertContains_(both.text, '🔭 วันพรุ่งนี้ · ศุกร์ 21 สิงหาคม 2569');
  assertContains_(both.text, 'ผู้ลา (1 คน)');
  assertEqual_(both.text.split('ประชุมทีม').length - 1, 2); // งานเดียวกันโผล่ทั้งวันนี้และล่วงหน้า

  // text: วันนี้ว่างเปล่าแต่วันล่วงหน้ามีข้อมูล → ยังส่งได้ มีแค่ส่วนล่วงหน้า
  const advOnly = buildLineMessage_(date, [], [], 'text', advance);
  assertContains_(advOnly.text, '🔭 วันพรุ่งนี้ · ศุกร์ 21 สิงหาคม 2569');
  assertFalse_(advOnly.text.indexOf('ผู้ลาวันนี้') !== -1);

  // ไม่ส่ง advance มา → ไม่มีส่วนล่วงหน้า (พฤติกรรมเดิมก่อนมีฟีเจอร์นี้)
  const noAdvance = buildLineMessage_(date, [createTestItem_()], [], 'text');
  assertFalse_(noAdvance.text.indexOf('🔭') !== -1);

  // flex: ส่วนล่วงหน้าอยู่ท้ายการ์ด [เส้นคาด, กล่องงาน, separator, กล่องผู้ลา, separator, กล่องล่วงหน้า]
  const flex = buildLineMessage_(date, [createTestItem_()], [leave], 'flex', advance);
  assertContains_(flex.altText, 'ล่วงหน้า 2 รายการ');
  const body = flex.contents.body.contents;
  assertEqual_(body.length, 6);
  assertContains_(JSON.stringify(body[5]), '🔭 วันพรุ่งนี้ · ศุกร์ 21 สิงหาคม 2569');
  assertContains_(JSON.stringify(body[5]), 'ประชุมทีม');
  assertContains_(JSON.stringify(body[5]), 'ลากิจ');

  // ค่า advance_notice_days นอกช่วง 1-7 (รวมเว้นว่าง) → collectAdvanceNotice_ คืน null โดยไม่ต้องยิง Notion
  const now = new Date();
  [undefined, '', '0', '8', 'abc'].forEach(v => {
    assertEqual_(collectAdvanceNotice_(now, { advance_notice_days: v }), null, 'ค่า ' + v + ' ต้องปิดส่วนล่วงหน้า');
  });

  // หัวข้อเลือกคำตามระยะ: ถัดไป 1 วัน = "วันพรุ่งนี้" (ยืนยันด้านบนแล้ว) / ไกลกว่านั้น = "ล่วงหน้า"
  const farAdvance = {
    date: new Date('2026-08-24T08:00:00+07:00'), // จันทร์ 24 ส.ค. ห่างจาก พฤ. 20 ส.ค. 4 วัน
    items: [createTestItem_()],
    leaves: [],
  };
  const far = buildLineMessage_(date, [], [], 'text', farAdvance);
  assertContains_(far.text, '🔭 ล่วงหน้า · จันทร์ 24 สิงหาคม 2569');
}

// ตัวช่วยของ apiSchedule_ (หน้าเว็บ /schedule/)
function testScheduleHelpers_() {
  // ช่วงวันที่ของเดือน — รวมเคสข้ามปี
  assertEqual_(scheduleMonthBounds_('2026-08').from, '2026-08-01');
  assertEqual_(scheduleMonthBounds_('2026-08').to, '2026-09-01');
  assertEqual_(scheduleMonthBounds_('2026-12').to, '2027-01-01');

  // ขอบเขตการดู: ย้อนหลังได้ 1 เดือน ล่วงหน้าได้ 6 เดือน
  assertTrue_(scheduleMonthAllowed_('2026-08', '2026-08'), 'เดือนปัจจุบันต้องดูได้');
  assertTrue_(scheduleMonthAllowed_('2026-08', '2026-07'), 'ย้อน 1 เดือนต้องดูได้');
  assertTrue_(scheduleMonthAllowed_('2026-08', '2027-02'), 'ล่วงหน้า 6 เดือนต้องดูได้');
  assertTrue_(scheduleMonthAllowed_('2026-12', '2027-01'), 'ข้ามปี +1 เดือนต้องดูได้');
  assertFalse_(scheduleMonthAllowed_('2026-08', '2026-06'), 'ย้อนเกิน 1 เดือนต้องห้าม');
  assertFalse_(scheduleMonthAllowed_('2026-08', '2027-03'), 'ล่วงหน้าเกิน 6 เดือนต้องห้าม');

  // โหมดสาธารณะ: ตัดผู้รับผิดชอบ/รายละเอียด/หมายเหตุออก — เหลือเฉพาะงาน เวลา สถานที่
  const item = createTestItem_(); // งานวันเดียว 2026-08-06
  const publicRow = toScheduleItem_(item, '2026-08-06', false);
  assertEqual_(publicRow.date, '2026-08-06');
  assertEqual_(publicRow.time, '08:30–16:00');
  assertEqual_(publicRow.title, 'ประชุมทีม');
  assertEqual_(publicRow.location, 'ห้องประชุม');
  assertFalse_('assignees' in publicRow, 'โหมดสาธารณะต้องไม่มีผู้รับผิดชอบ');
  assertFalse_('details' in publicRow);
  assertFalse_('notes' in publicRow);

  // โหมดเจ้าหน้าที่ (ล็อกอินแล้ว): ครบทุกฟิลด์
  const fullRow = toScheduleItem_(item, '2026-08-06', true);
  assertEqual_(fullRow.assignees, 'สมชาย');
  assertEqual_(fullRow.details, 'สรุปงาน');

  // ---------- งานแบบช่วงวันที่: ต้องนับทุกวันที่ครอบคลุม ไม่ใช่แค่วันเริ่ม ----------
  assertEqual_(shiftDateStr_('2026-08-31', 1), '2026-09-01');
  assertEqual_(shiftDateStr_('2026-01-01', -1), '2025-12-31');

  // overlap: เริ่มก่อนหน้าต่างแต่ยังไม่จบ = คร่อม / เริ่มหลังหน้าต่าง = ไม่นับ
  assertTrue_(itemOverlapsRange_({ start: '2026-07-28', end: '2026-08-03' }, '2026-08-01', '2026-09-01'), 'งานเริ่มก่อนเดือนแต่คร่อมเข้ามาต้องนับ');
  assertFalse_(itemOverlapsRange_({ start: '2026-07-28', end: '2026-07-31' }, '2026-08-01', '2026-09-01'), 'จบก่อนเดือนเริ่มต้องไม่นับ');
  assertFalse_(itemOverlapsRange_({ start: '2026-09-01', end: null }, '2026-08-01', '2026-09-01'), 'เริ่มวันแรกของเดือนถัดไปต้องไม่นับ (toStr exclusive)');
  assertTrue_(itemOverlapsRange_({ start: '2026-08-31T23:00:00+07:00', end: '2026-09-02' }, '2026-08-01', '2026-09-01'), 'datetime ที่มีเวลาต้องเทียบแบบตัดเอาแค่วันที่');
  assertFalse_(itemOverlapsRange_({ start: null }, '2026-08-01', '2026-09-01'), 'ไม่มีวันที่เลยต้องไม่นับ');

  // ขยายรายวัน: งานคร่อมข้ามเดือน 30 ส.ค.-2 ก.ย. → เดือน ส.ค. เห็น 2 วันท้าย / เดือน ก.ย. เห็น 2 วันแรก
  const spanItem = { title: 'อบรม', start: '2026-08-30', end: '2026-09-02', location: '', assignees: [], details: '', notes: '' };
  const augRows = expandScheduleRows_(spanItem, '2026-08-01', '2026-09-01', false);
  assertEqual_(augRows.map(r => r.date).join(','), '2026-08-30,2026-08-31');
  const sepRows = expandScheduleRows_(spanItem, '2026-09-01', '2026-10-01', false);
  assertEqual_(sepRows.map(r => r.date).join(','), '2026-09-01,2026-09-02');

  // งานวันเดียว → 1 แถวในวันนั้น / งานนอกหน้าต่าง → 0 แถว
  assertEqual_(expandScheduleRows_(item, '2026-08-01', '2026-09-01', false).length, 1);
  assertEqual_(expandScheduleRows_(spanItem, '2026-10-01', '2026-11-01', false).length, 0);

  // ป้ายช่วงวันที่: งานวันเดียว = ว่าง / ข้ามเดือน = เต็มรูปแบบ / เดือนเดียวกัน = ย่อ
  assertEqual_(publicRow.range, '');
  assertEqual_(toScheduleItem_(spanItem, '2026-08-30', false).range, '30 ส.ค. 2569 – 2 ก.ย. 2569');
  const sameMonthItem = Object.assign({}, spanItem, { end: '2026-08-31' });
  assertEqual_(toScheduleItem_(sameMonthItem, '2026-08-30', false).range, '30–31 ส.ค. 2569');

  // ข้อความเช้า text: งานหลายวันต่อท้ายช่วงวันที่แบบวงเล็บ
  const spanForDigest = Object.assign(createTestItem_(), { start: '2026-08-06', end: '2026-08-07', isDatetime: false });
  const digestText = buildLineMessage_(new Date('2026-08-06T08:30:00+07:00'), [spanForDigest], [], 'text');
  assertContains_(digestText.text, 'ประชุมทีม (6–7 ส.ค. 2569)');

  // การ์ด flex: งานหลายวันมีบรรทัด "ต่อเนื่อง ..." ใต้ชื่องาน
  const digestFlex = buildLineMessage_(new Date('2026-08-06T08:30:00+07:00'), [spanForDigest], [], 'flex');
  assertContains_(JSON.stringify(digestFlex.contents), 'ต่อเนื่อง 6–7 ส.ค. 2569');
}

// ---------- ใบลาของฉัน / ยกเลิก / แก้ไข / สรุปรายเดือน ----------

function testParseLeaveSubmissionInput_() {
  const settings = createTestSettings_(); // ไม่มี leave_type_options → ใช้ LEAVE_TYPES_DEFAULT ตาม fallback
  const today = bangkokTodayStr_();

  const input = parseLeaveSubmissionInput_({
    leaveType: 'ลากิจ',
    reason: '  ไปต่อด่านที่ว่าการอำเภอ  ',
    start: shiftDateStr_(today, 1),
    end: shiftDateStr_(today, 2),
    period: 'ครึ่งวันเช้า', // หลายวัน → ครึ่งวันใช้ไม่ได้ ต้องกลายเป็นเต็มวันเงียบๆ
  }, settings);
  assertEqual_(input.leaveType, 'ลากิจ');
  assertEqual_(input.reason, 'ไปต่อด่านที่ว่าการอำเภอ');
  assertEqual_(input.start, shiftDateStr_(today, 1));
  assertEqual_(input.end, shiftDateStr_(today, 2));
  assertEqual_(input.period, 'เต็มวัน');

  // ครึ่งวันใช้ได้เมื่อลา 1 วัน + ประเภทที่ระเบียบอนุญาต
  const halfDay = parseLeaveSubmissionInput_({
    leaveType: 'ลาป่วย', reason: '', start: today, end: today, period: 'ครึ่งวันบ่าย',
  }, settings);
  assertEqual_(halfDay.period, 'ครึ่งวันบ่าย');

  // reason ต้องถูกตัดที่ 500 ตัวอักษร (ตามข้อจำกัดของฟอร์มเดิม)
  const long = parseLeaveSubmissionInput_({
    leaveType: 'ลากิจ', reason: 'x'.repeat(600), start: today, end: today, period: '',
  }, settings);
  assertEqual_(long.reason.length, 500);

  assertThrows_(function () {
    parseLeaveSubmissionInput_({ leaveType: 'ไม่มีประเภทนี้', start: today, end: today }, settings);
  }, 'ประเภทการลาไม่ถูกต้อง');
  assertThrows_(function () {
    parseLeaveSubmissionInput_({
      leaveType: 'ลากิจ', start: shiftDateStr_(today, 5), end: shiftDateStr_(today, 3),
    }, settings);
  }, 'วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น');
}

function testBuildMyLeaveRow_() {
  const future = { start: '2026-08-25', end: '2026-08-26' };
  const past = { start: '2026-08-10', end: '2026-08-11' };
  const today = '2026-08-20';
  const base = { pageId: 'p1', leaveType: 'ลากิจ', reason: 'ธุระ', workDays: 2, period: 'เต็มวัน' };

  // เมทริกซ์สถานะ × ช่วงวันที่: แก้ได้เฉพาะใบรอ, ยกเลิกได้รอ+อนุมัติและต้องยังไม่ผ่านไป
  const cases = [
    [LEAVE_STATUS.pendingApprover, future, true, true],
    [LEAVE_STATUS.pendingChiefOffice, future, true, true],
    [LEAVE_STATUS.approved, future, false, true],
    [LEAVE_STATUS.pendingApprover, past, true, false],
    [LEAVE_STATUS.approved, past, false, false],
    [LEAVE_STATUS.rejected, future, false, false],
    [LEAVE_STATUS.cancelled, future, false, false],
  ];
  cases.forEach(function (c) {
    const row = buildMyLeaveRow_(Object.assign({}, base, c[1], {
      status: c[0], currentApprover: { stage: 'first', userIds: ['U_CHIEF'], names: ['นางสาวสมหญิง ใจงาม'] },
    }), today);
    assertEqual_(row.canEdit, c[2], c[0] + '/' + c[1].start);
    assertEqual_(row.canCancel, c[3], c[0] + '/' + c[1].start);
  });

  // ชื่อผู้อนุมัติที่ยังค้างแสดงเฉพาะใบที่รออนุมัติ
  assertEqual_(buildMyLeaveRow_(Object.assign({}, base, future, {
    status: LEAVE_STATUS.pendingApprover,
    currentApprover: { stage: 'first', userIds: ['U_CHIEF'], names: ['นางสาวสมหญิง ใจงาม'] },
  }), today).pendingApproverNames.join(','), 'นางสาวสมหญิง ใจงาม');
  assertEqual_(buildMyLeaveRow_(Object.assign({}, base, future, {
    status: LEAVE_STATUS.approved, currentApprover: null,
  }), today).pendingApproverNames.length, 0);

  // ใบไม่มีวันสิ้นสุด (end ว่าง) ต้องใช้วันเริ่มเป็นเกณฑ์ canCancel
  const noEnd = buildMyLeaveRow_(Object.assign({}, base, { start: '2026-08-25', end: '', status: LEAVE_STATUS.approved }), today);
  assertTrue_(noEnd.canCancel, 'ใบวันเดียวอนาคตต้องยกเลิกได้');
}

function testApprovedCancelNotifyTargets_() {
  const roster = createTestRoster_();
  const config = createTestApproversConfig_();
  const settings = createTestSettings_(); // second_approvers = สมพร, สมศรี

  // กลุ่มที่ตั้งส่งต่อ: ผู้อนุมัติของกลุ่ม + หัวหน้า สสอ. ทั้งสอง (ตัดตัวผู้ยื่น — ผู้ยื่นไม่อยู่ในรายการอยู่แล้ว)
  const forward = approvedCancelNotifyTargets_(config, settings, roster, roster[0]);
  assertEqual_(forward.map(s => s.lineUserId).sort().join(','), 'U_CHIEF,U_SECOND1,U_SECOND2');

  // กลุ่มไม่ส่งต่อ: มีแค่ผู้อนุมัติของกลุ่ม — และถ้าผู้ยื่นคือผู้อนุมัติเอง → เหลือ []
  const noForward = approvedCancelNotifyTargets_(config, settings, roster, roster[2]);
  assertEqual_(noForward.map(s => s.lineUserId).join(','), '');

  // กลุ่มไม่มีในคอนฟิก → [] (ไม่ throw — การยกเลิกต้องไม่ถูกบล็อก)
  assertEqual_(approvedCancelNotifyTargets_(config, settings, roster, { groupName: 'ไม่มีกลุ่มนี้' }).length, 0);
}

function testSubtractLeaveFromUsage_() {
  assertEqual_(subtractLeaveFromUsage_(null, createTestLeave_()), null);

  const usage = { 'ลากิจ': 3, 'ลาพักร้อน': 2 };
  const result = subtractLeaveFromUsage_(usage, { leaveType: 'ลากิจ', workDays: 2 });
  assertEqual_(result['ลากิจ'], 1);
  assertEqual_(result['ลาพักร้อน'], 2); // ประเภทอื่นไม่ถูกแตะ
  assertEqual_(usage['ลากิจ'], 3); // ต้นฉบับไม่ถูก mutate

  // หักจนติดลบ → หนีบที่ 0 (ใบเดิมอาจถูกแก้ประเภทใน Notion มาก่อน)
  assertEqual_(subtractLeaveFromUsage_({ 'ลากิจ': 1 }, { leaveType: 'ลากิจ', workDays: 2 })['ลากิจ'], 0);
}

function testPreviousMonthKey_() {
  assertEqual_(previousMonthKey_('2026-08'), '2026-07');
  assertEqual_(previousMonthKey_('2026-01'), '2025-12');
  assertEqual_(previousMonthKey_('2026-11'), '2026-10'); // เลขสองหลักคงรูปแบบ
}

function testAggregateLeavesByPersonMonth_() {
  const aggregates = aggregateLeavesByPersonMonth_([
    { fullName: 'นายสมศักดิ์ ใจดี', leaveType: 'ลากิจ', workDays: 1, start: '2026-07-01' },
    { fullName: 'นายสมศักดิ์ ใจดี', leaveType: 'ลาป่วย', workDays: 0.5, start: '2026-07-10' },
    { fullName: 'นางสาวสมหญิง ใจงาม', leaveType: 'ลาพักร้อน', workDays: 2, start: '2026-07-15' },
  ]);
  assertEqual_(aggregates.length, 2);
  const somsak = aggregates.find(a => a.name === 'นายสมศักดิ์ ใจดี');
  assertEqual_(somsak.byType['ลากิจ'], 1);
  assertEqual_(somsak.byType['ลาป่วย'], 0.5); // ครึ่งวันสะสมได้
  assertEqual_(somsak.total, 1.5);
  const somying = aggregates.find(a => a.name === 'นางสาวสมหญิง ใจงาม');
  assertEqual_(somying.total, 2);

  assertEqual_(aggregateLeavesByPersonMonth_([]).length, 0);
  // ใบไม่มีวันเริ่ม (ข้อมูลไม่สมบูรณ์) ต้องถูกข้าม ไม่ throw
  assertEqual_(aggregateLeavesByPersonMonth_([{ fullName: 'x', leaveType: 'ลากิจ', workDays: 1 }]).length, 0);
}

function testBuildMonthlyLeaveSummary_() {
  // เดือนว่าง → null (ผู้เรียกใช้เป็นเงื่อนไขว่าจะมีส่วนสรุปหรือไม่)
  assertEqual_(buildMonthlyLeaveSummary_('2026-07', []), null);

  const summary = buildMonthlyLeaveSummary_('2026-07', [
    { name: 'นายสมศักดิ์ ใจดี', byType: { 'ลากิจ': 1, 'ลาป่วย': 0.5 }, total: 1.5 },
    { name: 'นางสาวสมหญิง ใจงาม', byType: { 'ลาพักร้อน': 2 }, total: 2 },
  ]);
  assertEqual_(summary.title, '📊 สรุปวันลาประจำเดือนกรกฎาคม 2569'); // เดือนเต็ม + ปี พ.ศ.
  assertEqual_(summary.lines.length, 2);
  assertContains_(summary.lines[0], 'นายสมศักดิ์ ใจดี');
  assertContains_(summary.lines[0], 'ลากิจ 1 วัน');
  assertContains_(summary.lines[0], 'ลาป่วย ½ วัน');
  assertContains_(summary.lines[0], 'รวม 1½ วันทำการ');
  assertEqual_(summary.totalLine, 'รวมทั้งเดือน 3½ วันทำการ');
}

function testMonthlySummaryInMessages_() {
  const date = new Date('2026-08-20T08:00:00+07:00');
  const monthly = buildMonthlyLeaveSummary_('2026-07', [
    { name: 'นายสมศักดิ์ ใจดี', byType: { 'ลากิจ': 2 }, total: 2 },
  ]);

  // ข้อความ text: ส่วนสรุปเดือนต่อท้ายเป็นส่วนสุดท้ายของข้อความเดียวกัน
  const text = buildLineMessage_(date, [createTestItem_()], [], 'text', null, monthly);
  assertContains_(text.text, 'ประชุมทีม');
  assertContains_(text.text, 'สรุปวันลาประจำเดือนกรกฎาคม 2569');
  assertContains_(text.text, 'รวมทั้งเดือน 2 วันทำการ');

  // flex: มีกล่องสรุปเดือนใน body + altText บอกว่ามีสรุปใบลาเดือนที่แล้ว
  const flex = buildLineMessage_(date, [createTestItem_()], [], 'flex', null, monthly);
  assertContains_(flex.altText, 'สรุปใบลาเดือนที่แล้ว');
  assertContains_(JSON.stringify(flex.contents.body), 'สรุปวันลาประจำเดือนกรกฎาคม 2569');

  // ไม่ส่ง monthly เลย (param ที่ 6 ว่าง) → ไม่มีส่วนสรุป ผู้เรียกเดิมไม่กระทบ
  const withoutMonthly = buildLineMessage_(date, [createTestItem_()], [], 'text', null, null);
  assertFalse_(withoutMonthly.text.indexOf('สรุปวันลาประจำเดือน') !== -1);
}

function testScheduleLeaveRows_() {
  // ใบหลายวัน 20–21 ส.ค. (fixture เดิม) พร้อม firstName จาก roster แบบเส้นทางจริง
  const leave = Object.assign({}, createTestLeave_(), {
    firstName: leaveFirstName_(createTestLeave_(), createTestRoster_()),
  });
  const rows = expandScheduleLeaveRows_(leave, '2026-08-01', '2026-09-01');
  assertEqual_(rows.length, 2);
  assertEqual_(rows[0].date, '2026-08-20');
  assertEqual_(rows[0].name, 'สมศักดิ์'); // ชื่อจริง ไม่ใช่ชื่อเต็ม
  assertEqual_(rows[0].type, 'ลากิจ');
  assertContains_(rows[0].range, '20–21 ส.ค. 2569'); // ใบหลายวันบอกช่วงเต็มทุกวัน
  assertEqual_(rows[0].period, ''); // เต็มวัน → ไม่มีช่วงวัน

  // ใบครึ่งวันวันเดียว → 1 แถว มี period แต่ไม่มี range
  const halfDay = expandScheduleLeaveRows_({
    start: '2026-08-20', end: '', period: 'ครึ่งวันเช้า',
    leaveType: 'ลาป่วย', firstName: 'สมหญิง', fullName: 'นางสาวสมหญิง ใจงาม',
  }, '2026-08-01', '2026-09-01');
  assertEqual_(halfDay.length, 1);
  assertEqual_(halfDay[0].period, 'ครึ่งวันเช้า');
  assertEqual_(halfDay[0].range, '');

  // ใบเริ่มก่อนหน้าต่าง (คร่อมเดือน) → เริ่มนับแต่วันแรกของหน้าต่าง และหั่นที่ปลายหน้าต่าง
  const crossing = expandScheduleLeaveRows_({
    start: '2026-07-28', end: '2026-08-03', period: 'เต็มวัน',
    leaveType: 'ลาป่วย', firstName: 'สมชื่น',
  }, '2026-08-01', '2026-09-01');
  assertEqual_(crossing.map(r => r.date).join(','), '2026-08-01,2026-08-02,2026-08-03');
}

function assertTrue_(condition, message) {
  if (!condition) throw new Error(message || 'คาดว่าเป็น true');
}

function assertFalse_(condition, message) {
  if (condition) throw new Error(message || 'คาดว่าเป็น false');
}

function assertEqual_(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      (message ? message + ': ' : '') +
      'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual)
    );
  }
}

function assertContains_(actual, expected, message) {
  if (String(actual).indexOf(String(expected)) === -1) {
    throw new Error(
      (message ? message + ': ' : '') +
      'expected ' + JSON.stringify(actual) + ' to contain ' + JSON.stringify(expected)
    );
  }
}

function assertThrows_(fn, expectedMessage) {
  let thrown = null;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }
  if (!thrown) throw new Error('คาดว่าฟังก์ชันต้อง throw error');
  if (expectedMessage) assertContains_(thrown.message || thrown, expectedMessage);
}

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
    // ระบบลางาน (Leave.gs)
    testStaffDisplayName_,
    testResolveApprovalChain_,
    testCanApproveLeave_,
    testCountBusinessDays_,
    testLeaveRangeOverlap_,
    testLeaveDateLabel_,
    testSplitConfigNames_,
    testBuildLeavePagePayload_,
    testParseLeavePage_,
    testBuildLeaveApprovalBubble_,
    testTextMessageWithLeaves_,
    testFlexMessageWithLeaves_,
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

// ---------- ระบบลางาน (Leave.gs) ----------

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
  const leave = createTestLeave_();

  // มีทั้งงานและผู้ลา
  const both = buildLineMessage_(date, [createTestItem_()], [leave], 'text');
  assertContains_(both.text, 'ประชุมทีม');
  assertContains_(both.text, 'ผู้ลาวันนี้ (1 คน)');
  assertContains_(both.text, 'นายสมศักดิ์ ใจดี (กลุ่มงานคลังสินค้า) — ลากิจ 20–21 ส.ค. 2569');

  // ไม่มีงานเลยแต่มีผู้ลา → ยังส่งข้อความได้
  const leaveOnly = buildLineMessage_(date, [], [leave], 'text');
  assertContains_(leaveOnly.text, 'ผู้ลาวันนี้ (1 คน)');
  assertFalse_(leaveOnly.text.indexOf('ประชุมทีม') !== -1);
}

function testFlexMessageWithLeaves_() {
  const date = new Date('2026-08-20T08:00:00+07:00');
  const leave = createTestLeave_();

  const leaveOnly = buildLineMessage_(date, [], [leave], 'flex');
  assertEqual_(leaveOnly.type, 'flex');
  assertContains_(leaveOnly.altText, 'ผู้ลา 1 คน');

  const body = leaveOnly.contents.body.contents;
  // body = [เส้นคาด, กล่องผู้ลา] เมื่อไม่มีรายการงาน (ไม่มี separator คั่น)
  assertEqual_(body.length, 2);
  const leaveBox = body[1];
  assertEqual_(leaveBox.contents[0].text, '🏖️ ผู้ลาวันนี้ (1 คน)');
  assertContains_(JSON.stringify(leaveBox), 'นายสมศักดิ์ ใจดี');

  // มีงาน + ผู้ลา → มี separator เต็มความกว้างคั่นกลาง
  const both = buildLineMessage_(date, [createTestItem_()], [leave], 'flex');
  const bothBody = both.contents.body.contents;
  assertEqual_(bothBody.length, 4); // [เส้นคาด, กล่องงาน, separator, กล่องผู้ลา]
  assertEqual_(bothBody[2].type, 'separator');
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

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

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RESERVED,
  classifyTopLevel,
  isValidActivityName,
  isValidBuddhistYear,
} from '../src/archive-policy.js';

test('reserved folder names are canonical', () => {
  assert.equal(RESERVED.inbox, '00_INBOX_รอจัดหมวด');
  assert.equal(RESERVED.archive, '99_ARCHIVE_คลังภาพเก่า');
});

test('Buddhist year uses four digits', () => {
  assert.equal(isValidBuddhistYear('2569'), true);
  assert.equal(isValidBuddhistYear(2569), true);

  assert.equal(isValidBuddhistYear('69'), false);
  assert.equal(isValidBuddhistYear('2026-09'), false);
});

test('activity follows Buddhist-year YYYY-MM-DD_name convention', () => {
  assert.equal(
    isValidActivityName(
      '2569-09-03_ออกหน่วยรับบริจาคโลหิตอำเภอสอง'
    ),
    true
  );

  assert.equal(isValidActivityName('ออกหน่วยรับบริจาคโลหิต'), false);
  assert.equal(isValidActivityName('2569-09-03'), false);
});

test('activity name rejects path traversal and path separators', () => {
  assert.equal(isValidActivityName('2569-09-03_../secret'), false);
  assert.equal(isValidActivityName('2569-09-03_test/file'), false);
  assert.equal(isValidActivityName('2569-09-03_test\\file'), false);
});

test('top-level taxonomy classification does not hardcode topic labels', () => {
  assert.equal(
    classifyTopLevel('01_งานบริหารทั่วไป'),
    'topic'
  );

  assert.equal(
    classifyTopLevel('80_งานกิจกรรมกลาง'),
    'topic'
  );

  assert.equal(
    classifyTopLevel('90_ภาพองค์กร'),
    'organization'
  );

  assert.equal(
    classifyTopLevel('00_INBOX_รอจัดหมวด'),
    'inbox'
  );

  assert.equal(
    classifyTopLevel('99_ARCHIVE_คลังภาพเก่า'),
    'archive'
  );
});

test('renaming topic labels does not require source changes', () => {
  assert.equal(
    classifyTopLevel('80_ชื่อใหม่ในอนาคต'),
    'topic'
  );
});

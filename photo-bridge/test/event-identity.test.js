import test from 'node:test';
import assert from 'node:assert/strict';

import * as archivePolicy from '../src/archive-policy.js';

test(
  'event identity is derived from Gregorian date and activity name',
  () => {
    const buildEventIdentity =
      archivePolicy.buildEventIdentity;

    assert.equal(
      typeof buildEventIdentity,
      'function',
      'archive policy must expose buildEventIdentity(eventDate, activityName)'
    );

    const september2 =
      buildEventIdentity(
        '2026-09-02',
        'ประชุมประจำเดือน'
      );

    assert.deepEqual(
      september2,
      {
        eventDate: '2026-09-02',
        buddhistYear: '2569',
        activityName: 'ประชุมประจำเดือน',
        folderName:
          '2569-09-02_ประชุมประจำเดือน',
      }
    );

    const september3 =
      buildEventIdentity(
        '2026-09-03',
        'ประชุมประจำเดือน'
      );

    assert.deepEqual(
      september3,
      {
        eventDate: '2026-09-03',
        buddhistYear: '2569',
        activityName: 'ประชุมประจำเดือน',
        folderName:
          '2569-09-03_ประชุมประจำเดือน',
      }
    );

    assert.notEqual(
      september2.folderName,
      september3.folderName,
      'same activity name on different dates must resolve to different events'
    );

    assert.equal(
      archivePolicy.isValidActivityName(
        september2.folderName
      ),
      true,
      'derived folder must remain compatible with canonical activity storage'
    );

    assert.equal(
      archivePolicy.isValidActivityName(
        september3.folderName
      ),
      true,
      'derived folder must remain compatible with canonical activity storage'
    );

    const normalized =
      buildEventIdentity(
        '2026-09-03',
        '  ประชุมประจำเดือน  '
      );

    assert.equal(
      normalized.activityName,
      'ประชุมประจำเดือน'
    );

    assert.equal(
      normalized.folderName,
      '2569-09-03_ประชุมประจำเดือน'
    );

    const leapDay =
      buildEventIdentity(
        '2024-02-29',
        'ทดสอบวันอธิกสุรทิน'
      );

    assert.equal(
      leapDay.buddhistYear,
      '2567'
    );

    assert.equal(
      leapDay.folderName,
      '2567-02-29_ทดสอบวันอธิกสุรทิน'
    );

    assert.throws(
      () =>
        buildEventIdentity(
          '2026-02-29',
          'วันที่ไม่ถูกต้อง'
        ),
      /date|วันที่|invalid/i,
      'invalid Gregorian calendar dates must be rejected'
    );

    assert.throws(
      () =>
        buildEventIdentity(
          '03/09/2026',
          'รูปแบบวันที่ไม่ถูกต้อง'
        ),
      /date|วันที่|invalid/i,
      'eventDate must use strict YYYY-MM-DD'
    );

    assert.throws(
      () =>
        buildEventIdentity(
          '2569-09-03',
          'ปี พ.ศ. ถูกส่งมาเป็น Gregorian'
        ),
      /year|date|ปี|วันที่|range|ช่วง/i,
      'frontend must not send Buddhist year as eventDate'
    );

    assert.throws(
      () =>
        buildEventIdentity(
          '2026-09-03',
          ''
        ),
      /activity|กิจกรรม|name|ชื่อ/i,
      'activity name is required'
    );

    assert.throws(
      () =>
        buildEventIdentity(
          '2026-09-03',
          '../secret'
        ),
      /activity|กิจกรรม|name|ชื่อ|invalid|อักขระ/i,
      'activity name must reject path traversal'
    );

    assert.throws(
      () =>
        buildEventIdentity(
          '2026-09-03',
          'ประชุม/ลับ'
        ),
      /activity|กิจกรรม|name|ชื่อ|invalid|อักขระ/i,
      'activity name must reject path separators'
    );
  }
);

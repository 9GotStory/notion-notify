import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createPhotoTicket,
} from '../src/photo-ticket.js';

import {
  handleHttpRequest,
} from '../src/http-handler.js';


const SECRET =
  'event-http-contract-test-secret';

const TOPIC =
  '80_งานกิจกรรมกลาง';

const EVENT_DATE =
  '2026-09-03';

const ACTIVITY_NAME =
  'ประชุมประจำเดือน';

const YEAR =
  '2569';

const CANONICAL_ACTIVITY =
  '2569-09-03_ประชุมประจำเดือน';

const CONTENT =
  Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
  ]);


function ticket() {
  return createPhotoTicket(
    {
      sub: 'U123',
      staffKey: 'staff-event-http',
      role: 'user',
      iat: 1000,
      exp: 1300,
    },
    SECRET
  );
}


function context(
  uploadToDraftActivity
) {
  return {
    config: {
      ticketSecret:
        SECRET,

      ticketTtlSeconds:
        300,
    },

    authOptions: {
      nowSeconds:
        1100,
    },

    uploadService: {
      uploadToDraftActivity,
    },
  };
}


function request(url) {
  return {
    method:
      'POST',

    url,

    headers: {
      authorization:
        `Bearer ${ticket()}`,
    },

    body:
      CONTENT,
  };
}


function successfulUploadResult() {
  return {
    created:
      true,

    yearCreated:
      true,

    activity: {
      name:
        CANONICAL_ACTIVITY,

      path:
        `${TOPIC}/${YEAR}/${CANONICAL_ACTIVITY}`,
    },

    file: {
      name:
        'photo.jpg',

      path:
        `${TOPIC}/${YEAR}/${CANONICAL_ACTIVITY}/photo.jpg`,
    },
  };
}


test(
  'draft HTTP transport forwards semantic event input without caller-derived year or folder name',
  async () => {
    let captured = null;

    const query =
      new URLSearchParams({
        topic:
          TOPIC,

        eventDate:
          EVENT_DATE,

        activityName:
          ACTIVITY_NAME,

        filename:
          'photo.jpg',
      });

    const result =
      await handleHttpRequest(
        request(
          '/v1/draft-activity/uploads?' +
          query.toString()
        ),

        context(
          async input => {
            captured =
              input;

            return (
              successfulUploadResult()
            );
          }
        )
      );

    assert.equal(
      result.status,
      201
    );

    assert.ok(
      captured,
      'upload service must be called'
    );

    assert.equal(
      captured.topic,
      TOPIC
    );

    assert.equal(
      captured.eventDate,
      EVENT_DATE,
      'HTTP boundary must forward Gregorian eventDate'
    );

    assert.equal(
      captured.activityName,
      ACTIVITY_NAME,
      'HTTP boundary must forward the human activity name'
    );

    assert.equal(
      captured.filename,
      'photo.jpg'
    );

    assert.strictEqual(
      captured.content,
      CONTENT
    );

    assert.equal(
      Object.prototype
        .hasOwnProperty.call(
          captured,
          'year'
        ),
      false,
      'semantic request must not forward caller-derived Buddhist year'
    );
  }
);


test(
  'legacy draft HTTP transport remains accepted during semantic migration',
  async () => {
    let captured = null;

    const query =
      new URLSearchParams({
        topic:
          TOPIC,

        year:
          YEAR,

        activity:
          CANONICAL_ACTIVITY,

        filename:
          'legacy.jpg',
      });

    const result =
      await handleHttpRequest(
        request(
          '/v1/draft-activity/uploads?' +
          query.toString()
        ),

        context(
          async input => {
            captured =
              input;

            return (
              successfulUploadResult()
            );
          }
        )
      );

    assert.equal(
      result.status,
      201
    );

    assert.ok(
      captured
    );

    assert.equal(
      captured.topic,
      TOPIC
    );

    assert.equal(
      captured.year,
      YEAR
    );

    assert.equal(
      captured.activityName,
      CANONICAL_ACTIVITY
    );

    assert.equal(
      Object.prototype
        .hasOwnProperty.call(
          captured,
          'eventDate'
        ),
      false,
      'legacy request must remain on the compatibility path'
    );
  }
);



// ---------- PEM-P03-B mixed identity contract ----------

test(
  'draft HTTP transport rejects mixed semantic and legacy identity before service call',
  async () => {
    let called = false;

    const query =
      new URLSearchParams({
        topic:
          TOPIC,

        eventDate:
          EVENT_DATE,

        activityName:
          ACTIVITY_NAME,

        year:
          YEAR,

        activity:
          CANONICAL_ACTIVITY,

        filename:
          'mixed.jpg',
      });

    const result =
      await handleHttpRequest(
        request(
          '/v1/draft-activity/uploads?' +
          query.toString()
        ),

        context(
          async () => {
            called = true;

            return (
              successfulUploadResult()
            );
          }
        )
      );

    assert.equal(
      result.status,
      400,
      'mixed semantic + legacy identity must fail closed'
    );

    assert.equal(
      called,
      false,
      'ambiguous identity must be rejected before UploadService'
    );

    assert.equal(
      result.body &&
        result.body.ok,
      false
    );
  }
);


test(
  'draft HTTP transport rejects incomplete semantic identity instead of falling back to legacy',
  async () => {
    let called = false;

    const query =
      new URLSearchParams({
        topic:
          TOPIC,

        // Semantic caller started using activityName,
        // but omitted eventDate.
        activityName:
          ACTIVITY_NAME,

        filename:
          'partial-semantic.jpg',
      });

    const result =
      await handleHttpRequest(
        request(
          '/v1/draft-activity/uploads?' +
          query.toString()
        ),

        context(
          async () => {
            called = true;

            return (
              successfulUploadResult()
            );
          }
        )
      );

    assert.equal(
      result.status,
      400,
      'incomplete semantic identity must fail closed'
    );

    assert.equal(
      called,
      false,
      'incomplete semantic identity must not fall through to legacy UploadService input'
    );

    assert.equal(
      result.body &&
        result.body.ok,
      false
    );
  }
);



// ---------- PEM-P03-D boundary completeness ----------

test(
  'draft HTTP transport rejects incomplete legacy identity before service call',
  async () => {
    const cases = [
      {
        label:
          'year without activity',

        query: {
          topic:
            TOPIC,

          year:
            YEAR,

          filename:
            'legacy-year-only.jpg',
        },
      },

      {
        label:
          'activity without year',

        query: {
          topic:
            TOPIC,

          activity:
            CANONICAL_ACTIVITY,

          filename:
            'legacy-activity-only.jpg',
        },
      },
    ];

    for (
      const item
      of cases
    ) {
      let called = false;

      const query =
        new URLSearchParams(
          item.query
        );

      const result =
        await handleHttpRequest(
          request(
            '/v1/draft-activity/uploads?' +
            query.toString()
          ),

          context(
            async () => {
              called = true;

              return (
                successfulUploadResult()
              );
            }
          )
        );

      assert.equal(
        result.status,
        400,
        item.label +
          ' must fail closed'
      );

      assert.equal(
        called,
        false,
        item.label +
          ' must be rejected before UploadService'
      );

      assert.equal(
        result.body &&
          result.body.ok,
        false
      );
    }
  }
);


test(
  'draft HTTP transport rejects request with no activity identity before service call',
  async () => {
    let called = false;

    const query =
      new URLSearchParams({
        topic:
          TOPIC,

        filename:
          'missing-identity.jpg',
      });

    const result =
      await handleHttpRequest(
        request(
          '/v1/draft-activity/uploads?' +
          query.toString()
        ),

        context(
          async () => {
            called = true;

            return (
              successfulUploadResult()
            );
          }
        )
      );

    assert.equal(
      result.status,
      400,
      'missing draft identity must fail closed'
    );

    assert.equal(
      called,
      false,
      'missing identity must be rejected before UploadService'
    );

    assert.equal(
      result.body &&
        result.body.ok,
      false
    );
  }
);

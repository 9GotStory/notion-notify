import test from 'node:test';
import assert from 'node:assert/strict';

import {
  handleHttpRequest,
} from '../src/http-handler.js';

import {
  MetadataInputError,
} from '../src/metadata-service.js';

import {
  createPhotoTicket,
} from '../src/photo-ticket.js';

const SECRET =
  'metadata-http-contract-secret';

const NOW =
  1_800_000_000;

const TICKET =
  createPhotoTicket(
    {
      sub:
        'line-user-contract',

      staffKey:
        'staff-contract',

      role:
        'user',

      iat:
        NOW - 10,

      exp:
        NOW + 120,
    },
    SECRET
  );

function request(url) {
  return {
    method:
      'GET',

    url,

    headers: {
      authorization:
        `Bearer ${TICKET}`,
    },
  };
}

function context(metadataService) {
  return {
    config: {
      ticketSecret:
        SECRET,

      ticketTtlSeconds:
        300,
    },

    authOptions: {
      nowSeconds:
        NOW,
    },

    metadataService,
  };
}

test(
  'authenticated user can list visible metadata tags',
  async () => {
    let calls = 0;

    const tags = [
      {
        id:
          '7',

        name:
          'NCD',

        userVisible:
          true,

        userAssignable:
          true,
      },
    ];

    const result =
      await handleHttpRequest(
        request(
          '/v1/tags'
        ),
        context({
          async listTags() {
            calls += 1;
            return tags;
          },
        })
      );

    assert.equal(
      calls,
      1
    );

    assert.equal(
      result.status,
      200
    );

    assert.deepEqual(
      result.body,
      {
        ok:
          true,

        tags,
      }
    );
  }
);

test(
  'authenticated user can search photos with repeated tags preserving AND input',
  async () => {
    const calls = [];

    const photos = [
      {
        name:
          'activity.jpg',

        path:
          '80_งานกิจกรรมกลาง/2569/2569-09-27_กิจกรรมตัวอย่าง/activity.jpg',

        mime:
          'image/jpeg',

        fileId:
          '101',

        location:
          'activity',

        topic:
          '80_งานกิจกรรมกลาง',

        year:
          '2569',

        activityName:
          '2569-09-27_กิจกรรมตัวอย่าง',
      },
    ];

    const result =
      await handleHttpRequest(
        request(
          '/v1/photos?tag=7&tag=9'
        ),
        context({
          async searchPhotos(
            input
          ) {
            calls.push(
              input
            );

            return photos;
          },
        })
      );

    assert.deepEqual(
      calls,
      [
        {
          tagIds: [
            '7',
            '9',
          ],
        },
      ],
      'HTTP transport must preserve repeated tag query parameters for MetadataService AND semantics'
    );

    assert.equal(
      result.status,
      200
    );

    assert.deepEqual(
      result.body,
      {
        ok:
          true,

        photos,
      }
    );
  }
);

test(
  'metadata search validation errors map to HTTP 400',
  async () => {
    let calls = 0;

    const result =
      await handleHttpRequest(
        request(
          '/v1/photos'
        ),
        context({
          async searchPhotos() {
            calls += 1;

            throw new MetadataInputError(
              'At least one tag is required'
            );
          },
        })
      );

    assert.equal(
      calls,
      1,
      'HTTP layer must delegate tag validation to MetadataService'
    );

    assert.equal(
      result.status,
      400
    );

    assert.deepEqual(
      result.body,
      {
        ok:
          false,

        error:
          'At least one tag is required',
      }
    );
  }
);

test(
  'metadata backend failures remain sanitized at HTTP boundary',
  async () => {
    let calls = 0;

    const result =
      await handleHttpRequest(
        request(
          '/v1/tags'
        ),
        context({
          async listTags() {
            calls += 1;

            throw new Error(
              'private Nextcloud backend detail'
            );
          },
        })
      );

    assert.equal(
      calls,
      1
    );

    assert.equal(
      result.status,
      500
    );

    assert.deepEqual(
      result.body,
      {
        ok:
          false,

        error:
          'Internal server error',
      }
    );

    assert.equal(
      JSON.stringify(
        result.body
      ).includes(
        'private Nextcloud'
      ),
      false
    );
  }
);

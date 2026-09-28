import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WebDavClient,
  WebDavError,
} from '../src/webdav-client.js';

function response(
  status,
  body = ''
) {
  return {
    status,

    async text() {
      return body;
    },
  };
}

function client(fetchImpl) {
  return new WebDavClient({
    baseUrl:
      'https://nextcloud.example',

    user:
      'photo-service',

    password:
      'test-secret',

    root:
      'คลังภาพ',

    fetchImpl,
  });
}

test(
  'assignSystemTag creates the native file-to-tag relation with one PUT',
  async () => {
    const requests = [];

    const dav =
      client(
        async (
          url,
          options
        ) => {
          requests.push({
            url,
            options,
          });

          return response(
            201
          );
        }
      );

    assert.equal(
      typeof dav.assignSystemTag,
      'function',
      'WebDavClient must expose assignSystemTag'
    );

    await dav.assignSystemTag(
      '42',
      '7'
    );

    assert.equal(
      requests.length,
      1
    );

    assert.equal(
      requests[0].options.method,
      'PUT'
    );

    assert.equal(
      requests[0].url,
      'https://nextcloud.example/remote.php/dav/systemtags-relations/files/42/7'
    );

    assert.equal(
      requests[0].options.body,
      undefined,
      'native relation PUT requires no request payload'
    );
  }
);

test(
  'removeSystemTag deletes the native file-to-tag relation with one DELETE',
  async () => {
    const requests = [];

    const dav =
      client(
        async (
          url,
          options
        ) => {
          requests.push({
            url,
            options,
          });

          return response(
            204
          );
        }
      );

    assert.equal(
      typeof dav.removeSystemTag,
      'function',
      'WebDavClient must expose removeSystemTag'
    );

    await dav.removeSystemTag(
      '42',
      '7'
    );

    assert.equal(
      requests.length,
      1
    );

    assert.equal(
      requests[0].options.method,
      'DELETE'
    );

    assert.equal(
      requests[0].url,
      'https://nextcloud.example/remote.php/dav/systemtags-relations/files/42/7'
    );

    assert.equal(
      requests[0].options.body,
      undefined
    );
  }
);

test(
  'System Tag relation writes reject unsafe IDs before network access',
  async () => {
    let networkCalls = 0;

    const dav =
      client(
        async () => {
          networkCalls += 1;

          return response(
            500
          );
        }
      );

    assert.equal(
      typeof dav.assignSystemTag,
      'function',
      'WebDavClient must expose assignSystemTag'
    );

    assert.equal(
      typeof dav.removeSystemTag,
      'function',
      'WebDavClient must expose removeSystemTag'
    );

    const invalidPairs = [
      [
        '',
        '7',
      ],

      [
        '../42',
        '7',
      ],

      [
        'abc',
        '7',
      ],

      [
        '42',
        '',
      ],

      [
        '42',
        '../7',
      ],

      [
        '42',
        'tag-seven',
      ],
    ];

    for (
      const [
        fileId,
        tagId,
      ]
      of invalidPairs
    ) {
      await assert.rejects(
        () =>
          dav.assignSystemTag(
            fileId,
            tagId
          ),
        (error) => {
          assert.equal(
            error instanceof
              WebDavError,
            true
          );

          return true;
        }
      );

      await assert.rejects(
        () =>
          dav.removeSystemTag(
            fileId,
            tagId
          ),
        (error) => {
          assert.equal(
            error instanceof
              WebDavError,
            true
          );

          return true;
        }
      );
    }

    assert.equal(
      networkCalls,
      0,
      'invalid relation identifiers must fail before any DAV request'
    );
  }
);

test(
  'System Tag relation write failures remain sanitized WebDavErrors with status codes',
  async () => {
    const requests = [];

    const dav =
      client(
        async (
          url,
          options
        ) => {
          requests.push({
            url,
            options,
          });

          if (
            options.method ===
              'PUT'
          ) {
            return response(
              403,
              'private permission detail'
            );
          }

          return response(
            404,
            'private relation detail'
          );
        }
      );

    assert.equal(
      typeof dav.assignSystemTag,
      'function'
    );

    assert.equal(
      typeof dav.removeSystemTag,
      'function'
    );

    await assert.rejects(
      () =>
        dav.assignSystemTag(
          '42',
          '7'
        ),
      (error) => {
        assert.equal(
          error instanceof
            WebDavError,
          true
        );

        assert.equal(
          error.statusCode,
          403
        );

        assert.equal(
          error.message.includes(
            'private permission detail'
          ),
          false
        );

        return true;
      }
    );

    await assert.rejects(
      () =>
        dav.removeSystemTag(
          '42',
          '7'
        ),
      (error) => {
        assert.equal(
          error instanceof
            WebDavError,
          true
        );

        assert.equal(
          error.statusCode,
          404
        );

        assert.equal(
          error.message.includes(
            'private relation detail'
          ),
          false
        );

        return true;
      }
    );

    assert.equal(
      requests.length,
      2
    );
  }
);

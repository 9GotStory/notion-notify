import test from 'node:test';
import assert from 'node:assert/strict';

import {
  handleHttpRequest,
} from '../src/http-handler.js';

import {
  MetadataInputError,
  MetadataPermissionError,
} from '../src/metadata-service.js';

import {
  createPhotoTicket,
} from '../src/photo-ticket.js';

import {
  requestBodyKind,
} from '../src/request-policy.js';

const SECRET =
  'metadata-write-http-secret';

const NOW =
  1_800_000_000;

function ticket(
  role
) {
  return createPhotoTicket(
    {
      sub:
        `${role}-line-user`,

      staffKey:
        `${role}-staff`,

      role,

      iat:
        NOW - 10,

      exp:
        NOW + 120,
    },
    SECRET
  );
}

function request(
  method,
  role,
  body
) {
  return {
    method,

    url:
      '/v1/photos/tags',

    headers: {
      authorization:
        `Bearer ${ticket(role)}`,
    },

    body,
  };
}

function context(
  metadataService
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
        NOW,
    },

    metadataService,
  };
}

function writeBody(
  overrides = {}
) {
  return {
    path:
      '80_งานกิจกรรมกลาง/2569/2569-09-27_กิจกรรมตัวอย่าง/photo.jpg',

    fileId:
      '42',

    tagId:
      '7',

    // This must never become authoritative.
    actor: {
      role:
        'admin',

      sub:
        'forged-client-actor',
    },

    ...overrides,
  };
}

test(
  'manager can assign a photo tag through PUT using authenticated actor authority',
  async () => {
    const calls = [];

    const result =
      await handleHttpRequest(
        request(
          'PUT',
          'manager',
          writeBody()
        ),
        context({
          async assignPhotoTag(
            input
          ) {
            calls.push(
              input
            );

            return {
              changed:
                true,

              fileId:
                '42',

              tagId:
                '7',
            };
          },
        })
      );

    assert.equal(
      result.status,
      200
    );

    assert.equal(
      calls.length,
      1
    );

    assert.equal(
      calls[0].actor.role,
      'manager',
      'authenticated ticket actor must override any forged body actor'
    );

    assert.equal(
      calls[0].actor.sub,
      'manager-line-user'
    );

    assert.equal(
      calls[0].path,
      writeBody().path
    );

    assert.equal(
      calls[0].fileId,
      '42'
    );

    assert.equal(
      calls[0].tagId,
      '7'
    );

    assert.deepEqual(
      result.body,
      {
        ok:
          true,

        changed:
          true,

        fileId:
          '42',

        tagId:
          '7',
      }
    );
  }
);

test(
  'admin can remove a photo tag through DELETE',
  async () => {
    const calls = [];

    const result =
      await handleHttpRequest(
        request(
          'DELETE',
          'admin',
          writeBody()
        ),
        context({
          async removePhotoTag(
            input
          ) {
            calls.push(
              input
            );

            return {
              changed:
                false,

              fileId:
                '42',

              tagId:
                '7',
            };
          },
        })
      );

    assert.equal(
      result.status,
      200
    );

    assert.equal(
      calls.length,
      1
    );

    assert.equal(
      calls[0].actor.role,
      'admin'
    );

    assert.deepEqual(
      result.body,
      {
        ok:
          true,

        changed:
          false,

        fileId:
          '42',

        tagId:
          '7',
      }
    );
  }
);

test(
  'normal user cannot mutate photo tags and service is not called',
  async () => {
    let calls = 0;

    const metadataService = {
      async assignPhotoTag() {
        calls += 1;
      },

      async removePhotoTag() {
        calls += 1;
      },
    };

    for (
      const method
      of [
        'PUT',
        'DELETE',
      ]
    ) {
      const result =
        await handleHttpRequest(
          request(
            method,
            'user',
            writeBody()
          ),
          context(
            metadataService
          )
        );

      assert.equal(
        result.status,
        403
      );
    }

    assert.equal(
      calls,
      0,
      'HTTP authorization boundary must reject normal users before service calls'
    );
  }
);

test(
  'metadata write endpoints require JSON object bodies',
  async () => {
    let calls = 0;

    const metadataService = {
      async assignPhotoTag() {
        calls += 1;
      },

      async removePhotoTag() {
        calls += 1;
      },
    };

    for (
      const [
        method,
        body,
      ]
      of [
        [
          'PUT',
          undefined,
        ],

        [
          'PUT',
          null,
        ],

        [
          'PUT',
          [],
        ],

        [
          'DELETE',
          undefined,
        ],

        [
          'DELETE',
          'not-json-object',
        ],
      ]
    ) {
      const result =
        await handleHttpRequest(
          request(
            method,
            'manager',
            body
          ),
          context(
            metadataService
          )
        );

      assert.equal(
        result.status,
        400
      );
    }

    assert.equal(
      calls,
      0,
      'invalid HTTP bodies must fail before MetadataService'
    );
  }
);

test(
  'request policy reads PUT and DELETE photo-tag bodies as JSON',
  () => {
    assert.equal(
      requestBodyKind(
        'PUT',
        '/v1/photos/tags'
      ),
      'json'
    );

    assert.equal(
      requestBodyKind(
        'DELETE',
        '/v1/photos/tags'
      ),
      'json'
    );

    assert.equal(
      requestBodyKind(
        'GET',
        '/v1/photos/tags'
      ),
      null
    );
  }
);

test(
  'metadata write domain errors map to 400 and 403',
  async () => {
    const badInput =
      await handleHttpRequest(
        request(
          'PUT',
          'manager',
          writeBody()
        ),
        context({
          async assignPhotoTag() {
            throw new MetadataInputError(
              'Invalid photo target'
            );
          },
        })
      );

    assert.equal(
      badInput.status,
      400
    );

    assert.deepEqual(
      badInput.body,
      {
        ok:
          false,

        error:
          'Invalid photo target',
      }
    );

    const forbidden =
      await handleHttpRequest(
        request(
          'DELETE',
          'admin',
          writeBody()
        ),
        context({
          async removePhotoTag() {
            throw new MetadataPermissionError(
              'Tag cannot be assigned by the current Nextcloud account'
            );
          },
        })
      );

    assert.equal(
      forbidden.status,
      403
    );

    assert.deepEqual(
      forbidden.body,
      {
        ok:
          false,

        error:
          'Tag cannot be assigned by the current Nextcloud account',
      }
    );
  }
);

test(
  'metadata write backend failures remain sanitized',
  async () => {
    const result =
      await handleHttpRequest(
        request(
          'PUT',
          'manager',
          writeBody()
        ),
        context({
          async assignPhotoTag() {
            throw new Error(
              'private Nextcloud relation failure'
            );
          },
        })
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

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluatePreflight,
} from '../src/cors.js';

const ALLOWED =
  'https://9gotstory.github.io';

test(
  'metadata tag writes allow PUT and DELETE browser preflight while PATCH remains closed',
  () => {
    for (
      const method
      of [
        'PUT',
        'DELETE',
      ]
    ) {
      const result =
        evaluatePreflight({
          origin:
            ALLOWED,

          requestMethod:
            method,

          requestHeaders:
            'content-type, authorization',

          allowedOrigin:
            ALLOWED,
        });

      assert.equal(
        result.allowed,
        true,
        `${method} metadata write preflight must be allowed`
      );

      assert.equal(
        result.headers[
          'access-control-allow-origin'
        ],
        ALLOWED
      );

      assert.equal(
        result.headers[
          'access-control-allow-methods'
        ],
        'GET, POST, PUT, DELETE, OPTIONS',
        'preflight response must advertise every supported browser method'
      );

      assert.equal(
        result.headers[
          'access-control-allow-headers'
        ],
        'Authorization, Content-Type'
      );
    }

    const patch =
      evaluatePreflight({
        origin:
          ALLOWED,

        requestMethod:
          'PATCH',

        requestHeaders:
          'content-type, authorization',

        allowedOrigin:
          ALLOWED,
      });

    assert.equal(
      patch.allowed,
      false,
      'unsupported PATCH must remain fail-closed'
    );
  }
);

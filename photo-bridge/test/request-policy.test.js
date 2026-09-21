import test from 'node:test';
import assert from 'node:assert/strict';

import {
  requestBodyKind,
} from '../src/request-policy.js';

test('activity creation uses JSON request body', () => {
  assert.equal(
    requestBodyKind(
      'POST',
      '/v1/activities'
    ),
    'json'
  );
});

test('both upload endpoints use binary request bodies', () => {
  assert.equal(
    requestBodyKind(
      'POST',
      '/v1/uploads'
    ),
    'binary'
  );

  assert.equal(
    requestBodyKind(
      'POST',
      '/v1/inbox/uploads'
    ),
    'binary'
  );
});

test('non-write requests do not consume request bodies', () => {
  assert.equal(
    requestBodyKind(
      'GET',
      '/v1/inbox/uploads'
    ),
    null
  );

  assert.equal(
    requestBodyKind(
      'POST',
      '/unknown'
    ),
    null
  );
});

test('manager move uses JSON request body', () => {
  assert.equal(
    requestBodyKind(
      'POST',
      '/v1/move'
    ),
    'json'
  );
});

test('manager activity rename uses JSON request body', () => {
  assert.equal(
    requestBodyKind(
      'POST',
      '/v1/rename'
    ),
    'json'
  );
});

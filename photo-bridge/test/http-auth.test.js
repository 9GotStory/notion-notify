import test from 'node:test';
import assert from 'node:assert/strict';

import { createPhotoTicket } from '../src/photo-ticket.js';
import { handleHttpRequest } from '../src/http-handler.js';

const SECRET = 'http-test-secret';

const config = {
  ticketSecret: SECRET,
  ticketTtlSeconds: 300,
};

function ticket(role = 'user', overrides = {}) {
  return createPhotoTicket(
    {
      sub: 'U123',
      staffKey: 'staff-001',
      role,
      iat: 1000,
      exp: 1300,
      ...overrides,
    },
    SECRET
  );
}

function request(path, bearer) {
  const headers = {};

  if (bearer) {
    headers.authorization = `Bearer ${bearer}`;
  }

  return {
    method: 'GET',
    url: path,
    headers,
  };
}

const context = {
  config,
  authOptions: {
    nowSeconds: 1100,
  },
};

test('health endpoint is public', () => {
  const result = handleHttpRequest(
    request('/health'),
    context
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
});

test('authenticated session returns safe actor fields', () => {
  const result = handleHttpRequest(
    request('/v1/session', ticket()),
    context
  );

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.actor, {
    sub: 'U123',
    staffKey: 'staff-001',
    role: 'user',
    exp: 1300,
  });
});

test('missing bearer ticket returns 401', () => {
  const result = handleHttpRequest(
    request('/v1/session'),
    context
  );

  assert.equal(result.status, 401);
});

test('normal user cannot access manager boundary', () => {
  const result = handleHttpRequest(
    request('/v1/manager/session', ticket('user')),
    context
  );

  assert.equal(result.status, 403);
});

test('manager can access manager boundary', () => {
  const result = handleHttpRequest(
    request('/v1/manager/session', ticket('manager')),
    context
  );

  assert.equal(result.status, 200);
});

test('admin can access manager boundary', () => {
  const result = handleHttpRequest(
    request('/v1/manager/session', ticket('admin')),
    context
  );

  assert.equal(result.status, 200);
});

test('ticket exceeding configured lifetime is rejected', () => {
  const longTicket = ticket('user', {
    iat: 1000,
    exp: 1600,
  });

  const result = handleHttpRequest(
    request('/v1/session', longTicket),
    context
  );

  assert.equal(result.status, 401);
});

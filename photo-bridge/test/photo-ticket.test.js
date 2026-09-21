import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createPhotoTicket,
  verifyPhotoTicket,
} from '../src/photo-ticket.js';

const SECRET = 'test-secret-not-for-production';

function claims(overrides = {}) {
  return {
    sub: 'U1234567890',
    staffKey: 'staff-001',
    role: 'user',
    iat: 1000,
    exp: 1300,
    ...overrides,
  };
}

test('valid ticket verifies and returns claims', () => {
  const ticket = createPhotoTicket(claims(), SECRET);
  const result = verifyPhotoTicket(ticket, SECRET, {
    nowSeconds: 1100,
  });

  assert.equal(result.sub, 'U1234567890');
  assert.equal(result.staffKey, 'staff-001');
  assert.equal(result.role, 'user');
});

test('tampered ticket is rejected', () => {
  const ticket = createPhotoTicket(claims(), SECRET);
  const [payload] = ticket.split('.');

  assert.throws(
    () => verifyPhotoTicket(`${payload}.invalid`, SECRET, {
      nowSeconds: 1100,
    }),
    /signature/
  );
});

test('expired ticket is rejected', () => {
  const ticket = createPhotoTicket(claims(), SECRET);

  assert.throws(
    () => verifyPhotoTicket(ticket, SECRET, {
      nowSeconds: 1300,
    }),
    /expired/
  );
});

test('unknown role is rejected', () => {
  const ticket = createPhotoTicket(
    claims({ role: 'superuser' }),
    SECRET
  );

  assert.throws(
    () => verifyPhotoTicket(ticket, SECRET, {
      nowSeconds: 1100,
    }),
    /role/
  );
});

test('ticket issued too far in the future is rejected', () => {
  const ticket = createPhotoTicket(
    claims({ iat: 1200, exp: 1500 }),
    SECRET
  );

  assert.throws(
    () => verifyPhotoTicket(ticket, SECRET, {
      nowSeconds: 1100,
    }),
    /future/
  );
});

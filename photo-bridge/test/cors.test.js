import assert from 'node:assert/strict';
import test from 'node:test';

import {
  corsHeaders,
  evaluatePreflight,
} from '../src/cors.js';

const ALLOWED = 'https://9gotstory.github.io';

test('allowed browser origin receives exact CORS origin', () => {
  assert.deepEqual(
    corsHeaders(ALLOWED, ALLOWED),
    {
      'access-control-allow-origin': ALLOWED,
      vary: 'Origin',
    }
  );
});

test('unknown browser origin receives no allow-origin header', () => {
  assert.deepEqual(
    corsHeaders('https://example.invalid', ALLOWED),
    {
      vary: 'Origin',
    }
  );
});

test('request without Origin receives no CORS allow-origin header', () => {
  assert.deepEqual(
    corsHeaders('', ALLOWED),
    {
      vary: 'Origin',
    }
  );
});

test('valid Photo Bridge preflight is accepted without authentication', () => {
  const result = evaluatePreflight({
    origin: ALLOWED,
    requestMethod: 'GET',
    requestHeaders: 'authorization',
    allowedOrigin: ALLOWED,
  });

  assert.equal(result.allowed, true);
  assert.deepEqual(result.headers, {
    'access-control-allow-origin': ALLOWED,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'Authorization, Content-Type',
    vary: 'Origin',
  });
});

test('JSON Photo Bridge preflight accepts content-type and authorization', () => {
  const result = evaluatePreflight({
    origin: ALLOWED,
    requestMethod: 'POST',
    requestHeaders: 'content-type, authorization',
    allowedOrigin: ALLOWED,
  });

  assert.equal(result.allowed, true);
});

test('unknown origin preflight fails closed', () => {
  const result = evaluatePreflight({
    origin: 'https://example.invalid',
    requestMethod: 'GET',
    requestHeaders: 'authorization',
    allowedOrigin: ALLOWED,
  });

  assert.equal(result.allowed, false);
});

test('unsupported preflight method fails closed', () => {
  const result = evaluatePreflight({
    origin: ALLOWED,
    requestMethod: 'DELETE',
    requestHeaders: 'authorization',
    allowedOrigin: ALLOWED,
  });

  assert.equal(result.allowed, false);
});

test('unsupported preflight header fails closed', () => {
  const result = evaluatePreflight({
    origin: ALLOWED,
    requestMethod: 'POST',
    requestHeaders: 'authorization, x-admin-token',
    allowedOrigin: ALLOWED,
  });

  assert.equal(result.allowed, false);
});

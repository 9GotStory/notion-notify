'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const test = require('node:test');
const {
  lineSignature, verifyLineSignature, signEnvelope, safeEqual, isSuccessfulLineResponse,
  requireSuccessfulBackendResult,
  validateBackendUrl, configurationErrors,
} = require('./server');

test('verifies the exact raw LINE webhook body', () => {
  const raw = Buffer.from('{"events":[{"webhookEventId":"evt-1"}]}');
  const signature = lineSignature(raw, 'channel-secret');
  assert.equal(verifyLineSignature(raw, signature, 'channel-secret'), true);
  assert.equal(verifyLineSignature(Buffer.from(raw + ' '), signature, 'channel-secret'), false);
});

test('creates a verifiable signed backend envelope', () => {
  const envelope = signEnvelope({ apiAction: 'session' }, 'shared-secret', 1234,
    '123e4567-e89b-42d3-a456-426614174000');
  const canonical = envelope.timestamp + '\n' + envelope.nonce + '\n' + JSON.stringify(envelope.payload);
  const expected = crypto.createHmac('sha256', 'shared-secret').update(canonical).digest('base64');
  assert.equal(safeEqual(envelope.signature, expected), true);
});

test('only acknowledges a LINE webhook after backend processing succeeds', () => {
  assert.equal(isSuccessfulLineResponse({ status: 'ok' }), true);
  assert.equal(isSuccessfulLineResponse({ status: 'error' }), false);
  assert.equal(isSuccessfulLineResponse({ ok: false }), false);
  assert.equal(isSuccessfulLineResponse(null), false);
});

test('requires internal backend operations to return ok true', () => {
  assert.deepEqual(requireSuccessfulBackendResult({ ok: true, value: 1 }, 'test'), { ok: true, value: 1 });
  assert.throws(() => requireSuccessfulBackendResult({ ok: false }, 'test'), /test failed/);
});

test('accepts only expected Apps Script backend URLs', () => {
  const valid = 'https://script.google.com/macros/s/deployment-id/exec';
  assert.equal(validateBackendUrl(valid, 'test'), valid);
  assert.throws(() => validateBackendUrl('http://script.google.com/macros/s/id/exec', 'test'));
  assert.throws(() => validateBackendUrl('https://example.com/macros/s/id/exec', 'test'));
});

test('fails closed when required gateway configuration is missing', () => {
  assert.deepEqual(configurationErrors({}), [
    'LINE_CHANNEL_SECRET', 'GATEWAY_SHARED_SECRET', 'MAIN_APPS_SCRIPT_URL',
    'ADMIN_APPS_SCRIPT_URL', 'ALLOWED_ORIGINS',
  ]);
  assert.deepEqual(configurationErrors({
    LINE_CHANNEL_SECRET: 'line-secret',
    GATEWAY_SHARED_SECRET: 'x'.repeat(32),
    MAIN_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/main-id/exec',
    ADMIN_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/admin-id/exec',
    ALLOWED_ORIGINS: 'https://example.github.io',
  }), []);
  assert.deepEqual(configurationErrors({
    LINE_CHANNEL_SECRET: 'line-secret',
    GATEWAY_SHARED_SECRET: 'x'.repeat(32),
    MAIN_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/main-id/exec',
    ADMIN_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/admin-id/exec',
    ALLOWED_ORIGINS: 'https://example.github.io',
    PORT: 'not-a-port',
  }), ['PORT']);
});

const validEnvironment = {
  LINE_CHANNEL_SECRET: 'line-secret',
  GATEWAY_SHARED_SECRET: 'x'.repeat(32),
  MAIN_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/main-id/exec',
  ADMIN_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/admin-id/exec',
  ALLOWED_ORIGINS: 'https://example.github.io',
};

async function withGatewayServer(run) {
  const previous = {};
  Object.keys(validEnvironment).forEach(key => {
    previous[key] = process.env[key];
    process.env[key] = validEnvironment[key];
  });
  const server = http.createServer(require('./server').handle);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    await run('http://127.0.0.1:' + address.port);
  } finally {
    await new Promise(resolve => server.close(resolve));
    Object.keys(validEnvironment).forEach(key => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
  }
}

test('health and CORS routes fail closed before forwarding', { concurrency: false }, async () => {
  await withGatewayServer(async baseUrl => {
    const health = await fetch(baseUrl + '/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, service: 'notion-notify-gateway' });

    const denied = await fetch(baseUrl + '/api/admin', {
      method: 'POST',
      headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).code, 'ORIGIN_DENIED');

    const preflight = await fetch(baseUrl + '/api/liff', {
      method: 'OPTIONS',
      headers: { origin: validEnvironment.ALLOWED_ORIGINS },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), validEnvironment.ALLOWED_ORIGINS);
    assert.equal(preflight.headers.get('access-control-allow-methods'), 'POST, OPTIONS');

    const legacyScheduleGet = await fetch(baseUrl + '/api/schedule?month=2026-08');
    assert.equal(legacyScheduleGet.status, 404);

    const deniedSchedule = await fetch(baseUrl + '/api/schedule', {
      method: 'POST',
      headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
      body: '{"month":"2026-08"}',
    });
    assert.equal(deniedSchedule.status, 403);
    assert.equal((await deniedSchedule.json()).code, 'ORIGIN_DENIED');

    const invalidSignature = await fetch(baseUrl + '/line/webhook', {
      method: 'POST',
      headers: { 'x-line-signature': 'invalid' },
      body: '{"events":[]}',
    });
    assert.equal(invalidSignature.status, 401);
    assert.equal((await invalidSignature.json()).code, 'INVALID_LINE_SIGNATURE');
  });
});

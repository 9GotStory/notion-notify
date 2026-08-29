'use strict';

const crypto = require('crypto');
const http = require('http');

const MAX_BODY_BYTES = 1024 * 1024;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function lineSignature(rawBody, channelSecret) {
  return crypto.createHmac('sha256', channelSecret).update(rawBody).digest('base64');
}

function verifyLineSignature(rawBody, signature, channelSecret) {
  return !!channelSecret && safeEqual(lineSignature(rawBody, channelSecret), signature);
}

function signEnvelope(payload, sharedSecret, now, nonce) {
  const timestamp = String(now == null ? Date.now() : now);
  const envelopeNonce = nonce || crypto.randomUUID();
  const serializedPayload = JSON.stringify(payload);
  const canonical = timestamp + '\n' + envelopeNonce + '\n' + serializedPayload;
  return {
    gatewayEnvelope: true,
    timestamp,
    nonce: envelopeNonce,
    payload,
    signature: crypto.createHmac('sha256', sharedSecret).update(canonical).digest('base64'),
  };
}

function jsonResponse(res, status, body, origin) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
  };
  if (origin) {
    headers['access-control-allow-origin'] = origin;
    headers.vary = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function allowedOrigin(requestOrigin) {
  const configured = String(process.env.ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);
  return configured.includes(requestOrigin) ? requestOrigin : '';
}

function validateBackendUrl(value, name) {
  let parsed;
  try { parsed = new URL(String(value || '')); } catch (err) { throw new Error(name + ' is not a valid URL'); }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'script.google.com' ||
      !/^\/macros\/s\/[^/]+\/exec$/.test(parsed.pathname) || parsed.search || parsed.hash) {
    throw new Error(name + ' must be an HTTPS Apps Script /exec URL');
  }
  return parsed.toString();
}

function configurationErrors(env) {
  const source = env || process.env;
  const errors = [];
  if (!String(source.LINE_CHANNEL_SECRET || '')) errors.push('LINE_CHANNEL_SECRET');
  if (String(source.GATEWAY_SHARED_SECRET || '').length < 32) errors.push('GATEWAY_SHARED_SECRET');
  for (const name of ['MAIN_APPS_SCRIPT_URL', 'ADMIN_APPS_SCRIPT_URL']) {
    try { validateBackendUrl(source[name], name); } catch (err) { errors.push(name); }
  }
  const origins = String(source.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  if (!origins.length || origins.some(value => {
    try {
      const parsed = new URL(value);
      return parsed.protocol !== 'https:' || parsed.origin !== value;
    } catch (err) { return true; }
  })) errors.push('ALLOWED_ORIGINS');
  if (source.PORT !== undefined && source.PORT !== '') {
    const port = Number(source.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('PORT');
  }
  return errors;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', chunk => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        reject(Object.assign(new Error('request too large'), { statusCode: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!tooLarge) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

async function forward(url, payload) {
  const backendUrl = validateBackendUrl(url, 'backend URL');
  const sharedSecret = String(process.env.GATEWAY_SHARED_SECRET || '');
  if (sharedSecret.length < 32) throw new Error('GATEWAY_SHARED_SECRET is not configured securely');
  const envelope = signEnvelope(payload, sharedSecret);
  const response = await fetch(backendUrl, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    body: JSON.stringify(envelope),
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error('backend returned HTTP ' + response.status);
  try { return JSON.parse(text); } catch (err) { throw new Error('backend returned invalid JSON'); }
}

function isSuccessfulLineResponse(result) {
  return !!result && result.status === 'ok';
}

function requireSuccessfulBackendResult(result, operation) {
  if (!result || result.ok !== true) throw new Error(operation + ' failed');
  return result;
}

function bearerToken(req) {
  const match = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
  return match ? match[1].trim() : '';
}

function invalidRequest(message) {
  return Object.assign(new Error(message || 'invalid request'), { statusCode: 400 });
}

async function handle(req, res) {
  const requestId = crypto.randomUUID();
  const url = new URL(req.url, 'http://gateway.local');
  const origin = allowedOrigin(String(req.headers.origin || ''));

  if (req.method === 'OPTIONS') {
    if (!origin) return jsonResponse(res, 403, {
      ok: false, code: 'ORIGIN_DENIED', error: 'เว็บไซต์นี้ไม่ได้รับอนุญาตให้เรียกใช้ระบบ', requestId,
    });
    res.writeHead(204, {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': '600',
      vary: 'Origin',
    });
    return res.end();
  }

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      const ready = configurationErrors().length === 0;
      return jsonResponse(res, ready ? 200 : 503,
        { ok: ready, service: 'notion-notify-gateway' }, origin);
    }

    if (req.method === 'POST' && url.pathname === '/line/webhook') {
      const raw = await readBody(req);
      if (!verifyLineSignature(raw, req.headers['x-line-signature'], process.env.LINE_CHANNEL_SECRET || '')) {
        return jsonResponse(res, 401, { ok: false, code: 'INVALID_LINE_SIGNATURE', requestId });
      }
      const payload = JSON.parse(raw.toString('utf8'));
      const result = await forward(process.env.MAIN_APPS_SCRIPT_URL, payload);
      if (!isSuccessfulLineResponse(result)) throw new Error('backend did not process LINE webhook');
      return jsonResponse(res, 200, { status: 'ok' });
    }

    if (req.method === 'POST' && url.pathname === '/api/schedule') {
      if (!origin) return jsonResponse(res, 403, {
        ok: false, code: 'ORIGIN_DENIED', error: 'เว็บไซต์นี้ไม่ได้รับอนุญาตให้เรียกใช้ระบบ', requestId,
      });
      if (!/^application\/json(?:;|$)/i.test(String(req.headers['content-type'] || ''))) {
        return jsonResponse(res, 415, {
          ok: false, code: 'UNSUPPORTED_MEDIA_TYPE', error: 'รูปแบบข้อมูลที่ส่งมาไม่รองรับ', requestId,
        }, origin);
      }
      const raw = await readBody(req);
      const body = JSON.parse(raw.toString('utf8'));
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).some(key => key !== 'month')) throw invalidRequest('invalid request body');
      const payload = { apiAction: 'schedule', month: String(body.month || '') };
      const token = bearerToken(req);
      if (token) payload.accessToken = token;
      const result = await forward(process.env.MAIN_APPS_SCRIPT_URL, payload);
      return jsonResponse(res, 200, result, origin);
    }

    if (req.method === 'POST' && (url.pathname === '/api/liff' || url.pathname === '/api/admin')) {
      if (!origin) return jsonResponse(res, 403, {
        ok: false, code: 'ORIGIN_DENIED', error: 'เว็บไซต์นี้ไม่ได้รับอนุญาตให้เรียกใช้ระบบ', requestId,
      });
      if (!/^application\/json(?:;|$)/i.test(String(req.headers['content-type'] || ''))) {
        return jsonResponse(res, 415, {
          ok: false, code: 'UNSUPPORTED_MEDIA_TYPE', error: 'รูปแบบข้อมูลที่ส่งมาไม่รองรับ', requestId,
        }, origin);
      }
      const token = bearerToken(req);
      if (!token) return jsonResponse(res, 401, {
        ok: false, code: 'UNAUTHORIZED', error: 'ไม่พบข้อมูลการเข้าสู่ระบบ', requestId,
      }, origin);
      const raw = await readBody(req);
      const payload = JSON.parse(raw.toString('utf8'));
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalidRequest('invalid request body');
      if (!/^[A-Za-z][A-Za-z0-9_]{0,49}$/.test(String(payload.apiAction || ''))) {
        throw invalidRequest('invalid apiAction');
      }
      if (url.pathname === '/api/liff') {
        if (payload.internalAction) throw invalidRequest('reserved request field');
        payload.accessToken = token;
      } else payload.token = token;
      const result = await forward(url.pathname === '/api/liff'
        ? process.env.MAIN_APPS_SCRIPT_URL : process.env.ADMIN_APPS_SCRIPT_URL, payload);
      if (url.pathname === '/api/admin' && payload.apiAction === 'get_overview' && result && result.ok) {
        try {
          const healthResult = requireSuccessfulBackendResult(
            await forward(process.env.MAIN_APPS_SCRIPT_URL, { internalAction: 'notification-health' }),
            'notification health check');
          result.runtimeHealth = healthResult.health;
        } catch (healthErr) {
          console.error(JSON.stringify({ severity: 'ERROR', requestId, path: url.pathname,
            message: 'notification health check failed' }));
          result.runtimeHealth = { healthy: false, unavailable: true };
        }
      }
      if (url.pathname === '/api/admin' && payload.apiAction === 'save_settings' && result && result.ok) {
        try {
          requireSuccessfulBackendResult(
            await forward(process.env.MAIN_APPS_SCRIPT_URL, { internalAction: 'reschedule-notification' }),
            'notification reschedule');
        } catch (scheduleErr) {
          console.error(JSON.stringify({ severity: 'ERROR', requestId, path: url.pathname,
            message: 'notification reschedule failed' }));
          result.warning = 'บันทึกการตั้งค่าแล้ว แต่ยังอัปเดตเวลาส่งครั้งถัดไปไม่สำเร็จ กรุณาตรวจสอบ trigger';
        }
      }
      return jsonResponse(res, 200, result, origin);
    }

    return jsonResponse(res, 404, {
      ok: false, code: 'NOT_FOUND', error: 'ไม่พบ endpoint ที่เรียกใช้', requestId,
    }, origin);
  } catch (err) {
    const status = err.statusCode || (err instanceof SyntaxError ? 400 : 502);
    console.error(JSON.stringify({ severity: 'ERROR', requestId, path: url.pathname, message: err.message }));
    return jsonResponse(res, status, {
      ok: false,
      code: status === 400 ? 'INVALID_REQUEST' : (status === 413 ? 'PAYLOAD_TOO_LARGE' : 'UPSTREAM_ERROR'),
      error: status === 400 ? 'รูปแบบคำขอไม่ถูกต้อง' :
        (status === 413 ? 'คำขอมีขนาดใหญ่เกินกำหนด' : 'เชื่อมต่อระบบภายในไม่สำเร็จ กรุณาลองอีกครั้ง'),
      requestId,
    }, origin);
  }
}

if (require.main === module) {
  const errors = configurationErrors();
  if (errors.length) throw new Error('gateway configuration is invalid: ' + errors.join(', '));
  const port = Number(process.env.PORT || 8080);
  const server = http.createServer(handle);
  server.headersTimeout = 10000;
  server.requestTimeout = 25000;
  server.keepAliveTimeout = 5000;
  server.listen(port, '0.0.0.0', () => console.log('gateway listening on ' + port));
}

module.exports = {
  handle, lineSignature, verifyLineSignature, signEnvelope, safeEqual,
  isSuccessfulLineResponse, requireSuccessfulBackendResult, validateBackendUrl, configurationErrors,
};

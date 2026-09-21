import {
  createHmac,
  timingSafeEqual,
} from 'node:crypto';

const ALLOWED_ROLES = new Set(['user', 'manager', 'admin']);

function encode(value) {
  return Buffer.from(value).toString('base64url');
}

function decode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signature(payloadPart, secret) {
  return createHmac('sha256', secret)
    .update(payloadPart)
    .digest('base64url');
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));

  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

function validateClaims(payload, nowSeconds) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid photo ticket payload');
  }

  if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
    throw new Error('Invalid photo ticket subject');
  }

  if (typeof payload.staffKey !== 'string' || !payload.staffKey.trim()) {
    throw new Error('Invalid photo ticket staffKey');
  }

  if (!ALLOWED_ROLES.has(payload.role)) {
    throw new Error('Invalid photo ticket role');
  }

  if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) {
    throw new Error('Invalid photo ticket timestamps');
  }

  if (payload.exp <= payload.iat) {
    throw new Error('Invalid photo ticket lifetime');
  }

  if (payload.exp <= nowSeconds) {
    throw new Error('Photo ticket expired');
  }

  if (payload.iat > nowSeconds + 60) {
    throw new Error('Photo ticket issued in the future');
  }

  return Object.freeze({ ...payload });
}

export function verifyPhotoTicket(ticket, secret, options = {}) {
  if (typeof ticket !== 'string') {
    throw new Error('Photo ticket is required');
  }

  if (typeof secret !== 'string' || !secret) {
    throw new Error('Photo ticket secret is required');
  }

  const parts = ticket.split('.');
  if (parts.length !== 2) {
    throw new Error('Malformed photo ticket');
  }

  const [payloadPart, providedSignature] = parts;
  const expectedSignature = signature(payloadPart, secret);

  if (!secureEqual(providedSignature, expectedSignature)) {
    throw new Error('Invalid photo ticket signature');
  }

  let payload;
  try {
    payload = JSON.parse(decode(payloadPart));
  } catch {
    throw new Error('Invalid photo ticket payload');
  }

  const nowSeconds = options.nowSeconds ??
    Math.floor(Date.now() / 1000);

  return validateClaims(payload, nowSeconds);
}

/*
 * Used by contract tests and by the Apps Script implementation reference.
 * Production Photo Bridge only needs verification.
 */
export function createPhotoTicket(payload, secret) {
  const payloadPart = encode(JSON.stringify(payload));
  return `${payloadPart}.${signature(payloadPart, secret)}`;
}

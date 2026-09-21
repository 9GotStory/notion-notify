/**
 * Photo Bridge short-lived ticket issuer primitives.
 *
 * Identity is resolved elsewhere from verified LINE + Staff roster.
 * This file never trusts role/staffKey supplied by a browser.
 */

const PHOTO_TICKET_TTL_SECONDS = 300;
const PHOTO_TICKET_ROLES = new Set([
  'user',
  'manager',
  'admin',
]);

function photoTicketSecret_() {
  const secret = String(
    PropertiesService
      .getScriptProperties()
      .getProperty('PHOTO_TICKET_SECRET') || ''
  ).trim();

  if (!secret) {
    const err = new Error(
      'ยังไม่ได้ตั้งค่า PHOTO_TICKET_SECRET'
    );

    err.publicCode = 'UNCONFIGURED';
    throw err;
  }

  return secret;
}

function photoBase64UrlString_(value) {
  return Utilities
    .base64EncodeWebSafe(
      String(value),
      Utilities.Charset.UTF_8
    )
    .replace(/=+$/, '');
}

function photoBase64UrlBytes_(bytes) {
  return Utilities
    .base64EncodeWebSafe(bytes)
    .replace(/=+$/, '');
}

function normalizePhotoStaffKey_(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function validatePhotoTicketClaimsForIssue_(claims) {
  if (
    !claims ||
    typeof claims !== 'object' ||
    Array.isArray(claims)
  ) {
    throw new Error(
      'Invalid photo ticket payload'
    );
  }

  if (
    typeof claims.sub !== 'string' ||
    !claims.sub.trim()
  ) {
    throw new Error(
      'Invalid photo ticket subject'
    );
  }

  if (
    typeof claims.staffKey !== 'string' ||
    !claims.staffKey.trim()
  ) {
    throw new Error(
      'Invalid photo ticket staffKey'
    );
  }

  if (!PHOTO_TICKET_ROLES.has(claims.role)) {
    throw new Error(
      'Invalid photo ticket role'
    );
  }

  if (
    !Number.isInteger(claims.iat) ||
    !Number.isInteger(claims.exp)
  ) {
    throw new Error(
      'Invalid photo ticket timestamps'
    );
  }

  if (claims.exp <= claims.iat) {
    throw new Error(
      'Invalid photo ticket lifetime'
    );
  }

  if (
    claims.exp - claims.iat >
    PHOTO_TICKET_TTL_SECONDS
  ) {
    throw new Error(
      'Photo ticket lifetime exceeds policy'
    );
  }

  return claims;
}

function createPhotoTicket_(claims, secret) {
  validatePhotoTicketClaimsForIssue_(claims);

  const signingSecret =
    String(secret || '');

  if (!signingSecret) {
    throw new Error(
      'Photo ticket secret is required'
    );
  }

  const payloadPart =
    photoBase64UrlString_(
      JSON.stringify(claims)
    );

  const signatureBytes =
    Utilities.computeHmacSha256Signature(
      payloadPart,
      signingSecret,
      Utilities.Charset.UTF_8
    );

  const signature =
    photoBase64UrlBytes_(signatureBytes);

  return payloadPart + '.' + signature;
}

function photoRoleForStaffKey_(staffKey, settings) {
  const key =
    normalizePhotoStaffKey_(staffKey);

  if (!key) {
    throw new Error(
      'Photo staff key is required'
    );
  }

  const config = settings || {};

  // Existing canonical admin authorization.
  if (isAdminStaffKey_(key, config)) {
    return 'admin';
  }

  const managers = new Set(
    splitConfigNames_(
      config.photo_managers || ''
    ).map(normalizePhotoStaffKey_)
  );

  if (managers.has(key)) {
    return 'manager';
  }

  return 'user';
}

function buildPhotoTicketClaims_(
  sub,
  staffKey,
  role,
  nowSeconds
) {
  const iat = Number.isInteger(nowSeconds)
    ? nowSeconds
    : Math.floor(Date.now() / 1000);

  const claims = {
    sub: String(sub || '').trim(),
    staffKey:
      normalizePhotoStaffKey_(staffKey),
    role: String(role || '').trim(),
    iat: iat,
    exp: iat + PHOTO_TICKET_TTL_SECONDS,
  };

  return validatePhotoTicketClaimsForIssue_(
    claims
  );
}

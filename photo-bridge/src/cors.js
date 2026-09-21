const PREFLIGHT_METHODS = new Set([
  'GET',
  'POST',
]);

const ALLOWED_REQUEST_HEADERS = new Set([
  'authorization',
  'content-type',
]);

const ALLOW_METHODS_VALUE = 'GET, POST, OPTIONS';
const ALLOW_HEADERS_VALUE = 'Authorization, Content-Type';

function clean(value) {
  return String(value || '').trim();
}

function requestedHeaders(value) {
  return clean(value)
    .split(',')
    .map(header => header.trim().toLowerCase())
    .filter(Boolean);
}

export function corsHeaders(origin, allowedOrigin) {
  const requestOrigin = clean(origin);
  const configuredOrigin = clean(allowedOrigin);

  const headers = {
    vary: 'Origin',
  };

  if (
    configuredOrigin &&
    requestOrigin === configuredOrigin
  ) {
    headers['access-control-allow-origin'] =
      configuredOrigin;
  }

  return headers;
}

export function evaluatePreflight({
  origin,
  requestMethod,
  requestHeaders,
  allowedOrigin,
}) {
  const baseHeaders =
    corsHeaders(origin, allowedOrigin);

  const originAllowed =
    Boolean(
      baseHeaders['access-control-allow-origin']
    );

  const method =
    clean(requestMethod).toUpperCase();

  const headers =
    requestedHeaders(requestHeaders);

  const methodAllowed =
    PREFLIGHT_METHODS.has(method);

  const headersAllowed =
    headers.every(header =>
      ALLOWED_REQUEST_HEADERS.has(header)
    );

  if (
    !originAllowed ||
    !methodAllowed ||
    !headersAllowed
  ) {
    return {
      allowed: false,
      headers: baseHeaders,
    };
  }

  return {
    allowed: true,
    headers: {
      'access-control-allow-origin':
        clean(allowedOrigin),
      'access-control-allow-methods':
        ALLOW_METHODS_VALUE,
      'access-control-allow-headers':
        ALLOW_HEADERS_VALUE,
      vary: 'Origin',
    },
  };
}

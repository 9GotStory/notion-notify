import fs from 'node:fs';

function required(name, value) {
  const result = String(value || '').trim();
  if (!result) throw new Error(`Missing required configuration: ${name}`);
  return result;
}

function positiveInteger(name, value, fallback) {
  const raw = value == null || value === '' ? fallback : value;
  const number = Number(raw);

  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`Invalid positive integer: ${name}`);
  }

  return number;
}

function readSecretFile(name, path) {
  const file = required(name, path);

  let value;
  try {
    value = fs.readFileSync(file, 'utf8').trim();
  } catch {
    throw new Error(`Unable to read secret file: ${name}`);
  }

  if (!value) throw new Error(`Secret file is empty: ${name}`);

  return value;
}

function validateNextcloudUrl(value) {
  const url = new URL(required('PHOTO_NEXTCLOUD_URL', value));

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('PHOTO_NEXTCLOUD_URL must use http or https');
  }

  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new Error('PHOTO_NEXTCLOUD_URL must use a loopback host');
  }

  return url.toString().replace(/\/$/, '');
}

export function loadConfig(env = process.env) {
  return Object.freeze({
    nextcloudUrl: validateNextcloudUrl(env.PHOTO_NEXTCLOUD_URL),
    nextcloudUser: required(
      'PHOTO_NEXTCLOUD_USER',
      env.PHOTO_NEXTCLOUD_USER
    ),
    nextcloudPassword: readSecretFile(
      'PHOTO_NEXTCLOUD_PASSWORD_FILE',
      env.PHOTO_NEXTCLOUD_PASSWORD_FILE
    ),
    root: required('PHOTO_ROOT', env.PHOTO_ROOT),
    inbox: required('PHOTO_INBOX', env.PHOTO_INBOX),
    archive: required('PHOTO_ARCHIVE', env.PHOTO_ARCHIVE),
    ticketSecret: readSecretFile(
      'PHOTO_TICKET_SECRET_FILE',
      env.PHOTO_TICKET_SECRET_FILE
    ),
    ticketTtlSeconds: positiveInteger(
      'PHOTO_TICKET_TTL_SECONDS',
      env.PHOTO_TICKET_TTL_SECONDS,
      300
    ),
  });
}

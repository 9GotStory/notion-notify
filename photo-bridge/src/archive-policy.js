export const RESERVED = Object.freeze({
  inbox: '00_INBOX_รอจัดหมวด',
  archive: '99_ARCHIVE_คลังภาพเก่า',
});

export function isValidBuddhistYear(value) {
  return /^[0-9]{4}$/.test(String(value)) &&
    Number(value) >= 2400 &&
    Number(value) <= 2999;
}

export function isValidActivityName(value) {
  if (typeof value !== 'string') return false;

  const name = value.normalize('NFC');

  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}_.+$/u.test(name)) {
    return false;
  }

  if (
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    name === '.' ||
    name === '..' ||
    name.includes('../') ||
    name.includes('..\\')
  ) {
    return false;
  }

  return true;
}

export function classifyTopLevel(name) {
  const value = String(name || '').normalize('NFC');

  if (value === RESERVED.inbox) return 'inbox';
  if (value === RESERVED.archive) return 'archive';
  if (value === '90_ภาพองค์กร') return 'organization';

  if (/^(?:0[1-9]|1[01]|80)_.+/u.test(value)) {
    return 'topic';
  }

  return 'unknown';
}

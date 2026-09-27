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

export function buildEventIdentity(
  eventDate,
  activityName
) {
  const rawDate = String(eventDate || '').trim();

  const match =
    /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(
      rawDate
    );

  if (!match) {
    throw new Error(
      'Event date must use YYYY-MM-DD'
    );
  }

  const gregorianYear = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const buddhistYear =
    gregorianYear + 543;

  if (
    !isValidBuddhistYear(
      String(buddhistYear)
    )
  ) {
    throw new Error(
      'Event date year is outside supported range'
    );
  }

  const parsedDate =
    new Date(
      Date.UTC(
        gregorianYear,
        month - 1,
        day
      )
    );

  if (
    parsedDate.getUTCFullYear() !==
      gregorianYear ||
    parsedDate.getUTCMonth() !==
      month - 1 ||
    parsedDate.getUTCDate() !==
      day
  ) {
    throw new Error(
      'Invalid event date'
    );
  }

  const name =
    String(activityName || '')
      .trim()
      .normalize('NFC');

  if (!name) {
    throw new Error(
      'Activity name is required'
    );
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
    throw new Error(
      'Invalid activity name'
    );
  }

  const folderName =
    String(buddhistYear) +
    '-' +
    match[2] +
    '-' +
    match[3] +
    '_' +
    name;

  if (
    !isValidActivityName(
      folderName
    )
  ) {
    throw new Error(
      'Invalid derived activity folder name'
    );
  }

  return {
    eventDate: rawDate,
    buddhistYear:
      String(buddhistYear),
    activityName: name,
    folderName,
  };
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

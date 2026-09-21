import {
  isValidActivityName,
  isValidBuddhistYear,
} from './archive-policy.js';

import {
  ArchiveInputError,
} from './archive-service.js';

import { WebDavError } from './webdav-client.js';

export class ManagerNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ManagerNotFoundError';
    this.statusCode = 404;
  }
}

export class ManagerConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ManagerConflictError';
    this.statusCode = 409;
  }
}

function normalizeFilename(filename) {
  const value = String(filename || '')
    .trim()
    .normalize('NFC');

  if (
    !value ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\') ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new ArchiveInputError(
      'Invalid Inbox filename'
    );
  }

  if (value.length > 255) {
    throw new ArchiveInputError(
      'Inbox filename is too long'
    );
  }

  return value;
}

export class ManagerService {
  constructor(options) {
    if (!options?.dav) {
      throw new Error(
        'ManagerService WebDAV client is required'
      );
    }

    if (!options?.archiveService) {
      throw new Error(
        'ManagerService ArchiveService is required'
      );
    }

    if (!options?.inboxName) {
      throw new Error(
        'ManagerService inbox is required'
      );
    }

    this.dav = options.dav;
    this.archiveService = options.archiveService;
    this.inboxName = options.inboxName;
  }

  async renameActivity(input) {
    const topic = String(input?.topic || '')
      .trim()
      .normalize('NFC');

    const year =
      String(input?.year || '').trim();

    const activityName = String(
      input?.activityName || ''
    )
      .trim()
      .normalize('NFC');

    const newActivityName = String(
      input?.newActivityName || ''
    )
      .trim()
      .normalize('NFC');

    if (!isValidBuddhistYear(year)) {
      throw new ArchiveInputError(
        'Buddhist year must be four digits'
      );
    }

    if (!isValidActivityName(activityName)) {
      throw new ArchiveInputError(
        'Invalid activity folder name'
      );
    }

    if (!isValidActivityName(newActivityName)) {
      throw new ArchiveInputError(
        'Invalid new activity folder name'
      );
    }

    if (
      activityName.slice(0, 4) !== year ||
      newActivityName.slice(0, 4) !== year
    ) {
      throw new ArchiveInputError(
        'Activity year does not match selected year'
      );
    }

    if (activityName === newActivityName) {
      throw new ArchiveInputError(
        'New activity name must differ'
      );
    }

    const activities =
      await this.archiveService.listActivities(
        topic,
        year
      );

    const source = activities.find(
      (item) => item.name === activityName
    );

    if (!source) {
      throw new ManagerNotFoundError(
        'Activity does not exist'
      );
    }

    const destinationExists = activities.some(
      (item) => item.name === newActivityName
    );

    if (destinationExists) {
      throw new ManagerConflictError(
        'Destination activity already exists'
      );
    }

    const destination =
      `${topic}/${year}/${newActivityName}`;

    try {
      await this.dav.move(
        source.path,
        destination,
        {
          overwrite: false,
        }
      );
    } catch (error) {
      if (
        error instanceof WebDavError &&
        error.statusCode === 404
      ) {
        throw new ManagerNotFoundError(
          'Activity does not exist'
        );
      }

      if (
        error instanceof WebDavError &&
        (
          error.statusCode === 409 ||
          error.statusCode === 412
        )
      ) {
        throw new ManagerConflictError(
          'Destination activity already exists'
        );
      }

      throw error;
    }

    return {
      oldName: activityName,
      newName: newActivityName,
      source: source.path,
      destination,
    };
  }


  async moveFromInbox(input) {
    const filename =
      normalizeFilename(input?.filename);

    const topic = String(input?.topic || '')
      .trim()
      .normalize('NFC');

    const year =
      String(input?.year || '').trim();

    const activityName = String(
      input?.activityName || ''
    )
      .trim()
      .normalize('NFC');

    if (!isValidBuddhistYear(year)) {
      throw new ArchiveInputError(
        'Buddhist year must be four digits'
      );
    }

    if (!isValidActivityName(activityName)) {
      throw new ArchiveInputError(
        'Invalid activity folder name'
      );
    }

    if (activityName.slice(0, 4) !== year) {
      throw new ArchiveInputError(
        'Activity year does not match selected year'
      );
    }

    const activities =
      await this.archiveService.listActivities(
        topic,
        year
      );

    const activity = activities.find(
      (item) => item.name === activityName
    );

    if (!activity) {
      throw new ArchiveInputError(
        'Activity does not exist'
      );
    }

    const source =
      `${this.inboxName}/${filename}`;

    const destination =
      `${activity.path}/${filename}`;

    try {
      await this.dav.move(
        source,
        destination,
        {
          overwrite: false,
        }
      );
    } catch (error) {
      if (
        error instanceof WebDavError &&
        error.statusCode === 404
      ) {
        throw new ManagerNotFoundError(
          'Inbox file does not exist'
        );
      }

      if (
        error instanceof WebDavError &&
        (
          error.statusCode === 409 ||
          error.statusCode === 412
        )
      ) {
        throw new ManagerConflictError(
          'Destination file already exists'
        );
      }

      throw error;
    }

    return {
      name: filename,
      source,
      destination,
    };
  }
}

import {
  isValidActivityName,
  isValidBuddhistYear,
} from './archive-policy.js';

import {
  ArchiveInputError,
} from './archive-service.js';

import {
  UploadPolicyError,
  validateImageUpload,
} from './upload-policy.js';

import { WebDavError } from './webdav-client.js';

export class UploadConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UploadConflictError';
    this.statusCode = 409;
  }
}

export class UploadService {
  constructor(options) {
    if (!options?.dav) {
      throw new Error('UploadService WebDAV client is required');
    }

    if (!options?.archiveService) {
      throw new Error('UploadService ArchiveService is required');
    }

    this.dav = options.dav;
    this.archiveService = options.archiveService;
  }

  async uploadToActivity(input) {
    const topic = String(input?.topic || '')
      .trim()
      .normalize('NFC');

    const year = String(input?.year || '').trim();

    const activityName = String(input?.activityName || '')
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

    const selected =
      await this.archiveService.resolveActivityTopic(topic);

    const activities =
      await this.archiveService.listActivities(
        selected.name,
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

    const validated = validateImageUpload(
      input.filename,
      input.content
    );

    const destination =
      `${activity.path}/${validated.filename}`;

    try {
      await this.dav.upload(
        destination,
        input.content,
        validated.mime
      );
    } catch (error) {
      if (
        error instanceof WebDavError &&
        error.statusCode === 412
      ) {
        throw new UploadConflictError(
          'A file with this name already exists'
        );
      }

      throw error;
    }

    return {
      name: validated.filename,
      path: destination,
      mime: validated.mime,
      size: validated.size,
    };
  }
}

export { UploadPolicyError };

import { randomUUID } from 'node:crypto';

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
      throw new Error(
        'UploadService WebDAV client is required'
      );
    }

    if (!options?.archiveService) {
      throw new Error(
        'UploadService ArchiveService is required'
      );
    }

    this.dav = options.dav;
    this.archiveService = options.archiveService;

    this.inboxName =
      options.inboxName || null;

    this.clock =
      options.clock || (() => new Date());

    this.idFactory =
      options.idFactory ||
      (() =>
        randomUUID()
          .replaceAll('-', '')
          .slice(0, 8)
      );
  }

  async putImage(destination, content, mime) {
    try {
      await this.dav.upload(
        destination,
        content,
        mime
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
  }

  async uploadToActivity(input) {
    const topic = String(input?.topic || '')
      .trim()
      .normalize('NFC');

    const year = String(input?.year || '').trim();

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

    const selected =
      await this.archiveService.resolveActivityTopic(
        topic
      );

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

    await this.putImage(
      destination,
      input.content,
      validated.mime
    );

    return {
      name: validated.filename,
      path: destination,
      mime: validated.mime,
      size: validated.size,
    };
  }

  async uploadToOrganization(input) {
    const topics =
      await this.archiveService.listSelectableTopics();

    const organization =
      topics.find(
        (item) =>
          item &&
          item.type === 'organization'
      );

    if (
      !organization ||
      typeof organization.path !== 'string' ||
      !organization.path
    ) {
      throw new ArchiveInputError(
        'Organization destination is unavailable'
      );
    }

    const validated =
      validateImageUpload(
        input?.filename,
        input?.content
      );

    const destination =
      `${organization.path}/${validated.filename}`;

    await this.putImage(
      destination,
      input.content,
      validated.mime
    );

    return {
      name: validated.filename,
      path: destination,
      mime: validated.mime,
      size: validated.size,
    };
  }

  async uploadToInbox(input) {
    if (!this.inboxName) {
      throw new Error(
        'UploadService inbox is not configured'
      );
    }

    const validated = validateImageUpload(
      input?.filename,
      input?.content
    );

    const now = this.clock();

    if (
      !(now instanceof Date) ||
      Number.isNaN(now.getTime())
    ) {
      throw new Error(
        'UploadService clock returned invalid date'
      );
    }

    const timestamp = now
      .toISOString()
      .replace(/[-:]/gu, '')
      .replace(/\.\d{3}Z$/u, 'Z');

    const suffix = String(this.idFactory())
      .replace(/[^A-Za-z0-9_-]/gu, '')
      .slice(0, 16);

    if (!suffix) {
      throw new Error(
        'UploadService generated invalid identifier'
      );
    }

    const storedName =
      `${timestamp}_${suffix}_${validated.filename}`;

    const destination =
      `${this.inboxName}/${storedName}`;

    await this.putImage(
      destination,
      input.content,
      validated.mime
    );

    return {
      name: storedName,
      originalName: validated.filename,
      path: destination,
      mime: validated.mime,
      size: validated.size,
    };
  }
}

export { UploadPolicyError };

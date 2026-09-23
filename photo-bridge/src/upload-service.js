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

  async uploadToDraftActivity(input) {
    const topic =
      String(input?.topic || '')
        .trim()
        .normalize('NFC');

    const year =
      String(input?.year || '')
        .trim();

    const activityName =
      String(
        input?.activityName || ''
      )
        .trim()
        .normalize('NFC');

    if (!isValidBuddhistYear(year)) {
      throw new ArchiveInputError(
        'Buddhist year must be four digits'
      );
    }

    if (
      !isValidActivityName(
        activityName
      )
    ) {
      throw new ArchiveInputError(
        'Invalid activity folder name'
      );
    }

    if (
      activityName.slice(0, 4) !==
      year
    ) {
      throw new ArchiveInputError(
        'Activity year does not match selected year'
      );
    }

    // Bytes are validated before any WebDAV write.
    const validated =
      validateImageUpload(
        input?.filename,
        input?.content
      );

    // Only resolve an already-existing canonical topic.
    const selected =
      await this.archiveService
        .resolveActivityTopic(topic);

    const now =
      this.clock();

    if (
      !(now instanceof Date) ||
      Number.isNaN(now.getTime())
    ) {
      throw new Error(
        'UploadService clock returned invalid date'
      );
    }

    const timestamp =
      now
        .toISOString()
        .replace(/[-:]/gu, '')
        .replace(/\.\d{3}Z$/u, 'Z');

    const suffix =
      String(this.idFactory())
        .replace(
          /[^A-Za-z0-9_-]/gu,
          ''
        )
        .slice(0, 16);

    if (!suffix) {
      throw new Error(
        'UploadService generated invalid identifier'
      );
    }

    // Everything below stagingRoot belongs only to this request.
    //
    // It is deliberately outside the canonical year hierarchy,
    // so incomplete work is never exposed as an activity.
    const stagingName =
      `__PHOTO_DRAFT__${timestamp}_${suffix}`;

    const stagingRoot =
      `${selected.path}/${stagingName}`;

    const stagingActivity =
      `${stagingRoot}/${activityName}`;

    const stagedFile =
      `${stagingActivity}/${validated.filename}`;

    const yearPath =
      `${selected.path}/${year}`;

    const activityPath =
      `${yearPath}/${activityName}`;

    const destination =
      `${activityPath}/${validated.filename}`;

    let ownsStagingRoot =
      false;

    const attachCleanupError_ = (
      authorityError,
      cleanupError
    ) => {
      if (
        !authorityError ||
        typeof authorityError !==
          'object'
      ) {
        return;
      }

      authorityError.rollbackErrors = [
        ...(
          Array.isArray(
            authorityError.rollbackErrors
          )
            ? authorityError.rollbackErrors
            : []
        ),
        cleanupError,
      ];
    };

    const cleanupStaging_ =
      async (
        authorityError = null
      ) => {
        if (!ownsStagingRoot) {
          return;
        }

        try {
          await this.dav.delete(
            stagingRoot
          );

          ownsStagingRoot =
            false;
        } catch (cleanupError) {
          if (
            cleanupError instanceof
              WebDavError &&
            cleanupError.statusCode ===
              404
          ) {
            ownsStagingRoot =
              false;

            return;
          }

          // Cleanup failure must never replace the operation
          // error. After successful canonical publish it is also
          // non-fatal: only a reserved request-owned staging
          // collection may remain.
          if (authorityError) {
            attachCleanupError_(
              authorityError,
              cleanupError
            );
          }
        }
      };

    const isDestinationExists_ =
      (error) =>
        error instanceof
          WebDavError &&
        error.statusCode ===
          412;

    // --------------------------------------------------------
    // Stage a complete activity tree first.
    //
    // canonical year/activity folders are still untouched.
    // --------------------------------------------------------

    try {
      await this.dav.createFolder(
        stagingRoot
      );

      ownsStagingRoot =
        true;

      await this.dav.createFolder(
        stagingActivity
      );

      await this.putImage(
        stagedFile,
        input.content,
        validated.mime
      );
    } catch (error) {
      await cleanupStaging_(
        error
      );

      throw error;
    }

    // --------------------------------------------------------
    // Publish attempt #1:
    //
    // If the Buddhist-year folder does not exist, moving the
    // complete request-owned staging tree to the year path
    // atomically materializes:
    //
    //   year/activity/file
    //
    // A failed MOVE therefore cannot expose an empty activity.
    // --------------------------------------------------------

    try {
      await this.dav.move(
        stagingRoot,
        yearPath,
        {
          overwrite: false,
        }
      );

      ownsStagingRoot =
        false;

      return {
        created: true,
        yearCreated: true,

        activity: {
          name:
            activityName,
          path:
            activityPath,
        },

        file: {
          name:
            validated.filename,
          path:
            destination,
          mime:
            validated.mime,
          size:
            validated.size,
        },
      };
    } catch (error) {
      if (
        !isDestinationExists_(
          error
        )
      ) {
        await cleanupStaging_(
          error
        );

        throw error;
      }
    }

    // --------------------------------------------------------
    // Publish attempt #2:
    //
    // Year already exists (including a concurrent creator).
    // MOVE the complete activity collection atomically.
    // --------------------------------------------------------

    try {
      await this.dav.move(
        stagingActivity,
        activityPath,
        {
          overwrite: false,
        }
      );

      // stagingRoot is now empty and remains request-owned.
      await cleanupStaging_();

      return {
        created: true,
        yearCreated: false,

        activity: {
          name:
            activityName,
          path:
            activityPath,
        },

        file: {
          name:
            validated.filename,
          path:
            destination,
          mime:
            validated.mime,
          size:
            validated.size,
        },
      };
    } catch (error) {
      if (
        !isDestinationExists_(
          error
        )
      ) {
        await cleanupStaging_(
          error
        );

        throw error;
      }
    }

    // --------------------------------------------------------
    // Publish attempt #3:
    //
    // Activity also exists, which can happen when another
    // request materialized the same activity concurrently.
    //
    // Publish only this staged file. Overwrite remains disabled.
    // --------------------------------------------------------

    try {
      await this.dav.move(
        stagedFile,
        destination,
        {
          overwrite: false,
        }
      );
    } catch (error) {
      let authorityError =
        error;

      if (
        isDestinationExists_(
          error
        )
      ) {
        authorityError =
          new UploadConflictError(
            'A file with this name already exists'
          );
      }

      await cleanupStaging_(
        authorityError
      );

      throw authorityError;
    }

    // stagingActivity/stagingRoot are now empty.
    // Cleanup is best-effort and cannot invalidate a successful
    // canonical file publish.
    await cleanupStaging_();

    return {
      created: false,
      yearCreated: false,

      activity: {
        name:
          activityName,
        path:
          activityPath,
      },

      file: {
        name:
          validated.filename,
        path:
          destination,
        mime:
          validated.mime,
        size:
          validated.size,
      },
    };
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

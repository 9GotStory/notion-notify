import {
  classifyTopLevel,
  isValidActivityName,
  isValidBuddhistYear,
} from './archive-policy.js';

import { WebDavError } from './webdav-client.js';

export class ArchiveInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ArchiveInputError';
    this.statusCode = 400;
  }
}

export class ArchiveService {
  constructor(options) {
    if (!options?.dav) {
      throw new Error('ArchiveService WebDAV client is required');
    }

    this.dav = options.dav;
  }

  async listSelectableTopics() {
    const folders = await this.dav.listFolders();

    return folders
      .map((folder) => ({
        ...folder,
        type: classifyTopLevel(folder.name),
      }))
      .filter((folder) =>
        folder.type === 'topic' ||
        folder.type === 'organization'
      )
      .sort((left, right) =>
        left.name.localeCompare(right.name, 'th')
      );
  }

  async resolveActivityTopic(topic) {
    const topicName = String(topic || '')
      .trim()
      .normalize('NFC');

    if (!topicName) {
      throw new ArchiveInputError('Topic is required');
    }

    const topics = await this.listSelectableTopics();

    const selected = topics.find(
      (item) => item.name === topicName
    );

    if (!selected) {
      throw new ArchiveInputError(
        'Unknown or unavailable topic'
      );
    }

    if (selected.type !== 'topic') {
      throw new ArchiveInputError(
        'Selected destination does not use activities'
      );
    }

    return selected;
  }

  async listActivities(topic, year) {
    const yearValue = String(year || '').trim();

    if (!isValidBuddhistYear(yearValue)) {
      throw new ArchiveInputError(
        'Buddhist year must be four digits'
      );
    }

    const selected =
      await this.resolveActivityTopic(topic);

    const parentPath =
      `${selected.path}/${yearValue}`;

    let folders;

    try {
      folders = await this.dav.listFolders(parentPath);
    } catch (error) {
      if (
        error instanceof WebDavError &&
        error.statusCode === 404
      ) {
        return [];
      }

      throw error;
    }

    return folders
      .filter((folder) =>
        isValidActivityName(folder.name)
      )
      .sort((left, right) =>
        right.name.localeCompare(left.name, 'th')
      );
  }

  async ensureFolder(parentPath, name) {
    const path = `${parentPath}/${name}`;

    try {
      await this.dav.createFolder(path);

      return {
        path,
        created: true,
      };
    } catch (error) {
      if (
        !(error instanceof WebDavError) ||
        error.statusCode !== 405
      ) {
        throw error;
      }

      const folders =
        await this.dav.listFolders(parentPath);

      const existing = folders.find(
        (item) => item.name === name
      );

      if (!existing) {
        throw error;
      }

      return {
        path: existing.path || path,
        created: false,
      };
    }
  }

  async createActivity(topic, year, activityName) {
    const yearValue = String(year || '').trim();

    const name = String(activityName || '')
      .trim()
      .normalize('NFC');

    if (!isValidBuddhistYear(yearValue)) {
      throw new ArchiveInputError(
        'Buddhist year must be four digits'
      );
    }

    if (!isValidActivityName(name)) {
      throw new ArchiveInputError(
        'Invalid activity folder name'
      );
    }

    if (name.slice(0, 4) !== yearValue) {
      throw new ArchiveInputError(
        'Activity year does not match selected year'
      );
    }

    const selected =
      await this.resolveActivityTopic(topic);

    const yearFolder = await this.ensureFolder(
      selected.path,
      yearValue
    );

    const activityFolder = await this.ensureFolder(
      yearFolder.path,
      name
    );

    return {
      created: activityFolder.created,
      activity: {
        name,
        path: activityFolder.path,
      },
    };
  }
}

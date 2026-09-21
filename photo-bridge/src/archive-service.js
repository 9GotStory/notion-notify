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

  async listActivities(topic, year) {
    const topicName = String(topic || '')
      .trim()
      .normalize('NFC');

    const yearValue = String(year || '').trim();

    if (!topicName) {
      throw new ArchiveInputError('Topic is required');
    }

    if (!isValidBuddhistYear(yearValue)) {
      throw new ArchiveInputError(
        'Buddhist year must be four digits'
      );
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

    // 90_ภาพองค์กร ไม่ใช้โครงสร้าง year/activity
    if (selected.type !== 'topic') {
      throw new ArchiveInputError(
        'Selected destination does not use activities'
      );
    }

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
}

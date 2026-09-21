import { classifyTopLevel } from './archive-policy.js';

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
}

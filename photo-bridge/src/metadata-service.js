import {
  classifyTopLevel,
  isValidActivityName,
  isValidBuddhistYear,
} from './archive-policy.js';

export class MetadataInputError extends Error {
  constructor(message) {
    super(message);
    this.name =
      'MetadataInputError';
    this.statusCode =
      400;
  }
}

export class MetadataPermissionError extends Error {
  constructor(message) {
    super(message);
    this.name =
      'MetadataPermissionError';
    this.statusCode =
      403;
  }
}

function normalizeTagIds(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    !Array.isArray(input.tagIds) ||
    input.tagIds.length === 0
  ) {
    throw new MetadataInputError(
      'At least one tag is required'
    );
  }

  const result = [];
  const seen = new Set();

  for (
    const raw
    of input.tagIds
  ) {
    const id =
      String(
        raw ?? ''
      ).trim();

    if (
      !/^[0-9]+$/u.test(id)
    ) {
      throw new MetadataInputError(
        'Invalid tag ID'
      );
    }

    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    result.push(id);
  }

  if (result.length === 0) {
    throw new MetadataInputError(
      'At least one tag is required'
    );
  }

  return result;
}

function isImage(file) {
  return (
    typeof file?.mime ===
      'string' &&
    file.mime
      .trim()
      .toLowerCase()
      .startsWith(
        'image/'
      )
  );
}

function activityIdentity(
  segments,
  offset
) {
  const topic =
    segments[offset];

  const year =
    segments[
      offset + 1
    ];

  const activityName =
    segments[
      offset + 2
    ];

  if (
    classifyTopLevel(
      topic
    ) !== 'topic'
  ) {
    return null;
  }

  if (
    !isValidBuddhistYear(
      year
    )
  ) {
    return null;
  }

  if (
    !isValidActivityName(
      activityName
    )
  ) {
    return null;
  }

  if (
    activityName.slice(
      0,
      4
    ) !== year
  ) {
    return null;
  }

  return {
    topic,
    year,
    activityName,
  };
}

function canonicalPhoto(file) {
  if (
    !file ||
    typeof file !== 'object' ||
    !isImage(file)
  ) {
    return null;
  }

  const path =
    String(
      file.path || ''
    )
      .trim()
      .normalize('NFC');

  if (
    !path ||
    path.startsWith('/') ||
    path.endsWith('/') ||
    path.includes('\\') ||
    path.includes('\0')
  ) {
    return null;
  }

  const segments =
    path.split('/');

  if (
    segments.some(
      segment =>
        !segment ||
        segment === '.' ||
        segment === '..'
    )
  ) {
    return null;
  }

  const topLevel =
    classifyTopLevel(
      segments[0]
    );

  // --------------------------------------------------
  // Canonical active activity:
  //
  // topic/year/activity/file
  // --------------------------------------------------

  if (
    topLevel === 'topic' &&
    segments.length === 4
  ) {
    const identity =
      activityIdentity(
        segments,
        0
      );

    if (!identity) {
      return null;
    }

    return {
      ...file,
      location:
        'activity',
      ...identity,
    };
  }

  // --------------------------------------------------
  // Canonical organization image:
  //
  // 90_ภาพองค์กร/file
  //
  // Organization images do not use year/activity.
  // --------------------------------------------------

  if (
    topLevel ===
      'organization' &&
    segments.length === 2
  ) {
    return {
      ...file,
      location:
        'organization',
    };
  }

  // --------------------------------------------------
  // Canonical archived activity:
  //
  // archive/topic/year/activity/file
  // --------------------------------------------------

  if (
    topLevel ===
      'archive' &&
    segments.length === 5
  ) {
    const identity =
      activityIdentity(
        segments,
        1
      );

    if (!identity) {
      return null;
    }

    return {
      ...file,
      location:
        'archive',
      ...identity,
    };
  }

  // Inbox, unknown folders, staging trees,
  // malformed hierarchy, and other Nextcloud
  // nodes are deliberately outside PMETA search.
  return null;
}

function normalizeMetadataIdentifier(
  value,
  label
) {
  const id =
    String(
      value ?? ''
    ).trim();

  if (!/^[0-9]+$/u.test(id)) {
    throw new MetadataInputError(
      `Invalid ${label}`
    );
  }

  return id;
}

function normalizeMetadataWriteInput(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input)
  ) {
    throw new MetadataInputError(
      'Metadata write input is required'
    );
  }

  const actor =
    input.actor;

  if (
    !actor ||
    typeof actor !== 'object' ||
    Array.isArray(actor) ||
    typeof actor.role !== 'string' ||
    !actor.role.trim()
  ) {
    throw new MetadataInputError(
      'Metadata write actor is required'
    );
  }

  const fileId =
    normalizeMetadataIdentifier(
      input.fileId,
      'file ID'
    );

  const tagId =
    normalizeMetadataIdentifier(
      input.tagId,
      'tag ID'
    );

  const photoPath =
    String(
      input.path ?? ''
    )
      .trim()
      .normalize('NFC');

  if (
    !photoPath ||
    photoPath.startsWith('/') ||
    photoPath.endsWith('/') ||
    photoPath.includes('\\') ||
    photoPath.includes('\0')
  ) {
    throw new MetadataInputError(
      'Invalid photo path'
    );
  }

  const segments =
    photoPath.split('/');

  if (
    segments.some(
      segment =>
        !segment ||
        segment === '.' ||
        segment === '..'
    )
  ) {
    throw new MetadataInputError(
      'Invalid photo path'
    );
  }

  const canonical =
    canonicalPhoto({
      path:
        photoPath,

      mime:
        'image/x-metadata-validation',
    });

  if (
    !canonical ||
    (
      canonical.location !==
        'activity' &&
      canonical.location !==
        'organization'
    )
  ) {
    throw new MetadataInputError(
      'Photo location does not allow metadata writes'
    );
  }

  return {
    actor: {
      ...actor,
      role:
        actor.role.trim(),
    },

    fileId,
    tagId,

    path:
      photoPath,

    parentPath:
      segments
        .slice(
          0,
          -1
        )
        .join('/'),
  };
}

function requireMetadataWriteRole(actor) {
  if (
    actor.role !== 'manager' &&
    actor.role !== 'admin'
  ) {
    throw new MetadataPermissionError(
      'Metadata write requires manager or admin role'
    );
  }
}

async function verifyMetadataWriteTarget(
  dav,
  input
) {
  const files =
    await dav.listFiles(
      input.parentPath
    );

  if (!Array.isArray(files)) {
    throw new Error(
      'MetadataService received invalid file listing'
    );
  }

  const matches =
    files.filter(
      file => {
        if (
          !file ||
          typeof file !== 'object' ||
          !isImage(file)
        ) {
          return false;
        }

        const candidatePath =
          String(
            file.path ?? ''
          )
            .trim()
            .normalize('NFC');

        const candidateFileId =
          String(
            file.fileId ?? ''
          ).trim();

        return (
          candidatePath ===
            input.path &&
          candidateFileId ===
            input.fileId
        );
      }
    );

  if (matches.length !== 1) {
    throw new MetadataInputError(
      'Photo target does not match current archive state'
    );
  }

  return matches[0];
}

async function resolveWritableTag(
  service,
  tagId
) {
  const tags =
    await service.listTags();

  const tag =
    tags.find(
      candidate =>
        String(
          candidate?.id ?? ''
        ).trim() ===
          tagId
    );

  if (!tag) {
    throw new MetadataInputError(
      'Unknown or unavailable tag'
    );
  }

  if (tag.canAssign !== true) {
    throw new MetadataPermissionError(
      'Tag cannot be assigned by the current Nextcloud account'
    );
  }

  return tag;
}

function hasTagRelation(
  tags,
  tagId
) {
  if (!Array.isArray(tags)) {
    throw new Error(
      'MetadataService received invalid file tag relations'
    );
  }

  return tags.some(
    tag =>
      String(
        tag?.id ?? ''
      ).trim() ===
        tagId
  );
}

export class MetadataService {
  constructor(options) {
    if (!options?.dav) {
      throw new Error(
        'MetadataService WebDAV client is required'
      );
    }

    this.dav =
      options.dav;
  }

  async listTags() {
    const tags =
      await this.dav
        .listSystemTags();

    if (!Array.isArray(tags)) {
      throw new Error(
        'MetadataService received invalid tag catalog'
      );
    }

    return tags.filter(
      tag =>
        tag &&
        tag.userVisible ===
          true
    );
  }

  async assignPhotoTag(input) {
    const normalized =
      normalizeMetadataWriteInput(
        input
      );

    requireMetadataWriteRole(
      normalized.actor
    );

    await verifyMetadataWriteTarget(
      this.dav,
      normalized
    );

    await resolveWritableTag(
      this,
      normalized.tagId
    );

    const currentTags =
      await this.dav
        .listFileSystemTags(
          normalized.fileId
        );

    if (
      hasTagRelation(
        currentTags,
        normalized.tagId
      )
    ) {
      return {
        changed:
          false,

        fileId:
          normalized.fileId,

        tagId:
          normalized.tagId,
      };
    }

    await this.dav
      .assignSystemTag(
        normalized.fileId,
        normalized.tagId
      );

    return {
      changed:
        true,

      fileId:
        normalized.fileId,

      tagId:
        normalized.tagId,
    };
  }

  async removePhotoTag(input) {
    const normalized =
      normalizeMetadataWriteInput(
        input
      );

    requireMetadataWriteRole(
      normalized.actor
    );

    await verifyMetadataWriteTarget(
      this.dav,
      normalized
    );

    await resolveWritableTag(
      this,
      normalized.tagId
    );

    const currentTags =
      await this.dav
        .listFileSystemTags(
          normalized.fileId
        );

    if (
      !hasTagRelation(
        currentTags,
        normalized.tagId
      )
    ) {
      return {
        changed:
          false,

        fileId:
          normalized.fileId,

        tagId:
          normalized.tagId,
      };
    }

    await this.dav
      .removeSystemTag(
        normalized.fileId,
        normalized.tagId
      );

    return {
      changed:
        true,

      fileId:
        normalized.fileId,

      tagId:
        normalized.tagId,
    };
  }

  async searchPhotos(input) {
    // Validate semantic input before any
    // WebDAV access.
    const tagIds =
      normalizeTagIds(
        input
      );

    // Nextcloud remains the authority for
    // whether a tag currently exists and is
    // visible to this account.
    const visibleTags =
      await this.listTags();

    const visibleIds =
      new Set(
        visibleTags.map(
          tag =>
            String(
              tag.id
            )
        )
      );

    for (
      const id
      of tagIds
    ) {
      if (
        !visibleIds.has(id)
      ) {
        throw new MetadataInputError(
          'Unknown or unavailable tag'
        );
      }
    }

    // One native filter-files REPORT carries
    // all requested system tags. Nextcloud
    // performs AND/intersection semantics.
    const files =
      await this.dav
        .searchFilesBySystemTags(
          tagIds,
          undefined
        );

    if (!Array.isArray(files)) {
      throw new Error(
        'MetadataService received invalid search results'
      );
    }

    return files
      .map(
        file =>
          canonicalPhoto(
            file
          )
      )
      .filter(Boolean);
  }
}

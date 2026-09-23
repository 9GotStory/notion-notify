import test from 'node:test';
import assert from 'node:assert/strict';

import {
  UploadConflictError,
  UploadService,
} from '../src/upload-service.js';

import { WebDavError } from '../src/webdav-client.js';

import {
  UploadPolicyError,
} from '../src/upload-policy.js';

const TOPIC = '80_งานกิจกรรมกลาง';
const YEAR = '2569';
const ACTIVITY =
  '2569-09-03_ออกหน่วยรับบริจาคโลหิตอำเภอสอง';

const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0,
  0x00, 0x10, 0x4a, 0x46,
]);

function archiveService() {
  return {
    async resolveActivityTopic(topic) {
      assert.equal(topic, TOPIC);

      return {
        name: TOPIC,
        path: TOPIC,
        type: 'topic',
      };
    },

    async listActivities(topic, year) {
      assert.equal(topic, TOPIC);
      assert.equal(year, YEAR);

      return [
        {
          name: ACTIVITY,
          path: `${TOPIC}/${YEAR}/${ACTIVITY}`,
        },
      ];
    },
  };
}

test('upload normalizes extension and writes to activity', async () => {
  let captured;

  const service = new UploadService({
    archiveService: archiveService(),
    dav: {
      async upload(path, content, mime) {
        captured = {
          path,
          content,
          mime,
        };

        return true;
      },
    },
  });

  const result = await service.uploadToActivity({
    topic: TOPIC,
    year: YEAR,
    activityName: ACTIVITY,
    filename: 'ภาพทดสอบ.png',
    content: JPEG,
  });

  assert.equal(result.name, 'ภาพทดสอบ.jpg');
  assert.equal(result.mime, 'image/jpeg');

  assert.equal(
    captured.path,
    `${TOPIC}/${YEAR}/${ACTIVITY}/ภาพทดสอบ.jpg`
  );

  assert.equal(captured.content, JPEG);
  assert.equal(captured.mime, 'image/jpeg');
});

test('upload rejects unknown activity before PUT', async () => {
  let wrote = false;

  const service = new UploadService({
    archiveService: {
      async resolveActivityTopic() {
        return {
          name: TOPIC,
          path: TOPIC,
          type: 'topic',
        };
      },

      async listActivities() {
        return [];
      },
    },

    dav: {
      async upload() {
        wrote = true;
      },
    },
  });

  await assert.rejects(
    () => service.uploadToActivity({
      topic: TOPIC,
      year: YEAR,
      activityName: ACTIVITY,
      filename: 'photo.jpg',
      content: JPEG,
    }),
    /Activity does not exist/
  );

  assert.equal(wrote, false);
});

test('existing filename becomes HTTP conflict', async () => {
  const service = new UploadService({
    archiveService: archiveService(),

    dav: {
      async upload() {
        throw new WebDavError(
          'precondition failed',
          412
        );
      },
    },
  });

  await assert.rejects(
    () => service.uploadToActivity({
      topic: TOPIC,
      year: YEAR,
      activityName: ACTIVITY,
      filename: 'photo.jpg',
      content: JPEG,
    }),
    UploadConflictError
  );
});


test('draft activity upload validates image before any staging write', async () => {
  let wrote = false;

  const service = new UploadService({
    archiveService: {
      async resolveActivityTopic() {
        throw new Error(
          'topic resolution must not run for invalid image'
        );
      },
    },

    dav: {
      async createFolder() {
        wrote = true;
      },

      async upload() {
        wrote = true;
      },
    },
  });

  await assert.rejects(
    () => service.uploadToDraftActivity({
      topic: TOPIC,
      year: YEAR,
      activityName: ACTIVITY,
      filename: 'not-an-image.txt',
      content: Buffer.from(
        'not an image'
      ),
    }),
    UploadPolicyError
  );

  assert.equal(
    wrote,
    false
  );
});


test('draft activity publishes complete staging tree atomically when year is absent', async () => {
  const activityPath =
    `${TOPIC}/${YEAR}/${ACTIVITY}`;

  const calls = [];

  let stagingRoot = '';
  let stagingActivity = '';
  let stagedFile = '';

  const service = new UploadService({
    archiveService: {
      async resolveActivityTopic(topic) {
        assert.equal(
          topic,
          TOPIC
        );

        return {
          name: TOPIC,
          path: TOPIC,
          type: 'topic',
        };
      },

      async createActivity() {
        throw new Error(
          'createActivity must not run'
        );
      },
    },

    clock: () =>
      new Date(
        '2026-09-23T03:00:00.000Z'
      ),

    idFactory: () =>
      'draft123',

    dav: {
      async createFolder(path) {
        calls.push([
          'mkdir',
          path,
        ]);

        if (!stagingRoot) {
          stagingRoot =
            path;
        } else {
          stagingActivity =
            path;
        }
      },

      async upload(
        path,
        content,
        mime
      ) {
        stagedFile =
          path;

        calls.push([
          'upload',
          path,
          content,
          mime,
        ]);

        assert.equal(
          path,
          `${stagingActivity}/ภาพแรก.jpg`
        );
      },

      async move(
        source,
        destination,
        options
      ) {
        calls.push([
          'move',
          source,
          destination,
          options,
        ]);

        assert.equal(
          source,
          stagingRoot
        );

        assert.equal(
          destination,
          `${TOPIC}/${YEAR}`
        );

        assert.equal(
          options.overwrite,
          false
        );
      },

      async delete() {
        throw new Error(
          'successful year publish must not delete canonical or staging source'
        );
      },
    },
  });

  const result =
    await service.uploadToDraftActivity({
      topic: TOPIC,
      year: YEAR,
      activityName: ACTIVITY,
      filename: 'ภาพแรก.png',
      content: JPEG,
    });

  assert.equal(
    stagingRoot.startsWith(
      `${TOPIC}/__PHOTO_DRAFT__`
    ),
    true
  );

  assert.equal(
    stagingActivity,
    `${stagingRoot}/${ACTIVITY}`
  );

  assert.equal(
    stagedFile,
    `${stagingActivity}/ภาพแรก.jpg`
  );

  assert.deepEqual(
    calls.map(
      item =>
        item[0]
    ),
    [
      'mkdir',
      'mkdir',
      'upload',
      'move',
    ]
  );

  assert.equal(
    result.created,
    true
  );

  assert.equal(
    result.yearCreated,
    true
  );

  assert.deepEqual(
    result.activity,
    {
      name: ACTIVITY,
      path: activityPath,
    }
  );

  assert.equal(
    result.file.path,
    `${activityPath}/ภาพแรก.jpg`
  );

  assert.equal(
    result.file.mime,
    'image/jpeg'
  );
});


test('draft activity atomically publishes activity collection when year already exists', async () => {
  const yearPath =
    `${TOPIC}/${YEAR}`;

  const activityPath =
    `${yearPath}/${ACTIVITY}`;

  let stagingRoot = '';
  let stagingActivity = '';

  const moves = [];
  const deleted = [];

  const service = new UploadService({
    archiveService: {
      async resolveActivityTopic() {
        return {
          name: TOPIC,
          path: TOPIC,
          type: 'topic',
        };
      },
    },

    clock: () =>
      new Date(
        '2026-09-23T03:00:00.000Z'
      ),

    idFactory: () =>
      'existingyear',

    dav: {
      async createFolder(path) {
        if (!stagingRoot) {
          stagingRoot =
            path;
        } else {
          stagingActivity =
            path;
        }
      },

      async upload() {},

      async move(
        source,
        destination
      ) {
        moves.push([
          source,
          destination,
        ]);

        if (
          destination ===
            yearPath
        ) {
          throw new WebDavError(
            'destination exists',
            412
          );
        }

        assert.equal(
          source,
          stagingActivity
        );

        assert.equal(
          destination,
          activityPath
        );
      },

      async delete(path) {
        deleted.push(path);
      },
    },
  });

  const result =
    await service.uploadToDraftActivity({
      topic: TOPIC,
      year: YEAR,
      activityName: ACTIVITY,
      filename: 'photo.jpg',
      content: JPEG,
    });

  assert.deepEqual(
    moves.map(
      item =>
        item[1]
    ),
    [
      yearPath,
      activityPath,
    ]
  );

  assert.deepEqual(
    deleted,
    [
      stagingRoot,
    ]
  );

  assert.equal(
    result.created,
    true
  );

  assert.equal(
    result.yearCreated,
    false
  );
});


test('draft activity publishes only file when concurrent request already created activity', async () => {
  const yearPath =
    `${TOPIC}/${YEAR}`;

  const activityPath =
    `${yearPath}/${ACTIVITY}`;

  const destination =
    `${activityPath}/photo.jpg`;

  let stagingRoot = '';
  let stagingActivity = '';
  let stagedFile = '';

  const moveDestinations = [];
  const deleted = [];

  const service = new UploadService({
    archiveService: {
      async resolveActivityTopic() {
        return {
          name: TOPIC,
          path: TOPIC,
          type: 'topic',
        };
      },
    },

    clock: () =>
      new Date(
        '2026-09-23T03:00:00.000Z'
      ),

    idFactory: () =>
      'existingact',

    dav: {
      async createFolder(path) {
        if (!stagingRoot) {
          stagingRoot =
            path;
        } else {
          stagingActivity =
            path;
        }
      },

      async upload(path) {
        stagedFile =
          path;
      },

      async move(
        source,
        destination
      ) {
        moveDestinations.push(
          destination
        );

        if (
          destination ===
            yearPath ||
          destination ===
            activityPath
        ) {
          throw new WebDavError(
            'destination exists',
            412
          );
        }

        assert.equal(
          source,
          stagedFile
        );

        assert.equal(
          destination,
          `${activityPath}/photo.jpg`
        );
      },

      async delete(path) {
        deleted.push(path);
      },
    },
  });

  const result =
    await service.uploadToDraftActivity({
      topic: TOPIC,
      year: YEAR,
      activityName: ACTIVITY,
      filename: 'photo.jpg',
      content: JPEG,
    });

  assert.deepEqual(
    moveDestinations,
    [
      yearPath,
      activityPath,
      destination,
    ]
  );

  assert.deepEqual(
    deleted,
    [
      stagingRoot,
    ]
  );

  assert.equal(
    result.created,
    false
  );

  assert.equal(
    result.yearCreated,
    false
  );

  assert.equal(
    result.file.path,
    destination
  );
});


test('draft staging failure cleans request-owned staging and never publishes canonical activity', async () => {
  const activityPath =
    `${TOPIC}/${YEAR}/${ACTIVITY}`;

  let stagingRoot = '';
  const deleted = [];
  const moved = [];

  const originalError =
    new Error(
      'simulated staging upload failure'
    );

  const service = new UploadService({
    archiveService: {
      async resolveActivityTopic() {
        return {
          name: TOPIC,
          path: TOPIC,
          type: 'topic',
        };
      },

      async createActivity() {
        throw new Error(
          'createActivity must not run'
        );
      },
    },

    dav: {
      async createFolder(path) {
        if (!stagingRoot) {
          stagingRoot =
            path;
        }

        assert.equal(
          path ===
            activityPath,
          false
        );
      },

      async upload() {
        throw originalError;
      },

      async move(
        source,
        destination
      ) {
        moved.push([
          source,
          destination,
        ]);
      },

      async delete(path) {
        deleted.push(path);
      },
    },
  });

  await assert.rejects(
    () =>
      service.uploadToDraftActivity({
        topic: TOPIC,
        year: YEAR,
        activityName:
          ACTIVITY,
        filename:
          'photo.jpg',
        content:
          JPEG,
      }),
    error =>
      error ===
        originalError
  );

  assert.deepEqual(
    moved,
    []
  );

  assert.deepEqual(
    deleted,
    [
      stagingRoot,
    ]
  );
});


test('draft publish failure must not expose an empty newly-created activity', async () => {
  const yearPath =
    `${TOPIC}/${YEAR}`;

  const activityPath =
    `${yearPath}/${ACTIVITY}`;

  let stagingRoot = '';

  let canonicalFolderCreated =
    false;

  const deleted = [];

  const publishError =
    new Error(
      'simulated atomic publish failure'
    );

  const service = new UploadService({
    archiveService: {
      async resolveActivityTopic() {
        return {
          name: TOPIC,
          path: TOPIC,
          type: 'topic',
        };
      },

      async createActivity() {
        canonicalFolderCreated =
          true;

        throw new Error(
          'createActivity must not run'
        );
      },
    },

    clock: () =>
      new Date(
        '2026-09-23T03:00:00.000Z'
      ),

    idFactory: () =>
      'noempty01',

    dav: {
      async createFolder(path) {
        if (!stagingRoot) {
          stagingRoot =
            path;
        }

        if (
          path ===
            yearPath ||
          path ===
            activityPath
        ) {
          canonicalFolderCreated =
            true;
        }
      },

      async upload() {},

      async move(
        source,
        destination
      ) {
        assert.equal(
          source,
          stagingRoot
        );

        assert.equal(
          destination,
          yearPath
        );

        // MOVE is the atomic materialization point.
        // Simulated failure means destination never became
        // visible.
        throw publishError;
      },

      async delete(path) {
        deleted.push(path);
      },
    },
  });

  await assert.rejects(
    () =>
      service.uploadToDraftActivity({
        topic: TOPIC,
        year: YEAR,
        activityName:
          ACTIVITY,
        filename:
          'photo.jpg',
        content:
          JPEG,
      }),
    error =>
      error ===
        publishError
  );

  assert.equal(
    canonicalFolderCreated,
    false,
    'failed atomic publish must not create canonical year/activity beforehand'
  );

  assert.deepEqual(
    deleted,
    [
      stagingRoot,
    ],
    'only request-owned staging may be cleaned'
  );
});


test('draft file publish conflict maps to UploadConflictError and only cleans staging', async () => {
  const yearPath =
    `${TOPIC}/${YEAR}`;

  const activityPath =
    `${yearPath}/${ACTIVITY}`;

  let stagingRoot = '';

  const deleted = [];

  const service = new UploadService({
    archiveService: {
      async resolveActivityTopic() {
        return {
          name: TOPIC,
          path: TOPIC,
          type: 'topic',
        };
      },
    },

    dav: {
      async createFolder(path) {
        if (!stagingRoot) {
          stagingRoot =
            path;
        }
      },

      async upload() {},

      async move(
        source,
        destination
      ) {
        if (
          destination ===
            yearPath ||
          destination ===
            activityPath
        ) {
          throw new WebDavError(
            'destination exists',
            412
          );
        }

        throw new WebDavError(
          'file exists',
          412
        );
      },

      async delete(path) {
        deleted.push(path);
      },
    },
  });

  await assert.rejects(
    () =>
      service.uploadToDraftActivity({
        topic: TOPIC,
        year: YEAR,
        activityName:
          ACTIVITY,
        filename:
          'photo.jpg',
        content:
          JPEG,
      }),
    UploadConflictError
  );

  assert.deepEqual(
    deleted,
    [
      stagingRoot,
    ]
  );

  assert.equal(
    deleted.includes(
      activityPath
    ),
    false
  );
});


test('draft publish failure preserves original error when staging cleanup fails', async () => {
  const originalError =
    new Error(
      'simulated publish failure'
    );

  const cleanupError =
    new Error(
      'simulated staging cleanup failure'
    );

  const service = new UploadService({
    archiveService: {
      async resolveActivityTopic() {
        return {
          name: TOPIC,
          path: TOPIC,
          type: 'topic',
        };
      },
    },

    dav: {
      async createFolder() {},

      async upload() {},

      async move() {
        throw originalError;
      },

      async delete() {
        throw cleanupError;
      },
    },
  });

  let thrown;

  try {
    await service.uploadToDraftActivity({
      topic: TOPIC,
      year: YEAR,
      activityName: ACTIVITY,
      filename: 'photo.jpg',
      content: JPEG,
    });
  } catch (error) {
    thrown =
      error;
  }

  assert.equal(
    thrown,
    originalError
  );

  assert.deepEqual(
    thrown.rollbackErrors,
    [
      cleanupError,
    ]
  );
});


test('inbox upload generates unique stored filename', async () => {
  let captured;

  const service = new UploadService({
    archiveService: archiveService(),

    inboxName: '00_INBOX_รอจัดหมวด',

    clock: () =>
      new Date('2026-09-21T08:00:00.000Z'),

    idFactory: () => 'a1b2c3d4',

    dav: {
      async upload(path, content, mime) {
        captured = {
          path,
          content,
          mime,
        };
      },
    },
  });

  const result = await service.uploadToInbox({
    filename: 'IMG_0001.png',
    content: JPEG,
  });

  assert.equal(
    result.originalName,
    'IMG_0001.jpg'
  );

  assert.equal(
    result.name,
    '20260921T080000Z_a1b2c3d4_IMG_0001.jpg'
  );

  assert.equal(
    result.path,
    '00_INBOX_รอจัดหมวด/' +
      '20260921T080000Z_a1b2c3d4_IMG_0001.jpg'
  );

  assert.equal(result.mime, 'image/jpeg');

  assert.equal(
    captured.path,
    result.path
  );

  assert.equal(
    captured.mime,
    'image/jpeg'
  );
});

test('inbox upload rejects unsupported content before PUT', async () => {
  let wrote = false;

  const service = new UploadService({
    archiveService: archiveService(),
    inboxName: '00_INBOX_รอจัดหมวด',

    dav: {
      async upload() {
        wrote = true;
      },
    },
  });

  await assert.rejects(
    () => service.uploadToInbox({
      filename: 'bad.jpg',
      content: Buffer.from('not-image'),
    }),
    /Unsupported or invalid image/
  );

  assert.equal(wrote, false);
});

test('inbox filename collision becomes HTTP conflict', async () => {
  const service = new UploadService({
    archiveService: archiveService(),

    inboxName: '00_INBOX_รอจัดหมวด',

    clock: () =>
      new Date('2026-09-21T08:00:00.000Z'),

    idFactory: () => 'same-id',

    dav: {
      async upload() {
        throw new WebDavError(
          'precondition failed',
          412
        );
      },
    },
  });

  await assert.rejects(
    () => service.uploadToInbox({
      filename: 'photo.jpg',
      content: JPEG,
    }),
    UploadConflictError
  );
});


test('organization upload writes directly to organization destination', async () => {
  let captured;

  const JPEG = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0,
    0x00, 0x10, 0x4a, 0x46,
  ]);

  const service = new UploadService({
    archiveService: {
      async listSelectableTopics() {
        return [
          {
            name: '80_งานกิจกรรมกลาง',
            path: '80_งานกิจกรรมกลาง',
            type: 'topic',
          },
          {
            name: '90_ภาพองค์กร',
            path: '90_ภาพองค์กร',
            type: 'organization',
          },
        ];
      },
    },

    dav: {
      async upload(path, content, mime) {
        captured = {
          path,
          content,
          mime,
        };
      },
    },
  });

  const result =
    await service.uploadToOrganization({
      filename: 'ตราสำนักงาน.png',
      content: JPEG,
    });

  assert.equal(
    result.name,
    'ตราสำนักงาน.jpg'
  );

  assert.equal(
    result.path,
    '90_ภาพองค์กร/ตราสำนักงาน.jpg'
  );

  assert.equal(
    result.mime,
    'image/jpeg'
  );

  assert.equal(
    captured.path,
    result.path
  );

  assert.equal(
    captured.content,
    JPEG
  );

  assert.equal(
    captured.mime,
    'image/jpeg'
  );
});

test('organization upload fails closed when organization destination is unavailable', async () => {
  let wrote = false;

  const JPEG = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0,
    0x00, 0x10, 0x4a, 0x46,
  ]);

  const service = new UploadService({
    archiveService: {
      async listSelectableTopics() {
        return [
          {
            name: '80_งานกิจกรรมกลาง',
            path: '80_งานกิจกรรมกลาง',
            type: 'topic',
          },
        ];
      },
    },

    dav: {
      async upload() {
        wrote = true;
      },
    },
  });

  await assert.rejects(
    () =>
      service.uploadToOrganization({
        filename: 'photo.jpg',
        content: JPEG,
      }),
    /organization/i
  );

  assert.equal(wrote, false);
});

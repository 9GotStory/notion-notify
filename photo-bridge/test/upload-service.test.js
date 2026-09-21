import test from 'node:test';
import assert from 'node:assert/strict';

import {
  UploadConflictError,
  UploadService,
} from '../src/upload-service.js';

import { WebDavError } from '../src/webdav-client.js';

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

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

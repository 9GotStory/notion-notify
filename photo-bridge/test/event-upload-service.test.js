import test from 'node:test';
import assert from 'node:assert/strict';

import {
  UploadService,
} from '../src/upload-service.js';

const TOPIC =
  '80_งานกิจกรรมกลาง';

const EVENT_DATE =
  '2026-09-03';

const ACTIVITY_NAME =
  'ประชุมประจำเดือน';

const YEAR =
  '2569';

const FOLDER_NAME =
  '2569-09-03_ประชุมประจำเดือน';

const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0,
  0x00, 0x10, 0x4a, 0x46,
]);

test(
  'draft upload derives canonical event from eventDate and activityName',
  async () => {
    const calls = [];

    let stagingRoot = '';
    let stagingActivity = '';
    let stagedFile = '';

    const service =
      new UploadService({
        archiveService: {
          async resolveActivityTopic(
            topic
          ) {
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
        },

        clock: () =>
          new Date(
            '2026-09-24T03:00:00.000Z'
          ),

        idFactory: () =>
          'eventdate1',

        dav: {
          async createFolder(path) {
            calls.push([
              'mkdir',
              path,
            ]);

            if (!stagingRoot) {
              stagingRoot = path;
            } else {
              stagingActivity = path;
            }
          },

          async upload(
            path,
            content,
            mime
          ) {
            stagedFile = path;

            calls.push([
              'upload',
              path,
              content,
              mime,
            ]);
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
              'successful year publish must not delete'
            );
          },
        },
      });

    const result =
      await service
        .uploadToDraftActivity({
          topic:
            TOPIC,

          // Semantic event input only.
          // No Buddhist year and no canonical
          // YYYY-MM-DD folder name come from UI.
          eventDate:
            EVENT_DATE,

          activityName:
            ACTIVITY_NAME,

          filename:
            'ภาพประชุม.png',

          content:
            JPEG,
        });

    assert.equal(
      stagingRoot.startsWith(
        `${TOPIC}/__PHOTO_DRAFT__`
      ),
      true
    );

    assert.equal(
      stagingActivity,
      `${stagingRoot}/${FOLDER_NAME}`
    );

    assert.equal(
      stagedFile,
      `${stagingActivity}/ภาพประชุม.jpg`
    );

    assert.deepEqual(
      calls.map(
        item => item[0]
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
        name:
          FOLDER_NAME,

        path:
          `${TOPIC}/${YEAR}/${FOLDER_NAME}`,
      }
    );

    assert.equal(
      result.file.path,
      `${TOPIC}/${YEAR}/${FOLDER_NAME}/ภาพประชุม.jpg`
    );
  }
);

test(
  'draft upload rejects invalid eventDate before any WebDAV write',
  async () => {
    let resolvedTopic = false;
    let wrote = false;

    const service =
      new UploadService({
        archiveService: {
          async resolveActivityTopic() {
            resolvedTopic = true;

            return {
              name: TOPIC,
              path: TOPIC,
              type: 'topic',
            };
          },
        },

        dav: {
          async createFolder() {
            wrote = true;
          },

          async upload() {
            wrote = true;
          },

          async move() {
            wrote = true;
          },

          async delete() {
            wrote = true;
          },
        },
      });

    await assert.rejects(
      () =>
        service
          .uploadToDraftActivity({
            topic:
              TOPIC,

            eventDate:
              '2026-02-29',

            activityName:
              ACTIVITY_NAME,

            filename:
              'photo.jpg',

            content:
              JPEG,
          }),

      /date|วันที่|invalid/i
    );

    assert.equal(
      resolvedTopic,
      false,
      'invalid event identity must fail before topic resolution'
    );

    assert.equal(
      wrote,
      false,
      'invalid event identity must fail before WebDAV writes'
    );
  }
);

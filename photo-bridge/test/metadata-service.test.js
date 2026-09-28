import test from 'node:test';
import assert from 'node:assert/strict';

const TOPIC =
  '80_งานกิจกรรมกลาง';

const YEAR =
  '2569';

const ACTIVITY =
  '2569-09-27_กิจกรรมตัวอย่าง';

const ORGANIZATION =
  '90_ภาพองค์กร';

const ARCHIVE =
  '99_ARCHIVE_คลังภาพเก่า';

const INBOX =
  '00_INBOX_รอจัดหมวด';

async function loadMetadataModule() {
  return import(
    '../src/metadata-service.js'
  );
}

function visibleTags() {
  return [
    {
      id: '7',
      name: 'NCD',
      userVisible: true,
      userAssignable: true,
    },

    {
      id: '8',
      name: 'Internal',
      userVisible: false,
      userAssignable: true,
    },

    {
      id: '9',
      name: 'ภาพประชาสัมพันธ์',
      userVisible: true,
      userAssignable: false,
    },
  ];
}

test(
  'MetadataService listTags exposes only user-visible Nextcloud tags',
  async () => {
    const {
      MetadataService,
    } =
      await loadMetadataModule();

    let calls = 0;

    const service =
      new MetadataService({
        dav: {
          async listSystemTags() {
            calls += 1;

            return visibleTags();
          },
        },
      });

    const tags =
      await service.listTags();

    assert.equal(
      calls,
      1
    );

    assert.deepEqual(
      tags,
      [
        {
          id: '7',
          name: 'NCD',
          userVisible: true,
          userAssignable: true,
        },

        {
          id: '9',
          name: 'ภาพประชาสัมพันธ์',
          userVisible: true,
          userAssignable: false,
        },
      ]
    );
  }
);

test(
  'MetadataService searchPhotos validates visible tags and uses one native AND search',
  async () => {
    const {
      MetadataService,
    } =
      await loadMetadataModule();

    let catalogCalls = 0;
    const searchCalls = [];

    const service =
      new MetadataService({
        dav: {
          async listSystemTags() {
            catalogCalls += 1;

            return visibleTags();
          },

          async searchFilesBySystemTags(
            tagIds,
            scope
          ) {
            searchCalls.push({
              tagIds,
              scope,
            });

            return [];
          },
        },
      });

    const files =
      await service.searchPhotos({
        tagIds: [
          ' 7 ',
          '9',
          '7',
        ],
      });

    assert.deepEqual(
      files,
      []
    );

    assert.equal(
      catalogCalls,
      1,
      'search must validate requested IDs against the visible catalog'
    );

    assert.deepEqual(
      searchCalls,
      [
        {
          tagIds: [
            '7',
            '9',
          ],

          scope:
            undefined,
        },
      ],
      'service must delegate one normalized multi-tag AND search'
    );
  }
);

test(
  'MetadataService searchPhotos returns only canonical durable photo locations',
  async () => {
    const {
      MetadataService,
    } =
      await loadMetadataModule();

    const activityPhoto =
      {
        name:
          'activity.jpg',

        path:
          `${TOPIC}/${YEAR}/${ACTIVITY}/activity.jpg`,

        mime:
          'image/jpeg',

        fileId:
          '101',
      };

    const organizationPhoto =
      {
        name:
          'logo.webp',

        path:
          `${ORGANIZATION}/logo.webp`,

        mime:
          'image/webp',

        fileId:
          '102',
      };

    const archivedPhoto =
      {
        name:
          'old.jpg',

        path:
          `${ARCHIVE}/${TOPIC}/${YEAR}/${ACTIVITY}/old.jpg`,

        mime:
          'image/jpeg',

        fileId:
          '103',
      };

    const service =
      new MetadataService({
        dav: {
          async listSystemTags() {
            return visibleTags();
          },

          async searchFilesBySystemTags() {
            return [
              activityPhoto,
              organizationPhoto,
              archivedPhoto,

              // Temporary Inbox must never be a
              // metadata search result.
              {
                name:
                  'inbox.jpg',

                path:
                  `${INBOX}/inbox.jpg`,

                mime:
                  'image/jpeg',

                fileId:
                  '201',
              },

              // Unknown top-level hierarchy.
              {
                name:
                  'unknown.jpg',

                path:
                  'TEMP/unknown.jpg',

                mime:
                  'image/jpeg',

                fileId:
                  '202',
              },

              // Topic exists, but this is not a
              // canonical year/activity/file shape.
              {
                name:
                  'staging.jpg',

                path:
                  `${TOPIC}/__PHOTO_DRAFT__/staging.jpg`,

                mime:
                  'image/jpeg',

                fileId:
                  '203',
              },

              // System tags may exist on arbitrary
              // Nextcloud nodes; Photo search is image-only.
              {
                name:
                  'notes.txt',

                path:
                  `${TOPIC}/${YEAR}/${ACTIVITY}/notes.txt`,

                mime:
                  'text/plain',

                fileId:
                  '204',
              },
            ];
          },
        },
      });

    const files =
      await service.searchPhotos({
        tagIds: ['7'],
      });

    assert.deepEqual(
      files,
      [
        {
          ...activityPhoto,

          location:
            'activity',

          topic:
            TOPIC,

          year:
            YEAR,

          activityName:
            ACTIVITY,
        },

        {
          ...organizationPhoto,

          location:
            'organization',
        },

        {
          ...archivedPhoto,

          location:
            'archive',

          topic:
            TOPIC,

          year:
            YEAR,

          activityName:
            ACTIVITY,
        },
      ]
    );
  }
);

test(
  'MetadataService rejects malformed tag input before any WebDAV access',
  async () => {
    const {
      MetadataInputError,
      MetadataService,
    } =
      await loadMetadataModule();

    let called = false;

    const service =
      new MetadataService({
        dav: {
          async listSystemTags() {
            called = true;
            return [];
          },

          async searchFilesBySystemTags() {
            called = true;
            return [];
          },
        },
      });

    const invalidInputs = [
      undefined,
      null,
      {},
      {
        tagIds: [],
      },
      {
        tagIds: '7',
      },
      {
        tagIds: [
          '../7',
        ],
      },
      {
        tagIds: [
          'abc',
        ],
      },
    ];

    for (
      const input
      of invalidInputs
    ) {
      await assert.rejects(
        () =>
          service.searchPhotos(
            input
          ),
        (error) => {
          assert.equal(
            error instanceof
              MetadataInputError,
            true
          );

          assert.equal(
            error.statusCode,
            400
          );

          return true;
        }
      );
    }

    assert.equal(
      called,
      false,
      'invalid semantic input must fail before WebDAV access'
    );
  }
);

test(
  'MetadataService rejects unknown or invisible tags before REPORT search',
  async () => {
    const {
      MetadataInputError,
      MetadataService,
    } =
      await loadMetadataModule();

    let searchCalled =
      false;

    const service =
      new MetadataService({
        dav: {
          async listSystemTags() {
            return visibleTags();
          },

          async searchFilesBySystemTags() {
            searchCalled =
              true;

            return [];
          },
        },
      });

    for (
      const tagId
      of [
        '8',
        '999',
      ]
    ) {
      await assert.rejects(
        () =>
          service.searchPhotos({
            tagIds: [
              tagId,
            ],
          }),
        (error) => {
          assert.equal(
            error instanceof
              MetadataInputError,
            true
          );

          assert.equal(
            error.statusCode,
            400
          );

          assert.match(
            error.message,
            /tag/i
          );

          return true;
        }
      );
    }

    assert.equal(
      searchCalled,
      false,
      'unavailable tag IDs must never reach the native REPORT search'
    );
  }
);

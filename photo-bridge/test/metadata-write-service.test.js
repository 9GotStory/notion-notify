import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MetadataInputError,
  MetadataService,
} from '../src/metadata-service.js';

const TOPIC =
  '80_งานกิจกรรมกลาง';

const YEAR =
  '2569';

const ACTIVITY =
  '2569-09-27_กิจกรรมตัวอย่าง';

const ACTIVITY_PARENT =
  `${TOPIC}/${YEAR}/${ACTIVITY}`;

const PHOTO_PATH =
  `${ACTIVITY_PARENT}/photo.jpg`;

const ORGANIZATION_PATH =
  '90_ภาพองค์กร/logo.webp';

const ARCHIVE_PATH =
  `99_ARCHIVE_คลังภาพเก่า/${TOPIC}/${YEAR}/${ACTIVITY}/old.jpg`;

const INBOX_PATH =
  '00_INBOX_รอจัดหมวด/inbox.jpg';

function actor(
  role
) {
  return {
    sub:
      `${role}-user`,

    role,
  };
}

function writableTag(
  overrides = {}
) {
  return {
    id:
      '7',

    name:
      'NCD',

    userVisible:
      true,

    userAssignable:
      true,

    canAssign:
      true,

    ...overrides,
  };
}

function photo(
  overrides = {}
) {
  return {
    name:
      'photo.jpg',

    path:
      PHOTO_PATH,

    mime:
      'image/jpeg',

    fileId:
      '42',

    ...overrides,
  };
}

function input(
  overrides = {}
) {
  return {
    actor:
      actor(
        'manager'
      ),

    fileId:
      '42',

    path:
      PHOTO_PATH,

    tagId:
      '7',

    ...overrides,
  };
}

test(
  'manager can assign an effective assignable tag to a verified active photo',
  async () => {
    const calls = [];

    const service =
      new MetadataService({
        dav: {
          async listFiles(
            relativePath
          ) {
            calls.push([
              'listFiles',
              relativePath,
            ]);

            assert.equal(
              relativePath,
              ACTIVITY_PARENT
            );

            return [
              photo(),
            ];
          },

          async listSystemTags() {
            calls.push([
              'listSystemTags',
            ]);

            return [
              writableTag(),
            ];
          },

          async listFileSystemTags(
            fileId
          ) {
            calls.push([
              'listFileSystemTags',
              fileId,
            ]);

            assert.equal(
              fileId,
              '42'
            );

            return [];
          },

          async assignSystemTag(
            fileId,
            tagId
          ) {
            calls.push([
              'assignSystemTag',
              fileId,
              tagId,
            ]);
          },
        },
      });

    assert.equal(
      typeof service.assignPhotoTag,
      'function',
      'MetadataService must expose assignPhotoTag'
    );

    const result =
      await service.assignPhotoTag(
        input()
      );

    assert.deepEqual(
      result,
      {
        changed:
          true,

        fileId:
          '42',

        tagId:
          '7',
      }
    );

    assert.deepEqual(
      calls,
      [
        [
          'listFiles',
          ACTIVITY_PARENT,
        ],

        [
          'listSystemTags',
        ],

        [
          'listFileSystemTags',
          '42',
        ],

        [
          'assignSystemTag',
          '42',
          '7',
        ],
      ],
      'service must verify target, tag capability, current relation state, then mutate'
    );
  }
);

test(
  'admin can remove an assigned tag from a verified active photo',
  async () => {
    const calls = [];

    const service =
      new MetadataService({
        dav: {
          async listFiles(
            relativePath
          ) {
            calls.push([
              'listFiles',
              relativePath,
            ]);

            return [
              photo(),
            ];
          },

          async listSystemTags() {
            calls.push([
              'listSystemTags',
            ]);

            return [
              writableTag(),
            ];
          },

          async listFileSystemTags(
            fileId
          ) {
            calls.push([
              'listFileSystemTags',
              fileId,
            ]);

            return [
              writableTag(),
            ];
          },

          async removeSystemTag(
            fileId,
            tagId
          ) {
            calls.push([
              'removeSystemTag',
              fileId,
              tagId,
            ]);
          },
        },
      });

    assert.equal(
      typeof service.removePhotoTag,
      'function',
      'MetadataService must expose removePhotoTag'
    );

    const result =
      await service.removePhotoTag(
        input({
          actor:
            actor(
              'admin'
            ),
        })
      );

    assert.deepEqual(
      result,
      {
        changed:
          true,

        fileId:
          '42',

        tagId:
          '7',
      }
    );

    assert.deepEqual(
      calls.at(-1),
      [
        'removeSystemTag',
        '42',
        '7',
      ]
    );
  }
);

test(
  'normal user is rejected before all WebDAV access',
  async () => {
    let davCalled =
      false;

    const dav =
      new Proxy(
        {},
        {
          get() {
            return async () => {
              davCalled =
                true;

              throw new Error(
                'DAV must not be reached'
              );
            };
          },
        }
      );

    const service =
      new MetadataService({
        dav,
      });

    assert.equal(
      typeof service.assignPhotoTag,
      'function'
    );

    assert.equal(
      typeof service.removePhotoTag,
      'function'
    );

    for (
      const method
      of [
        'assignPhotoTag',
        'removePhotoTag',
      ]
    ) {
      await assert.rejects(
        () =>
          service[method](
            input({
              actor:
                actor(
                  'user'
                ),
            })
          ),
        (error) => {
          assert.equal(
            error.statusCode,
            403
          );

          return true;
        }
      );
    }

    assert.equal(
      davCalled,
      false,
      'role policy must fail before any DAV read or write'
    );
  }
);

test(
  'malformed tag-write input fails before WebDAV access',
  async () => {
    let davCalled =
      false;

    const dav =
      new Proxy(
        {},
        {
          get() {
            return async () => {
              davCalled =
                true;

              throw new Error(
                'DAV must not be reached'
              );
            };
          },
        }
      );

    const service =
      new MetadataService({
        dav,
      });

    assert.equal(
      typeof service.assignPhotoTag,
      'function'
    );

    const invalidInputs = [
      undefined,
      null,
      {},
      input({
        fileId:
          '',
      }),
      input({
        fileId:
          '../42',
      }),
      input({
        fileId:
          'file-forty-two',
      }),
      input({
        tagId:
          '',
      }),
      input({
        tagId:
          '../7',
      }),
      input({
        tagId:
          'tag-seven',
      }),
      input({
        path:
          '',
      }),
      input({
        path:
          '../outside.jpg',
      }),
    ];

    for (
      const value
      of invalidInputs
    ) {
      await assert.rejects(
        () =>
          service.assignPhotoTag(
            value
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
      davCalled,
      false,
      'malformed semantic input must fail before DAV'
    );
  }
);

test(
  'metadata write rejects Inbox archive and unknown locations before WebDAV',
  async () => {
    let davCalled =
      false;

    const dav =
      new Proxy(
        {},
        {
          get() {
            return async () => {
              davCalled =
                true;

              throw new Error(
                'DAV must not be reached'
              );
            };
          },
        }
      );

    const service =
      new MetadataService({
        dav,
      });

    assert.equal(
      typeof service.assignPhotoTag,
      'function'
    );

    for (
      const path
      of [
        INBOX_PATH,
        ARCHIVE_PATH,
        'TEMP/photo.jpg',
      ]
    ) {
      await assert.rejects(
        () =>
          service.assignPhotoTag(
            input({
              path,
            })
          ),
        (error) => {
          assert.equal(
            error.statusCode,
            400
          );

          return true;
        }
      );
    }

    assert.equal(
      davCalled,
      false,
      'non-writable archive locations must fail before DAV access'
    );
  }
);

test(
  'metadata write binds client fileId to the canonical path before tag access',
  async () => {
    let listFilesCalls =
      0;

    let metadataDavCalled =
      false;

    const service =
      new MetadataService({
        dav: {
          async listFiles(
            relativePath
          ) {
            listFilesCalls += 1;

            assert.equal(
              relativePath,
              ACTIVITY_PARENT
            );

            // Same canonical path/name, but a
            // different stable Nextcloud file ID.
            return [
              photo({
                fileId:
                  '99',
              }),
            ];
          },

          async listSystemTags() {
            metadataDavCalled =
              true;

            return [];
          },

          async listFileSystemTags() {
            metadataDavCalled =
              true;

            return [];
          },

          async assignSystemTag() {
            metadataDavCalled =
              true;
          },
        },
      });

    assert.equal(
      typeof service.assignPhotoTag,
      'function'
    );

    await assert.rejects(
      () =>
        service.assignPhotoTag(
          input()
        )
    );

    assert.equal(
      listFilesCalls,
      1
    );

    assert.equal(
      metadataDavCalled,
      false,
      'tag catalog/state/mutation must not run when path-to-fileId binding fails'
    );
  }
);

test(
  'metadata write requires effective canAssign true and fails closed when capability is absent',
  async () => {
    for (
      const canAssign
      of [
        false,
        undefined,
      ]
    ) {
      let stateCalled =
        false;

      let mutationCalled =
        false;

      const tag =
        writableTag();

      if (
        canAssign ===
          undefined
      ) {
        delete tag.canAssign;
      } else {
        tag.canAssign =
          canAssign;
      }

      const service =
        new MetadataService({
          dav: {
            async listFiles() {
              return [
                photo(),
              ];
            },

            async listSystemTags() {
              return [
                tag,
              ];
            },

            async listFileSystemTags() {
              stateCalled =
                true;

              return [];
            },

            async assignSystemTag() {
              mutationCalled =
                true;
            },
          },
        });

      assert.equal(
        typeof service.assignPhotoTag,
        'function'
      );

      await assert.rejects(
        () =>
          service.assignPhotoTag(
            input()
          ),
        (error) => {
          assert.equal(
            error.statusCode,
            403
          );

          return true;
        }
      );

      assert.equal(
        stateCalled,
        false,
        'relation state must not be queried for an unassignable tag'
      );

      assert.equal(
        mutationCalled,
        false
      );
    }
  }
);

test(
  'metadata tag writes are idempotent at service layer',
  async () => {
    let assignCalls =
      0;

    const assignService =
      new MetadataService({
        dav: {
          async listFiles() {
            return [
              photo(),
            ];
          },

          async listSystemTags() {
            return [
              writableTag(),
            ];
          },

          async listFileSystemTags() {
            return [
              writableTag(),
            ];
          },

          async assignSystemTag() {
            assignCalls += 1;
          },
        },
      });

    assert.equal(
      typeof assignService.assignPhotoTag,
      'function'
    );

    const alreadyAssigned =
      await assignService
        .assignPhotoTag(
          input()
        );

    assert.deepEqual(
      alreadyAssigned,
      {
        changed:
          false,

        fileId:
          '42',

        tagId:
          '7',
      }
    );

    assert.equal(
      assignCalls,
      0,
      'assign must not PUT an already-present relation'
    );

    let removeCalls =
      0;

    const removeService =
      new MetadataService({
        dav: {
          async listFiles() {
            return [
              photo(),
            ];
          },

          async listSystemTags() {
            return [
              writableTag(),
            ];
          },

          async listFileSystemTags() {
            return [];
          },

          async removeSystemTag() {
            removeCalls += 1;
          },
        },
      });

    assert.equal(
      typeof removeService.removePhotoTag,
      'function'
    );

    const alreadyAbsent =
      await removeService
        .removePhotoTag(
          input({
            actor:
              actor(
                'admin'
              ),
          })
        );

    assert.deepEqual(
      alreadyAbsent,
      {
        changed:
          false,

        fileId:
          '42',

        tagId:
          '7',
      }
    );

    assert.equal(
      removeCalls,
      0,
      'remove must not DELETE an already-absent relation'
    );
  }
);

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WebDavClient,
} from '../src/webdav-client.js';

import {
  ManagerService,
} from '../src/manager-service.js';

import {
  createPhotoTicket,
} from '../src/photo-ticket.js';

import {
  handleHttpRequest,
} from '../src/http-handler.js';


const BASE_URL =
  'http://127.0.0.1:18088';

const USER =
  'songhealth-admin';

const PASSWORD =
  'test-password-not-real';

const ROOT =
  '/คลังภาพ สสอ.สอง';

const INBOX =
  '00_INBOX_รอจัดหมวด';

const SECRET =
  'manager-inbox-test-secret';


function mockResponse(
  status,
  body = ''
) {
  return {
    status,

    async text() {
      return body;
    },
  };
}


function client(fetchImpl) {
  return new WebDavClient({
    baseUrl: BASE_URL,
    user: USER,
    password: PASSWORD,
    root: ROOT,
    fetchImpl,
  });
}


function ticket(
  role = 'manager'
) {
  return createPhotoTicket(
    {
      sub: 'U123',
      staffKey: 'staff-001',
      role,
      iat: 1000,
      exp: 1300,
    },
    SECRET
  );
}


function request(
  path,
  bearer
) {
  const headers = {};

  if (bearer) {
    headers.authorization =
      `Bearer ${bearer}`;
  }

  return {
    method: 'GET',
    url: path,
    headers,
  };
}


const httpContext = {
  config: {
    ticketSecret: SECRET,
    ticketTtlSeconds: 300,
  },

  authOptions: {
    nowSeconds: 1100,
  },
};


// ---------- PMUI-P02-A manager Inbox discovery ----------

test(
  'WebDAV lists direct child files without exposing folders',
  async () => {
    let captured;

    const dav =
      client(
        async (
          url,
          options
        ) => {
          captured = {
            url,
            options,
          };

          const path =
            new URL(url).pathname;

          const filename =
            encodeURIComponent(
              '20260927T010203Z_abcd1234_photo.jpg'
            );

          const folder =
            encodeURIComponent(
              'unexpected-folder'
            );

          const nested =
            encodeURIComponent(
              'nested.jpg'
            );

          const xml =
            `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>${path}/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype>
          <d:collection />
        </d:resourcetype>
      </d:prop>
    </d:propstat>
  </d:response>

  <d:response>
    <d:href>${path}/${filename}</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype />
        <d:getcontenttype>image/jpeg</d:getcontenttype>
      </d:prop>
    </d:propstat>
  </d:response>

  <d:response>
    <d:href>${path}/${folder}/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype>
          <d:collection />
        </d:resourcetype>
      </d:prop>
    </d:propstat>
  </d:response>

  <d:response>
    <d:href>${path}/${folder}/${nested}</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype />
        <d:getcontenttype>image/jpeg</d:getcontenttype>
      </d:prop>
    </d:propstat>
  </d:response>
</d:multistatus>`;

          return mockResponse(
            207,
            xml
          );
        }
      );

    const files =
      await dav.listFiles(
        INBOX
      );

    assert.equal(
      captured.options.method,
      'PROPFIND'
    );

    assert.equal(
      captured.options.headers.depth,
      '1'
    );

    assert.deepEqual(
      files,
      [
        {
          name:
            '20260927T010203Z_abcd1234_photo.jpg',

          path:
            INBOX +
            '/20260927T010203Z_abcd1234_photo.jpg',

          mime:
            'image/jpeg',
        },
      ]
    );
  }
);


test(
  'ManagerService lists Inbox through the configured Inbox only',
  async () => {
    let listedPath = '';

    const expected = [
      {
        name:
          '20260927T010203Z_abcd1234_photo.jpg',

        path:
          INBOX +
          '/20260927T010203Z_abcd1234_photo.jpg',

        mime:
          'image/jpeg',
      },
    ];

    const service =
      new ManagerService({
        inboxName: INBOX,

        archiveService: {},

        dav: {
          async listFiles(
            path
          ) {
            listedPath =
              path;

            return expected;
          },
        },
      });

    const result =
      await service.listInbox();

    assert.equal(
      listedPath,
      INBOX
    );

    assert.deepEqual(
      result,
      expected
    );
  }
);


test(
  'manager can list Inbox files through manager endpoint',
  async () => {
    const expected = [
      {
        name:
          '20260927T010203Z_abcd1234_photo.jpg',

        path:
          INBOX +
          '/20260927T010203Z_abcd1234_photo.jpg',

        mime:
          'image/jpeg',
      },
    ];

    let called = false;

    const result =
      await handleHttpRequest(
        request(
          '/v1/manager/inbox',
          ticket('manager')
        ),

        {
          ...httpContext,

          managerService: {
            async listInbox() {
              called = true;
              return expected;
            },
          },
        }
      );

    assert.equal(
      result.status,
      200
    );

    assert.equal(
      called,
      true
    );

    assert.deepEqual(
      result.body,
      {
        ok: true,
        files: expected,
      }
    );
  }
);


test(
  'normal user cannot list manager Inbox',
  async () => {
    let called = false;

    const result =
      await handleHttpRequest(
        request(
          '/v1/manager/inbox',
          ticket('user')
        ),

        {
          ...httpContext,

          managerService: {
            async listInbox() {
              called = true;
              return [];
            },
          },
        }
      );

    assert.equal(
      result.status,
      403
    );

    assert.equal(
      called,
      false
    );
  }
);


test(
  'admin can list manager Inbox',
  async () => {
    const expected = [
      {
        name:
          '20260927T010203Z_abcd1234_photo.jpg',

        path:
          INBOX +
          '/20260927T010203Z_abcd1234_photo.jpg',

        mime:
          'image/jpeg',
      },
    ];

    let called = false;

    const result =
      await handleHttpRequest(
        request(
          '/v1/manager/inbox',
          ticket('admin')
        ),

        {
          ...httpContext,

          managerService: {
            async listInbox() {
              called = true;
              return expected;
            },
          },
        }
      );

    assert.equal(
      result.status,
      200
    );

    assert.equal(
      called,
      true
    );

    assert.deepEqual(
      result.body.files,
      expected
    );
  }
);


test(
  'manager Inbox requires authentication',
  async () => {
    let called = false;

    const result =
      await handleHttpRequest(
        request(
          '/v1/manager/inbox'
        ),

        {
          ...httpContext,

          managerService: {
            async listInbox() {
              called = true;
              return [];
            },
          },
        }
      );

    assert.equal(
      result.status,
      401
    );

    assert.equal(
      called,
      false
    );
  }
);

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WebDavClient,
  WebDavError,
} from '../src/webdav-client.js';

const BASE_URL =
  'http://127.0.0.1:18088';

const USER =
  'songhealth-admin';

const PASSWORD =
  'test-password-not-real';

const ROOT =
  '/คลังภาพ สสอ.สอง';

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

test(
  'listFiles exposes stable Nextcloud fileId',
  async () => {
    let captured;

    const relativePath =
      '80_งานกิจกรรมกลาง/2569/' +
      '2569-09-27_กิจกรรมตัวอย่าง';

    const filename =
      'ภาพกิจกรรม.jpg';

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

          const requestPath =
            new URL(url).pathname;

          const encodedFile =
            encodeURIComponent(
              filename
            );

          const xml =
            `<?xml version="1.0"?>
<d:multistatus
  xmlns:d="DAV:"
  xmlns:oc="http://owncloud.org/ns">
  <d:response>
    <d:href>${requestPath}/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype>
          <d:collection />
        </d:resourcetype>
      </d:prop>
    </d:propstat>
  </d:response>

  <d:response>
    <d:href>${requestPath}/${encodedFile}</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype />
        <d:getcontenttype>
          image/jpeg
        </d:getcontenttype>
        <oc:fileid>42</oc:fileid>
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
        relativePath
      );

    assert.equal(
      captured.options.method,
      'PROPFIND'
    );

    assert.match(
      String(
        captured.options.body ||
        ''
      ),
      /<(?:oc:)?fileid\b/u,
      'listFiles must request oc:fileid'
    );

    assert.deepEqual(
      files,
      [
        {
          name:
            filename,

          path:
            relativePath +
            '/' +
            filename,

          mime:
            'image/jpeg',

          fileId:
            '42',
        },
      ]
    );
  }
);

test(
  'listSystemTags reads native Nextcloud System Tags catalog',
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

          const xml =
            `<?xml version="1.0"?>
<d:multistatus
  xmlns:d="DAV:"
  xmlns:oc="http://owncloud.org/ns">
  <d:response>
    <d:href>
      /remote.php/dav/systemtags/
    </d:href>
    <d:propstat>
      <d:prop />
    </d:propstat>
  </d:response>

  <d:response>
    <d:href>
      /remote.php/dav/systemtags/7
    </d:href>
    <d:propstat>
      <d:prop>
        <oc:id>7</oc:id>
        <oc:display-name>
          NCD
        </oc:display-name>
        <oc:user-visible>
          true
        </oc:user-visible>
        <oc:user-assignable>
          true
        </oc:user-assignable>
      </d:prop>
    </d:propstat>
  </d:response>

  <d:response>
    <d:href>
      /remote.php/dav/systemtags/9
    </d:href>
    <d:propstat>
      <d:prop>
        <oc:id>9</oc:id>
        <oc:display-name>
          ภาพประชาสัมพันธ์
        </oc:display-name>
        <oc:user-visible>
          true
        </oc:user-visible>
        <oc:user-assignable>
          false
        </oc:user-assignable>
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

    assert.equal(
      typeof dav.listSystemTags,
      'function',
      'WebDavClient must expose listSystemTags()'
    );

    const tags =
      await dav.listSystemTags();

    assert.equal(
      captured.options.method,
      'PROPFIND'
    );

    assert.equal(
      captured.options.headers.depth,
      '1'
    );

    assert.match(
      captured.url,
      /\/remote\.php\/dav\/systemtags\/?$/u
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
          name:
            'ภาพประชาสัมพันธ์',
          userVisible: true,
          userAssignable: false,
        },
      ]
    );
  }
);

test(
  'listFileSystemTags reads tags related to one stable fileId',
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

          const xml =
            `<?xml version="1.0"?>
<d:multistatus
  xmlns:d="DAV:"
  xmlns:oc="http://owncloud.org/ns">
  <d:response>
    <d:href>
      /remote.php/dav/systemtags-relations/files/42/
    </d:href>
    <d:propstat>
      <d:prop />
    </d:propstat>
  </d:response>

  <d:response>
    <d:href>
      /remote.php/dav/systemtags-relations/files/42/7
    </d:href>
    <d:propstat>
      <d:prop>
        <oc:id>7</oc:id>
        <oc:display-name>
          NCD
        </oc:display-name>
        <oc:user-visible>
          true
        </oc:user-visible>
        <oc:user-assignable>
          true
        </oc:user-assignable>
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

    assert.equal(
      typeof dav.listFileSystemTags,
      'function',
      'WebDavClient must expose listFileSystemTags()'
    );

    const tags =
      await dav.listFileSystemTags(
        '42'
      );

    assert.equal(
      captured.options.method,
      'PROPFIND'
    );

    assert.equal(
      captured.options.headers.depth,
      '1'
    );

    assert.match(
      captured.url,
      /\/remote\.php\/dav\/systemtags-relations\/files\/42\/?$/u
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
      ]
    );
  }
);

test(
  'listFileSystemTags rejects unsafe fileId before network access',
  async () => {
    let called = false;

    const dav =
      client(
        async () => {
          called = true;

          return mockResponse(
            207
          );
        }
      );

    assert.equal(
      typeof dav.listFileSystemTags,
      'function',
      'WebDavClient must expose listFileSystemTags()'
    );

    await assert.rejects(
      () =>
        dav.listFileSystemTags(
          '../42'
        ),
      WebDavError
    );

    assert.equal(
      called,
      false
    );
  }
);

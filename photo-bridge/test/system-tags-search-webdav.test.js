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

function encodeSegments(
  ...segments
) {
  return segments
    .map(
      segment =>
        encodeURIComponent(
          segment
        )
    )
    .join('/');
}

test(
  'searchFilesBySystemTags sends all tags in one native REPORT for AND semantics',
  async () => {
    const calls = [];

    const dav =
      client(
        async (
          url,
          options
        ) => {
          calls.push({
            url,
            options,
          });

          return mockResponse(
            207,
            `<?xml version="1.0"?>
<d:multistatus
  xmlns:d="DAV:"
  xmlns:oc="http://owncloud.org/ns">
</d:multistatus>`
          );
        }
      );

    assert.equal(
      typeof dav.searchFilesBySystemTags,
      'function',
      'WebDavClient must expose searchFilesBySystemTags()'
    );

    const files =
      await dav.searchFilesBySystemTags(
        [
          '7',
          ' 9 ',
          '7',
        ]
      );

    assert.deepEqual(
      files,
      []
    );

    assert.equal(
      calls.length,
      1,
      'multi-tag search must use one REPORT request'
    );

    const {
      url,
      options,
    } =
      calls[0];

    assert.equal(
      options.method,
      'REPORT'
    );

    assert.match(
      url,
      /\/remote\.php\/dav\/files\/songhealth-admin\//u
    );

    assert.equal(
      url.includes(
        'systemtags-relations'
      ),
      false,
      'search must use native filter-files REPORT rather than per-file relations'
    );

    const body =
      String(
        options.body || ''
      );

    assert.match(
      body,
      /<oc:filter-files\b/u
    );

    const tagIds =
      [
        ...body.matchAll(
          /<oc:systemtag>([^<]+)<\/oc:systemtag>/gu
        ),
      ].map(
        match =>
          match[1]
      );

    assert.deepEqual(
      tagIds,
      [
        '7',
        '9',
      ],
      'tag IDs must be normalized and de-duplicated while preserving AND filters'
    );

    assert.match(
      body,
      /<oc:fileid\s*\/>/u
    );

    assert.match(
      body,
      /<d:getcontenttype\s*\/>/u
    );

    assert.match(
      body,
      /<d:resourcetype\s*\/>/u
    );
  }
);

test(
  'searchFilesBySystemTags returns nested files relative to PHOTO_ROOT and ignores collections',
  async () => {
    const topic =
      '80_งานกิจกรรมกลาง';

    const year =
      '2569';

    const activity =
      '2569-09-27_กิจกรรมตัวอย่าง';

    const filename =
      'ภาพกิจกรรม 01.jpg';

    const dav =
      client(
        async (
          url,
          options
        ) => {
          assert.equal(
            options.method,
            'REPORT'
          );

          const requestPath =
            new URL(url).pathname
              .replace(/\/+$/u, '');

          const nestedFile =
            requestPath +
            '/' +
            encodeSegments(
              topic,
              year,
              activity,
              filename
            );

          const nestedFolder =
            requestPath +
            '/' +
            encodeSegments(
              topic,
              year,
              activity
            );

          const outside =
            '/remote.php/dav/files/' +
            encodeURIComponent(USER) +
            '/' +
            encodeSegments(
              'นอกคลังภาพ',
              'leak.jpg'
            );

          const xml =
            `<?xml version="1.0"?>
<d:multistatus
  xmlns:d="DAV:"
  xmlns:oc="http://owncloud.org/ns">
  <d:response>
    <d:href>${nestedFolder}/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype>
          <d:collection />
        </d:resourcetype>
        <oc:fileid>40</oc:fileid>
      </d:prop>
    </d:propstat>
  </d:response>

  <d:response>
    <d:href>${nestedFile}</d:href>
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

  <d:response>
    <d:href>${outside}</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype />
        <d:getcontenttype>
          image/jpeg
        </d:getcontenttype>
        <oc:fileid>999</oc:fileid>
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
      typeof dav.searchFilesBySystemTags,
      'function',
      'WebDavClient must expose searchFilesBySystemTags()'
    );

    const files =
      await dav.searchFilesBySystemTags(
        [
          '7',
          '9',
        ]
      );

    assert.deepEqual(
      files,
      [
        {
          name:
            filename,

          path:
            topic +
            '/' +
            year +
            '/' +
            activity +
            '/' +
            filename,

          mime:
            'image/jpeg',

          fileId:
            '42',
        },
      ],
      'REPORT results must remain inside PHOTO_ROOT and collections must not appear as photo files'
    );
  }
);

test(
  'searchFilesBySystemTags can restrict REPORT to a safe subtree while retaining root-relative paths',
  async () => {
    const scope =
      '80_งานกิจกรรมกลาง/2569';

    const activity =
      '2569-09-27_กิจกรรมตัวอย่าง';

    const filename =
      'photo.webp';

    let capturedUrl = '';

    const dav =
      client(
        async (
          url,
          options
        ) => {
          capturedUrl =
            url;

          assert.equal(
            options.method,
            'REPORT'
          );

          const requestPath =
            new URL(url).pathname
              .replace(/\/+$/u, '');

          const nestedFile =
            requestPath +
            '/' +
            encodeSegments(
              activity,
              filename
            );

          const xml =
            `<?xml version="1.0"?>
<d:multistatus
  xmlns:d="DAV:"
  xmlns:oc="http://owncloud.org/ns">
  <d:response>
    <d:href>${nestedFile}</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype />
        <d:getcontenttype>
          image/webp
        </d:getcontenttype>
        <oc:fileid>88</oc:fileid>
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
      typeof dav.searchFilesBySystemTags,
      'function',
      'WebDavClient must expose searchFilesBySystemTags()'
    );

    const files =
      await dav.searchFilesBySystemTags(
        ['7'],
        scope
      );

    assert.equal(
      decodeURIComponent(
        new URL(
          capturedUrl
        ).pathname
      ).endsWith(
        '/คลังภาพ สสอ.สอง/' +
        scope
      ),
      true,
      'REPORT target must be scoped below PHOTO_ROOT'
    );

    assert.deepEqual(
      files,
      [
        {
          name:
            filename,

          path:
            scope +
            '/' +
            activity +
            '/' +
            filename,

          mime:
            'image/webp',

          fileId:
            '88',
        },
      ],
      'scoped REPORT results must still use PHOTO_ROOT-relative paths'
    );
  }
);

test(
  'searchFilesBySystemTags rejects invalid tags and unsafe scope before network access',
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
      typeof dav.searchFilesBySystemTags,
      'function',
      'WebDavClient must expose searchFilesBySystemTags()'
    );

    await assert.rejects(
      () =>
        dav.searchFilesBySystemTags(
          []
        ),
      WebDavError
    );

    await assert.rejects(
      () =>
        dav.searchFilesBySystemTags(
          '7'
        ),
      WebDavError
    );

    await assert.rejects(
      () =>
        dav.searchFilesBySystemTags(
          [
            '7',
            '../9',
          ]
        ),
      WebDavError
    );

    await assert.rejects(
      () =>
        dav.searchFilesBySystemTags(
          ['abc']
        ),
      WebDavError
    );

    await assert.rejects(
      () =>
        dav.searchFilesBySystemTags(
          ['7'],
          '../outside'
        ),
      WebDavError
    );

    assert.equal(
      called,
      false,
      'invalid tag IDs and unsafe scopes must fail before network access'
    );
  }
);

test(
  'scoped REPORT ignores responses outside the requested subtree',
  async () => {
    const scope =
      '80_งานกิจกรรมกลาง/2569';

    const inScopeActivity =
      '2569-09-27_กิจกรรมตัวอย่าง';

    const inScopeFilename =
      'inside.jpg';

    const outsideTopic =
      '01_งานบริหารทั่วไป';

    const outsideYear =
      '2569';

    const outsideActivity =
      '2569-09-27_กิจกรรมอื่น';

    const outsideFilename =
      'outside.jpg';

    const dav =
      client(
        async (
          url,
          options
        ) => {
          assert.equal(
            options.method,
            'REPORT'
          );

          const requestPath =
            new URL(url).pathname
              .replace(/\/+$/u, '');

          const rootPath =
            requestPath
              .split('/')
              .slice(
                0,
                -2
              )
              .join('/');

          const inScopeFile =
            requestPath +
            '/' +
            encodeSegments(
              inScopeActivity,
              inScopeFilename
            );

          const outsideScopeFile =
            rootPath +
            '/' +
            encodeSegments(
              outsideTopic,
              outsideYear,
              outsideActivity,
              outsideFilename
            );

          const xml =
            `<?xml version="1.0"?>
<d:multistatus
  xmlns:d="DAV:"
  xmlns:oc="http://owncloud.org/ns">
  <d:response>
    <d:href>${inScopeFile}</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype />
        <d:getcontenttype>
          image/jpeg
        </d:getcontenttype>
        <oc:fileid>101</oc:fileid>
      </d:prop>
    </d:propstat>
  </d:response>

  <d:response>
    <d:href>${outsideScopeFile}</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype />
        <d:getcontenttype>
          image/jpeg
        </d:getcontenttype>
        <oc:fileid>202</oc:fileid>
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
      await dav.searchFilesBySystemTags(
        ['7'],
        scope
      );

    assert.deepEqual(
      files,
      [
        {
          name:
            inScopeFilename,

          path:
            scope +
            '/' +
            inScopeActivity +
            '/' +
            inScopeFilename,

          mime:
            'image/jpeg',

          fileId:
            '101',
        },
      ],
      'a scoped REPORT must never surface results outside its requested subtree'
    );
  }
);

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WebDavClient,
  WebDavError,
} from '../src/webdav-client.js';

const BASE_URL = 'http://127.0.0.1:18088';
const USER = 'songhealth-admin';
const PASSWORD = 'test-password-not-real';
const ROOT = '/คลังภาพ สสอ.สอง';

function mockResponse(status, body = '') {
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

test('PROPFIND lists only child collections', async () => {
  let captured;

  const dav = client(async (url, options) => {
    captured = { url, options };

    const path = new URL(url).pathname;

    const topic =
      encodeURIComponent('80_งานกิจกรรมต้น');

    const file =
      encodeURIComponent('example.jpg');

    const xml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>${path}/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection /></d:resourcetype>
      </d:prop>
    </d:propstat>
  </d:response>

  <d:response>
    <d:href>${path}/${topic}/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection /></d:resourcetype>
      </d:prop>
    </d:propstat>
  </d:response>

  <d:response>
    <d:href>${path}/${file}</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype />
      </d:prop>
    </d:propstat>
  </d:response>
</d:multistatus>`;

    return mockResponse(207, xml);
  });

  const folders = await dav.listFolders();

  assert.equal(captured.options.method, 'PROPFIND');
  assert.equal(captured.options.headers.depth, '1');

  assert.deepEqual(folders, [
    {
      name: '80_งานกิจกรรมต้น',
      path: '80_งานกิจกรรมต้น',
    },
  ]);

  assert.match(
    captured.url,
    /remote\.php\/dav\/files\/songhealth-admin/
  );

  assert.equal(
    captured.url.includes('คลังภาพ สสอ.สอง'),
    false
  );
});

test('path traversal is rejected before network access', async () => {
  let called = false;

  const dav = client(async () => {
    called = true;
    return mockResponse(207);
  });

  await assert.rejects(
    () => dav.listFolders('../secret'),
    WebDavError
  );

  assert.equal(called, false);
});

test('MKCOL creates a folder through WebDAV', async () => {
  let captured;

  const dav = client(async (url, options) => {
    captured = { url, options };
    return mockResponse(201);
  });

  const result = await dav.createFolder(
    '80_งานกิจกรรมต้น/2569'
  );

  assert.equal(result, true);
  assert.equal(captured.options.method, 'MKCOL');

  assert.match(
    captured.url,
    /80_%E0%B8%87%E0%B8%B2%E0%B8%99/
  );
});

test('PUT uploads content with declared MIME type', async () => {
  let captured;

  const content = Buffer.from('test-image');

  const dav = client(async (url, options) => {
    captured = { url, options };
    return mockResponse(201);
  });

  const result = await dav.upload(
    '80_งานกิจกรรมต้น/2569/2569-09-03_กิจกรรม/test.jpg',
    content,
    'image/jpeg'
  );

  assert.equal(result, true);
  assert.equal(captured.options.method, 'PUT');
  assert.equal(
    captured.options.headers['content-type'],
    'image/jpeg'
  );
  assert.equal(captured.options.body, content);
});

test('MOVE sends encoded destination and disables overwrite', async () => {
  let captured;

  const dav = client(async (url, options) => {
    captured = { url, options };
    return mockResponse(201);
  });

  const result = await dav.move(
    '00_INBOX_รอจัดหมวด/test.jpg',
    '80_งานกิจกรรมต้น/2569/2569-09-03_กิจกรรม/test.jpg'
  );

  assert.equal(result, true);
  assert.equal(captured.options.method, 'MOVE');
  assert.equal(captured.options.headers.overwrite, 'F');

  assert.match(
    captured.options.headers.destination,
    /^http:\/\/127\.0\.0\.1:18088\/remote\.php\/dav\/files\//
  );

  assert.equal(
    captured.options.headers.destination.includes(
      'งานกิจกรรมต้น'
    ),
    false
  );
});

test('unexpected WebDAV status produces sanitized error', async () => {
  const dav = client(async () => {
    return mockResponse(
      500,
      `do not expose ${PASSWORD}`
    );
  });

  await assert.rejects(
    () => dav.createFolder('80_งานกิจกรรมต้น/2569'),
    (error) => {
      assert.equal(error instanceof WebDavError, true);
      assert.equal(error.statusCode, 500);
      assert.equal(
        error.message.includes(PASSWORD),
        false
      );
      assert.match(error.message, /status 500/);
      return true;
    }
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WebDavClient,
} from '../src/webdav-client.js';

function response(
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

test(
  'listSystemTags requests and exposes effective canAssign capability',
  async () => {
    const requests = [];

    const dav =
      new WebDavClient({
        baseUrl:
          'https://nextcloud.example',

        user:
          'photo-service',

        password:
          'test-secret',

        root:
          'คลังภาพ',

        fetchImpl:
          async (
            url,
            options
          ) => {
            requests.push({
              url,
              options,
            });

            return response(
              207,
              `<?xml version="1.0"?>
<d:multistatus
  xmlns:d="DAV:"
  xmlns:oc="http://owncloud.org/ns">

  <d:response>
    <d:href>
      /remote.php/dav/systemtags/7
    </d:href>

    <d:propstat>
      <d:prop>
        <oc:id>7</oc:id>
        <oc:display-name>
          Restricted but allowed
        </oc:display-name>
        <oc:user-visible>true</oc:user-visible>
        <oc:user-assignable>false</oc:user-assignable>
        <oc:can-assign>true</oc:can-assign>
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
          Visible but not allowed
        </oc:display-name>
        <oc:user-visible>true</oc:user-visible>
        <oc:user-assignable>true</oc:user-assignable>
        <oc:can-assign>false</oc:can-assign>
      </d:prop>
    </d:propstat>
  </d:response>

</d:multistatus>`
            );
          },
      });

    const tags =
      await dav.listSystemTags();

    assert.equal(
      requests.length,
      1
    );

    assert.equal(
      requests[0].options.method,
      'PROPFIND'
    );

    assert.match(
      requests[0].url,
      /\/remote\.php\/dav\/systemtags$/u
    );

    assert.match(
      String(
        requests[0].options.body
      ),
      /<oc:can-assign\s*\/>/u,
      'catalog PROPFIND must ask Nextcloud for effective assignment permission'
    );

    assert.deepEqual(
      tags,
      [
        {
          id:
            '7',

          name:
            'Restricted but allowed',

          userVisible:
            true,

          userAssignable:
            false,

          canAssign:
            true,
        },

        {
          id:
            '9',

          name:
            'Visible but not allowed',

          userVisible:
            true,

          userAssignable:
            true,

          canAssign:
            false,
        },
      ],
      'effective canAssign must remain distinct from intrinsic userAssignable'
    );
  }
);

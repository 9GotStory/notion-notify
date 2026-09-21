import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mkdtempSync,
  writeFileSync,
  rmSync,
} from 'node:fs';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConfig } from '../src/config.js';

function secretFixture() {
  const dir = mkdtempSync(
    join(tmpdir(), 'photo-bridge-config-')
  );

  const passwordFile = join(dir, 'nextcloud-password');
  const ticketFile = join(dir, 'ticket-secret');

  writeFileSync(passwordFile, 'test-app-password\n');
  writeFileSync(ticketFile, 'test-ticket-secret\n');

  return {
    dir,
    passwordFile,
    ticketFile,
  };
}

function envFor(fixture, overrides = {}) {
  return {
    PHOTO_NEXTCLOUD_URL: 'http://nextcloud',
    PHOTO_NEXTCLOUD_USER: 'songhealth-admin',
    PHOTO_NEXTCLOUD_PASSWORD_FILE: fixture.passwordFile,

    PHOTO_ROOT: '/คลังภาพ สสอ.สอง',
    PHOTO_INBOX: '00_INBOX_รอจัดหมวด',
    PHOTO_ARCHIVE: '99_ARCHIVE_คลังภาพเก่า',

    PHOTO_TICKET_SECRET_FILE: fixture.ticketFile,
    PHOTO_TICKET_TTL_SECONDS: '300',

    PHOTO_ALLOWED_ORIGIN:
      'https://9gotstory.github.io',

    ...overrides,
  };
}

test('container service alias nextcloud is allowed', () => {
  const fixture = secretFixture();

  try {
    const config = loadConfig(envFor(fixture));

    assert.equal(
      config.nextcloudUrl,
      'http://nextcloud'
    );

    assert.equal(
      config.nextcloudPassword,
      'test-app-password'
    );

    assert.equal(
      config.ticketSecret,
      'test-ticket-secret'
    );
  } finally {
    rmSync(fixture.dir, {
      recursive: true,
      force: true,
    });
  }
});

test('loopback URL remains allowed for host-side development', () => {
  const fixture = secretFixture();

  try {
    const config = loadConfig(
      envFor(fixture, {
        PHOTO_NEXTCLOUD_URL:
          'http://127.0.0.1:18088',
      })
    );

    assert.equal(
      config.nextcloudUrl,
      'http://127.0.0.1:18088'
    );
  } finally {
    rmSync(fixture.dir, {
      recursive: true,
      force: true,
    });
  }
});

test('arbitrary remote Nextcloud host is rejected', () => {
  const fixture = secretFixture();

  try {
    assert.throws(
      () => loadConfig(
        envFor(fixture, {
          PHOTO_NEXTCLOUD_URL:
            'https://example.com',
        })
      ),
      /approved internal host/
    );
  } finally {
    rmSync(fixture.dir, {
      recursive: true,
      force: true,
    });
  }
});

test('missing secret file fails closed', () => {
  const fixture = secretFixture();

  try {
    assert.throws(
      () => loadConfig(
        envFor(fixture, {
          PHOTO_NEXTCLOUD_PASSWORD_FILE:
            join(fixture.dir, 'missing'),
        })
      ),
      /Unable to read secret file/
    );
  } finally {
    rmSync(fixture.dir, {
      recursive: true,
      force: true,
    });
  }
});

test('default upload limit is 25 MiB', () => {
  const fixture = secretFixture();

  try {
    const env = envFor(fixture);
    delete env.PHOTO_MAX_UPLOAD_BYTES;

    const config = loadConfig(env);

    assert.equal(
      config.maxUploadBytes,
      26214400
    );
  } finally {
    rmSync(fixture.dir, {
      recursive: true,
      force: true,
    });
  }
});


test('allowed browser origin is normalized', () => {
  const fixture = secretFixture();

  try {
    const config = loadConfig(
      envFor(fixture, {
        PHOTO_ALLOWED_ORIGIN:
          'https://9gotstory.github.io/',
      })
    );

    assert.equal(
      config.allowedOrigin,
      'https://9gotstory.github.io'
    );
  } finally {
    rmSync(fixture.dir, {
      recursive: true,
      force: true,
    });
  }
});

test('missing allowed browser origin fails closed', () => {
  const fixture = secretFixture();

  try {
    const env = envFor(fixture);
    delete env.PHOTO_ALLOWED_ORIGIN;

    assert.throws(
      () => loadConfig(env),
      /Missing required configuration: PHOTO_ALLOWED_ORIGIN/
    );
  } finally {
    rmSync(fixture.dir, {
      recursive: true,
      force: true,
    });
  }
});

test('allowed browser origin must be a bare HTTPS origin', () => {
  const fixture = secretFixture();

  try {
    assert.throws(
      () => loadConfig(
        envFor(fixture, {
          PHOTO_ALLOWED_ORIGIN:
            'http://9gotstory.github.io',
        })
      ),
      /must be an HTTPS origin/
    );

    assert.throws(
      () => loadConfig(
        envFor(fixture, {
          PHOTO_ALLOWED_ORIGIN:
            'https://9gotstory.github.io/notion-notify/',
        })
      ),
      /must be an HTTPS origin/
    );

    assert.throws(
      () => loadConfig(
        envFor(fixture, {
          PHOTO_ALLOWED_ORIGIN:
            'https://9gotstory.github.io?x=1',
        })
      ),
      /must be an HTTPS origin/
    );
  } finally {
    rmSync(fixture.dir, {
      recursive: true,
      force: true,
    });
  }
});

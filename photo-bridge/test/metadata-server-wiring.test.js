import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const serverSource =
  fs.readFileSync(
    new URL(
      '../src/server.js',
      import.meta.url
    ),
    'utf8'
  );

test(
  'server composition wires MetadataService to the shared WebDAV client and HTTP context',
  () => {
    assert.match(
      serverSource,
      /import\s*\{\s*MetadataService\s*\}\s*from\s*['"]\.\/metadata-service\.js['"]\s*;/u,
      'server must import MetadataService'
    );

    assert.match(
      serverSource,
      /const\s+metadataService\s*=\s*new\s+MetadataService\s*\(\s*\{\s*dav\s*,?\s*\}\s*\)\s*;/u,
      'MetadataService must use the existing shared dav client'
    );

    const webDavConstructors =
      serverSource.match(
        /new\s+WebDavClient\s*\(/gu
      ) || [];

    assert.equal(
      webDavConstructors.length,
      1,
      'metadata wiring must not create a second WebDAV client'
    );

    const handlerCall =
      /handleHttpRequest\s*\(\s*\{[\s\S]*?\}\s*,\s*\{([\s\S]*?)\}\s*\)/u.exec(
        serverSource
      );

    assert.notEqual(
      handlerCall,
      null,
      'server must compose handleHttpRequest context'
    );

    assert.match(
      handlerCall[1],
      /\bmetadataService\s*,?/u,
      'server must pass metadataService into HTTP context'
    );
  }
);

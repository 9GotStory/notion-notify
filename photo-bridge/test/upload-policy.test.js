import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectImageMime,
  normalizeUploadFilename,
  validateImageUpload,
} from '../src/upload-policy.js';

test('JPEG content wins over misleading file extension', () => {
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0,
    0x00, 0x10, 0x4a, 0x46,
  ]);

  const result = validateImageUpload(
    'ภาพกิจกรรม.png',
    jpeg
  );

  assert.equal(result.mime, 'image/jpeg');
  assert.equal(
    result.filename,
    'ภาพกิจกรรม.jpg'
  );
});

test('PNG and WebP signatures are detected', () => {
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47,
    0x0d, 0x0a, 0x1a, 0x0a,
  ]);

  const webp = Buffer.alloc(12);
  webp.write('RIFF', 0, 'ascii');
  webp.write('WEBP', 8, 'ascii');

  assert.equal(
    detectImageMime(png),
    'image/png'
  );

  assert.equal(
    detectImageMime(webp),
    'image/webp'
  );
});

test('HEIC and AVIF brands are detected', () => {
  const heic = Buffer.alloc(24);
  heic.write('ftyp', 4, 'ascii');
  heic.write('heic', 8, 'ascii');

  const avif = Buffer.alloc(24);
  avif.write('ftyp', 4, 'ascii');
  avif.write('avif', 8, 'ascii');

  assert.equal(
    detectImageMime(heic),
    'image/heic'
  );

  assert.equal(
    detectImageMime(avif),
    'image/avif'
  );
});

test('unsafe filenames are rejected', () => {
  assert.throws(
    () => normalizeUploadFilename(
      '../photo.jpg',
      'image/jpeg'
    ),
    /Invalid upload filename/
  );

  assert.throws(
    () => normalizeUploadFilename(
      'folder/photo.jpg',
      'image/jpeg'
    ),
    /Invalid upload filename/
  );
});

test('unsupported content is rejected', () => {
  assert.throws(
    () => validateImageUpload(
      'photo.jpg',
      Buffer.from('not-an-image')
    ),
    /Unsupported or invalid image/
  );
});

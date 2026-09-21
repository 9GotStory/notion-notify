export class UploadPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UploadPolicyError';
    this.statusCode = 400;
  }
}

const MIME_EXTENSIONS = Object.freeze({
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/avif': '.avif',
});

const HEIC_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'hevm',
  'hevs',
]);

const AVIF_BRANDS = new Set([
  'avif',
  'avis',
]);

function asBuffer(content) {
  if (Buffer.isBuffer(content)) return content;

  if (content instanceof Uint8Array) {
    return Buffer.from(
      content.buffer,
      content.byteOffset,
      content.byteLength
    );
  }

  throw new UploadPolicyError(
    'Upload content must be binary'
  );
}

function isoBrands(buffer) {
  if (
    buffer.length < 12 ||
    buffer.toString('ascii', 4, 8) !== 'ftyp'
  ) {
    return [];
  }

  const brands = [
    buffer.toString('ascii', 8, 12),
  ];

  for (
    let offset = 16;
    offset + 4 <= Math.min(buffer.length, 64);
    offset += 4
  ) {
    brands.push(
      buffer.toString('ascii', offset, offset + 4)
    );
  }

  return brands;
}

export function detectImageMime(content) {
  const buffer = asBuffer(content);

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg';
  }

  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([
        0x89, 0x50, 0x4e, 0x47,
        0x0d, 0x0a, 0x1a, 0x0a,
      ])
    )
  ) {
    return 'image/png';
  }

  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  const brands = isoBrands(buffer);

  if (brands.some((brand) => HEIC_BRANDS.has(brand))) {
    return 'image/heic';
  }

  if (brands.some((brand) => AVIF_BRANDS.has(brand))) {
    return 'image/avif';
  }

  throw new UploadPolicyError(
    'Unsupported or invalid image content'
  );
}

export function normalizeUploadFilename(
  filename,
  mime
) {
  const value = String(filename || '')
    .trim()
    .normalize('NFC');

  if (
    !value ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\') ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new UploadPolicyError(
      'Invalid upload filename'
    );
  }

  if (value.length > 180) {
    throw new UploadPolicyError(
      'Upload filename is too long'
    );
  }

  const extension = MIME_EXTENSIONS[mime];

  if (!extension) {
    throw new UploadPolicyError(
      'Unsupported image MIME type'
    );
  }

  const dot = value.lastIndexOf('.');

  const base = (
    dot > 0
      ? value.slice(0, dot)
      : value
  )
    .replace(/[. ]+$/u, '')
    .trim();

  if (!base) {
    throw new UploadPolicyError(
      'Invalid upload filename'
    );
  }

  return `${base}${extension}`;
}

export function validateImageUpload(
  filename,
  content
) {
  const buffer = asBuffer(content);

  if (buffer.length === 0) {
    throw new UploadPolicyError(
      'Upload content is empty'
    );
  }

  const mime = detectImageMime(buffer);

  return Object.freeze({
    filename: normalizeUploadFilename(
      filename,
      mime
    ),
    mime,
    size: buffer.length,
  });
}

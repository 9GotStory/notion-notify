const DAV_PROPERTIES = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:resourcetype />
    <d:getcontenttype />
  </d:prop>
</d:propfind>`;

export class WebDavError extends Error {
  constructor(message, statusCode = null) {
    super(message);
    this.name = 'WebDavError';
    this.statusCode = statusCode;
  }
}

function normalizeRelativePath(value = '') {
  const raw = String(value)
    .normalize('NFC')
    .replace(/^\/+|\/+$/g, '');

  if (raw === '') return '';

  if (raw.includes('\\') || raw.includes('\0')) {
    throw new WebDavError('Invalid WebDAV path');
  }

  const segments = raw.split('/');

  for (const segment of segments) {
    if (
      segment === '' ||
      segment === '.' ||
      segment === '..'
    ) {
      throw new WebDavError('Invalid WebDAV path');
    }
  }

  return segments.join('/');
}

function encodePath(value) {
  const normalized = normalizeRelativePath(value);

  if (normalized === '') return '';

  return normalized
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function decodeXml(value) {
  return String(value)
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

function safeDecodePathname(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new WebDavError('Invalid WebDAV response path');
  }
}

function stripTrailingSlash(value) {
  return value.length > 1
    ? value.replace(/\/+$/, '')
    : value;
}

function parseCollectionResponses(xml, requestUrl, requestedRelativePath) {
  const results = [];
  const requestPath = stripTrailingSlash(
    safeDecodePathname(new URL(requestUrl).pathname)
  );

  const responsePattern =
    /<(?:[\w.-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?response>/gi;

  let match;

  while ((match = responsePattern.exec(xml)) !== null) {
    const block = match[1];

    const hrefMatch =
      /<(?:[\w.-]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?href>/i.exec(block);

    if (hrefMatch === null) continue;

    const isCollection =
      /<(?:[\w.-]+:)?collection\b[^>]*\/?>/i.test(block);

    if (isCollection === false) continue;

    const href = decodeXml(hrefMatch[1].trim());

    let pathname;
    try {
      pathname = new URL(href, requestUrl).pathname;
    } catch {
      continue;
    }

    const decodedPath = stripTrailingSlash(
      safeDecodePathname(pathname)
    );

    if (decodedPath === requestPath) continue;

    const prefix = `${requestPath}/`;

    if (decodedPath.startsWith(prefix) === false) continue;

    const childName = decodedPath
      .slice(prefix.length)
      .replace(/\/+$/, '');

    if (
      childName === '' ||
      childName.includes('/')
    ) {
      continue;
    }

    const name = childName.normalize('NFC');

    results.push({
      name,
      path: requestedRelativePath
        ? `${requestedRelativePath}/${name}`
        : name,
    });
  }

  return results;
}

export class WebDavClient {
  constructor(options) {
    if (!options || typeof options !== 'object') {
      throw new WebDavError('WebDAV options are required');
    }

    this.baseUrl = String(options.baseUrl || '')
      .replace(/\/+$/, '');

    this.user = String(options.user || '').trim();
    this.password = String(options.password || '');
    this.root = normalizeRelativePath(options.root || '');
    this.fetchImpl = options.fetchImpl || globalThis.fetch;

    if (!this.baseUrl) {
      throw new WebDavError('WebDAV baseUrl is required');
    }

    if (!this.user) {
      throw new WebDavError('WebDAV user is required');
    }

    if (!this.password) {
      throw new WebDavError('WebDAV password is required');
    }

    if (!this.root) {
      throw new WebDavError('WebDAV root is required');
    }

    if (typeof this.fetchImpl !== 'function') {
      throw new WebDavError('WebDAV fetch implementation is required');
    }

    const parsed = new URL(this.baseUrl);

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new WebDavError('WebDAV baseUrl must use http or https');
    }
  }

  url(relativePath = '') {
    const encodedUser = encodeURIComponent(this.user);
    const encodedRoot = encodePath(this.root);
    const encodedRelative = encodePath(relativePath);

    const suffix = encodedRelative
      ? `/${encodedRelative}`
      : '';

    return `${this.baseUrl}/remote.php/dav/files/${encodedUser}/${encodedRoot}${suffix}`;
  }

  authorizationHeader() {
    const token = Buffer
      .from(`${this.user}:${this.password}`, 'utf8')
      .toString('base64');

    return `Basic ${token}`;
  }

  async request(method, relativePath, options = {}) {
    const url = this.url(relativePath);

    const headers = {
      authorization: this.authorizationHeader(),
      ...options.headers,
    };

    const response = await this.fetchImpl(url, {
      method,
      headers,
      body: options.body,
    });

    const allowedStatuses = options.allowedStatuses || [200];

    if (allowedStatuses.includes(response.status) === false) {
      throw new WebDavError(
        `WebDAV ${method} failed with status ${response.status}`,
        response.status
      );
    }

    return {
      url,
      response,
    };
  }

  async listFolders(relativePath = '') {
    const normalized = normalizeRelativePath(relativePath);

    const { url, response } = await this.request(
      'PROPFIND',
      normalized,
      {
        headers: {
          depth: '1',
          'content-type': 'application/xml; charset=utf-8',
        },
        body: DAV_PROPERTIES,
        allowedStatuses: [207],
      }
    );

    const xml = await response.text();

    return parseCollectionResponses(
      xml,
      url,
      normalized
    );
  }

  async createFolder(relativePath) {
    const normalized = normalizeRelativePath(relativePath);

    if (!normalized) {
      throw new WebDavError('Folder path is required');
    }

    await this.request(
      'MKCOL',
      normalized,
      {
        allowedStatuses: [201],
      }
    );

    return true;
  }

  async upload(relativePath, content, contentType) {
    const normalized = normalizeRelativePath(relativePath);

    if (!normalized) {
      throw new WebDavError('Upload path is required');
    }

    await this.request(
      'PUT',
      normalized,
      {
        headers: {
          'content-type':
            String(contentType || 'application/octet-stream'),
        },
        body: content,
        allowedStatuses: [201, 204],
      }
    );

    return true;
  }

  async move(sourcePath, destinationPath, options = {}) {
    const source = normalizeRelativePath(sourcePath);
    const destination = normalizeRelativePath(destinationPath);

    if (!source || !destination) {
      throw new WebDavError(
        'Source and destination paths are required'
      );
    }

    await this.request(
      'MOVE',
      source,
      {
        headers: {
          destination: this.url(destination),
          overwrite: options.overwrite === true ? 'T' : 'F',
        },
        allowedStatuses: [201, 204],
      }
    );

    return true;
  }

  async delete(relativePath) {
    const normalized = normalizeRelativePath(relativePath);

    if (!normalized) {
      throw new WebDavError('Delete path is required');
    }

    await this.request(
      'DELETE',
      normalized,
      {
        allowedStatuses: [204],
      }
    );

    return true;
  }

}

const DAV_PROPERTIES = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind
  xmlns:d="DAV:"
  xmlns:oc="http://owncloud.org/ns">
  <d:prop>
    <d:resourcetype />
    <d:getcontenttype />
    <oc:fileid />
  </d:prop>
</d:propfind>`;

const SYSTEM_TAG_PROPERTIES = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind
  xmlns:d="DAV:"
  xmlns:oc="http://owncloud.org/ns">
  <d:prop>
    <oc:id />
    <oc:display-name />
    <oc:user-visible />
    <oc:user-assignable />
    <oc:can-assign />
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

function normalizeFileId(value) {
  const fileId =
    String(value || '').trim();

  if (!/^[0-9]+$/u.test(fileId)) {
    throw new WebDavError(
      'Invalid Nextcloud file ID'
    );
  }

  return fileId;
}

function xmlProperty(block, localName) {
  const pattern =
    new RegExp(
      '<(?:[\\w.-]+:)?' +
        localName +
        '\\b[^>]*>' +
        '([\\s\\S]*?)' +
        '<\\/(?:[\\w.-]+:)?' +
        localName +
        '>',
      'i'
    );

  const match =
    pattern.exec(
      String(block || '')
    );

  return match
    ? decodeXml(
        match[1].trim()
      )
    : '';
}

function xmlBoolean(value) {
  const normalized =
    String(value || '')
      .trim()
      .toLowerCase();

  return (
    normalized === 'true' ||
    normalized === '1'
  );
}

function parseSystemTagResponses(xml) {
  const results = [];

  const responsePattern =
    /<(?:[\w.-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?response>/gi;

  let match;

  while (
    (match =
      responsePattern.exec(xml)) !==
    null
  ) {
    const block =
      match[1];

    const id =
      xmlProperty(
        block,
        'id'
      ).trim();

    const name =
      xmlProperty(
        block,
        'display-name'
      )
        .trim()
        .normalize('NFC');

    const hasCanAssign =
      /<(?:[\w.-]+:)?can-assign\b[^>]*>/i.test(
        block
      );

    if (
      !/^[0-9]+$/u.test(id) ||
      !name
    ) {
      continue;
    }

    results.push({
      id,
      name,

      userVisible:
        xmlBoolean(
          xmlProperty(
            block,
            'user-visible'
          )
        ),

      userAssignable:
        xmlBoolean(
          xmlProperty(
            block,
            'user-assignable'
          )
        ),

      ...(
        hasCanAssign
          ? {
              canAssign:
                xmlBoolean(
                  xmlProperty(
                    block,
                    'can-assign'
                  )
                ),
            }
          : {}
      ),
    });
  }

  return results;
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

function parseFileResponses(
  xml,
  requestUrl,
  requestedRelativePath
) {
  const results = [];

  const requestPath =
    stripTrailingSlash(
      safeDecodePathname(
        new URL(requestUrl).pathname
      )
    );

  const responsePattern =
    /<(?:[\w.-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?response>/gi;

  let match;

  while (
    (match =
      responsePattern.exec(xml)) !==
    null
  ) {
    const block =
      match[1];

    const hrefMatch =
      /<(?:[\w.-]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?href>/i.exec(
        block
      );

    if (hrefMatch === null) {
      continue;
    }

    const isCollection =
      /<(?:[\w.-]+:)?collection\b[^>]*\/?>/i.test(
        block
      );

    if (isCollection) {
      continue;
    }

    const href =
      decodeXml(
        hrefMatch[1].trim()
      );

    let pathname;

    try {
      pathname =
        new URL(
          href,
          requestUrl
        ).pathname;
    } catch {
      continue;
    }

    const decodedPath =
      stripTrailingSlash(
        safeDecodePathname(
          pathname
        )
      );

    if (
      decodedPath ===
      requestPath
    ) {
      continue;
    }

    const prefix =
      `${requestPath}/`;

    if (
      !decodedPath.startsWith(
        prefix
      )
    ) {
      continue;
    }

    const childName =
      decodedPath.slice(
        prefix.length
      );

    if (
      !childName ||
      childName.includes('/')
    ) {
      continue;
    }

    const mimeMatch =
      /<(?:[\w.-]+:)?getcontenttype\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?getcontenttype>/i.exec(
        block
      );

    const fileIdMatch =
      /<(?:[\w.-]+:)?fileid\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?fileid>/i.exec(
        block
      );

    const fileId =
      fileIdMatch
        ? decodeXml(
            fileIdMatch[1].trim()
          )
        : '';

    results.push({
      name:
        childName.normalize(
          'NFC'
        ),

      path:
        requestedRelativePath
          ? (
              requestedRelativePath +
              '/' +
              childName.normalize(
                'NFC'
              )
            )
          : childName.normalize(
              'NFC'
            ),

      mime:
        mimeMatch
          ? decodeXml(
              mimeMatch[1].trim()
            )
          : '',

      ...(
        /^[0-9]+$/u.test(fileId)
          ? {
              fileId,
            }
          : {}
      ),
    });
  }

  return results;
}

function normalizeSystemTagIds(values) {
  if (
    !Array.isArray(values) ||
    values.length === 0
  ) {
    throw new WebDavError(
      'System tag IDs are required'
    );
  }

  const result = [];
  const seen = new Set();

  for (const value of values) {
    const id =
      String(value ?? '').trim();

    if (!/^[0-9]+$/u.test(id)) {
      throw new WebDavError(
        'Invalid Nextcloud system tag ID'
      );
    }

    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    result.push(id);
  }

  return result;
}

function parseSystemTagSearchResponses(
  xml,
  rootUrl,
  requestedScope = ''
) {
  const results = [];

  const normalizedScope =
    normalizeRelativePath(
      requestedScope
    );

  const rootPath =
    stripTrailingSlash(
      safeDecodePathname(
        new URL(rootUrl).pathname
      )
    );

  const responsePattern =
    /<(?:[\w.-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?response>/gi;

  let match;

  while (
    (match =
      responsePattern.exec(xml)) !==
    null
  ) {
    const block =
      match[1];

    const hrefMatch =
      /<(?:[\w.-]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?href>/i.exec(
        block
      );

    if (!hrefMatch) {
      continue;
    }

    const isCollection =
      /<(?:[\w.-]+:)?collection\b[^>]*\/?>/i.test(
        block
      );

    if (isCollection) {
      continue;
    }

    const href =
      decodeXml(
        hrefMatch[1].trim()
      );

    let pathname;

    try {
      pathname =
        new URL(
          href,
          rootUrl
        ).pathname;
    } catch {
      continue;
    }

    const decodedPath =
      stripTrailingSlash(
        safeDecodePathname(
          pathname
        )
      );

    const prefix =
      `${rootPath}/`;

    if (
      !decodedPath.startsWith(
        prefix
      )
    ) {
      continue;
    }

    const relative =
      decodedPath.slice(
        prefix.length
      );

    if (!relative) {
      continue;
    }

    let relativePath;

    try {
      relativePath =
        normalizeRelativePath(
          relative
        );
    } catch {
      throw new WebDavError(
        'Invalid WebDAV search response'
      );
    }

    if (
      normalizedScope &&
      relativePath !==
        normalizedScope &&
      !relativePath.startsWith(
        normalizedScope + '/'
      )
    ) {
      continue;
    }

    const segments =
      relativePath.split('/');

    const name =
      segments[
        segments.length - 1
      ];

    const fileId =
      xmlProperty(
        block,
        'fileid'
      ).trim();

    if (
      !/^[0-9]+$/u.test(
        fileId
      )
    ) {
      throw new WebDavError(
        'Invalid WebDAV search response'
      );
    }

    const mime =
      xmlProperty(
        block,
        'getcontenttype'
      ).trim();

    results.push({
      name,
      path:
        relativePath,
      mime,
      fileId,
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

  davUrl(relativePath = '') {
    const encodedRelative =
      encodePath(relativePath);

    const suffix =
      encodedRelative
        ? `/${encodedRelative}`
        : '';

    return `${this.baseUrl}/remote.php/dav${suffix}`;
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

  async requestDav(
    method,
    relativePath,
    options = {}
  ) {
    const url =
      this.davUrl(
        relativePath
      );

    const headers = {
      authorization:
        this.authorizationHeader(),

      ...options.headers,
    };

    const response =
      await this.fetchImpl(
        url,
        {
          method,
          headers,
          body: options.body,
        }
      );

    const allowedStatuses =
      options.allowedStatuses ||
      [200];

    if (
      !allowedStatuses.includes(
        response.status
      )
    ) {
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

  async listFiles(relativePath = '') {
    const normalized =
      normalizeRelativePath(
        relativePath
      );

    const {
      url,
      response,
    } =
      await this.request(
        'PROPFIND',
        normalized,
        {
          headers: {
            depth: '1',
            'content-type':
              'application/xml; charset=utf-8',
          },

          body:
            DAV_PROPERTIES,

          allowedStatuses: [
            207,
          ],
        }
      );

    const xml =
      await response.text();

    return parseFileResponses(
      xml,
      url,
      normalized
    );
  }

  async listSystemTags() {
    const {
      response,
    } =
      await this.requestDav(
        'PROPFIND',
        'systemtags',
        {
          headers: {
            depth: '1',

            'content-type':
              'application/xml; charset=utf-8',
          },

          body:
            SYSTEM_TAG_PROPERTIES,

          allowedStatuses: [
            207,
          ],
        }
      );

    const xml =
      await response.text();

    return parseSystemTagResponses(
      xml
    );
  }

  async listFileSystemTags(fileId) {
    const normalizedFileId =
      normalizeFileId(fileId);

    const {
      response,
    } =
      await this.requestDav(
        'PROPFIND',
        (
          'systemtags-relations/files/' +
          normalizedFileId
        ),
        {
          headers: {
            depth: '1',

            'content-type':
              'application/xml; charset=utf-8',
          },

          body:
            SYSTEM_TAG_PROPERTIES,

          allowedStatuses: [
            207,
          ],
        }
      );

    const xml =
      await response.text();

    return parseSystemTagResponses(
      xml
    );
  }

  async assignSystemTag(
    fileId,
    tagId
  ) {
    const normalizedFileId =
      normalizeFileId(
        fileId
      );

    const [
      normalizedTagId,
    ] =
      normalizeSystemTagIds(
        [
          tagId,
        ]
      );

    await this.requestDav(
      'PUT',
      (
        'systemtags-relations/files/' +
        normalizedFileId +
        '/' +
        normalizedTagId
      ),
      {
        allowedStatuses: [
          201,
        ],
      }
    );
  }

  async removeSystemTag(
    fileId,
    tagId
  ) {
    const normalizedFileId =
      normalizeFileId(
        fileId
      );

    const [
      normalizedTagId,
    ] =
      normalizeSystemTagIds(
        [
          tagId,
        ]
      );

    await this.requestDav(
      'DELETE',
      (
        'systemtags-relations/files/' +
        normalizedFileId +
        '/' +
        normalizedTagId
      ),
      {
        allowedStatuses: [
          204,
        ],
      }
    );
  }

  async searchFilesBySystemTags(
    tagIds,
    scope = ''
  ) {
    const normalizedTagIds =
      normalizeSystemTagIds(
        tagIds
      );

    const normalizedScope =
      normalizeRelativePath(
        scope
      );

    const tagFilters =
      normalizedTagIds
        .map(
          id =>
            `    <oc:systemtag>${id}</oc:systemtag>`
        )
        .join('\n');

    const body =
      `<?xml version="1.0" encoding="utf-8" ?>
<oc:filter-files
  xmlns:d="DAV:"
  xmlns:oc="http://owncloud.org/ns"
  xmlns:nc="http://nextcloud.org/ns">
  <d:prop>
    <oc:fileid />
    <d:getcontenttype />
    <d:resourcetype />
  </d:prop>
  <oc:filter-rules>
${tagFilters}
  </oc:filter-rules>
</oc:filter-files>`;

    const {
      response,
    } =
      await this.request(
        'REPORT',
        normalizedScope,
        {
          headers: {
            'content-type':
              'application/xml; charset=utf-8',
          },

          body,

          allowedStatuses: [
            207,
          ],
        }
      );

    const xml =
      await response.text();

    return parseSystemTagSearchResponses(
      xml,
      this.url(),
      normalizedScope
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

  async upload(
    relativePath,
    content,
    contentType,
    options = {}
  ) {
    const normalized = normalizeRelativePath(relativePath);

    if (!normalized) {
      throw new WebDavError('Upload path is required');
    }

    const overwrite =
      options.overwrite === true;

    const headers = {
      'content-type':
        String(contentType || 'application/octet-stream'),
    };

    if (!overwrite) {
      headers['if-none-match'] = '*';
    }

    await this.request(
      'PUT',
      normalized,
      {
        headers,
        body: content,
        allowedStatuses:
          overwrite
            ? [201, 204]
            : [201],
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

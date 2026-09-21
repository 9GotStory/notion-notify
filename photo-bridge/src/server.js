import http from 'node:http';

import { ArchiveService } from './archive-service.js';
import { authenticateRequest } from './auth.js';
import { loadConfig } from './config.js';
import { handleHttpRequest } from './http-handler.js';
import { UploadService } from './upload-service.js';
import { WebDavClient } from './webdav-client.js';

const config = loadConfig();

const dav = new WebDavClient({
  baseUrl: config.nextcloudUrl,
  user: config.nextcloudUser,
  password: config.nextcloudPassword,
  root: config.root,
});

const archiveService = new ArchiveService({
  dav,
});

const uploadService = new UploadService({
  dav,
  archiveService,
});

const host = process.env.PHOTO_LISTEN_HOST || '127.0.0.1';
const port = Number(process.env.PHOTO_LISTEN_PORT || 18089);

async function readBody(req, maxBytes) {
  const declared = Number(
    req.headers['content-length'] || 0
  );

  if (
    Number.isFinite(declared) &&
    declared > maxBytes
  ) {
    const error = new Error('Request body too large');
    error.statusCode = 413;
    throw error;
  }

  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;

    if (size > maxBytes) {
      const error = new Error('Request body too large');
      error.statusCode = 413;
      throw error;
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function readJsonBody(req, maxBytes = 16384) {
  const buffer = await readBody(req, maxBytes);

  if (buffer.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    const error = new Error('Invalid JSON body');
    error.statusCode = 400;
    throw error;
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type':
      'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });

  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    const method =
      String(req.method || 'GET').toUpperCase();

    const url = new URL(
      req.url || '/',
      'http://localhost'
    );

    let body;

    const protectedWrite =
      method === 'POST' &&
      (
        url.pathname === '/v1/activities' ||
        url.pathname === '/v1/uploads'
      );

    // Reject unauthorized writes before reading request bodies.
    // This is especially important for binary uploads.
    if (protectedWrite) {
      authenticateRequest(
        req.headers,
        config
      );
    }

    if (
      method === 'POST' &&
      url.pathname === '/v1/activities'
    ) {
      body = await readJsonBody(req);
    }

    if (
      method === 'POST' &&
      url.pathname === '/v1/uploads'
    ) {
      body = await readBody(
        req,
        config.maxUploadBytes
      );
    }

    const result = await handleHttpRequest(
      {
        method,
        url: req.url,
        headers: req.headers,
        body,
      },
      {
        config,
        archiveService,
        uploadService,
      }
    );

    sendJson(
      res,
      result.status,
      result.body
    );
  } catch (error) {
    if (
      error.statusCode === 400 ||
      error.statusCode === 401 ||
      error.statusCode === 413
    ) {
      sendJson(res, error.statusCode, {
        ok: false,
        error: error.message,
      });

      return;
    }

    sendJson(res, 500, {
      ok: false,
      error: 'Internal server error',
    });
  }
});

server.listen(port, host, () => {
  process.stdout.write(
    `photo-bridge listening on http://${host}:${port}\n`
  );
});

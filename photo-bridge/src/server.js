import http from 'node:http';

import { ArchiveService } from './archive-service.js';
import { loadConfig } from './config.js';
import { handleHttpRequest } from './http-handler.js';
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

const host = process.env.PHOTO_LISTEN_HOST || '127.0.0.1';
const port = Number(process.env.PHOTO_LISTEN_PORT || 18089);

const server = http.createServer(async (req, res) => {
  const result = await handleHttpRequest(
    {
      method: req.method,
      url: req.url,
      headers: req.headers,
    },
    {
      config,
      archiveService,
    }
  );

  res.writeHead(result.status, result.headers);
  res.end(JSON.stringify(result.body));
});

server.listen(port, host, () => {
  process.stdout.write(
    `photo-bridge listening on http://${host}:${port}\n`
  );
});

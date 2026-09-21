import http from 'node:http';

import { loadConfig } from './config.js';
import { handleHttpRequest } from './http-handler.js';

const config = loadConfig();

const host = process.env.PHOTO_LISTEN_HOST || '127.0.0.1';
const port = Number(process.env.PHOTO_LISTEN_PORT || 18089);

const server = http.createServer((req, res) => {
  const result = handleHttpRequest(
    {
      method: req.method,
      url: req.url,
      headers: req.headers,
    },
    { config }
  );

  res.writeHead(result.status, result.headers);
  res.end(JSON.stringify(result.body));
});

server.listen(port, host, () => {
  process.stdout.write(
    `photo-bridge listening on http://${host}:${port}\n`
  );
});

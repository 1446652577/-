const http = require('http');
const crypto = require('crypto');

if (!process.env.TENCENTCLOUD_SECRETID && process.env.TENCENT_SECRET_ID) {
  process.env.TENCENTCLOUD_SECRETID = process.env.TENCENT_SECRET_ID;
}
if (!process.env.TENCENTCLOUD_SECRETKEY && process.env.TENCENT_SECRET_KEY) {
  process.env.TENCENTCLOUD_SECRETKEY = process.env.TENCENT_SECRET_KEY;
}

const { main: parseDocument } = require('../../cloudfunctions/parseDocument/index.js');

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const TOKEN_SECRET = process.env.PARSE_RUN_TOKEN_SECRET || '';
const TOKEN_MAX_AGE_MS = 60 * 60 * 1000;
const MAX_BODY_BYTES = 256 * 1024;

function getHeader(req, name) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function isAuthorized(req, body) {
  if (!TOKEN_SECRET || !body || !body.openid) return false;

  const timestamp = getHeader(req, 'x-parse-timestamp');
  const token = getHeader(req, 'x-parse-token');
  const timestampNumber = Number(timestamp);
  if (!timestamp || !token || !Number.isFinite(timestampNumber)) return false;
  if (Math.abs(Date.now() - timestampNumber) > TOKEN_MAX_AGE_MS) return false;

  const expected = crypto.createHmac('sha256', TOKEN_SECRET)
    .update(`${timestamp}.${body.openid}`)
    .digest('hex');
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(String(token));
  return expectedBuffer.length === actualBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      raw += chunk;
      if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': '*',
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type,x-parse-token,x-parse-timestamp',
      'access-control-allow-methods': 'POST,OPTIONS',
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/healthz') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/') {
    sendJson(res, 404, { code: -1, message: 'not found' });
    return;
  }

  try {
    const event = await readJson(req);
    if (!isAuthorized(req, event)) {
      sendJson(res, 401, { code: -1, message: 'unauthorized' });
      return;
    }

    const result = await parseDocument(event, { requestId: req.headers['x-request-id'] || '' });
    sendJson(res, 200, result);
  } catch (err) {
    console.error('[parseDocument-run]', err);
    sendJson(res, 500, { code: -1, message: err.message || 'service error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[parseDocument-run] listening on ${PORT}`);
});

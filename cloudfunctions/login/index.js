const cloud = require('wx-server-sdk');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const PARSE_RUN_TOKEN_SECRET = process.env.PARSE_RUN_TOKEN_SECRET || '';

function createParseAuth(openid) {
  if (!PARSE_RUN_TOKEN_SECRET) return null;
  const timestamp = Date.now().toString();
  const token = crypto.createHmac('sha256', PARSE_RUN_TOKEN_SECRET)
    .update(`${timestamp}.${openid}`)
    .digest('hex');
  return { token, timestamp };
}

exports.main = async (event, context) => {
  const { OPENID: openid } = cloud.getWXContext();
  if (!openid) return { code: -1, message: '无法获取用户身份' };
  const parseAuth = createParseAuth(openid);
  return { code: 0, openid, ...(parseAuth ? { parseAuth } : {}) };
};

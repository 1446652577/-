const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event, context) => {
  const { OPENID: openid } = cloud.getWXContext();
  if (!openid) return { code: -1, message: '无法获取用户身份' };
  return { code: 0, openid };
};

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { openid } = event;
  if (!openid) return { code: -1, message: '缺少openid' };

  try {
    const userRes = await db.collection('users').where({ openid }).get();
    if (userRes.data.length === 0) return { code: -1, message: '用户不存在' };
    
    const user = userRes.data[0];
    if (user.quota <= 0) return { code: -1, message: '额度不足' };
    
    await db.collection('users').doc(user._id).update({
      data: {
        quota: db.command.inc(-1),
        totalUsed: db.command.inc(1),
      }
    });
    
    return { code: 0, data: { quota: user.quota - 1 } };
  } catch (err) {
    return { code: -1, message: err.message };
  }
};

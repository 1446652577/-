const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { openid, count = 3 } = event;
  if (!openid) return { code: -1, message: '缺少openid' };

  try {
    const userRes = await db.collection('users').where({ openid }).get();
    if (userRes.data.length === 0) {
      // 创建新用户并加额度
      await db.collection('users').add({
        data: {
          openid,
          quota: count,
          totalUsed: 0,
          totalEarned: count,
          lastLoginTime: db.serverDate(),
          createTime: db.serverDate(),
        }
      });
      return { code: 0, data: { quota: count } };
    }
    
    const user = userRes.data[0];
    await db.collection('users').doc(user._id).update({
      data: {
        quota: db.command.inc(count),
        totalEarned: db.command.inc(count),
      }
    });
    
    return { code: 0, data: { quota: user.quota + count } };
  } catch (err) {
    return { code: -1, message: err.message };
  }
};

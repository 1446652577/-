const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const REWARD_COUNT = 3;

exports.main = async (event, context) => {
  const { OPENID: openid } = cloud.getWXContext();
  if (!openid) return { code: -1, message: '缺少openid' };

  try {
    const userRes = await db.collection('users').where({ openid }).get();
    if (userRes.data.length === 0) {
      // 创建新用户并加额度
      await db.collection('users').add({
        data: {
          openid,
          quota: REWARD_COUNT,
          totalUsed: 0,
          totalEarned: REWARD_COUNT,
          lastLoginTime: db.serverDate(),
          createTime: db.serverDate(),
        }
      });
      return { code: 0, data: { quota: REWARD_COUNT } };
    }
    
    const user = userRes.data[0];
    await db.collection('users').doc(user._id).update({
      data: {
        quota: db.command.inc(REWARD_COUNT),
        totalEarned: db.command.inc(REWARD_COUNT),
      }
    });
    
    return { code: 0, data: { quota: user.quota + REWARD_COUNT } };
  } catch (err) {
    return { code: -1, message: err.message };
  }
};

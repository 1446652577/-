const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID: openid } = cloud.getWXContext();
  if (!openid) return { code: -1, message: '缺少openid' };

  try {
    const userRes = await db.collection('users').where({ openid }).get();
    
    if (userRes.data.length === 0) {
      // 新用户，创建记录
      const newUser = {
        openid,
        quota: 3, // 新用户送3次
        totalUsed: 0,
        totalEarned: 3,
        lastLoginTime: db.serverDate(),
        createTime: db.serverDate(),
      };
      await db.collection('users').add({ data: newUser });
      return { code: 0, data: newUser };
    } else {
      const user = userRes.data[0];
      // 检查是否是今天首次登录
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const lastLogin = user.lastLoginTime ? new Date(user.lastLoginTime) : null;
      
      if (!lastLogin || lastLogin < today) {
        // 今日首次登录，赠送1次
        await db.collection('users').doc(user._id).update({
          data: {
            quota: db.command.inc(1),
            totalEarned: db.command.inc(1),
            lastLoginTime: db.serverDate(),
          }
        });
        user.quota += 1;
      } else {
        await db.collection('users').doc(user._id).update({
          data: { lastLoginTime: db.serverDate() }
        });
      }
      
      return { code: 0, data: { ...user, quota: user.quota } };
    }
  } catch (err) {
    return { code: -1, message: err.message };
  }
};

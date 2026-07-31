const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { OPENID: openid } = cloud.getWXContext();
  if (!openid) return { code: -1, message: '缺少openid' };

  try {
    const userRes = await db.collection('users').where({ openid }).get();
    if (userRes.data.length === 0) return { code: -1, message: '用户不存在' };
    
    const user = userRes.data[0];
    if (user.quota <= 0) return { code: -1, message: '额度不足' };
    
    const updateRes = await db.collection('users').where({
      _id: user._id,
      quota: _.gt(0),
    }).update({
      data: {
        quota: db.command.inc(-1),
        totalUsed: db.command.inc(1),
      }
    });

    if (!updateRes.stats || updateRes.stats.updated !== 1) {
      return { code: -1, message: '额度不足' };
    }

    const latestUser = await db.collection('users').doc(user._id).get();
    return { code: 0, data: { quota: latestUser.data?.quota || 0 } };
  } catch (err) {
    return { code: -1, message: err.message };
  }
};

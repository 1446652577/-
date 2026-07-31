const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 获取错题集全部题目
exports.main = async (event, context) => {
  const { OPENID: openid } = cloud.getWXContext();
  if (!openid) return { code: -1, message: '缺少openid' };

  try {
    const allQuestions = [];
    const PAGE_SIZE = 100;
    let hasMore = true;

    while (hasMore) {
      const res = await db.collection('wrongBooks')
        .where({ _openid: openid })
        .orderBy('lastWrongTime', 'desc')
        .skip(allQuestions.length)
        .limit(PAGE_SIZE)
        .get();

      allQuestions.push(...res.data);
      hasMore = res.data.length === PAGE_SIZE;
    }

    return {
      code: 0,
      data: {
        questionCount: allQuestions.length,
        questions: allQuestions
      }
    };
  } catch (err) {
    console.error('[getWrongQuestions] 失败:', err);
    return { code: -1, message: err.message || '查询失败' };
  }
};

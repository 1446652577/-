const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 云函数查询不受小程序端20条限制
exports.main = async (event, context) => {
  const { quizId } = event;
  const { OPENID: openid } = cloud.getWXContext();
  if (!quizId || !openid) return { code: -1, message: '参数不完整' };

  try {
    // 获取试卷信息
    const quizRes = await db.collection('quizzes').doc(quizId).get();
    const quiz = quizRes.data;
    if (!quiz || (quiz._openid !== openid && quiz.openid !== openid)) {
      return { code: -1, message: '题库不存在' };
    }

    // 分页获取全部题目（云函数端单次最多100条）
    const allQuestions = [];
    const PAGE_SIZE = 100;
    let hasMore = true;

    while (hasMore) {
      const res = await db.collection('questions')
        .where({ quizId, _openid: openid })
        .orderBy('_id', 'asc')
        .skip(allQuestions.length)
        .limit(PAGE_SIZE)
        .get();

      allQuestions.push(...res.data);
      hasMore = res.data.length === PAGE_SIZE;
    }

    return {
      code: 0,
      data: {
        quizId,
        title: quiz.title,
        fileName: quiz.fileName,
        questionCount: allQuestions.length,
        questions: allQuestions
      }
    };
  } catch (err) {
    console.error('[getQuizQuestions] 失败:', err);
    return { code: -1, message: err.message || '查询失败' };
  }
};

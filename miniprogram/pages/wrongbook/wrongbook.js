const util = require('../../utils/util.js');

Page({
  data: {
    wrongQuestions: [],
    reviewedCount: 0,
    masteredCount: 0,
    reviewableCount: 0,
  },

  onLoad() {
    this.loadWrongQuestions();
  },

  onShow() {
    this.loadWrongQuestions();
  },

  async loadWrongQuestions() {
    const openid = wx.getStorageSync('openid');
    if (!openid) return;

    util.showLoading('加载中...');
    
    try {
      // 调用云函数获取全部错题（不受20条限制）
      const res = await wx.cloud.callFunction({
        name: 'getWrongQuestions',
        data: { openid }
      });

      const result = res.result || {};
      if (result.code !== 0) {
        throw new Error(result.message || '查询失败');
      }

      const rawQuestions = result.data && result.data.questions;
      const questions = (Array.isArray(rawQuestions) ? rawQuestions : []).map(item => ({
        ...item,
        options: this.parseOptions(item.options),
      }));

      const reviewedCount = questions.filter(q => q.reviewed).length;
      const masteredCount = questions.filter(q => q.mastered).length;
      const reviewableCount = questions.filter(q => !q.mastered).length;

      this.setData({
        wrongQuestions: questions,
        reviewedCount,
        masteredCount,
        reviewableCount,
      });
      util.hideLoading();
    } catch (err) {
      console.error('[loadWrongQuestions] 失败:', err);
      util.hideLoading();
      util.showToast('加载失败');
    }
  },

  parseOptions(options) {
    if (!Array.isArray(options)) return [];
    if (Array.isArray(options) && options.length > 0 && typeof options[0] === 'object') {
      return options;
    }
    const keys = ['A', 'B', 'C', 'D'];
    return options.map((text, i) => ({ key: keys[i] || String(i), text }));
  },

  markReviewed(e) {
    const id = e.currentTarget.dataset.id;
    const db = wx.cloud.database();
    db.collection('wrongBooks').doc(id).update({
      data: { reviewed: true }
    }).then(() => {
      this.loadWrongQuestions();
    });
  },

  markMastered(e) {
    const id = e.currentTarget.dataset.id;
    const db = wx.cloud.database();
    db.collection('wrongBooks').doc(id).update({
      data: { mastered: true, reviewed: true }
    }).then(() => {
      this.loadWrongQuestions();
    });
  },

  startWrongPractice() {
    const questions = this.data.wrongQuestions
      .filter(question => !question.mastered)
      .slice(0, 20);
    if (questions.length === 0) {
      util.showToast('暂无待复习错题');
      return;
    }
    wx.setStorageSync('wrongPracticeQuestions', questions);
    wx.navigateTo({ url: '/pages/quiz/quiz?mode=wrong' });
  },

  removeWrong(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认移除',
      content: '确定从错题集中移除这道题吗？',
      success: res => {
        if (res.confirm) {
          const db = wx.cloud.database();
          db.collection('wrongBooks').doc(id).remove().then(() => {
            util.showToast('已移除');
            this.loadWrongQuestions();
          });
        }
      }
    });
  },

  goPractice() {
    wx.switchTab({ url: '/pages/quizlist/quizlist' });
  },
});

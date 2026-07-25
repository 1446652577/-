const util = require('../../utils/util.js');

Page({
  data: {
    wrongQuestions: [],
    reviewedCount: 0,
    masteredCount: 0,
  },

  onLoad() {
    this.loadWrongQuestions();
  },

  onShow() {
    this.loadWrongQuestions();
  },

  loadWrongQuestions() {
    const openid = wx.getStorageSync('openid');
    if (!openid) return;

    util.showLoading('加载中...');
    const db = wx.cloud.database();
    
    db.collection('wrongBooks')
      .where({ _openid: openid })
      .orderBy('lastWrongTime', 'desc')
      .get()
      .then(res => {
        const questions = res.data.map(item => ({
          ...item,
          options: this.parseOptions(item.options),
        }));
        const reviewedCount = questions.filter(q => q.reviewed).length;
        const masteredCount = questions.filter(q => q.mastered).length;
        this.setData({
          wrongQuestions: questions,
          reviewedCount,
          masteredCount,
        });
        util.hideLoading();
      })
      .catch(() => {
        util.hideLoading();
        util.showToast('加载失败');
      });
  },

  parseOptions(options) {
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

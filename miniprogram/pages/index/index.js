const app = getApp();
const util = require('../../utils/util.js');

Page({
  data: {
    quota: 0,
    recentQuizzes: [],
    stats: {
      totalQuiz: 0,
      totalQuestion: 0,
      wrongCount: 0,
    }
  },

  onLoad() {
    this.loadData();
  },

  onShow() {
    this.loadData();
  },

  loadData() {
    const quota = wx.getStorageSync('userQuota') || 0;
    this.setData({ quota });
    this.loadStats();
    this.loadRecentQuizzes();
  },

  loadStats() {
    const db = wx.cloud.database();
    const openid = wx.getStorageSync('openid');
    if (!openid) return;

    db.collection('quizzes').where({ _openid: openid }).count().then(res => {
      const totalQuiz = res.total;
      db.collection('questions').where({ _openid: openid }).count().then(res2 => {
        const totalQuestion = res2.total;
        db.collection('wrongBooks').where({ _openid: openid }).count().then(res3 => {
          this.setData({
            'stats.totalQuiz': totalQuiz,
            'stats.totalQuestion': totalQuestion,
            'stats.wrongCount': res3.total,
          });
        });
      });
    });
  },

  loadRecentQuizzes() {
    const db = wx.cloud.database();
    const openid = wx.getStorageSync('openid');
    if (!openid) return;

    db.collection('quizzes')
      .where({ _openid: openid })
      .orderBy('createTime', 'desc')
      .limit(5)
      .get()
      .then(res => {
        const quizzes = res.data.map(item => ({
          ...item,
          createTime: this.formatTime(item.createTime),
        }));
        this.setData({ recentQuizzes: quizzes });
      });
  },

  formatTime(date) {
    if (!date) return '';
    const d = new Date(date);
    return `${d.getMonth()+1}月${d.getDate()}日`;
  },

  goToImport() {
    wx.navigateTo({ url: '/pages/import/import' });
  },

  goToQuizList() {
    wx.switchTab({ url: '/pages/quizlist/quizlist' });
  },

  goToWrongBook() {
    wx.switchTab({ url: '/pages/wrongbook/wrongbook' });
  },

  goToProfile() {
    wx.switchTab({ url: '/pages/profile/profile' });
  },

  startQuiz(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/quiz/quiz?quizId=${id}` });
  },

  getQuota() {
    wx.navigateTo({ url: '/pages/ad/ad' });
  },
});

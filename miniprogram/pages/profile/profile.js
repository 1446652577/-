const app = getApp();
const util = require('../../utils/util.js');

Page({
  data: {
    quota: 0,
  },

  onLoad() {
    this.loadQuota();
  },

  onShow() {
    this.loadQuota();
  },

  loadQuota() {
    const quota = wx.getStorageSync('userQuota') || 0;
    this.setData({ quota });
    
    const openid = wx.getStorageSync('openid');
    if (openid) {
      wx.cloud.callFunction({
        name: 'getUserQuota',
        data: { openid },
        success: res => {
          if (res.result && res.result.data) {
            const q = res.result.data.quota || 0;
            wx.setStorageSync('userQuota', q);
            this.setData({ quota: q });
          }
        }
      });
    }
  },

  goGetQuota() {
    wx.navigateTo({ url: '/pages/ad/ad' });
  },

  goToWrongBook() {
    wx.switchTab({ url: '/pages/wrongbook/wrongbook' });
  },

  goToQuizList() {
    wx.switchTab({ url: '/pages/quizlist/quizlist' });
  },

  clearCache() {
    wx.showModal({
      title: '确认清除',
      content: '清除缓存后需要重新登录，确定吗？',
      success: res => {
        if (res.confirm) {
          wx.clearStorageSync();
          util.showToast('已清除');
          wx.reLaunch({ url: '/pages/index/index' });
        }
      }
    });
  },
});

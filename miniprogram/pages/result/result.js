Page({
  data: {
    result: {
      total: 0,
      correct: 0,
      wrong: 0,
      accuracy: 0,
    }
  },

  onLoad() {
    const result = wx.getStorageSync('lastQuizResult');
    if (result) {
      this.setData({ result });
    }
  },

  goWrongBook() {
    wx.switchTab({ url: '/pages/wrongbook/wrongbook' });
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' });
  },
});

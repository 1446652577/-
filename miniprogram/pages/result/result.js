Page({
  data: {
    result: {
      total: 0,
      answered: 0,
      unanswered: 0,
      correct: 0,
      wrong: 0,
      accuracy: 0,
    }
  },

  onLoad() {
    const result = wx.getStorageSync('lastQuizResult');
    if (result) {
      this.setData({ result: {
        ...this.data.result,
        ...result,
        answered: Number(result.answered || result.correct || result.wrong || 0),
        unanswered: Number(result.unanswered || 0),
      }});
    }
  },

  goWrongBook() {
    wx.switchTab({ url: '/pages/wrongbook/wrongbook' });
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' });
  },
});

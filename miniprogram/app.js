App({
  onLaunch: function () {
    this.globalData = {
      env: "llll-d9gppqiqb230a9fa8",
    };
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true,
      });
    }
    this.checkUserLogin();
  },

  globalData: {
    env: "llll-d9gppqiqb230a9fa8",
    userInfo: null,
    quota: 0,
  },

  checkUserLogin() {
    const openid = wx.getStorageSync('openid');
    if (!openid) {
      wx.cloud.callFunction({
        name: 'login',
        success: res => {
          if (res.result && res.result.openid) {
            wx.setStorageSync('openid', res.result.openid);
            this.getUserQuota(res.result.openid);
          }
        }
      });
    } else {
      this.getUserQuota(openid);
    }
  },

  getUserQuota(openid) {
    wx.cloud.callFunction({
      name: 'getUserQuota',
      data: { openid },
      success: res => {
        if (res.result && res.result.data) {
          this.globalData.quota = res.result.data.quota || 0;
          wx.setStorageSync('userQuota', res.result.data.quota || 0);
        }
      }
    });
  },
});

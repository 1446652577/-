App({
  onLaunch: function () {
    this.globalData = {
      env: "llll-d9gppqiqb230a9fa8",
      parseServiceUrl: "https://llll-d9gppqiqb230a9fa8.tcloudbaseapp.com",
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
    parseServiceUrl: "https://llll-d9gppqiqb230a9fa8.tcloudbaseapp.com",
    userInfo: null,
    quota: 0,
  },

  checkUserLogin() {
    // 每次启动都调用登录云函数，让服务端处理每日首次登录奖励。
    wx.cloud.callFunction({
      name: 'login',
      success: res => {
        if (res.result && res.result.code === 0 && res.result.openid) {
          wx.setStorageSync('openid', res.result.openid);
          if (res.result.parseAuth) wx.setStorageSync('parseAuth', res.result.parseAuth);
          this.getUserQuota(res.result.openid);
        }
      },
      fail: err => console.error('[login] 失败:', err),
    });
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

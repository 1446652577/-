const app = getApp();
const util = require('../../utils/util.js');

Page({
  data: {
    adLoading: false,
    adHint: '',
    canUseAd: false,
  },

  onLoad() {
    // 检查是否支持激励视频广告
    // 微信小程序需要累计500 UV才能开通流量主创建广告位
    const canUseAd = !!wx.createRewardedVideoAd;
    this.setData({ canUseAd });
  },

  showAd() {
    this.setData({ adLoading: true, adHint: '正在加载广告...' });
    
    // 检查是否支持激励视频广告
    if (!wx.createRewardedVideoAd) {
      this.setData({ adHint: '当前版本不支持广告，直接赠送额度', adLoading: false });
      this.addQuotaDirectly();
      return;
    }

    // ⚠️ 正式广告位ID，需要开通流量主后获取
    // 开通条件：小程序累计独立访客(UV)达到500人
    const adUnitId = 'adunit-xxxxxxx';
    
    const rewardedVideoAd = wx.createRewardedVideoAd({ adUnitId });
    
    rewardedVideoAd.onLoad(() => {
      this.setData({ adHint: '广告加载成功' });
    });
    
    rewardedVideoAd.onError((err) => {
      console.error('广告错误:', err);
      // 广告位未配置或流量主未开通，直接赠送额度
      this.setData({ 
        adHint: '广告功能暂未开通（需500UV），直接赠送额度', 
        adLoading: false 
      });
      this.addQuotaDirectly();
    });
    
    rewardedVideoAd.onClose((res) => {
      this.setData({ adLoading: false });
      if (res && res.isEnded) {
        this.setData({ adHint: '恭喜！获得3次识别额度' });
        this.addQuota(3);
      } else {
        this.setData({ adHint: '未完整观看，无法获得奖励' });
      }
    });

    rewardedVideoAd.show().catch(() => {
      rewardedVideoAd.load().then(() => rewardedVideoAd.show()).catch(err => {
        console.error('广告展示失败:', err);
        this.setData({ 
          adHint: '广告功能暂未开通（需500UV），直接赠送额度', 
          adLoading: false 
        });
        this.addQuotaDirectly();
      });
    });
  },

  addQuotaDirectly() {
    // 广告功能暂未开通时的兜底：直接赠送额度
    // 开通流量主后，去掉这个兜底，走真实广告逻辑
    setTimeout(() => {
      this.addQuota(3);
    }, 1000);
  },

  addQuota(count) {
    const openid = wx.getStorageSync('openid');
    if (!openid) {
      util.showToast('请先登录');
      return;
    }

    wx.cloud.callFunction({
      name: 'addQuotaByAd',
      data: { openid, count },
      success: res => {
        if (res.result && res.result.code === 0) {
          const newQuota = res.result.data.quota;
          wx.setStorageSync('userQuota', newQuota);
          app.globalData.quota = newQuota;
          util.showToast(`成功获得 ${count} 次额度！`, 'success');
          setTimeout(() => {
            wx.navigateBack();
          }, 1500);
        }
      },
      fail: () => {
        util.showToast('获取失败，请重试');
      }
    });
  },

  // 分享给好友获取额度（广告未开通时的替代方案）
  shareToGetQuota() {
    // 分享功能由页面的 onShareAppMessage 处理
    util.showToast('点击右上角「···」分享给好友', 'none');
  },
});

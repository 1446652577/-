// pages/import/import.js 或你现有的上传逻辑中
// 需要添加的轮询相关代码

Page({
  data: {
    isProcessing: false,
    jobId: null,
    progress: '',
    progressPercent: 0,
    pollTimer: null
  },

  // 上传PDF（修改你现有的上传逻辑）
  async uploadPdf(filePath, fileName) {
    const that = this;
    wx.showLoading({ title: '上传中...' });

    try {
      // 1. 上传到云存储
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: `uploads/${Date.now()}_${fileName}`,
        filePath: filePath
      });
      const fileID = uploadRes.fileID;

      // 2. 调用云函数解析
      const parseRes = await wx.cloud.callFunction({
        name: 'parseDocument',
        data: {
          fileID: fileID,
          fileName: fileName,
          questionCount: 100
        }
      });

      const result = parseRes.result;
      console.log('[uploadPdf] 解析结果:', result);

      if (result.code !== 0) {
        wx.hideLoading();
        wx.showToast({ title: result.message || '解析失败', icon: 'none' });
        return;
      }

      // 3. 检查是否是扫描版PDF分批处理
      if (result.data && result.data.status === 'processing') {
        wx.hideLoading();
        this.setData({
          isProcessing: true,
          jobId: result.data.jobId,
          progress: result.data.progress,
          progressPercent: Math.round((result.data.processedPages / result.data.totalPages) * 100)
        });
        // 开始轮询
        this.startPolling();
        return;
      }

      // 4. 普通文件直接完成
      wx.hideLoading();
      this.handleParseComplete(result.data);

    } catch (e) {
      wx.hideLoading();
      console.error('[uploadPdf] 异常:', e);
      wx.showToast({ title: '上传失败: ' + e.message, icon: 'none' });
    }
  },

  // 开始轮询
  startPolling() {
    const that = this;
    // 每3秒轮询一次
    const timer = setInterval(async () => {
      await that.pollJobStatus();
    }, 3000);
    this.setData({ pollTimer: timer });
    // 立即执行一次
    this.pollJobStatus();
  },

  // 停止轮询
  stopPolling() {
    if (this.data.pollTimer) {
      clearInterval(this.data.pollTimer);
      this.setData({ pollTimer: null, isProcessing: false });
    }
  },

  // 轮询任务状态
  async pollJobStatus() {
    const { jobId } = this.data;
    if (!jobId) return;

    try {
      // 先查询当前进度
      const statusRes = await wx.cloud.callFunction({
        name: 'parseDocument',
        data: {
          mode: 'scan_pdf_status',
          jobId: jobId
        }
      });

      const status = statusRes.result;
      console.log('[poll] 状态:', status);

      if (status.code !== 0) {
        this.stopPolling();
        wx.showToast({ title: status.message || '查询失败', icon: 'none' });
        return;
      }

      const jobData = status.data;
      this.setData({
        progress: jobData.progress,
        progressPercent: Math.round((jobData.processedPages / jobData.totalPages) * 100)
      });

      // 如果已完成
      if (jobData.status === 'done') {
        this.stopPolling();
        this.handleParseComplete(jobData);
        return;
      }

      // 如果还在处理中，触发下一批
      if (jobData.status === 'processing') {
        // 调用 continue 处理下一批
        const continueRes = await wx.cloud.callFunction({
          name: 'parseDocument',
          data: {
            mode: 'scan_pdf_continue',
            jobId: jobId
          }
        });
        console.log('[poll] continue结果:', continueRes.result);

        if (continueRes.result.code !== 0) {
          this.stopPolling();
          wx.showToast({ title: continueRes.result.message || '处理失败', icon: 'none' });
          return;
        }

        const continueData = continueRes.result.data;
        if (continueData.status === 'done') {
          this.stopPolling();
          this.handleParseComplete(continueData);
        } else {
          this.setData({
            progress: continueData.progress,
            progressPercent: Math.round((continueData.processedPages / continueData.totalPages) * 100)
          });
        }
      }

    } catch (e) {
      console.error('[poll] 异常:', e);
      // 轮询异常不停止，继续下一次
    }
  },

  // 解析完成后的处理
  handleParseComplete(data) {
    console.log('[complete] 解析完成:', data);
    wx.showToast({ title: `导入成功！共${data.questionCount || 0}题`, icon: 'success' });

    // 跳转到题库页面或显示结果
    // wx.navigateTo({ url: '/pages/quiz/quiz?id=xxx' });
  },

  onUnload() {
    this.stopPolling();
  }
});

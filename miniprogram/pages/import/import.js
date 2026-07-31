const app = getApp();

Page({
  data: {
    fileName: '',
    fileSize: '',
    filePath: '',
    quota: 0,
    parsing: false,
    progress: 0,
    progressText: '',
    questionCounts: ['5题', '10题', '15题', '20题', '30题'],
    questionCountIndex: 1,
    previewQuestions: [],
    parsedData: null,
    errorMsg: '',
    isPptFile: false,
    isScanFile: false,
    imageList: [],
    // 轮询相关
    jobId: null,
    pollTimer: null,
    isPolling: false,
  },

  onLoad() {
    const quota = wx.getStorageSync('userQuota') || 0;
    this.setData({ quota });
    const openid = wx.getStorageSync('openid');
    if (!openid) {
      wx.cloud.callFunction({ name: 'login', success: res => {
        if (res.result && res.result.openid) wx.setStorageSync('openid', res.result.openid);
      }});
    }
  },

  onUnload() {
    this.stopPolling();
  },

  chooseFile() {
    this.setData({ errorMsg: '', isScanFile: false });
    const quota = wx.getStorageSync('userQuota') || 0;
    if (quota <= 0) { wx.showModal({ title: '次数不足', content: '识别次数已用完', success: r => { if (r.confirm) wx.navigateTo({ url: '/pages/ad/ad' }); }}); return; }
    wx.chooseMessageFile({ count: 1, type: 'file', success: res => {
      const file = res.tempFiles[0];
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      const isPpt = ['.ppt', '.pptx'].includes(ext);
      this.setData({ fileName: file.name, fileSize: this.formatSize(file.size), filePath: file.path, isPptFile: isPpt, imageList: [] });
    }});
  },

  chooseImages() {
    this.setData({ errorMsg: '', isScanFile: false });
    const quota = wx.getStorageSync('userQuota') || 0;
    if (quota <= 0) { wx.showModal({ title: '次数不足', content: '识别次数已用完', success: r => { if (r.confirm) wx.navigateTo({ url: '/pages/ad/ad' }); }}); return; }
    wx.chooseMedia({ count: 9, mediaType: ['image'], sourceType: ['album', 'camera'], success: res => {
      const images = res.tempFiles.map((f, i) => ({ path: f.tempFilePath, size: f.size, name: 'page_' + (i + 1) + '.jpg' }));
      this.setData({ imageList: images, fileName: '截图_' + images.length + '张', fileSize: this.formatSize(images.reduce((a, b) => a + (b.size || 0), 0)), isPptFile: false, isScanFile: false });
    }});
  },

  removeImage(e) {
    const idx = e.currentTarget.dataset.index;
    const list = this.data.imageList.filter((_, i) => i !== idx);
    this.setData({ imageList: list, fileName: list.length > 0 ? '截图_' + list.length + '张' : '', fileSize: list.length > 0 ? this.formatSize(list.reduce((a, b) => a + (b.size || 0), 0)) : '' });
  },

  formatSize(bytes) { if (bytes < 1024) return bytes + 'B'; if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'; return (bytes / (1024 * 1024)).toFixed(1) + 'MB'; },

  onCountChange(e) { this.setData({ questionCountIndex: e.detail.value }); },

  // ===================== 开始解析 =====================
  async startParse() {
    const openid = wx.getStorageSync('openid');
    if (!openid) { this.setData({ errorMsg: '请先登录' }); return; }
    const quota = wx.getStorageSync('userQuota') || 0;
    if (quota <= 0) { this.setData({ errorMsg: '额度不足' }); return; }

    this._parseCompletionDone = false;

    if (this.data.imageList.length > 0) {
      await this.parseImages();
      return;
    }

    if (!this.data.filePath) { this.setData({ errorMsg: '请先选择文件或截图' }); return; }
    const isPdf = this.data.fileName.toLowerCase().endsWith('.pdf');
    this.setData({ parsing: true, progress: 10, progressText: '上传文件中...', errorMsg: '', isScanFile: false });

    try {
      const ext = this.data.fileName.substring(this.data.fileName.lastIndexOf('.'));
      const cloudPath = 'uploads/' + Date.now() + ext;
      const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath: this.data.filePath });
      this.setData({ progress: 30, progressText: isPdf ? '扫描版PDF转图片识别中...' : '解析中...' });

      const parseRes = await wx.cloud.callFunction({
        name: 'parseDocument',
        data: {
          fileID: uploadRes.fileID,
          fileName: this.data.fileName,
          questionCount: parseInt(this.data.questionCounts[this.data.questionCountIndex])
        }
      });

      if (parseRes.result && parseRes.result.code === 0) {
        const data = parseRes.result.data;

        // ===== 扫描版PDF分批处理：启动轮询 =====
        if (data.status === 'processing') {
          this.setData({
            jobId: data.jobId,
            isPolling: true,
            progressText: `正在识别... (${data.progress || '处理中'})`,
            progress: 35
          });
          this.startPolling();
          return;
        }

        // ===== 普通文件直接完成 =====
        this.setData({ progress: 80, progressText: '处理结果...' });
        await this.handleParseComplete(data);
      } else {
        throw new Error((parseRes.result && parseRes.result.message) || '解析失败');
      }
    } catch (err) {
      const msg = err.message || err.errMsg || '未知错误';
      this.setData({ parsing: false, progress: 0, errorMsg: msg, isPolling: false });
      wx.showToast({ title: msg, icon: 'none' });
    }
  },

  // ===================== 轮询逻辑 =====================
  startPolling() {
    this.stopPolling();
    this.setData({ isPolling: true });
    this.pollJobStatus().finally(() => this.schedulePolling());
  },

  schedulePolling() {
    if (!this.data.isPolling || !this.data.jobId) return;
    const timer = setTimeout(() => {
      this.pollJobStatus().finally(() => this.schedulePolling());
    }, 3000);
    this.setData({ pollTimer: timer });
  },

  stopPolling() {
    if (this.data.pollTimer) {
      clearInterval(this.data.pollTimer);
      this.setData({ pollTimer: null, isPolling: false });
    }
  },

  async pollJobStatus() {
    const { jobId } = this.data;
    if (!jobId) return;

    try {
      // 查询当前进度
      const statusRes = await wx.cloud.callFunction({
        name: 'parseDocument',
        data: { mode: 'scan_pdf_status', jobId }
      });

      if (statusRes.result.code !== 0) {
        this.stopPolling();
        this.setData({ parsing: false, progress: 0, errorMsg: statusRes.result.message || '查询失败' });
        return;
      }

      const job = statusRes.result.data;
      const percent = job.totalPages > 0 ? Math.round((job.processedPages / job.totalPages) * 100) : 0;
      this.setData({
        progressText: `正在识别... ${job.processedPages}/${job.totalPages} 页`,
        progress: 30 + Math.round(percent * 0.6) // 30-90% 区间
      });

      // 已完成
      if (job.status === 'done') {
        this.stopPolling();
        this.setData({ progress: 90, progressText: '处理结果...' });
        await this.handleParseComplete(job);
        return;
      }

      // 失败
      if (job.status === 'failed') {
        this.stopPolling();
        this.setData({ parsing: false, progress: 0, errorMsg: job.error || '处理失败' });
        return;
      }

      // 还在处理中，触发下一批
      if (job.status === 'processing') {
        const continueRes = await wx.cloud.callFunction({
          name: 'parseDocument',
          data: { mode: 'scan_pdf_continue', jobId }
        });
        console.log('[poll] continue:', continueRes.result);

        if (continueRes.result.code !== 0) {
          this.stopPolling();
          this.setData({ parsing: false, progress: 0, errorMsg: continueRes.result.message || '处理失败' });
          return;
        }

        const continueData = continueRes.result.data;
        if (continueData.status === 'done') {
          this.stopPolling();
          this.setData({ progress: 90, progressText: '处理结果...' });
          await this.handleParseComplete(continueData);
        }
      }
    } catch (err) {
      console.error('[poll] 异常:', err);
      // 轮询异常不停止，继续下次
    }
  },

  // ===================== 解析完成后的统一处理 =====================
  async handleParseComplete(data) {
    if (!data || !Array.isArray(data.questions)) {
      throw new Error('解析结果无效');
    }
    if (this._parseCompletionDone) return;
    if (this._parseCompletionInFlight) return this._parseCompletionInFlight;

    this._parseCompletionInFlight = (async () => {
      const openid = wx.getStorageSync('openid');
      if (!openid) throw new Error('登录状态已失效，请重新进入小程序');

      const consumeRes = await wx.cloud.callFunction({
        name: 'consumeQuota',
        data: { openid },
      });
      if (!consumeRes.result || consumeRes.result.code !== 0) {
        throw new Error((consumeRes.result && consumeRes.result.message) || '额度扣减失败，请重试');
      }

      const consumeData = consumeRes.result.data || {};
      const newQuota = Number.isFinite(consumeData.quota)
        ? consumeData.quota
        : Math.max(0, (wx.getStorageSync('userQuota') || 0) - 1);
      wx.setStorageSync('userQuota', newQuota);
      this._parseCompletionDone = true;

      this.setData({
        progress: 100,
        progressText: '完成！',
        previewQuestions: data.questions.slice(0, 3),
        parsedData: data,
        quota: newQuota,
        parsing: false,
        isPolling: false,
        jobId: null,
      });
      wx.showToast({ title: '生成成功！共' + (data.questionCount || 0) + '题', icon: 'success' });
    })();

    try {
      return await this._parseCompletionInFlight;
    } catch (err) {
      this.stopPolling();
      this.setData({ parsing: false, isPolling: false, jobId: null, errorMsg: err.message || '处理失败' });
      throw err;
    } finally {
      this._parseCompletionInFlight = null;
    }
  },

  // ===================== 截图模式（原逻辑不变）=====================
  async parseImages() {
    const openid = wx.getStorageSync('openid');
    const quota = wx.getStorageSync('userQuota') || 0;
    const images = this.data.imageList;
    if (images.length === 0) return;

    this.setData({ parsing: true, progress: 5, progressText: '正在上传图片...', errorMsg: '' });

    try {
      const fileIDs = [];
      for (let i = 0; i < images.length; i++) {
        const cloudPath = 'uploads/' + Date.now() + '_' + i + '.jpg';
        const res = await wx.cloud.uploadFile({ cloudPath, filePath: images[i].path });
        fileIDs.push(res.fileID);
        this.setData({ progress: Math.floor(10 + (i + 1) / images.length * 30), progressText: '上传图片（' + (i + 1) + '/' + images.length + '）...' });
      }

      this.setData({ progress: 50, progressText: '正在识别文字...' });
      const parseRes = await wx.cloud.callFunction({
        name: 'parseDocument',
        data: { imageFileIDs: fileIDs, fileName: '截图_' + images.length + '张', questionCount: parseInt(this.data.questionCounts[this.data.questionCountIndex]), mode: 'ocr_images' }
      });

      this.setData({ progress: 80, progressText: 'AI生成题目中...' });
      if (parseRes.result && parseRes.result.code === 0) {
        const data = parseRes.result.data;
        await this.handleParseComplete(data);
      } else {
        throw new Error((parseRes.result && parseRes.result.message) || '识别失败');
      }
    } catch (err) {
      const msg = err.message || err.errMsg || '未知错误';
      this.setData({ parsing: false, progress: 0, errorMsg: msg });
      wx.showToast({ title: msg, icon: 'none' });
    }
  },

  // ===================== 保存题库 =====================
  async saveQuiz() {
    if (!this.data.parsedData) return;
    wx.showLoading({ title: '保存中...' });
    try {
      const db = wx.cloud.database();
      const openid = wx.getStorageSync('openid');
      const { questions, title } = this.data.parsedData;
      const quizRes = await db.collection('quizzes').add({ data: { title: title || this.data.fileName.replace(/\.[^.]+$/, ''), openid, questionCount: questions.length, createTime: db.serverDate(), fileName: this.data.fileName }});
      for (const q of questions) { await db.collection('questions').add({ data: { quizId: quizRes._id, openid, question: q.question, options: q.options, answer: q.answer, explanation: q.explanation || '', createTime: db.serverDate() }}); }
      wx.showToast({ title: '保存成功！', icon: 'success' });
      setTimeout(() => { wx.switchTab({ url: '/pages/quizlist/quizlist' }); }, 1500);
    } catch (err) { wx.showToast({ title: '保存失败', icon: 'none' }); } finally { wx.hideLoading(); }
  },
});

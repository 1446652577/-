const app = getApp();

Page({
  data: {
    subjectOptions: ['通用', '语文', '数学', '英语', '物理', '化学', '历史', '地理', '生物'],
    subjectIndex: 0,
    difficultyOptions: ['不限', '基础', '中等', '提高'],
    difficultyIndex: 2,
    questionTypeOptions: ['自动识别', '单选题', '判断题'],
    questionTypeIndex: 0,
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

  async cleanupUploadedFiles() {
    const fileList = [...new Set(this._uploadedFileIDs || [])].filter(Boolean);
    if (fileList.length === 0) return;
    this._uploadedFileIDs = [];
    try {
      await wx.cloud.deleteFile({ fileList });
    } catch (err) {
      console.warn('[cleanupUploadedFiles] 清理上传文件失败:', err);
    }
  },

  async refreshParseAuth() {
    const res = await new Promise((resolve, reject) => {
      wx.cloud.callFunction({
        name: 'login',
        success: resolve,
        fail: reject,
      });
    });
    if (res.result && res.result.openid) wx.setStorageSync('openid', res.result.openid);
    if (res.result && res.result.parseAuth) wx.setStorageSync('parseAuth', res.result.parseAuth);
    return res.result;
  },

  async callParseService(data, retry = true) {
    const serviceUrl = app.globalData.parseServiceUrl || '';
    if (!serviceUrl) {
      console.warn('[parse] 未配置 parseServiceUrl，回退云函数 parseDocument');
      return wx.cloud.callFunction({ name: 'parseDocument', data });
    }

    let auth = wx.getStorageSync('parseAuth') || {};
    if ((!auth.token || !auth.timestamp) && retry) {
      await this.refreshParseAuth();
      auth = wx.getStorageSync('parseAuth') || {};
    }
    if (!auth.token || !auth.timestamp) {
      console.warn('[parse] 缺少 parseAuth，请检查 PARSE_RUN_TOKEN_SECRET，回退云函数 parseDocument');
      return wx.cloud.callFunction({ name: 'parseDocument', data });
    }

    const requestData = { ...data, openid: wx.getStorageSync('openid') || '' };
    console.info('[parse] 使用 CloudBase Run', data.mode || 'parse');
    return new Promise((resolve, reject) => {
      wx.request({
        url: serviceUrl,
        method: 'POST',
        data: requestData,
        header: {
          'content-type': 'application/json',
          'X-Parse-Token': auth.token,
          'X-Parse-Timestamp': String(auth.timestamp),
        },
        success: async response => {
          if (response.statusCode === 401 && retry) {
            try {
              await this.refreshParseAuth();
              resolve(await this.callParseService(data, false));
            } catch (err) {
              reject(err);
            }
            return;
          }
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve({ result: response.data });
            return;
          }
          const message = response.data && response.data.message;
          reject(new Error(message || `解析服务请求失败（${response.statusCode}）`));
        },
        fail: reject,
      });
    });
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

  onSubjectChange(e) { this.setData({ subjectIndex: Number(e.detail.value) }); },

  onDifficultyChange(e) { this.setData({ difficultyIndex: Number(e.detail.value) }); },

  onQuestionTypeChange(e) { this.setData({ questionTypeIndex: Number(e.detail.value) }); },

  getParseOptions() {
    return {
      questionCount: parseInt(this.data.questionCounts[this.data.questionCountIndex], 10),
      subject: this.data.subjectOptions[this.data.subjectIndex],
      difficulty: this.data.difficultyOptions[this.data.difficultyIndex],
      questionType: this.data.questionTypeOptions[this.data.questionTypeIndex],
    };
  },

  normalizeQuestions(questions) {
    const seen = new Set();
    let readyCount = 0;
    let warningCount = 0;
    const normalized = (Array.isArray(questions) ? questions : []).map((item, index) => {
      const question = String(item.question || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      const options = (Array.isArray(item.options) ? item.options : [])
        .map((option, optionIndex) => ({
          key: String(option.key || String.fromCharCode(65 + optionIndex)).toUpperCase(),
          text: String(option.text || '').replace(/\u00a0/g, ' ').trim(),
        }))
        .filter(option => option.text);
      const answer = String(item.answer || '').trim().toUpperCase();
      const fingerprint = question.replace(/\s/g, '').toLowerCase();
      const issues = [];
      if (question.length < 4) issues.push('题干过短');
      if (options.length < 2) issues.push('选项不足');
      if (answer && !options.some(option => option.key === answer)) issues.push('答案不在选项中');
      if (!answer) issues.push('待补充答案');
      if (fingerprint && seen.has(fingerprint)) issues.push('疑似重复题');
      if (fingerprint) seen.add(fingerprint);
      if (issues.length === 0) readyCount += 1;
      else warningCount += 1;
      return {
        ...item,
        question,
        options,
        answer,
        explanation: String(item.explanation || '').trim(),
        sourceOrder: Number.isFinite(Number(item.sourceOrder)) && Number(item.sourceOrder) > 0
          ? Number(item.sourceOrder)
          : index + 1,
        qualityIssue: issues.join('、'),
        qualityLevel: issues.length === 0 ? '可直接使用' : '建议检查',
        qualityIndex: index,
      };
    }).filter(item => item.question.length > 0)
      .sort((a, b) => a.sourceOrder - b.sourceOrder || a.qualityIndex - b.qualityIndex)
      .map((item, index) => ({ ...item, qualityIndex: index }));
    return {
      questions: normalized,
      summary: { total: normalized.length, ready: readyCount, warning: warningCount },
    };
  },

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
      this._uploadedFileIDs = [uploadRes.fileID];
      this.setData({ progress: 30, progressText: isPdf ? '扫描版PDF转图片识别中...' : '解析中...' });

      const parseRes = await this.callParseService({
          ...this.getParseOptions(),
          fileID: uploadRes.fileID,
          fileName: this.data.fileName,
      });

      if (parseRes.result && parseRes.result.code === 0) {
        const data = parseRes.result.data;
        await this.cleanupUploadedFiles();

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
      await this.cleanupUploadedFiles();
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
    }, 4000);
    this.setData({ pollTimer: timer });
  },

  stopPolling() {
    if (this.data.pollTimer) {
      clearTimeout(this.data.pollTimer);
      this.setData({ pollTimer: null, isPolling: false });
    }
  },

  async pollJobStatus() {
    const { jobId } = this.data;
    if (!jobId) return;

    try {
      // 继续处理接口同时返回进度，避免每轮先查询再处理造成双倍云函数调用。
      const continueRes = await this.callParseService({ mode: 'scan_pdf_continue', jobId });

      if (continueRes.result.code !== 0) {
        this.stopPolling();
        this.setData({ parsing: false, progress: 0, errorMsg: continueRes.result.message || '处理失败' });
        return;
      }

      const job = continueRes.result.data || {};
      if (job.status === 'done') {
        this.stopPolling();
        this.setData({ progress: 90, progressText: '处理结果...' });
        await this.handleParseComplete(job);
        return;
      }

      if (job.status === 'failed') {
        this.stopPolling();
        this.setData({ parsing: false, progress: 0, errorMsg: job.error || '处理失败' });
        return;
      }

      if (job.totalPages > 0) {
        const percent = Math.round((job.processedPages / job.totalPages) * 100);
        this.setData({
          progressText: `正在识别... ${job.processedPages}/${job.totalPages} 页`,
          progress: 30 + Math.round(percent * 0.6)
        });
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

    const normalizedResult = this.normalizeQuestions(data.questions);
    const normalizedData = {
      ...data,
      questions: normalizedResult.questions,
      questionCount: normalizedResult.questions.length,
      qualitySummary: normalizedResult.summary,
    };

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
        previewQuestions: normalizedResult.questions.slice(0, 3),
        parsedData: normalizedData,
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
      this._uploadedFileIDs = fileIDs;

      this.setData({ progress: 50, progressText: '正在识别文字...' });
      const parseRes = await this.callParseService({ ...this.getParseOptions(), imageFileIDs: fileIDs, fileName: '截图_' + images.length + '张', mode: 'ocr_images' });

      this.setData({ progress: 80, progressText: 'AI生成题目中...' });
      if (parseRes.result && parseRes.result.code === 0) {
        const data = parseRes.result.data;
        await this.cleanupUploadedFiles();
        await this.handleParseComplete(data);
      } else {
        throw new Error((parseRes.result && parseRes.result.message) || '识别失败');
      }
    } catch (err) {
      await this.cleanupUploadedFiles();
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
      for (let index = 0; index < questions.length; index += 1) {
        const q = questions[index];
        await db.collection('questions').add({ data: {
          quizId: quizRes._id,
          openid,
          question: q.question,
          options: q.options,
          answer: q.answer,
          explanation: q.explanation || '',
          questionIndex: index,
          sourceOrder: Number(q.sourceOrder) || index + 1,
          createTime: db.serverDate(),
        }});
      }
      wx.showToast({ title: '保存成功！', icon: 'success' });
      setTimeout(() => { wx.switchTab({ url: '/pages/quizlist/quizlist' }); }, 1500);
    } catch (err) { wx.showToast({ title: '保存失败', icon: 'none' }); } finally { wx.hideLoading(); }
  },
});

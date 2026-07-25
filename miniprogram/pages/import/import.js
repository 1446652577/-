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

  async startParse() {
    const openid = wx.getStorageSync('openid');
    if (!openid) { this.setData({ errorMsg: '请先登录' }); return; }
    const quota = wx.getStorageSync('userQuota') || 0;
    if (quota <= 0) { this.setData({ errorMsg: '额度不足' }); return; }

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
      this.setData({ 
        progress: 40, 
        progressText: isPdf ? '扫描版PDF转图片识别中，请稍候...' : '解析中...' 
      });
      const parseRes = await wx.cloud.callFunction({ name: 'parseDocument', data: { fileID: uploadRes.fileID, fileName: this.data.fileName, questionCount: parseInt(this.data.questionCounts[this.data.questionCountIndex]) }});
      this.setData({ progress: 80, progressText: '处理结果...' });
      if (parseRes.result && parseRes.result.code === 0) {
        const data = parseRes.result.data;
        if (data.isScanFile) {
          this.setData({ parsing: false, progress: 0, isScanFile: true, fileName: '', filePath: '', fileSize: '', errorMsg: '' });
          const errorDetail = data.aiDetail && data.aiDetail.error || '';
          if (errorDetail.includes('配置') || errorDetail.includes('COS')) {
            wx.showModal({
              title: '⚙️ 扫描版PDF需配置COS',
              content: '该PDF是扫描版（图片格式），需要配置腾讯云COS+数据万象才能自动识别。\n\n也可使用「截图上传」功能直接识别。',
              showCancel: true,
              cancelText: '截图上传',
              confirmText: '查看配置步骤',
              success: (res) => {
                if (res.confirm) {
                  wx.showModal({ title: '配置步骤', content: errorDetail, showCancel: false });
                }
              }
            });
          } else {
            wx.showModal({ title: '📄 自动识别失败', content: errorDetail || '该PDF是图片格式，自动识别失败。请使用「截图上传」功能。', showCancel: false, confirmText: '知道了' });
          }
          return;
        }
        await wx.cloud.callFunction({ name: 'consumeQuota', data: { openid } });
        const newQuota = quota - 1; wx.setStorageSync('userQuota', newQuota);
        this.setData({ progress: 100, progressText: '完成！', previewQuestions: data.questions.slice(0, 3), parsedData: data, quota: newQuota, parsing: false });
        wx.showToast({ title: '生成成功！', icon: 'success' });
      } else {
        throw new Error((parseRes.result && parseRes.result.message) || '解析失败');
      }
    } catch (err) {
      const msg = err.message || err.errMsg || '未知错误';
      this.setData({ parsing: false, progress: 0, errorMsg: msg });
      wx.showToast({ title: msg, icon: 'none' });
    }
  },

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
        await wx.cloud.callFunction({ name: 'consumeQuota', data: { openid } });
        const newQuota = quota - 1; wx.setStorageSync('userQuota', newQuota);
        this.setData({ progress: 100, progressText: '完成！', previewQuestions: data.questions.slice(0, 3), parsedData: data, quota: newQuota, parsing: false });
        wx.showToast({ title: '识别成功！共' + data.questions.length + '题', icon: 'success' });
      } else {
        throw new Error((parseRes.result && parseRes.result.message) || '识别失败');
      }
    } catch (err) {
      const msg = err.message || err.errMsg || '未知错误';
      this.setData({ parsing: false, progress: 0, errorMsg: msg });
      wx.showToast({ title: msg, icon: 'none' });
    }
  },

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

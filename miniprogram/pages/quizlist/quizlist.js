const util = require('../../utils/util.js');

Page({
  data: {
    quizzes: [],
    keyword: '',
    sortBy: 'time',
    loading: false,
  },

  onLoad() {
    this.loadQuizzes();
  },

  onShow() {
    this.loadQuizzes();
  },

  loadQuizzes() {
    const openid = wx.getStorageSync('openid');
    if (!openid) return;
    
    this.setData({ loading: true });
    const db = wx.cloud.database();
    let query = db.collection('quizzes').where({ _openid: openid });
    
    if (this.data.keyword) {
      query = db.collection('quizzes').where({
        _openid: openid,
        title: db.RegExp({ regexp: this.data.keyword, options: 'i' })
      });
    }

    query.orderBy(this.data.sortBy === 'time' ? 'createTime' : 'questionCount', 'desc')
      .get()
      .then(res => {
        const quizzes = res.data.map(item => ({
          ...item,
          createTimeStr: this.formatDate(item.createTime),
        }));
        this.setData({ quizzes, loading: false });
      })
      .catch(() => {
        this.setData({ loading: false });
      });
  },

  formatDate(date) {
    if (!date) return '';
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  doSearch() {
    this.loadQuizzes();
  },

  setSort(e) {
    this.setData({ sortBy: e.currentTarget.dataset.type }, () => {
      this.loadQuizzes();
    });
  },

  startPractice(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/quiz/quiz?quizId=${id}` });
  },

  deleteQuiz(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复，确定删除吗？',
      success: res => {
        if (res.confirm) {
          util.showLoading('删除中...');
          const db = wx.cloud.database();
          // 删除题库
          db.collection('quizzes').doc(id).remove().then(() => {
            // 删除关联题目
            db.collection('questions').where({ quizId: id }).remove().then(() => {
              util.showToast('删除成功');
              this.loadQuizzes();
            });
          }).catch(() => {
            util.showToast('删除失败');
          }).finally(() => {
            util.hideLoading();
          });
        }
      }
    });
  },

  goImport() {
    wx.navigateTo({ url: '/pages/import/import' });
  },
});

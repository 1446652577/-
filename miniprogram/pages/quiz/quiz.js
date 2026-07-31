const util = require('../../utils/util.js');

Page({
  data: {
    quizId: '',
    quizTitle: '',
    questions: [],
    currentIndex: 0,
    currentQuestion: null,
    selectedOption: '',
    showResult: false,
    correctCount: 0,
    wrongCount: 0,
    wrongQuestions: [],
    answers: {},
  },

  onLoad(options) {
    if (options.quizId) {
      this.setData({ quizId: options.quizId });
      this.loadQuiz(options.quizId);
    }
  },

  async loadQuiz(quizId) {
    util.showLoading('加载中...');
    
    try {
      // 调用云函数获取全部题目（云函数端不受20条限制）
      const res = await wx.cloud.callFunction({
        name: 'getQuizQuestions',
        data: { quizId }
      });

      const result = res.result || {};
      if (result.code !== 0) {
        throw new Error(result.message || '查询失败');
      }

      const data = result.data || {};
      const questions = (Array.isArray(data.questions) ? data.questions : []).map(q => ({
        ...q,
        options: this.parseOptions(q.options),
      }));
      if (questions.length === 0) throw new Error('题库暂无题目');

      this.setData({
        quizTitle: data.title,
        questions,
        currentQuestion: questions[0],
      });
      util.hideLoading();
    } catch (err) {
      console.error('[loadQuiz] 失败:', err);
      util.showToast('加载失败');
      util.hideLoading();
    }
  },

  parseOptions(options) {
    if (!Array.isArray(options)) return [];
    if (Array.isArray(options) && options.length > 0 && typeof options[0] === 'object') {
      return options;
    }
    const keys = ['A', 'B', 'C', 'D'];
    return options.map((text, i) => ({ key: keys[i] || String(i), text }));
  },

  selectOption(e) {
    if (this.data.showResult) return;
    
    const key = e.currentTarget.dataset.key;
    const { currentQuestion } = this.data;
    const hasAnswer = currentQuestion.answer && currentQuestion.answer.trim().length > 0;
    const isCorrect = hasAnswer && key === currentQuestion.answer;
    
    this.setData({
      selectedOption: key,
      showResult: true,
    });

    if (!hasAnswer) {
      wx.showToast({ title: '本题未设置答案', icon: 'none' });
    } else if (isCorrect) {
      this.setData({ correctCount: this.data.correctCount + 1 });
    } else {
      this.setData({ 
        wrongCount: this.data.wrongCount + 1,
        wrongQuestions: [...this.data.wrongQuestions, currentQuestion],
      });
      this.saveWrongQuestion(currentQuestion);
    }

    const answers = { ...this.data.answers, [currentQuestion._id]: key };
    this.setData({ answers });
  },

  saveWrongQuestion(question) {
    const openid = wx.getStorageSync('openid');
    if (!openid) return;
    
    const db = wx.cloud.database();
    db.collection('wrongBooks').where({
      openid,
      questionId: question._id,
    }).get().then(res => {
      if (res.data.length === 0) {
        db.collection('wrongBooks').add({
          data: {
            openid,
            questionId: question._id,
            quizId: question.quizId,
            question: question.question,
            options: question.options,
            answer: question.answer,
            explanation: question.explanation || '',
            wrongCount: 1,
            lastWrongTime: db.serverDate(),
            createTime: db.serverDate(),
          }
        });
      } else {
        const doc = res.data[0];
        db.collection('wrongBooks').doc(doc._id).update({
          data: {
            wrongCount: db.command.inc(1),
            lastWrongTime: db.serverDate(),
          }
        });
      }
    });
  },

  prevQuestion() {
    if (this.data.currentIndex === 0) return;
    const newIndex = this.data.currentIndex - 1;
    const q = this.data.questions[newIndex];
    this.setData({
      currentIndex: newIndex,
      currentQuestion: q,
      selectedOption: this.data.answers[q._id] || '',
      showResult: !!this.data.answers[q._id],
    });
  },

  nextQuestion() {
    if (this.data.currentIndex >= this.data.questions.length - 1) return;
    const newIndex = this.data.currentIndex + 1;
    const q = this.data.questions[newIndex];
    this.setData({
      currentIndex: newIndex,
      currentQuestion: q,
      selectedOption: this.data.answers[q._id] || '',
      showResult: !!this.data.answers[q._id],
    });
  },

  finishQuiz() {
    const { quizId, questions, correctCount, wrongCount } = this.data;
    const result = {
      quizId,
      total: questions.length,
      correct: correctCount,
      wrong: wrongCount,
      accuracy: questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 0,
    };
    wx.setStorageSync('lastQuizResult', result);
    wx.navigateTo({ url: '/pages/result/result' });
  },
});

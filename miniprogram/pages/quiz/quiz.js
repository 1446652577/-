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
    nextHint: '',
    practiceMode: 'normal',
  },

  onLoad(options) {
    const practiceMode = options.mode || 'normal';
    this.setData({ practiceMode });
    if (practiceMode === 'wrong') {
      this.loadWrongPractice();
      return;
    }
    if (options.quizId) {
      this.setData({ quizId: options.quizId });
      this.loadQuiz(options.quizId, practiceMode);
    }
  },

  onUnload() {
    this.clearAutoNextTimer();
  },

  async loadQuiz(quizId, practiceMode = this.data.practiceMode) {
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
        questionParts: this.buildQuestionParts(q.question),
      }));
      if (questions.length === 0) throw new Error('题库暂无题目');

      const preparedQuestions = practiceMode === 'random'
        ? this.shuffleQuestions(questions).slice(0, Math.min(10, questions.length))
        : questions;

      this.setData({
        quizTitle: data.title,
        questions: preparedQuestions,
        currentQuestion: preparedQuestions[0],
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

  buildQuestionParts(question) {
    const raw = String(question || '').replace(/\r\n/g, '\n');
    const blankToken = '__QUIZ_BLANK__';
    let normalized = raw
      .replace(/_{2,}|＿{2,}|…{2,}|\.{4,}|（\s*）|\(\s*\)|【\s*】/g, blankToken)
      .replace(/(?:画|划)\s*横线\s*部分/g, blankToken);

    if (normalized === raw && /填入.{0,10}(横线|下划线|空格|括号)/.test(raw)) {
      normalized = raw.replace(/横线部分|下划线部分|空格部分|括号内/g, blankToken);
    }

    const pieces = normalized.split(blankToken);
    if (pieces.length === 1) return [{ type: 'text', text: raw }];

    const parts = [];
    pieces.forEach((text, index) => {
      if (text) parts.push({ type: 'text', text });
      if (index < pieces.length - 1) parts.push({ type: 'blank', text: '__________' });
    });
    return parts;
  },

  shuffleQuestions(questions) {
    const result = [...questions];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  },

  loadWrongPractice() {
    const stored = wx.getStorageSync('wrongPracticeQuestions') || [];
    wx.removeStorageSync('wrongPracticeQuestions');
    const questions = (Array.isArray(stored) ? stored : []).map(q => ({
      ...q,
      _id: q.questionId || q._id,
      options: this.parseOptions(q.options),
      questionParts: this.buildQuestionParts(q.question),
    })).filter(q => q.question && q.options.length > 0);
    if (questions.length === 0) {
      wx.showToast({ title: '暂无可复习的错题', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 600);
      return;
    }
    const shuffledQuestions = this.shuffleQuestions(questions);
    this.setData({
      quizTitle: '错题复习',
      questions: shuffledQuestions,
      currentQuestion: shuffledQuestions[0],
    });
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
      nextHint: this.data.currentIndex === this.data.questions.length - 1
        ? '即将查看练习结果…'
        : '即将进入下一题…',
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
    this.scheduleAutoNext();
  },

  clearAutoNextTimer() {
    if (this._autoNextTimer) {
      clearTimeout(this._autoNextTimer);
      this._autoNextTimer = null;
    }
  },

  scheduleAutoNext() {
    this.clearAutoNextTimer();
    this._autoNextTimer = setTimeout(() => {
      this._autoNextTimer = null;
      if (this.data.currentIndex >= this.data.questions.length - 1) {
        this.finishQuiz();
      } else {
        this.nextQuestion();
      }
    }, 900);
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
    this.clearAutoNextTimer();
    if (this.data.currentIndex === 0) return;
    const newIndex = this.data.currentIndex - 1;
    const q = this.data.questions[newIndex];
    this.setData({
      currentIndex: newIndex,
      currentQuestion: q,
      selectedOption: this.data.answers[q._id] || '',
      showResult: !!this.data.answers[q._id],
      nextHint: '',
    });
  },

  nextQuestion() {
    this.clearAutoNextTimer();
    if (this.data.currentIndex >= this.data.questions.length - 1) return;
    const newIndex = this.data.currentIndex + 1;
    const q = this.data.questions[newIndex];
    this.setData({
      currentIndex: newIndex,
      currentQuestion: q,
      selectedOption: this.data.answers[q._id] || '',
      showResult: !!this.data.answers[q._id],
      nextHint: '',
    });
  },

  finishQuiz() {
    this.clearAutoNextTimer();
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

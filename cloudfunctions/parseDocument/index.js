const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const TENCENT_SECRET_ID = process.env.TENCENT_SECRET_ID || '';
const TENCENT_SECRET_KEY = process.env.TENCENT_SECRET_KEY || '';
const GLM_API_KEY = process.env.ZHIPU_API_KEY || '';
const axios = require('axios');
const crypto = require('crypto');

const JOB_COLLECTION = 'parse_jobs';
const DEFAULT_QUESTION_COUNT = 50;
const MAX_QUESTION_COUNT = 100;

function normalizeQuestionCount(value) {
  const count = Number.parseInt(value, 10);
  if (!Number.isInteger(count) || count <= 0) return DEFAULT_QUESTION_COUNT;
  return Math.min(count, MAX_QUESTION_COUNT);
}

function normalizeGenerationOptions({ subject, difficulty, questionType } = {}) {
  const subjects = new Set(['通用', '语文', '数学', '英语', '物理', '化学', '历史', '地理', '生物']);
  const difficulties = new Set(['不限', '基础', '中等', '提高']);
  const questionTypes = new Set(['自动识别', '单选题', '判断题']);
  return {
    subject: subjects.has(subject) ? subject : '通用',
    difficulty: difficulties.has(difficulty) ? difficulty : '不限',
    questionType: questionTypes.has(questionType) ? questionType : '自动识别',
  };
}

// ===================== 腾讯云签名 =====================
async function tencentApiCall({ service, host, action, version, region, payload, timeout = 30000 }) {
  if (!TENCENT_SECRET_ID || !TENCENT_SECRET_KEY) throw new Error('腾讯云API未配置');
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().split('T')[0];
  const payloadStr = JSON.stringify(payload);
  const payloadHash = crypto.createHash('sha256').update(payloadStr).digest('hex');
  const headers = { 'Content-Type': 'application/json', 'Host': host, 'X-TC-Action': action, 'X-TC-Version': version, 'X-TC-Timestamp': String(timestamp), 'X-TC-Region': region };
  const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${crypto.createHash('sha256').update(canonicalRequest).digest('hex')}`;
  const secretDate = crypto.createHmac('sha256', `TC3${TENCENT_SECRET_KEY}`).update(date).digest();
  const secretService = crypto.createHmac('sha256', secretDate).update(service).digest();
  const secretSigning = crypto.createHmac('sha256', secretService).update('tc3_request').digest();
  const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex');
  headers['Authorization'] = `TC3-HMAC-SHA256 Credential=${TENCENT_SECRET_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await axios.post(`https://${host}`, payloadStr, { headers, timeout });
  if (response.data?.Response?.Error) {
    const err = response.data.Response.Error;
    throw new Error(`[${err.Code}] ${err.Message}`);
  }
  return response.data;
}

// ===================== OCR =====================
async function ocrImageBuffer(imageBuffer) {
  const res = await tencentApiCall({
    service: 'ocr', host: 'ocr.tencentcloudapi.com',
    action: 'GeneralBasicOCR', version: '2018-11-19', region: 'ap-guangzhou',
    payload: { ImageBase64: imageBuffer.toString('base64') },
  });
  if (res.Response?.TextDetections?.length > 0) {
    return res.Response.TextDetections.map(t => t.DetectedText).join('\n');
  }
  return '';
}

async function ocrImagesConcurrent(buffers, concurrency = 5) {
  const results = [];
  for (let i = 0; i < buffers.length; i += concurrency) {
    const batch = buffers.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(async (buf, idx) => {
      const realIdx = i + idx;
      try {
        const text = await ocrImageBuffer(buf);
        return text;
      } catch (e) {
        console.error('[OCR] 第', realIdx + 1, '张失败:', e.message);
        return '';
      }
    }));
    results.push(...batchResults);
  }
  return results.filter(t => t.trim().length > 0);
}

async function ocrImages(fileIDs) {
  const buffers = await Promise.all(fileIDs.map(async fileID => {
    const downloadRes = await cloud.downloadFile({ fileID });
    return downloadRes.fileContent;
  }));
  const texts = await ocrImagesConcurrent(buffers, 5);
  return texts.join('\n\n');
}

// ===================== AI =====================
async function glmChat(prompt, timeout = 20000) {
  if (!GLM_API_KEY) return null;
  try {
    const response = await axios.post(
      'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      { model: 'glm-4-flash', messages: [{ role: 'user', content: prompt }], temperature: 0.1 },
      { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GLM_API_KEY}` }, timeout }
    );
    return response.data?.choices?.[0]?.message?.content || null;
  } catch (e) {
    console.error('[glm] 异常:', e.message);
    return null;
  }
}

async function aiAnswerQuestions(questions) {
  const needAnswer = questions.filter(q => !q.answer || q.answer.trim() === '');
  if (needAnswer.length === 0) return { success: true, answered: 0, total: 0, error: '' };
  if (!GLM_API_KEY) return { success: false, answered: 0, total: needAnswer.length, error: '未配置AI Key' };

  let totalAnswered = 0;
  const batchSize = 5;
  for (let i = 0; i < needAnswer.length; i += batchSize) {
    const batch = needAnswer.slice(i, i + batchSize);
    const prompt = `请判断以下选择题的正确答案，严格按 "1.A" 格式输出，不要解释。\n\n${batch.map((q, idx) => `${idx + 1}. ${q.question}\n${q.options.map(o => `${o.key}. ${o.text}`).join('\n')}`).join('\n\n')}\n\n请输出：\n1.\n2.\n...`;
    const aiText = await glmChat(prompt, 25000);
    if (aiText) {
      const regex = /(\d+)[\.．、\s]+([A-Da-d])/g;
      const answeredIndexes = new Set();
      let match;
      while ((match = regex.exec(aiText)) !== null) {
        const qIdx = parseInt(match[1]) - 1;
        if (qIdx >= 0 && qIdx < batch.length && !answeredIndexes.has(qIdx)) {
          batch[qIdx].answer = match[2].toUpperCase();
          answeredIndexes.add(qIdx);
          totalAnswered++;
        }
      }
    }
  }
  return { success: totalAnswered > 0, answered: totalAnswered, total: needAnswer.length, error: '' };
}

async function aiParseRawText(rawText) {
  if (!GLM_API_KEY) return null;
  const prompt = `请从以下文字中提取所有选择题，整理成标准JSON数组。只返回JSON，不要解释。每个题目包含 question、options（每项含key和text）、answer。\n\n${rawText.substring(0, 3000)}\n\n格式：[{"question":"...","options":[{"key":"A","text":"..."}],"answer":"A"}]`;
  const content = await glmChat(prompt, 30000);
  if (!content) return null;
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return null;
  try {
    const questions = JSON.parse(jsonMatch[0]);
    return questions.map(q => ({
      question: q.question || '',
      options: (q.options || []).filter(o => o.key && o.text).map(o => ({ key: o.key.toUpperCase(), text: o.text })),
      answer: (q.answer || '').toUpperCase(),
    })).filter(q => q.question.length > 3 && q.options.length >= 2);
  } catch (e) { return null; }
}

// 带学科、难度和题型约束的增强解析，旧函数保留作为兼容兜底。
async function aiAnswerQuestionsWithContext(questions, generationOptions = {}) {
  const options = normalizeGenerationOptions(generationOptions);
  const targets = questions.filter(q => !q.answer || !q.explanation);
  if (targets.length === 0) return { success: true, answered: 0, total: 0, explained: 0, error: '' };
  if (!GLM_API_KEY) return { success: false, answered: 0, total: targets.length, explained: 0, error: '未配置AI Key' };

  let answered = 0;
  let explained = 0;
  const batchSize = 5;
  for (let i = 0; i < targets.length; i += batchSize) {
    const batch = targets.slice(i, i + batchSize);
    const prompt = `你是严谨的${options.subject}教师。请判断下面题目的正确答案，并补充简洁、可读的解题思路。
学科：${options.subject}；难度：${options.difficulty}；题型：${options.questionType}。
只返回JSON数组，不要Markdown，不要额外说明。index从1开始，answer必须是选项key；无法确定时answer返回空字符串。
格式：[{"index":1,"answer":"A","explanation":"说明判断依据"}]

${batch.map((q, index) => `${index + 1}. ${q.question}\n${q.options.map(o => `${o.key}. ${o.text}`).join('\n')}`).join('\n\n')}`;
    const content = await glmChat(prompt, 30000);
    if (!content) continue;
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) continue;
    try {
      const results = JSON.parse(jsonMatch[0]);
      results.forEach(result => {
        const target = batch[Number(result.index) - 1];
        if (!target) return;
        const answer = String(result.answer || '').trim().toUpperCase();
        if (answer && target.options.some(option => option.key === answer)) {
          target.answer = answer;
          answered += 1;
        }
        const explanation = String(result.explanation || '').trim();
        if (explanation) {
          target.explanation = explanation;
          explained += 1;
        }
      });
    } catch (e) {
      console.error('[glm] 解析增强结果失败:', e.message);
    }
  }
  return { success: answered > 0 || explained > 0, answered, total: targets.length, explained, error: '' };
}

async function aiParseRawTextWithContext(rawText, generationOptions = {}) {
  if (!GLM_API_KEY) return null;
  const options = normalizeGenerationOptions(generationOptions);
  const typeRule = options.questionType === '判断题'
    ? '若原文没有明确选项，请生成A.对、B.错两项。'
    : '选择题必须保留或生成至少4个选项；自动识别时以原文题型为准。';
  const prompt = `请从下面的文字中提取或整理题目，输出标准JSON数组。学科：${options.subject}；难度：${options.difficulty}；题型偏好：${options.questionType}。
${typeRule}
每题包含question、options（每项包含key和text）、answer、explanation。只返回JSON，不要Markdown，不要解释。
格式：[{"question":"题干","options":[{"key":"A","text":"选项"}],"answer":"A","explanation":"简洁解析"}]

${rawText.substring(0, 6000)}`;
  const content = await glmChat(prompt, 30000);
  if (!content) return null;
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return null;
  try {
    const questions = JSON.parse(jsonMatch[0]);
    return questions.map(q => ({
      question: String(q.question || '').trim(),
      options: (q.options || []).filter(o => o.key && o.text).map(o => ({ key: String(o.key).toUpperCase(), text: String(o.text).trim() })),
      answer: String(q.answer || '').toUpperCase(),
      explanation: String(q.explanation || '').trim(),
    })).filter(q => q.question.length > 3 && q.options.length >= 2);
  } catch (e) {
    return null;
  }
}

// ===================== 文件解析 =====================
function parseTxt(buffer) { return buffer.toString('utf-8').replace(/^\uFEFF/, ''); }

async function parseDocx(buffer) {
  let textResult = '';
  try {
    const mammoth = require('mammoth');
    const r = await mammoth.extractRawText({ buffer });
    textResult = r.value || '';
  } catch (e) { textResult = ''; }
  console.log('[parseDocx] mammoth 文字长度:', textResult.length);

  if (textResult.length >= 100) return textResult;

  console.log('[parseDocx] 文字太少，尝试 mammoth 提取图片OCR...');
  try {
    const mammoth = require('mammoth');
    let imageIndex = 0;
    const imageMap = new Map();
    const options = {
      convertImage: mammoth.images.imgElement(function(image) {
        const currentIndex = imageIndex++;
        return image.read().then(function(imageBuffer) {
          imageMap.set(currentIndex, imageBuffer);
          return { src: '' };
        });
      })
    };
    await mammoth.convertToHtml({ buffer }, options);
    const imageBuffers = [];
    for (let i = 0; i < imageIndex; i++) {
      if (imageMap.has(i)) imageBuffers.push(imageMap.get(i));
    }
    console.log('[parseDocx] mammoth 提取到图片数:', imageBuffers.length);
    const validBuffers = imageBuffers.filter(buf => buf.length >= 5000);
    if (validBuffers.length === 0) return textResult;
    const ocrTexts = await ocrImagesConcurrent(validBuffers, 5);
    return ocrTexts.length > 0 ? ocrTexts.join('\n\n') : textResult;
  } catch (e) {
    console.error('[parseDocx] mammoth 图片提取失败:', e.message);
    return textResult;
  }
}

async function parsePdf(buffer) {
  try { const pdfParse = require('pdf-parse'); const data = await pdfParse(buffer); return { text: data.text, numpages: data.numpages || 0 }; }
  catch (e) { return { text: '', numpages: 0 }; }
}

async function parsePptx(buffer) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const slideEntries = entries
    .filter(e => e.entryName.match(/^ppt\/slides\/slide\d+\.xml$/i))
    .sort((a, b) => parseInt(a.entryName.match(/slide(\d+)\.xml/i)[1]) - parseInt(b.entryName.match(/slide(\d+)\.xml/i)[1]));
  const textLines = [];
  const decodeXmlText = value => value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
  for (const entry of slideEntries) {
    const xml = entry.getData().toString('utf-8');
    const lines = [];
    const paraRegex = /<a:p[\s>][\s\S]*?<\/a:p>/gi;
    let paraMatch;
    while ((paraMatch = paraRegex.exec(xml)) !== null) {
      const paraXml = paraMatch[0];
      const textRegex = /<a:t>([^<]*)<\/a:t>/g;
      const texts = [];
      let textMatch;
      while ((textMatch = textRegex.exec(paraXml)) !== null) texts.push(decodeXmlText(textMatch[1]));
      if (texts.length > 0) {
        const lineText = texts.join('').trim();
        if (lineText.length > 0) lines.push(lineText);
      }
    }
    textLines.push(...lines);
  }
  const textResult = textLines.join('\n');
  if (textResult.length >= 100) return textResult;
  const imageEntries = entries
    .filter(e => e.entryName.match(/^ppt\/media\/image\d+\.(png|jpg|jpeg)/i))
    .sort((a, b) => parseInt(a.entryName.match(/image(\d+)/i)?.[1] || 0) - parseInt(b.entryName.match(/image(\d+)/i)?.[1] || 0));
  const buffers = imageEntries.map(e => e.getData()).filter(buf => buf.length >= 5000);
  const ocrTexts = await ocrImagesConcurrent(buffers, 5);
  return ocrTexts.length > 0 ? ocrTexts.join('\n\n') : textResult;
}

// ===================== 图片格式检测 =====================
function isImageBuffer(buf) {
  if (!buf || buf.length < 8) return false;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true;
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true;
  if (buf[0] === 0x42 && buf[1] === 0x4D) return true;
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf.length > 8 && buf[8] === 0x57) return true;
  return false;
}

// ===================== 扫描版PDF分批处理 =====================
async function processPdfBatch(cosKey, startPage, batchSize, totalPages) {
  const COS_BUCKET = process.env.COS_BUCKET || '';
  const COS_REGION = process.env.COS_REGION || 'ap-guangzhou';
  if (!COS_BUCKET) throw new Error('COS_BUCKET未配置');

  const COS = require('cos-nodejs-sdk-v5');
  const cos = new COS({ SecretId: TENCENT_SECRET_ID, SecretKey: TENCENT_SECRET_KEY });
  const endPage = Math.min(startPage + batchSize - 1, totalPages);
  const texts = [];
  const logs = [];

  const pagePromises = [];
  for (let p = startPage; p <= endPage; p++) {
    pagePromises.push((async () => {
      try {
        const data = await new Promise((resolve, reject) => {
          cos.getObject({
            Bucket: COS_BUCKET, Region: COS_REGION, Key: cosKey,
            QueryString: `ci-process=doc-preview&page=${p}&dstType=png&ImageParams=${encodeURIComponent('imageMogr2/thumbnail/800x')}`,
          }, (err, data) => err ? reject(err) : resolve(data));
        });
        const contentType = data.headers?.['content-type'] || data.headers?.['Content-Type'] || '';
        const bodyBuf = data.Body;
        const isImg = contentType.includes('image') || isImageBuffer(bodyBuf);
        if (isImg) {
          return { page: p, isImage: true, buffer: bodyBuf };
        }
        return { page: p, isImage: false, bodyStr: bodyBuf.toString('utf-8').substring(0, 300) };
      } catch (e) {
        return { page: p, isImage: false, error: e.message };
      }
    })());
  }

  const pageResults = await Promise.all(pagePromises);

  const imageBuffers = pageResults.filter(r => r.isImage).map(r => r.buffer);
  const pageNumbers = pageResults.filter(r => r.isImage).map(r => r.page);
  if (imageBuffers.length > 0) {
    const ocrResults = await Promise.all(imageBuffers.map(async (buf, idx) => {
      try {
        const text = await ocrImageBuffer(buf);
        return { page: pageNumbers[idx], text };
      } catch (e) {
        return { page: pageNumbers[idx], text: '' };
      }
    }));
    ocrResults.forEach(r => {
      if (r.text.trim().length > 0) texts.push(r.text);
      logs.push(`第${r.page}页OCR: ${r.text.length}字`);
    });
  }

  const endSignal = pageResults.find(r => !r.isImage && r.bodyStr && ['not found', '超出', 'invalid page', 'pagenotfound', 'exceed', 'no such page', '页码'].some(k => r.bodyStr.toLowerCase().includes(k)));
  const isEnd = endSignal || endPage >= totalPages;

  return { texts, logs, nextPage: isEnd ? null : endPage + 1, isEnd };
}

async function createParseJob({ fileName, cosKey, totalPages, questionCount, subject, difficulty, questionType }) {
  const res = await db.collection(JOB_COLLECTION).add({
    data: {
      fileName,
      cosKey,
      totalPages,
      questionCount: normalizeQuestionCount(questionCount),
      subject,
      difficulty,
      questionType,
      status: 'processing',
      processedPages: 0,
      allTexts: [],
      questions: [],
      questionCountResult: 0,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
      error: ''
    }
  });
  return res._id;
}

async function updateParseJob(jobId, update) {
  await db.collection(JOB_COLLECTION).doc(jobId).update({
    data: { ...update, updatedAt: db.serverDate() }
  });
}

async function getParseJob(jobId) {
  const res = await db.collection(JOB_COLLECTION).doc(jobId).get();
  return res.data;
}

// ===================== 题目解析 =====================
function parseQuestionsFromText(text) {
  const questions = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map(l => l.trim()).filter(l => l.length > 0);
  let currentQuestion = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isQuestionStart = /^\d+[\.．、\s:]/.test(line)
      || /^[（(]\d+[)）]/.test(line)
      || /^第\d+题/.test(line)
      || /^\d+\.\s*/.test(line);
    const optionMatch = line.match(/^[(（]?([A-Da-d])[)）]?[\.．、\s:：]+(.+)$/)
      || line.match(/^([A-Da-d])[\.．、\s:：](.+)$/)
      || line.match(/^\s*([A-Da-d])\s+(.+)$/);

    if (isQuestionStart && !optionMatch) {
      if (currentQuestion && currentQuestion.options.length >= 2) {
        questions.push(currentQuestion);
      }
      const qText = line.replace(/^\d+[\.．、\s:]*/, '').replace(/^[（(]\d+[)）][\.．、\s:]*/, '').replace(/^第\d+题[\.．、\s:]*/, '');
      currentQuestion = { question: qText, options: [], answer: '', explanation: '' };
    } else if (optionMatch && currentQuestion) {
      const key = optionMatch[1].toUpperCase();
      const txt = optionMatch[2].trim();
      if (txt.length > 0 && !currentQuestion.options.find(o => o.key === key)) {
        currentQuestion.options.push({ key, text: txt });
      }
    } else if (currentQuestion && currentQuestion.options.length === 0) {
      currentQuestion.question += ' ' + line;
    } else if (!currentQuestion && line.length > 3) {
      const nextLine = lines[i + 1] || '';
      if (/^[(（]?[A-Da-d][)）]?[\.．、\s:：]/.test(nextLine)) {
        currentQuestion = { question: line, options: [], answer: '', explanation: '' };
      }
    }
  }

  if (currentQuestion && currentQuestion.options.length >= 2) {
    questions.push(currentQuestion);
  }

  extractAnswers(questions, text);
  return questions.filter(q => q.question.length > 3 && q.options.length >= 2);
}

function extractAnswers(questions, fullText) {
  const patterns = [/答案[:：]\s*([A-Da-d])/g, /正确答案[:：]\s*([A-Da-d])/g];
  for (const pattern of patterns) {
    let match; let idx = 0;
    while ((match = pattern.exec(fullText)) !== null) {
      if (idx < questions.length) questions[idx].answer = match[1].toUpperCase();
      idx++;
    }
  }
  const blockPatterns = [
    /(?:参考答案|答案)[\s\n]*(?:[:：])?[\s\n]*((?:\d+[\.．、\s]*[A-Da-d][\s\n]*)+)/i,
    /(?:一、|二、|三、|单选|多选)[\s\n]*((?:\d+[\.．、\s]*[A-Da-d][\s\n]*)+)/i,
  ];
  for (const bp of blockPatterns) {
    const bm = fullText.match(bp);
    if (bm?.[1]) {
      const al = bm[1].match(/\d+[\.．、\s]*([A-Da-d])/gi);
      if (al) al.forEach((ans, idx) => {
        const lm = ans.match(/([A-Da-d])$/i);
        if (lm && idx < questions.length) questions[idx].answer = lm[1].toUpperCase();
      });
    }
  }
  const inlinePattern = /(?:^|\n)\s*(\d+)[\.．、\s]+([A-Da-d])\s*(?=\n|$|\d+[\.．、])/g;
  let im;
  while ((im = inlinePattern.exec(fullText)) !== null) {
    const qn = parseInt(im[1]) - 1;
    if (qn >= 0 && qn < questions.length && !questions[qn].answer) questions[qn].answer = im[2].toUpperCase();
  }
}

// ===================== 主入口 =====================
exports.main = async (event, context) => {
  const { fileID, fileName, questionCount = 50, mode, imageFileIDs, jobId, subject, difficulty, questionType } = event;
  const requestedQuestionCount = normalizeQuestionCount(questionCount);
  const generationOptions = normalizeGenerationOptions({ subject, difficulty, questionType });

  try {
    // === 模式1: 查询进度 ===
    if (mode === 'scan_pdf_status' && jobId) {
      const job = await getParseJob(jobId);
      if (!job) return { code: -1, message: '任务不存在' };
      return {
        code: 0,
        data: {
          jobId, status: job.status, fileName: job.fileName, totalPages: job.totalPages,
          processedPages: job.processedPages, progress: `${job.processedPages}/${job.totalPages}`,
          questions: job.questions || [], questionCount: job.questionCountResult || 0,
          aiAnswered: (job.questions || []).filter(q => q.answer).length, error: job.error
        }
      };
    }

    // === 模式2: 继续处理扫描版PDF ===
    if (mode === 'scan_pdf_continue' && jobId) {
      const job = await getParseJob(jobId);
      if (!job) return { code: -1, message: '任务不存在' };
      if (job.status === 'done') {
        return {
          code: 0,
          data: {
            jobId, status: 'done', title: job.fileName?.replace(/\.[^.]+$/, '') || '题库',
            fileName: job.fileName, questionCount: job.questionCountResult || 0,
            questions: job.questions || [], sourceType: 'pdf_scan_auto', isScanFile: true,
            aiAnswered: (job.questions || []).filter(q => q.answer).length,
            aiDetail: { success: true, answered: (job.questions || []).filter(q => q.answer).length, total: job.questions?.length || 0 }
          }
        };
      }
      if (job.status === 'failed') return { code: -1, message: job.error || '处理失败' };

      const nextPage = job.processedPages + 1;
      const batchSize = 3;
      console.log('[scan_pdf_continue] 继续处理', job.fileName, '从第', nextPage, '页');

      const batchResult = await processPdfBatch(job.cosKey, nextPage, batchSize, job.totalPages);
      const newProcessed = batchResult.isEnd ? job.totalPages : nextPage + batchSize - 1;
      const allTexts = [...(job.allTexts || []), ...batchResult.texts];

      await updateParseJob(jobId, {
        processedPages: newProcessed, allTexts,
        status: batchResult.isEnd ? 'parsing' : 'processing'
      });

      if (batchResult.isEnd) {
        const fullText = allTexts.join('\n\n');
        console.log('[scan_pdf_continue] 全部完成，解析题目，文字长度:', fullText.length);
        const questions = parseQuestionsFromText(fullText).slice(0, job.questionCount);
        const aiResult = await aiAnswerQuestionsWithContext(questions, job);

        await updateParseJob(jobId, { status: 'done', questions, questionCountResult: questions.length });

        try {
          const COS = require('cos-nodejs-sdk-v5');
          const cos = new COS({ SecretId: TENCENT_SECRET_ID, SecretKey: TENCENT_SECRET_KEY });
          cos.deleteObject({ Bucket: process.env.COS_BUCKET || '', Region: process.env.COS_REGION || 'ap-guangzhou', Key: job.cosKey }, () => {});
        } catch (e) {}

        return {
          code: 0,
          data: {
            jobId, status: 'done', title: job.fileName?.replace(/\.[^.]+$/, '') || '题库',
            fileName: job.fileName, questionCount: questions.length, questions,
            sourceType: 'pdf_scan_auto', isScanFile: true,
            aiAnswered: questions.filter(q => q.answer).length, aiDetail: aiResult
          }
        };
      }

      return {
        code: 0,
        data: {
          jobId, status: 'processing', title: job.fileName?.replace(/\.[^.]+$/, '') || '题库',
          fileName: job.fileName, totalPages: job.totalPages, processedPages: newProcessed,
          progress: `${newProcessed}/${job.totalPages}`, isScanFile: true
        }
      };
    }

    // === 模式3: 常规入口 ===
    let extractedText = '';
    let sourceType = '';
    let isScanFile = false;

    if (mode === 'ocr_images' && imageFileIDs?.length > 0) {
      extractedText = await ocrImages(imageFileIDs);
      sourceType = 'ocr_image';
    } else if (fileID) {
      console.log('[parseDocument] 文件名:', fileName);
      const downloadRes = await cloud.downloadFile({ fileID });
      const fileBuffer = downloadRes.fileContent;
      const fileExt = fileName ? fileName.substring(fileName.lastIndexOf('.')).toLowerCase() : '';
      console.log('[parseDocument] 后缀:', fileExt, '大小:', fileBuffer.length);

      switch (fileExt) {
        case '.txt': extractedText = parseTxt(fileBuffer); break;
        case '.docx': extractedText = await parseDocx(fileBuffer); break;
        case '.jpg': case '.jpeg': case '.png':
          extractedText = await ocrImageBuffer(fileBuffer); sourceType = 'image_ocr'; break;
        case '.pdf': {
          const pdfResult = await parsePdf(fileBuffer);
          extractedText = pdfResult.text;
          if (!extractedText || extractedText.length < 100) {
            console.log('[parseDocument] 扫描版PDF，启动分批处理...');
            const totalPages = pdfResult.numpages || 50;
            console.log('[parseDocument] PDF总页数:', totalPages);

            const COS_BUCKET = process.env.COS_BUCKET || '';
            const COS_REGION = process.env.COS_REGION || 'ap-guangzhou';
            if (!COS_BUCKET) return { code: -1, message: '扫描版PDF需配置COS_BUCKET' };

            const COS = require('cos-nodejs-sdk-v5');
            const cos = new COS({ SecretId: TENCENT_SECRET_ID, SecretKey: TENCENT_SECRET_KEY });
            const cosKey = `tmp/shitu_pdf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.pdf`;

            await new Promise((resolve, reject) => {
              cos.putObject({ Bucket: COS_BUCKET, Region: COS_REGION, Key: cosKey, Body: fileBuffer, ContentType: 'application/pdf' },
                (err, data) => err ? reject(new Error('COS上传失败: ' + (err.message || JSON.stringify(err)))) : resolve(data));
            });
            console.log('[parseDocument] COS上传成功:', cosKey);

            const newJobId = await createParseJob({ fileName, cosKey, totalPages, questionCount, ...generationOptions });
            console.log('[parseDocument] Job创建:', newJobId);

            const batchResult = await processPdfBatch(cosKey, 1, 3, totalPages);
            const newProcessed = batchResult.isEnd ? totalPages : 3;
            await updateParseJob(newJobId, {
              processedPages: newProcessed, allTexts: batchResult.texts,
              status: batchResult.isEnd ? 'parsing' : 'processing'
            });

            if (batchResult.isEnd) {
              const fullText = batchResult.texts.join('\n\n');
              const questions = parseQuestionsFromText(fullText).slice(0, requestedQuestionCount);
              const aiResult = await aiAnswerQuestionsWithContext(questions, generationOptions);
              await updateParseJob(newJobId, { status: 'done', questions, questionCountResult: questions.length });
              cos.deleteObject({ Bucket: COS_BUCKET, Region: COS_REGION, Key: cosKey }, () => {});
              return {
                code: 0,
                data: {
                  jobId: newJobId, status: 'done', title: fileName?.replace(/\.[^.]+$/, '') || '题库',
                  fileName, questionCount: questions.length, questions,
                  sourceType: 'pdf_scan_auto', isScanFile: true,
                  aiAnswered: questions.filter(q => q.answer).length, aiDetail: aiResult
                }
              };
            }

            return {
              code: 0,
              data: {
                jobId: newJobId, status: 'processing', title: fileName?.replace(/\.[^.]+$/, '') || '题库',
                fileName, totalPages, processedPages: newProcessed,
                progress: `${newProcessed}/${totalPages}`, isScanFile: true
              }
            };
          } else { sourceType = 'pdf_text'; }
          break;
        }
        case '.pptx':
          extractedText = await parsePptx(fileBuffer); sourceType = 'pptx'; break;
        case '.ppt':
          if (fileBuffer.length > 2 && fileBuffer[0] === 0x50 && fileBuffer[1] === 0x4B) {
            extractedText = await parsePptx(fileBuffer); sourceType = 'pptx';
          } else {
            return { code: -1, message: '旧版.ppt暂不支持，请另存为.pptx' };
          }
          break;
        default:
          return { code: -1, message: '不支持的格式: ' + fileExt };
      }
    } else {
      return { code: -1, message: '缺少文件' };
    }

    console.log('[parseDocument] 文字长度:', extractedText.length);

    if (!extractedText || extractedText.length < 20) {
      return { code: -1, message: '未能识别到有效文字' };
    }

    const questions = parseQuestionsFromText(extractedText).slice(0, requestedQuestionCount);
    console.log('[parseDocument] 解析题目数:', questions.length);

    if (questions.length === 0) {
      const aiQuestions = (await aiParseRawTextWithContext(extractedText, generationOptions))?.slice(0, requestedQuestionCount);
      if (aiQuestions?.length > 0) {
        const aiResult = await aiAnswerQuestionsWithContext(aiQuestions, generationOptions);
        return { code: 0, data: { title: fileName?.replace(/\.[^.]+$/, '') || '题库', fileName, questionCount: aiQuestions.length, questions: aiQuestions, sourceType: sourceType + '_ai', isScanFile, aiAnswered: aiQuestions.filter(q => q.answer).length, aiDetail: { ...aiResult, parsedByAI: true } } };
      }
      return { code: -1, message: '未能解析到选择题格式', rawText: extractedText.substring(0, 2000) };
    }

    const aiResult = await aiAnswerQuestionsWithContext(questions, generationOptions);
    return { code: 0, data: { title: fileName?.replace(/\.[^.]+$/, '') || '题库', fileName, questionCount: questions.length, questions, sourceType, isScanFile, aiAnswered: questions.filter(q => q.answer).length, aiDetail: aiResult } };

  } catch (err) {
    console.error('[parseDocument] 异常:', err.message);
    console.error('[parseDocument] 堆栈:', err.stack);
    return { code: -1, message: err.message || '解析失败' };
  }
};

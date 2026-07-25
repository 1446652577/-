const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// ===================== 配置 =====================
const TENCENT_SECRET_ID = process.env.TENCENT_SECRET_ID || '';
const TENCENT_SECRET_KEY = process.env.TENCENT_SECRET_KEY || '';
const GLM_API_KEY = process.env.ZHIPU_API_KEY || '';

const axios = require('axios');

// ===================== 腾讯云通用API签名 =====================
async function tencentApiCall({ service, host, action, version, region, payload, timeout = 30000 }) {
  if (!TENCENT_SECRET_ID || !TENCENT_SECRET_KEY) {
    throw new Error('腾讯云API未配置：请在云函数环境变量中设置 TENCENT_SECRET_ID 和 TENCENT_SECRET_KEY');
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().split('T')[0];

  const payloadStr = JSON.stringify(payload);
  const payloadHash = require('crypto').createHash('sha256').update(payloadStr).digest('hex');

  const headers = {
    'Content-Type': 'application/json',
    'Host': host,
    'X-TC-Action': action,
    'X-TC-Version': version,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Region': region,
  };

  const httpRequestMethod = 'POST';
  const canonicalUri = '/';
  const canonicalQueryString = '';
  const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = `${httpRequestMethod}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const algorithm = 'TC3-HMAC-SHA256';
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = `${algorithm}\n${timestamp}\n${credentialScope}\n${require('crypto').createHash('sha256').update(canonicalRequest).digest('hex')}`;

  const secretDate = require('crypto').createHmac('sha256', `TC3${TENCENT_SECRET_KEY}`).update(date).digest();
  const secretService = require('crypto').createHmac('sha256', secretDate).update(service).digest();
  const secretSigning = require('crypto').createHmac('sha256', secretService).update('tc3_request').digest();
  const signature = require('crypto').createHmac('sha256', secretSigning).update(stringToSign).digest('hex');

  headers['Authorization'] = `${algorithm} Credential=${TENCENT_SECRET_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  console.log(`[tencentApiCall] ${service}/${action} 请求签名完成，开始调用...`);
  const response = await axios.post(`https://${host}`, payloadStr, { headers, timeout });

  if (response.data && response.data.Response && response.data.Response.Error) {
    const err = response.data.Response.Error;
    throw new Error(`[${err.Code}] ${err.Message}`);
  }

  return response.data;
}

// ===================== OCR 识别 =====================
async function tencentOcrApi(imageBase64) {
  return tencentApiCall({
    service: 'ocr',
    host: 'ocr.tencentcloudapi.com',
    action: 'GeneralBasicOCR',
    version: '2018-11-19',
    region: 'ap-guangzhou',
    payload: { ImageBase64: imageBase64 },
  });
}

async function ocrImageBuffer(imageBuffer) {
  const base64Data = imageBuffer.toString('base64');
  const res = await tencentOcrApi(base64Data);

  if (res.Response && res.Response.TextDetections && res.Response.TextDetections.length > 0) {
    return res.Response.TextDetections.map(t => t.DetectedText).join('\n');
  }
  if (res.Response && res.Response.Error) {
    throw new Error('OCR错误: ' + res.Response.Error.Message);
  }
  return '';
}

async function ocrImages(fileIDs) {
  const texts = [];
  for (let i = 0; i < fileIDs.length; i++) {
    console.log('[OCR] 识别第', i + 1, '张...');
    const downloadRes = await cloud.downloadFile({ fileID: fileIDs[i] });
    const text = await ocrImageBuffer(downloadRes.fileContent);
    texts.push(text);
  }
  return texts.join('\n\n');
}

// ===================== AI答题（多模型降级）====================
// 模型1：智谱GLM-4-Flash（按Token计费，成本极低）
async function glmChat(prompt, timeout = 20000) {
  if (!GLM_API_KEY) {
    console.log('[AI] 智谱API Key未配置，跳过');
    return null;
  }

  console.log('[glm] ===== 开始调用智谱GLM-4-Flash =====');
  console.log('[glm] prompt长度:', prompt.length);

  try {
    const response = await axios.post(
      'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      {
        model: 'glm-4-flash',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GLM_API_KEY}`,
        },
        timeout,
      }
    );

    if (response.data && response.data.choices && response.data.choices.length > 0) {
      const content = response.data.choices[0].message.content;
      console.log('[glm] AI返回内容前300字:', content.substring(0, 300));
      return content;
    }

    console.log('[glm] 未从响应中提取到有效内容');
    return null;
  } catch (e) {
    console.error('[glm] 调用异常:', e.message);
    if (e.response && e.response.data) {
      console.error('[glm] 错误详情:', JSON.stringify(e.response.data));
    }
    return null;
  }
}

// 批量AI答题：一次处理最多5道题
async function aiAnswerQuestions(questions) {
  const needAnswer = questions.filter(q => !q.answer || q.answer.trim() === '');
  if (needAnswer.length === 0) return { success: true, answered: 0, total: 0, error: '' };

  // 如果没有配置任何AI Key，直接跳过
  if (!GLM_API_KEY) {
    console.log('[AI] 未配置AI API Key，跳过AI答题');
    return { success: false, answered: 0, total: needAnswer.length, error: '未配置AI答题Key' };
  }

  console.log('[AI] 需要AI判断答案的题目数:', needAnswer.length);
  let totalAnswered = 0;
  let lastError = '';

  // 分批处理，每批最多5题，防止prompt过长
  const batchSize = 5;
  for (let i = 0; i < needAnswer.length; i += batchSize) {
    const batch = needAnswer.slice(i, i + batchSize);
    const prompt = buildAnswerPrompt(batch);

    console.log('[AI] ===== 正在处理第', i + 1, '-', Math.min(i + batchSize, needAnswer.length), '题 =====');

    try {
      const aiResponse = await glmChat(prompt, 25000);
      if (aiResponse) {
        const answeredInBatch = parseAiAnswers(batch, aiResponse);
        totalAnswered += answeredInBatch;
        console.log('[AI] 本批成功解析答案数:', answeredInBatch);
      } else {
        console.log('[AI] 本批未获得有效返回');
      }
    } catch (e) {
      console.error('[AI] 本批调用失败:', e.message);
      lastError = e.message;
    }
  }

  return {
    success: totalAnswered > 0,
    answered: totalAnswered,
    total: needAnswer.length,
    error: lastError
  };
}

function buildAnswerPrompt(questions) {
  let prompt = '请判断以下选择题的正确答案，严格按 "1.A" 的格式输出每道题的答案，不要任何解释，只输出答案列表。\n\n';
  questions.forEach((q, idx) => {
    prompt += `${idx + 1}. ${q.question}\n`;
    q.options.forEach(opt => {
      prompt += `${opt.key}. ${opt.text}\n`;
    });
    prompt += '\n';
  });
  prompt += '请输出：\n1.\n2.\n3.\n...（以此类推）';
  return prompt;
}

function parseAiAnswers(questions, aiText) {
  // 匹配 "1.A" 或 "1、A" 或 "1 A" 等格式
  const regex = /(\d+)[\.．、\s]+([A-Da-d])/g;
  let match;
  let answered = 0;
  while ((match = regex.exec(aiText)) !== null) {
    const qIdx = parseInt(match[1]) - 1;
    if (qIdx >= 0 && qIdx < questions.length) {
      questions[qIdx].answer = match[2].toUpperCase();
      answered++;
      console.log('[AI] 题目', questions[qIdx].question.substring(0, 20), '-> 答案:', questions[qIdx].answer);
    }
  }
  return answered;
}

// ===================== AI智能解析原始文字（格式不规范时兜底）====================
async function aiParseRawText(rawText) {
  if (!GLM_API_KEY) {
    console.log('[AI Parse] 未配置API Key');
    return null;
  }
  
  // 截取前3000字，防止prompt过长
  const truncatedText = rawText.substring(0, 3000);
  
  const prompt = `请从以下文字中提取所有选择题，并整理成标准JSON格式返回。注意：
1. 只返回JSON数组，不要任何解释文字
2. 每个题目包含 question（题干）、options（选项数组，每项含key和text）、answer（答案字母）
3. 如果文字中没有答案，answer留空字符串
4. 选项只有A-D四种

文字内容：
${truncatedText}

请严格按以下格式返回：
[
  {"question":"题干内容","options":[{"key":"A","text":"选项A内容"},{"key":"B","text":"选项B内容"}],"answer":"A"},
  ...
]`;

  console.log('[AI Parse] 调用AI解析原始文字...');
  try {
    const response = await axios.post(
      'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      {
        model: 'glm-4-flash',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GLM_API_KEY}`,
        },
        timeout: 30000,
      }
    );

    if (response.data && response.data.choices && response.data.choices.length > 0) {
      const content = response.data.choices[0].message.content;
      console.log('[AI Parse] AI返回内容前500字:', content.substring(0, 500));
      
      // 尝试从AI返回中提取JSON
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const questions = JSON.parse(jsonMatch[0]);
        console.log('[AI Parse] 解析到题目数:', questions.length);
        // 标准化字段
        return questions.map(q => ({
          question: q.question || '',
          options: (q.options || []).filter(o => o.key && o.text).map(o => ({ key: o.key.toUpperCase(), text: o.text })),
          answer: (q.answer || '').toUpperCase(),
          explanation: q.explanation || '',
        })).filter(q => q.question.length > 5 && q.options.length >= 2);
      }
    }
    return null;
  } catch (e) {
    console.error('[AI Parse] 解析失败:', e.message);
    return null;
  }
}

// ===================== 文件解析 =====================
function parseTxt(buffer) { return buffer.toString('utf-8'); }

async function parseDocx(buffer) {
  try { const mammoth = require('mammoth'); const r = await mammoth.extractRawText({ buffer }); return r.value; }
  catch (e) { return ''; }
}

async function parsePdf(buffer) {
  try { const pdfParse = require('pdf-parse'); const data = await pdfParse(buffer); return data.text; }
  catch (e) { return ''; }
}

// ===================== 扫描版PDF自动处理（数据万象方案）====================
// 需要配置：腾讯云COS存储桶 + 数据万象文档预览服务
async function handleScanPdf(fileBuffer) {
  const COS_BUCKET = process.env.COS_BUCKET || '';
  const COS_REGION = process.env.COS_REGION || 'ap-guangzhou';

  if (!COS_BUCKET) {
    return {
      success: false,
      error: '扫描版PDF自动识别需配置腾讯云COS存储桶。操作步骤：\n1. 登录腾讯云控制台，搜索「对象存储COS」并开通\n2. 创建存储桶（Bucket名称格式：xxx-你的APPID，区域选ap-guangzhou）\n3. 搜索「数据万象CI」，开通后绑定该存储桶\n4. 在云开发控制台 → 云函数 → parseDocument → 环境变量中设置：\n   COS_BUCKET=你的桶名（如mybucket-1250000000）\n   COS_REGION=ap-guangzhou'
    };
  }

  if (!TENCENT_SECRET_ID || !TENCENT_SECRET_KEY) {
    return { success: false, error: '腾讯云API密钥未配置，无法调用数据万象' };
  }

  const COS = require('cos-nodejs-sdk-v5');
  const cos = new COS({
    SecretId: TENCENT_SECRET_ID,
    SecretKey: TENCENT_SECRET_KEY,
  });

  const tmpKey = `tmp/shitu_pdf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.pdf`;
  const MAX_PAGES = 5;
  const texts = [];

  try {
    // 1. 上传PDF到COS
    console.log('[scanPdf] 上传PDF到COS:', COS_BUCKET, tmpKey);
    await new Promise((resolve, reject) => {
      cos.putObject({
        Bucket: COS_BUCKET,
        Region: COS_REGION,
        Key: tmpKey,
        Body: fileBuffer,
        ContentType: 'application/pdf',
      }, (err, data) => {
        if (err) {
          console.error('[scanPdf] COS上传失败:', err);
          reject(new Error('COS上传失败: ' + (err.message || JSON.stringify(err))));
        } else {
          console.log('[scanPdf] COS上传成功');
          resolve(data);
        }
      });
    });

    // 2. 逐页调用数据万象同步预览（PDF转图片）
    for (let page = 1; page <= MAX_PAGES; page++) {
      console.log('[scanPdf] 请求数据万象第', page, '页预览...');
      try {
        const data = await new Promise((resolve, reject) => {
          cos.getObject({
            Bucket: COS_BUCKET,
            Region: COS_REGION,
            Key: tmpKey,
            QueryString: `ci-process=doc-preview&page=${page}&dstType=png&ImageParams=${encodeURIComponent('imageMogr2/thumbnail/1200x')}`,
          }, (err, data) => {
            if (err) reject(err);
            else resolve(data);
          });
        });

        // 检查返回内容类型
        const contentType = data.headers && (data.headers['content-type'] || data.headers['Content-Type']);
        if (contentType && contentType.includes('image')) {
          const text = await ocrImageBuffer(data.Body);
          if (text && text.trim().length > 0) {
            texts.push(text);
            console.log('[scanPdf] 第', page, '页识别到', text.length, '字');
          }
        } else {
          // 返回的不是图片，可能是XML错误
          const bodyStr = data.Body.toString('utf-8').substring(0, 300);
          console.error('[scanPdf] 第', page, '页返回非图片:', bodyStr);
          if (page === 1) {
            throw new Error('数据万象返回错误，请检查：1.是否已开通数据万象 2.是否已绑定存储桶 3.存储桶区域是否正确。错误信息：' + bodyStr);
          }
          break; // 后续页不存在，退出
        }
      } catch (e) {
        console.error('[scanPdf] 第', page, '页处理失败:', e.message);
        if (page === 1) {
          // 第1页就失败，可能是服务未开通
          throw new Error('数据万象文档预览失败：' + e.message);
        }
        break; // 后续页不存在
      }
    }

    return {
      success: texts.length > 0,
      text: texts.join('\n\n'),
      pageCount: texts.length,
      error: texts.length === 0 ? '未能识别到有效文字' : '',
    };

  } catch (e) {
    console.error('[scanPdf] 处理失败:', e.message);
    return { success: false, error: e.message };
  } finally {
    // 3. 清理COS临时文件（异步，不等待）
    try {
      cos.deleteObject({
        Bucket: COS_BUCKET,
        Region: COS_REGION,
        Key: tmpKey,
      }, () => {});
    } catch (e) {}
  }
}
// ===================== 扫描版PDF自动处理（腾讯云COS数据万象）====================
async function handleScanPdf(fileBuffer) {
  const COS_BUCKET = process.env.COS_BUCKET || '';
  const COS_REGION = process.env.COS_REGION || 'ap-guangzhou';

  if (!COS_BUCKET) {
    return {
      success: false,
      error: '扫描版PDF自动识别需配置腾讯云COS。步骤：\n1. 登录腾讯云控制台，搜索「对象存储COS」并开通\n2. 创建存储桶：名称格式 xxx-你的APPID，区域选ap-guangzhou，访问权限选「公有读私有写」\n3. 搜索「数据万象CI」，开通后绑定该存储桶\n4. 在云开发控制台 → 云函数 → parseDocument → 环境变量中设置：COS_BUCKET=你的桶名（如mybucket-1250000000），COS_REGION=ap-guangzhou'
    };
  }

  if (!TENCENT_SECRET_ID || !TENCENT_SECRET_KEY) {
    return { success: false, error: '腾讯云API密钥未配置' };
  }

  const COS = require('cos-nodejs-sdk-v5');
  const cos = new COS({
    SecretId: TENCENT_SECRET_ID,
    SecretKey: TENCENT_SECRET_KEY,
  });

  const tmpKey = `tmp/shitu_pdf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.pdf`;
  const MAX_PAGES = 5;
  const texts = [];

  try {
    // 1. 上传PDF到COS
    console.log('[scanPdf] 上传PDF到COS:', COS_BUCKET, tmpKey);
    await new Promise((resolve, reject) => {
      cos.putObject({
        Bucket: COS_BUCKET,
        Region: COS_REGION,
        Key: tmpKey,
        Body: fileBuffer,
        ContentType: 'application/pdf',
      }, (err, data) => {
        if (err) reject(new Error('COS上传失败: ' + (err.message || JSON.stringify(err))));
        else resolve(data);
      });
    });

    // 2. 逐页调用数据万象同步预览（PDF转PNG）
    for (let page = 1; page <= MAX_PAGES; page++) {
      console.log('[scanPdf] 请求数据万象第', page, '页预览...');
      try {
        const data = await new Promise((resolve, reject) => {
          cos.getObject({
            Bucket: COS_BUCKET,
            Region: COS_REGION,
            Key: tmpKey,
            QueryString: `ci-process=doc-preview&page=${page}&dstType=png`,
          }, (err, data) => {
            if (err) reject(err);
            else resolve(data);
          });
        });

        const contentType = data.headers && (data.headers['content-type'] || data.headers['Content-Type']);
        if (contentType && contentType.includes('image')) {
          const text = await ocrImageBuffer(data.Body);
          if (text && text.trim().length > 0) {
            texts.push(text);
            console.log('[scanPdf] 第', page, '页识别到', text.length, '字');
          }
        } else {
          // 返回的不是图片，可能已到末尾或报错
          const bodyStr = data.Body.toString('utf-8').substring(0, 200);
          console.log('[scanPdf] 第', page, '页返回非图片:', bodyStr);
          if (page === 1) {
            throw new Error('数据万象返回错误，请检查：1.是否已开通数据万象 2.是否已绑定存储桶。错误：' + bodyStr);
          }
          break;
        }
      } catch (e) {
        console.error('[scanPdf] 第', page, '页失败:', e.message);
        if (page === 1) throw new Error('数据万象文档预览失败：' + e.message);
        break;
      }
    }

    return {
      success: texts.length > 0,
      text: texts.join('\n\n'),
      pageCount: texts.length,
      error: texts.length === 0 ? '未能识别到有效文字' : '',
    };

  } catch (e) {
    console.error('[scanPdf] 处理失败:', e.message);
    return { success: false, error: e.message };
  } finally {
    // 3. 清理COS临时文件
    try {
      cos.deleteObject({ Bucket: COS_BUCKET, Region: COS_REGION, Key: tmpKey }, () => {});
    } catch (e) {}
  }
}
// 注意：微信云函数默认环境无 ImageMagick/pdftoppm，且内存仅512MB、超时60秒，
// 在云函数内做PDF转图片+OCR会内存溢出/超时。扫描版PDF请使用「截图上传」功能。
async function handleScanPdf(fileBuffer) {
  console.log('[scanPdf] 检测到扫描版PDF，云函数环境不支持PDF转图片，建议截图上传');
  return { 
    success: false, 
    error: '扫描版PDF暂不支持自动识别。请打开PDF→逐页截图→使用「截图上传」功能。如需自动识别可接入腾讯云COS数据万象。' 
  };
}
function parsePptx(buffer) {
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();

    // 找出所有 slide XML 并按序号排序
    const slideEntries = entries
      .filter(e => e.entryName.match(/^ppt\/slides\/slide\d+\.xml$/i))
      .sort((a, b) => {
        const numA = parseInt(a.entryName.match(/slide(\d+)\.xml/i)[1]);
        const numB = parseInt(b.entryName.match(/slide(\d+)\.xml/i)[1]);
        return numA - numB;
      });

    console.log('[parsePptx] 找到幻灯片数量:', slideEntries.length);

    if (slideEntries.length === 0) {
      throw new Error('PPTX 中未找到幻灯片内容');
    }

    const allLines = [];
    for (const entry of slideEntries) {
      const xml = entry.getData().toString('utf-8');
      const slideLines = extractTextFromSlideXml(xml);
      console.log('[parsePptx] 幻灯片', entry.entryName, '提取行数:', slideLines.length);
      allLines.push(...slideLines);
    }

    const result = allLines.join('\n');
    console.log('[parsePptx] 总提取文字长度:', result.length);
    return result;
  } catch (e) {
    console.error('[parsePptx] 解析失败:', e.message);
    throw new Error('PPTX 解析失败: ' + e.message);
  }
}

// 按段落提取PPTX slide中的文字
function extractTextFromSlideXml(xml) {
  const lines = [];

  const paraRegex = /<a:p[\s>][\s\S]*?<\/a:p>/gi;
  let paraMatch;

  while ((paraMatch = paraRegex.exec(xml)) !== null) {
    const paraXml = paraMatch[0];
    const textRegex = /<a:t>([^<]*)<\/a:t>/g;
    const texts = [];
    let textMatch;
    while ((textMatch = textRegex.exec(paraXml)) !== null) {
      texts.push(textMatch[1]);
    }
    if (texts.length > 0) {
      const lineText = texts.join('').trim();
      if (lineText.length > 0) {
        lines.push(lineText);
      }
    }
  }

  if (lines.length === 0) {
    const fallbackRegex = /<a:t>([^<]*)<\/a:t>/g;
    let match;
    while ((match = fallbackRegex.exec(xml)) !== null) {
      const t = match[1].trim();
      if (t.length > 0) lines.push(t);
    }
  }

  return lines;
}

// ===================== 题目结构化解析（增强版，支持多种格式）====================
function parseQuestionsFromText(text) {
  const questions = [];
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  let currentQuestion = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // 题目开头模式：支持 "1." "1、" "（1）" "第1题" "1 " 等
    const isQuestionStart = /^\d+[\.．、\s]/.test(line) || /^[（(]\d+[)）]/.test(line) || /^第\d+题/.test(line);
    
    // 选项模式：支持 "A." "A、" "A)" "(A)" "A " 等，后跟文字
    const optionMatch = line.match(/^[(（]?([A-Da-d])[)）]?[\.．、\s]+(.+)$/) || line.match(/^([A-Da-d])[\.．、\s](.+)$/);

    if (isQuestionStart && !optionMatch) {
      // 保存上一题
      if (currentQuestion && currentQuestion.options.length >= 2) {
        questions.push(currentQuestion);
      }
      // 清理题目前的编号
      const qText = line.replace(/^\d+[\.．、\s]*/, '').replace(/^[（(]\d+[)）][\.．、\s]*/, '').replace(/^第\d+题[\.．、\s]*/, '');
      currentQuestion = { question: qText, options: [], answer: '', explanation: '' };
    } else if (optionMatch && currentQuestion) {
      const key = optionMatch[1].toUpperCase();
      const text = optionMatch[2].trim();
      if (text.length > 0 && !currentQuestion.options.find(o => o.key === key)) {
        currentQuestion.options.push({ key, text });
      }
    } else if (currentQuestion && currentQuestion.options.length === 0) {
      // 题目内容换行续接
      currentQuestion.question += ' ' + line;
    } else if (!currentQuestion && line.length > 5) {
      // 无编号题目：如果当前没有题目，且这行不是选项，可能是一个新题目的开始（无编号）
      // 检查下一行是否是选项
      const nextLine = lines[i + 1] || '';
      const nextIsOption = /^[(（]?[A-Da-d][)）]?[\.．、\s]/.test(nextLine);
      if (nextIsOption) {
        currentQuestion = { question: line, options: [], answer: '', explanation: '' };
      }
    }
  }

  if (currentQuestion && currentQuestion.options.length >= 2) {
    questions.push(currentQuestion);
  }

  extractAnswers(questions, text);
  
  // 过滤：题干至少5个字，至少2个选项，每个选项有文字
  const valid = questions.filter(q => q.question.length > 5 && q.options.length >= 2 && q.options.every(o => o.text.length > 0));
  
  console.log('[parseQuestions] 原始行数:', lines.length, '识别题目数:', valid.length);
  return valid;
}
function parseQuestionsFromText(text) {
  const questions = [];
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  let currentQuestion = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isQuestionStart = /^\d+[\.．、\s]/.test(line) || /^[（(]\d+[)）]/.test(line) || /^第\d+题/.test(line);
    const optionMatch = line.match(/^([A-Da-d])[\.．、\s]*(.+)$/);

    if (isQuestionStart && !optionMatch) {
      if (currentQuestion && currentQuestion.options.length >= 2) {
        questions.push(currentQuestion);
      }
      const qText = line.replace(/^\d+[\.．、\s]*/, '').replace(/^[（(]\d+[)）][\.．、\s]*/, '').replace(/^第\d+题[\.．、\s]*/, '');
      currentQuestion = { question: qText, options: [], answer: '', explanation: '' };
    } else if (optionMatch && currentQuestion) {
      const key = optionMatch[1].toUpperCase();
      const text = optionMatch[2].trim();
      if (!currentQuestion.options.find(o => o.key === key)) {
        currentQuestion.options.push({ key, text });
      }
    } else if (currentQuestion && currentQuestion.options.length === 0) {
      currentQuestion.question += line;
    }
  }

  if (currentQuestion && currentQuestion.options.length >= 2) {
    questions.push(currentQuestion);
  }

  extractAnswers(questions, text);
  return questions.filter(q => q.question.length > 5 && q.options.length >= 2 && q.options.every(o => o.text.length > 0));
}

function extractAnswers(questions, fullText) {
  // 模式1：答案/正确答案: A
  const answerPatterns = [/答案[:：]\s*([A-Da-d])/g, /正确答案[:：]\s*([A-Da-d])/g];
  for (const pattern of answerPatterns) {
    let match; let idx = 0;
    while ((match = pattern.exec(fullText)) !== null) {
      if (idx < questions.length) questions[idx].answer = match[1].toUpperCase();
      idx++;
    }
  }

  // 模式2：参考答案列表格式
  const answerBlockPatterns = [
    /(?:参考答案|答案)[\s\n]*(?:[:：])?[\s\n]*((?:\d+[\.．、\s]*[A-Da-d][\s\n]*)+)/i,
    /(?:一、|二、|三、|单选|多选)[\s\n]*((?:\d+[\.．、\s]*[A-Da-d][\s\n]*)+)/i,
  ];

  for (const blockPattern of answerBlockPatterns) {
    const blockMatch = fullText.match(blockPattern);
    if (blockMatch && blockMatch[1]) {
      const answerList = blockMatch[1].match(/\d+[\.．、\s]*([A-Da-d])/gi);
      if (answerList) {
        answerList.forEach((ans, idx) => {
          const letterMatch = ans.match(/([A-Da-d])$/i);
          if (letterMatch && idx < questions.length) {
            questions[idx].answer = letterMatch[1].toUpperCase();
          }
        });
      }
    }
  }

  // 模式3：行内独立答案
  const inlineAnswerPattern = /(?:^|\n)\s*(\d+)[\.．、\s]+([A-Da-d])\s*(?=\n|$|\d+[\.．、])/g;
  let inlineMatch;
  while ((inlineMatch = inlineAnswerPattern.exec(fullText)) !== null) {
    const qNum = parseInt(inlineMatch[1]) - 1;
    if (qNum >= 0 && qNum < questions.length && !questions[qNum].answer) {
      questions[qNum].answer = inlineMatch[2].toUpperCase();
    }
  }
}

// ===================== 主入口 =====================

exports.main = async (event, context) => {
  const { fileID, fileName, questionCount = 50, mode, imageFileIDs } = event;

  try {
    let extractedText = '';
    let sourceType = '';
    let isScanFile = false;

    // ===== 模式1：批量图片OCR =====
    if (mode === 'ocr_images' && imageFileIDs && imageFileIDs.length > 0) {
      console.log('[parseDocument] 图片OCR模式，数量:', imageFileIDs.length);
      extractedText = await ocrImages(imageFileIDs);
      sourceType = 'ocr_image';
    }
    // ===== 模式2：单文件解析 =====
    else if (fileID) {
      console.log('[parseDocument] 单文件模式，文件名:', fileName);
      const downloadRes = await cloud.downloadFile({ fileID });
      const fileBuffer = downloadRes.fileContent;
      const fileExt = fileName ? fileName.substring(fileName.lastIndexOf('.')).toLowerCase() : '';
      console.log('[parseDocument] 文件后缀:', fileExt, '大小:', fileBuffer.length, '字节');

      switch (fileExt) {
        case '.txt': extractedText = parseTxt(fileBuffer); break;
        case '.docx': extractedText = await parseDocx(fileBuffer); break;
        case '.pdf':
          extractedText = await parsePdf(fileBuffer);
          // 如果提取文字太少，判定为扫描版PDF，尝试自动转图片OCR
          if (!extractedText || extractedText.length < 100) {
            console.log('[parseDocument] 检测到扫描版PDF，尝试自动转图片OCR...');
            const scanRes = await handleScanPdf(fileBuffer);
            if (scanRes.success) {
              extractedText = scanRes.text;
              sourceType = 'pdf_scan_auto';
              console.log('[parseDocument] 扫描版PDF自动识别成功，共', scanRes.pageCount, '页，识别文字长度:', extractedText.length);
            } else {
              console.log('[parseDocument] 扫描版PDF自动处理失败:', scanRes.error);
              isScanFile = true;
              return {
                code: 0,
                data: {
                  title: fileName ? fileName.replace(/\.[^.]+$/, '') : '题库',
                  fileName,
                  isScanFile: true,
                  sourceType: 'pdf_scan',
                  questions: [],
                  questionCount: 0,
                  aiAnswered: 0,
                  aiDetail: { success: false, answered: 0, total: 0, error: scanRes.error || '扫描版PDF自动识别失败，请使用截图上传功能' },
                }
              };
            }
          } else {
            sourceType = 'pdf_text';
          }
          break;
        case '.pptx':
          extractedText = parsePptx(fileBuffer);
          sourceType = 'pptx';
          break;
        case '.ppt':
          {
            // 检查文件头是否为zip格式（有些pptx文件被误标为.ppt）
            const isZip = fileBuffer.length > 2 && fileBuffer[0] === 0x50 && fileBuffer[1] === 0x4B;
            if (isZip) {
              console.log('[parseDocument] 文件扩展名为.ppt但实际为zip格式，按pptx处理');
              extractedText = parsePptx(fileBuffer);
              sourceType = 'pptx';
            } else {
              return { code: -1, message: '旧版 .ppt 格式暂不支持，请将文件另存为 .pptx 格式后上传，或使用「截图上传」功能' };
            }
          }
          break;
        default:
          return { code: -1, message: '不支持的文件格式: ' + fileExt };
      }
    } else {
      return { code: -1, message: '缺少文件' };
    }

    console.log('[parseDocument] 提取文字长度:', extractedText.length);
    console.log('[parseDocument] 文字前800字:', extractedText.substring(0, 800));

    if (!extractedText || extractedText.length < 20) {
      return { code: -1, message: '未能识别到有效文字，请检查文件/图片清晰度' };
    }

    const questions = parseQuestionsFromText(extractedText);
    console.log('[parseDocument] 解析到题目数量:', questions.length);

    if (questions.length === 0) {
      console.log('[parseDocument] 格式解析失败，尝试AI智能解析...');
      // 兜底方案：调用AI从原始文字中智能提取题目
      const aiQuestions = await aiParseRawText(extractedText);
      if (aiQuestions && aiQuestions.length > 0) {
        console.log('[parseDocument] AI智能解析成功，题目数:', aiQuestions.length);
        // AI解析成功，继续后续流程（AI答题、返回结果）
        const noAnswerCount = aiQuestions.filter(q => !q.answer || q.answer.trim() === '').length;
        let aiResult = { success: false, answered: 0, total: 0, error: '' };
        if (noAnswerCount > 0) {
          console.log('[parseDocument] AI提取的题目有', noAnswerCount, '道无答案，调用AI判断...');
          aiResult = await aiAnswerQuestions(aiQuestions);
        }
        const finalQuestions = aiQuestions.slice(0, parseInt(questionCount) || 50);
        const aiAnsweredCount = finalQuestions.filter(q => q.answer && q.answer.trim() !== '').length;
        return {
          code: 0,
          data: {
            title: fileName ? fileName.replace(/\.[^.]+$/, '') : '题库',
            fileName,
            questionCount: finalQuestions.length,
            questions: finalQuestions,
            sourceType: sourceType + '_ai',
            isScanFile,
            aiAnswered: aiAnsweredCount,
            aiDetail: { ...aiResult, parsedByAI: true },
          }
        };
      }
      
      // AI也解析失败了
      return { 
        code: -1, 
        message: '未能解析到选择题格式。请确保包含"1. 题干 A.选项 B.选项"这样的格式',
        rawText: extractedText.substring(0, 2000)
      };
    }

    // ===== AI智能补全答案（无答案的题目调用AI）=====
    const noAnswerCount = questions.filter(q => !q.answer || q.answer.trim() === '').length;
    let aiResult = { success: false, answered: 0, total: 0, error: '' };
    if (noAnswerCount > 0) {
      console.log('[parseDocument] 有', noAnswerCount, '道题无答案，调用AI判断...');
      aiResult = await aiAnswerQuestions(questions);
      console.log('[parseDocument] AI答题结果:', JSON.stringify(aiResult));
    }

    const finalQuestions = questions.slice(0, parseInt(questionCount) || 50);
    const aiAnsweredCount = finalQuestions.filter(q => q.answer && q.answer.trim() !== '').length;
    console.log('[parseDocument] 最终有答案的题目数:', aiAnsweredCount, '/', finalQuestions.length);

    return {
      code: 0,
      data: {
        title: fileName ? fileName.replace(/\.[^.]+$/, '') : '题库',
        fileName,
        questionCount: finalQuestions.length,
        questions: finalQuestions,
        sourceType,
        isScanFile,
        aiAnswered: aiAnsweredCount,
        aiDetail: aiResult,
        rawText: extractedText.substring(0, 1000),
      }
    };

  } catch (err) {
    console.error('[parseDocument] 异常:', err.message);
    console.error('[parseDocument] 堆栈:', err.stack);
    return { code: -1, message: err.message || '解析失败' };
  }
};

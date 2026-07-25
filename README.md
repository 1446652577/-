# 识图刷题 - 微信小程序

## 项目介绍

识图刷题是一款微信小程序，可以将 PPT、Word、Excel、PDF 等文档自动转换成交互式选择题，支持一键排版、在线作答核对、自动整理错题集，快速把 PPT 内容变成可刷题的练习工具。

## 功能特性

- 📄 **导入文档**：支持 PPT/PPTX/DOC/DOCX/XLS/XLSX/PDF/TXT 格式
- 📝 **一键生成题库**：自动识别文档内容，智能生成选择题
- ✅ **即时作答**：点击选项即知对错，无需提交按钮
- ❌ **自动错题集**：答错的题目自动收录，智能整理
- ⚡ **额度管理**：每日登录赠送额度，观看广告获取更多

## 云开发配置

### 环境信息
- 云环境ID：`llll-d9gppqiqb230a9fa8`

### 需要创建的数据库集合及权限

在微信开发者工具 → 云开发 → 数据库中，创建以下4个集合。**创建时必须设置权限**，否则数据会被任意读写：

| 集合名 | 用途 | 推荐权限 |
|--------|------|----------|
| `users` | 用户额度信息 | **仅创建者可读写** |
| `quizzes` | 题库 | **仅创建者可读写** |
| `questions` | 题目 | **仅创建者可读写** |
| `wrongBooks` | 错题集 | **仅创建者可读写** |

> 💡 **为什么是"仅创建者可读写"？**
> - 每个用户的数据（题库、错题、额度）都是私密的
> - 设置后，A 用户无法读取/修改 B 用户的任何数据
> - 云函数调用不受权限限制，拥有管理员权限

**权限设置路径**：数据库 → 选中集合 → 权限设置 → 选择「仅创建者可读写」

#### 各集合字段说明

1. **users** - 用户数据（额度信息）
   ```json
   {
     "openid": "string",
     "quota": 3,
     "totalUsed": 0,
     "totalEarned": 3,
     "lastLoginTime": "date",
     "createTime": "date"
   }
   ```

2. **quizzes** - 题库
   ```json
   {
     "title": "string",
     "openid": "string",
     "questionCount": 0,
     "createTime": "date",
     "fileName": "string"
   }
   ```

3. **questions** - 题目
   ```json
   {
     "quizId": "string",
     "openid": "string",
     "question": "string",
     "options": [{"key": "A", "text": "string"}],
     "answer": "string",
     "explanation": "string",
     "createTime": "date"
   }
   ```

4. **wrongBooks** - 错题集
   ```json
   {
     "openid": "string",
     "questionId": "string",
     "quizId": "string",
     "question": "string",
     "options": [],
     "answer": "string",
     "explanation": "string",
     "wrongCount": 1,
     "lastWrongTime": "date",
     "reviewed": false,
     "mastered": false,
     "createTime": "date"
   }
   ```

在微信开发者工具 → 云开发 → 数据库中，创建以下集合：

1. **users** - 用户数据（额度信息）
   ```json
   {
     "openid": "string",
     "quota": 3,
     "totalUsed": 0,
     "totalEarned": 3,
     "lastLoginTime": "date",
     "createTime": "date"
   }
   ```

2. **quizzes** - 题库
   ```json
   {
     "title": "string",
     "openid": "string",
     "questionCount": 0,
     "createTime": "date",
     "fileName": "string"
   }
   ```

3. **questions** - 题目
   ```json
   {
     "quizId": "string",
     "openid": "string",
     "question": "string",
     "options": [{"key": "A", "text": "string"}],
     "answer": "string",
     "explanation": "string",
     "createTime": "date"
   }
   ```

4. **wrongBooks** - 错题集
   ```json
   {
     "openid": "string",
     "questionId": "string",
     "quizId": "string",
     "question": "string",
     "options": [],
     "answer": "string",
     "explanation": "string",
     "wrongCount": 1,
     "lastWrongTime": "date",
     "reviewed": false,
     "mastered": false,
     "createTime": "date"
   }
   ```

### 需要部署的云函数

在微信开发者工具中，右键以下云函数目录选择"创建并部署：云端安装依赖"：

- `cloudfunctions/login`
- `cloudfunctions/getUserQuota`
- `cloudfunctions/consumeQuota`
- `cloudfunctions/addQuotaByAd`
- `cloudfunctions/parseDocument`

## 文件结构

```
shitu/
├── cloudfunctions/          # 云函数
│   ├── login/               # 用户登录
│   ├── getUserQuota/        # 获取用户额度
│   ├── consumeQuota/        # 消耗额度
│   ├── addQuotaByAd/        # 广告获取额度
│   └── parseDocument/       # 解析文档
├── miniprogram/             # 小程序代码
│   ├── pages/               # 页面
│   │   ├── index/           # 首页
│   │   ├── import/          # 导入文档
│   │   ├── quizlist/        # 题库列表
│   │   ├── quiz/            # 做题页面
│   │   ├── wrongbook/       # 错题集
│   │   ├── profile/         # 个人中心
│   │   ├── ad/              # 广告获取额度
│   │   └── result/          # 练习结果
│   ├── utils/               # 工具函数
│   ├── app.js               # 应用入口
│   ├── app.json             # 全局配置
│   └── app.wxss             # 全局样式
└── project.config.json      # 项目配置
```

## 使用说明

1. 打开微信开发者工具，导入项目目录 `E:\a`
2. 确保已开通云开发，并设置环境ID为 `llll-d9gppqiqb230a9fa8`
3. 在数据库控制台创建上述4个集合
4. 部署所有云函数
5. 编译运行即可

## 额度规则

- 新用户注册赠送 **3次** 识别额度
- 每日首次登录赠送 **1次**
- 观看30秒广告获取 **3次**
- 每次导入文档消耗 **1次**

## 广告配置

在 `pages/ad/ad.js` 中，将 `adUnitId` 替换为你自己的激励视频广告位ID：
```javascript
const rewardedVideoAd = wx.createRewardedVideoAd({ adUnitId: '你的广告位ID' });
```

## 高级配置（文档智能解析）

当前 `parseDocument` 云函数使用模拟数据生成题目。如需接入真实AI解析：

1. 在云函数中安装解析库（如 `pdf-parse`, `mammoth`, `ppt-parser` 等）
2. 接入AI API（如 OpenAI、文心一言、通义千问等）
3. 将提取的文档文本传给AI，生成选择题

示例代码框架已在 `parseDocument/index.js` 中预留。

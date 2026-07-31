# 将识图导题迁移到 CloudBase Run

本项目已经准备好一个 HTTP 适配层：`cloudrun/parseDocument/server.js`。
它复用原来的 `cloudfunctions/parseDocument/index.js`，因此题目解析、OCR、PDF 分批处理和 `parse_jobs` 逻辑不需要重新写。

## 一、先部署登录云函数

在 `login` 云函数环境变量中增加：

```text
PARSE_RUN_TOKEN_SECRET=一串随机的长密钥
```

这个密钥必须和 CloudBase Run 服务中的 `PARSE_RUN_TOKEN_SECRET` 完全一致。不要把密钥写进小程序代码。

## 二、创建 CloudBase Run 服务

构建上下文选择项目根目录，Dockerfile 选择：

```text
cloudrun/parseDocument/Dockerfile
```

配置环境变量：

```text
CLOUDBASE_ENV_ID=llll-d9gppqiqb230a9fa8
PARSE_RUN_TOKEN_SECRET=与 login 相同的随机长密钥
TENCENT_SECRET_ID=腾讯云 API SecretId
TENCENT_SECRET_KEY=腾讯云 API SecretKey
COS_BUCKET=现有 COS Bucket
COS_REGION=现有 COS Region
ZHIPU_API_KEY=现有智谱 API Key
GLM_MODEL=glm-4-flash
GLM_MAX_TOKENS=1024
PDF_BATCH_SIZE=5
```

端口填写 `3000`，初始实例数建议为 `0`，最大实例数先设置为 `1` 或 `2`。服务启动后访问 `/healthz`，返回 `{ "ok": true }` 才算正常。

## 三、填写服务地址

把 CloudBase Run 生成的 HTTPS 服务地址填入 `miniprogram/app.js` 的两个 `parseServiceUrl`：

```js
parseServiceUrl: 'https://你的服务域名'
```

小程序后台还需要把这个 HTTPS 域名加入 request 合法域名。

如果 `parseServiceUrl` 留空，小程序会自动继续使用原来的 `parseDocument` 云函数，便于灰度切换和回滚。

## 四、验证与回滚

先用一份小 PDF 和 1～2 张图片测试。确认题目、答案、进度轮询都正常后，再观察 CloudBase 资源明细。

出现问题时，把 `parseServiceUrl` 改回空字符串即可回到原云函数，不影响题库数据。

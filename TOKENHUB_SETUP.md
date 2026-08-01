# TokenHub 配置指南

## 概述

文档解析使用两套腾讯云能力：
1. **腾讯云 OCR** — 从图片/扫描件中提取文字（你有1000次免费额度 ✓）
2. **腾讯云 TokenHub** — 调用AI大模型生成选择题（支持 hunyuan、GLM、Qwen 等）

---

## 一、需要配置的环境变量

在 `parseDocument` 云函数中，需要配置以下环境变量：

### 1. OCR 相关（已有）

| 变量名 | 获取位置 | 说明 |
|-------|---------|------|
| `TENCENT_SECRET_ID` | 腾讯云 → 访问管理 → API密钥 | 用于OCR文字识别 |
| `TENCENT_SECRET_KEY` | 同上 | 同上 |

### 2. TokenHub 相关（新增）

| 变量名 | 获取位置 | 说明 |
|-------|---------|------|
| `TOKENHUB_API_KEY` | TokenHub 控制台 → API Key 管理 | 调用AI模型的密钥 |
| `TOKENHUB_BASE_URL` | TokenHub 控制台 → 接入文档 | API接口地址 |
| `TOKENHUB_MODEL` | TokenHub 模型广场 | 要使用的模型ID |

---

## 二、获取 TokenHub API Key

1. 登录 [TokenHub 控制台](https://console.cloud.tencent.com/tokenhub)
2. 左侧菜单 → **API Key 管理**
3. 点击 **「创建 API Key」**
4. 复制生成的 API Key（⚠️ 只显示一次，务必保存）

> 截图中你已经在模型广场页面了，左侧菜单找到 **API Key 管理** 即可。

---

## 三、选择模型并获取模型ID

在 TokenHub 模型广场中：

| 模型 | 模型ID（TOKENHUB_MODEL） | 特点 |
|------|------------------------|------|
| 混元-lite | `hunyuan-lite` | 速度快、成本低 |
| 混元-pro | `hunyuan-pro` | 质量高、理解强 |
| GLM-5.2 | `glm-5.2` | 智谱最新模型 |
| Qwen3.5-Plus | `qwen3.5-plus` | 阿里千问 |
| DeepSeek | `deepseek-chat` | 深度求索 |

**推荐**：先用 `hunyuan-lite` 测试，效果不好再换 `hunyuan-pro` 或 `GLM-5.2`。

---

## 四、获取 Base URL

TokenHub 的 Base URL 通常是以下之一：

```
https://hunyuan.tencentcloudapi.com/v1
```

或

```
https://api.tokenhub.tencent.com/v1
```

如果以上都不行，在 TokenHub 控制台 → **接入文档** 中查看官方给出的 endpoint。

---

## 五、在云函数中配置环境变量

1. 打开 **微信开发者工具**
2. 点击上方工具栏的 **「云开发」** 按钮
3. 进入 **「云函数」** 标签页
4. 找到 `parseDocument` 云函数
5. 点击 **「版本与配置」**
6. 选择 **「环境变量」** 标签
7. 添加以下变量：

```
TENCENT_SECRET_ID=你的SecretId
TENCENT_SECRET_KEY=你的SecretKey
TOKENHUB_API_KEY=你的TokenHubApiKey
TOKENHUB_BASE_URL=https://hunyuan.tencentcloudapi.com/v1
TOKENHUB_MODEL=hunyuan-lite
```

8. 点击 **「保存」**
9. **重新部署** `parseDocument` 云函数

---

## 六、云函数部署步骤

### 第1步：安装依赖

在微信开发者工具中，右键 `cloudfunctions/parseDocument` → **「打开终端」**，运行：

```bash
npm install
```

### 第2步：配置环境变量

按上面的「五」操作。

### 第3步：调整超时时间

文档解析 + AI生成可能耗时较长：

1. 云开发控制台 → 云函数 → `parseDocument` → 配置
2. 超时时间改为 **60秒**
3. 内存改为 **512MB**

### 第4步：重新部署

右键 `cloudfunctions/parseDocument` → **「创建并部署：云端安装依赖」**

---

## 七、测试

部署完成后，在小程序中导入一个文档测试：

1. 进入「导入文档」页面
2. 上传一个文件
3. 点击「开始识别」
4. 查看云函数日志（云开发 → 云函数 → 日志）

如果配置正确，日志中会看到：
- `提取的文本长度: xxx`
- `AI原始返回: xxx`

---

## 八、常见问题

### Q: TokenHub API 返回 401 错误？
- 检查 `TOKENHUB_API_KEY` 是否正确
- 确认 API Key 没有被禁用或过期

### Q: TokenHub API 返回 404？
- 检查 `TOKENHUB_BASE_URL` 是否正确
- 确认模型ID `TOKENHUB_MODEL` 是否存在

### Q: 生成的题目质量不好？
- 换更好的模型：`hunyuan-pro` 或 `GLM-5.2`
- 确保文档内容清晰，OCR提取的文本足够

### Q: 调用太慢？
- 换轻量模型：`hunyuan-lite` 响应最快
- 减少生成题目数量

---

## 九、费用参考

| 服务 | 免费额度 | 超出费用 |
|------|---------|---------|
| 腾讯云OCR | 1000次/月 | ~¥0.015/次 |
| TokenHub (hunyuan-lite) | 有免费额度 | 按token计费 |
| 云函数调用 | 100万次/月 | 基本免费 |

**正常使用几乎免费。**

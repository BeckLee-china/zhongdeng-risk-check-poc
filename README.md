# 中登客户风险核查 POC

客户中登担保登记核查 + 内部合同/发票自动比对原型。

这个项目不是简单的“中登爬虫”，而是把中登登记、附件解析、内部业务数据、可解释匹配和审计串成一条完整核查链路。

## 已实现

- 客户法定名称 / 统一社会信用代码发起核查
- 中登适配层：`mock` / `browser`
- Playwright 浏览器模式：账号密码可预填，验证码和必要确认由人工完成，**不绕过验证码**
- 登记列表抓取与附件下载骨架，站点 selector 全部环境变量化
- 内部数据适配层：`mock` / `http`
- Excel / PDF / 文本附件解析；图片可接企业 OCR HTTP 服务
- 合同号、发票号、统一社会信用代码、金额、日期、描述、对方单位可解释匹配
- 结果分级：完全匹配 / 高度疑似 / 可能相关 / 未匹配 / 信息不足
- JSON 核查任务与审计日志
- Web 查询、汇总、登记明细、证据链页面
- TypeScript 测试与 Dockerfile

## 架构

```text
Web UI
  |
RiskCheckService
  |-----------------------------|
  v                             v
ZhongdengAdapter            InternalDataAdapter
  |- mock                       |- mock
  |- browser                    |- http
  `- api（正式接口后增加）
  |
登记 + 附件
  |
Document Parser
  |- Excel
  |- PDF
  |- Text
  `- Image -> OCR HTTP
  |
Matcher
  |- 合同号 / 发票号：强标识
  |- 社会信用代码 / 客户名称
  |- 金额 / 日期
  `- 描述 / 对方名称相似度
  |
结果 + 证据链 + Audit
```

## 快速开始

要求 Node.js 22+。

```bash
cp .env.example .env
npm install
npm run dev
```

打开 `http://localhost:8787`。

默认：

```env
ZHONGDENG_ADAPTER=mock
INTERNAL_ADAPTER=mock
```

因此不需要中登账号和内部系统接口，也能先把完整 UI 与匹配流程跑起来。

## 核查 API

创建任务：

```bash
curl -X POST http://localhost:8787/api/checks \
  -H 'content-type: application/json' \
  -H 'x-actor: demo-user' \
  -d '{
    "customerName":"青岛测试有限公司",
    "unifiedSocialCreditCode":"91370000123456789X",
    "reason":"业务合作前风险核查",
    "needCertificate":true
  }'
```

查询任务：

```text
GET /api/checks/:jobId
```

最近任务：

```text
GET /api/checks
```

## 匹配规则

POC 优先使用确定性证据，而不是让大模型直接做最终判断。

| 证据 | 分值 |
| --- | ---: |
| 合同编号一致 | +55 |
| 发票号码一致 | +60 |
| 统一社会信用代码一致 | +20 |
| 客户法定名称一致 | +15 |
| 金额一致（0.1% 容差） | +15 |
| 日期相差不超过 7 天 | +5 |
| 业务描述高度相似 | +10 / +15 |
| 对方名称高度相似 | +10 |

分级：

- `EXACT`：合同号/发票号强标识命中，或总分 >= 90
- `HIGH`：70–89
- `POSSIBLE`：40–69
- `NONE`：< 40
- `INSUFFICIENT`：登记没有足够业务要素

## 对接内部合同 / 发票系统

```env
INTERNAL_ADAPTER=http
INTERNAL_API_BASE=https://internal.example.com/api/risk-check/
INTERNAL_API_TOKEN=xxxx
```

系统调用：

```text
GET {INTERNAL_API_BASE}/documents?customerName=...&unifiedSocialCreditCode=...
```

支持直接返回数组或 `{ "data": [] }`。

## 中登浏览器模式

先安装 Chromium：

```bash
npm run playwright:install
```

然后配置：

```env
ZHONGDENG_ADAPTER=browser
ZD_HEADLESS=false
ZD_LOGIN_URL=https://www.zhongdengwang.org.cn/
ZD_QUERY_URL=<登录后的查询页 URL>
ZD_USERNAME=<操作员账号>
ZD_PASSWORD=<密码>

ZD_USERNAME_SELECTOR=
ZD_PASSWORD_SELECTOR=
ZD_LOGIN_SUCCESS_SELECTOR=
ZD_CUSTOMER_NAME_SELECTOR=
ZD_RESULT_READY_SELECTOR=
ZD_RESULT_ROW_SELECTOR=
ZD_REG_NO_SELECTOR=
ZD_GUARANTEE_TYPE_SELECTOR=
ZD_REG_DATE_SELECTOR=
ZD_SECURED_PARTY_SELECTOR=
ZD_AMOUNT_SELECTOR=
ZD_DESCRIPTION_SELECTOR=
ZD_ATTACHMENT_LINK_SELECTOR=
```

流程：

1. 程序打开真实浏览器并可预填账号密码；
2. 操作员人工输入验证码并登录；
3. 程序进入查询页并预填客户；
4. 查询页如有验证码，由操作员人工输入并提交；
5. 程序等待结果并读取登记；
6. 如果配置了附件 selector，下载附件并解析合同号、发票号等。

**本项目不包含验证码识别、破解、绕过或规避安全控制的逻辑。**

## OCR

图片附件可接公司已有 OCR：

```env
OCR_HTTP_ENDPOINT=https://ocr.example.com/extract
OCR_HTTP_TOKEN=xxxx
```

请求：

```json
{ "mimeType":"image/png", "dataBase64":"..." }
```

返回：

```json
{ "text":"识别后的文本" }
```

## 审计与数据

默认：

```text
data/
├── jobs/     # 核查任务和结果
└── audit/    # 操作人、客户、查询原因、时间、结果摘要
```

真实生产建议换 PostgreSQL/MySQL + 对象存储，并加入 SSO、RBAC、敏感字段加密和审计报表。

## 下一步

1. 使用真实机构操作员账号验证一次浏览器模式并固化 selector；
2. 根据真实结果页补齐详情页翻页/遍历；
3. 对接真实合同、发票、ERP 数据；
4. 用已确认样本校准匹配权重；
5. 申请中登接口查询能力后增加 `api` Adapter，替换浏览器 Adapter；
6. 增加 SSO、RBAC、审批与正式数据库。

## 合规边界

正式使用至少应做到：查询有明确业务目的；操作员有合法权限；全量记录查询原因与审计；不绕过验证码或安全控制；查询结果、附件按敏感业务数据管理；遵守中登网现行规则和公司内部制度。

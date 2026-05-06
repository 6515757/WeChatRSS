# 微信公众号文章分析系统

定期抓取微信公众号文章，通过大模型（Claude）进行智能分析，生成摘要、分类和报告。

## 快速开始

### 1. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入 LLM_API_KEY 等配置
```

### 2. 安装依赖

```bash
npm install
```

### 3. 生成数据库迁移文件

```bash
npm run db:generate
```

### 4. 启动开发服务

```bash
npm run dev
```

服务启动后访问 `http://localhost:3000/health` 验证。

---

## API 文档

### 订阅源管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/feeds | 获取所有订阅源 |
| POST | /api/feeds | 添加订阅源 |
| PUT | /api/feeds/:id | 更新订阅源 |
| DELETE | /api/feeds/:id | 删除订阅源 |

**添加订阅源示例：**
```json
POST /api/feeds
{
  "name": "科技爱好者周刊",
  "url": "http://localhost:8001/rss/xxx.xml",
  "sourceType": "we-mp-rss"
}
```

### 文章

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/articles | 文章列表（支持分页、feedId、keyword 筛选） |
| GET | /api/articles/:id | 文章详情（含分析结果） |

**查询参数：**
- `page`: 页码，默认 1
- `pageSize`: 每页数量，默认 20，最大 100
- `feedId`: 按订阅源筛选
- `keyword`: 标题关键词搜索

### 报告

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/reports | 报告列表 |
| GET | /api/reports/:id | 报告详情 |
| POST | /api/reports/generate | 手动生成报告 |

**生成报告示例：**
```json
POST /api/reports/generate
{
  "type": "daily"
}
```

### 任务

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/tasks/status | 查看任务状态 |
| POST | /api/tasks/fetch | 手动触发全量抓取 |
| POST | /api/tasks/fetch/:feedId | 手动触发单个订阅源抓取 |
| POST | /api/tasks/analyze | 手动触发分析 |
| POST | /api/tasks/analyze/:articleId | 手动触发单篇分析 |

---

## 环境变量说明

| 变量 | 默认值 | 说明 |
|------|--------|------|
| DATABASE_PATH | ./data/wechat-rss.db | SQLite 数据库路径 |
| LLM_API_KEY | - | LLM API Key（必填） |
| LLM_BASE_URL | https://api.ikuncode.cc/v1 | LLM API 地址 |
| LLM_MODEL | claude-sonnet-4-6 | 模型名称 |
| LLM_CONCURRENCY | 3 | LLM 并发请求数 |
| PORT | 3000 | 服务端口 |
| FETCH_CRON | 0 8,18 * * * | 抓取任务 Cron |
| ANALYZE_CRON | 30 8,18 * * * | 分析任务 Cron |
| DAILY_REPORT_CRON | 0 20 * * * | 日报生成 Cron |
| WE_MP_RSS_URL | http://localhost:8001 | we-mp-rss 服务地址 |

---

## Docker 部署（含 we-mp-rss）

在项目根目录创建 `.env` 文件：

```env
LLM_API_KEY=your-api-key
```

然后一键启动：

```bash
docker-compose up -d
```

- we-mp-rss 管理界面：http://localhost:8001
- 分析后端 API：http://localhost:3000

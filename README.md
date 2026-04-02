# Polly MVP

Polly 是一个浏览器插件优先的 web app。用户在飞书文档或普通网页里点击插件，把当前页面转成一段“主播讲解式”音频。

当前仓库里已经有两部分：

- [apps/web](/Users/bytedance/Documents/PollyCodex/apps/web)：Next.js App Router Web 控制台和 API
- [apps/extension](/Users/bytedance/Documents/PollyCodex/apps/extension)：Chrome Manifest V3 插件骨架

## 当前能力

- 首页、Dashboard、History、Job 详情、Settings、Install、Login 页面
- `POST /api/sources` / `POST /api/jobs` / `GET /api/jobs/:id` 等基础 API
- 浏览器插件抓取当前页面标题、URL、正文并发起任务
- Web 登录、Supabase magic link、插件连接页、extension token 存储与 Bearer 鉴权
- 统一 store 层：优先走 Supabase，未配置时回退到内存存储
- 任务状态会在本地开发模式下从 `queued` 自动推进到 `succeeded`
- 已提供 Supabase schema 草案 [apps/web/supabase/schema.sql](/Users/bytedance/Documents/PollyCodex/apps/web/supabase/schema.sql)

## 本地启动

先安装依赖：

```bash
npm install
```

再启动 Web：

```bash
npm run dev
```

默认地址：

```bash
http://localhost:3000
```

## 加载插件

1. 打开 `chrome://extensions`
2. 打开 Developer Mode
3. 点击 `Load unpacked`
4. 选择 [apps/extension](/Users/bytedance/Documents/PollyCodex/apps/extension)

插件当前会请求本地 `http://localhost:3000`，并且 `content_scripts` 也只对这个地址生效。

## Supabase 接入

复制环境变量模板：

```bash
cp apps/web/.env.example apps/web/.env.local
```

然后填写：

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_TEXT_MODEL`
- `OPENAI_TTS_MODEL`

当 `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 同时存在时，登录页会自动切到 Supabase magic link。否则继续走本地 fallback 登录。

数据库初始化 SQL 在：

- [apps/web/supabase/schema.sql](/Users/bytedance/Documents/PollyCodex/apps/web/supabase/schema.sql)

如果这些环境变量未配置，应用会继续使用内存存储，方便本地快速迭代。

## 下一步

最值得继续接的 4 件事：

1. 把 Supabase Auth 与插件连接页进一步打磨到可上生产
2. 真正的 job 持久化与重试日志
3. LLM 主播讲解稿生成
4. TTS 音频合成与 Storage 上传

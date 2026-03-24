# Codex Mob (PWA)

手机优先的 Codex 风格 Web App，支持：

- Codex Auth 状态检查（`codex login status`）
- 多会话（直接读取 `~/.codex` 历史）
- SSE 流式消息
- Markdown 代码块高亮和复制
- 会话按项目分组（`cwd` 推导）
- 深色主题默认 + 可切浅色

## 运行环境

- Node.js 20+
- 已安装 `codex` CLI（建议 Linux/WSL2）
- 服务端已执行 `codex login`（ChatGPT 或 API key）

## 本地启动

1. 复制环境变量模板：

```bash
cp .env.example .env.local
```

2. 按需修改 `.env.local`：

```env
APP_ACCESS_CODE=change-me
CODEX_HOME=C:\\Users\\yourname\\.codex
DEFAULT_MODEL=gpt-5.4
ALLOWED_MODELS=gpt-5.4,gpt-5.3-codex,gpt-5.2
CODEX_BIN=codex
CODEX_CWD=.
# 可选：read-only / workspace-write / danger-full-access
# 不配置时默认跟随 ~/.codex/config.toml
CODEX_SANDBOX=workspace-write
CODEX_EXEC_TIMEOUT_MS=180000
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=30
```

权限映射说明（自动）：

- `read-only` -> `--sandbox read-only`
- `workspace-write` -> `--sandbox workspace-write --full-auto`
- `danger-full-access` -> `--dangerously-bypass-approvals-and-sandbox`

`danger-full-access` 为高风险模式，会跳过审批拦截，请仅在受控本机环境使用。

3. 安装依赖并启动：

```bash
npm install
npm run dev
```

4. 打开 [http://localhost:3000](http://localhost:3000)。

## 关键 API

- `GET /api/auth/status`
- `GET /api/models`
- `POST /api/chat/stream` (SSE: `ready/token/done/error`)
- `POST /api/history/sync/run`
- `GET /api/history/conversations`
- `GET|POST /api/history/conversations/:id/messages`

全部 API 都要求请求头 `x-app-access-code`。

## 测试

```bash
npm run test
npm run lint
npm run typecheck
```

## 部署建议

本项目以“Codex 真实认证会话”作为核心能力，建议使用自托管 Node 长驻进程（Linux/WSL2），不建议部署在无状态 Serverless 平台。

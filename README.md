# send-image — DeepSeek Harness 图片发送插件

让 DSH 助手（模型）在聊天中**主动向你发送图片**：图片以卡片形式渲染在对话流里，
**点击卡片即可全屏放大**（Esc / 点击背景 / ✕ 关闭）。

- 仓库：<https://github.com/ANAYGrapeTree/dsh-plugin-send-image>
- 包名：`@dsh-user/send-image`
- 适用 profile：`web`（也就是 `dsh web` 的 Web GUI）

想在**另一台电脑**上从零装好，见 [INSTALL.md](./INSTALL.md)。

## 功能

- 助手生成或找到图片后调用 `send_image` 工具，把 PNG/JPEG/WebP/GIF 发到对话里。
- 图片渲染在**正文流**里：每一轮（Turn）里发过的图片在自己的一行中显示，
  和助手的文字回答并排可见；**工具调用组折叠起来时图片依然显示**，
  紧凑模式下也不会被折进「N 次工具调用」里。
- 可带一句说明文字（`note`）；点击图片打开全屏灯箱（Esc / 点击背景 / ✕ 关闭）。
- 工具行本身只留一行状态（`已发送图片 · 文件名`），所以同一张图不会重复画两遍。
- 图片字节存放在 DSH 附件服务里（内容寻址 + 摘要校验），前端通过插件自己的
  `/send-image/...` 路由取回，不依赖会话引用授权。
- 模型侧只看到纯文本 JSON 结果，不会把 image 内容块塞进模型历史，
  因此 deepseek 纯文本路由不会因图片报 `UNSUPPORTED_CONTENT`。

## 图片为什么能逃出工具调用组

正文行不是塞在工具卡片里的，而是插件注册的一个 Conversation 业务 Definition：

| 关注点 | 做法 |
| --- | --- |
| 数据 | `ConversationNodeDefinition(kind: 'send-image')` 按 Turn 折叠本轮的 `send_image` 工具结果（`tool/call` 认名字、`tool/result` 解 JSON）。 |
| 呈现 | keyed slot `conversation.chat.node`（key = `send-image`）渲染图片行 + 灯箱。 |
| 位置 | 锚点取 Turn 的答案边界 `turn-process.answerAnchorSeq + 0.06`：Turn 过程折叠占用的区间是 `[processStartSeq, answerAnchorSeq)`，落在边界之后就不是过程成员，因此折叠工具组时不会被一起隐藏；同时仍排在 turn-tail（时间戳/操作行，偏移 0.1）之前。 |

Turn 还在跑的时候过程折叠不存在，锚点回退到「最后一次 send_image 结果的 seq」，
图片就跟着工具调用立刻出现；Turn 一结束，行会自动挪到回答下方。

## 架构

| 半区 | 职责 |
| --- | --- |
| Host (`lib/index.js`) | 注册工具 `send_image`：`fs` 读取 → `attachments.saveImage` 持久化（内容寻址）→ 返回 JSON 引用。另注册 HTTP 路由 `/send-image/<sha256>/<bytes>/<width>/<height>.<ext>`，读取时经 `readImage` 做摘要 + 元数据双重校验后流式返回图片字节。 |
| Client (`lib/client.js`) | 手写 module-loader bundle，**自包含**：只 `require('react')`（平台真种子词），自绘图片行 + 原生 DOM 全屏灯箱。注册三样东西：Conversation Definition（`kind: 'send-image'`）、keyed `conversation.chat.node`（key=`send-image`）渲染正文图片行、keyed `tool.call.toolview`（key=`send_image`）渲染工具行状态。图片字节直接走 `/send-image/…` 路由，无 RPC、无 base64。 |

**为什么不把 image 块放进工具结果**：内置 `readAttachment` 要求会话日志里有事件以
image 块引用该附件；而 image 块一旦进入模型历史，会让 deepseek 纯文本路由在下一次
模型调用时抛 `UNSUPPORTED_CONTENT`。所以工具结果保持纯文本 JSON，图片走独立字节路由。

**为什么客户端不 import `@deepseek-ai/dsh-client-ui-attachment`**：那个包的客户端半区只导出
`inject` / `apply`，源码注释写得很明确 —— *without exporting React components as package values*，
所以拿不到 `ImageGallery`（拿到的是 `undefined`，渲染时抛错被 error boundary 吞掉，表现就是卡片完全不出现）。
而且它也不在平台种子词表里（真种子词只有 `packages/client/web/src/seed.ts` 那 9 个），
`require` 它只是靠启动顺序碰巧解析。所以卡片自己画，只依赖 `react`。
## 安装

### 方式 A：从 GitHub 安装（推荐，一条命令）

```powershell
# 全局装了 @deepseek-ai/dsh 的情况
dsh plugin --profile web add github:ANAYGrapeTree/dsh-plugin-send-image

# 从源码仓库跑 dsh 的情况（git clone + pnpm install）
pnpm dsh plugin --profile web add github:ANAYGrapeTree/dsh-plugin-send-image
```

然后**重启 `dsh web`**。

本包声明了 `dsh.bundle.patch: ./cordis.patch.yml`，所以这一条命令会自动完成三件事：

1. 用 pnpm 把本包装进 `$DSH_HOME/profiles/web`；
2. 因为本包声明了 `dsh.bundle`，把 `@dsh-user/send-image` 追加进 profile 的
   `dsh.profile.bundles`；
3. 启动时应用包内自带的 `cordis.patch.yml`，把插件行注入插件树。

**不需要手工编辑 profile 里的 `cordis.patch.yml`。** 插件也会出现在 DSH 的设置 / 插件面板里。

### 方式 B：本地目录开发（link，改代码即时生效）

```powershell
dsh plugin --profile web add "C:\path\to\dsh-plugin-send-image"
```

`dsh plugin` 会把相对路径按你的**调用目录**重写为绝对路径，所以在插件目录里执行
`dsh plugin --profile web add .` 也安全（不会误把 profile 自己 link 进去）。

### 为什么必须重启

客户端模块表与启动清单只在启动时读取，所以新增插件后必须**重启 `dsh web`**。
profile 的 `cordis.patch.yml` 是 live 重载的，但客户端 bundle 不是。

> 例外：compose 里挂了 `client-hmr` 时，它会轮询每个客户端 bundle 的
> `lib/client.js`，文件一变就通过 `/plugins/events` 让浏览器热重载这一行 ——
> 这种情况下改完 `lib/client.js` 刷新一下页面即可，不用重启。

## 使用

对助手说「给我发一张图片」「把 X 图发我」即可；助手生成图片（比如用 Python 绘图）后
就会调用 `send_image`。

用仓库里的测试图试一下：

```text
把 test-image.png 发给我
```

## 验证是否装好

```powershell
# 1) 依赖确实装上了
dsh plugin --profile web why @dsh-user/send-image

# 2) 插件行确实进了插件树（应能看到 id: send-image）
dsh web --dump-config | Select-String -Pattern 'send-image' -Context 1,2
```

## 更新

```powershell
dsh plugin --profile web update @dsh-user/send-image
```

然后重启 `dsh web`。（`github:` 规格会重新拉取默认分支的最新提交。）

## 卸载

```powershell
dsh plugin --profile web remove @dsh-user/send-image
```

`dsh plugin` 会顺带把 `@dsh-user/send-image` 从 `dsh.profile.bundles` 里摘掉。

## 让模型「看到」图片

`send_image` 只负责**发图**。要让模型**读取 / 理解**图片，需要支持视觉的路由：

- `deepseek-official / deepseek-v4-flash` 是纯文本路由（图片输入报 `UNSUPPORTED_CONTENT`）。
- 配上 `input: [text, image]` 的路由后，`read_image` 工具才可用。

## 仓库内容

| 路径 | 说明 |
| --- | --- |
| `lib/index.js` | Host 半区：`send_image` 工具 + 图片字节路由 |
| `lib/client.js` | Client 半区：正文图片行（Conversation Definition + `conversation.chat.node`）+ 工具行状态 |
| `cordis.patch.yml` | bundle 层 patch，让 `dsh plugin add` 自动激活插件 |
| `send-image.plugin.js` | 另一种形态：**动态插件**（会话内临时生效，重启失效，适合临时试玩）。注意：动态插件的客户端运行时只暴露 `layout/locale/sessions/slots/theme/timer/uiWorkspace/workspaces`，**没有 `uiConversation`**，所以这一形态只能渲染工具卡片缩略图，做不到正文行。 |
| `test-image.png` | 测试图片 |
| `test-image-2.png` | 第二张测试图（验证正文图片行、多图排序用） |
| `test/client-smoke.mjs` | Node 冒烟测试：桩掉 `window.__ModuleLoader__` 与 React，直接驱动 Conversation Definition 与两个渲染件（`npm test`，34 项断言，不需要浏览器） |
| `INSTALL.md` | 在另一台电脑（如办公室）从零安装的完整步骤 |

## 关键接口（v0.1.0-rc.5）

- Host：`ctx.tools.register`（手写 JSON Schema，零外部依赖）、`ctx.get('webServer')`（prefix 路由）、
  `ctx.get('attachments')`（imageLimits / saveImage / readImage）、`ctx.get('fs')`（resolve / readBytes / processPath）
- Client：`window.__ModuleLoader__.load({ id, factory })`；种子词 `react`；
  `ctx.inject(['slots','uiConversation'], …)` + `uiConversation.events.register(definition)` +
  `ctx.slots.inject('conversation.chat.node' | 'tool.call.toolview', …)`；
  锚点参考 `TurnProcessSpec.answerAnchorSeq` 与 `CHAT_SYNTHETIC_SEQ_OFFSETS`

## License

MIT

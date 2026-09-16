# send-image — DeepSeek Harness 图片发送插件

让 DSH 助手（模型）能在聊天中**主动向用户发送图片**：图片以卡片形式渲染在对话流中，
**点击卡片即可全屏放大查看**（Esc / 点击背景 / ✕ 关闭）。

## 两种形态

1. **动态插件（本会话临时生效，重启失效）**：见 `send-image.plugin.js`。
2. **正式插件包（长期安装，重启后依然生效）**：本目录即 npm 包
   `@dsh-user/send-image`，已安装到 `dsh web` profile（`$DSH_HOME/profiles/web`）。

## 架构

| 半区 | 职责 |
| --- | --- |
| Host (`lib/index.js`) | 注册工具 `send_image`：`fs` 读取 → `attachments.saveImage` 持久化（内容寻址）→ 返回 JSON 引用。另注册 HTTP 路由 `/send-image/<sha256>/<bytes>/<width>/<height>.<ext>`，读取时经 `readImage` 做摘要 + 元数据双重校验后流式返回图片字节。模型侧结果保持纯文本（deepseek 文本路由不会因图片块报错）。 |
| Client (`lib/client.js`) | 手写 module-loader bundle：注册 `tool.call.toolview`（key=`send_image`）卡片，复用平台种子模块 `@deepseek-ai/dsh-client-ui-attachment` 的 `ImageGallery`（内置缩略图 / 加载重试 / 点击放大灯箱）。图片字节直接走 `/send-image/…` 路由，无 RPC。 |

**为什么不把 image 块放进工具结果**：内置 `readAttachment` 要求会话日志以 image 块引用附件，
而 image 块进入模型历史会让 deepseek 纯文本路由在下一次调用抛 `UNSUPPORTED_CONTENT`。

## 安装（已执行）

```bash
# 1. 安装为 profile 依赖（link 到本目录，改代码即时生效）
dsh plugin --profile web add "C:\Users\admin\Documents\PROJECTS\dsh-plugins\send-image"

# 2. 在 $DSH_HOME/profiles/web/cordis.patch.yml 追加：
# - insert:
#     - id: send-image
#       name: '@dsh-user/send-image'

# 3. 重启 dsh web（客户端模块表与 boot 清单只在重启后刷新）
```

重启后：所有会话（含子代理）的助手都能调用 `send_image`，图片卡片全局可用。

## 使用

对助手说「给我发一张图片 / 把 X 图发我」即可；助手生成图片（如 Python 绘图）后调用
`send_image` 发送。测试图片：`test-image.png`。

## 让模型"看到"图片

`send_image` 只负责发图。要让模型**读取/理解**图片，需要视觉路由：
- `deepseek-official / deepseek-v4-flash` 为纯文本路由（图片输入报 `UNSUPPORTED_CONTENT`）。
- 已配置的 `doubao-vision`（doubao-seed-2.0-lite，`input: [text, image]`）支持视觉输入，
  在该路由下 `read_image` 工具可用。

## 关键接口（v0.1.0-rc.5）

- Host：`ctx.tools.register`（手写 JSON Schema 定义，零外部依赖）、`ctx.get('webServer')`
  （prefix 路由）、`ctx.get('attachments')`（imageLimits / saveImage / readImage）
- Client：`window.__ModuleLoader__.load({ id, factory })`；种子词 `react`、
  `@deepseek-ai/dsh-client-ui-attachment`；`ctx.slots.inject('tool.call.toolview', …)`

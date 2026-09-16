# send-image — DeepSeek Harness 图片发送插件

让 DSH 助手（模型）在聊天中**主动向你发送图片**：图片以卡片形式渲染在对话流里，
**点击卡片即可全屏放大**（Esc / 点击背景 / ✕ 关闭）。

- 仓库：<https://github.com/ANAYGrapeTree/dsh-plugin-send-image>
- 包名：`@dsh-user/send-image`
- 适用 profile：`web`（也就是 `dsh web` 的 Web GUI）

想在**另一台电脑**上从零装好，见 [INSTALL.md](./INSTALL.md)。

## 功能

- 助手生成或找到图片后调用 `send_image` 工具，把 PNG/JPEG/WebP/GIF 发到对话里。
- 图片以缩略图卡片呈现，可带一句说明文字；点击卡片打开全屏灯箱。
- 图片字节存放在 DSH 附件服务里（内容寻址 + 摘要校验），卡片通过插件自己的
  `/send-image/...` 路由取回，不依赖会话引用授权。
- 模型侧只看到纯文本 JSON 结果，不会把 image 内容块塞进模型历史，
  因此 deepseek 纯文本路由不会因图片报 `UNSUPPORTED_CONTENT`。

## 架构

| 半区 | 职责 |
| --- | --- |
| Host (`lib/index.js`) | 注册工具 `send_image`：`fs` 读取 → `attachments.saveImage` 持久化（内容寻址）→ 返回 JSON 引用。另注册 HTTP 路由 `/send-image/<sha256>/<bytes>/<width>/<height>.<ext>`，读取时经 `readImage` 做摘要 + 元数据双重校验后流式返回图片字节。 |
| Client (`lib/client.js`) | 手写 module-loader bundle：注册 `tool.call.toolview`（key=`send_image`）卡片，复用平台种子模块 `@deepseek-ai/dsh-client-ui-attachment` 的 `ImageGallery`（缩略图 / 加载重试 / 点击放大灯箱）。图片字节直接走 `/send-image/…` 路由，无 RPC。 |

**为什么不把 image 块放进工具结果**：内置 `readAttachment` 要求会话日志里有事件以
image 块引用该附件；而 image 块一旦进入模型历史，会让 deepseek 纯文本路由在下一次
模型调用时抛 `UNSUPPORTED_CONTENT`。所以工具结果保持纯文本 JSON，图片走独立字节路由。

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

客户端模块表与启动清单只在启动时读取，所以新增或更新插件后必须**重启 `dsh web`**
才会看到图片卡片。profile 的 `cordis.patch.yml` 是 live 重载的，但客户端 bundle 不是。

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
| `lib/client.js` | Client 半区：对话流里的图片卡片 |
| `cordis.patch.yml` | bundle 层 patch，让 `dsh plugin add` 自动激活插件 |
| `send-image.plugin.js` | 另一种形态：**动态插件**（会话内临时生效，重启失效，适合临时试玩） |
| `test-image.png` | 测试图片 |
| `INSTALL.md` | 在另一台电脑（如办公室）从零安装的完整步骤 |

## 关键接口（v0.1.0-rc.5）

- Host：`ctx.tools.register`（手写 JSON Schema，零外部依赖）、`ctx.get('webServer')`（prefix 路由）、
  `ctx.get('attachments')`（imageLimits / saveImage / readImage）、`ctx.get('fs')`（resolve / readBytes / processPath）
- Client：`window.__ModuleLoader__.load({ id, factory })`；种子词 `react`、`@deepseek-ai/dsh-client-ui-attachment`；
  `ctx.slots.inject('tool.call.toolview', …)`

## License

MIT

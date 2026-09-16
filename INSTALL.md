# 在办公室电脑上安装 send-image

本文假设办公室电脑是 **Windows**，并且你按「源码仓库」方式跑 dsh
（`git clone` + `pnpm install`）。

**如果你那台机器已经能正常跑起 `dsh web`，直接跳到 [第 2 步](#第-2-步装插件一条命令)。**

---

## 第 0 步：确认前置工具

在 PowerShell 里：

```powershell
node -v        # 需要 ^22.19.0 或 >=24（dsh 的 engines 要求）
git --version
pnpm -v        # 没装就：npm i -g pnpm
```

任何一个缺失就先补上：

- Node：<https://nodejs.org/>（或用 `scoop install nodejs-lts`）
- pnpm：`npm i -g pnpm`

---

## 第 1 步：拿到 dsh 源码并跑通

用**和家里这台机器一样的方式**克隆 dsh 仓库（内网私有仓库，地址问自己或看家里的
`git remote -v`）：

```powershell
git clone <dsh 仓库地址> deepseek-harness
cd deepseek-harness
pnpm install
pnpm run build      # 首次需要构建
```

构建完先确认能启动 Web GUI：

```powershell
pnpm dsh web
```

浏览器打开它打印的地址（一般是 <http://127.0.0.1:3080>），能看到界面就说明 dsh 本身没问题。
先 `Ctrl+C` 停掉。

> 也可以用全局安装的 dsh（`npm i -g @deepseek-ai/dsh`），下面命令里的
> `pnpm dsh` 就换成 `dsh`。

---

## 第 2 步：装插件（一条命令）

在 **dsh 源码仓库根目录**执行：

```powershell
pnpm dsh plugin --profile web add github:ANAYGrapeTree/dsh-plugin-send-image
```

这一条命令会：

1. 用 pnpm 把插件装进 `$DSH_HOME/profiles/web`
   （`$DSH_HOME` 默认是 `C:\Users\<你的用户名>\.dsh`）；
2. 因为插件声明了 `dsh.bundle.patch`，自动把 `@dsh-user/send-image` 追加进
   profile 的 `dsh.profile.bundles`；
3. 启动时应用插件包内自带的 `cordis.patch.yml`，把插件行注入插件树。

**不需要手工编辑 `$DSH_HOME/profiles/web/cordis.patch.yml`**（那是老办法，见文末常见问题 4）。

> 仓库是公开的，所以不需要登录 GitHub。如果公司网络要走代理，见常见问题 5。

---

## 第 3 步：重启 dsh web

```powershell
pnpm dsh web
```

必须**重启**：客户端模块表和启动清单只在启动时读取。

---

## 第 4 步：验证

### 4.1 确认依赖和插件行都在

```powershell
# 依赖装上了吗
pnpm dsh plugin --profile web why @dsh-user/send-image

# 插件行进插件树了吗 —— 应能看到 id: send-image
pnpm dsh web --dump-config | Select-String -Pattern 'send-image' -Context 1,2
```

第二条命令预期输出类似：

```text
- id: send-image
  name: '@dsh-user/send-image'
```

### 4.2 真正发一张图

打开 Web GUI，把仓库里的 `test-image.png` 放到会话工作目录，然后对助手说：

```text
把 test-image.png 发给我
```

助手会调用 `send_image`，对话里出现一张缩略图卡片；**点击卡片能全屏放大**就成功了。

---

## 常见问题

### 1. 助手没有 `send_image` 工具

说明插件没被激活。依次检查：

- `pnpm dsh web --dump-config | Select-String 'send-image'` 有没有输出？没有就是第 2 步没生效。
- 装完有没有**重启** `pnpm dsh web`？
- profile 里的依赖是否真的存在：
  `Get-Content "$env:DSH_HOME\profiles\web\package.json"`

### 2. 图片卡片不出现 / 一直「正在发送图片…」

- 卡片由**客户端** bundle 渲染，改动后必须重启 `dsh web`（刷新浏览器页面不够）。
- 打开浏览器开发者工具看 Console 有没有报错，Network 里 `/send-image/...` 请求是否 404。
- 确认 `package.json` 里 `dsh.client.platform` 仍为 `web`。

### 3. send_image 报「the attachment service is not mounted」

该 profile 没有挂载附件服务。确认你 boot 的是 `web` profile（`dsh-base` 会带上
attachment-local），而不是一个自定义的精简 profile。

### 4. 我之前用「老办法」手工装过，会不会重复注册？

老办法是在 profile 的 `cordis.patch.yml` 里手工写：

```yaml
- insert:
    - id: send-image
      name: '@dsh-user/send-image'
```

如果**同时**又按本文第 2 步装了 bundle 形态，同一条 `id: send-image` 会被插入两次。
处理办法：把上面那段从 `$DSH_HOME/profiles/web/cordis.patch.yml` 里**删掉**，
只保留 bundle 这一条路径，然后重启 `dsh web`。

> 家里这台机器已经按这个方式迁移过了：profile 的 `cordis.patch.yml` 恢复为空数组
> `[]`，插件由 `dsh.profile.bundles` 提供。

### 5. 公司网络要走代理

git 和 pnpm 各自认自己的代理设置：

```powershell
# git（只影响 github.com，或按需全局）
git config --global http.https://github.com.proxy http://<proxy-host>:<port>

# pnpm
pnpm config set proxy http://<proxy-host>:<port>
pnpm config set https-proxy http://<proxy-host>:<port>
```

### 6. pnpm 提示要 allowBuilds / 阻止了构建脚本

本插件**没有任何 `scripts`**（`lib/` 是直接提交的产物，不需要构建），所以正常不会触发
pnpm 的构建脚本拦截。若 pnpm 仍然报某个包需要 `allowBuilds`，按它打印的 key 写进
`$DSH_HOME/profiles/web/pnpm-workspace.yaml` 的 `allowBuilds`，再重跑第 2 步。

### 7. 想更新到最新版

```powershell
pnpm dsh plugin --profile web update @dsh-user/send-image
```

然后重启 `pnpm dsh web`。

---

## 附：临时试玩（不安装）

如果只是想在那台机器上临时体验一下，可以用**动态插件**：把仓库里的
`send-image.plugin.js` 内容交给 dsh 的 `cordis_define` / `cordis_run` 工具执行，
首次在 Run 卡片上点「允许」。这种方式**只在当前会话生效，重启即失效**，不用改 profile。

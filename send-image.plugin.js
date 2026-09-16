/**
 * send-image — DeepSeek Harness 动态插件（Host + Client）v3
 *
 * 功能：让 DSH 助手（模型）能在聊天中向用户发送图片，图片以卡片形式渲染，
 *       点击卡片即可放大查看（全屏灯箱，Esc / 点击背景 / 关闭按钮退出）。
 *
 * 实现原理：
 *  - Host 半区注册动态工具 `send_image`：读取图片文件（fs）→ 校验并持久化
 *    （attachments 服务，attachment-local）→ 返回内容寻址引用。模型看到的
 *    结果保持纯文本 JSON（deepseek 文本路由不会因图片块报 UNSUPPORTED_CONTENT）。
 *  - Host 半区同时注册包私有 RPC `send-image-read`：卡片凭完整引用（只可能
 *    出现在本会话日志里）经 attachments.readImage 读取字节并做摘要校验，
 *    返回 base64（沙箱内手工实现 base64，因为 Buffer 不可用且 btoa 是 UTF-8
 *    语义，不能编码二进制）。
 *  - Client 半区注册 `tool.call.toolview`（key: send_image）卡片：从工具结果
 *    JSON 解析引用 → host.call('send-image-read', { image }) 取回字节 →
 *    渲染缩略图 + 说明文字；点击打开自绘灯箱。
 *
 * 为什么不用内置 readAttachment：它要求会话日志里有事件以 image 块引用该
 * 附件（"Image is not referenced by this session"）；而把 image 块放进工具
 * 结果会让 deepseek 纯文本路由在下一次模型调用时抛 UNSUPPORTED_CONTENT。
 *
 * 使用方式（动态插件）：
 *  cordis_define → cordis_run（首次需在 Run 卡片点击"允许"）。
 *
 * 也可把 Host/Client 两个函数体移植进一个 dsh 客户端插件包长期安装。
 */

/* ----------------------------- Host 半区 ----------------------------- */
export const host = function () {
  return {
    apply(ctx) {
      const EXT_TO_MEDIA = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
      }
      const mediaTypeForPath = (path) => {
        const lower = String(path).toLowerCase()
        const dot = lower.lastIndexOf('.')
        if (dot < 0) return undefined
        return EXT_TO_MEDIA[lower.slice(dot)]
      }
      const baseName = (path) => {
        const p = String(path)
        return p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1)
      }
      const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
      const bytesToBase64 = (bytes) => {
        let out = ''
        const len = bytes.length
        for (let i = 0; i < len; i += 3) {
          const b0 = bytes[i]
          const b1 = i + 1 < len ? bytes[i + 1] : -1
          const b2 = i + 2 < len ? bytes[i + 2] : -1
          out += B64_ALPHABET[b0 >> 2]
          out += B64_ALPHABET[((b0 & 3) << 4) | (b1 < 0 ? 0 : b1 >> 4)]
          out += b1 < 0 ? '=' : B64_ALPHABET[((b1 & 15) << 2) | (b2 < 0 ? 0 : b2 >> 6)]
          out += b2 < 0 ? '=' : B64_ALPHABET[b2 & 63]
        }
        return out
      }

      // Browser cards read image bytes through this package-private handler. The
      // client supplies the full durable reference (only ever visible inside this
      // session's own log); readImage re-verifies the content-addressed digest,
      // so a fabricated or stale reference fails instead of serving bytes.
      harness.handle('send-image-read', async (args) => {
        if (args === null || typeof args !== 'object' || args.image === undefined || args.image === null
          || typeof args.image.attachmentId !== 'string' || typeof args.image.mediaType !== 'string') {
          return { ok: false, error: 'invalid image reference' }
        }
        const ref = {
          attachmentId: args.image.attachmentId,
          mediaType: args.image.mediaType,
          bytes: typeof args.image.bytes === 'number' ? args.image.bytes : 0,
          width: typeof args.image.width === 'number' ? args.image.width : 0,
          height: typeof args.image.height === 'number' ? args.image.height : 0,
          ...(typeof args.image.name === 'string' ? { name: args.image.name } : {}),
        }
        const attachments = ctx.get('attachments')
        if (attachments === undefined) return { ok: false, error: 'attachment service is not mounted' }
        try {
          const stored = await attachments.readImage(ref)
          return {
            ok: true,
            mediaType: stored.ref.mediaType,
            data: bytesToBase64(stored.data),
          }
        } catch (error) {
          const message = error !== null && typeof error === 'object' && typeof error.message === 'string'
            ? error.message
            : String(error)
          return { ok: false, error: message }
        }
      })

      const tool = harness.defineTool({
        name: 'send_image',
        description:
          'Send an image to the user in the chat: the image bytes are stored durably and the image is rendered as a clickable picture card in the conversation (the user can click it to enlarge). '
          + 'Use this tool whenever you want to present a picture to the user — an existing PNG/JPEG/WebP/GIF file, or one you just generated (for example with a Python script). '
          + 'Pass the file path and an optional short caption. Only PNG/JPEG/WebP/GIF files are accepted; the image is validated against the deployment attachment policy before it is sent.',
        parameters: {
          path: { type: 'string', required: true, description: 'Path to the image file (PNG/JPEG/WebP/GIF). Relative paths resolve against the session workspace directory.' },
          note: { type: 'string', description: 'Optional short caption shown with the image in the chat, e.g. what the image shows.' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ok: { type: 'boolean', required: true },
              path: { type: 'string', required: true },
              note: { type: 'string', required: true },
              image: {
                type: 'object',
                additionalProperties: false,
                required: true,
                properties: {
                  attachmentId: { type: 'string', required: true },
                  mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], required: true },
                  bytes: { type: 'integer', required: true },
                  width: { type: 'integer', required: true },
                  height: { type: 'integer', required: true },
                  name: { type: 'string' },
                },
              },
            },
          },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        execute: async (args, exec) => {
          const fs = ctx.get('fs')
          if (fs === undefined) throw new Error('send_image: the filesystem service is not mounted')
          const attachments = ctx.get('attachments')
          if (attachments === undefined) {
            throw new Error('send_image: the attachment service is not mounted; image sending is unavailable')
          }
          const path = String(args.path ?? '').trim()
          if (path === '') throw new Error('send_image: "path" must be a non-empty string')
          const mediaType = mediaTypeForPath(path)
          if (mediaType === undefined) {
            throw new Error('send_image: only PNG/JPEG/WebP/GIF image files can be sent (got "' + path + '")')
          }
          if (attachments.imageLimits.mediaTypes.indexOf(mediaType) < 0) {
            throw new Error('send_image: ' + mediaType + ' images are not accepted by this deployment')
          }
          const cwd = exec.agent !== undefined && exec.agent.session !== undefined
            ? exec.agent.session.header.cwd
            : undefined
          const target = await fs.resolve(path, cwd === undefined ? {} : { cwd })
          const byteCap = Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes)
          const data = await fs.readBytes(target, exec.signal, byteCap)
          const ref = await attachments.saveImage({ data, mediaType, name: baseName(path) })
          return {
            ok: true,
            path: fs.processPath(target),
            note: typeof args.note === 'string' ? args.note : '',
            image: {
              attachmentId: ref.attachmentId,
              mediaType: ref.mediaType,
              bytes: ref.bytes,
              width: ref.width,
              height: ref.height,
              ...(ref.name === undefined ? {} : { name: ref.name }),
            },
          }
        },
        presentCall: (args) => ({
          card: 'generic',
          title: 'Send image ' + String(args.path ?? ''),
        }),
      })
      harness.registerTool(ctx, tool)
    },
  }
}

/* ---------------------------- Client 半区 ----------------------------- */
export const client = function () {
  return {
    apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return

      styles.insert(
        '[data-send-image-card]{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.35));border-radius:10px;background:var(--dsw-alias-bg-layer-1, transparent);max-width:360px}'
        + '[data-send-image-card] [data-send-image-thumb]{padding:0;border:none;background:transparent;cursor:zoom-in;text-align:left;border-radius:8px;overflow:hidden;line-height:0}'
        + '[data-send-image-card] [data-send-image-thumb] img{display:block;max-width:320px;max-height:240px;border-radius:8px;object-fit:contain}'
        + '[data-send-image-card] [data-send-image-note]{font-size:12px;color:var(--dsw-alias-label-secondary, #888);white-space:pre-wrap;word-break:break-word}'
        + '[data-send-image-card] [data-send-image-status]{font-size:12px;color:var(--dsw-alias-label-secondary, #888)}'
        + '[data-send-image-card] [data-send-image-error]{font-size:12px;color:var(--dsw-alias-state-error-primary, #e5484d)}'
      )

      const bytesToBase64 = (bytes) => {
        let binary = ''
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
        return btoa(binary)
      }
      const base64ToBytes = (data) => {
        const binary = atob(data)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        return bytes
      }

      const imageUrl = (bytes, mediaType) => {
        try {
          if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
            return URL.createObjectURL(new Blob([bytes], { type: mediaType }))
          }
        } catch (e) { /* fall through to base64 */ }
        return 'data:' + mediaType + ';base64,' + bytesToBase64(bytes)
      }

      const openLightbox = (src, label) => {
        const root = document.createElement('div')
        root.setAttribute('data-send-image-lightbox', '')
        Object.assign(root.style, {
          position: 'fixed', inset: '0', zIndex: '2147483000', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          background: 'rgba(8,10,16,0.88)', padding: '24px',
        })
        const close = () => {
          document.removeEventListener('keydown', onKey)
          if (root.parentNode !== null) root.parentNode.removeChild(root)
        }
        const onKey = (e) => { if (e.key === 'Escape') close() }
        const mask = document.createElement('div')
        Object.assign(mask.style, { position: 'absolute', inset: '0' })
        mask.addEventListener('mousedown', close)
        const img = document.createElement('img')
        img.src = src
        img.alt = label
        Object.assign(img.style, {
          position: 'relative', maxWidth: '92vw', maxHeight: '92vh',
          objectFit: 'contain', borderRadius: '8px', boxShadow: '0 10px 50px rgba(0,0,0,.55)',
        })
        const closeBtn = document.createElement('button')
        closeBtn.type = 'button'
        closeBtn.setAttribute('aria-label', '关闭')
        closeBtn.textContent = '\u2715'
        Object.assign(closeBtn.style, {
          position: 'absolute', top: '18px', right: '18px', width: '38px', height: '38px',
          border: 'none', borderRadius: '50%', background: 'rgba(255,255,255,.14)',
          color: '#fff', fontSize: '15px', cursor: 'pointer', lineHeight: '1',
        })
        closeBtn.addEventListener('click', close)
        document.addEventListener('keydown', onKey)
        root.appendChild(mask)
        root.appendChild(img)
        root.appendChild(closeBtn)
        document.body.appendChild(root)
        closeBtn.focus()
      }

      const SendImageCard = (props) => {
        const block = props.block
        const sessionId = props.sessionId
        const [state, setState] = React.useState({ phase: 'running', src: null, note: '', label: '', error: null })
        const key = block === undefined ? 'none' : (block.kind === 'tool-result' ? 'r' + block.seq : 'c' + block.callId)

        React.useEffect(() => {
          if (block === undefined || block.kind !== 'tool-result') {
            setState({ phase: 'running', src: null, note: '', label: '', error: null })
            return
          }
          if (block.isError) {
            const message = block.error !== undefined && block.error !== null
              ? (block.error.message !== undefined ? block.error.message : String(block.error.code))
              : 'image delivery failed'
            setState({ phase: 'error', src: null, note: '', label: '', error: message })
            return
          }
          let text = ''
          const content = block.content
          if (Array.isArray(content)) {
            for (const c of content) {
              if (c !== null && typeof c === 'object' && c.type === 'text' && typeof c.text === 'string') text += c.text
            }
          }
          let image = null
          let note = ''
          try {
            const parsed = JSON.parse(text)
            if (parsed !== null && typeof parsed === 'object' && parsed.image !== undefined && parsed.image !== null) image = parsed.image
            if (parsed !== null && typeof parsed === 'object' && typeof parsed.note === 'string') note = parsed.note
          } catch (e) { /* not JSON */ }
          if (image === null || typeof image.attachmentId !== 'string' || typeof image.mediaType !== 'string') {
            setState({ phase: 'error', src: null, note: '', label: '', error: 'could not read the image reference' })
            return
          }
          let live = true
          let objectUrl = null
          setState({ phase: 'loading', src: null, note, label: '', error: null })
          host.call('send-image-read', { image }).then((result) => {
            if (!live) return
            if (result === null || typeof result !== 'object' || result.ok !== true) {
              const detail = result !== null && typeof result === 'object' && typeof result.error === 'string'
                ? result.error
                : 'unknown error'
              setState({ phase: 'error', src: null, note, label: '', error: detail })
              return
            }
            const bytes = base64ToBytes(result.data)
            const mediaType = typeof result.mediaType === 'string' && result.mediaType !== '' ? result.mediaType : image.mediaType
            objectUrl = imageUrl(bytes, mediaType)
            setState({
              phase: 'done',
              src: objectUrl,
              note,
              label: typeof image.name === 'string' && image.name !== '' ? image.name : 'image',
              error: null,
            })
          }).catch((err) => {
            if (!live) return
            setState({ phase: 'error', src: null, note, label: '', error: String(err !== null && err !== undefined && err.message !== undefined ? err.message : err) })
          })
          return () => {
            live = false
            if (objectUrl !== null && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(objectUrl)
          }
        }, [key, sessionId, block])

        if (state.phase === 'running') {
          return React.createElement('div', { 'data-send-image-card': '' },
            React.createElement('div', { 'data-send-image-status': '' }, '\u6b63\u5728\u53d1\u9001\u56fe\u7247\u2026'),
          )
        }
        if (state.phase === 'error') {
          return React.createElement('div', { 'data-send-image-card': '' },
            React.createElement('div', { 'data-send-image-error': '' }, String(state.error)),
          )
        }
        if (state.phase === 'loading') {
          return React.createElement('div', { 'data-send-image-card': '' },
            React.createElement('div', { 'data-send-image-status': '' }, '\u56fe\u7247\u52a0\u8f7d\u4e2d\u2026'),
            state.note !== '' && React.createElement('div', { 'data-send-image-note': '' }, state.note),
          )
        }
        const open = () => { openLightbox(state.src, state.label) }
        return React.createElement('div', { 'data-send-image-card': '' },
          React.createElement('button', {
            type: 'button',
            'data-send-image-thumb': '',
            title: '\u70b9\u51fb\u653e\u5927',
            'aria-label': '\u653e\u5927\u67e5\u770b ' + state.label,
            onClick: open,
          }, React.createElement('img', { src: state.src, alt: state.label })),
          state.note !== '' && React.createElement('div', { 'data-send-image-note': '' }, state.note),
        )
      }

      slots.inject('tool.call.toolview', () => slots.register(
        { name: 'tool.call.toolview', key: 'send_image' },
        SendImageCard,
      ))
    },
  }
}

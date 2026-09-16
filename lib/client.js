/**
 * @dsh-user/send-image — Client half (hand-written module-loader bundle).
 *
 * Renders the send_image tool call as a picture card in the conversation.
 *
 * SELF-CONTAINED BY DESIGN. The only module this bundle requires is 'react',
 * which is a genuine platform seed word (packages/client/web/src/seed.ts).
 *
 * It deliberately does NOT import @deepseek-ai/dsh-client-ui-attachment: that
 * package's client half registers slot components but exports NO React
 * components ("Register attachment presentation without exporting React
 * components as package values"), and it is not a platform seed word either —
 * requiring it resolves only by boot-order luck and yields undefined. The
 * thumbnail, the loading/error states, and the click-to-enlarge lightbox are
 * therefore implemented here with plain DOM.
 *
 * Image bytes come from the plugin's own HTTP route /send-image/... (host
 * half), so no session-reference authorization is needed and the model-visible
 * tool result stays plain JSON text (DeepSeek text-only route compatible).
 */
window.__ModuleLoader__.load({
  id: '@dsh-user/send-image',
  factory: (require) => {
    var React = require('react')
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var MEDIA_TO_EXT = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif',
    }

    /** One durable ref -> the plugin's bytes route URL (carries the full ref). */
    function imageUrl(image) {
      var id = String(image.attachmentId)
      var sha = id.indexOf('sha256:') === 0 ? id.slice(7) : id
      var ext = MEDIA_TO_EXT[image.mediaType] || 'png'
      return '/send-image/'
        + sha + '/'
        + image.bytes + '/'
        + image.width + '/'
        + image.height + '.'
        + ext
    }

    /** Parse the settled tool result text (JSON with { image, note }) into card state. */
    function parseBlock(block) {
      if (block === undefined || block === null || block.kind !== 'tool-result') {
        return { kind: 'running' }
      }
      if (block.isError) {
        var message = block.error !== undefined && block.error !== null
          ? (block.error.message !== undefined ? block.error.message : String(block.error.code))
          : '图片发送失败'
        return { kind: 'error', error: message }
      }
      var text = ''
      var content = block.content
      if (Array.isArray(content)) {
        for (var i = 0; i < content.length; i++) {
          var c = content[i]
          if (c !== null && typeof c === 'object' && c.type === 'text' && typeof c.text === 'string') text += c.text
        }
      }
      var parsed = null
      try { parsed = JSON.parse(text) } catch (e) { parsed = null }
      var image = parsed !== null && typeof parsed === 'object' ? parsed.image : null
      var note = parsed !== null && typeof parsed === 'object' && typeof parsed.note === 'string' ? parsed.note : ''
      if (image === null || typeof image !== 'object'
        || typeof image.attachmentId !== 'string' || typeof image.mediaType !== 'string') {
        return { kind: 'error', error: '无法解析图片引用' }
      }
      return { kind: 'done', image: image, note: note }
    }

    /** Full-screen lightbox built with plain DOM (Esc / backdrop / close button). */
    function openLightbox(src, label) {
      if (typeof document === 'undefined') return
      var root = document.createElement('div')
      root.setAttribute('data-send-image-lightbox', '')
      Object.assign(root.style, {
        position: 'fixed', inset: '0', zIndex: '2147483000', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'rgba(8,10,16,0.88)', padding: '24px',
      })
      var onKey = function (e) { if (e.key === 'Escape') close() }
      var close = function () {
        document.removeEventListener('keydown', onKey)
        if (root.parentNode !== null) root.parentNode.removeChild(root)
      }
      var mask = document.createElement('div')
      Object.assign(mask.style, { position: 'absolute', inset: '0' })
      mask.addEventListener('mousedown', close)
      var img = document.createElement('img')
      img.src = src
      img.alt = label
      Object.assign(img.style, {
        position: 'relative', maxWidth: '92vw', maxHeight: '92vh',
        objectFit: 'contain', borderRadius: '8px', boxShadow: '0 10px 50px rgba(0,0,0,.55)',
      })
      var closeBtn = document.createElement('button')
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

    function SendImageCard(props) {
      var block = props.block
      var parsed = parseBlock(block)
      var failedState = React.useState(false)
      var failed = failedState[0]
      var setFailed = failedState[1]
      var key = block === undefined || block === null
        ? 'none'
        : (block.kind === 'tool-result' ? 'r' + block.seq : 'c' + block.callId)
      React.useEffect(function () { setFailed(false) }, [key])

      if (parsed.kind === 'running') {
        return React.createElement('div', { 'data-send-image-card': '' },
          React.createElement('div', { 'data-send-image-status': '' }, '正在发送图片…'),
        )
      }
      if (parsed.kind === 'error') {
        return React.createElement('div', { 'data-send-image-card': '' },
          React.createElement('div', { 'data-send-image-error': '' }, String(parsed.error)),
        )
      }

      var url = imageUrl(parsed.image)
      var label = typeof parsed.image.name === 'string' && parsed.image.name !== '' ? parsed.image.name : 'image'
      return React.createElement('div', { 'data-send-image-card': '' },
        React.createElement('button', {
          type: 'button',
          'data-send-image-thumb': '',
          title: '点击放大',
          'aria-label': '放大查看 ' + label,
          onClick: function () { openLightbox(url, label) },
        }, React.createElement('img', {
          src: url,
          alt: label,
          onLoad: function () { setFailed(false) },
          onError: function () { setFailed(true) },
        })),
        failed ? React.createElement('div', { 'data-send-image-error': '' }, '图片加载失败') : null,
        parsed.note !== '' ? React.createElement('div', { 'data-send-image-note': '' }, parsed.note) : null,
      )
    }

    var CSS =
      '[data-send-image-card]{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.35));border-radius:10px;background:var(--dsw-alias-bg-layer-1, transparent);max-width:360px}'
      + '[data-send-image-card] [data-send-image-thumb]{padding:0;border:none;background:transparent;cursor:zoom-in;text-align:left;border-radius:8px;overflow:hidden;line-height:0}'
      + '[data-send-image-card] [data-send-image-thumb] img{display:block;max-width:320px;max-height:240px;border-radius:8px;object-fit:contain}'
      + '[data-send-image-card] [data-send-image-note]{font-size:12px;color:var(--dsw-alias-label-secondary, #888);white-space:pre-wrap;word-break:break-word}'
      + '[data-send-image-card] [data-send-image-status]{font-size:12px;color:var(--dsw-alias-label-secondary, #888)}'
      + '[data-send-image-card] [data-send-image-error]{font-size:12px;color:var(--dsw-alias-state-error-primary, #e5484d)}'

    function apply(ctx) {
      if (typeof document !== 'undefined') {
        var style = document.createElement('style')
        style.setAttribute('data-plugin', '@dsh-user/send-image')
        style.textContent = CSS
        document.head.append(style)
      }
      ctx.slots.inject('tool.call.toolview', function () {
        return ctx.slots.register(
          { name: 'tool.call.toolview', key: 'send_image' },
          SendImageCard,
        )
      })
    }

    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})

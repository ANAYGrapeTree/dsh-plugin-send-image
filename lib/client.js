/**
 * @dsh-user/send-image — Client half (hand-written module-loader bundle).
 *
 * Renders `send_image` tool calls as a picture card in the conversation using
 * the shipped attachment atoms (`@deepseek-ai/dsh-client-ui-attachment` is a
 * platform seed word): the built-in MessageImage/ImageGallery provide the
 * thumbnail, loading/retry states, and the click-to-enlarge lightbox.
 *
 * Image bytes come from the plugin's own HTTP route `/send-image/…` (host
 * half), so no session-reference authorization is needed and the model-visible
 * tool result stays plain JSON text (DeepSeek text-only route compatible).
 */
window.__ModuleLoader__.load({
  id: '@dsh-user/send-image',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    var React = require('react')
    var UiAttachment = require('@deepseek-ai/dsh-client-ui-attachment')

    var MEDIA_TO_EXT = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif',
    }

    /** One durable ref -> the plugin's bytes route URL (carries the full ref). */
    function imageUrl(attachment) {
      var id = String(attachment.attachmentId)
      var sha = id.indexOf('sha256:') === 0 ? id.slice(7) : id
      var ext = MEDIA_TO_EXT[attachment.mediaType] || 'png'
      return '/send-image/'
        + sha + '/'
        + attachment.bytes + '/'
        + attachment.width + '/'
        + attachment.height + '.'
        + ext
    }

    function loader(attachment) {
      return Promise.resolve(imageUrl(attachment))
    }

    var LABELS = {
      image: '图片',
      open: '点击查看原图',
      openNamed: (label) => '放大查看 ' + label,
      loading: '图片加载中…',
      loadFailed: '图片加载失败，点击重试',
      lightbox: { dialog: '图片预览', close: '关闭' },
    }

    /** Parse the settled tool result text (JSON with { image, note }) into card state. */
    function parseSettled(block) {
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
      var image = null
      var note = ''
      try {
        var parsed = JSON.parse(text)
        if (parsed !== null && typeof parsed === 'object' && parsed.image !== undefined && parsed.image !== null) image = parsed.image
        if (parsed !== null && typeof parsed === 'object' && typeof parsed.note === 'string') note = parsed.note
      } catch (e) { /* not JSON */ }
      if (image === null || typeof image.attachmentId !== 'string' || typeof image.mediaType !== 'string') {
        return { kind: 'error', error: '无法解析图片引用' }
      }
      return { kind: 'done', images: [{ attachment: image }], note }
    }

    function SendImageCard(props) {
      var block = props.block
      var parsed
      if (block === undefined || block.kind !== 'tool-result') {
        parsed = { kind: 'running' }
      } else {
        parsed = parseSettled(block)
      }
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
      return React.createElement('div', { 'data-send-image-card': '' },
        React.createElement(UiAttachment.ImageGallery, {
          images: parsed.images,
          load: loader,
          align: 'start',
          labels: LABELS,
        }),
        parsed.note !== '' && React.createElement('div', { 'data-send-image-note': '' }, parsed.note),
      )
    }

    var CSS =
      '[data-send-image-card]{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.35));border-radius:10px;background:var(--dsw-alias-bg-layer-1, transparent);max-width:360px}'
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

    exports.name = 'send-image'
    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})

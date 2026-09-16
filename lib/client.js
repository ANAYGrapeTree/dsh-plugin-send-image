/**
 * @dsh-user/send-image — Client half (hand-written module-loader bundle).
 *
 * The picture is rendered in the conversation BODY, not inside the Tool-call
 * group, through two coordinated registrations:
 *
 *  1. `conversation.chat.node` (key `send-image`) — a ConversationNodeDefinition
 *     folds this Turn's `send_image` results and materializes ONE Chat row that
 *     holds the pictures. The row is anchored just past the Turn's answer
 *     boundary, which is exactly the Turn-process fold's exclusive end, so the
 *     row is not a process member: it stays visible next to the answer while the
 *     Tool group is collapsed (compact transcript included).
 *  2. `tool.call.toolview` (key `send_image`) — the Tool row itself degrades to a
 *     one-line status, so the same picture is never painted twice.
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

    var TOOL_NAME = 'send_image'
    var NODE_KIND = 'send-image'
    /**
     * Synthetic anchor offset for the image row. The Turn-process fold claims
     * `[processStartSeq, answerAnchorSeq)`, so the row must sit at or after
     * `answerAnchorSeq` to stay out of it; it must also stay below the turn-tail
     * row, which anchors at the closing assistant's seq + 0.1
     * (CHAT_SYNTHETIC_SEQ_OFFSETS.finalizedFollowup). 0.06 lands between the
     * max-tokens notice (0.05) and the turn tail (0.1).
     */
    var IMAGE_ANCHOR_OFFSET = 0.06

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

    /** Accessible name of one image reference. */
    function imageLabel(image) {
      return typeof image.name === 'string' && image.name !== '' ? image.name : 'image'
    }

    /** Concatenate the text parts of one Tool result content block. */
    function resultText(block) {
      var out = ''
      var content = block === undefined || block === null ? undefined : block.content
      if (!Array.isArray(content)) return out
      for (var i = 0; i < content.length; i++) {
        var part = content[i]
        if (part !== null && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string') {
          out += part.text
        }
      }
      return out
    }

    /** Parse one send_image Tool result block into `{ image, note }`, else null. */
    function readImageResult(block) {
      var parsed = null
      try { parsed = JSON.parse(resultText(block)) } catch (e) { return null }
      if (parsed === null || typeof parsed !== 'object') return null
      var image = parsed.image
      if (image === null || typeof image !== 'object'
        || typeof image.attachmentId !== 'string' || typeof image.mediaType !== 'string') return null
      return { image: image, note: typeof parsed.note === 'string' ? parsed.note : '' }
    }

    /** Parse the settled Tool-result block (JSON with { image, note }) into card state. */
    function parseCard(block) {
      if (block === undefined || block === null || block.kind !== 'tool-result') {
        return { kind: 'running' }
      }
      if (block.isError) {
        var message = block.error !== undefined && block.error !== null
          ? (block.error.message !== undefined ? block.error.message : String(block.error.code))
          : '图片发送失败'
        return { kind: 'error', error: message }
      }
      var found = readImageResult(block)
      if (found === null) return { kind: 'error', error: '无法解析图片引用' }
      return { kind: 'done', image: found.image, note: found.note }
    }

    /* --------------------- Conversation business Definition --------------------- */

    /** Turn-scoped fold of this Turn's send_image results. */
    function nextState(state, patch) {
      return {
        turn: state.turn,
        calls: patch.calls === undefined ? state.calls : patch.calls,
        images: patch.images === undefined ? state.images : patch.images,
      }
    }

    function matchEvent(event) {
      if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
      if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
      if (event.type === 'tool/result' && event.surfaceOp === 'append') {
        return { id: String(event.data.turn), role: 'update' }
      }
      // Closes the Turn: the Turn-process fold appears with it, and the row has
      // to re-anchor past the answer boundary on this rebuild.
      if (event.type === 'turn/end') return { id: String(event.data.turn), role: 'update' }
      return null
    }

    function startEvent(_context, matched) {
      if (matched.event.type !== 'turn/start') throw new Error('send-image start requires turn/start')
      return { turn: matched.event.data.turn, calls: new Map(), images: [] }
    }

    function updateEvent(context, matched) {
      var state = context.state
      var event = matched.event
      if (event.type === 'tool/call') {
        if (event.data.name !== TOOL_NAME) return state
        var calls = new Map(state.calls)
        calls.set(String(event.data.callId), true)
        return nextState(state, { calls: calls })
      }
      if (event.type === 'tool/result') {
        var message = event.data.message
        var source = message === undefined || message === null ? undefined : message.source
        if (source === undefined || source === null) return state
        var callId = String(source.callId)
        if (state.calls.has(callId) !== true) return state
        var first = Array.isArray(message.content) ? message.content[0] : undefined
        if (first === undefined || first === null || first.isError === true) return state
        var found = readImageResult(first)
        if (found === null) return state
        // One picture per call: a re-delivered or retried result replaces the
        // earlier entry instead of stacking a stale duplicate.
        var kept = state.images.filter(function (entry) { return entry.callId !== callId })
        return nextState(state, {
          images: kept.concat([{ callId: callId, seq: event.seq, image: found.image, note: found.note }]),
        })
      }
      if (event.type === 'turn/end') return nextState(state, {})
      return state
    }

    /**
     * Anchor the image row next to the Turn's answer. While the Turn runs the
     * fold is inactive and the row simply follows the last image result; once the
     * answer boundary is published the row moves past it, because
     * `answerAnchorSeq` is the fold's exclusive end.
     */
    function imageAnchor(state, turn) {
      var last = state.images[state.images.length - 1]
      if (turn === undefined || turn === null || turn.data === undefined
        || typeof turn.data.get !== 'function') return last.seq
      var process = turn.data.get('turn-process')
      var answerAnchor = process === undefined || process === null ? null : process.answerAnchorSeq
      return typeof answerAnchor === 'number' ? answerAnchor + IMAGE_ANCHOR_OFFSET : last.seq
    }

    function buildNode(context) {
      var state = context.state
      // Before the first image the Context owns no row at all; once images exist
      // the row is permanent for this Turn (the fold never shrinks to empty).
      if (state === undefined || state.images.length === 0) return null
      var location = context.start === undefined ? undefined : context.start.location
      if (location === undefined || (location.kind !== 'turn' && location.kind !== 'step')) return null
      return {
        key: context.key,
        kind: NODE_KIND,
        id: context.id,
        target: 'chat',
        anchorSeq: imageAnchor(state, location.turn),
        location: location,
        visibility: 'visible',
        data: { turn: state.turn, images: state.images },
      }
    }

    /** One Chat row per Turn carrying that Turn's sent pictures, in send order. */
    var sendImageDefinition = {
      kind: NODE_KIND,
      target: 'chat',
      match: matchEvent,
      start: startEvent,
      update: updateEvent,
      buildViewNode: buildNode,
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

    /** One zoomable picture with its optional caption. */
    function ImageItem(item, key) {
      var label = imageLabel(item.image)
      var src = imageUrl(item.image)
      return React.createElement('div', { key: key, 'data-send-image-item': '' },
        React.createElement('button', {
          type: 'button',
          'data-send-image-thumb': '',
          title: '点击放大',
          'aria-label': '放大查看 ' + label,
          onClick: function () { openLightbox(src, label) },
        }, React.createElement('img', { src: src, alt: label })),
        item.note === undefined || item.note === '' ? null
          : React.createElement('div', { 'data-send-image-note': '' }, item.note),
      )
    }

    /** Chat row renderer for `NODE_KIND`: the conversation-body picture row. */
    function SendImageRow(props) {
      var node = props.node
      var data = node === undefined || node === null ? undefined : node.data
      var images = data !== undefined && data !== null && Array.isArray(data.images) ? data.images : []
      if (images.length === 0) return null
      return React.createElement('div', { 'data-send-image-flow': '' },
        images.map(function (item, index) {
          return ImageItem(item, String(item.seq) + ':' + index)
        }),
      )
    }

    /** Compact Tool row: the picture itself lives in the conversation body row. */
    function SendImageCard(props) {
      var block = props.block
      var parsed = parseCard(block)
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
        React.createElement('div', { 'data-send-image-status': '' }, '已发送图片 · ' + imageLabel(parsed.image)),
        parsed.note !== '' ? React.createElement('div', { 'data-send-image-note': '' }, parsed.note) : null,
      )
    }

    var CSS =
      '[data-send-image-card]{display:flex;flex-direction:column;align-items:flex-start;gap:2px;max-width:100%}'
      + '[data-send-image-flow]{display:flex;flex-direction:column;gap:12px;max-width:100%}'
      + '[data-send-image-flow] [data-send-image-item]{display:flex;flex-direction:column;align-items:flex-start;gap:6px;max-width:100%}'
      + '[data-send-image-card] [data-send-image-thumb],[data-send-image-flow] [data-send-image-thumb]{padding:0;border:none;background:transparent;cursor:zoom-in;text-align:left;border-radius:8px;overflow:hidden;line-height:0}'
      + '[data-send-image-flow] [data-send-image-thumb] img{display:block;max-width:min(100%, 640px);max-height:480px;border-radius:8px;object-fit:contain}'
      + '[data-send-image-card] [data-send-image-thumb] img{display:block;max-width:100%;max-height:160px;border-radius:6px;object-fit:contain}'
      + '[data-send-image-card] [data-send-image-status]{font-size:12px;color:var(--dsw-alias-label-secondary, #888);word-break:break-word}'
      + '[data-send-image-card] [data-send-image-note],[data-send-image-flow] [data-send-image-note]{font-size:12px;color:var(--dsw-alias-label-secondary, #888);white-space:pre-wrap;word-break:break-word}'
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
          { name: 'tool.call.toolview', key: TOOL_NAME },
          SendImageCard,
        )
      })
      // The conversation-body row needs the Conversation engine. Declared as a
      // derived dependency rather than a plugin-level hard inject: a build
      // without the service keeps the Tool row instead of losing the Tool.
      ctx.inject(['slots', 'uiConversation'], function (scope) {
        scope.effect(
          function () { return scope.uiConversation.events.register(sendImageDefinition) },
          'send-image: conversation node',
        )
        scope.slots.inject('conversation.chat.node', function () {
          return scope.slots.register(
            { name: 'conversation.chat.node', key: NODE_KIND },
            SendImageRow,
          )
        })
      })
    }

    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})

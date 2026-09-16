/**
 * @dsh-user/send-image — Host half.
 *
 * Registers the `send_image` tool (read file → attachment service → durable
 * content-addressed ref) and an HTTP route `/send-image/…` that streams the
 * image bytes back to the browser card after digest + metadata verification.
 *
 * The tool result stays text-only JSON so the DeepSeek text-only route never
 * sees an image content block (which would throw UNSUPPORTED_CONTENT on the
 * next model call). The browser card renders the image from the route URL.
 *
 * Deliberately dependency-free: the definition is hand-rolled (plain JSON
 * Schema), so the package needs nothing beyond the harness's own services.
 */
'use strict'

const EXT_TO_MEDIA = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

function mediaTypeForPath(path) {
  const lower = String(path).toLowerCase()
  const dot = lower.lastIndexOf('.')
  if (dot < 0) return undefined
  const ext = lower.slice(dot + 1)
  return ext === 'jpeg' ? 'image/jpeg' : EXT_TO_MEDIA[ext]
}

function baseName(path) {
  const p = String(path)
  return p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1)
}

function makeTool(ctx) {
  return {
  name: 'send_image',
  description:
    'Send an image to the user in the chat: the image bytes are stored durably and the image is rendered as a clickable picture card in the conversation (the user can click it to enlarge). '
    + 'Use this tool whenever you want to present a picture to the user — an existing PNG/JPEG/WebP/GIF file, or one you just generated (for example with a Python script). '
    + 'Pass the file path and an optional short caption. Only PNG/JPEG/WebP/GIF files are accepted; the image is validated against the deployment attachment policy before it is sent.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the image file (PNG/JPEG/WebP/GIF). Relative paths resolve against the session workspace directory.' },
      note: { type: 'string', description: 'Optional short caption shown with the image in the chat, e.g. what the image shows.' },
    },
    required: ['path'],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        path: { type: 'string' },
        note: { type: 'string' },
        image: {
          type: 'object',
          additionalProperties: false,
          properties: {
            attachmentId: { type: 'string' },
            mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] },
            bytes: { type: 'integer' },
            width: { type: 'integer' },
            height: { type: 'integer' },
            name: { type: 'string' },
          },
          required: ['attachmentId', 'mediaType', 'bytes', 'width', 'height'],
        },
      },
      required: ['ok', 'path', 'note', 'image'],
    },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  async execute(args, exec) {
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
  }
}

function apply(ctx) {
  // Image bytes route. The URL carries the full durable reference (sha256 id,
  // bytes, dimensions, media-type extension); readImage re-verifies the
  // content-addressed digest AND the metadata against the stored object, so a
  // fabricated or stale URL never serves bytes.
  const webServer = ctx.get('webServer')
  if (webServer !== undefined) {
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: '/send-image',
      handler: async (req, res) => {
        try {
          const pathname = new URL(req.url ?? '/', 'http://dsh.local').pathname
          const match = /^\/send-image\/([0-9a-f]{64})\/(\d+)\/(\d+)\/(\d+)\.(png|jpg|webp|gif)$/.exec(pathname)
          const mediaType = match === undefined ? undefined : EXT_TO_MEDIA[match[5]]
          if (match === undefined || mediaType === undefined) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('not found')
            return
          }
          const attachments = ctx.get('attachments')
          if (attachments === undefined) {
            res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('attachment service unavailable')
            return
          }
          const ref = {
            attachmentId: 'sha256:' + match[1],
            mediaType,
            bytes: Number(match[2]),
            width: Number(match[3]),
            height: Number(match[4]),
          }
          const stored = await attachments.readImage(ref)
          res.writeHead(200, {
            'Content-Type': mediaType,
            'Content-Length': stored.data.byteLength,
            'Cache-Control': 'public, max-age=31536000, immutable',
          })
          res.end(Buffer.from(stored.data))
        } catch (error) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('not found')
        }
      },
    }), 'send-image: bytes route')
  }

  ctx.tools.register(makeTool(ctx))
}

module.exports = { name: 'send-image', inject: ['tools', 'webServer'], apply }

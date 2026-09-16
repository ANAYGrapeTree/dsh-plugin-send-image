// Throwaway smoke harness for lib/client.js (no browser needed).
// Stubs window.__ModuleLoader__ + React, captures the plugin's registrations,
// then drives the ConversationNodeDefinition with synthetic session events.
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

let registration = null
const React = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children }
  },
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
}

globalThis.window = {
  __ModuleLoader__: {
    load(handoff) { registration = handoff },
  },
}
globalThis.document = undefined

// eslint-disable-next-line no-new-func
new Function('window', 'require', source)(globalThis.window, (id) => {
  if (id === 'react') return React
  throw new Error('unexpected require: ' + id)
})

const registered = { toolviews: [], nodes: [], definitions: [], effects: [] }
const slots = {
  inject(key, callback) { callback(); return () => {} },
  register(options, component) {
    if (options.name === 'tool.call.toolview') registered.toolviews.push({ options, component })
    else registered.nodes.push({ options, component })
    return () => {}
  },
}
const scopeSlots = {
  inject(key, callback) { callback(); return () => {} },
  register(options, component) {
    registered.nodes.push({ options, component })
    return () => {}
  },
}
const ctx = {
  slots,
  inject(deps, callback) {
    const scope = {
      slots: scopeSlots,
      effect(fn, label) { registered.effects.push(label); return fn() },
      uiConversation: {
        events: { register(definition) { registered.definitions.push(definition); return () => {} } },
      },
    }
    callback(scope)
    return () => {}
  },
}
const plugin = registration.factory((id) => {
  if (id === 'react') return React
  throw new Error('unexpected factory require: ' + id)
})
plugin.apply(ctx)

const definition = registered.definitions[0]
if (definition === undefined) throw new Error('no ConversationNodeDefinition registered')

/* ------------------------------- assertions ------------------------------- */
const checks = []
const check = (name, condition, detail) => {
  checks.push({ name, ok: condition === true, detail })
}

check('definition kind/target', definition.kind === 'send-image' && definition.target === 'chat')
check('toolview key', registered.toolviews[0]?.options.key === 'send_image')
check('chat node key', registered.nodes[0]?.options.key === 'send-image')
check('toolview kept at plugin level (inject slots only)', plugin.inject.length === 1 && plugin.inject[0] === 'slots')

/* Wait: plugin factory already consumed; inspect exports through a second load. */
const turnData = new Map()
const turnStore = { get: (key) => turnData.get(key) }
const turnLocation = { kind: 'turn', turn: { turn: 1, status: 'open', data: turnStore } }
const resultJson = (name, note) => JSON.stringify({
  ok: true,
  path: 'C:/w/' + name,
  note,
  image: { attachmentId: 'sha256:' + 'a'.repeat(64), mediaType: 'image/png', bytes: 12, width: 4, height: 5, name },
})

const start = { type: 'turn/start', seq: 1, data: { turn: 1 } }
const foreignCall = { type: 'tool/call', seq: 2, data: { turn: 1, step: 1, callId: 'x1', name: 'bash', arguments: '{}' } }
const sendCall = { type: 'tool/call', seq: 3, data: { turn: 1, step: 1, callId: 'c1', name: 'send_image', arguments: '{}' } }
const foreignResult = {
  type: 'tool/result', seq: 4, surfaceOp: 'append',
  data: { turn: 1, message: { source: { callId: 'x1' }, content: [{ isError: false, content: [{ type: 'text', text: resultJson('x.png', '') }] }] } },
}
const sendResult = {
  type: 'tool/result', seq: 5, surfaceOp: 'append',
  data: { turn: 1, message: { source: { callId: 'c1' }, content: [{ isError: false, content: [{ type: 'text', text: resultJson('a.png', 'cap one') }] }] } },
}
const sendResult2 = {
  type: 'tool/result', seq: 9, surfaceOp: 'append',
  data: { turn: 1, message: { source: { callId: 'c2' }, content: [{ isError: false, content: [{ type: 'text', text: resultJson('b.png', '') }] }] } },
}
const sendCall2 = { type: 'tool/call', seq: 8, data: { turn: 1, step: 1, callId: 'c2', name: 'send_image', arguments: '{}' } }
const turnEnd = { type: 'turn/end', seq: 20, data: { turn: 1, reason: { kind: 'completed' } } }

const match = (event) => definition.match(event)
check('match turn/start is start', match(start)?.role === 'start' && match(start)?.id === '1')
check('match tool/call', match(foreignCall)?.role === 'update')
check('match tool/result append', match(sendResult)?.role === 'update')
check('match replacement result ignored', match({ ...sendResult, surfaceOp: 'replace' }) === null)
check('match unrelated event ignored', match({ type: 'assistant/message', seq: 6, data: { turn: 1 } }) === null)

let state = definition.start({}, { event: start, role: 'start' })
const context = () => ({
  key: 'ctx:1', id: '1', kind: 'send-image', target: 'chat',
  matches: [], start: { event: start, role: 'start', location: turnLocation }, state, current: new Map(),
})
const apply_ = (event) => { state = definition.update({ ...context(), state }, { event, role: 'update', location: turnLocation }) }

apply_(foreignCall)
apply_(foreignResult)
check('foreign tool result ignored', state.images.length === 0)
check('no node before the first image', definition.buildViewNode(context()) === null)

apply_(sendCall)
apply_(sendResult)
check('image folded', state.images.length === 1 && state.images[0].seq === 5)
check('note folded', state.images[0].note === 'cap one')

const preAnswer = definition.buildViewNode(context())
check('pre-answer anchor = result seq', preAnswer.anchorSeq === 5, JSON.stringify(preAnswer.anchorSeq))
check('node kind/target/visible', preAnswer.kind === 'send-image' && preAnswer.target === 'chat' && preAnswer.visibility === 'visible')
check('node location is the turn', preAnswer.location.kind === 'turn' && preAnswer.location.turn.turn === 1)
check('node key stable', preAnswer.key === 'ctx:1')

apply_(sendCall2)
apply_(sendResult2)
check('second image folded in order', state.images.length === 2 && state.images[1].seq === 9)

// A re-delivered / retried result for the same call must replace, not stack.
apply_({ ...sendResult, seq: 11 })
check('same call does not stack', state.images.length === 2
  && new Set(state.images.map(entry => entry.callId)).size === 2, JSON.stringify(state.images.map(e => [e.callId, e.seq])))
check('replacement carries the newest seq', state.images.some(entry => entry.callId === 'c1' && entry.seq === 11))
apply_({ ...sendResult2, seq: 12 })
check('per-call replacement keeps one entry per call', state.images.length === 2
  && state.images.filter(entry => entry.callId === 'c2')[0].seq === 12)

// The Turn-process fold publishes its spec (answer boundary) at turn scope, and
// the Turn closes: the row must move past the fold's exclusive end.
apply_(turnEnd)
check('turn end keeps images', state.images.length === 2)
turnData.set('turn-process', { turn: 1, answerAnchorSeq: 14, answerStep: 2, processStartSeq: 1, controlAnchorSeq: 2 })

const postAnswer = definition.buildViewNode(context())
check('post-answer anchor clears the fold', postAnswer.anchorSeq === 14.06, JSON.stringify(postAnswer.anchorSeq))
check('post-answer anchor beats result seq', postAnswer.anchorSeq > 9)
check('post-answer row still visible', postAnswer.visibility === 'visible')

// A turn without images never materializes a row (and never withdraws one).
let emptyState = definition.start({}, { event: start, role: 'start' })
const emptyContext = { key: 'ctx:2', id: '2', kind: 'send-image', target: 'chat', matches: [], start: { event: start, role: 'start', location: turnLocation }, state: emptyState, current: new Map() }
emptyState = definition.update({ ...emptyContext, state: emptyState }, { event: foreignCall, role: 'update', location: turnLocation })
check('imageless turn stays null', definition.buildViewNode({ ...emptyContext, state: emptyState }) === null)

// Components: the Tool row must stay a one-liner, the body row must show pictures.
const ToolCard = registered.toolviews[0].component
const settledBlock = {
  kind: 'tool-result', seq: 5, callId: 'c1', isError: false,
  content: [{ type: 'text', text: resultJson('a.png', 'cap one') }],
}
const card = ToolCard({ block: settledBlock })
const cardText = JSON.stringify(card)
check('tool row has no picture', !cardText.includes('"img"'), cardText.slice(0, 200))
check('tool row names the file', cardText.includes('已发送图片 · a.png'))
check('tool row keeps the caption', cardText.includes('cap one'))
check('running tool row', JSON.stringify(ToolCard({ block: { kind: 'tool-call', callId: 'c1' } })).includes('正在发送图片'))

const row = registered.nodes[0].component({ node: { kind: 'send-image', data: { turn: 1, images: state.images } } })
const rowText = JSON.stringify(row)
check('body row renders both pictures', (rowText.match(/"img"/g) ?? []).length === 2, rowText.slice(0, 300))
check('body row uses the bytes route', rowText.includes('/send-image/' + 'a'.repeat(64) + '/12/4/5.png'))
check('body row keeps the caption', rowText.includes('cap one'))
check('body row empty-safe', registered.nodes[0].component({ node: { kind: 'send-image', data: { images: [] } } }) === null)

let failed = 0
for (const entry of checks) {
  if (!entry.ok) failed += 1
  console.log((entry.ok ? 'PASS  ' : 'FAIL  ') + entry.name + (entry.ok || entry.detail === undefined ? '' : '  <- ' + entry.detail))
}
console.log('\n' + (checks.length - failed) + '/' + checks.length + ' checks passed')
process.exitCode = failed === 0 ? 0 : 1

// Stand-ins for Telegram and the AI, on localhost, so conversations can be tested for free and exactly.
// - fakeTelegram(): records every Bot API call (sendMessage, editMessageReplyMarkup, …) and answers ok.
// - fakeAI(): answers each AI request from a script the test sets up ("the brain says…", "the sorter says…").
import http from 'node:http'

async function serve(handler) {
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', async () => {
      try {
        const out = await handler(req, body ? JSON.parse(body) : {})
        res.statusCode = out.status ?? 200
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(out.json))
      } catch (e) {
        res.statusCode = 500
        res.end(JSON.stringify({ error: String(e) }))
      }
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { server, url: `http://127.0.0.1:${server.address().port}` }
}

export async function fakeTelegram() {
  const calls = []
  const failures = []   // [method, description]: the next call of that method fails like Telegram does
  let nextId = 1000
  const { server, url } = await serve((req, body) => {
    const method = req.url.split('/').pop()
    const f = failures.findIndex(([m]) => m === method)
    if (f >= 0) {
      const [, description] = failures.splice(f, 1)[0]
      calls.push({ method, body, result: null, failed: description })
      return { status: 400, json: { ok: false, error_code: 400, description } }
    }
    const result = method === 'sendMessage' ? { message_id: ++nextId, chat: { id: body.chat_id }, text: body.text } : true
    calls.push({ method, body, result })
    return { json: { ok: true, result } }
  })
  return {
    url, calls, close: () => server.close(),
    failNext: (method, description) => failures.push([method, description]),
    of: (method) => calls.filter((c) => c.method === method && !c.failed),
    sent: () => calls.filter((c) => c.method === 'sendMessage').map((c) => ({ ...c.body, message_id: c.result.message_id })),
    clear: () => { calls.length = 0; failures.length = 0 },
  }
}

/**
 * Each AI request is answered by the next scripted reply for its model. A request nobody scripted fails
 * the test loudly (status 500 + recorded in `unexpected`), so a missing or extra AI call is always caught.
 */
export async function fakeAI() {
  const requests = []
  const unexpected = []
  const queues = new Map()   // model -> [reply | fn]
  const { server, url } = await serve(async (req, body) => {
    requests.push({ path: req.url, headers: req.headers, body })
    const q = queues.get(body.model) ?? []
    const next = q.shift()
    if (!next) {
      unexpected.push(body.model)
      return { status: 500, json: { type: 'error', error: { type: 'api_error', message: `no scripted reply for ${body.model}` } } }
    }
    const r = typeof next === 'function' ? await next(body) : next
    if (r.status) return r
    return {
      json: {
        id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: body.model,
        content: [{ type: 'text', text: JSON.stringify(r) }],
        stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 },
      },
    }
  })
  return {
    url, requests, unexpected, close: () => server.close(),
    /** Script the next reply for a model: an object (sent as the JSON answer), {status} for an error, or a function. */
    script: (model, ...replies) => { queues.set(model, [...(queues.get(model) ?? []), ...replies]) },
    pending: () => [...queues.values()].reduce((n, q) => n + q.length, 0),
    reset: () => { requests.length = 0; unexpected.length = 0; queues.clear() },
    byModel: (model) => requests.filter((r) => r.body.model === model),
  }
}

/** A brain decision with every field filled in (the model always sends all of them). */
export const brain = (o) => ({ intent: 'chat', reply: '', item_text: '', item_kind: '', plan: [], unsure: '', fact_to_save: '', ...o })

/** A sorter answer with every field filled in. */
export const sorted = (o) => ({
  kind: 'task', title: '', subject: '', importance: 'nice', due_date: '', window_label: '', window_end: '', duration_minutes: 0,
  origin: 'own', project: '', hand_in: '', someday: false, test_date: '', topics: '', priority: 'normal',
  reminder_kind: 'day', remind_date: '', remind_time: '', person: '', target: '', amount: 0, done_on: '',
  event: '', event_scope: 'week', new_date: '', new_start: '', new_end: '', cancel: false,
  url: '', resource_kind: 'link', fact: '', date_words: '', reasoning: 'test', ...o,
})

/**
 * The fallback is the feature, so the fallback is what gets tested.
 *
 * This file exists because of a real outage with an unusually misleading shape.
 * `llm.ts` pinned `llama-3.3-70b-versatile`; Groq retired the whole llama-3.x
 * family; every analysis in the app started answering HTTP 404 while the API
 * key was entirely valid. Nothing threw at build time and no test noticed,
 * because the only thing that had changed was someone else's catalogue.
 *
 * The repair walks a chain from `ai-kit` instead of naming one model. That
 * turns a class of outage into a retry — but only for as long as the walk
 * actually walks. Fallback code is the easiest kind to break silently: a
 * `return` where a `continue` belongs, an early `throw` on the first bad
 * status, and the chain still LOOKS like a chain in review while behaving
 * exactly like the pin it replaced. Nothing would fail until the next
 * retirement, in production, months later.
 *
 * So each test below drives a failure mode through a fake fetch and asserts
 * that the SECOND link is reached.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { freeChain } from 'ai-kit'
import { callLLM, configuredLinks, noProviderMessage } from './llm'

/** A chat-completions response carrying `content`. */
function ok(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => '',
  } as unknown as Response
}

/** A vendor refusal — the shape a retired model id actually returns. */
function fail(status: number, body = '{"error":{"code":"model_not_found"}}') {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  } as unknown as Response
}

/** Every request the fake fetch received, in order. */
type Sent = { url: string; model: string; auth: string }

function spyFetch(responses: Array<Response | Error>) {
  const sent: Sent[] = []
  let i = 0
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string }
    const headers = (init?.headers ?? {}) as Record<string, string>
    sent.push({
      url: String(url),
      model: body.model ?? '',
      auth: headers.Authorization ?? '',
    })
    const next = responses[i++]
    if (next instanceof Error) throw next
    if (!next) throw new Error('fake fetch ran out of responses')
    return next
  })
  vi.stubGlobal('fetch', impl)
  return sent
}

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  // Start from a known-empty provider configuration so a key leaking in from
  // the developer's real environment cannot change what these tests mean.
  delete process.env.GROQ_API_KEY
  delete process.env.OPENROUTER_API_KEY
  delete process.env.TRUTHSEEKER_GROQ_MODELS
  delete process.env.TRUTHSEEKER_OPENROUTER_MODELS
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  process.env = { ...ORIGINAL_ENV }
})

describe('callLLM', () => {
  it('refuses clearly when no vendor key is configured', async () => {
    spyFetch([])
    // The old message named GROQ_API_KEY alone, which quietly became wrong the
    // moment a second vendor could serve this app.
    await expect(callLLM('hi')).rejects.toThrow(/GROQ_API_KEY or OPENROUTER_API_KEY/)
  })

  it('asks a vendor whose key is absent nothing at all', async () => {
    process.env.GROQ_API_KEY = 'gsk_test'
    const sent = spyFetch([ok('answer')])

    await callLLM('hi')

    // Not merely "it succeeded": with only a Groq key set, an OpenRouter link
    // must not be attempted, because it would 401 on every single request.
    expect(sent).toHaveLength(1)
    expect(sent[0].url).toContain('api.groq.com')
  })

  it('steps past a retired model id to the next link', async () => {
    process.env.GROQ_API_KEY = 'gsk_test'
    const sent = spyFetch([fail(404), ok('answer')])

    // This is the exact outage: link one answers 404 model_not_found.
    await expect(callLLM('hi')).resolves.toBe('answer')

    expect(sent).toHaveLength(2)
    // A fallback that retries the SAME id is not a fallback.
    expect(sent[0].model).not.toBe(sent[1].model)
  })

  it('steps past a rate limit rather than surfacing it', async () => {
    process.env.GROQ_API_KEY = 'gsk_test'
    const sent = spyFetch([fail(429, 'rate limit exceeded'), ok('answer')])

    await expect(callLLM('hi')).resolves.toBe('answer')
    expect(sent).toHaveLength(2)
  })

  it('steps past a timeout, because a hung vendor must not spend the chain', async () => {
    process.env.GROQ_API_KEY = 'gsk_test'
    const sent = spyFetch([new Error('The operation was aborted due to timeout'), ok('answer')])

    await expect(callLLM('hi')).resolves.toBe('answer')
    expect(sent).toHaveLength(2)
  })

  it('treats HTTP 200 with empty content as a miss, not as an answer', async () => {
    process.env.GROQ_API_KEY = 'gsk_test'
    const sent = spyFetch([ok('   '), ok('answer')])

    // A free model was observed returning 200 with no content. A naive client
    // reads that as a successful empty analysis and shows the user nothing,
    // which is worse than an error because it looks deliberate.
    await expect(callLLM('hi')).resolves.toBe('answer')
    expect(sent).toHaveLength(2)
  })

  it('crosses vendors, which is the half that survives a spent daily budget', async () => {
    process.env.GROQ_API_KEY = 'gsk_test'
    process.env.OPENROUTER_API_KEY = 'sk-or-test'
    // Refuse every Groq link so the walk has to leave the vendor. Groq's daily
    // budget is org-wide, so a smaller model at the same vendor is already dead
    // on the day it runs out — only a different vendor has a different meter.
    const sent = spyFetch([fail(429), fail(429), fail(429), ok('answer')])

    await expect(callLLM('hi')).resolves.toBe('answer')

    const vendors = new Set(sent.map((s) => new URL(s.url).host))
    expect(vendors.size).toBeGreaterThan(1)
    expect(sent.at(-1)!.url).toContain('openrouter.ai')
    // Each vendor must be asked with its OWN key.
    expect(sent.at(-1)!.auth).toContain('sk-or-test')
  })

  it('names the whole chain when every link fails', async () => {
    process.env.GROQ_API_KEY = 'gsk_test'
    spyFetch([fail(500), fail(500), fail(500), fail(500)])

    // "gpt-oss-120b failed" sends the reader after one model. "all N links
    // failed" says the shape of the problem is the key, the network or the
    // budget — a different investigation entirely.
    await expect(callLLM('hi')).rejects.toThrow(/chain exhausted/i)
  })

  it('never sends a model id this repo hardcoded', async () => {
    process.env.GROQ_API_KEY = 'gsk_test'
    const sent = spyFetch([ok('answer')])

    await callLLM('hi')

    // The ids now come from ai-kit and are re-probed there. If one is ever
    // pasted back into this repo, the fleet's daily audit stops covering it.
    expect(sent[0].model).not.toMatch(/^llama-3/)
    expect(sent[0].model.length).toBeGreaterThan(0)
  })

  it('still passes the caller options through to the vendor', async () => {
    process.env.GROQ_API_KEY = 'gsk_test'
    const sent: Sent[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}'))
        sent.push(body)
        return ok('answer')
      }),
    )

    await callLLM('the prompt', {
      systemPrompt: 'be terse',
      maxTokens: 123,
      temperature: 0.9,
      jsonMode: true,
    })

    const body = sent[0] as unknown as {
      max_tokens: number
      temperature: number
      response_format?: { type: string }
      messages: Array<{ role: string; content: string }>
    }
    expect(body.max_tokens).toBe(123)
    expect(body.temperature).toBe(0.9)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[0]).toEqual({ role: 'system', content: 'be terse' })
    expect(body.messages[1]).toEqual({ role: 'user', content: 'the prompt' })
  })
})

/**
 * A rejected key is the one failure that is NOT about the model.
 *
 * Found by running the thing rather than reading it: `npm run analyze` against
 * a real article answered "LLM chain exhausted — all 2 link(s) failed. Last:
 * LLM HTTP 401 … Invalid API Key". Both Groq links had been asked, each
 * presenting the identical dead key, and the sentence the operator got reads
 * like an outage at Groq rather than "your credential is refused".
 *
 * The correction has to be narrow. Skipping a whole vendor on 404 or 429 would
 * turn the chain back into the pin it replaced, so only 401/403 — "not you" —
 * short-circuits, and only for the vendor that said it.
 */
describe('callLLM when a key is rejected', () => {
  it('does not ask a second model at a vendor that refused the key', async () => {
    process.env.GROQ_API_KEY = 'gsk_revoked'
    const sent = spyFetch([fail(401, '{"error":{"code":"invalid_api_key"}}')])

    await expect(callLLM('hi')).rejects.toThrow(/GROQ_API_KEY/)

    // Groq carries more than one model in the chain; all of them share this key.
    expect(sent).toHaveLength(1)
  })

  it('still crosses to the next VENDOR, whose key is a different key', async () => {
    process.env.GROQ_API_KEY = 'gsk_revoked'
    process.env.OPENROUTER_API_KEY = 'sk-or-live'
    const sent = spyFetch([fail(401), ok('answer')])

    await expect(callLLM('hi')).resolves.toBe('answer')

    expect(sent).toHaveLength(2)
    expect(sent[0].auth).toBe('Bearer gsk_revoked')
    expect(sent[1].auth).toBe('Bearer sk-or-live')
  })

  it('names the rejected key and the remedy, not the chain length', async () => {
    process.env.GROQ_API_KEY = 'gsk_revoked'
    spyFetch([fail(403)])

    const message = await callLLM('hi').then(
      () => 'resolved, which it must not',
      (e: Error) => e.message,
    )

    // The unhelpful version of this sentence — "all N link(s) failed" — sends
    // the reader after a vendor outage that is not happening.
    expect(message).toMatch(/rejected by the vendor/)
    expect(message).toContain('GROQ_API_KEY (groq, HTTP 403)')
    expect(message).not.toMatch(/chain exhausted/)
    // …and points at the second meter, which is the actual fix for one dead key.
    expect(message).toContain('OPENROUTER_API_KEY')
  })

  it('keeps walking a vendor whose model merely 404s — the retirement case', async () => {
    process.env.GROQ_API_KEY = 'gsk_live'
    const sent = spyFetch([fail(404, '{"error":{"code":"model_not_found"}}'), ok('answer')])

    await expect(callLLM('hi')).resolves.toBe('answer')

    // Same vendor, second model. Over-correcting the 401 skip to cover every
    // 4xx would have stopped at the first link and undone #16 entirely.
    expect(sent).toHaveLength(2)
    expect(sent[0].url).toBe(sent[1].url)
  })

  it('reports the ordinary exhaustion message when nothing was an auth failure', async () => {
    process.env.GROQ_API_KEY = 'gsk_live'
    spyFetch([fail(500), fail(500)])

    await expect(callLLM('hi')).rejects.toThrow(/chain exhausted/)
  })
})

/**
 * The preflight the CLI runs before spending ~20s fetching an article.
 *
 * `scripts/analyze-cli.ts` used to answer "is a vendor configured?" itself,
 * with `if (!process.env.GROQ_API_KEY) exit(1)`. That was true on the day it
 * was written and false the day #16 made this app multi-vendor: an environment
 * holding only OPENROUTER_API_KEY runs perfectly through the HTTP route and was
 * turned away at the CLI door — with an error naming a key it did not need.
 * The CLI is how this project is used today, there being no deployment yet.
 */
describe('configuredLinks', () => {
  it('finds nothing to walk when no vendor key is set', () => {
    expect(configuredLinks({})).toEqual([])
  })

  it('is satisfied by ANY single vendor, not one privileged one', () => {
    for (const provider of freeChain('TRUTHSEEKER')) {
      const links = configuredLinks({ [provider.keyEnv]: 'test-key' })
      expect(links.length).toBeGreaterThan(0)
      // …and only that vendor's links, never one that would 401 on every call.
      expect(links.every((l) => l.provider.keyEnv === provider.keyEnv)).toBe(true)
    }
  })

  it('reads the environment it is handed, not the ambient one', () => {
    process.env.GROQ_API_KEY = 'gsk_ambient'
    expect(configuredLinks({})).toEqual([])
  })
})

describe('noProviderMessage', () => {
  it('names every key that would work, straight from the chain', () => {
    const message = noProviderMessage()
    for (const provider of freeChain('TRUTHSEEKER')) {
      expect(message).toContain(provider.keyEnv)
    }
  })
})

/**
 * The seam this whole exercise is about: a caller re-deriving which env vars
 * count. Nothing errors when it drifts — the app simply refuses a setup it can
 * serve, and only that caller is wrong. Gate it the way claim-types.test.ts
 * gates its own SSOT, so the next vendor the fleet chain gains cannot leave the
 * CLI behind again.
 */
describe('the CLI preflight', () => {
  const cli = fs.readFileSync(
    path.join(__dirname, '..', '..', 'scripts', 'analyze-cli.ts'),
    'utf8',
  )

  it('asks lib/llm which vendors count instead of testing a key by name', () => {
    const code = cli
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
    expect(code).not.toMatch(/process\.env\.[A-Z0-9_]*API_KEY/)
    expect(code).toContain('configuredLinks(')
  })
})

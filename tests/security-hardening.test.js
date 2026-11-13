import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ApiError,
  configuredFaceProviderFromEnv,
  DISPATCH_CONCURRENCY,
  extractClientIp,
  FACE_NOT_CONFIGURED_MESSAGE,
  isEmployeeActive,
  MAX_BEARER_TOKEN_LENGTH,
  MAX_IP_LENGTH,
  parseBearerToken,
  resolveCorsOrigin,
  resolveFaceProvider,
  runInBatches,
  sameSecret,
} from '../supabase/functions/api/guards.ts'

function headersOf(map) {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]))
  return (name) => lower[name.toLowerCase()]
}

describe('extractClientIp (#4)', () => {
  it('prefers cf-connecting-ip over x-real-ip and spoofed x-forwarded-for', () => {
    const ip = extractClientIp(
      headersOf({
        'cf-connecting-ip': '197.251.10.20',
        'x-real-ip': '10.0.0.2',
        'x-forwarded-for': '1.2.3.4, 5.6.7.8',
      }),
    )
    expect(ip).toBe('197.251.10.20')
  })

  it('prefers x-real-ip when cf-connecting-ip is absent', () => {
    const ip = extractClientIp(
      headersOf({
        'x-real-ip': ' 41.215.160.9 ',
        'x-forwarded-for': '9.9.9.9, 8.8.8.8',
      }),
    )
    expect(ip).toBe('41.215.160.9')
  })

  it('falls back to the rightmost x-forwarded-for entry so leftmost spoofed IPs are ignored', () => {
    const ip = extractClientIp(
      headersOf({
        'x-forwarded-for': '203.0.113.1, 198.51.100.2, 154.160.12.34 ',
      }),
    )
    expect(ip).toBe('154.160.12.34')
  })

  it('caps extracted IP length to 64 characters and falls back to unknown when empty', () => {
    const longIp = 'a'.repeat(120)
    expect(extractClientIp(headersOf({ 'cf-connecting-ip': longIp }))).toHaveLength(MAX_IP_LENGTH)
    expect(extractClientIp(headersOf({ 'x-forwarded-for': longIp }))).toHaveLength(MAX_IP_LENGTH)
    expect(extractClientIp(headersOf({}))).toBe('unknown')
    expect(extractClientIp(headersOf({ 'x-forwarded-for': ' ,  ' }))).toBe('unknown')
  })
})

describe('resolveFaceProvider fail-closed behavior (#5)', () => {
  it('returns rekognition when FACE_PROVIDER=rekognition', () => {
    expect(resolveFaceProvider({ faceProvider: 'rekognition', allowClientFaceApi: undefined })).toBe('rekognition')
    expect(configuredFaceProviderFromEnv({ faceProvider: 'rekognition' })).toBe('rekognition')
  })

  it('throws 503 ApiError when FACE_PROVIDER is unset or empty', () => {
    expect(() => resolveFaceProvider({})).toThrowError(ApiError)
    try {
      resolveFaceProvider({ faceProvider: '' })
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect(err.status).toBe(503)
      expect(err.message).toBe(FACE_NOT_CONFIGURED_MESSAGE)
    }
    expect(configuredFaceProviderFromEnv({})).toBe('none')
  })

  it('rejects faceapi unless ALLOW_CLIENT_FACEAPI is explicitly "true"', () => {
    expect(() => resolveFaceProvider({ faceProvider: 'faceapi' })).toThrowError(FACE_NOT_CONFIGURED_MESSAGE)
    expect(() => resolveFaceProvider({ faceProvider: 'faceapi', allowClientFaceApi: 'false' })).toThrowError(
      FACE_NOT_CONFIGURED_MESSAGE,
    )
    expect(() => resolveFaceProvider({ faceProvider: 'faceapi', allowClientFaceApi: '1' })).toThrowError(
      FACE_NOT_CONFIGURED_MESSAGE,
    )
    expect(configuredFaceProviderFromEnv({ faceProvider: 'faceapi' })).toBe('none')

    expect(resolveFaceProvider({ faceProvider: 'faceapi', allowClientFaceApi: 'true' })).toBe('faceapi')
    expect(configuredFaceProviderFromEnv({ faceProvider: 'faceapi', allowClientFaceApi: 'true' })).toBe('faceapi')
  })
})

describe('parseBearerToken & isEmployeeActive (#6, #16)', () => {
  it('requires Bearer prefix and rejects tokens over 256 chars', () => {
    expect(parseBearerToken(undefined)).toBe('')
    expect(parseBearerToken('')).toBe('')
    expect(parseBearerToken('raw-token-without-scheme')).toBe('')
    expect(parseBearerToken('Basic abcdef123456')).toBe('')
    expect(parseBearerToken('Bearer   ')).toBe('')
    expect(parseBearerToken(`Bearer ${'x'.repeat(MAX_BEARER_TOKEN_LENGTH + 1)}`)).toBe('')

    const maxToken = 't'.repeat(MAX_BEARER_TOKEN_LENGTH)
    expect(parseBearerToken(`Bearer ${maxToken}`)).toBe(maxToken)
    expect(parseBearerToken('bearer   tok_abc-123  ')).toBe('tok_abc-123')
  })

  it('accepts only status === ACTIVE', () => {
    expect(isEmployeeActive({ status: 'ACTIVE' })).toBe(true)
    expect(isEmployeeActive({ status: 'INACTIVE' })).toBe(false)
    expect(isEmployeeActive({ status: null })).toBe(false)
    expect(isEmployeeActive(null)).toBe(false)
    expect(isEmployeeActive(undefined)).toBe(false)
  })
})

describe('resolveCorsOrigin (#16)', () => {
  it('returns "*" when ALLOWED_ORIGINS contains wildcard', () => {
    expect(resolveCorsOrigin('*')).toBe('*')
    expect(resolveCorsOrigin('https://portal.example.com, *')).toBe('*')
  })

  it('returns trimmed origin list otherwise, with localhost defaults when unset', () => {
    expect(resolveCorsOrigin(' https://a.example.com , https://b.example.com ')).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ])
    expect(resolveCorsOrigin(undefined)).toEqual(['http://localhost:5173', 'http://127.0.0.1:5173'])
  })
})

describe('sameSecret & runInBatches (#14)', () => {
  it('compares secrets over fixed-size SHA-256 digests regardless of input length', async () => {
    expect(await sameSecret('super-secret-job-key', 'super-secret-job-key')).toBe(true)
    expect(await sameSecret('super-secret-job-key', 'super-secret-job-keX')).toBe(false)
    expect(await sameSecret('short', 'much-longer-secret-value-that-differs-in-length')).toBe(false)
    expect(await sameSecret('', 'non-empty')).toBe(false)
  })

  it('bounds parallel execution to batchSize and preserves output order', async () => {
    const items = Array.from({ length: 35 }, (_, idx) => idx)
    let inFlight = 0
    let peakInFlight = 0

    const results = await runInBatches(items, DISPATCH_CONCURRENCY, async (item) => {
      inFlight += 1
      peakInFlight = Math.max(peakInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 2))
      inFlight -= 1
      return item * 2
    })

    expect(peakInFlight).toBeLessThanOrEqual(DISPATCH_CONCURRENCY)
    expect(peakInFlight).toBeGreaterThan(1)
    expect(results).toEqual(items.map((n) => n * 2))
  })
})

describe('post-launch SQL & route hardening invariants (#8, #9, #15)', () => {
  const migration = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20261113230000_post_launch_security_hardening.sql'),
    'utf8',
  )

  it('checks auth.sessions not_after, restricts empty-company audit_events, and hardens apply_change', () => {
    expect(migration).toContain('s.not_after is null or s.not_after > now()')
    expect(migration).toContain('create policy hr_read on public.audit_events')
    expect(migration).toContain('<@ (select app_private.hr_company_ids())')
    expect(migration).toContain('t.%1$I is not distinct from m.%1$I')
    expect(migration).toContain('employee_shop_changes_append_only')
    expect(migration).toContain('revoke all on function app_private.write_audit(jsonb) from public, anon, authenticated;')

    // Removed unused live-tracking tables from apply_change writable allowlist.
    const applyChangeBlock = migration.slice(migration.indexOf('create or replace function public.apply_change'))
    expect(applyChangeBlock).not.toContain("'location_points'")
    expect(applyChangeBlock).not.toContain("'tracking_latest'")
    expect(applyChangeBlock).not.toContain("'outlet_visits'")
  })
})

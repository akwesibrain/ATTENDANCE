/**
 * Pure security helpers shared across the `api` Edge Function routes and unit tests.
 * Kept free of `npm:` and top-level `Deno` bindings so Vitest can run them directly.
 */

/** An error the caller is meant to read. Anything else is reported generically. */
export class ApiError extends Error {
  status: number
  extra: Record<string, unknown>

  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

export const MAX_IP_LENGTH = 64
export const MAX_BEARER_TOKEN_LENGTH = 256
export const DISPATCH_CONCURRENCY = 10
export const FACE_NOT_CONFIGURED_MESSAGE = 'Face verification is not configured on the server.'
const DEFAULT_ALLOWED_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173'

/**
 * Prefer non-spoofable edge headers (`cf-connecting-ip`, `x-real-ip`) before
 * falling back to the rightmost entry of `x-forwarded-for`, capped to 64 chars.
 */
export function extractClientIp(header: (name: string) => string | undefined): string {
  const direct = header('cf-connecting-ip')?.trim() || header('x-real-ip')?.trim()
  if (direct) return direct.slice(0, MAX_IP_LENGTH)
  const forwarded = (header('x-forwarded-for') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const rightmost = forwarded[forwarded.length - 1]
  return rightmost ? rightmost.slice(0, MAX_IP_LENGTH) : 'unknown'
}

export type FaceEnv = {
  faceProvider?: string | null
  allowClientFaceApi?: string | null
}

/**
 * Fail-closed face provider resolution: requires `FACE_PROVIDER=rekognition` by
 * default and only permits `'faceapi'` when explicitly opted in via both
 * `FACE_PROVIDER=faceapi` and `ALLOW_CLIENT_FACEAPI=true`.
 */
export function resolveFaceProvider(env: FaceEnv): 'rekognition' | 'faceapi' {
  const provider = env.faceProvider?.trim()
  if (provider === 'rekognition') return 'rekognition'
  if (provider === 'faceapi' && env.allowClientFaceApi === 'true') return 'faceapi'
  throw new ApiError(503, FACE_NOT_CONFIGURED_MESSAGE)
}

/** Non-throwing status string for HR Settings (`/hr/me`). */
export function configuredFaceProviderFromEnv(env: FaceEnv): 'rekognition' | 'faceapi' | 'none' {
  try {
    return resolveFaceProvider(env)
  } catch {
    return 'none'
  }
}

/** Resolve `ALLOWED_ORIGINS` for Hono `cors()`, supporting wildcard `'*'`. */
export function resolveCorsOrigin(raw: string | undefined): '*' | string[] {
  const origins = (raw ?? DEFAULT_ALLOWED_ORIGINS)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  return origins.includes('*') ? '*' : origins
}

/** Extract a tracking Bearer token only when prefixed with `Bearer ` and `<= 256` chars. */
export function parseBearerToken(authorization: string | undefined): string {
  if (!authorization || !/^Bearer\s+/i.test(authorization)) return ''
  const token = authorization.replace(/^Bearer\s+/i, '').trim()
  if (!token || token.length > MAX_BEARER_TOKEN_LENGTH) return ''
  return token
}

/** Constant-time secret comparison over fixed 32-byte SHA-256 digests. */
export async function sameSecret(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ])
  const bytesA = new Uint8Array(digestA)
  const bytesB = new Uint8Array(digestB)
  let difference = 0
  for (let i = 0; i < bytesA.length; i += 1) {
    difference |= bytesA[i] ^ bytesB[i]
  }
  return difference === 0
}

/** Run async work in bounded parallel batches of `batchSize`. */
export async function runInBatches<T, R>(
  items: readonly T[],
  batchSize: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const size = Math.max(1, Math.floor(batchSize))
  const results: R[] = []
  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size)
    results.push(...(await Promise.all(slice.map((item) => worker(item)))))
  }
  return results
}

/** Whether an employee row is currently active. */
export function isEmployeeActive(employee: { status?: string | null } | null | undefined): boolean {
  return employee?.status === 'ACTIVE'
}

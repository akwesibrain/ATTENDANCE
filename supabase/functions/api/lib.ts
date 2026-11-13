import { createClient } from 'npm:@supabase/supabase-js@2.49.1'
import type { Context } from 'npm:hono@4.6.14'
import { ApiError, extractClientIp } from './guards.ts'

export { ApiError }

/** Service-role client. It never leaves the server. */
export const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

type DbError = { code?: string; message: string } | null

function raise(error: NonNullable<DbError>): never {
  // P0001 is a rule refusal written for the user, such as a duplicate check-in.
  if (error.code === 'P0001') throw new ApiError(409, error.message)
  // Two requests raced and the other one saved first.
  if (error.code === '23505') throw new ApiError(409, 'That was just saved. Refresh the page to see it.', { code: 'conflict' })
  console.error('database error', error.code, error.message)
  throw new ApiError(500, 'Something went wrong on the server. Please try again.')
}

/** Unwrap a database result, turning failures into API errors. */
export async function must<T>(query: PromiseLike<{ data: T; error: DbError }>): Promise<T> {
  const { data, error } = await query
  if (error) raise(error)
  return data
}

/** A query that always returns data when it succeeds: lists and `.single()`. */
export async function found<T>(query: PromiseLike<{ data: T; error: DbError }>): Promise<NonNullable<T>> {
  return await must(query) as NonNullable<T>
}

export function rpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
  return must(db.rpc(name, args) as PromiseLike<{ data: T; error: DbError }>)
}

export type Change = {
  table: string
  op: 'insert' | 'upsert' | 'update' | 'delete'
  row?: Record<string, unknown>
  match?: Record<string, unknown>
  conflict?: string[]
}

/** Apply writes and their audit entries in one transaction. */
export function applyChange(ops: unknown[], audit: unknown = null) {
  return rpc('apply_change', { p_ops: ops, p_audit: audit })
}

/** Finish work after the response has been sent. Failures are only logged. */
export function later(work: Promise<unknown>) {
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil(work.catch((error: unknown) => console.error('background work failed', error)))
}

/** A 400 carrying a message per field, in the shape the forms display. */
export function invalid(errors: object): ApiError {
  const first = Object.values(errors)[0]
  return new ApiError(400, typeof first === 'string' ? first : 'Please check the form.', { errors })
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * The caller's address, preferring non-spoofable edge headers before the
 * rightmost `x-forwarded-for` entry. Limits that protect an employee are keyed
 * by Staff ID as well.
 */
export function clientIp(c: Context): string {
  return extractClientIp((name) => c.req.header(name))
}

export async function rateLimit(bucket: string, limit: number, windowSeconds: number) {
  const allowed = await rpc<boolean>('rate_limit_hit', {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  })
  if (!allowed) throw new ApiError(429, 'Too many requests. Please wait a moment and try again.')
}

export async function readJson(c: Context): Promise<Record<string, unknown>> {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'The request could not be read.')
  }
  return body as Record<string, unknown>
}

export async function storePhoto(bucket: string, path: string, bytes: Uint8Array) {
  const { error } = await db.storage.from(bucket).upload(path, bytes, { contentType: 'image/jpeg', upsert: false })
  if (error) {
    console.error('photo upload failed', error.message)
    throw new ApiError(500, 'Could not save the photo. Please try again.')
  }
}

/** Remove a photo whose database write failed. Failure here is only logged. */
export async function discardPhoto(bucket: string, path: string) {
  const { error } = await db.storage.from(bucket).remove([path])
  if (error) console.error('photo cleanup failed', path, error.message)
}

const PAGE = 1000

/** Every row of a table, in pages, in a fixed order. */
// deno-lint-ignore no-explicit-any
export async function allRows(table: string, order: string | string[], filter: (query: any) => any = (q) => q): Promise<any[]> {
  // deno-lint-ignore no-explicit-any
  const rows: any[] = []
  // Paging needs a unique order, or rows can be skipped or repeated between pages:
  // pass a tie-breaker column when the first one has repeats.
  const columns = Array.isArray(order) ? order : [order]
  for (let from = 0; ; from += PAGE) {
    let query = filter(db.from(table).select('*'))
    for (const column of columns) query = query.order(column)
    const page = await must(query.range(from, from + PAGE - 1)) as unknown[]
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

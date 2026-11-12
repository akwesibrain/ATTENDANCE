import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
})

/**
 * Whether this is the account's current password. Checked on a separate,
 * unsaved client so the signed-in session is untouched; the extra session is
 * ended straight away.
 */
export async function checkPassword(email, password) {
  const probe = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'password-check' },
  })
  const { data, error } = await probe.auth.signInWithPassword({ email, password })
  if (error || !data.session) return false
  await probe.auth.signOut({ scope: 'local' }).catch(() => {})
  return true
}

/** A refusal or failure from the server, with its message ready to show. */
export class ApiFailure extends Error {
  constructor(message, status, data = {}) {
    super(message)
    this.status = status
    this.data = data
  }
}

/** Call the Edge Function. All writes go through here. */
export async function api(path, { method = 'GET', body } = {}) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  let response
  try {
    response = await fetch(`${url}/functions/v1/api${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiFailure('Could not reach the server. Check the connection and try again.', 0)
  }
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiFailure(payload?.error ?? 'Something went wrong. Please try again.', response.status, payload ?? {})
  }
  return payload
}

const inFlight = new Map()

/**
 * For forms, which show refusals next to the fields instead of throwing.
 * @returns the response, or { error, errors } when it was refused
 */
export function submit(path, options) {
  // A double click sends one request, not two.
  const key = `${options?.method}:${path}:${JSON.stringify(options?.body)}`
  if (inFlight.has(key)) return inFlight.get(key)
  const request = send(path, options).finally(() => inFlight.delete(key))
  inFlight.set(key, request)
  return request
}

async function send(path, options) {
  try {
    return await api(path, options)
  } catch (failure) {
    if (!(failure instanceof ApiFailure)) throw failure
    return { error: failure.message, errors: failure.data.errors ?? { form: failure.message } }
  }
}

import { Hono } from 'npm:hono@4.6.14'
import { bodyLimit } from 'npm:hono@4.6.14/body-limit'
import { cors } from 'npm:hono@4.6.14/cors'
import { publicEnrolRoutes } from './employeeOnboarding.ts'
import { hrRoutes } from './hr.ts'
import { publicHrSetupRoutes } from './hrAccess.ts'
import { jobRoutes } from './jobs.ts'
import { ApiError } from './lib.ts'
import { publicRoutes } from './public.ts'

const app = new Hono().basePath('/api')

// Set ALLOWED_ORIGINS as a function secret once the app has a public address.
const origins = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

app.use('*', cors({
  origin: origins,
  allowHeaders: ['authorization', 'content-type', 'apikey', 'x-client-info'],
  allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  maxAge: 600,
}))

app.use('*', bodyLimit({
  maxSize: 1_600_000,
  onError: (c) => c.json({ error: 'That photo is too large. Please try again.' }, 413),
}))

app.onError((error, c) => {
  if (error instanceof ApiError) {
    return c.json({ error: error.message, ...error.extra }, error.status as 400)
  }
  console.error('unhandled error', error)
  return c.json({ error: 'Something went wrong on the server. Please try again.' }, 500)
})

app.notFound((c) => c.json({ error: 'Not found.' }, 404))

app.get('/health', (c) => c.json({ ok: true, time: new Date().toISOString() }))
app.route('/', publicEnrolRoutes)
app.route('/', publicHrSetupRoutes)
app.route('/', publicRoutes)
app.route('/hr', hrRoutes)
app.route('/jobs', jobRoutes)

Deno.serve(app.fetch)

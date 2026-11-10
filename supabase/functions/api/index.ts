import { Hono } from 'npm:hono@4.6.14'

const app = new Hono().basePath('/api')

app.get('/health', (c) => c.json({ ok: true, time: new Date().toISOString() }))

Deno.serve(app.fetch)

/**
 * Creates the HR Manager account. Run it once, on your own computer, so the
 * password never appears in chat or in git.
 *
 *   SUPABASE_SERVICE_ROLE_KEY=<from Dashboard → Settings → API> node scripts/create-hr-manager.mjs
 *
 * The first sign-in at /hr sets up the authenticator app.
 */

import { readFileSync } from 'node:fs'
import readline from 'node:readline/promises'
import { createClient } from '@supabase/supabase-js'

const MIN_PASSWORD_LENGTH = 12

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]),
)

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!serviceKey) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY first. It is on the Supabase dashboard, under Settings → API.')
  process.exit(1)
}

const io = readline.createInterface({ input: process.stdin, output: process.stdout })

function askHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question)
    const input = process.stdin
    let value = ''
    const onData = (chunk) => {
      for (const char of chunk.toString()) {
        if (char === '\r' || char === '\n') {
          input.setRawMode?.(false)
          input.removeListener('data', onData)
          process.stdout.write('\n')
          resolve(value)
          return
        }
        if (char === '\u0003') process.exit(1)
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1)
        else value += char
      }
    }
    input.setRawMode?.(true)
    input.resume()
    input.on('data', onData)
  })
}

const name = (await io.question('Full name: ')).trim()
const email = (await io.question('Email: ')).trim().toLowerCase()
io.pause()
const password = await askHidden(`Password (at least ${MIN_PASSWORD_LENGTH} characters, not shown): `)
io.close()

if (name.length < 3 || !email.includes('@')) {
  console.error('Enter a full name and a valid email.')
  process.exit(1)
}
if (password.length < MIN_PASSWORD_LENGTH) {
  console.error(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  process.exit(1)
}

const admin = createClient(env.VITE_SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

const { data: companies, error: companyError } = await admin.from('companies').select('id')
if (companyError) {
  console.error(`Could not reach the database: ${companyError.message}`)
  process.exit(1)
}

const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
if (error) {
  console.error(`Could not create the account: ${error.message}`)
  process.exit(1)
}

const { error: rowError } = await admin.from('hr_users').insert({
  id: data.user.id,
  name,
  email,
  role_id: 'hr-manager',
  company_ids: companies.map((company) => company.id),
})
if (rowError) {
  await admin.auth.admin.deleteUser(data.user.id)
  console.error(`Could not finish the account, so it was removed: ${rowError.message}`)
  process.exit(1)
}

console.log(`Created ${name}. Sign in at /hr, where you will set up your authenticator app.`)

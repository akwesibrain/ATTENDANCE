import { api } from './backend/client'
import { refresh } from './backend/cache'

/** Log an export on the server. The file has already been handed to the user. */
export function recordExport({ action, category, source, companyIds, affected, description }) {
  api('/hr/audit/exports', { method: 'POST', body: { action, category, source, companyIds, affected, description } })
    .then(() => refresh('audit_events'))
    .catch((failure) => console.error('Could not log the export', failure.message))
}

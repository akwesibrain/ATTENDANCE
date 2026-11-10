import { sessionAttachmentUrl } from './attachmentStore'

function sizeText(bytes) {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Local preview of a notebook photograph or scan. Files never leave the
 * browser. Small files are kept with the batch; larger ones preview only in
 * the session they were chosen, and the file name stays as the reference.
 */
export default function AttachmentPreview({ attachment, height = 320 }) {
  if (!attachment) return <p className="sm-empty at-flush">No attachment.</p>
  const url = attachment.dataUrl ?? sessionAttachmentUrl(attachment.id)
  const isImage = attachment.type?.startsWith('image/')
  const isPdf = attachment.type === 'application/pdf'
  return (
    <figure className="hi-attachment">
      {url && isImage && (
        <img src={url} alt={`Notebook attachment ${attachment.name}`} style={{ maxHeight: height }} />
      )}
      {url && isPdf && (
        <object data={url} type="application/pdf" style={{ height }} aria-label={`PDF ${attachment.name}`}>
          <a href={url} target="_blank" rel="noreferrer">Open {attachment.name}</a>
        </object>
      )}
      {!url && (
        <div className="hi-attachment-missing">
          Preview is not available in this session. The file name is kept as the source reference.
        </div>
      )}
      <figcaption>
        <strong>{attachment.name}</strong>
        <span className="nt-muted">
          {[attachment.type || 'Unknown type', sizeText(attachment.size)].filter(Boolean).join(' · ')}
          {attachment.dataUrl ? ' · stored with the batch (this browser only)' : ' · not stored; reference only'}
        </span>
      </figcaption>
    </figure>
  )
}

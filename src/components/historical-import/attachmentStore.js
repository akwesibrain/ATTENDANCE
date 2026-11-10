/**
 * Local handling for notebook attachments. Nothing is uploaded.
 *
 * Files up to STORE_LIMIT_BYTES are read into a data URL and kept with the
 * batch in this browser's storage so the preview survives a reload. Larger
 * files get an in-memory object URL that only lasts for this session; the
 * batch keeps the file name, type and size as the reference.
 */

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
export const MAX_FILE_BYTES = 10 * 1024 * 1024
const STORE_LIMIT_BYTES = 900 * 1024

const sessionUrls = new Map()

export function sessionAttachmentUrl(id) {
  return sessionUrls.get(id) ?? null
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/**
 * Turn a chosen File into an attachment reference.
 * @returns {Promise<{ attachment?: object, error?: string }>}
 */
export async function prepareAttachment(file) {
  if (!file) return { error: 'Choose a file.' }
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return { error: 'Choose a photo (JPG, PNG, WEBP, HEIC) or a PDF scan.' }
  }
  if (file.size > MAX_FILE_BYTES) return { error: 'The file is larger than 10 MB.' }
  const id = `ATT-${Date.now().toString(36).toUpperCase()}`
  const attachment = {
    id,
    name: file.name,
    type: file.type,
    size: file.size,
    addedAt: new Date().toISOString(),
    dataUrl: null,
  }
  if (file.size <= STORE_LIMIT_BYTES) {
    try {
      attachment.dataUrl = await readAsDataUrl(file)
    } catch {
      attachment.dataUrl = null
    }
  }
  if (!attachment.dataUrl && typeof URL !== 'undefined' && URL.createObjectURL) {
    sessionUrls.set(id, URL.createObjectURL(file))
  }
  return { attachment }
}

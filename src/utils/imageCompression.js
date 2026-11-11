/**
 * Image compression in the browser (no libraries), for uploaded images such as
 * company logos. Camera frames use utils/captureFrame.js instead.
 */

/** Size that fits inside maxSide × maxSide, never upscaling. */
export function fitWithin(width, height, maxSide) {
  const k = Math.min(1, maxSide / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) }
}

function encode(source, srcW, srcH, { maxSide, type, quality }) {
  const { width, height } = fitWithin(srcW, srcH, maxSide)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, width, height)
  return canvas.toDataURL(type, quality)
}

/**
 * Resize and re-encode an image data URL (e.g. an uploaded logo). SVGs and
 * images that would not get smaller are returned unchanged.
 */
export function compressImageDataUrl(dataUrl, { maxSide = 256, type = 'image/webp', quality = 0.9 } = {}) {
  if (!dataUrl || dataUrl.startsWith('data:image/svg')) return Promise.resolve(dataUrl)
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const out = encode(img, img.naturalWidth, img.naturalHeight, { maxSide, type, quality })
        resolve(out.length < dataUrl.length ? out : dataUrl)
      } catch {
        resolve(dataUrl)
      }
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

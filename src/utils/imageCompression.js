/**
 * Image compression in the browser (no libraries).
 *
 * Photos are saved as data URLs (browser storage in this prototype, uploads
 * later), so they are resized and re-encoded before saving: a full-resolution
 * camera frame is typically 150–400 KB; at 480 px / JPEG 80% it is ~25–45 KB.
 * Face matching only looks at a 32×32 sample, so it is unaffected.
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

/** A compressed JPEG of the current camera frame. */
export function captureVideoFrame(video, { maxSide = 480, quality = 0.8 } = {}) {
  return encode(video, video.videoWidth, video.videoHeight, { maxSide, type: 'image/jpeg', quality })
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

const MAX_SIDE = 480
const JPEG_QUALITY = 0.8

/**
 * A still from the camera as a JPEG data URL, scaled down so it uploads quickly
 * on mobile data and stays within the server's processing limits.
 */
export function captureFrame(video) {
  const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(video.videoWidth * scale)
  canvas.height = Math.round(video.videoHeight * scale)
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
}

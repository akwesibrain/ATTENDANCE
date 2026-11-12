import { GHANA_BOUNDS, GHANA_OUTLINE } from '../constants/ghanaMap'

/** Drawing size used for every Ghana map (SVG viewBox units). */
export const GHANA_MAP_W = 520
export const GHANA_MAP_H = 720
const PAD = 28

/** Equirectangular projection fitted to Ghana (cos-latitude corrected): (lng, lat) → [x, y]. */
export function makeGhanaProjection(w = GHANA_MAP_W, h = GHANA_MAP_H, pad = PAD) {
  const { minLng, maxLng, minLat, maxLat } = GHANA_BOUNDS
  const k = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180))
  const spanX = (maxLng - minLng) * k
  const spanY = maxLat - minLat
  const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY)
  const offX = (w - spanX * scale) / 2
  const offY = (h - spanY * scale) / 2
  return (lng, lat) => [offX + (lng - minLng) * k * scale, offY + (maxLat - lat) * scale]
}

/** SVG path for Ghana's outline under a projection. */
export function ghanaOutlinePath(project) {
  return GHANA_OUTLINE.map(([lng, lat], i) => `${i ? 'L' : 'M'}${project(lng, lat).map((n) => n.toFixed(1)).join(' ')}`).join(' ') + ' Z'
}

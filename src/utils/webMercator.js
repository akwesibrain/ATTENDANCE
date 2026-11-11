/** Web Mercator helpers for slippy-map tiles (256 px tiles). */

export const TILE = 256

/** World pixel position of a latitude/longitude at a zoom level. */
export function worldPx(lat, lng, z) {
  const size = TILE * 2 ** z
  const latR = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180
  return [((lng + 180) / 360) * size, ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * size]
}

/** Latitude/longitude at a world pixel position. */
export function pxToLatLng(x, y, z) {
  const size = TILE * 2 ** z
  const lng = (x / size) * 360 - 180
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / size))) * 180) / Math.PI
  return [lat, lng]
}

/** Tiles covering a rectangle of world pixels (only rows that exist). */
export function tilesFor(left, top, width, height, z) {
  const n = 2 ** z
  const out = []
  for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx += 1) {
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty += 1) {
      if (ty < 0 || ty >= n) continue
      out.push({ tx, ty, x: ((tx % n) + n) % n, left: tx * TILE - left, top: ty * TILE - top })
    }
  }
  return out
}

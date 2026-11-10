/**
 * The server's one face-matching interface. To use a real face-recognition
 * service, replace this file: nothing else depends on how matching works.
 */

import jpeg from 'npm:jpeg-js@0.4.4'
import {
  compareTemplates,
  decodeTemplate,
  encodeTemplate,
  FACE_MATCH_THRESHOLD,
  FACE_TEMPLATE_ALGORITHM,
  hasEnoughContrast,
  templateFromRgba,
} from './rules/faceTemplate.js'

export type FaceTemplate = { algorithm: string; template: string }

/** The photo could not be used, as opposed to not matching. */
export class UnusableFaceImage extends Error {}

function templateFromJpeg(image: Uint8Array): Uint8Array {
  let template: Uint8Array
  try {
    const decoded = jpeg.decode(image, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 3, maxMemoryUsageInMB: 64 })
    template = templateFromRgba(decoded)
  } catch {
    throw new UnusableFaceImage('Could not read the photo. Please try again.')
  }
  if (!hasEnoughContrast(template)) {
    throw new UnusableFaceImage('The photo is too dark or blank. Face the camera in good light and try again.')
  }
  return template
}

export function enrollFace(image: Uint8Array): FaceTemplate {
  return { algorithm: FACE_TEMPLATE_ALGORITHM, template: encodeTemplate(templateFromJpeg(image)) }
}

export function compareFaces(enrolled: FaceTemplate, image: Uint8Array): { score: number; match: boolean } {
  if (enrolled.algorithm !== FACE_TEMPLATE_ALGORITHM) {
    throw new Error(`Unsupported face template: ${enrolled.algorithm}`)
  }
  const score = compareTemplates(decodeTemplate(enrolled.template), templateFromJpeg(image))
  return { score, match: score >= FACE_MATCH_THRESHOLD }
}

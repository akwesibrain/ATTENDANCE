/**
 * Face recognition on the phone, with face-api (open source, MIT licence).
 *
 * Finds the one face in a photo and turns it into a descriptor: 128 numbers the
 * server compares with the enrolled ones. The models (about 7 MB) download the
 * first time and the browser caches them after that.
 */

import { MANY_FACES_MESSAGE, NO_FACE_MESSAGE } from '../../supabase/functions/_shared/rules/faceDecision.js'

const MODEL_URL = `${import.meta.env.BASE_URL}face-models`
const LOAD_FAILED = 'The face check could not start. Check the internet connection and try again.'

/** The photo cannot be used: no face, or more than one. Costs no attempt. */
export class FaceNotUsable extends Error {}

let loading = null

function loadModels() {
  loading ??= (async () => {
    const faceapi = await import('@vladmandic/face-api')
    await faceapi.tf.ready()
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ])
    return faceapi
  })().catch((error) => {
    loading = null
    console.error('face models failed to load', error)
    throw new Error(LOAD_FAILED)
  })
  return loading
}

/** Start downloading the models early, so the first scan does not wait. */
export function preloadFaceModels() {
  loadModels().catch(() => {})
}

function imageFrom(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new FaceNotUsable(NO_FACE_MESSAGE))
    image.src = dataUrl
  })
}

/**
 * @param {string} dataUrl a JPEG from captureFrame
 * @returns {Promise<number[]>} the face descriptor
 * @throws {FaceNotUsable} when there is no face, or more than one
 */
export async function describeFace(dataUrl) {
  const faceapi = await loadModels()
  const image = await imageFrom(dataUrl)
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 })
  const faces = await faceapi.detectAllFaces(image, options).withFaceLandmarks().withFaceDescriptors()
  if (faces.length === 0) throw new FaceNotUsable(NO_FACE_MESSAGE)
  if (faces.length > 1) throw new FaceNotUsable(MANY_FACES_MESSAGE)
  return Array.from(faces[0].descriptor)
}

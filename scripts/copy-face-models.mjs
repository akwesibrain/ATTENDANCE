// Copies the face-api models the app uses into public/face-models, so they are
// served with the site. Runs before `npm run dev` and `npm run build`.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'node_modules', '@vladmandic', 'face-api', 'model')
const target = join(root, 'public', 'face-models')
const MODELS = ['tiny_face_detector_model', 'face_landmark_68_model', 'face_recognition_model']

mkdirSync(target, { recursive: true })
for (const model of MODELS) {
  const manifest = `${model}-weights_manifest.json`
  copyFileSync(join(source, manifest), join(target, manifest))
  for (const group of JSON.parse(readFileSync(join(source, manifest), 'utf8'))) {
    for (const path of group.paths) {
      if (!existsSync(join(target, path))) copyFileSync(join(source, path), join(target, path))
    }
  }
}
console.log('face models ready in public/face-models')

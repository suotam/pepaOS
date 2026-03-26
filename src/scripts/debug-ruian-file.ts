import fs from 'fs'
import path from 'path'

const targetDir = path.resolve(process.cwd(), 'data/ruian')
const files = fs.readdirSync(targetDir).filter((name) => name.toLowerCase().endsWith('.csv')).slice(0, 3)

for (const fileName of files) {
  const fullPath = path.join(targetDir, fileName)
  const raw = fs.readFileSync(fullPath, 'utf8').replace(/^\uFEFF/, '')
  const lines = raw.split(/\r?\n/)
  console.log('FILE', fileName)
  console.log(lines.slice(0, 3).join('\n'))
  console.log('---')
}

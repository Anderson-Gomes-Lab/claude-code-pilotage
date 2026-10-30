// Dead code: an export of register.tsx that neither a test imports nor the file itself uses.
import { readFileSync, readdirSync } from 'node:fs'

const source = readFileSync('hooks/register.tsx', 'utf8')
const tests = readdirSync('hooks').filter(f => /\.test\./.test(f)).map(f => readFileSync(`hooks/${f}`, 'utf8')).join('\n')
const noms = [...source.matchAll(/^export (?:async )?(?:const|function) (\w+)/gm)].map(m => m[1]).filter(n => n !== 'register')
const utilise = n => new RegExp(`\\b${n}\\b`).test(tests) || source.match(new RegExp(`\\b${n}\\b`, 'g')).length > 1
const morts = noms.filter(n => !utilise(n))
if (morts.length) { console.log(`unused: ${morts.join(', ')}`); process.exit(1) }
console.log(`${noms.length} exports, all used`)

import { readFileSync } from 'node:fs'

const expected = process.argv[2]
if (!expected || !/^[0-9]+\.[0-9]+\.[0-9]+(?:[.-][0-9A-Za-z.-]+)?$/.test(expected)) {
  console.error('Usage: node scripts/check-release-version.mjs <semantic-version>')
  process.exit(2)
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const pom = readFileSync('spigot-plugin/pom.xml', 'utf8')
const pluginYml = readFileSync('spigot-plugin/src/main/resources/plugin.yml', 'utf8')
const pomVersion = pom.match(
  /<artifactId>minecraft-anticheat<\/artifactId>\s*<version>([^<]+)<\/version>/,
)?.[1]
const pluginVersion = pluginYml.match(/^version:\s*['"]?([^'"\s]+)['"]?\s*$/m)?.[1]

const versions = new Map([
  ['package.json', readJson('package.json').version],
  ['package-lock.json', readJson('package-lock.json').version],
  ['town-frontend/package.json', readJson('town-frontend/package.json').version],
  ['town-frontend/package-lock.json', readJson('town-frontend/package-lock.json').version],
  ['spigot-plugin/pom.xml', pomVersion],
  ['spigot-plugin/src/main/resources/plugin.yml', pluginVersion],
])

const mismatches = [...versions].filter(([, actual]) => actual !== expected)
if (mismatches.length > 0) {
  for (const [file, actual] of mismatches) {
    console.error(`${file}: expected ${expected}, found ${actual ?? 'no version'}`)
  }
  process.exit(1)
}

console.log(`Release versions match ${expected}.`)

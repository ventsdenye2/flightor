import { GeoIndex } from '../src/geo-index.mjs'
const index = new GeoIndex()
try {
  const input = JSON.parse(process.argv[2] || '{}')
  console.log(JSON.stringify(input.nearby ? index.nearby(input, input.radiusKm) : index.resolve(input), null, 2))
} finally { index.close() }

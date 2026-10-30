// Offline derivative of Natural Earth land + the pinned airportsdata snapshot.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { parse } = require(require.resolve('csv-parse/sync', { paths: [path.join(__dirname, '../trip-flight-tool')] }))
const [landFile, airportsFile] = process.argv.slice(2)
if (!landFile || !airportsFile) throw Error('Usage: node scripts/generate-world-flight-assets.cjs <land.geojson> <airports.csv>')
const land = fs.readFileSync(landFile), airports = fs.readFileSync(airportsFile)
const output = path.join(__dirname, '../src/assets/ui-experience')
const project = ([lon, lat]) => `${(lon + 180).toFixed(2)},${(90 - lat).toFixed(2)}`
const polygons = JSON.parse(land).features.flatMap(feature => feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates)
const outline = polygons.map(polygon => polygon.map(ring => 'M' + ring.map(project).join('L') + 'Z').join('')).join('')
fs.writeFileSync(path.join(output, 'world-land.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 180"><path d="${outline}" fill="#c5d6ed" fill-rule="evenodd"/></svg>\n`)
const coordinates = {}
for (const row of parse(airports, { columns: true, skip_empty_lines: true })) {
  const lon = Number(row.lon), lat = Number(row.lat)
  if (/^[A-Z]{3}$/.test(row.iata) && row.lon && row.lat && Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90) coordinates[row.iata] = [Number(lon.toFixed(4)), Number(lat.toFixed(4))]
}
if (Object.keys(coordinates).length < 7000) throw Error('Unexpectedly small airport snapshot')
fs.writeFileSync(path.join(output, 'airport-coordinates.json'), JSON.stringify(coordinates) + '\n')
const sha = value => crypto.createHash('sha256').update(value).digest('hex')
fs.writeFileSync(path.join(output, 'world-flight-sources.json'), JSON.stringify({
  projection: 'Equirectangular, lon -180..180 / lat 90..-90',
  land: { source: 'https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson', license: 'Public domain', sha256: sha(land) },
  airports: { source: 'https://github.com/mborsetti/airportsdata', ref: '47ae282a8491758e6dafe28d4139539e561b54d5', license: 'MIT', sha256: sha(airports), count: Object.keys(coordinates).length }
}, null, 2) + '\n')
fs.copyFileSync(path.join(__dirname, '../trip-flight-tool/src/core/data/AIRPORTS-LICENSE.txt'), path.join(output, 'AIRPORT-COORDINATES-LICENSE.txt'))
console.log(`world flight assets: ${polygons.length} land polygons, ${Object.keys(coordinates).length} airports`)

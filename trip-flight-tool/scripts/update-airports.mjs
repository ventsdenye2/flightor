import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { parse } from 'csv-parse/sync';

const { values } = parseArgs({ options: { csv: { type: 'string' }, macs: { type: 'string' }, license: { type: 'string' }, ref: { type: 'string', default: '47ae282a8491758e6dafe28d4139539e561b54d5' } } });
const base = `https://raw.githubusercontent.com/mborsetti/airportsdata/${values.ref}`;
async function download(path) {
  const response = await fetch(`${base}/${path}`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(`Airport source ${path}: HTTP ${response.status}`);
  return response.text();
}
const csv = values.csv ? await readFile(values.csv, 'utf8') : await download('airportsdata/airports.csv');
const macCsv = values.macs ? await readFile(values.macs, 'utf8') : await download('airportsdata/iata_macs.csv');
const license = values.license ? await readFile(values.license, 'utf8') : await download('LICENSE');
const rows = parse(csv, { columns: true, skip_empty_lines: true, bom: true });
const codes = new Set();
const zones = new Set();
const airports = [];
for (const row of rows) {
  if (!/^[A-Z]{3}$/.test(row.iata)) continue;
  if (codes.has(row.iata)) throw Error(`Duplicate IATA code: ${row.iata}`);
  if (!row.name || !row.country || !row.tz) throw Error(`Incomplete airport: ${row.iata}`);
  if (!zones.has(row.tz)) { new Intl.DateTimeFormat('en', { timeZone: row.tz }); zones.add(row.tz); }
  codes.add(row.iata);
  airports.push({ code: row.iata, icao: row.icao, name: row.name, city: row.city, country: row.country, timeZone: row.tz });
}
airports.sort((a, b) => a.code.localeCompare(b.code, 'en'));
if (airports.length < 7000) throw Error(`Airport source unexpectedly small: ${airports.length}`);
const airportByCode = new Map(airports.map(airport => [airport.code, airport]));
const cities = new Map();
const sourceCorrections = new Set();
for (const row of parse(macCsv, { columns: true, skip_empty_lines: true, bom: true })) {
  const code = row['City Code'];
  const airport = airportByCode.get(row['Airport Code']);
  if (!airport || !/^[A-Z]{3}$/.test(code)) throw Error(`Invalid multi-airport city: ${code}`);
  const city = cities.get(code) || { code, name: row['City Name'], country: airport.country, airports: [], timeZone: airport.timeZone };
  if (row.Country !== airport.country) sourceCorrections.add(`${code}: city country ${row.Country} corrected to airport country ${airport.country}`);
  if (airport.country !== city.country || airport.timeZone !== city.timeZone) throw Error(`Inconsistent multi-airport city: ${code}`);
  if (!city.airports.includes(airport.code)) city.airports.push(airport.code);
  cities.set(code, city);
}
for (const city of cities.values()) {
  const airport = airportByCode.get(city.code);
  if (airport && !city.airports.includes(city.code)) {
    if (airport.country !== city.country || airport.timeZone !== city.timeZone) throw Error(`City/airport code collision: ${city.code}`);
    city.airports.push(city.code);
    sourceCorrections.add(`${city.code}: included same-code airport omitted from city table`);
  }
}
const directory = new URL('../src/core/data/', import.meta.url);
await mkdir(directory, { recursive: true });
const metadata = {
  source: 'https://github.com/mborsetti/airportsdata', ref: values.ref,
  retrievedAt: new Date().toISOString(), sourceSha256: createHash('sha256').update(csv).digest('hex'),
  license: 'MIT', airportCount: airports.length, countryCount: new Set(airports.map(a => a.country)).size,
  cityCount: cities.size, citiesSourceSha256: createHash('sha256').update(macCsv).digest('hex'),
  sourceCorrections: [...sourceCorrections],
};
await writeFile(new URL('airports.json', directory), JSON.stringify({ metadata, airports, cities: [...cities.values()] }, null, 2) + '\n');
await writeFile(new URL('AIRPORTS-LICENSE.txt', directory), license);
console.log(JSON.stringify(metadata, null, 2));

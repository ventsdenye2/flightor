import { FlightError } from './errors.js';
import type { Location, SearchQuery } from './types.js';
import catalog from './data/airports.json' with { type: 'json' };
import { locationAliases, airportAliases } from './location-aliases.js';
const entry = (code: string, name: string, aliases: string[], airports: string[], timeZone: string, kind: Location['kind'] = 'city'): Location => ({ code, name, aliases, airports, timeZone, kind });
const legacyLocations: Location[] = [
  entry('BJS', 'Beijing', ['北京'], ['PEK','PKX'], 'Asia/Shanghai'),
  entry('PEK', 'Beijing Capital', ['首都机场','北京首都'], ['PEK'], 'Asia/Shanghai','airport'),
  entry('PKX', 'Beijing Daxing', ['大兴机场','北京大兴'], ['PKX'], 'Asia/Shanghai','airport'),
  entry('LIS', 'Lisbon', ['里斯本'], ['LIS'], 'Europe/Lisbon'),
  entry('SHA', 'Shanghai', ['上海'], ['SHA','PVG'], 'Asia/Shanghai'),
  entry('PVG', 'Shanghai Pudong', ['浦东机场'], ['PVG'], 'Asia/Shanghai','airport'),
  entry('CAN', 'Guangzhou', ['广州'], ['CAN'], 'Asia/Shanghai'),
  entry('SZX', 'Shenzhen', ['深圳'], ['SZX'], 'Asia/Shanghai'),
  entry('CKG', 'Chongqing', ['重庆'], ['CKG'], 'Asia/Shanghai'),
  entry('CTU', 'Chengdu', ['成都'], ['CTU','TFU'], 'Asia/Shanghai'),
  entry('HKG', 'Hong Kong', ['香港'], ['HKG'], 'Asia/Hong_Kong'),
  entry('LON', 'London', ['伦敦'], ['LHR','LTN','LGW','STN','LCY','SEN'], 'Europe/London'),
  ...['LHR','LTN','LGW','STN'].map(code => entry(code, {LHR:'London Heathrow',LTN:'London Luton',LGW:'London Gatwick',STN:'London Stansted'}[code]!, [], [code], 'Europe/London','airport')),
  entry('PAR', 'Paris', ['巴黎'], ['CDG','ORY'], 'Europe/Paris'),
  entry('CDG', 'Paris Charles de Gaulle', [], ['CDG'], 'Europe/Paris','airport'),
  entry('FRA', 'Frankfurt', ['法兰克福'], ['FRA'], 'Europe/Berlin'),
  entry('MUC', 'Munich', ['慕尼黑'], ['MUC'], 'Europe/Berlin'),
  entry('BRU', 'Brussels', ['布鲁塞尔'], ['BRU'], 'Europe/Brussels'),
  entry('VIE', 'Vienna', ['维也纳'], ['VIE'], 'Europe/Vienna'),
  entry('AMS', 'Amsterdam', ['阿姆斯特丹'], ['AMS'], 'Europe/Amsterdam'),
  entry('MAD', 'Madrid', ['马德里'], ['MAD'], 'Europe/Madrid'),
  entry('ROM', 'Rome', ['罗马'], ['FCO','CIA'], 'Europe/Rome'),
  entry('MIL', 'Milan', ['米兰'], ['MXP','LIN','BGY'], 'Europe/Rome'),
  entry('DXB', 'Dubai', ['迪拜'], ['DXB'], 'Asia/Dubai'),
  entry('AUH', 'Abu Dhabi', ['阿布扎比'], ['AUH'], 'Asia/Dubai'),
  entry('DOH', 'Doha', ['多哈'], ['DOH'], 'Asia/Qatar'),
  entry('IST', 'Istanbul', ['伊斯坦布尔'], ['IST'], 'Europe/Istanbul'),
  entry('SIN', 'Singapore', ['新加坡'], ['SIN'], 'Asia/Singapore'),
  entry('TYO', 'Tokyo', ['东京'], ['NRT','HND'], 'Asia/Tokyo'),
  entry('BKK', 'Bangkok', ['曼谷'], ['BKK','DMK'], 'Asia/Bangkok'),
  entry('NYC', 'New York', ['纽约'], ['JFK','EWR','LGA'], 'America/New_York'),
  entry('LAX', 'Los Angeles', ['洛杉矶'], ['LAX'], 'America/Los_Angeles'),
];
export const locationCatalogMetadata = catalog.metadata;
const normalize = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/['’`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const airports = new Map<string, Location>(catalog.airports.map(airport => [airport.code,
  entry(airport.code, airport.name, airportAliases[airport.code] ?? [], [airport.code], airport.timeZone, 'airport')]));
const byCode = new Map(airports);
for (const city of catalog.cities) byCode.set(city.code, entry(city.code, city.name, [], city.airports, city.timeZone));
for (const legacy of legacyLocations) {
  const existing = byCode.get(legacy.code);
  byCode.set(legacy.code, { ...legacy, airports: legacy.kind === 'city'
    ? [...new Set([...legacy.airports, ...(existing?.airports ?? [])])] : legacy.airports });
}
for (const [code, aliases] of Object.entries(locationAliases)) {
  const location = byCode.get(code);
  if (!location) throw new Error(`Location alias refers to missing code: ${code}`);
  location.aliases = [...new Set([...location.aliases, ...aliases])];
}
export const locations: Location[] = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code, 'en'));
type NameIndex = Map<string, Map<string, Location>>;
const preferredNames: NameIndex = new Map();
const airportNames: NameIndex = new Map();
const cityNames: NameIndex = new Map();
const icaoCodes: NameIndex = new Map();
function indexName(index: NameIndex, name: string, location: Location) {
  const key = normalize(name);
  if (!key) return;
  const matches = index.get(key) ?? new Map<string, Location>();
  matches.set(location.code, location);
  index.set(key, matches);
}
for (const location of locations) {
  if (location.kind === 'city') indexName(preferredNames, location.name, location);
  for (const alias of location.aliases) indexName(preferredNames, alias, location);
}
for (const legacy of legacyLocations) indexName(preferredNames, legacy.name, byCode.get(legacy.code)!);
for (const airport of catalog.airports) {
  const location = airports.get(airport.code)!;
  indexName(airportNames, airport.name, location);
  indexName(cityNames, airport.city, location);
  indexName(icaoCodes, airport.icao, location);
  for (const alias of location.aliases) indexName(preferredNames, alias, location);
}
export function resolveLocation(value: string): Location {
  const key = normalize(value);
  const coded = byCode.get(key.toUpperCase());
  if (coded) return coded;
  const explicitIcao = /^[A-Z0-9]{4}$/.test(value.trim()) ? icaoCodes.get(key) : undefined;
  const matches = explicitIcao ?? preferredNames.get(key) ?? airportNames.get(key) ?? cityNames.get(key) ?? icaoCodes.get(key);
  if (matches?.size === 1) return matches.values().next().value!;
  if (matches?.size) {
    const candidates = [...matches.keys()].sort();
    throw new FlightError('LOCATION_NOT_SUPPORTED', `Ambiguous location: ${value}. Specify an IATA airport/city code: ${candidates.slice(0, 15).join(', ')}${candidates.length > 15 ? ', ...' : ''}.`);
  }
  throw new FlightError('LOCATION_NOT_SUPPORTED', `Unknown location: ${value}. Use an IATA airport/city code, ICAO code, airport name or supported city alias; inspect trip-flight locations. Countries/regions must be narrowed to a city or airport.`);
}
export function airportTimeZone(code: string): string | null { return airports.get(code.trim().toUpperCase())?.timeZone ?? null; }
const airportCountries=new Map(catalog.airports.map(airport=>[airport.code,airport.country]));
export function isMainlandRoute(origin:Location,destination:Location):boolean {
  return [...origin.airports,...destination.airports].every(code=>airportCountries.get(code)==='CN');
}
export function validateDate(query: SearchQuery, timeZone: string, now = new Date()): void {
  const parsed = new Date(`${query.departureDate}T12:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0,10) !== query.departureDate) throw new FlightError('INVALID_ARGUMENTS', 'departureDate is not a real calendar date');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  if (query.departureDate < `${get('year')}-${get('month')}-${get('day')}`) throw new FlightError('INVALID_ARGUMENTS', 'Departure date is in the past at the origin');
}

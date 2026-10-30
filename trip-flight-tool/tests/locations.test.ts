import { test } from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../src/core/data/airports.json' with { type: 'json' };
import { locations, resolveLocation, airportTimeZone } from '../src/core/locations.js';
import { locationAliases, airportAliases } from '../src/core/location-aliases.js';

test('every bundled IATA airport resolves and has its own valid timezone', () => {
  assert.ok(catalog.airports.length >= 7000);
  assert.equal(catalog.metadata.airportCount, catalog.airports.length);
  assert.equal(new Set(catalog.airports.map(a => a.country)).size, catalog.metadata.countryCount);
  assert.equal(new Set(catalog.airports.map(a => a.code)).size, catalog.airports.length);
  assert.equal(new Set(locations.map(a => a.code)).size, locations.length);
  const zones = new Set<string>();
  for (const airport of catalog.airports) {
    assert.ok(resolveLocation(airport.code).airports.includes(airport.code), airport.code);
    assert.equal(airportTimeZone(airport.code.toLowerCase()), airport.timeZone, airport.code);
    zones.add(airport.timeZone);
  }
  for (const timeZone of zones) assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone }));
});

test('Prague accepts IATA, ICAO, English, Czech, Chinese, accents and surrounding whitespace', () => {
  for (const name of ['PRG', ' prg ', 'Prague', 'Praha', '布拉格', '布拉格机场', 'LKPR', 'Václav Havel Airport', 'Vaclav Havel Airport']) {
    const result = resolveLocation(name);
    assert.equal(result.code, 'PRG', name);
    assert.equal(result.kind, 'airport');
    assert.deepEqual(result.airports, ['PRG']);
  }
  assert.equal(airportTimeZone('PRG'), 'Europe/Prague');
});

test('representative airports on every inhabited continent resolve without hardcoded whitelist entries', () => {
  for (const code of ['BER', 'EZE', 'GRU', 'JNB', 'CPT', 'NBO', 'AKL', 'PPT', 'SFO', 'YYZ', 'MEX', 'DEL', 'KIX', 'TFU', 'BSZ']) {
    assert.equal(resolveLocation(code.toLowerCase()).code, code);
    assert.ok(airportTimeZone(code));
  }
});

test('upstream metro groups and existing city memberships are preserved', () => {
  for (const city of catalog.cities) {
    assert.equal(resolveLocation(city.code).kind, 'city', city.code);
    for (const code of city.airports) assert.ok(resolveLocation(city.code).airports.includes(code), `${city.code}/${code}`);
  }
  assert.deepEqual(resolveLocation('北京').airports, ['PEK', 'PKX']);
  assert.deepEqual(resolveLocation('PAR').airports, ['CDG', 'ORY']);
  assert.deepEqual(resolveLocation('NYC').airports, ['JFK', 'EWR', 'LGA']);
  assert.ok(resolveLocation('LON').airports.includes('SEN'));
  assert.deepEqual(resolveLocation('CTU').airports, ['CTU', 'TFU']);
  assert.deepEqual(resolveLocation('PKX').airports, ['PKX']);
  assert.ok(resolveLocation('JNB').airports.includes('JNB'));
  assert.ok(resolveLocation('JNB').airports.includes('HLA'));
});

test('all explicit aliases point at existing codes and remain usable', () => {
  for (const group of [locationAliases, airportAliases]) {
    for (const [code, aliases] of Object.entries(group)) {
      for (const alias of aliases) assert.equal(resolveLocation(alias).code, code, alias);
    }
  }
  assert.equal(resolveLocation('São Paulo').code, 'SAO');
  assert.equal(resolveLocation('上海').kind, 'city');
  assert.equal(resolveLocation('上海虹桥').kind, 'airport');
  assert.deepEqual(resolveLocation('上海虹桥').airports, ['SHA']);
  assert.deepEqual(resolveLocation('成都双流').airports, ['CTU']);
  assert.equal(resolveLocation('Kobe').code, 'UKB');
  assert.equal(resolveLocation('KOBE').code, 'OBE');
});

test('ambiguous names list candidate codes and unknown regions do not become invented airports', () => {
  assert.throws(() => resolveLocation('Cambridge'), (error: any) => error.code === 'LOCATION_NOT_SUPPORTED' && /CBG/.test(error.message) && /CGE/.test(error.message));
  assert.equal(resolveLocation('CBG').code, 'CBG');
  assert.equal(resolveLocation('CGE').code, 'CGE');
  for (const name of ['Atlantis imaginary airport', '法国', 'France', '']) {
    assert.throws(() => resolveLocation(name), (error: any) => error.code === 'LOCATION_NOT_SUPPORTED');
  }
  assert.equal(airportTimeZone('unknown'), null);
});

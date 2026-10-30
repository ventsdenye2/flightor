import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FlightTool } from '../src/core/service.js';
import { searchInputSchema } from '../src/core/types.js';
import { resolveLocation } from '../src/core/locations.js';
import { parseCard, combineRoundTrip, parseRoundTripDetails } from '../src/providers/trip/parser.js';
import { verifyUrl, publicSearchUrl } from '../src/providers/trip/browser.js';

const input={origin:'BJS',destination:'LIS',departureDate:'2099-10-28',tripType:'round_trip',returnDate:'2099-11-03',currency:'CNY'};
const query=searchInputSchema.parse(input);
const leg=(from:string,to:string,date:string,time:string,arrival:string)=>({label:`Flight departing from ${from} at ${date} ${time}:00 and arriving at ${to} at ${date} ${arrival}:00`,text:'Test Air\n12h\nNonstop',airlineText:'Test Air',airports:[from,to],priceLabel:''});

test('round trip requires two real dates in order; one way rejects an accidental return date before browser startup',async()=>{
  const tool=new FlightTool();
  for(const change of [{returnDate:undefined},{returnDate:'2099-10-27'},{returnDate:'2099-02-30'},{tripType:'one_way'},{tripType:'multi_city'}]) {
    const result=await tool.searchFlights({...input,...change});
    assert.equal(result.status,'error'); assert.equal((result as any).code,'INVALID_ARGUMENTS'); assert.equal(result.attempts,0);
  }
  assert.equal(searchInputSchema.parse({origin:'BJS',destination:'LIS',departureDate:'2099-10-28'}).tripType,'one_way');
});
test('round-trip identity includes BOTH directions and preserves total fare without counting the stay as flying time',()=>{
  const outbound=parseCard({...leg('PEK','LIS','2099-10-28','10:00','22:00'),priceLabel:'Round-trip price: CNY 4600'},query);
  const inbound=parseCard({...leg('LIS','PEK','2099-11-03','12:00','23:00'),priceLabel:'Round-trip price: CNY 5600'},query);
  const first=combineRoundTrip(outbound,inbound);
  assert.equal(first.price.amount,5600); assert.equal(first.price.checkoutVerified,false);
  assert.equal(first.journeys?.[1].departureLocal,'2099-11-03T12:00:00');
  assert.equal(first.durationMinutes,1440); assert.equal(first.stopCount,0);
  assert.notEqual(first.id,combineRoundTrip(outbound,{...inbound,id:'another-return'}).id);
  assert.equal(first.id,combineRoundTrip(outbound,{...inbound,price:{...inbound.price,amount:6000}}).id);
  assert.equal(first.journeys?.[0].details,null);
});
test('captured native fare drawer splits both journeys and seeds return dates separately across midnight',async()=>{
  const text=await readFile(new URL('./fixtures/roundtrip-details.txt',import.meta.url),'utf8');
  const q=searchInputSchema.parse({...input,departureDate:'2026-10-31',returnDate:'2026-11-03'});
  const journeys=[{direction:'outbound',departureAirport:'PEK',arrivalAirport:'LIS'},{direction:'return',departureAirport:'LIS',arrivalAirport:'PEK'}] as any;
  const result=parseRoundTripDetails(text,q,journeys,{rawTextPath:'x',screenshotPath:'y'});
  assert.deepEqual(result.journeys.map(j=>j.segments.map(s=>s.flightNumber)),[['EK309','EK193'],['LH1781','CA962']]);
  assert.equal(result.journeys[0].segments[0].departureLocal,'2026-10-31T06:50:00');
  assert.equal(result.journeys[1].segments[0].departureLocal,'2026-11-03T06:05:00');
  assert.equal(result.journeys[1].segments[1].arrivalLocal,'2026-11-04T05:00:00');
  assert.deepEqual(result.journeys.map(j=>j.connections.length),[1,1]);
  assert.equal(result.journeys[0].segments[0].cabin,'Premium Economy');
  assert.equal(result.journeys[0].baggage.checked,null);
  assert.equal(result.details.baggage.checked,'Included');
});
test('round-trip URL validates both dates and cannot accept one-way results as a return fare',()=>{
  const resolved={origin:resolveLocation('BJS'),destination:resolveLocation('LIS')};
  const url='https://www.trip.com/flights/showfarefirst?dcity=bjs&acity=lis&ddate=2099-10-28&rdate=2099-11-03&triptype=rt&class=y&quantity=1&curr=CNY';
  verifyUrl(url,query,resolved);
  assert.throws(()=>verifyUrl(url.replace('rt','ow'),query,resolved));
  assert.throws(()=>verifyUrl(url.replace('2099-11-03','2099-11-04'),query,resolved));
  assert.equal(publicSearchUrl(url+'&criteriaToken=private-search-token&shoppingid=private-id').includes('private'),false);
  verifyUrl(publicSearchUrl(url),query,resolved);
});
test('city and airport requests preserve their separate scopes in native URLs',()=>{
  for(const [city,airport] of [['TYO','HND'],['LON','LHR'],['SHA','PVG'],['NYC','JFK'],['PAR','CDG']]) {
    const q=searchInputSchema.parse({...input,destination:airport});
    const resolved={origin:resolveLocation('BJS'),destination:resolveLocation(airport)};
    const url=`https://www.trip.com/flights/showfarefirst?dcity=bjs&acity=${city.toLowerCase()}&aairport=${airport.toLowerCase()}&ddate=2099-10-28&rdate=2099-11-03&triptype=rt&class=y&quantity=1&curr=CNY`;
    verifyUrl(url,q,resolved);
    verifyUrl(publicSearchUrl(url),q,resolved);
    assert.throws(()=>verifyUrl(url.replace(`&aairport=${airport.toLowerCase()}`,''),q,resolved));
    assert.throws(()=>verifyUrl(url.replace(`aairport=${airport.toLowerCase()}`,'aairport=xxx'),q,resolved));
    const cityQuery=searchInputSchema.parse({...input,destination:city});
    const cityResolved={origin:resolveLocation('BJS'),destination:resolveLocation(city)};
    verifyUrl(url.replace(`&aairport=${airport.toLowerCase()}`,''),cityQuery,cityResolved);
    assert.throws(()=>verifyUrl(url,cityQuery,cityResolved));
  }
});
test('native economy drawer keeps the two departure dates and does not mistake airport-arrival advice for a flight date',async()=>{
  const text=await readFile(new URL('./fixtures/roundtrip-economy-details.txt',import.meta.url),'utf8');
  const q=searchInputSchema.parse({...input,departureDate:'2026-10-31',returnDate:'2026-11-03'});
  const result=parseRoundTripDetails(text,q,[{departureAirport:'PEK',arrivalAirport:'LIS'},{departureAirport:'LIS',arrivalAirport:'PEK'}] as any,{rawTextPath:'x',screenshotPath:'y'});
  assert.equal(result.journeys[0].segments[0].departureLocal,'2026-10-31T00:40:00');
  assert.equal(result.journeys[1].segments[0].departureLocal,'2026-11-03T06:05:00');
  assert.ok(result.details.segments.every(segment=>segment.cabin==='Economy class'));
});

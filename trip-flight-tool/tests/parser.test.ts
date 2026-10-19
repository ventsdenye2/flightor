import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseDetails,parseCard,parseAmount,durationMinutes,parseResultCount } from '../src/providers/trip/parser.js';
import { searchInputSchema } from '../src/core/types.js';
import { resolveLocation,validateDate } from '../src/core/locations.js';
import { assertNoAccessBlock,verifyUrl,searchResponseError,summarizeSearchResponse } from '../src/providers/trip/browser.js';
const query=searchInputSchema.parse({origin:'BJS',destination:'LIS',departureDate:'2026-10-28',currency:'USD'});
test('provider result count handles both observed list layouts without reading sidebar totals',()=>{
  assert.equal(parseResultCount('Airlines\nTAP (9)\nBeijingLisbon\n25 flights\nCheapest'),25);
  assert.equal(parseResultCount('Departing for Lisbon\n25 flights found\nCheapest'),25);
  assert.equal(parseResultCount('(25 flights)'),25);
  assert.equal(parseResultCount('No flight count available'),null);
});
test('three segments preserve the London airport change, local dates and basic fare baggage',async()=>{
  const text=await readFile(new URL('./fixtures/details.txt',import.meta.url),'utf8');
  const detail=parseDetails(text,query,{rawTextPath:'details.txt',screenshotPath:'details.png'});
  assert.deepEqual(detail.segments.map(s=>s.flightNumber),['JD5755','GS7965','U22459']);
  assert.equal(detail.segments[0].departureLocal,'2026-10-28T07:45:00');
  assert.equal(detail.segments[2].departureLocal,'2026-10-29T06:00:00');
  assert.equal(detail.segments[2].arrivalLocal,'2026-10-29T08:55:00');
  assert.equal(detail.segments[1].arrivalTimeZone,'Europe/London');
  assert.equal(detail.segments[0].durationMinutes,160);
  assert.equal(detail.connections.length,2);
  assert.equal(detail.connections[1].airportChange,true);
  assert.equal(detail.connections[1].selfTransfer,true);
  assert.equal(detail.connections[1].collectAndRecheckBaggage,null);
  assert.equal(detail.connections[0].collectAndRecheckBaggage,true);
  assert.equal(detail.baggage.checked,'Not included');
});
test('an airline whose name starts with an airport code does not hide its segment',async()=>{
  const text=(await readFile(new URL('./fixtures/details.txt',import.meta.url),'utf8')).replace('LTN London Luton\neasyJet\nU22459','LHR London HeathrowT2\nTAP Air Portugal\nTP1363');
  const detail=parseDetails(text,query,{rawTextPath:'x',screenshotPath:'y'});
  assert.equal(detail.segments.length,3);assert.equal(detail.segments[2].flightNumber,'TP1363');assert.equal(detail.connections[1].airportChange,false);
});
test('candidate identity does not depend on price, but distinguishes route and departure',()=>{
  const card={label:'Flight departing from Beijing at 2026-10-28 07:45:00 and arriving at Lisbon at 2026-10-29 08:55:00. One-way price: US$319',text:'Capital Airlines, Tianjin Airlines, easyJet\n07:45\nPKX\n33h 10m\n2 stops in Chongqing, London\n08:55\nLIS',airlineText:'Capital Airlines, Tianjin Airlines, easyJet',airports:['PKX','LIS'],priceLabel:'US$319'};
  const first=parseCard(card,query),changedPrice=parseCard({...card,priceLabel:'US$320'},query);
  assert.equal(first.durationMinutes,1990);assert.equal(first.stopCount,2);assert.equal(first.id,changedPrice.id);
  assert.notEqual(first.id,parseCard({...card,airports:['PEK','LIS']},query).id);
});
test('money parsing never substitutes currencies and accepts separators',()=>{
  assert.equal(parseAmount('CNY 2,276.50','CNY'),2276.5);
  assert.equal(parseAmount('US$319','USD'),319);
  assert.throws(()=>parseAmount('US$319','CNY'));
  assert.throws(()=>parseAmount('HK$319','USD'));
  assert.equal(durationMinutes('12h'),720);assert.equal(durationMinutes('35m'),35);
});
test('missing segments fail instead of inventing an itinerary',()=>{
  assert.throws(()=>parseDetails('Select Fare\nUS$319',query,{rawTextPath:'x',screenshotPath:'y'}));
});
test('supported city aliases and dates are explicit; unknown places do not silently substitute',()=>{
  assert.equal(resolveLocation('北京').code,'BJS');assert.deepEqual(resolveLocation('PKX').airports,['PKX']);
  assert.throws(()=>resolveLocation('Cambridge'));
  assert.throws(()=>validateDate({...query,departureDate:'2026-02-30'},'Asia/Shanghai',new Date('2026-01-01')));
  assert.throws(()=>validateDate({...query,departureDate:'2026-10-18'},'Asia/Shanghai',new Date('2026-10-18T23:00:00Z')));
});
test('access restriction is non-retryable and route/currency mismatches are rejected',()=>{
  assert.throws(()=>assertNoAccessBlock('whaleguard block'),(e:any)=>e.code==='ACCESS_RESTRICTED'&&!e.retryable&&e.status==='needs_user_action');
  const resolved={origin:resolveLocation('BJS'),destination:resolveLocation('LIS')};
  const url='https://www.trip.com/flights/showfarefirst?dcity=bjs&acity=lis&ddate=2026-10-28&triptype=ow&class=y&quantity=1&curr=USD';
  verifyUrl(url,query,resolved);assert.throws(()=>verifyUrl(url.replace('USD','CNY'),query,resolved));
});
test('HTTP 430 in a flight response is access restriction, never a zero-flight result',()=>{
  const error=searchResponseError(430,'/FlightListSearchSSE');
  assert.equal(error?.code,'ACCESS_RESTRICTED');assert.equal(error?.status,'needs_user_action');assert.equal(error?.retryable,false);
  assert.equal(searchResponseError(200,'/FlightListSearchSSE'),undefined);
  assert.equal(searchResponseError(503,'/FlightListSearchSSE')?.retryable,true);
});
test('HTTP 200 stream must contain a successful business result before the page is trusted',()=>{
  assert.deepEqual(summarizeSearchResponse('data: {"head":{"retCode":"SUCCESS"},"basicInfo":{"recordCount":25}}\n\n'),{retCode:'SUCCESS',recordCount:25});
  assert.throws(()=>summarizeSearchResponse('data: {"head":{"retCode":"FAILED"},"basicInfo":{"recordCount":0}}'),(error:any)=>error.code==='PROVIDER_ERROR');
  assert.throws(()=>summarizeSearchResponse('data: {"head":{"retCode":"SUCCESS"}}'),(error:any)=>error.code==='PROVIDER_RESPONSE_ERROR');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseDetails,validateDetails,parseCard,parseAmount,durationMinutes,parseResultCount } from '../src/providers/trip/parser.js';
import { searchInputSchema } from '../src/core/types.js';
import { resolveLocation,validateDate } from '../src/core/locations.js';
import { assertNoAccessBlock,verifyUrl,searchResponseError,summarizeSearchResponse } from '../src/providers/trip/browser.js';
const query=searchInputSchema.parse({origin:'BJS',destination:'LIS',departureDate:'2026-10-28',currency:'USD'});
test('a technical stop stays inside its numbered flight and counts separately from transfers',async()=>{
  const text=await readFile(new URL('./fixtures/technical-stop-details.txt',import.meta.url),'utf8');
  const q=searchInputSchema.parse({...query,destination:'NGO',departureDate:'2026-10-30',currency:'CNY'});
  const detail=parseDetails(text,q,{rawTextPath:'x',screenshotPath:'y'});
  assert.deepEqual(detail.segments.map(s=>s.flightNumber),['CX337','CX530']);
  assert.equal(detail.connections.length,1);
  assert.equal(detail.connections[0].city,'Hong Kong');
  assert.equal(detail.segments[0].stops,undefined);
  assert.deepEqual(detail.segments[1].stops,[{city:'Taipei',durationMinutes:70}]);
  const candidate={departureAirport:'PEK',arrivalAirport:'NGO',departureLocal:'2026-10-30T19:30:00',arrivalLocal:'2026-10-31T15:35:00',stopCount:2};
  validateDetails(candidate,detail);
  assert.throws(()=>validateDetails(candidate,{...detail,segments:detail.segments.map(({stops,...segment})=>segment)}),/stop count/);
  assert.throws(()=>validateDetails({...candidate,stopCount:1},detail),/stop count/);
  assert.throws(()=>validateDetails(candidate,{...detail,connections:[]}),/Connection conditions/);
  assert.throws(()=>validateDetails({...candidate,arrivalAirport:'NRT'},detail),/differs/);
});
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
test('multi-adult cards read visible per-adult and total fares without treating the aria total as a person price',()=>{
  const q=searchInputSchema.parse({...query,adults:2,currency:'CNY'});
  const card={label:'Flight departing from Beijing at 2026-10-31 20:55:00 and arriving at Tokyo at 2026-11-02 01:05:00. One-way price: CNY 3184',text:'Air China, Spring Airlines\n27h 10m\n1 stop in Shanghai',airlineText:'Air China, Spring Airlines',airports:['PEK','HND'],priceLabel:'One-way price: CNY 3184',priceText:'Air China, Spring Airlines\nCNY 1,592\nTotal CNY 3,184\nSelect'};
  const result=parseCard(card,q);
  assert.equal(result.price.amount,1592);
  assert.equal(result.price.totalAmount,3184);
  assert.equal(result.price.basis,'per_adult');
  assert.throws(()=>parseCard({...card,priceText:undefined},q));
  assert.throws(()=>parseCard({...card,priceText:'Total CNY 3,184'},q));
});
test('round-trip departure starting total may come from its explicit native aria price, final fares still require visible Total',()=>{
  const q=searchInputSchema.parse({...query,tripType:'round_trip',returnDate:'2026-11-03',adults:2,currency:'CNY'});
  const label='Flight departing from Beijing at 2026-10-31 02:40:00 and arriving at Lisbon at 2026-10-31 14:25:00.\nRound-trip price: CNY 17,278';
  const card={label,priceLabel:label,text:'Hainan Airlines, TAP Air Portugal\n19h 45m\n5h 35m in Manchester',airlineText:'Hainan Airlines, TAP Air Portugal',airports:['PEK','LIS'],priceText:'CNY 8,639\nRound-trip\nSelect'};
  const result=parseCard(card,q,'outbound_starting');
  assert.equal(result.price.amount,8639);assert.equal(result.price.totalAmount,17278);
  assert.throws(()=>parseCard(card,q),/explicit per-adult/);
  assert.throws(()=>parseCard(card,{...q,tripType:'one_way'},'outbound_starting'),/explicit per-adult/);
  assert.throws(()=>parseCard({...card,priceLabel:label.replace('Round-trip price:','Unverified:')},q,'outbound_starting'),/explicit per-adult/);
  assert.throws(()=>parseCard({...card,priceLabel:label.replace('CNY','USD')},q,'outbound_starting'),/CNY price/);
  const final=parseCard({...card,priceText:'CNY 8,639\nTotal CNY 17,278\nSelect'},q);
  assert.deepEqual(final.price,result.price);
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

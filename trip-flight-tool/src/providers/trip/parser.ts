import { createHash } from 'node:crypto';
import { FlightError } from '../../core/errors.js';
import { airportTimeZone } from '../../core/locations.js';
import type { Candidate, Connection, FlightDetails, Journey, SearchQuery, Segment } from '../../core/types.js';

export function durationMinutes(value: string): number | null {
  const match = value.trim().match(/^(?:(\d+)\s*h(?:ours?)?)?\s*(?:(\d+)\s*m(?:inutes?)?)?$/i);
  if (!match || (!match[1] && !match[2])) return null;
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
}
export function parseAmount(text: string, currency: SearchQuery['currency']): number {
  const symbol = {USD:'(?:US\\$|USD|\\$)',CNY:'(?:CNY|CN¥|RMB|¥|￥)',EUR:'(?:EUR|€)',GBP:'(?:GBP|£)',HKD:'(?:HK\\$|HKD)',SGD:'(?:S\\$|SGD)'}[currency];
  const match = text.match(new RegExp(`(?:^|\\s|:)${symbol}\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)`));
  if (!match) throw new FlightError('PAGE_CHANGED', `Could not parse ${currency} price; refusing to assume currency`);
  const value = Number(match[1].replaceAll(',',''));
  if (!Number.isFinite(value) || value <= 0) throw new FlightError('PAGE_CHANGED','Invalid displayed price');
  return value;
}
export interface CardData { label: string; text: string; priceLabel: string; priceText?: string; airlineText: string; airports: string[]; instanceKey?: string }

// Identical summaries are not necessarily identical itineraries. Keep each
// original DOM card instead of deduplicating or assigning a list-position ID.
// Once a summary collides, keep it page-bound even if its sibling disappears.
export function bindCandidateIdentities(candidates:Candidate[],cards:CardData[],ambiguous=new Set<string>()):Candidate[] {
  const counts=new Map<string,number>();
  for(const candidate of candidates)counts.set(candidate.id,(counts.get(candidate.id)??0)+1);
  for(const [id,count] of counts)if(count>1)ambiguous.add(id);
  return candidates.map((candidate,index)=>{
    const cardKey=cards[index]?.instanceKey;
    if(!ambiguous.has(candidate.id))return {...candidate,...(cardKey?{cardKey}:{})};
    if(!cardKey)throw new FlightError('AMBIGUOUS_CANDIDATES','Identical summaries require their original result cards');
    return {...candidate,cardKey,pageBound:true,id:createHash('sha256').update(`${candidate.id}:${cardKey}`).digest('hex').slice(0,16)};
  });
}
export function combineRoundTrip(outbound: Candidate, inbound: Candidate): Candidate {
  const journeys=[outbound,inbound].map((candidate,index)=>{
    const {id,price,summaryText,...journey}=candidate;
    return {...journey,direction:index===0?'outbound' as const:'return' as const};
  });
  return {...outbound,id:createHash('sha256').update(`${outbound.id}:${inbound.id}`).digest('hex').slice(0,16),
    price:inbound.price,airlines:[...new Set(journeys.flatMap(j=>j.airlines))],journeys,
    durationMinutes:journeys.every(j=>j.durationMinutes!==null)?journeys.reduce((sum,j)=>sum+j.durationMinutes!,0):null,
    stopCount:journeys.every(j=>j.stopCount!==null)?journeys.reduce((sum,j)=>sum+j.stopCount!,0):null,
    summaryText:`Outbound:\n${outbound.summaryText}\nReturn:\n${inbound.summaryText}`,details:null};
}
export function parseResultCount(text:string):number|null {
  const line=text.split('\n').map(s=>s.trim()).find(s=>/^\(?[\d,]+ flights(?: found)?\)?$/.test(s));
  return line?Number(line.match(/[\d,]+/)![0].replaceAll(',','')):null;
}
export function parseCard(card: CardData, query: SearchQuery,stage:'final'|'outbound_starting'='final'): Candidate {
  const times = [...card.label.matchAll(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g)].map(m => m[0].replace(' ','T'));
  if (times.length !== 2 || card.airports.length !== 2) throw new FlightError('PAGE_CHANGED','Missing airport or full local datetime in flight card');
  const lines = card.text.split('\n').map(x => x.trim()).filter(Boolean);
  const durationLine = lines.find(x => /^\d+h(?:\s*\d+m)?$|^\d+m$/.test(x));
  const stops = card.text.match(/(\d+) stops?/i);
  const stopCount = stops ? Number(stops[1]) : /nonstop|direct/i.test(card.text) ? 0 : /\bin\s+[A-Z]/.test(card.text) ? 1 : null;
  // Multi-adult aria labels announce the group total, while the visible card
  // and fare drawer show the per-adult quote followed by an explicit Total.
  const priceLines=card.priceText?.split('\n').map(line=>line.trim()).filter(Boolean);
  const totalLine=priceLines?.find(line=>/^Total\s/i.test(line));
  // The round-trip departure picker only shows a per-adult starting fare. Its
  // accessible Round-trip price is the native group starting total. Final
  // return combinations must still have the visible Total, as must one-way.
  const startingTotal=query.adults>1&&query.tripType==='round_trip'&&stage==='outbound_starting'
    ?card.priceLabel.match(/Round-trip price:[^\n]+/)?.[0]:undefined;
  if(query.adults>1&&(!priceLines?.length||(!totalLine&&!startingTotal)))throw new FlightError('PAGE_CHANGED','Missing explicit per-adult and total prices for the requested passengers');
  const price = parseAmount(priceLines?.length?priceLines.filter(line=>!/^Total\s/i.test(line)).join('\n'):card.priceLabel,query.currency);
  const totalAmount=totalLine||startingTotal?parseAmount((totalLine??startingTotal)!,query.currency):undefined;
  const identity:unknown[]=[times,card.airports,card.airlineText,lines.filter(x => /stops?|\bin\s/.test(x))];
  const operators=lines.filter(x=>/^Operated by\b/i.test(x));
  if(operators.length)identity.push(operators);
  const id = createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0,16);
  return { id,price:{amount:price,currency:query.currency,basis:'per_adult',checkoutVerified:false,...(totalAmount!==undefined?{totalAmount}:{})},
    airlines:card.airlineText.split(/,\s*/).filter(Boolean), departureAirport:card.airports[0],arrivalAirport:card.airports[1],
    departureLocal:times[0],arrivalLocal:times[1],durationMinutes:durationLine ? durationMinutes(durationLine) : null,
    stopCount,summaryText:card.text,details:null };
}
const monthNumbers: Record<string,string> = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
export function parseRoundTripDetails(text:string, query:SearchQuery, journeys:Journey[], evidence:{rawTextPath:string;screenshotPath:string}) {
  const lines=text.split('\n');
  const back=journeys[1];
  const split=lines.findIndex(line=>{
    const from=line.indexOf(`(${back.departureAirport})`),to=line.indexOf(`(${back.arrivalAirport})`);
    return from>=0&&to>from&&/(Mon|Tue|Wed|Thu|Fri|Sat|Sun),/.test(line);
  });
  if(split<1) throw new FlightError('DETAILS_MISMATCH','Missing explicit return itinerary heading');
  const fareIndex=lines.findIndex(line=>line.trim()==='Select Fare');
  if(fareIndex<=split) throw new FlightError('DETAILS_MISMATCH','Missing round-trip fare after both journeys');
  const fare=lines.slice(fareIndex).join('\n');
  const outbound=parseDetails(lines.slice(0,split).join('\n')+'\n'+fare,query,evidence);
  const inbound=parseDetails(lines.slice(split,fareIndex).join('\n')+'\n'+fare,{...query,departureDate:query.returnDate!},evidence);
  // The fare drawer's baggage summary can be a minimum across several flights;
  // do not attribute it to every direction as a verified allowance.
  const details={...outbound,segments:[...outbound.segments,...inbound.segments],connections:[...outbound.connections,...inbound.connections],warnings:[...outbound.warnings,...inbound.warnings]};
  return {details,journeys:[{...outbound,baggage:{carryOn:null,checked:null}},{...inbound,baggage:{carryOn:null,checked:null}}]};
}
export function parseDetails(text: string, query: SearchQuery, evidence: {rawTextPath:string;screenshotPath:string}, observedAt = new Date().toISOString()): FlightDetails {
  const lines = text.split('\n').map(x => x.replaceAll('\u00a0',' ').trim()).filter(Boolean);
  const possibleIndexes = lines.flatMap((line,i) => /^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(line) && !/^[A-Z]{3}$/.test(line) ? [i] : []);
  const segments: Segment[] = [];
  const connections: Connection[] = [];
  const warnings: string[] = [];
  let firstTimeIndex = -1;
  function findAirportBefore(index: number): number {
    for(let i=index-1;i>=1 && i>index-8;i--) if (/^[A-Z]{3}\s/.test(lines[i]) && /^\d{2}:\d{2}$/.test(lines[i-1])) return i;
    return -1;
  }
  // A segment has one departure time/airport block. Aircraft labels such as
  // C919, B787 or A320 can also match the flight-number regex, but occur after
  // that block's actual flight number; they must not create extra segments.
  const departures=new Set<number>();
  const indexes=possibleIndexes.filter(index=>{
    const airport=findAirportBefore(index);
    if(airport<1||departures.has(airport))return false;
    departures.add(airport);return true;
  });
  if (indexes.length) firstTimeIndex = findAirportBefore(indexes[0]) - 1;
  const dateAt = (index: number) => {
    let date = query.departureDate;
    for(let i=Math.max(0,firstTimeIndex);i<=index;i++) {
      const m = lines[i].match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/);
      if (m) { const month = monthNumbers[m[1]]; const year = m[3] ?? String(Number(query.departureDate.slice(0,4)) + (month < query.departureDate.slice(5,7) ? 1 : 0)); date = `${year}-${month}-${m[2].padStart(2,'0')}`; }
    }
    return date;
  };
  for (const index of indexes) {
    const fromIndex = findAirportBefore(index);
    let toTimeIndex = -1;
    for(let i=index+1;i<Math.min(lines.length,index+16);i++) if (/^\d{2}:\d{2}$/.test(lines[i]) && /^[A-Z]{3}\s/.test(lines[i+1] ?? '')) { toTimeIndex=i;break; }
    if (fromIndex < 1 || toTimeIndex < 0 || !/^\d{2}:\d{2}$/.test(lines[fromIndex-1])) continue;
    const origin=lines[fromIndex].slice(0,3), destination=lines[toTimeIndex+1].slice(0,3);
    const duration=lines.slice(index+1,toTimeIndex).find(x=>x.startsWith('Flight time:'));
    // A technical stop stays within one numbered flight. Read it only from this
    // flight's detail block; the drawer also repeats stops in its route summary.
    const stops=lines.slice(index+1,toTimeIndex).flatMap((line,i,block)=>{
      const match=line.match(/^Stop in (.+)$/);
      return match?[{city:match[1],durationMinutes:durationMinutes(block[i+1]??'')}]:[];
    });
    segments.push({airline:lines[index-1] ?? null,flightNumber:lines[index],origin,destination,
      departureLocal:`${dateAt(fromIndex-1)}T${lines[fromIndex-1]}:00`,arrivalLocal:`${dateAt(toTimeIndex)}T${lines[toTimeIndex]}:00`,
      departureTimeZone:airportTimeZone(origin),arrivalTimeZone:airportTimeZone(destination),durationMinutes:duration ? durationMinutes(duration.replace('Flight time:','')) : null,
      cabin:lines.slice(index+1,toTimeIndex).find(x=>/^(?:Premium Economy|Economy(?: class)?|Business(?: class)?|First(?: class)?)$/i.test(x))??null,...(stops.length?{stops}:{})});
    const nextFlight=indexes[indexes.indexOf(index)+1];
    if(nextFlight !== undefined) {
      const connectionLines=lines.slice(toTimeIndex+2,findAirportBefore(nextFlight)-1);
      const connectionText=connectionLines.join('\n');
      const match=connectionText.match(/(Self-transfer|Transfer) in ([^\n]+)\n([^\n]+)/);
      if(match) connections.push({city:match[2],durationMinutes:durationMinutes(match[3]),selfTransfer:match[1]==='Self-transfer'?true:null,
        airportChange:/Different airports/.test(connectionText)?true:null,
        collectAndRecheckBaggage:/May need to collect/.test(connectionText)?null:/Collect & re-check baggage/.test(connectionText)?true:null});
    }
  }
  for(let i=0;i<connections.length;i++) {
    const a=segments[i],b=segments[i+1];
    if(a&&b) connections[i].airportChange=a.destination!==b.origin;
  }
  if(!segments.length) throw new FlightError('PAGE_CHANGED','Could not parse detailed flight segments');
  if(connections.some(c=>c.selfTransfer)) warnings.push('Self-transfer required; check the displayed transfer conditions.');
  if(connections.some(c=>c.airportChange)) warnings.push('Airport change required; ground transport is outside the displayed airfare.');
  if(segments.some(s=>!s.departureTimeZone||!s.arrivalTimeZone)) warnings.push('Some airport time zones are unknown; local times have not been converted.');
  const fares=text.slice(text.indexOf('Select Fare'));
  return {observedAt,segments,connections,baggage:{carryOn:fares.match(/Carry-on baggage:\s*([^\n]+)/)?.[1]??null,checked:fares.match(/Checked baggage:\s*([^\n]+)/)?.[1]??null},warnings,...evidence};
}
export function validateDetails(candidate:Pick<Candidate,'departureAirport'|'arrivalAirport'|'departureLocal'|'arrivalLocal'|'stopCount'>,detail:FlightDetails) {
  const first=detail.segments[0],last=detail.segments.at(-1);
  if(!first||!last)throw new FlightError('DETAILS_MISMATCH','Journey has no detailed flight segments');
  if(first.origin!==candidate.departureAirport||last.destination!==candidate.arrivalAirport||first.departureLocal!==candidate.departureLocal||last.arrivalLocal!==candidate.arrivalLocal)throw new FlightError('DETAILS_MISMATCH','Detailed itinerary differs from the selected candidate');
  const technicalStops=detail.segments.reduce((sum,segment)=>sum+(segment.stops?.length??0),0);
  if(candidate.stopCount!==null&&detail.segments.length-1+technicalStops!==candidate.stopCount)throw new FlightError('DETAILS_MISMATCH','Segment and technical-stop count differs from displayed stop count');
  if(detail.connections.length!==detail.segments.length-1)throw new FlightError('DETAILS_MISMATCH','Connection conditions are incomplete');
}

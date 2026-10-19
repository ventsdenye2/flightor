import { createHash } from 'node:crypto';
import { FlightError } from '../../core/errors.js';
import { airportTimeZone } from '../../core/locations.js';
import type { Candidate, Connection, FlightDetails, SearchQuery, Segment } from '../../core/types.js';

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
export interface CardData { label: string; text: string; priceLabel: string; airlineText: string; airports: string[] }
export function parseResultCount(text:string):number|null {
  const line=text.split('\n').map(s=>s.trim()).find(s=>/^\(?[\d,]+ flights(?: found)?\)?$/.test(s));
  return line?Number(line.match(/[\d,]+/)![0].replaceAll(',','')):null;
}
export function parseCard(card: CardData, query: SearchQuery): Candidate {
  const times = [...card.label.matchAll(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g)].map(m => m[0].replace(' ','T'));
  if (times.length !== 2 || card.airports.length !== 2) throw new FlightError('PAGE_CHANGED','Missing airport or full local datetime in flight card');
  const lines = card.text.split('\n').map(x => x.trim()).filter(Boolean);
  const durationLine = lines.find(x => /^\d+h(?:\s*\d+m)?$|^\d+m$/.test(x));
  const stops = card.text.match(/(\d+) stops?/i);
  const stopCount = stops ? Number(stops[1]) : /nonstop|direct/i.test(card.text) ? 0 : /\bin\s+[A-Z]/.test(card.text) ? 1 : null;
  const price = parseAmount(card.priceLabel,query.currency);
  const id = createHash('sha256').update(JSON.stringify([times,card.airports,card.airlineText,lines.filter(x => /stops?|\bin\s/.test(x))])).digest('hex').slice(0,16);
  return { id,price:{amount:price,currency:query.currency,basis:'per_adult',checkoutVerified:false},
    airlines:card.airlineText.split(/,\s*/).filter(Boolean), departureAirport:card.airports[0],arrivalAirport:card.airports[1],
    departureLocal:times[0],arrivalLocal:times[1],durationMinutes:durationLine ? durationMinutes(durationLine) : null,
    stopCount,summaryText:card.text,details:null };
}
const monthNumbers: Record<string,string> = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
export function parseDetails(text: string, query: SearchQuery, evidence: {rawTextPath:string;screenshotPath:string}, observedAt = new Date().toISOString()): FlightDetails {
  const lines = text.split('\n').map(x => x.replaceAll('\u00a0',' ').trim()).filter(Boolean);
  const indexes = lines.flatMap((line,i) => /^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(line) && !/^[A-Z]{3}$/.test(line) ? [i] : []);
  const segments: Segment[] = [];
  const connections: Connection[] = [];
  const warnings: string[] = [];
  let firstTimeIndex = -1;
  function findAirportBefore(index: number): number {
    for(let i=index-1;i>=1 && i>index-8;i--) if (/^[A-Z]{3}\s/.test(lines[i]) && /^\d{2}:\d{2}$/.test(lines[i-1])) return i;
    return -1;
  }
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
    segments.push({airline:lines[index-1] ?? null,flightNumber:lines[index],origin,destination,
      departureLocal:`${dateAt(fromIndex-1)}T${lines[fromIndex-1]}:00`,arrivalLocal:`${dateAt(toTimeIndex)}T${lines[toTimeIndex]}:00`,
      departureTimeZone:airportTimeZone(origin),arrivalTimeZone:airportTimeZone(destination),durationMinutes:duration ? durationMinutes(duration.replace('Flight time:','')) : null});
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

import type { BrowserContext } from 'playwright';
import { mkdir,readFile,writeFile,rename,rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FlightError } from '../core/errors.js';

type State=Awaited<ReturnType<BrowserContext['storageState']>>;
const tripHost=(host:string)=>host==='trip.com'||host.endsWith('.trip.com');
export function tripOnlyState(state:State):State {
  return {
    cookies:state.cookies.filter(cookie=>tripHost(cookie.domain.replace(/^\./,''))),
    origins:state.origins.filter(origin=>{try{return tripHost(new URL(origin.origin).hostname);}catch{return false;}}),
  };
}
export class SessionStore {
  constructor(readonly path:string){}
  async load():Promise<State|undefined> {
    try {
      const state=JSON.parse(await readFile(this.path,'utf8')) as State;
      if(!Array.isArray(state.cookies)||!Array.isArray(state.origins))throw new Error('Invalid state shape');
      return tripOnlyState(state);
    } catch(error) {
      if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;
      throw new FlightError('SESSION_UNAVAILABLE','Cannot read saved Trip.com session; run the login command to create it again.');
    }
  }
  async save(context:BrowserContext):Promise<void> {
    const state=tripOnlyState(await context.storageState({indexedDB:true}));
    await mkdir(dirname(this.path),{recursive:true});
    const temporary=`${this.path}.${randomUUID()}.tmp`;
    try {await writeFile(temporary,JSON.stringify(state),{mode:0o600});await rename(temporary,this.path);}
    finally {await rm(temporary,{force:true});}
  }
}

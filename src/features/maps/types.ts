import type { MapPoint } from './coordinates'
export interface TripMapProps { points:MapPoint[]; selectedId?:string; onSelect?:(id:string)=>void; locale:'zh'|'en'; orderLine?:boolean; flightLines?:MapPoint[][]; mapKey:string }

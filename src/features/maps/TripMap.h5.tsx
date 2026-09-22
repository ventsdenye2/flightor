import { useEffect, useRef, useState } from 'react'
import { Text, View } from '@tarojs/components'
import type { Map as LeafletMap } from 'leaflet'
import type { TripMapProps } from './types'
import { tripText } from '../../i18n/trip'
import { request } from '../../utils/request'
import 'leaflet/dist/leaflet.css'
import './map.scss'
let serial=0
export default function TripMap({points,selectedId,onSelect,locale,orderLine,flightLines=[],mapKey}:TripMapProps){
 const id=useRef(`trip-leaflet-${++serial}`),map=useRef<LeafletMap>(),[failed,setFailed]=useState(false),[ready,setReady]=useState(false)
 const select=useRef(onSelect);select.current=onSelect
 const signature=JSON.stringify([points,selectedId,flightLines,mapKey])
 useEffect(()=>{
  let active=true,loaded=0,timer:ReturnType<typeof setTimeout>|undefined
  setFailed(false);setReady(false)
  if(!points.length)return
  void Promise.all([import('leaflet'),request<{tileUrl:string}>({url:'/v1/map-config',retry:0})]).then(([L,config])=>{
   const host=document.getElementById(id.current)
   if(!active||!host)return
   if(!/^https:\/\//.test(config.tileUrl))throw Error('Invalid map tile URL')
   const instance=L.map(host,{zoomControl:true,attributionControl:true,scrollWheelZoom:false});map.current=instance
   L.tileLayer(config.tileUrl,{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>'})
    .on('tileload',()=>{loaded++;if(active)setReady(true)}).addTo(instance)
   for(const p of points){
    const marker=L.marker([p.latitude,p.longitude],{icon:L.divIcon({className:`trip-map-pin ${selectedId===p.id?'is-selected':''}`,html:String(p.number??'•'),iconSize:[28,28],iconAnchor:[14,14]}),title:p.name})
    const label=document.createElement('span');label.textContent=p.name
    marker.bindTooltip(label,{direction:'top',permanent:selectedId===p.id}).on('click',()=>select.current?.(p.id)).addTo(instance)
   }
   if(orderLine&&points.length>1)L.polyline(points.map(p=>[p.latitude,p.longitude]),{color:'#2563eb',dashArray:'5 7'}).addTo(instance)
   for(const line of flightLines)if(line.length>1)L.polyline(line.map(p=>[p.latitude,p.longitude]),{color:'#64748b',dashArray:'3 8'}).addTo(instance)
   instance.fitBounds(L.latLngBounds(points.map(p=>[p.latitude,p.longitude])),{padding:[28,28],maxZoom:15})
   timer=setTimeout(()=>{if(active&&!loaded){setFailed(true);instance.remove();map.current=undefined}},8000)
  }).catch(()=>{if(active)setFailed(true)})
  return()=>{active=false;if(timer)clearTimeout(timer);map.current?.remove();map.current=undefined}
 },[signature])
 if(!points.length||failed)return <Text className='ux-map-compact'>{tripText(locale,failed?'trip.mapUnavailable':'trip.mapUnresolved')}</Text>
 return <View className='trip-map-frame' data-coordinate-system='WGS84' data-map-ready={ready?'true':'false'}>
  <View id={id.current} className='trip-place-map' />
  {!ready?<Text className='trip-map-caption'>{tripText(locale,'trip.mapLoading')}</Text>:null}
  <Text className='trip-map-caption'>{tripText(locale,orderLine?'trip.mapOrder':'trip.mapOverviewNote')}</Text>
 </View>
}

import { useEffect, useRef, useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import { displayPoint } from './coordinates'
import type { TripMapProps } from './types'
import { tripText } from '../../i18n/trip'
import './map.scss'
declare global { namespace JSX { interface IntrinsicElements {
 'place-map': {key:string;id:string;className:string;payload:string;onMapfailure:()=>void;onMapready:()=>void;onSelectplace:(event:{detail:{markerId:number}})=>void}
} } }
export default function TripMap({points,selectedId,onSelect,locale,orderLine,flightLines=[],mapKey}:TripMapProps){
 const [failed,setFailed]=useState(false)
 const rendered=useRef(false)
 const id=`map-${mapKey.replace(/[^a-z0-9]/gi,'').slice(0,30)}`
 useEffect(()=>{setFailed(false);rendered.current=false;const timer=setTimeout(()=>{if(points.length&&!rendered.current)setFailed(true)},8000);return()=>clearTimeout(timer)},[mapKey,JSON.stringify(points)])
 const shown=points.map(p=>displayPoint(p,'GCJ02'))
 const markers=shown.map((p,index)=>({id:index+1,latitude:p.latitude,longitude:p.longitude,title:p.name,
  iconPath:'/assets/ui-experience/marker.png',width:p.id===selectedId?40:32,height:p.id===selectedId?50:40,
  label:{content:p.number?String(p.number):p.name,color:p.id===selectedId?'#1d4ed8':'#172f56',fontSize:12,anchorX:0,anchorY:4,borderWidth:0,borderColor:'#fff',borderRadius:0,bgColor:'#fff',padding:2,textAlign:'center' as const},
  callout:{content:p.name,display:p.id===selectedId?'ALWAYS' as const:'BYCLICK' as const,padding:8,borderRadius:6,color:'#172f56',fontSize:12,anchorX:0,anchorY:0,bgColor:'#fff',borderWidth:0,borderColor:'#fff',textAlign:'center' as const}}))
 const lines=[...(orderLine&&shown.length>1?[{points:shown,color:'#2563eb',width:3,dottedLine:true}]:[]),
  ...flightLines.filter(l=>l.length>1).map(l=>({points:l.map(p=>displayPoint(p,'GCJ02')),color:'#64748b',width:2,dottedLine:true}))]
 const bounds=shown.length===1?[{latitude:shown[0].latitude-.005,longitude:shown[0].longitude-.005},{latitude:shown[0].latitude+.005,longitude:shown[0].longitude+.005}]:shown
 if(!shown.length||failed)return <Text className='ux-map-compact'>{tripText(locale,failed?'trip.mapUnavailable':'trip.mapUnresolved')}</Text>
 return <View className='trip-map-frame' data-coordinate-system='GCJ02'>
  <place-map key={mapKey} id={id} className='trip-place-map' payload={JSON.stringify({markers,lines,bounds})}
   onMapfailure={()=>setFailed(true)} onMapready={()=>{rendered.current=true}}
   onSelectplace={e=>{const p=shown[Number(e.detail.markerId)-1];if(p)onSelect?.(p.id)}} />
  <Text className='trip-map-attribution'>© OpenStreetMap contributors · {tripText(locale,'trip.nativeMapCredit')}</Text>
  <Text className='trip-map-caption'>{tripText(locale,orderLine?'trip.mapOrder':'trip.mapOverviewNote')}</Text>
  <Button className='ux-text-button trip-map-hide' onClick={()=>setFailed(true)}>{tripText(locale,'trip.mapHide')}</Button>
 </View>
}

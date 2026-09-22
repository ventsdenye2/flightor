import { useEffect, useState } from 'react'
import { View, Text, Button, Map } from '@tarojs/components'
import { hasCoordinates, mapViewportPoints } from './presentation'
import type { Activity, TripDay } from './presentation'
import { Photo, Icon } from './VisualMedia'
import { tripText } from '../../i18n/trip'
import TripMap from '../maps/TripMap'

export function DayPlan({ day, dayNumber, onActivity, onAdjust, imageError = false, locale = 'zh', published = false }: {
  day: TripDay; dayNumber: number; onActivity: (activity: Activity) => void; onAdjust: () => void; imageError?: boolean
  locale?: 'zh' | 'en'; published?: boolean
}) {
  const tt = (key: string, params?: Record<string, string | number>) => tripText(locale, key, params)
  const [mapError, setMapError] = useState(false)
  const [selectedId,setSelectedId]=useState<string>()
  useEffect(()=>setSelectedId(undefined),[day.id])
  const select=(activity:Activity)=>{setSelectedId(activity.id);onActivity(activity)}
  useEffect(() => setMapError(false), [day.id])
  const located = day.activities.map((activity, index) => ({ activity, index })).filter(({ activity }) => hasCoordinates(activity))
  const points = located.map(({ activity }) => ({ latitude: activity.latitude!, longitude: activity.longitude! }))
  const markers = located.map(({ activity: a, index }) => ({
    id: index + 1, latitude: a.latitude!, longitude: a.longitude!, title: a.name,
    iconPath: '/assets/ui-experience/marker.png', width: 32, height: 40,
    label: { content: String(index + 1), color: '#FFFFFF', fontSize: 14, anchorX: -4, anchorY: -31, x: 0, y: 0, borderWidth: 0, borderColor: '#2563eb', borderRadius: 0, bgColor: 'transparent', padding: 0, textAlign: 'center' as const }
  }))
  return <View className='ux-day-content'>
    <View className='ux-day-heading'><Text className='ux-day-title'>D{dayNumber} {day.title}</Text><Text className='ux-muted'>{day.subtitle || tt('trip.stops', { n: day.activities.length })}</Text></View>
    {published ? <TripMap points={located.map(({activity,index})=>({id:activity.id,name:activity.name,latitude:activity.latitude!,longitude:activity.longitude!,countryCode:activity.place?.countryCode??'',number:index+1,kind:activity.place?.kind}))}
      selectedId={selectedId} onSelect={id=>{const activity=day.activities.find(a=>a.id===id);if(activity)select(activity)}} locale={locale} orderLine mapKey={String(day.id)} /> : points.length ? <View className='ux-map-frame'>
      <Map key={day.id} id={`day-map-${day.id}`} className='ux-city-map'
        latitude={points[0].latitude} longitude={points[0].longitude} scale={14} markers={markers} includePoints={mapViewportPoints(points)}
        polyline={points.length > 1 ? [{ points, color: '#2563eb', width: 3, dottedLine: true }] : []}
        onError={() => setMapError(true)}
        onMarkerTap={event => { const activity = day.activities[Number(event.detail.markerId) - 1]; if (activity) onActivity(activity) }} />
      {mapError ? <Text className='ux-map-caption'>{tt('trip.mapUnavailable')}</Text> : null}
      <Text className='ux-map-caption'>{tt('trip.mapOrder')}</Text>
    </View> : null}
    {located.length < day.activities.length ? <Text className='ux-map-caption'>{tt(located.length ? 'trip.mapPartial' : 'trip.mapPending')}</Text> : null}
    <View className='ux-timeline'>
      {day.activities.map((activity, i) => <Button key={activity.id} className={`ux-activity ${selectedId===activity.id?'is-map-selected':''}`} data-activity-id={activity.id} onClick={() => select(activity)} ariaLabel={tt('trip.viewActivity', { name: activity.name })}>
        <View className='ux-timeline-time'><Text className='ux-number'>{i + 1}</Text><Text>{activity.time || tt('trip.flexible')}</Text></View>
        {activity.media?.src || !published ? <Photo src={activity.media?.src} description={activity.media?.description || tt('trip.photoPending')} className='ux-thumbnail' forceError={imageError} retry={false} /> : null}
        <View className='ux-activity-copy'><Text className='ux-activity-name'>{activity.name}</Text><Text className='ux-activity-summary'>{activity.summary}</Text>{published?<Text className='ux-place-status'>{tt(activity.place?.status==='resolved'?`trip.place.${activity.place.kind}`:`trip.place.${activity.place?.status??'unresolved'}`)}</Text>:null}{activity.media?.atmosphere ? <Text className='ux-photo-label'>图片为氛围参考</Text> : null}</View>
        <Icon name='chevron-right' className='ux-activity-chevron' />
      </Button>)}
    </View>
    {!day.activities.length ? <View className='ux-empty'><Icon name='compass' /><Text className='ux-section-title'>{tt('trip.freeDay')}</Text><Text className='ux-muted'>{tt('trip.freeDayHint')}</Text></View> : null}
    <Button className='ux-primary' onClick={onAdjust}>{published ? tt('trip.adjustDay') : '调整这一天'}</Button>
    <Text className='ux-daily-note'>{published ? tt('trip.slotNote') : '时间为游玩安排示例，开放情况与交通待确认。'}</Text>
  </View>
}

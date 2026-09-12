import { useEffect, useState } from 'react'
import { View, Text, Button, Map } from '@tarojs/components'
import type { Activity, TripDay } from './fixtures'
import { media, photoDescriptions } from './media'
import { Photo, Icon } from './VisualMedia'

export function DayPlan({ day, onActivity, onAdjust, imageError = false }: {
  day: TripDay; onActivity: (activity: Activity) => void; onAdjust: () => void; imageError?: boolean
}) {
  const [mapError, setMapError] = useState(false)
  useEffect(() => setMapError(false), [day.id])
  const points = day.activities.map(a => ({ latitude: a.latitude, longitude: a.longitude }))
  const markers = day.activities.map((a, index) => ({
    id: index + 1, latitude: a.latitude, longitude: a.longitude, title: a.name,
    iconPath: '/assets/ui-experience/marker.png', width: 32, height: 40,
    label: { content: String(index + 1), color: '#FFFFFF', fontSize: 14, anchorX: -4, anchorY: -31, x: 0, y: 0, borderWidth: 0, borderColor: '#087F8C', borderRadius: 0, bgColor: 'transparent', padding: 0, textAlign: 'center' as const }
  }))
  return <View className='ux-day-content'>
    <View className='ux-day-heading'><Text className='ux-day-title'>D{day.id} {day.title}</Text><Text className='ux-muted'>{day.activities.length ? `${day.activities.length} 个停留 · ${day.id === 2 ? '轻松' : day.subtitle}` : day.subtitle}</Text></View>
    {points.length ? <View className='ux-map-frame'>
      <Map key={day.id} id={`day-map-${day.id}`} className='ux-city-map'
        latitude={points[0].latitude} longitude={points[0].longitude} scale={14} markers={markers} includePoints={points}
        polyline={points.length > 1 ? [{ points, color: '#087F8C', width: 3, dottedLine: true }] : []}
        onError={() => setMapError(true)}
        onMarkerTap={event => { const activity = day.activities[Number(event.detail.markerId) - 1]; if (activity) onActivity(activity) }} />
      {mapError ? <Text className='ux-map-caption'>地图暂不可用，仍可通过下方日程查看。</Text> : null}
      <Text className='ux-map-caption'>游玩顺序示意 · 非导航路线</Text>
    </View> : null}
    <View className='ux-timeline'>
      {day.activities.map((activity, i) => <Button key={activity.id} className='ux-activity' onClick={() => onActivity(activity)} ariaLabel={`查看${activity.name}`}>
        <View className='ux-timeline-time'><Text className='ux-number'>{i + 1}</Text><Text>{activity.time}</Text></View>
        <Photo src={media[activity.photo]} description={photoDescriptions[activity.photo]} className='ux-thumbnail' forceError={imageError} retry={false} />
        <View className='ux-activity-copy'><Text className='ux-activity-name'>{activity.name}</Text><Text className='ux-activity-summary'>{activity.summary}</Text>{activity.photo === 'hero' || activity.photo === 'sunset' ? <Text className='ux-photo-label'>图片为城市氛围参考</Text> : null}</View>
        <Icon name='chevron-right' className='ux-activity-chevron' />
      </Button>)}
    </View>
    {!day.activities.length ? <View className='ux-empty'><Icon name='compass' /><Text className='ux-section-title'>这一天，先留一点空白</Text><Text className='ux-muted'>喜欢的地方，可以再多待一会儿。</Text><Button className='ux-text-button' onClick={onAdjust}>挑一个想去的地方<Icon name='arrow-right' /></Button></View> : null}
    <Button className='ux-primary' onClick={onAdjust}>调整这一天</Button>
    <Text className='ux-daily-note'>时间为游玩安排示例，开放情况与交通待确认。</Text>
  </View>
}

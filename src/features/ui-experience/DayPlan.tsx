import { useEffect, useState } from 'react'
import { View, Text, Button, Map } from '@tarojs/components'
import { hasCoordinates, mapViewportPoints } from './presentation'
import type { Activity, TripDay } from './presentation'
import { Photo, Icon } from './VisualMedia'

export function DayPlan({ day, dayNumber, onActivity, onAdjust, imageError = false }: {
  day: TripDay; dayNumber: number; onActivity: (activity: Activity) => void; onAdjust: () => void; imageError?: boolean
}) {
  const [mapError, setMapError] = useState(false)
  useEffect(() => setMapError(false), [day.id])
  const located = day.activities.map((activity, index) => ({ activity, index })).filter(({ activity }) => hasCoordinates(activity))
  const points = located.map(({ activity }) => ({ latitude: activity.latitude!, longitude: activity.longitude! }))
  const markers = located.map(({ activity: a, index }) => ({
    id: index + 1, latitude: a.latitude!, longitude: a.longitude!, title: a.name,
    iconPath: '/assets/ui-experience/marker.png', width: 32, height: 40,
    label: { content: String(index + 1), color: '#FFFFFF', fontSize: 14, anchorX: -4, anchorY: -31, x: 0, y: 0, borderWidth: 0, borderColor: '#2563eb', borderRadius: 0, bgColor: 'transparent', padding: 0, textAlign: 'center' as const }
  }))
  return <View className='ux-day-content'>
    <View className='ux-day-heading'><Text className='ux-day-title'>D{dayNumber} {day.title}</Text><Text className='ux-muted'>{day.subtitle || `${day.activities.length} 个停留`}</Text></View>
    {points.length ? <View className='ux-map-frame'>
      <Map key={day.id} id={`day-map-${day.id}`} className='ux-city-map'
        latitude={points[0].latitude} longitude={points[0].longitude} scale={14} markers={markers} includePoints={mapViewportPoints(points)}
        polyline={points.length > 1 ? [{ points, color: '#2563eb', width: 3, dottedLine: true }] : []}
        onError={() => setMapError(true)}
        onMarkerTap={event => { const activity = day.activities[Number(event.detail.markerId) - 1]; if (activity) onActivity(activity) }} />
      {mapError ? <Text className='ux-map-caption'>地图暂不可用，仍可通过下方日程查看。</Text> : null}
      <Text className='ux-map-caption'>游玩顺序示意 · 非导航路线</Text>
    </View> : null}
    {located.length < day.activities.length ? <Text className='ux-map-caption'>{located.length ? '部分地点坐标待确认，地图仅标注已提供坐标的停留。' : '地点坐标待确认，先通过下方日程查看。'}</Text> : null}
    <View className='ux-timeline'>
      {day.activities.map((activity, i) => <Button key={activity.id} className='ux-activity' onClick={() => onActivity(activity)} ariaLabel={`查看${activity.name}`}>
        <View className='ux-timeline-time'><Text className='ux-number'>{i + 1}</Text><Text>{activity.time || '待定'}</Text></View>
        <Photo src={activity.media?.src} description={activity.media?.description || '图片待补充'} className='ux-thumbnail' forceError={imageError} retry={false} />
        <View className='ux-activity-copy'><Text className='ux-activity-name'>{activity.name}</Text><Text className='ux-activity-summary'>{activity.summary}</Text>{activity.media?.atmosphere ? <Text className='ux-photo-label'>图片为氛围参考</Text> : null}</View>
        <Icon name='chevron-right' className='ux-activity-chevron' />
      </Button>)}
    </View>
    {!day.activities.length ? <View className='ux-empty'><Icon name='compass' /><Text className='ux-section-title'>当天暂无活动</Text><Text className='ux-muted'>可以添加想去的地点，或保留自由活动时间。</Text><Button className='ux-text-button' onClick={onAdjust}>挑一个想去的地方<Icon name='arrow-right' /></Button></View> : null}
    <Button className='ux-primary' onClick={onAdjust}>调整这一天</Button>
    <Text className='ux-daily-note'>时间为游玩安排示例，开放情况与交通待确认。</Text>
  </View>
}

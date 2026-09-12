import { View, Text } from '@tarojs/components'
import type { ArtifactEnvelope } from '../../services/artifactService'
import { ArtifactCard } from './ArtifactCard'
import { displayGuideTime, displayLocation, firstText, numberValue, record, records } from './payload'
import './TravelGuideCard.scss'

export interface TravelGuideCardProps {
  artifact: ArtifactEnvelope
  onAction?: () => void
}

export function TravelGuideCard({ artifact, onAction }: TravelGuideCardProps) {
  const payload = record(artifact.payload)
  if (!payload) return null
  const days = records(payload.days, 60)
  const firstDay = days[0]
  const firstCity = firstDay ? displayLocation(firstDay.city) : undefined
  const itemCount = days.reduce((total, day) => total + records(day.items, 6).length, 0)
  return (
    <ArtifactCard
      artifact={artifact}
      accent='guide'
      label='TRAVEL GUIDE'
      title={firstCity ? `Guide · ${firstCity}` : 'Travel guide'}
      summary={`${days.length} day${days.length === 1 ? '' : 's'} · ${itemCount} sourced item${itemCount === 1 ? '' : 's'}`}
      actionLabel={onAction ? 'Open itinerary outline' : undefined}
      onAction={onAction}
    >
      <View className='artifact-guide__days'>
        {days.slice(0, 3).map((day, index) => {
          const dayNumber = numberValue(day.day)
          const city = displayLocation(day.city)
          const items = records(day.items, 6)
          return (
            <View key={`${dayNumber ?? index}-${city ?? 'day'}`} className='artifact-guide__day'>
              <View className='artifact-guide__day-head'>
                <Text className='artifact-guide__day-label'>{dayNumber !== undefined ? `DAY ${dayNumber}` : 'DAY'}</Text>
                <Text className='artifact-guide__city'>{city ?? 'City not provided'}</Text>
              </View>
              {firstText(day.theme) ? <Text className='artifact-guide__theme'>{firstText(day.theme)}</Text> : null}
              {items.slice(0, 2).map((item, itemIndex) => (
                <Text key={firstText(item.id) ?? `${firstText(item.title) ?? 'item'}-${itemIndex}`} className='artifact-guide__item'>
                  {displayGuideTime(item.timeOfDay) ? `${displayGuideTime(item.timeOfDay)} · ` : ''}{firstText(item.title) ?? 'Activity title unavailable'}
                </Text>
              ))}
              {firstText(day.notes) ? <Text className='artifact-guide__more'>{firstText(day.notes)}</Text> : null}
              {items.length === 0 && !firstText(day.notes) ? <Text className='artifact-guide__item'>No activity details returned.</Text> : null}
            </View>
          )
        })}
        {days.length > 3 && <Text className='artifact-guide__more'>Showing 3 of {days.length} returned days</Text>}
      </View>
    </ArtifactCard>
  )
}

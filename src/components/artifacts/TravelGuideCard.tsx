import { View, Text } from '@tarojs/components'
import type { ArtifactEnvelope } from '../../services/artifactService'
import { ArtifactCard } from './ArtifactCard'
import { displayGuideTime, displayLocation, displaySupportingEvidence, displayTravelGuideBudget, firstText, numberValue, record, records } from './payload'
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
  const budget = displayTravelGuideBudget(payload.budget)
  const evidence = displaySupportingEvidence(payload.supportingEvidence)
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
      {budget ? <View className='artifact-guide__budget'><Text className='artifact-guide__section-title'>全程预算约束</Text><Text className='artifact-guide__budget-value'>{budget.label} · {budget.currency} {budget.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}</Text><Text className='artifact-guide__caption'>行程总额 · 同行人数口径未指定</Text></View> : null}
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
      {evidence.length ? <View className='artifact-guide__evidence'><Text className='artifact-guide__section-title'>实用与补充信息</Text>{evidence.map(item => <View key={`${item.sourceArtifactId}-${item.sourceFindingId}`} className='artifact-guide__evidence-item'><Text className='artifact-guide__evidence-title'>{item.title}</Text><Text className='artifact-guide__evidence-copy'>{item.description}</Text><Text className='artifact-guide__caption'>{item.category} · {item.verification === 'verified' ? '已核验' : item.verification === 'partial' ? '部分核验' : item.verification === 'stale' ? '资料已过期' : '待核验'}{item.destinations.length ? ` · ${item.destinations.join('、')}` : ''}</Text></View>)}</View> : null}
    </ArtifactCard>
  )
}

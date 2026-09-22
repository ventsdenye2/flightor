import { View, Text } from '@tarojs/components'
import { observer } from 'mobx-react-lite'
import { localeStore, t } from '../../i18n'
import type { ArtifactEnvelope } from '../../services/artifactService'
import { ArtifactCard } from './ArtifactCard'
import { displayTravelGuidePublication, record, records, text, numberValue } from './payload'
import './TravelGuideCard.scss'

export interface TravelGuideCardProps { artifact: ArtifactEnvelope; onAction?: () => void }
export const TravelGuideCard = observer(function TravelGuideCard({ artifact, onAction }: TravelGuideCardProps) {
  const payload = record(artifact.payload)
  if (!payload) return null
  const publication = displayTravelGuidePublication(payload.publication, artifact.id)
  const state = !publication || publication.legacy || !publication.status ? 'legacy'
    : publication.locale !== localeStore.locale ? 'preparing' : publication.status === 'blocked'
      ? publication.failureKind === 'retryable' ? 'retryable' : 'revision_required' : publication.status
  const accepted = state === 'accepted'
  return <ArtifactCard artifact={artifact} accent='guide' label={t('trip.days')}
    title={t(`trip.${state}`)} summary={accepted ? publication?.overview : undefined}
    actionLabel={onAction ? t('trip.details') : undefined} onAction={onAction}>
    {accepted ? <View className='artifact-guide__days'>{records(payload.days, 60).slice(0, 3).map((day, index) => <View key={numberValue(day.day) ?? index} className='artifact-guide__day'>
      <Text className='artifact-guide__day-label'>{t('trip.day', { n: numberValue(day.day) ?? index + 1 })}</Text>
      <Text className='artifact-guide__theme'>{text(day.theme)}</Text>
      {records(day.items, 6).slice(0, 2).map(item => <View key={text(item.id)} className='artifact-guide__item'><Text>{text(item.title)}</Text><Text className='artifact-guide__item-copy'>{text(item.description)}</Text></View>)}
    </View>)}</View> : <Text className='artifact-guide__item'>{t(state === 'revision_required' ? 'trip.revisionHint' : state === 'retryable' ? 'trip.retryableHint' : state === 'legacy' ? 'trip.legacyHint' : 'trip.preparingHint')}</Text>}
  </ArtifactCard>
})

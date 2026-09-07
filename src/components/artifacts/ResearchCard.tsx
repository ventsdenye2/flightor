import { View, Text } from '@tarojs/components'
import type { ArtifactEnvelope } from '../../services/artifactService'
import { ArtifactCard } from './ArtifactCard'
import { displayLocation, firstText, numberValue, record, records } from './payload'
import './ResearchCard.scss'

export interface ResearchCardProps {
  artifact: ArtifactEnvelope
  onAction?: () => void
}

export function ResearchCard({ artifact, onAction }: ResearchCardProps) {
  const payload = record(artifact.payload)
  if (!payload) return null
  const findings = records(payload.findings, 50)
  const first = findings[0]
  const summary = first ? firstText(first.summary) : undefined
  return (
    <ArtifactCard
      artifact={artifact}
      accent='research'
      label='RESEARCH'
      title={firstText(first?.title) ?? 'Research brief'}
      summary={`${findings.length} finding${findings.length === 1 ? '' : 's'}${numberValue(payload.queryCount) !== undefined ? ` · ${numberValue(payload.queryCount)} queries` : ''}`}
      actionLabel={onAction ? 'Review research' : undefined}
      onAction={onAction}
    >
      {summary && <Text className='artifact-research__summary'>{summary}</Text>}
      {findings.length > 0 && (
        <View className='artifact-research__findings'>
          {findings.slice(0, 3).map((finding, index) => {
            const destinations = records(finding.destinations, 12).map(displayLocation).filter((value): value is string => value !== undefined)
            const sources = records(finding.sources, 20)
            return (
              <View key={firstText(finding.id) ?? `${firstText(finding.title) ?? 'finding'}-${index}`} className='artifact-research__finding'>
                <View className='artifact-research__finding-head'>
                  <Text className='artifact-research__title'>{firstText(finding.title) ?? 'Untitled finding'}</Text>
                  <Text className='artifact-research__count'>{sources.length} source{sources.length === 1 ? '' : 's'}</Text>
                </View>
                {destinations.length > 0 && <Text className='artifact-research__locations'>{destinations.join(' · ')}</Text>}
                {firstText(finding.summary) && <Text className='artifact-research__body'>{firstText(finding.summary)}</Text>}
              </View>
            )
          })}
          {findings.length > 3 && <Text className='artifact-research__more'>Showing 3 of {findings.length} returned findings</Text>}
        </View>
      )}
    </ArtifactCard>
  )
}

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
  return (
    <ArtifactCard
      artifact={artifact}
      accent='research'
      label='研究资料'
      title='来源资料引用'
      summary={`${findings.length} 条来源资料${numberValue(payload.queryCount) !== undefined ? ` · ${numberValue(payload.queryCount)} 次查询` : ''}`}
      actionLabel={onAction ? '查看研究资料' : undefined}
      onAction={onAction}
    >
      {findings.length > 0 && (
        <View className='artifact-research__findings'>
          {findings.slice(0, 3).map((finding, index) => {
            const destinations = records(finding.destinations, 12).map(displayLocation).filter((value): value is string => value !== undefined)
            const sources = records(finding.sources, 20).map(source => {
              const url = safeSourceUrl(firstText(source.url, source.reference))
              return {
                // A title without a validated URL is not shown as a source
                // fact; it could be generated venue prose or a spoofed label.
                title: url ? (firstText(source.title, source.documentTitle, source.name) ?? '来源资料标题（未核实适用性）') : '来源资料不可用',
                url,
              }
            })
            return (
              <View key={firstText(finding.id) ?? `finding-${index}`} className='artifact-research__finding'>
                <View className='artifact-research__finding-head'>
                  <Text className='artifact-research__title'>来源资料标题（未核实适用性）</Text>
                  <Text className='artifact-research__count'>{sources.length} 条来源</Text>
                </View>
                {destinations.length > 0 && <Text className='artifact-research__locations'>{destinations.join(' · ')}</Text>}
                {sources.length > 0 ? sources.slice(0, 4).map((source, sourceIndex) => <View key={`${source.url ?? source.title}-${sourceIndex}`}><Text className='artifact-research__body'>{source.title}</Text><Text className='artifact-research__caption'>{source.url ?? '来源 URL 不可用 · 状态未知'}</Text></View>) : <Text className='artifact-research__body'>来源资料不可用 · 状态未知</Text>}
              </View>
            )
          })}
          {findings.length > 3 && <Text className='artifact-research__more'>显示 {findings.length} 条来源资料中的前 3 条</Text>}
        </View>
      )}
    </ArtifactCard>
  )
}

function safeSourceUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const parsed = new URL(value)
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password && parsed.hostname) return parsed.href
  } catch { /* malformed source URLs stay unknown */ }
  return undefined
}

import { Button, View, Text } from '@tarojs/components'
import type { ReactNode } from 'react'
import type { ArtifactEnvelope } from '../../services/artifactService'
import './ArtifactCard.scss'

export interface ArtifactCardProps {
  artifact: ArtifactEnvelope
  accent?: 'flight' | 'research' | 'route' | 'guide'
  title: string
  label: string
  summary?: string
  children?: ReactNode
  actionLabel?: string
  onAction?: () => void
}

export function ArtifactCard({ artifact, accent = 'flight', title, label, summary, children, actionLabel, onAction }: ArtifactCardProps) {
  return (
    <View className={`artifact-card artifact-card--${accent}`}>
      <View className='artifact-card__head'>
        <View>
          <Text className='artifact-card__label'>{label}</Text>
          <Text className='artifact-card__title'>{title}</Text>
        </View>
        <Text className='artifact-card__version'>v{artifact.schemaVersion}</Text>
      </View>
      {summary && <Text className='artifact-card__summary'>{summary}</Text>}
      {children}
      {actionLabel && onAction && (
        <View className='artifact-card__actions'>
          <Button className='artifact-card__action' hoverClass='artifact-card__action--pressed' ariaLabel={actionLabel} onClick={onAction}>
            <Text>{actionLabel}</Text>
          </Button>
        </View>
      )}
      <Text className='artifact-card__provenance'>结果编号 · {artifact.id.slice(0, 12)}</Text>
    </View>
  )
}

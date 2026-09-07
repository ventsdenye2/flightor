import { View, Text } from '@tarojs/components'
import type { ArtifactEnvelope } from '../../services/artifactService'
import './UnavailableArtifactCard.scss'

export interface UnavailableArtifactCardProps {
  artifact?: Pick<ArtifactEnvelope, 'id' | 'type' | 'schemaVersion'>
  reason?: string
  onRetry?: () => void
}

export function UnavailableArtifactCard({ artifact, reason = 'This artifact version is not available in this client.', onRetry }: UnavailableArtifactCardProps) {
  return (
    <View className='artifact-unavailable'>
      <View className='artifact-unavailable__head'>
        <Text className='artifact-unavailable__label'>ARTIFACT UNAVAILABLE</Text>
        {artifact && <Text className='artifact-unavailable__version'>{artifact.type} · v{artifact.schemaVersion}</Text>}
      </View>
      <Text className='artifact-unavailable__body'>{reason}</Text>
      {onRetry && (
        <View className='artifact-unavailable__retry' hoverClass='tap-dim' onClick={onRetry} role='button' aria-label='Retry loading artifact'>
          <Text>Retry</Text>
        </View>
      )}
    </View>
  )
}

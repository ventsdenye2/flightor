import { useEffect, useState } from 'react'
import { observer } from 'mobx-react-lite'
import { localeStore } from '../../i18n'
import { View, Text } from '@tarojs/components'
import type { ArtifactRefLike, ArtifactEnvelope, ArtifactFetchContext } from '../../services/artifactService'
import { ArtifactSessionChangedError, artifactService } from '../../services/artifactService'
import { ArtifactRenderer } from './ArtifactRenderer'
import { UnavailableArtifactCard } from './UnavailableArtifactCard'
import './ArtifactTimelineItem.scss'

export interface ArtifactTimelineItemProps {
  artifactRef: ArtifactRefLike
  ownerId?: string
  sessionId?: string
  onAction?: (artifact: ArtifactEnvelope) => void
}

type LoadState = { status: 'loading' } | { status: 'ready'; artifact: ArtifactEnvelope } | { status: 'error'; message: string }

function errorMessage(error: unknown): string {
  if (error instanceof ArtifactSessionChangedError) return 'Session changed; this artifact was not applied.'
  if (error instanceof Error && error.message) return error.message
  return 'Artifact could not be loaded.'
}

export const ArtifactTimelineItem = observer(function ArtifactTimelineItem({ artifactRef, ownerId, sessionId, onAction }: ArtifactTimelineItemProps) {
  const locale = localeStore.locale
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    const context: ArtifactFetchContext = { ownerId, sessionId, locale }
    setState({ status: 'loading' })
    artifactService.fetchArtifact(artifactRef.id, context)
      .then(artifact => { if (active) setState({ status: 'ready', artifact }) })
      .catch(error => { if (active) setState({ status: 'error', message: errorMessage(error) }) })
    return () => { active = false }
  }, [artifactRef.id, ownerId, sessionId, attempt, locale])

  if (state.status === 'loading') {
    return <View className='artifact-timeline__loading' role='status'><Text>Loading artifact…</Text></View>
  }
  if (state.status === 'error') {
    return <UnavailableArtifactCard reason={state.message} onRetry={() => setAttempt(value => value + 1)} />
  }
  return <ArtifactRenderer artifact={state.artifact} onAction={() => onAction?.(state.artifact)} />
})

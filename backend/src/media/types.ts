import type { Place, PlaceHint } from '../places/types.js'

export interface MediaTarget { hint: PlaceHint; place?: Place; blocked?: boolean }
export interface PlacePhoto {
  src: string
  title: string
  width: number
  height: number
  source: { label: string; url: string; author: string; license: string; licenseUrl: string }
  entityUrl: string
  placeId?: string
  association: 'resolved_place' | 'source_activity'
  retrievedAt: string
}
export interface MediaResult {
  status: 'ready' | 'empty' | 'unavailable'
  reason: string
  checkedAt: string
  photos: PlacePhoto[]
}
export interface MediaEnrichment {
  contentVersion: string
  activities: Record<string, { media: (PlacePhoto & { candidates: PlacePhoto[] }) | null; mediaStatus: MediaResult['status'] }>
}
export interface MediaProvider { search(target: MediaTarget, signal: AbortSignal): Promise<MediaResult> }

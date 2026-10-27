import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import { PlannerPage } from './PlannerPage'
import { ExplorePage } from './ExplorePage'
import type { ExploreItem } from './exploreSamples'
import type { FlightSearchDataset } from './flightSamples'
import { selectTripCover } from './presentation'
import type { MediaPresentation, TripPresentation } from './presentation'
import type { ConversationClient, GenerateTrip, PlaceMediaLoader, PlaceLocationLoader, SavedTripSummary } from './backendClient'
import {TripLibrary} from './TripLibrary'
import { FlightExplorer } from './FlightExplorer'
import { ProfilePage } from './ProfilePage'
import { AlertsPage, CollectionsPage, TripsPage } from './LibraryPages'
import type { PriceAlert } from './LibraryPages'
import TripExperience from './TripExperience'
import { Icon } from './VisualMedia'
import './experience.scss'
import './shared.scss'

export type MainSection = 'plan' | 'explore' | 'trips' | 'profile'
export type PreviewPage = MainSection | 'trip' | 'flights' | 'collections' | 'alerts'
type Overlay = Exclude<PreviewPage, MainSection> | 'inspiration'
export interface AppExperienceProps {
  conversationClient?: ConversationClient
  loadPlaceMedia?: PlaceMediaLoader
  loadPlaceLocation?: PlaceLocationLoader
  onGenerate?: GenerateTrip
  trip: TripPresentation
  searchDataset: FlightSearchDataset
  exploreItems: ExploreItem[]
  imageError?: boolean
  requestedPage?: PreviewPage
  navigationVersion?: number
  onOpenSource?: (url: string) => void
}
export default function AppExperience(props: AppExperienceProps) {
  // A different trip identity starts an independent preview session.
  return <ExperienceSession key={props.trip.id} {...props} />
}
function ExperienceSession({ trip: sourceTrip, searchDataset, exploreItems, imageError = false, requestedPage = 'plan', navigationVersion = 0, onOpenSource, onGenerate, conversationClient, loadPlaceMedia, loadPlaceLocation }: AppExperienceProps) {
  const [generatedTrip, setGeneratedTrip] = useState<TripPresentation | null>(null)
  const baseTrip = generatedTrip || sourceTrip
  const [resolvedCover, setResolvedCover] = useState<{ tripId: string; media: MediaPresentation } | null>(null)
  const [tripCovers, setTripCovers] = useState<Record<string,MediaPresentation>>({})
  const selectedCover = selectTripCover(baseTrip)
  const cover = selectedCover?.src ? selectedCover : resolvedCover?.tripId === baseTrip.id ? resolvedCover.media : selectedCover
  const trip = cover === baseTrip.cover ? baseTrip : { ...baseTrip, cover }
  const onCoverResolved = useCallback((media: MediaPresentation) => {
    setResolvedCover(current => current?.tripId === baseTrip.id && current.media === media ? current : { tripId: baseTrip.id, media })
    setTripCovers(current => current[baseTrip.id] === media ? current : {...current,[baseTrip.id]:media})
    conversationClient?.rememberTripCover?.(baseTrip.id,media)
  }, [baseTrip.id,conversationClient])
  const generate: GenerateTrip | undefined = onGenerate ? async (message, progress, signal) => {
    const result = await onGenerate(message, progress, signal)
    if (!signal.aborted) setGeneratedTrip(result)
    return result
  } : undefined
  const [section, setSection] = useState<MainSection>('plan')
  const [overlayStack, setOverlayStack] = useState<Overlay[]>([])
  const overlay = overlayStack[overlayStack.length - 1] || null
  const [tripOpened, setTripOpened] = useState(false)
  const [tripSaved, setTripSaved] = useState(false)
  const [archived, setArchived] = useState(false)
  const [savedIds, setSavedIds] = useState<string[]>([])
  const [alerts, setAlerts] = useState<PriceAlert[]>([])
  const [prompt, setPrompt] = useState({ text: '', revision: 0 })
  const [conversationRevision, setConversationRevision] = useState(0)
  const [sessionRevision, setSessionRevision] = useState(0)
  const [restoringContext, setRestoringContext] = useState(false)
  const [contextError, setContextError] = useState('')
  const contextRequest = useRef(0)
  const contextPending = useRef(false)
  useEffect(() => conversationClient?.subscribe?.(() => {
    setConversationRevision(value => value + 1)
    setSessionRevision(value => value + 1)
    setPrompt(current => ({ text: '', revision: current.revision + 1 }))
  }), [conversationClient])
  useEffect(() => () => { contextRequest.current++ }, [])
  const [inspirationId, setInspirationId] = useState('')
  const [largeText, setLargeText] = useState(false)
  const nextAlertId = useRef(1)
  const showOverlay = (page: Overlay) => setOverlayStack(current => current[current.length - 1] === page ? current : [...current, page])
  const closeOverlay = () => setOverlayStack(current => current.slice(0, -1))
  const openTrip = () => { setTripOpened(true); showOverlay('trip') }
  const navigate = (page: PreviewPage) => {
    if (contextPending.current) {
      contextRequest.current++; contextPending.current = false; setRestoringContext(false); conversationClient?.reset()
    }
    if (page === 'trip') { openTrip(); return }
    if (page === 'flights' || page === 'collections' || page === 'alerts') showOverlay(page)
    else { setSection(page); setOverlayStack([]) }
  }
  useEffect(() => { navigate(requestedPage) }, [requestedPage, navigationVersion])
  const toggleItem = (id: string) => setSavedIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  const planWith = (text: string) => { setPrompt(current => ({ text, revision: current.revision + 1 })); navigate('plan') }
  const continueTrip = async () => {
    if (restoringContext) return
    const version = ++contextRequest.current
    contextPending.current = true
    setRestoringContext(true); setContextError('')
    try {
      if (trip.provenance === 'dsh') {
        if (!conversationClient?.resumeTrip) throw Error('这段行程暂时无法恢复原对话。')
        await conversationClient.resumeTrip(trip.id)
      }
      if (version === contextRequest.current) { contextPending.current = false; planWith(`我想继续调整${trip.destination}的行程。`) }
    } catch (error) {
      if (version === contextRequest.current) setContextError(error instanceof Error ? error.message : '原对话恢复失败，请重试。')
    } finally { if (version === contextRequest.current) { contextPending.current = false; setRestoringContext(false) } }
  }
  const openSavedTrip = async (entry: SavedTripSummary) => {
    if (!conversationClient?.loadTrip) throw Error('行程服务暂时不可用。')
    const version = ++contextRequest.current
    contextPending.current = true
    try {
      const savedTrip = await conversationClient.loadTrip(entry.id)
      if (version !== contextRequest.current) return
      if (entry.contextAvailable) await conversationClient.resumeTrip!(entry.id)
      else conversationClient.reset()
      if (version !== contextRequest.current) return
      contextPending.current = false; setGeneratedTrip(savedTrip); setContextError(''); openTrip()
    } finally { if (version === contextRequest.current) contextPending.current = false }
  }
  const newTrip = () => { conversationClient?.reset(); planWith('') }
  const openInspiration = (id: string) => { setInspirationId(id); showOverlay('inspiration') }
  const visible = (page: PreviewPage | Overlay) => overlay ? overlay === page : section === page
  const savedItems = exploreItems.filter(item => savedIds.includes(item.id)).map(item => ({ id: item.id, title: item.title, subtitle: item.subtitle, photo: item.photo, photoDescription: item.photoDescription }))
  return <View className={`ux-app ${largeText ? 'is-comfortable' : ''}`}>
    <View className='ux-screen' style={{ display: visible('plan') ? 'flex' : 'none' }}><PlannerPage trip={trip} key={`${prompt.revision}-${conversationRevision}`} initialPrompt={prompt.text} onOpenTrip={openTrip} onSearchFlights={() => navigate('flights')} onGenerate={generate} conversationClient={conversationClient} onTrip={setGeneratedTrip} onOpenSource={onOpenSource} /></View>
    <View className='ux-screen' style={{ display: visible('explore') ? 'flex' : 'none' }}><ExplorePage items={exploreItems} onPlan={planWith} savedIds={savedIds} onToggleSave={toggleItem} onOpenSource={onOpenSource} /></View>
    <View className='ux-screen' style={{ display: visible('trips') ? 'flex' : 'none' }}>{conversationClient?.listTrips ? <TripLibrary client={conversationClient} active={visible('trips')} version={trip.id} covers={tripCovers} onOpen={openSavedTrip} onPlan={newTrip}/> : <TripsPage trip={trip} onOpenTrip={openTrip} onPlan={newTrip} archived={archived} onArchive={setArchived} />}</View>
    <View className='ux-screen' style={{ display: visible('profile') ? 'flex' : 'none' }}><ProfilePage savedCount={savedItems.length + Number(tripSaved)} alertCount={alerts.length} onCollections={() => navigate('collections')} onAlerts={() => navigate('alerts')} onTrips={() => navigate('trips')} onPlan={planWith} largeText={largeText} onTextSizeChange={setLargeText} onClearLibrary={() => { setSavedIds([]); setTripSaved(false) }} /></View>
    {tripOpened ? <View className='ux-screen' style={{ display: visible('trip') ? 'flex' : 'none' }}><TripExperience trip={trip} active={visible('trip')} contextError={contextError} restoringContext={restoringContext} onCoverResolved={onCoverResolved} loadPlaceMedia={loadPlaceMedia} loadPlaceLocation={loadPlaceLocation} imageError={imageError} embedded onBack={closeOverlay} onContinuePlanning={continueTrip} saved={tripSaved} onSavedChange={setTripSaved} onOpenSource={onOpenSource} /></View> : null}
    {overlayStack.includes('flights') ? <View className='ux-screen' style={{ display: visible('flights') ? 'flex' : 'none' }}><FlightExplorer key={sessionRevision} client={conversationClient} onConversationChange={() => setConversationRevision(value => value + 1)} searchDataset={searchDataset} onBack={closeOverlay} onOpenTrip={openTrip} onCreateAlert={alert => {
      const id = nextAlertId.current++
      setAlerts(current => {
        const existing = current.find(item => item.route === alert.route && item.date === alert.date)
        return existing ? current.map(item => item.id === existing.id ? { ...item, ...alert, active: true } : item) : [...current, { ...alert, id, active: true }]
      })
    }} /></View> : null}
    {overlayStack.includes('collections') ? <View className='ux-screen' style={{ display: visible('collections') ? 'flex' : 'none' }}><CollectionsPage trip={trip} savedTrip={tripSaved} items={savedItems} onBack={closeOverlay} onOpenTrip={openTrip} onOpenItem={openInspiration} onToggleTrip={() => setTripSaved(value => !value)} onToggleItem={toggleItem} onExplore={() => navigate('explore')} /></View> : null}
    {overlayStack.includes('alerts') ? <View className='ux-screen' style={{ display: visible('alerts') ? 'flex' : 'none' }}><AlertsPage alerts={alerts} onBack={closeOverlay} onSearch={() => navigate('flights')} onUpdate={alert => setAlerts(current => current.map(item => item.id === alert.id ? alert : item))} onRemove={id => setAlerts(current => current.filter(item => item.id !== id))} onRestore={alert => setAlerts(current => current.some(item => item.id === alert.id) ? current : [...current, alert])} /></View> : null}
    {overlayStack.includes('inspiration') ? <View className='ux-screen' style={{ display: visible('inspiration') ? 'flex' : 'none' }}><ExplorePage items={exploreItems} key={inspirationId} initialItemId={inspirationId} onBack={closeOverlay} onPlan={planWith} savedIds={savedIds} onToggleSave={toggleItem} onOpenSource={onOpenSource} /></View> : null}
    <View className='ux-bottom-nav' ariaLabel='主导航'>{([{ id: 'plan', icon: 'home', label: '规划' }, { id: 'explore', icon: 'compass', label: '探索' }, { id: 'trips', icon: 'calendar', label: '行程' }, { id: 'profile', icon: 'user', label: '我的' }] as const).map(item => { const active = overlay === 'trip' ? item.id === 'trips' : item.id === section; return <Button key={item.id} className={active ? 'is-active' : ''} aria-pressed={active} onClick={() => navigate(item.id)}><Icon name={`${item.icon}${active ? '-active' : ''}`} /><Text>{item.label}</Text></Button> })}</View>
  </View>
}

import { useEffect, useRef, useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import { PlannerPage } from './PlannerPage'
import { ExplorePage } from './ExplorePage'
import type { ExploreItem } from './exploreSamples'
import type { FlightSearchDataset } from './flightSamples'
import type { TripPresentation } from './presentation'
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
  trip: TripPresentation
  searchDataset: FlightSearchDataset
  exploreItems: ExploreItem[]
  imageError?: boolean
  requestedPage?: PreviewPage
  initialTripTab?: 'overview' | 'days' | 'flights'
  navigationVersion?: number
  onOpenSource?: (url: string) => void
}
export default function AppExperience(props: AppExperienceProps) {
  // A different trip identity starts an independent preview session.
  return <ExperienceSession key={props.trip.id} {...props} />
}
function ExperienceSession({ trip, searchDataset, exploreItems, imageError = false, requestedPage = 'plan', navigationVersion = 0, onOpenSource, initialTripTab }: AppExperienceProps) {
  const [section, setSection] = useState<MainSection>('plan')
  const [overlayStack, setOverlayStack] = useState<Overlay[]>([])
  const overlay = overlayStack[overlayStack.length - 1] || null
  const [tripOpened, setTripOpened] = useState(false)
  const [tripSaved, setTripSaved] = useState(false)
  const [archived, setArchived] = useState(false)
  const [savedIds, setSavedIds] = useState<string[]>([])
  const [alerts, setAlerts] = useState<PriceAlert[]>([])
  const [prompt, setPrompt] = useState({ text: '', revision: 0 })
  const [inspirationId, setInspirationId] = useState('')
  const [largeText, setLargeText] = useState(false)
  const nextAlertId = useRef(1)
  const showOverlay = (page: Overlay) => setOverlayStack(current => current[current.length - 1] === page ? current : [...current, page])
  const closeOverlay = () => setOverlayStack(current => current.slice(0, -1))
  const openTrip = () => { setTripOpened(true); showOverlay('trip') }
  const navigate = (page: PreviewPage) => {
    if (page === 'trip') { openTrip(); return }
    if (page === 'flights' || page === 'collections' || page === 'alerts') showOverlay(page)
    else { setSection(page); setOverlayStack([]) }
  }
  useEffect(() => { navigate(requestedPage) }, [requestedPage, navigationVersion])
  const toggleItem = (id: string) => setSavedIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  const planWith = (text: string) => { setPrompt(current => ({ text, revision: current.revision + 1 })); navigate('plan') }
  const openInspiration = (id: string) => { setInspirationId(id); showOverlay('inspiration') }
  const visible = (page: PreviewPage | Overlay) => overlay ? overlay === page : section === page
  const savedItems = exploreItems.filter(item => savedIds.includes(item.id)).map(item => ({ id: item.id, title: item.title, subtitle: item.subtitle, photo: item.photo, photoDescription: item.photoDescription }))
  return <View className={`ux-app ${largeText ? 'is-comfortable' : ''}`}>
    <View className='ux-screen' style={{ display: visible('plan') ? 'flex' : 'none' }}><PlannerPage trip={trip} key={prompt.revision} initialPrompt={prompt.text} onOpenTrip={openTrip} onSearchFlights={() => navigate('flights')} /></View>
    <View className='ux-screen' style={{ display: visible('explore') ? 'flex' : 'none' }}><ExplorePage items={exploreItems} onPlan={planWith} savedIds={savedIds} onToggleSave={toggleItem} onOpenSource={onOpenSource} /></View>
    <View className='ux-screen' style={{ display: visible('trips') ? 'flex' : 'none' }}><TripsPage trip={trip} onOpenTrip={openTrip} onPlan={() => planWith('')} archived={archived} onArchive={setArchived} /></View>
    <View className='ux-screen' style={{ display: visible('profile') ? 'flex' : 'none' }}><ProfilePage savedCount={savedItems.length + Number(tripSaved)} alertCount={alerts.length} onCollections={() => navigate('collections')} onAlerts={() => navigate('alerts')} onTrips={() => navigate('trips')} onPlan={planWith} largeText={largeText} onTextSizeChange={setLargeText} onClearLibrary={() => { setSavedIds([]); setTripSaved(false) }} /></View>
    {tripOpened ? <View className='ux-screen' style={{ display: visible('trip') ? 'flex' : 'none' }}><TripExperience initialTab={initialTripTab} trip={trip} imageError={imageError} embedded onBack={closeOverlay} saved={tripSaved} onSavedChange={setTripSaved} onOpenSource={onOpenSource} /></View> : null}
    {overlayStack.includes('flights') ? <View className='ux-screen' style={{ display: visible('flights') ? 'flex' : 'none' }}><FlightExplorer searchDataset={searchDataset} onBack={closeOverlay} onOpenTrip={openTrip} onCreateAlert={alert => {
      const id = nextAlertId.current++
      setAlerts(current => {
        const existing = current.find(item => item.route === alert.route && item.date === alert.date)
        return existing ? current.map(item => item.id === existing.id ? { ...item, ...alert, active: true } : item) : [...current, { ...alert, id, active: true }]
      })
    }} /></View> : null}
    {overlayStack.includes('collections') ? <View className='ux-screen' style={{ display: visible('collections') ? 'flex' : 'none' }}><CollectionsPage trip={trip} savedTrip={tripSaved} items={savedItems} onBack={closeOverlay} onOpenTrip={openTrip} onOpenItem={openInspiration} onToggleTrip={() => setTripSaved(value => !value)} onToggleItem={toggleItem} onExplore={() => navigate('explore')} /></View> : null}
    {overlayStack.includes('alerts') ? <View className='ux-screen' style={{ display: visible('alerts') ? 'flex' : 'none' }}><AlertsPage alerts={alerts} onBack={closeOverlay} onSearch={() => navigate('flights')} onUpdate={alert => setAlerts(current => current.map(item => item.id === alert.id ? alert : item))} onRemove={id => setAlerts(current => current.filter(item => item.id !== id))} onRestore={alert => setAlerts(current => current.some(item => item.id === alert.id) ? current : [...current, alert])} /></View> : null}
    {overlayStack.includes('inspiration') ? <View className='ux-screen' style={{ display: visible('inspiration') ? 'flex' : 'none' }}><ExplorePage items={exploreItems} key={inspirationId} initialItemId={inspirationId} onBack={closeOverlay} onPlan={planWith} savedIds={savedIds} onToggleSave={toggleItem} onOpenSource={onOpenSource} /></View> : null}
    <View className='ux-bottom-nav' ariaLabel='主导航'>{([{ id: 'plan', icon: 'home', label: '规划' }, { id: 'explore', icon: 'compass', label: '探索' }, { id: 'trips', icon: 'calendar', label: '行程' }, { id: 'profile', icon: 'user', label: '我的' }] as const).map(item => <Button key={item.id} className={(overlay === 'trip' ? item.id === 'trips' : item.id === section) ? 'is-active' : ''} aria-pressed={overlay === 'trip' ? item.id === 'trips' : item.id === section} onClick={() => navigate(item.id)}><Icon name={item.icon} /><Text>{item.label}</Text></Button>)}</View>
  </View>
}

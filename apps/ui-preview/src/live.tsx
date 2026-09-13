import { Suspense, lazy, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useLiveRoute } from './taro-live'
import ProductionTabBar from '../../../src/components/navigation/ProductionTabBar'
import type { ProductionSection } from '../../../src/components/navigation/ProductionTabBar'
import '../../../src/app.scss'
import './live.css'

const Plan = lazy(() => import('../../../src/pages/plan'))
const Route = lazy(() => import('../../../src/pages/route'))
const Trips = lazy(() => import('../../../src/pages/trips'))
const Explore = lazy(() => import('../../../src/pages/explore'))
const Profile = lazy(() => import('../../../src/pages/profile'))
const FlightSearch = lazy(() => import('../../../src/pages/index'))
const FlightResults = lazy(() => import('../../../src/pages/search'))
const PriceAlert = lazy(() => import('../../../src/subpages/price-alert'))
const About = lazy(() => import('../../../src/subpages/about'))
function Live() {
  const route = useLiveRoute().split('?')[0]
  const [notice, setNotice] = useState('')
  const section: ProductionSection = route === '/pages/explore/index' ? 'explore' : route === '/pages/trips/index' || route === '/pages/route/index' ? 'trips' : route === '/pages/profile/index' || route.startsWith('/subpages/') ? 'profile' : 'plan'
  useEffect(() => { let timer: ReturnType<typeof setTimeout>; const show = (event: Event) => { setNotice((event as CustomEvent).detail); clearTimeout(timer); timer = setTimeout(() => setNotice(''), 3500) }; window.addEventListener('flightor-notice', show); return () => { clearTimeout(timer); window.removeEventListener('flightor-notice', show) } }, [])
  return <main className='live-shell'><header className='live-banner'>FlightOR · 本地真实 API · 测试身份</header><section className='live-page'><Suspense fallback={<p>正在加载…</p>}>{route === '/pages/plan/index' ? <Plan /> : route === '/pages/route/index' ? <Route /> : route === '/pages/trips/index' ? <Trips /> : route === '/pages/profile/index' ? <Profile /> : route === '/pages/explore/index' ? <Explore /> : route === '/pages/index/index' ? <FlightSearch /> : route === '/pages/search/index' ? <FlightResults /> : route === '/subpages/price-alert/index' ? <PriceAlert /> : route === '/subpages/about/index' ? <About /> : <p>这个页面暂不支持网页预览，请在微信开发者工具中打开。</p>}</Suspense></section><ProductionTabBar embedded selected={section} />{notice && <div role='status' className='live-notice'>{notice}</div>}</main>
}
createRoot(document.getElementById('root')!).render(<Live />)

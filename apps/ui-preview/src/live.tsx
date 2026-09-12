import { Suspense, lazy, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Taro, { useLiveRoute } from './taro-live'
import { Icon } from '../../../src/features/ui-experience/VisualMedia'
import '../../../src/app.scss'
import './live.css'

const Plan = lazy(() => import('../../../src/pages/plan'))
const Route = lazy(() => import('../../../src/pages/route'))
const Trips = lazy(() => import('../../../src/pages/trips'))
const Explore = lazy(() => import('../../../src/pages/explore'))
const Profile = lazy(() => import('../../../src/pages/profile'))
function Live() {
  const route = useLiveRoute().split('?')[0]
  const [notice, setNotice] = useState('')
  useEffect(() => { let timer: ReturnType<typeof setTimeout>; const show = (event: Event) => { setNotice((event as CustomEvent).detail); clearTimeout(timer); timer = setTimeout(() => setNotice(''), 3500) }; window.addEventListener('flightor-notice', show); return () => { clearTimeout(timer); window.removeEventListener('flightor-notice', show) } }, [])
  return <main className='live-shell'><header className='live-banner'>FlightOR · 本地真实 API · 测试身份</header><section className='live-page'><Suspense fallback={<p>正在加载…</p>}>{route === '/pages/plan/index' ? <Plan /> : route === '/pages/route/index' ? <Route /> : route === '/pages/trips/index' ? <Trips /> : route === '/pages/profile/index' ? <Profile /> : route === '/pages/explore/index' ? <Explore /> : <p>此验收入口暂未包含该页面。请从下方返回规划或我的行程。</p>}</Suspense></section><nav className='live-nav'>{[['plan', '规划', 'home'], ['explore', '探索', 'compass'], ['trips', '行程', 'calendar'], ['profile', '我的', 'user']].map(([page, label, icon]) => <button aria-current={route.includes('/' + page + '/') ? 'page' : undefined} key={page} onClick={() => Taro.switchTab({ url: `/pages/${page}/index` })}><Icon name={icon} /><span>{label}</span></button>)}</nav>{notice && <div role='status' className='live-notice'>{notice}</div>}</main>
}
createRoot(document.getElementById('root')!).render(<Live />)

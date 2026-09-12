import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import AppExperience from '../../../src/features/ui-experience/AppExperience'
import type { PreviewPage } from '../../../src/features/ui-experience/AppExperience'
import './style.css'

type Scenario = 'ready' | 'partial' | 'image-error' | 'connection'
const scenarios: Array<{ id: Scenario; label: string }> = [
  { id: 'ready', label: '完整行程' }, { id: 'partial', label: '部分结果' },
  { id: 'image-error', label: '图片失败' }, { id: 'connection', label: '复杂中转' },
]

function Preview() {
  const [navigation, setNavigation] = useState<{ page: PreviewPage; revision: number }>({ page: 'plan', revision: 0 })
  const [scenario, setScenario] = useState<Scenario>('ready')
  const [revision, setRevision] = useState(0)
  const [notice, setNotice] = useState('')
  const [controlsOpen, setControlsOpen] = useState(() => window.matchMedia('(min-width: 761px)').matches)
  useEffect(() => {
    const media = window.matchMedia('(min-width: 761px)')
    const resize = () => setControlsOpen(media.matches)
    media.addEventListener('change', resize)
    return () => media.removeEventListener('change', resize)
  }, [])
  const notify = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 2600) }
  return <div className="preview-shell">
    <aside className="inspector" aria-label="预览控制台">
      <p className="eyebrow">FlightOR / 界面预览</p><h1>每一页，同一种节奏。</h1>
      <p className="muted">规划、探索与旅程，沿着一套美术语言展开。所有内容为交互样例。</p>
      <button className="inspector-toggle" aria-expanded={controlsOpen} onClick={() => setControlsOpen(!controlsOpen)}>状态场景<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d={controlsOpen ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} fill="none" stroke="currentColor" strokeWidth="2" /></svg></button>
      {controlsOpen ? <div className="inspector-controls">
        <p className="inspector-label">页面入口</p><div className="page-list" role="group" aria-label="页面入口">{([{ id: 'plan', label: '规划' }, { id: 'explore', label: '探索' }, { id: 'trips', label: '行程列表' }, { id: 'profile', label: '我的' }, { id: 'trip', label: '旅行详情' }, { id: 'flights', label: '航班搜索' }, { id: 'collections', label: '收藏' }, { id: 'alerts', label: '价格提醒' }] as const).map(item => <button key={item.id} onClick={() => setNavigation(current => ({ page: item.id, revision: current.revision + 1 }))}>{item.label}</button>)}</div>
        <p className="inspector-label">旅行详情状态</p>
        <div className="scenario-list" role="group" aria-label="状态场景">
          {scenarios.map((item) => <button key={item.id} className={scenario === item.id ? 'active' : ''} onClick={() => { setScenario(item.id); setNavigation(current => ({ page: 'trip', revision: current.revision + 1 })) }}>{item.label}</button>)}
        </div>
        <button className="reset" onClick={() => { setRevision((value) => value + 1); notify('已重置当前预览') }}>重置预览</button>
      </div> : null}
      {notice && <p className="notice" role="status">{notice}</p>}
    </aside>
    <main className="phone-stage"><div className="phone-frame"><AppExperience key={revision} scenario={scenario} requestedPage={navigation.page} navigationVersion={navigation.revision} onOpenSource={(url) => { if (/^https:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer') }} /></div></main>
  </div>
}

createRoot(document.getElementById('root')!).render(<StrictMode><Preview /></StrictMode>)

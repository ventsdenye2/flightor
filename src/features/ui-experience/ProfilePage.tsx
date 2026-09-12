import { useState } from 'react'
import { Button, Input, Text, View } from '@tarojs/components'
import { Icon, Photo } from './VisualMedia'
import { media } from './media'
import { DemoNote, MenuRow, PageHeader, SectionHeading, Sheet } from './SharedUI'
import './profile.scss'

type ProfileView = 'home' | 'preferences' | 'settings' | 'about' | 'privacy'
export function ProfilePage({ savedCount, alertCount, onCollections, onAlerts, onTrips, onPlan, largeText, onTextSizeChange, onClearLibrary }: {
  savedCount: number; alertCount: number; onCollections: () => void; onAlerts: () => void; onTrips: () => void; onPlan: (prompt: string) => void; largeText: boolean; onTextSizeChange: (value: boolean) => void; onClearLibrary: () => void
}) {
  const [page, setPage] = useState<ProfileView>('home')
  const [dialog, setDialog] = useState<'login' | 'name' | 'logout' | 'clear' | null>(null)
  const [signedIn, setSignedIn] = useState(false)
  const [name, setName] = useState('旅行者')
  const [draftName, setDraftName] = useState('旅行者')
  const [origin, setOrigin] = useState('上海')
  const [pace, setPace] = useState('轻松一点')
  const [interests, setInterests] = useState(['城市漫步', '当地美食'])
  const [savedPreferences, setSavedPreferences] = useState({ origin: '上海', pace: '轻松一点', interests: ['城市漫步', '当地美食'] })
  const [notice, setNotice] = useState('')
  const changePage = (next: ProfileView) => {
    if (next === 'preferences') { setOrigin(savedPreferences.origin); setPace(savedPreferences.pace); setInterests(savedPreferences.interests) }
    setPage(next); setNotice('')
  }
  const titles: Record<ProfileView, string> = { home: '我的', preferences: '旅行偏好', settings: '设置', about: '关于 FlightOR', privacy: '隐私与数据' }
  return <><PageHeader title={titles[page]} onBack={page === 'home' ? undefined : () => changePage(page === 'privacy' ? 'settings' : 'home')} action={page === 'home' ? <Button className='ux-icon-button' ariaLabel='打开设置' onClick={() => changePage('settings')}><Icon name='settings' /></Button> : undefined} />
    <View className='ux-scroll' key={page}>
      {page === 'home' ? <>
        <View className='pr-identity'><View className='pr-avatar'><Icon name='user' /></View><View><Text className='ui-display'>{signedIn ? name : '你好，旅行者'}</Text><Text className='ux-muted'>{signedIn ? '演示账户 · 仅本次预览' : '把喜欢的旅行方式，留在这里。'}</Text><Button className='ux-text-button' onClick={() => { setDraftName(name); setDialog(signedIn ? 'name' : 'login') }}>{signedIn ? '编辑昵称' : '登录与同步'}<Icon name='chevron-right' /></Button></View></View>
        <View className='pr-shortcuts'><Button onClick={onTrips}><Icon name='calendar' /><Text>我的行程</Text><Text className='ux-caption'>继续安排</Text></Button><Button onClick={onCollections}><Icon name='bookmark' /><Text>我的收藏</Text><Text className='ux-caption'>{savedCount} 项心动</Text></Button><Button onClick={onAlerts}><Icon name='bell' /><Text>价格提醒</Text><Text className='ux-caption'>{alertCount} 条设定</Text></Button></View>
        <View className='ui-page pr-home-body'><SectionHeading title='旅行，可以更像你' /><View className='pr-preference-card'><View><Text className='ux-section-title'>按自己的节奏出发</Text><Text className='ux-muted'>{savedPreferences.pace} · {savedPreferences.interests.length ? savedPreferences.interests.slice(0, 2).join(' · ') : '探索新体验'}</Text><Button className='ux-text-button' onClick={() => changePage('preferences')}>编辑旅行偏好<Icon name='arrow-right' /></Button></View><Icon name='compass' /></View>
          <MenuRow icon='settings' title='设置' description='阅读字号、预览数据' onClick={() => changePage('settings')} />
          <MenuRow icon='info' title='关于 FlightOR' description='让每次出发都有自己的节奏' onClick={() => changePage('about')} />
          <DemoNote text='当前为界面预览。收藏、偏好和账户状态仅在本次预览保留。' />
        </View>
      </> : page === 'preferences' ? <View className='ui-page'>
        <Text className='ui-display'>你喜欢怎样旅行？</Text><Text className='ux-muted'>随时可以修改，不必一次选完。</Text>
        <View className='ui-form-field'><Text>常用出发城市</Text><Input ariaLabel='常用出发城市' value={origin} maxlength={30} onInput={event => setOrigin(event.detail.value)} /></View>
        <SectionHeading title='一天的节奏' /><View className='ui-pill-list'>{['轻松一点', '刚刚好', '多看一些'].map(item => <Button key={item} className={`ui-pill ${pace === item ? 'is-active' : ''}`} aria-pressed={pace === item} onClick={() => setPace(item)}>{item}</Button>)}</View>
        <SectionHeading title='让你心动的事' caption='可以多选' /><View className='ui-pill-list'>{['城市漫步', '当地美食', '海岸风景', '历史建筑', '自然徒步', '艺术展馆'].map(item => <Button key={item} className={`ui-pill ${interests.includes(item) ? 'is-active' : ''}`} aria-pressed={interests.includes(item)} onClick={() => setInterests(current => current.includes(item) ? current.filter(value => value !== item) : [...current, item])}>{item}</Button>)}</View>
        <View className='pr-preferences-actions'><Button className='ux-primary' disabled={!origin.trim()} onClick={() => { setSavedPreferences({ origin: origin.trim(), pace, interests }); setNotice('旅行偏好已保留在本次预览中') }}>保存偏好</Button><Button className='ux-text-button' disabled={!origin.trim()} onClick={() => onPlan(`从${origin.trim()}出发，想安排一次${pace}的旅行${interests.length ? `，喜欢${interests.join('、')}` : ''}。`)}>用这些偏好开始规划<Icon name='arrow-right' /></Button></View>
        {notice ? <View className='ui-inline-notice' role='status'>{notice}</View> : null}<DemoNote text='偏好用于填入规划想法；当前不向服务器提交。' />
      </View> : page === 'settings' ? <View className='ui-page'>
        <SectionHeading title='阅读与显示' /><View className='pr-setting-line'><Text>界面语言</Text><Text className='ux-muted'>简体中文</Text></View><Text className='ui-helper'>本版界面采用中文，其他语言版本待补充。</Text>
        <SectionHeading title='内容字号' /><View className='ui-pill-list'>{[{ value: false, label: '标准' }, { value: true, label: '舒适' }].map(item => <Button key={item.label} className={`ui-pill ${largeText === item.value ? 'is-active' : ''}`} aria-pressed={largeText === item.value} onClick={() => onTextSizeChange(item.value)}>{item.label}</Button>)}</View><Text className='pr-type-sample'>下一次出发，留一点时间给自己。</Text>
        <SectionHeading title='账户与数据' /><MenuRow icon='info' title='隐私与数据' description='查看本预览如何处理你的输入' onClick={() => changePage('privacy')} /><MenuRow icon='bookmark' title='清空本次收藏' description='清空后可以继续添加' onClick={() => setDialog('clear')} />
        {signedIn ? <Button className='ux-text-button ui-danger pr-logout' onClick={() => setDialog('logout')}>退出演示账户</Button> : <Button className='ux-text-button pr-logout' onClick={() => setDialog('login')}>查看登录界面</Button>}
        {notice ? <View className='ui-inline-notice' role='status'>{notice}</View> : null}<DemoNote text='显示设置仅作用于当前预览。刷新页面会恢复默认状态。' />
      </View> : page === 'privacy' ? <View className='ui-page pr-prose'><Text className='ui-display'>你的输入，如何使用</Text><SectionHeading title='保留在当前界面' /><Text>旅行想法、昵称、偏好、收藏和提醒设置保存在页面的运行状态中，刷新或重置预览后清除。没有真实登录、云端同步或通知订阅。</Text><SectionHeading title='在线内容' /><Text>行程地图会向地图服务请求在线底图。打开图片或景点来源时，将访问对应的第三方网站；旅行想法和偏好不会随链接发送。</Text><SectionHeading title='正式服务接入前' /><Text>账户授权、数据保存与删除说明将在正式服务接入时提供。本页说明当前预览行为，不代替正式隐私政策。</Text></View> : <>
        <Photo src={media.hero} description='里斯本城市与河岸 · 氛围参考' className='pr-about-photo' />
        <View className='ui-page pr-prose'><View className='ux-wordmark'><Icon name='plane' /><Text>FlightOR</Text></View><Text className='ui-display pr-about-title'>远方很大，<Text className='pr-block'>按你的节奏出发。</Text></Text><Text>从一个旅行念头，到能慢慢调整的日程。把航班、去处和时间放在一起，让你看清选择，再决定下一步。</Text><SectionHeading title='有依据，也留余地' /><Text>来源、价格状态与未确认的信息都会跟随内容展示。示例不代表实时票价，收藏也不代表预订。</Text><SectionHeading title='当前版本' /><Text className='ux-muted'>UI Experience v1 · 手机优先界面预览</Text><Button className='ux-secondary pr-about-action' onClick={() => onPlan('想安排一次轻松的旅行。')}>开始一次规划</Button></View>
      </>}
    </View>
    {dialog ? <Sheet title={dialog === 'login' ? '把旅行，留在身边' : dialog === 'name' ? '怎么称呼你？' : dialog === 'logout' ? '退出演示账户' : '清空本次收藏'} onClose={() => setDialog(null)}>
      {dialog === 'login' ? <><Text className='ux-muted'>正式登录后可同步行程与偏好。</Text><View className='pr-login-illustration'><Icon name='user' /><Icon name='arrow-right' /><Icon name='calendar' /></View><Text className='ui-helper'>当前只展示登录前后的界面，不获取微信身份或手机号。</Text><Button className='ux-primary' onClick={() => { setSignedIn(true); setDialog(null) }}>体验登录后的界面</Button><Button className='ux-text-button pr-center-action' onClick={() => setDialog(null)}>继续以访客浏览</Button></> : dialog === 'name' ? <><View className='ui-form-field'><Text>昵称</Text><Input ariaLabel='旅行者昵称' value={draftName} maxlength={16} onInput={event => setDraftName(event.detail.value)} /></View><Button className='ux-primary' disabled={!draftName.trim()} onClick={() => { setName(draftName.trim()); setDialog(null) }}>保存昵称</Button></> : <><Text className='ux-muted'>{dialog === 'logout' ? '仅退出演示状态，当前预览的行程和收藏仍保留。' : '将清空本次预览里的行程和灵感收藏，行程内容不受影响。'}</Text><View className='ui-split-actions'><Button className='ux-secondary' onClick={() => setDialog(null)}>取消</Button><Button className='ux-primary' onClick={() => { if (dialog === 'logout') setSignedIn(false); else { onClearLibrary(); setNotice('已清空本次收藏') }; setDialog(null) }}>{dialog === 'logout' ? '退出' : '清空收藏'}</Button></View></>}
    </Sheet> : null}
  </>
}

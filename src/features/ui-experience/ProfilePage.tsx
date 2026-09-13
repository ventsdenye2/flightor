import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Image, Text, View } from '@tarojs/components'
import type { UserProfile } from '../../services/authService'
import type { Locale } from '../../i18n'
import { Icon } from './VisualMedia'
import { MenuRow, PageHeader, SectionHeading } from './SharedUI'
import './profile.scss'

interface CloudProfilePageProps {
  profile: UserProfile | null
  locale: Locale
  preferences: ReactNode
  onLogin: () => void
  onLogout: () => void
  onTrips: () => void
  onAlerts: () => void
  onPlan: () => void
  onLocaleChange: () => void
  onAbout: () => void
}

/** Account, language and preferences are provided by the real application stores. */
export function CloudProfilePage({ profile, locale, preferences, onLogin, onLogout, onTrips, onAlerts, onPlan, onLocaleChange, onAbout }: CloudProfilePageProps) {
  const [page, setPage] = useState<'home' | 'preferences' | 'settings'>('home')
  const en = locale === 'en'
  const titles = en ? { home: 'Profile', preferences: 'Travel preferences', settings: 'Settings' } : { home: '我的', preferences: '旅行偏好', settings: '设置' }
  const accountLabel = profile?.loginMethod === 'local'
    ? (en ? 'Local test account' : '本地测试账户')
    : profile?.loginMethod === 'mock'
      ? (en ? 'Demo account · cloud services unavailable' : '演示账户 · 云端服务不可用')
      : (en ? 'Your trips and preferences sync across devices.' : '旅行偏好与行程在设备间同步')
  return <>
    <PageHeader title={titles[page]} onBack={page === 'home' ? undefined : () => setPage('home')} action={page === 'home' ? <Button className='ux-icon-button' ariaLabel={en ? 'Open settings' : '打开设置'} onClick={() => setPage('settings')}><Icon name='settings' /></Button> : undefined} />
    <View className='ux-scroll'>
      {page === 'home' ? <>
        <View className='pr-identity'><View className='pr-avatar'>{profile?.avatarUrl ? <Image className='pr-cloud-avatar' src={profile.avatarUrl} mode='aspectFill' /> : <Icon name='user' />}</View><View><Text className='ui-display'>{profile ? profile.nickname || (en ? 'Traveler' : '旅行者') : (en ? 'Hello, traveler' : '你好，旅行者')}</Text><Text className='ux-muted'>{profile ? accountLabel : (en ? 'Keep your favorite way to travel here.' : '把喜欢的旅行方式，留在这里。')}</Text>{!profile ? <Button className='ux-text-button' onClick={onLogin}>{en ? 'Sign in & sync' : '登录与同步'}<Icon name='chevron-right' /></Button> : null}</View></View>
        <View className='pr-shortcuts'><Button onClick={onTrips}><Icon name='calendar' /><Text>{en ? 'My trips' : '我的行程'}</Text><Text className='ux-caption'>{en ? 'Pick up your plans' : '行程与对话'}</Text></Button><Button onClick={onAlerts}><Icon name='bell' /><Text>{en ? 'Price alerts' : '价格提醒'}</Text><Text className='ux-caption'>{en ? 'Routes you follow' : '关注的航线'}</Text></Button><Button onClick={onPlan}><Icon name='compass' /><Text>{en ? 'New journey' : '新的旅行'}</Text><Text className='ux-caption'>{en ? 'Start with an idea' : '从想法开始'}</Text></Button></View>
        <View className='ui-page pr-home-body'><SectionHeading title={en ? 'Travel, your way' : '旅行，可以更像你'} /><View className='pr-preference-card'><View><Text className='ux-section-title'>{en ? 'Set your own pace' : '按自己的节奏出发'}</Text><Text className='ux-muted'>{en ? 'Your usual starting point, interests and travel pace.' : '常用出发地、感兴趣的去处，以及舒服的旅行节奏。'}</Text><Button className='ux-text-button' onClick={profile ? () => setPage('preferences') : onLogin}>{profile ? (en ? 'Edit travel preferences' : '编辑旅行偏好') : (en ? 'Sign in to save preferences' : '登录后保存偏好')}<Icon name='arrow-right' /></Button></View><Icon name='compass' /></View>
          <MenuRow icon='settings' title={en ? 'Settings' : '设置'} description={en ? 'Language and account' : '界面语言、登录账户'} onClick={() => setPage('settings')} />
          <MenuRow icon='info' title={en ? 'About FlightOR' : '关于 FlightOR'} description={en ? 'Every journey at your own pace' : '让每次出发都有自己的节奏'} onClick={onAbout} />
        </View>
      </> : page === 'preferences' ? <View className='ui-page pr-cloud-preferences'>
        <Text className='ui-display'>{en ? 'How do you like to travel?' : '你喜欢怎样旅行？'}</Text><Text className='ux-muted'>{en ? 'Saved preferences can guide future trips. Each trip can still be different.' : '保存长期偏好，让下一次规划更了解你。每次旅行仍可随时调整。'}</Text>
        {!profile ? <Button className='ux-primary pr-cloud-login' onClick={onLogin}>{en ? 'Sign in to save preferences' : '登录后保存偏好'}</Button> : null}
      </View> : <View className='ui-page'>
        <SectionHeading title={en ? 'Reading & display' : '阅读与显示'} />
        <MenuRow icon='settings' title={en ? 'Interface language' : '界面语言'} value={locale === 'zh' ? '中文' : 'English'} description={en ? 'Change your preferred language' : '切换中文与 English'} onClick={onLocaleChange} />
        <SectionHeading title={en ? 'Account & saved plans' : '账户与行程'} />
        <MenuRow icon='calendar' title={en ? 'Trips and conversation history' : '行程与对话历史'} description={en ? 'Continue planning or view saved results' : '继续规划，查看保存的路线与结果'} onClick={onTrips} />
        <MenuRow icon='info' title={en ? 'About FlightOR' : '关于 FlightOR'} onClick={onAbout} />
        {profile ? <><Text className='ux-caption pr-cloud-account'>{accountLabel}</Text><Button className='ux-text-button ui-danger pr-logout' onClick={onLogout}>{en ? 'Sign out' : '退出登录'}</Button></> : <Button className='ux-primary pr-cloud-login' onClick={onLogin}>{en ? 'Sign in & sync' : '登录与同步'}</Button>}
      </View>}
      {profile ? <View className='pr-cloud-memory' style={{ display: page === 'preferences' ? 'block' : 'none' }}>{preferences}</View> : null}
    </View>
  </>
}

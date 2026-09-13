import { useState } from 'react'
import { View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { userStore } from '../../stores/userStore'
import LoginSheet from '../../components/common/LoginSheet'
import { MemoryEditor } from '../../components/profile/MemoryEditor'
import { useProductionTab } from '../../components/navigation/ProductionTabBar'
import { CloudProfilePage } from '../../features/ui-experience/ProfilePage'
import { chatStore } from '../../stores/chatStore'
import { localeStore, t } from '../../i18n'
import '../../features/ui-experience/experience.scss'
import './index.scss'

function ProfilePage() {
  useProductionTab('profile')
  const [showLogin, setShowLogin] = useState(false)
  const profile = userStore.profile
  return <View className='ux-app production-main-page profile-production'>
    <View className='ux-screen'><CloudProfilePage key={`${profile?.uid ?? 'guest'}:${userStore.sessionRevision}`} profile={profile} locale={localeStore.locale}
      preferences={profile ? <MemoryEditor key={`${profile.uid}:${userStore.sessionRevision}`} legacyCities={userStore.togo} /> : null}
      onLogin={() => setShowLogin(true)}
      onTrips={() => void Taro.switchTab({ url: '/pages/trips/index' })}
      onAlerts={() => void Taro.navigateTo({ url: '/subpages/price-alert/index' })}
      onPlan={() => { chatStore.reset(); void Taro.switchTab({ url: '/pages/plan/index' }) }}
      onLocaleChange={() => { localeStore.toggle(); ['tab.plan', 'tab.explore', 'tab.trips', 'tab.profile'].forEach((key, index) => { void Taro.setTabBarItem({ index, text: t(key) }) }) }}
      onAbout={() => void Taro.navigateTo({ url: '/subpages/about/index' })}
      onLogout={async () => { const en = localeStore.locale === 'en'; const result = await Taro.showModal({ title: en ? 'Sign out' : '退出登录', content: en ? 'Sign out on this device? Your cloud trips will be kept.' : '退出此设备的登录，云端行程仍会保留。' }); if (result.confirm) userStore.logout() }} /></View>
    <LoginSheet visible={showLogin} onClose={() => setShowLogin(false)} />
  </View>
}
export default observer(ProfilePage)

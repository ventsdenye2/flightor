import { useState } from 'react'
import { View, Text, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { userStore } from '../../stores/userStore'
import LoginSheet from '../../components/common/LoginSheet'
import { MemoryEditor } from '../../components/profile/MemoryEditor'
import { localeStore, t } from '../../i18n'
import './index.scss'

function ProfilePage() {
  const [showLogin, setShowLogin] = useState(false)
  const profile = userStore.profile
  return <View className='profile-page profile-cloud'>
    <View className='profile-page__user' onClick={() => !profile && setShowLogin(true)}>
      {profile?.avatarUrl ? <Image className='profile-page__avatar profile-page__avatar--img' src={profile.avatarUrl} mode='aspectFill' /> : <View className='profile-page__avatar'><Text>✈</Text></View>}
      <View><Text className='profile-page__name'>{profile ? profile.nickname || '旅行者' : '登录 FlightOR'}</Text><Text className='profile-cloud__muted'>{profile ? '旅行偏好与行程在设备间同步' : '登录后保存行程与旅行偏好'}</Text></View>
    </View>
    {profile && <MemoryEditor key={`${profile.uid}:${userStore.sessionRevision}`} legacyCities={userStore.togo} />}
    <View className='profile-cloud__section'>
      <View className='profile-cloud__link' onClick={() => Taro.switchTab({ url: '/pages/trips/index' })}>行程、保存的路线与对话历史 ›</View>
      <View className='profile-cloud__link' onClick={() => Taro.navigateTo({ url: '/subpages/price-alert/index' })}>价格提醒 ›</View>
      <View className='profile-cloud__link' onClick={() => { localeStore.toggle(); ['tab.plan', 'tab.explore', 'tab.trips', 'tab.profile'].forEach((key, index) => Taro.setTabBarItem({ index, text: t(key) })) }}>界面语言：{localeStore.locale === 'zh' ? '中文' : 'English'} ›</View>
      <View className='profile-cloud__link' onClick={() => Taro.navigateTo({ url: '/subpages/about/index' })}>关于 FlightOR ›</View>
    </View>
    {profile && <View className='profile-cloud__link profile-cloud__error' onClick={async () => { const result = await Taro.showModal({ title: '退出登录', content: '退出此设备的登录，云端行程仍会保留。' }); if (result.confirm) userStore.logout() }}>退出登录</View>}
    <LoginSheet visible={showLogin} onClose={() => setShowLogin(false)} />
  </View>
}
export default observer(ProfilePage)

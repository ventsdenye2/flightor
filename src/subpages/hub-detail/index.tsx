// subpages/hub-detail — 枢纽城市详情（分包）
import { useEffect } from 'react'
import { View, Text, Image } from '@tarojs/components'
import Taro, { useRouter, useShareAppMessage } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { getHubExperience } from '../../mocks/hubs'
import HubExperienceCard from '../../components/hub/HubExperienceCard'
import { searchStore } from '../../stores/searchStore'
import { t, localeStore } from '../../i18n'
import './index.scss'

function HubDetailPage() {
  const router = useRouter()
  const iata = router.params?.iata ?? 'SIN'
  const locale = localeStore.locale
  const hub = getHubExperience(iata, locale)

  useEffect(() => {
    Taro.setNavigationBarTitle({ title: t('nav.hubDetail') })
  }, [locale])

  useShareAppMessage(() => ({
    title: hub ? t('share.hub', { city: hub.city }) : t('share.explore'),
    path: `/subpages/hub-detail/index?iata=${iata}`
  }))

  if (!hub) {
    return (
      <View className='hub-detail hub-detail--empty'>
        <Text>{t('hd.none')}</Text>
      </View>
    )
  }

  return (
    <View className='hub-detail'>
      <View className='hub-detail__hero'>
        <Image className='hub-detail__hero-img' src={hub.coverImage} mode='aspectFill' />
        <View className='hub-detail__hero-mask'>
          <Text className='hub-detail__city'>{hub.city}</Text>
          <Text className='font-code hub-detail__iata'>{hub.iata}</Text>
        </View>
      </View>

      <View className='hub-detail__body'>
        {/* 完整体验卡（含全部停留时长方案） */}
        <HubExperienceCard hub={hub} layoverDuration={720} interests={searchStore.interests} />

        <View
          className='hub-detail__cta'
          hoverClass='tap-dim'
          onClick={() => {
            Taro.switchTab({ url: '/pages/index/index' })
          }}
        >
          <Text>{t('hd.searchVia', { city: hub.city })}</Text>
        </View>

        <View className='hub-detail__note'>
          <Text>{t('hd.note')}</Text>
        </View>
      </View>
    </View>
  )
}

export default observer(HubDetailPage)

// pages/index — 首页（搜索面板 + 热门航线 + 价格闪报）
import { useEffect } from 'react'
import { View, Text } from '@tarojs/components'
import Taro, { useShareAppMessage, useShareTimeline } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import DemoBadge from '../../components/common/DemoBadge'
import SearchPanel from '../../components/search/SearchPanel'
import { searchStore } from '../../stores/searchStore'
import { flightStore } from '../../stores/flightStore'
import { userStore } from '../../stores/userStore'
import { t, localeStore } from '../../i18n'
import type { SearchParams } from '../../types/flight'
import { humanDate } from '../../utils/format'
import './index.scss'

function IndexPage() {
  useEffect(() => {
    Taro.setNavigationBarTitle({ title: t('nav.index') })
  }, [localeStore.locale])

  useShareAppMessage(() => ({
    title: t('share.app'),
    path: '/pages/index/index'
  }))

  useShareTimeline(() => ({
    title: t('share.timeline'),
    query: 'from=timeline'
  }))

  const handleSearch = async (params: SearchParams) => {
    userStore.addHistory(params)
    flightStore.search(params) // 不阻塞跳转，结果页展示 loading
    Taro.navigateTo({ url: '/pages/search/index' })
  }

  return (
    <View className='index-page'>
      <DemoBadge />
      <SearchPanel onSearch={handleSearch} isLoading={flightStore.isLoading} />

      {/* 最近搜索 */}
      {userStore.history.length > 0 && (
        <View className='index-page__section'>
          <View className='index-page__section-header'>
            <Text className='index-page__section-title'>{t('index.recent')}</Text>
          </View>
          <View className='index-page__history'>
            {userStore.history.slice(0, 5).map(h => (
              <View
                key={`${h.params.origin}-${h.params.destination}`}
                className='index-page__history-item'
                hoverClass='tap-dim'
                onClick={() => {
                  searchStore.setOrigin(h.params.origin)
                  searchStore.setDestination(h.params.destination)
                  handleSearch(searchStore.params)
                }}
              >
                <Text>{h.params.origin} → {h.params.destination}</Text>
                <Text className='index-page__history-date'>{humanDate(h.params.departDate, localeStore.locale)}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <View className='index-page__footer'>
        <Text>{t('index.footer')}</Text>
      </View>
    </View>
  )
}

export default observer(IndexPage)

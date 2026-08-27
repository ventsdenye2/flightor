// pages/index — 首页（搜索面板 + 热门航线 + 价格闪报）
import { useEffect } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import Taro, { useShareAppMessage, useShareTimeline } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import DemoBadge from '../../components/common/DemoBadge'
import SearchPanel from '../../components/search/SearchPanel'
import { searchStore } from '../../stores/searchStore'
import { flightStore } from '../../stores/flightStore'
import { userStore } from '../../stores/userStore'
import { HOT_ROUTES, sortByTogo } from '../../mocks/deals'
import { cityOf } from '../../mocks/airports'
import { t, localeStore } from '../../i18n'
import type { SearchParams } from '../../types/flight'
import { daysFromNow, humanDate } from '../../utils/format'
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

  const handleHotRoute = (route: typeof HOT_ROUTES[number]) => {
    searchStore.setOrigin(route.from)
    searchStore.setDestination(route.to)
    searchStore.setDepartDate(daysFromNow(54))
    handleSearch(searchStore.params)
  }

  // TOGO 目的地优先展示
  const hotRoutes = sortByTogo(HOT_ROUTES, userStore.togo)

  return (
    <View className='index-page'>
      <DemoBadge />
      <SearchPanel onSearch={handleSearch} isLoading={flightStore.isLoading} />

      {/* 价格闪报 */}
      <View className='index-page__section'>
        <View className='index-page__section-header'>
          <Text className='index-page__section-title'>{t('index.flash')}</Text>
          <Text className='index-page__section-sub'>{t('common.priceRef')}</Text>
        </View>
        <ScrollView scrollX className='index-page__hot-scroll' showScrollbar={false}>
          <View className='index-page__hot-list'>
            {hotRoutes.map(r => (
              <View
                key={`${r.from}-${r.to}`}
                className='index-page__hot-card'
                hoverClass='tap-dim'
                onClick={() => handleHotRoute(r)}
              >
                <View className='index-page__hot-route'>
                  <Text>{cityOf(r.from, localeStore.locale)}</Text>
                  <Text className='index-page__hot-arrow'>→</Text>
                  <Text>{cityOf(r.to, localeStore.locale)}</Text>
                  {userStore.isTogo(r.to) && (
                    <View className='index-page__hot-togo'>
                      <Text>{t('togo.badge')}</Text>
                    </View>
                  )}
                </View>
                <Text className='index-page__hot-via'>{t('index.via', { hub: r.via })}</Text>
                <Text className='index-page__hot-price'>¥{r.price.toLocaleString()}</Text>
                <View className='index-page__hot-save'>
                  <Text>{t('index.savePct', { pct: r.save })}</Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

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
                <Text>{cityOf(h.params.origin, localeStore.locale)} → {cityOf(h.params.destination, localeStore.locale)}</Text>
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

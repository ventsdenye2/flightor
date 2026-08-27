// pages/explore — 探索（枢纽网络图 + 签证筛选 + 停留玩法 + 主题精选 + 热门低价）
import { useEffect, useMemo, useState } from 'react'
import { View, Text, Swiper, SwiperItem, Image } from '@tarojs/components'
import Taro, { useShareAppMessage } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { getAllHubs } from '../../mocks/hubs'
import { AIRPORTS, cityOf } from '../../mocks/airports'
import { HOT_ROUTES, sortByTogo } from '../../mocks/deals'
import DemoBadge from '../../components/common/DemoBadge'
import WorldMap, { MapAirportPoint } from '../../components/map/WorldMap'
import { searchStore } from '../../stores/searchStore'
import { flightStore } from '../../stores/flightStore'
import { userStore } from '../../stores/userStore'
import { t, localeStore } from '../../i18n'
import type { Interest } from '../../types/flight'
import type { VisaStatus } from '../../types/common'
import { daysFromNow } from '../../utils/format'
import './index.scss'

type VisaFilter = 'all' | VisaStatus

const VISA_FILTERS: Array<{ key: VisaFilter; label: string }> = [
  { key: 'all', label: 'ex.visaAll' },
  { key: 'free', label: 'ex.visa.free' },
  { key: 'conditional', label: 'ex.visa.conditional' },
  { key: 'required', label: 'ex.visa.required' }
]

const INTEREST_KEYS: Interest[] = ['food', 'culture', 'nature', 'shopping', 'nightlife']

// 活动 icon → 兴趣分类
const INTEREST_OF_ICON: Record<string, Interest> = {
  '🍜': 'food',
  '🏛': 'culture',
  '🌿': 'nature',
  '🏝': 'nature',
  '🛍': 'shopping',
  '🌙': 'nightlife',
  '🌃': 'nightlife'
}

function ExplorePage() {
  const [activeIdx, setActiveIdx] = useState(0)
  const [visaFilter, setVisaFilter] = useState<VisaFilter>('all')
  const [theme, setTheme] = useState<Interest>('food')
  const locale = localeStore.locale
  const allHubs = getAllHubs(locale)

  // 导航标题跟随语言
  useEffect(() => {
    Taro.setNavigationBarTitle({ title: t('tab.explore') })
  }, [locale])

  useShareAppMessage(() => ({
    title: t('share.explore'),
    path: '/pages/explore/index'
  }))

  const goHubDetail = (iata: string) => {
    Taro.navigateTo({ url: `/subpages/hub-detail/index?iata=${iata}` })
  }

  // 签证筛选后的枢纽列表
  const hubList = useMemo(
    () => (visaFilter === 'all' ? allHubs : allHubs.filter(h => h.visaStatus === visaFilter)),
    [allHubs, visaFilter]
  )

  // 筛选变化时重置轮播索引
  useEffect(() => {
    setActiveIdx(0)
  }, [visaFilter])

  // 全量机场做底，筛选命中的枢纽高亮
  const hubSet = useMemo(() => new Set(hubList.map(h => h.iata)), [hubList])
  const mapAirports: MapAirportPoint[] = AIRPORTS.map(a => ({
    iata: a.iata,
    lat: a.lat,
    lng: a.lng,
    kind: hubSet.has(a.iata) ? 'hub' : 'plain'
  }))

  // 主题精选：按兴趣聚合各枢纽活动（最多 6 条）
  const themeActivities = useMemo(() => {
    const list: Array<{ icon: string; title: string; description: string; city: string; iata: string }> = []
    for (const hub of allHubs) {
      for (const opt of hub.layoverOptions) {
        for (const act of opt.activities) {
          if (INTEREST_OF_ICON[act.icon] === theme && !list.some(x => x.title === act.title)) {
            list.push({ icon: act.icon, title: act.title, description: act.description, city: hub.city, iata: hub.iata })
          }
        }
      }
    }
    return list.slice(0, 6)
  }, [allHubs, theme])

  // 低价航线 → 直接发起搜索
  const handleDeal = (route: typeof HOT_ROUTES[number]) => {
    searchStore.setOrigin(route.from)
    searchStore.setDestination(route.to)
    searchStore.setDepartDate(daysFromNow(54))
    userStore.addHistory(searchStore.params)
    flightStore.search(searchStore.params)
    Taro.navigateTo({ url: '/pages/search/index' })
  }

  return (
    <View className='explore-page'>
      <DemoBadge />
      <View className='explore-page__header'>
        <Text className='explore-page__title'>{t('ex.title')}</Text>
      </View>

      {/* 枢纽网络图（自绘 Canvas，全量机场，筛选联动高亮） */}
      <View className='explore-page__map'>
        <WorldMap
          canvasId='exploreWorldMap'
          heightRpx={440}
          fitWorld
          airports={mapAirports}
          onAirportTap={iata => {
            if (hubSet.has(iata)) goHubDetail(iata)
          }}
        />
      </View>

      {/* 签证筛选 */}
      <View className='explore-page__filters'>
        {VISA_FILTERS.map(f => (
          <View
            key={f.key}
            className={`explore-page__filter ${visaFilter === f.key ? 'is-active' : ''}`}
            hoverClass='tap-dim'
            onClick={() => setVisaFilter(f.key)}
          >
            <Text>{t(f.label)}</Text>
          </View>
        ))}
      </View>

      {/* Hub 体验横滑卡 */}
      <View className='explore-page__section-title'>
        <Text>{t('ex.collection')}</Text>
      </View>
      {hubList.length > 0 && (
        <>
          <Swiper
            className='explore-page__swiper'
            displayMultipleItems={1}
            nextMargin='80rpx'
            circular={hubList.length > 1}
            current={Math.min(activeIdx, hubList.length - 1)}
            onChange={e => setActiveIdx(e.detail.current)}
          >
            {hubList.map(hub => {
              const actCount = hub.layoverOptions.reduce((s, o) => s + o.activities.length, 0)
              return (
                <SwiperItem key={hub.iata}>
                  <View className='explore-page__card' hoverClass='tap-dim' onClick={() => goHubDetail(hub.iata)}>
                    <Image className='explore-page__card-img' src={hub.coverImage} mode='aspectFill' lazyLoad />
                    <View className={`explore-page__visa-badge is-${hub.visaStatus}`}>
                      <Text>{t(`ex.visa.${hub.visaStatus}`)}</Text>
                    </View>
                    <View className='explore-page__card-body'>
                      <View className='explore-page__card-head'>
                        <Text className='explore-page__card-city'>{hub.city}</Text>
                        <Text className='font-code explore-page__card-iata'>{hub.iata}</Text>
                        <Text className='explore-page__card-count'>{t('ex.activities', { n: actCount })}</Text>
                      </View>
                      <Text className='explore-page__card-visa'>🛂 {hub.transitVisa}</Text>
                      <View className='explore-page__card-tags'>
                        {hub.layoverOptions.map(o => (
                          <Text key={o.duration} className='explore-page__card-tag'>
                            {t('ex.plan', { h: parseInt(o.duration, 10) })}
                          </Text>
                        ))}
                      </View>
                    </View>
                  </View>
                </SwiperItem>
              )
            })}
          </Swiper>
          <View className='explore-page__dots'>
            {hubList.map((h, i) => (
              <View key={h.iata} className={`explore-page__dot ${i === Math.min(activeIdx, hubList.length - 1) ? 'is-active' : ''}`} />
            ))}
          </View>
        </>
      )}

      {/* 主题精选：按兴趣聚合活动 */}
      <View className='explore-page__section-title'>
        <Text>{t('ex.themes')}</Text>
      </View>
      <View className='explore-page__themes'>
        {INTEREST_KEYS.map(key => (
          <View
            key={key}
            className={`explore-page__filter ${theme === key ? 'is-active' : ''}`}
            hoverClass='tap-dim'
            onClick={() => setTheme(key)}
          >
            <Text>{t(`interest.${key}`)}</Text>
          </View>
        ))}
      </View>
      <View className='explore-page__acts'>
        {themeActivities.map(act => (
          <View key={act.title} className='explore-page__act' hoverClass='tap-dim' onClick={() => goHubDetail(act.iata)}>
            <Text className='explore-page__act-icon'>{act.icon}</Text>
            <View className='explore-page__act-body'>
              <View className='explore-page__act-head'>
                <Text className='explore-page__act-title'>{act.title}</Text>
                <Text className='explore-page__act-city'>{act.city}</Text>
              </View>
              <Text className='explore-page__act-desc'>{act.description}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* 热门低价航线 */}
      <View className='explore-page__section-title'>
        <Text>{t('ex.deals')}</Text>
      </View>
      <View className='explore-page__deals'>
        {sortByTogo(HOT_ROUTES, userStore.togo).map(r => (
          <View key={`${r.from}-${r.to}`} className='explore-page__deal' hoverClass='tap-dim' onClick={() => handleDeal(r)}>
            <View className='explore-page__deal-main'>
              <View className='explore-page__deal-route-row'>
                <Text className='explore-page__deal-route'>{cityOf(r.from, locale)} → {cityOf(r.to, locale)}</Text>
                {userStore.isTogo(r.to) && (
                  <View className='explore-page__deal-togo'>
                    <Text>{t('togo.badge')}</Text>
                  </View>
                )}
              </View>
              <Text className='explore-page__deal-via'>{t('index.via', { hub: r.via })}</Text>
            </View>
            <View className='explore-page__deal-side'>
              <Text className='explore-page__deal-price'>¥{r.price.toLocaleString()}</Text>
              <Text className='explore-page__deal-save'>{t('index.savePct', { pct: r.save })}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  )
}

export default observer(ExplorePage)

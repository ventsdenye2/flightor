// pages/profile — 我的（收藏/历史/订阅/语言/设置）
import { useEffect, useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import { userStore } from '../../stores/userStore'
import { searchStore } from '../../stores/searchStore'
import { flightStore } from '../../stores/flightStore'
import { currentPriceOf } from '../../services/flightService'
import { findAirport, airportCity } from '../../mocks/airports'
import AirportSelector from '../../components/search/AirportSelector'
import { t, localeStore } from '../../i18n'
import { formatPrice } from '../../utils/format'
import './index.scss'

type TabKey = 'togo' | 'favorites' | 'history' | 'alerts'

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'togo', label: 'pf.tabTogo' },
  { key: 'favorites', label: 'pf.tabFav' },
  { key: 'history', label: 'pf.tabHistory' },
  { key: 'alerts', label: 'pf.tabAlerts' }
]

function ProfilePage() {
  const [tab, setTab] = useState<TabKey>('togo')
  const [showTogoSelector, setShowTogoSelector] = useState(false)
  const locale = localeStore.locale

  // 导航标题跟随语言
  useEffect(() => {
    Taro.setNavigationBarTitle({ title: t('tab.profile') })
  }, [localeStore.locale])

  const rerunSearch = (origin: string, destination: string) => {
    searchStore.setOrigin(origin)
    searchStore.setDestination(destination)
    userStore.addHistory(searchStore.params)
    flightStore.search(searchStore.params)
    Taro.navigateTo({ url: '/pages/search/index' })
  }

  // 语言切换：同步 tabBar 文案
  const toggleLanguage = () => {
    localeStore.toggle()
    const tabs = ['tab.search', 'tab.explore', 'tab.profile']
    tabs.forEach((key, index) => {
      Taro.setTabBarItem({ index, text: t(key) })
    })
  }

  return (
    <View className='profile-page'>
      {/* 用户卡 */}
      <View className='profile-page__user'>
        <View className='profile-page__avatar'>
          <Text>✈</Text>
        </View>
        <View>
          <Text className='profile-page__name'>{t('pf.name')}</Text>
          <Text className='profile-page__stats'>
            {t('pf.stats', { f: userStore.favorites.length, h: userStore.history.length, a: userStore.alerts.length })}
          </Text>
        </View>
      </View>

      {/* Tab */}
      <View className='profile-page__tabs'>
        {TABS.map(item => (
          <View
            key={item.key}
            className={`profile-page__tab ${tab === item.key ? 'is-active' : ''}`}
            hoverClass='tap-dim'
            onClick={() => setTab(item.key)}
          >
            <Text>{t(item.label)}</Text>
          </View>
        ))}
      </View>

      {/* TOGO 清单：想去的目的地，低价信息流优先推送 */}
      {tab === 'togo' && (
        <View className='profile-page__list'>
          {userStore.togo.length === 0 && (
            <View className='profile-page__empty'><Text>{t('pf.emptyTogo')}</Text></View>
          )}
          {userStore.togo.map(iata => {
            const airport = findAirport(iata)
            return (
              <View
                key={iata}
                className='profile-page__item'
                hoverClass='tap-dim'
                onClick={() => rerunSearch(searchStore.origin, iata)}
              >
                <View className='profile-page__item-main'>
                  <Text className='font-code profile-page__item-route'>{iata}</Text>
                  <Text className='profile-page__item-sub'>
                    {airport ? airportCity(airport, locale) : ''}
                  </Text>
                </View>
                <View className='profile-page__item-side'>
                  <Text className='profile-page__item-go'>{t('togo.search')}</Text>
                  <Text
                    className='profile-page__item-remove'
                    onClick={e => {
                      e.stopPropagation()
                      userStore.removeTogo(iata)
                    }}
                  >
                    {t('pf.remove')}
                  </Text>
                </View>
              </View>
            )
          })}
          <View className='profile-page__add' hoverClass='tap-dim' onClick={() => setShowTogoSelector(true)}>
            <Text>{t('pf.addTogo')}</Text>
          </View>
        </View>
      )}

      {/* 收藏（含今日复核价涨跌） */}
      {tab === 'favorites' && (
        <View className='profile-page__list'>
          {userStore.favorites.length === 0 ? (
            <View className='profile-page__empty'><Text>{t('pf.emptyFav')}</Text></View>
          ) : (
            userStore.favorites.map(fav => {
              const current = currentPriceOf(fav.id, fav.flight.totalPrice)
              const diff = current - fav.flight.totalPrice
              return (
                <View
                  key={fav.id}
                  className='profile-page__item'
                  hoverClass='tap-dim'
                  onClick={() => {
                    flightStore.select(fav.flight)
                    Taro.navigateTo({ url: `/pages/route/index?id=${fav.id}` })
                  }}
                >
                  <View className='profile-page__item-main'>
                    <Text className='font-code profile-page__item-route'>
                      {fav.flight.segments[0]?.origin} → {fav.flight.segments[fav.flight.segments.length - 1]?.destination}
                    </Text>
                    <Text className='profile-page__item-sub'>
                      {fav.flight.airline} · {t('pf.savedAt', { p: formatPrice(fav.flight.totalPrice) })}
                    </Text>
                  </View>
                  <View className='profile-page__item-side'>
                    <Text className='profile-page__item-price'>{formatPrice(current)}</Text>
                    <Text
                      className={`profile-page__trend ${diff < 0 ? 'is-down' : diff > 0 ? 'is-up' : ''}`}
                    >
                      {diff < 0
                        ? t('pf.down', { amt: formatPrice(-diff) })
                        : diff > 0
                          ? t('pf.up', { amt: formatPrice(diff) })
                          : t('pf.flat')}
                    </Text>
                    <Text
                      className='profile-page__item-remove'
                      onClick={e => {
                        e.stopPropagation()
                        userStore.toggleFavorite(fav.flight)
                      }}
                    >
                      {t('pf.remove')}
                    </Text>
                  </View>
                </View>
              )
            })
          )}
        </View>
      )}

      {/* 历史 */}
      {tab === 'history' && (
        <View className='profile-page__list'>
          {userStore.history.length === 0 ? (
            <View className='profile-page__empty'><Text>{t('pf.emptyHistory')}</Text></View>
          ) : (
            <>
              {userStore.history.map(h => (
                <View
                  key={`${h.params.origin}-${h.params.destination}`}
                  className='profile-page__item'
                  hoverClass='tap-dim'
                  onClick={() => rerunSearch(h.params.origin, h.params.destination)}
                >
                  <View className='profile-page__item-main'>
                    <Text className='font-code profile-page__item-route'>
                      {h.params.origin} → {h.params.destination}
                    </Text>
                    <Text className='profile-page__item-sub'>{h.params.departDate}</Text>
                  </View>
                  <Text className='profile-page__item-go'>{t('pf.again')}</Text>
                </View>
              ))}
              <View className='profile-page__clear' hoverClass='tap-dim' onClick={() => userStore.clearHistory()}>
                <Text>{t('pf.clear')}</Text>
              </View>
            </>
          )}
        </View>
      )}

      {/* 价格提醒 */}
      {tab === 'alerts' && (
        <View className='profile-page__list'>
          {userStore.alerts.length === 0 ? (
            <View className='profile-page__empty'><Text>{t('pf.emptyAlerts')}</Text></View>
          ) : (
            userStore.alerts.map(a => (
              <View key={a.id} className='profile-page__item'>
                <View className='profile-page__item-main'>
                  <Text className='font-code profile-page__item-route'>{a.origin} → {a.destination}</Text>
                  <Text className='profile-page__item-sub'>{t('pf.target', { p: formatPrice(a.targetPrice) })}</Text>
                </View>
                <Text className='profile-page__item-remove' onClick={() => userStore.removeAlert(a.id)}>
                  {t('pf.cancel')}
                </Text>
              </View>
            ))
          )}
        </View>
      )}

      {/* 设置入口 */}
      <View className='profile-page__menu'>
        <View className='profile-page__menu-item' hoverClass='tap-dim' onClick={toggleLanguage}>
          <Text>{t('pf.lang')}</Text>
          <Text className='profile-page__menu-value'>
            {localeStore.locale === 'zh' ? '中文 › English' : 'English › 中文'}
          </Text>
        </View>
        <View
          className='profile-page__menu-item'
          hoverClass='tap-dim'
          onClick={() => Taro.navigateTo({ url: '/subpages/price-alert/index' })}
        >
          <Text>{t('pf.newAlert')}</Text>
          <Text className='profile-page__menu-arrow'>›</Text>
        </View>
        <View
          className='profile-page__menu-item'
          hoverClass='tap-dim'
          onClick={() => Taro.navigateTo({ url: '/subpages/about/index' })}
        >
          <Text>{t('pf.about')}</Text>
          <Text className='profile-page__menu-arrow'>›</Text>
        </View>
      </View>

      <View className='profile-page__version'>
        <Text>{t('pf.version')}</Text>
      </View>

      {/* TOGO 目的地选择弹层 */}
      <AirportSelector
        visible={showTogoSelector}
        title={t('pf.addTogo')}
        onSelect={iata => userStore.addTogo(iata)}
        onClose={() => setShowTogoSelector(false)}
      />
    </View>
  )
}

export default observer(ProfilePage)

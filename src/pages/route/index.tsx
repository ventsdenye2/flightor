// pages/route — 路线详情（行程卡 + 中转对比 + 中转玩法 + 价格趋势）
import { useEffect, useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro, { useRouter, useShareAppMessage } from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import BoardingPassItinerary from '../../components/itinerary/BoardingPassItinerary'
import TransferModeCompare from '../../components/flight/TransferModeCompare'
import HubExperienceCard from '../../components/hub/HubExperienceCard'
import PriceTrendPanel from '../../components/trend/PriceTrendPanel'
import { flightStore } from '../../stores/flightStore'
import { searchStore } from '../../stores/searchStore'
import { userStore } from '../../stores/userStore'
import { getHubExperience, getHubVisaNote } from '../../mocks/hubs'
import { cityOf } from '../../mocks/airports'
import { fetchPriceTrend } from '../../services/flightService'
import { t, fd, localeStore } from '../../i18n'
import type { PriceTrendResponse } from '../../types/api'
import type { ItinerarySegment, TransferOption, FlightOption } from '../../types/flight'
import { formatPrice } from '../../utils/format'
import './index.scss'

function toItinerary(flight: FlightOption): ItinerarySegment[] {
  const locale = localeStore.locale
  const segs: ItinerarySegment[] = []
  flight.segments.forEach((s, i) => {
    segs.push({
      type: 'flight',
      flightNo: s.flightNo,
      airline: s.airline,
      origin: s.origin,
      destination: s.destination,
      departTime: s.departTime,
      arriveTime: s.arriveTime,
      duration: s.duration,
      terminal: ['T1', 'T2', 'T3'][i % 3],
      gate: `${String.fromCharCode(65 + i)}${12 + i * 7}`
    })
    if (i < flight.segments.length - 1 && flight.hub) {
      segs.push({
        type: 'layover',
        origin: flight.hub.iata,
        duration: flight.hub.layoverMinutes,
        visaStatus: getHubVisaNote(flight.hub.iata, locale),
        playTip: flight.hub.layoverMinutes >= 480 ? t('route.playTip') : undefined
      })
    }
  })
  return segs
}

function buildTransferOptions(flight: FlightOption): { self: TransferOption; airline: TransferOption } | null {
  const locale = localeStore.locale
  const result = flightStore.result
  if (!result) return null
  const selfBest = flight.transferType === 'self' ? flight : result.selfTransfer[0]
  const airlineBest = flight.transferType === 'airline' ? flight : result.airlineTransfer[0]
  if (!selfBest || !airlineBest) return null
  return {
    self: {
      mode: 'self',
      price: selfBest.totalPrice,
      baggagePolicy: t('tmc.baggageSelf'),
      missedConnectionRisk: 'high',
      visaRequired: selfBest.hub?.visaStatus === 'required',
      visaDetail: selfBest.hub ? getHubVisaNote(selfBest.hub.iata, locale) : undefined,
      stopoverPlayable: (selfBest.hub?.layoverMinutes ?? 0) >= 480,
      minConnectionTime: selfBest.hub?.layoverMinutes ?? 0,
      totalDuration: selfBest.totalDuration,
      protectionLevel: t('tmc.protSelf'),
      flexibility: t('tmc.flexSelf')
    },
    airline: {
      mode: 'airline',
      price: airlineBest.totalPrice,
      baggagePolicy: t('tmc.baggageAirline'),
      missedConnectionRisk: 'low',
      visaRequired: false,
      stopoverPlayable: (airlineBest.hub?.layoverMinutes ?? 0) >= 480,
      minConnectionTime: airlineBest.hub?.layoverMinutes ?? 0,
      totalDuration: airlineBest.totalDuration,
      protectionLevel: t('tmc.protAirline'),
      flexibility: t('tmc.flexAirline')
    }
  }
}

function RoutePage() {
  const router = useRouter()
  const [trend, setTrend] = useState<PriceTrendResponse | null>(null)
  const locale = localeStore.locale

  useEffect(() => {
    Taro.setNavigationBarTitle({ title: t('nav.route') })
  }, [locale])

  // 通过分享链接进入时按 id 恢复选中方案
  useEffect(() => {
    const id = router.params?.id
    if (id && !flightStore.selected) {
      flightStore.selectById(id)
    }
  }, [router.params, flightStore.result])

  const flight = flightStore.selected
  const params = flightStore.lastParams

  useEffect(() => {
    if (params) {
      fetchPriceTrend(params.origin, params.destination).then(setTrend).catch(() => {})
    }
  }, [params?.origin, params?.destination])

  const saving = flight ? flightStore.savingsOf(flight) : { amount: 0, percent: 0 }

  useShareAppMessage(() => ({
    title: flight && params
      ? t('share.route', { o: params.origin, d: params.destination, amt: formatPrice(saving.amount) })
      : t('share.app'),
    path: flight ? `/pages/route/index?id=${flight.id}` : '/pages/index/index'
  }))

  if (!flight) {
    return (
      <View className='route-page route-page--empty'>
        <Text className='route-page__empty-icon'>🛫</Text>
        <Text>{t('route.expired')}</Text>
        <View
          className='route-page__empty-btn'
          hoverClass='tap-dim'
          onClick={() => Taro.switchTab({ url: '/pages/index/index' })}
        >
          <Text>{t('route.research')}</Text>
        </View>
      </View>
    )
  }

  const transferOptions = buildTransferOptions(flight)
  const hubExp = flight.hub ? getHubExperience(flight.hub.iata, locale) : undefined
  const hubCity = flight.hub ? cityOf(flight.hub.iata, locale) : ''
  const isFav = userStore.isFavorite(flight.id)

  return (
    <View className='route-page'>
      {/* 价格总览 */}
      <View className='route-page__overview'>
        <View>
          <Text className='font-code route-page__price'>{formatPrice(flight.totalPrice)}</Text>
          {saving.amount > 0 && (
            <Text className='route-page__saving'>
              {t('route.vsDirect', { amt: formatPrice(saving.amount), pct: saving.percent })}
            </Text>
          )}
          <Text className='route-page__duration'>{t('route.total', { dur: fd(flight.totalDuration), airline: flight.airline })}</Text>
        </View>
        <View
          className={`route-page__fav ${isFav ? 'is-active' : ''}`}
          hoverClass='tap-dim'
          onClick={() => {
            userStore.toggleFavorite(flight)
            Taro.showToast({ title: isFav ? t('route.favOff') : t('route.favOn'), icon: 'none' })
          }}
        >
          <Text>{isFav ? t('route.faved') : t('route.fav')}</Text>
        </View>
      </View>

      {/* 行程单（登机牌样式 + 分享导出） */}
      <View className='route-page__section'>
        <BoardingPassItinerary
          itinerary={toItinerary(flight)}
          shareTitle={params ? t('share.route', { o: params.origin, d: params.destination, amt: formatPrice(saving.amount) }) : undefined}
        />
      </View>

      {/* 中转模式对比 */}
      {transferOptions && flight.transferType !== 'direct' && (
        <View className='route-page__section'>
          <Text className='route-page__section-title'>{t('route.compare')}</Text>
          <TransferModeCompare
            selfTransfer={transferOptions.self}
            airlineTransfer={transferOptions.airline}
            onSelect={mode => {
              if (mode === 'airline') {
                Taro.showModal({
                  title: t('route.bookTitle'),
                  content: t('route.bookContent'),
                  showCancel: false,
                  confirmText: t('route.gotIt'),
                  confirmColor: '#0a84ff'
                })
              } else {
                Taro.showToast({ title: t('route.selfPicked'), icon: 'none' })
              }
            }}
          />
        </View>
      )}

      {/* Hub 停留体验 */}
      {hubExp && flight.hub && (
        <View className='route-page__section'>
          <Text className='route-page__section-title'>{t('route.play', { city: hubCity })}</Text>
          <HubExperienceCard
            hub={hubExp}
            layoverDuration={flight.hub.layoverMinutes}
            interests={searchStore.interests}
          />
          <View
            className='route-page__hub-more'
            hoverClass='tap-dim'
            onClick={() => Taro.navigateTo({ url: `/subpages/hub-detail/index?iata=${flight.hub!.iata}` })}
          >
            <Text>{t('route.guide', { city: hubCity })}</Text>
          </View>
        </View>
      )}

      {/* 价格趋势 */}
      {trend && (
        <View className='route-page__section'>
          <Text className='route-page__section-title'>
            {t('route.trend', { o: trend.route.origin, d: trend.route.destination })}
          </Text>
          <PriceTrendPanel trend={trend} />
          <View
            className='route-page__alert-btn'
            hoverClass='tap-dim'
            onClick={() =>
              Taro.navigateTo({
                url: `/subpages/price-alert/index?origin=${trend.route.origin}&destination=${trend.route.destination}&current=${trend.statistics.current}`
              })
            }
          >
            <Text>{t('route.alert')}</Text>
          </View>
        </View>
      )}

      <View className='route-page__disclaimer'>
        <Text>{t('route.disclaimer')}</Text>
      </View>
    </View>
  )
}

export default observer(RoutePage)

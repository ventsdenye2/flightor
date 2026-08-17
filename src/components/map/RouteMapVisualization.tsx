// src/components/map/RouteMapVisualization.tsx — 航线可视化（自绘 Canvas，不依赖腾讯地图）
import { useMemo } from 'react'
import { View, Text } from '@tarojs/components'
import { observer } from 'mobx-react-lite'
import type { AirportPoint, HubPoint } from '../../types/common'
import { AIRPORTS } from '../../mocks/airports'
import { greatCirclePoints } from '../../utils/arcLine'
import { t } from '../../i18n'
import WorldMap, { MapAirportPoint, MapRoute } from './WorldMap'
import './RouteMapVisualization.scss'

interface RouteMapProps {
  origin: AirportPoint
  destination: AirportPoint
  hubs: HubPoint[]
  selectedHub?: string
  onHubClick?: (hub: HubPoint) => void
}

function RouteMapVisualization({ origin, destination, hubs, selectedHub, onHubClick }: RouteMapProps) {
  // 机场层：全量机场做底 + 出发/到达/枢纽高亮
  const airports = useMemo<MapAirportPoint[]>(() => {
    const highlight = new Set([origin.iata, destination.iata, ...hubs.map(h => h.iata)])
    const list: MapAirportPoint[] = AIRPORTS
      .filter(a => !highlight.has(a.iata))
      .map(a => ({ iata: a.iata, lat: a.lat, lng: a.lng, kind: 'plain' as const }))
    list.push({ iata: origin.iata, lat: origin.latitude, lng: origin.longitude, kind: 'primary' })
    list.push({ iata: destination.iata, lat: destination.latitude, lng: destination.longitude, kind: 'primary' })
    hubs.forEach(h => {
      list.push({
        iata: h.iata,
        lat: h.latitude,
        lng: h.longitude,
        kind: 'hub',
        label: `${h.iata} -${h.savingsPercent}%`
      })
    })
    return list
  }, [origin, destination, hubs])

  const routes = useMemo<MapRoute[]>(() => {
    const lines: MapRoute[] = []
    // 直飞弧线（弱化虚线）
    lines.push({
      points: greatCirclePoints(
        { latitude: origin.latitude, longitude: origin.longitude },
        { latitude: destination.latitude, longitude: destination.longitude }
      ),
      color: '#3a3a3c',
      width: 1.5,
      dotted: true
    })
    // 经枢纽的中转弧线
    hubs.forEach(hub => {
      const active = !selectedHub || hub.iata === selectedHub
      lines.push({
        points: [
          ...greatCirclePoints(
            { latitude: origin.latitude, longitude: origin.longitude },
            { latitude: hub.latitude, longitude: hub.longitude }
          ),
          ...greatCirclePoints(
            { latitude: hub.latitude, longitude: hub.longitude },
            { latitude: destination.latitude, longitude: destination.longitude }
          )
        ],
        color: active ? '#0a84ff' : 'rgba(10, 132, 255, 0.3)',
        width: active ? 2.5 : 1.5
      })
    })
    return lines
  }, [origin, destination, hubs, selectedHub])

  return (
    <View className='route-map'>
      <WorldMap
        canvasId='routeWorldMap'
        heightRpx={520}
        fitWorld={false}
        airports={airports}
        routes={routes}
        onAirportTap={iata => {
          const hub = hubs.find(h => h.iata === iata)
          if (hub) onHubClick?.(hub)
        }}
      />
      {/* 图例（自绘地图为普通组件，无需 CoverView） */}
      <View className='route-map__legend'>
        <View className='route-map__legend-item'>
          <View className='route-map__dot route-map__dot--od' />
          <Text>{t('map.od')}</Text>
        </View>
        <View className='route-map__legend-item'>
          <View className='route-map__dot route-map__dot--hub' />
          <Text>{t('map.hub')}</Text>
        </View>
        <View className='route-map__legend-item'>
          <View className='route-map__dot route-map__dot--plain' />
          <Text>{t('map.airport')}</Text>
        </View>
      </View>
    </View>
  )
}

export default observer(RouteMapVisualization)

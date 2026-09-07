import { useMemo, useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import WorldMap, { type MapAirportPoint, type MapRoute } from '../map/WorldMap'
import { badgeLabels, durationLabel, fareLabel, routeLabel, type RouteView } from '../../services/routeArtifact'

export function RouteWorkspace({ routes, initialRouteId, onSave }: { routes: RouteView[]; initialRouteId?: string; onSave?: (id: string) => void }) {
  const [selectedId, setSelectedId] = useState(initialRouteId ?? routes[0]?.id)
  const [edgeId, setEdgeId] = useState('')
  const route = routes.find(r => r.id === selectedId)
  const edge = route?.edges.find(e => e.id === edgeId) ?? route?.edges[0]
  const map = useMemo(() => {
    const airports: MapAirportPoint[] = [], lines: MapRoute[] = []
    if (!route) return { airports, lines }
    const seen = new Set<string>()
    const locations = [...route.nodes.map(n => n.location), ...route.edges.flatMap(e => e.segments.flatMap(s => [s.from, s.to]))]
    for (const l of locations) {
      if (l.latitude === undefined || l.longitude === undefined || seen.has(l.id)) continue
      seen.add(l.id)
      airports.push({ iata: l.id, label: l.iata ?? l.name, lat: l.latitude, lng: l.longitude, kind: route.nodes[0].location.id === l.id || route.nodes[route.nodes.length - 1].location.id === l.id ? 'primary' : 'hub' })
    }
    for (const e of route.edges) {
      for (const s of e.segments.length ? e.segments : [e]) {
        if (s.from.latitude === undefined || s.from.longitude === undefined || s.to.latitude === undefined || s.to.longitude === undefined) continue
        lines.push({ id: e.id, color: e.id === edge?.id ? '#45c6cb' : '#0a84ff', width: e.id === edge?.id ? 3 : 1.5, dotted: e.transferType === 'self', points: [{ latitude: s.from.latitude, longitude: s.from.longitude }, { latitude: s.to.latitude, longitude: s.to.longitude }] })
      }
    }
    return { airports, lines }
  }, [route, edge?.id])

  if (routes.length === 0) return <Text>当前条件没有可展示的路线，请回到规划页调整条件。</Text>
  if (!route) return <View><Text>所选路线不在此结果中。</Text><View className='route-workspace__action' onClick={() => setSelectedId(routes[0].id)}>查看可用路线</View></View>
  return <View className='route-workspace'>
    <Text className='route-workspace__eyebrow'>YOUR ROUTE / {routes.length} 个方案</Text>
    <View className='route-workspace__choices'>
      {routes.map(r => <View key={r.id} className={`route-workspace__choice ${r.id === route.id ? 'is-active' : ''}`} onClick={() => { setSelectedId(r.id); setEdgeId('') }}>
        <Text>{r.badges.map(b => badgeLabels[b]).join(' · ') || '路线方案'}</Text>
        <Text className='route-workspace__choice-path'>{routeLabel(r)}</Text><Text>{fareLabel(r.totalFare)}</Text>
      </View>)}
    </View>
    <View className='route-workspace__hero'>
      <Text className='route-workspace__title'>{routeLabel(route)}</Text>
      <Text className='route-workspace__price'>{fareLabel(route.totalFare)}</Text>
      <Text>{durationLabel(route.totalDurationMinutes)} · {route.transferCount} 次中转</Text>
      <Text className='route-workspace__muted'>航班报价可能变化，不包含未列出的住宿、活动与地面交通费用。</Text>
      {onSave && <View className='route-workspace__action' onClick={() => onSave(route.id)}>保存此路线</View>}
    </View>
    <View className='route-workspace__section'>
      <Text className='route-workspace__heading'>路线地图</Text>
      {map.airports.length > 0 ? <WorldMap canvasId='route-artifact-map' airports={map.airports} routes={map.lines} fitWorld={false} onRouteTap={setEdgeId} onAirportTap={id => { const next = route.edges.find(e => e.from.id === id || e.to.id === id || e.segments.some(s => s.from.id === id || s.to.id === id)); if (next) setEdgeId(next.id) }} /> : <Text className='route-workspace__muted'>暂未提供机场坐标，可通过下方航段查看行程。</Text>}
      <Text className='route-workspace__muted'>点击机场或连线查看航段；仅绘制已提供坐标的位置。</Text>
    </View>
    <View className='route-workspace__section'>
      <Text className='route-workspace__heading'>行程时间线</Text>
      {route.edges.map((e, i) => {
        const previous = route.edges[i - 1]
        const wait = previous?.arrivalAt && e.departureAt ? Math.round((Date.parse(e.departureAt) - Date.parse(previous.arrivalAt)) / 60000) : undefined
        return <View key={e.id}>
          {wait !== undefined && wait >= 0 && <Text className='route-workspace__stopover'>在 {e.from.name} 衔接 {durationLabel(wait)} · 入境与活动安排需另行确认</Text>}
          <View className={`route-workspace__leg ${edge?.id === e.id ? 'is-active' : ''}`} onClick={() => setEdgeId(e.id)}>
            <Text className='route-workspace__heading'>{e.from.iata ?? e.from.name} → {e.to.iata ?? e.to.name}</Text>
            <Text>{e.departureAt ?? '出发时间未提供'}</Text><Text>{e.arrivalAt ?? '抵达时间未提供'}</Text>
            <Text>{durationLabel(e.durationMinutes)} · {fareLabel(e.fare)}</Text>
            {e.transferType === 'self' && <Text className='route-workspace__warning'>自行中转：需自行确认行李重托运与衔接时间</Text>}
            {e.airportChange && <Text className='route-workspace__warning'>涉及更换机场，请预留地面交通时间</Text>}
          </View>
        </View>
      })}
    </View>
    {edge && <View className='route-workspace__section'>
      <Text className='route-workspace__heading'>航班与费用 · {edge.from.iata ?? edge.from.name} → {edge.to.iata ?? edge.to.name}</Text>
      {edge.segments.map((s, i) => <View key={`${edge.id}-${i}`} className='route-workspace__flight'>
        <Text>{s.flightNumber ?? '航班号未提供'} · {s.marketingCarrier ?? '航司未提供'}</Text>
        <Text>{s.from.iata ?? s.from.name} → {s.to.iata ?? s.to.name}</Text>
        <Text>{s.departureAt ?? '时间待确认'} → {s.arrivalAt ?? '时间待确认'}</Text>
      </View>)}
      <Text className='route-workspace__price'>{fareLabel(edge.fare)}</Text>
      {edge.checkedAt && <Text className='route-workspace__muted'>资料核验于 {edge.checkedAt}</Text>}
      {edge.fareArtifactId && <View className='route-workspace__action' onClick={() => Taro.navigateTo({ url: `/pages/search/index?artifactId=${encodeURIComponent(edge.fareArtifactId!)}` })}>查看航班报价</View>}
    </View>}
    <View className='route-workspace__section'>
      <Text className='route-workspace__heading'>为什么选择这条路线</Text>
      {route.reasons.length ? route.reasons.map((reason, i) => <Text key={i} className='route-workspace__reason'>✓ {reason}</Text>) : <Text className='route-workspace__muted'>此结果未提供推荐理由。</Text>}
      {route.tradeoffs.map((reason, i) => <Text key={i} className='route-workspace__muted'>{reason}</Text>)}
      {route.warnings.map((warning, i) => <Text key={i} className='route-workspace__warning'>{warning}</Text>)}
    </View>
  </View>
}

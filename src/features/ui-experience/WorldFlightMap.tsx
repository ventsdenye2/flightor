import { worldLand, worldPlane } from './media'
import { memo, useEffect, useMemo, useState } from 'react'
import { Button, Image, Text, View } from '@tarojs/components'
import type { FlightLegDisplay } from './presentation'
import { worldFlightLegs, worldFlightPosition, worldTrackLines } from './worldFlight'
import './world-flight.scss'

export const WorldFlightMap = memo(function WorldFlightMap({ legs }: { legs: FlightLegDisplay[] }) {
  const route = useMemo(() => worldFlightLegs(legs), [legs])
  const tracks = useMemo(() => worldTrackLines(route), [route])
  const [progress, setProgress] = useState(0)
  const [paused, setPaused] = useState(false)
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(preference.matches)
    update(); preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (paused || reduced || !route.length) return
    let previous = Date.now()
    const timer = setInterval(() => {
      const now = Date.now(), elapsed = now - previous
      previous = now
      setProgress(value => (value + elapsed / 12000) % 1)
    }, 40)
    return () => clearInterval(timer)
  }, [paused, reduced, route])
  const plane = worldFlightPosition(route, reduced ? 1 : progress)
  const finalLeg = route[route.length - 1]
  const origin = route[0]?.points[0], destination = finalLeg?.points[finalLeg.points.length - 1]
  return <View className='wf-section'>
    <Text className='ux-section-title'>世界航线</Text>
    <View className='wf-map' role='img' ariaLabel={route.length ? `世界航线图：${route[0].from}飞往${route[route.length - 1].to}` : '世界地图'}>
      <Image src={worldLand} mode='aspectFit' className='wf-land' aria-hidden />
      <View className='wf-equator' />
      {tracks.map((track, i) => <View className='wf-track' key={i} style={{ left: `${track.x}%`, top: `${track.y}%`, width: `${track.width}%`, transform: `rotate(${track.angle}deg)` }} />)}
      {origin ? <View className='wf-point wf-origin' style={{ left: `${origin.x}%`, top: `${origin.y}%` }} /> : null}
      {destination ? <View className='wf-point wf-destination' style={{ left: `${destination.x}%`, top: `${destination.y}%` }} /> : null}
      {plane ? <View className='wf-plane' style={{ left: `${plane.x}%`, top: `${plane.y}%`, transform: `translate(-50%, -50%) rotate(${plane.angle}deg)` }}><Image src={worldPlane} mode='aspectFit' aria-hidden /></View> : null}
      {route.length ? <View className='wf-endpoints'><Text>{route[0].from}</Text><Text>→</Text><Text>{route[route.length - 1].to}</Text></View> : null}
      {route.length && !reduced ? <Button className='wf-toggle' ariaLabel={paused ? '播放航线动画' : '暂停航线动画'} onClick={() => setPaused(value => !value)}><Text>{paused ? '▶' : 'Ⅱ'}</Text></Button> : null}
    </View>
  </View>
})

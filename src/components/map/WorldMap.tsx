// src/components/map/WorldMap.tsx — 自绘 Canvas 世界航线图（替代腾讯地图）
// 点阵大陆 + 经纬网格 + 全量机场 + 大圆航线，支持点击机场
import { useEffect, useRef } from 'react'
import { View, Canvas } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getLandDots } from './worldLand'
import './WorldMap.scss'

export interface MapAirportPoint {
  iata: string
  lat: number
  lng: number
  kind: 'primary' | 'hub' | 'plain'
  label?: string
}

export interface MapRoute {
  points: Array<{ latitude: number; longitude: number }>
  color: string
  width?: number
  dotted?: boolean
}

interface WorldMapProps {
  canvasId: string
  heightRpx?: number
  airports: MapAirportPoint[]
  routes?: MapRoute[]
  /** true=整幅世界；false=按重点机场与航线自动取景 */
  fitWorld?: boolean
  onAirportTap?: (iata: string) => void
}

const COLORS = {
  bg: '#1c1c1e',
  grid: '#3a3a3c',
  land: '#3a3a3c',
  plain: '#8e8e93',
  primary: '#0a84ff',
  hub: '#ff9f0a'
}

interface Projection {
  minLng: number
  maxLng: number
  minLat: number
  maxLat: number
  w: number
  h: number
}

function project(p: Projection, lng: number, lat: number): [number, number] {
  const x = ((lng - p.minLng) / (p.maxLng - p.minLng)) * p.w
  const y = ((p.maxLat - lat) / (p.maxLat - p.minLat)) * p.h
  return [x, y]
}

export default function WorldMap({ canvasId, heightRpx = 460, airports, routes = [], fitWorld = true, onAirportTap }: WorldMapProps) {
  const projRef = useRef<Projection | null>(null)
  // 记录热点机场屏幕坐标用于点击命中
  const hitRef = useRef<Array<{ iata: string; x: number; y: number }>>([])
  // 触摸起点（区分滑动与点击）
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  // 数据签名：内容未变时跳过重绘（避免父组件无关渲染触发闪烁）
  const sigRef = useRef('')

  const signature = JSON.stringify({
    f: fitWorld,
    a: airports.map(a => `${a.iata}${a.kind}${a.label ?? ''}`),
    r: routes.map(r => `${r.color}${r.width ?? ''}${r.dotted ? 1 : 0}${r.points.length}`)
  })

  useEffect(() => {
    if (sigRef.current === signature) return
    const query = Taro.createSelectorQuery()
    query
      .select(`#${canvasId}`)
      .fields({ node: true, size: true })
      .exec(res => {
        const info = res?.[0]
        if (!info?.node) return
        sigRef.current = signature
        const canvas = info.node
        const ctx = canvas.getContext('2d')
        const dpr = Taro.getSystemInfoSync().pixelRatio || 2
        canvas.width = info.width * dpr
        canvas.height = info.height * dpr
        ctx.scale(dpr, dpr)
        draw(ctx, info.width, info.height)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  function computeProjection(w: number, h: number): Projection {
    if (fitWorld) {
      return { minLng: -180, maxLng: 195, minLat: -58, maxLat: 82, w, h }
    }
    // 自动取景：重点机场 + 航线点
    const lngs: number[] = []
    const lats: number[] = []
    airports.filter(a => a.kind !== 'plain').forEach(a => {
      lngs.push(a.lng)
      lats.push(a.lat)
    })
    routes.forEach(r => r.points.forEach(pt => {
      lngs.push(pt.longitude)
      lats.push(pt.latitude)
    }))
    if (lngs.length === 0) return { minLng: -180, maxLng: 180, minLat: -58, maxLat: 82, w, h }
    const padLng = Math.max(6, (Math.max(...lngs) - Math.min(...lngs)) * 0.12)
    const padLat = Math.max(5, (Math.max(...lats) - Math.min(...lats)) * 0.18)
    return {
      minLng: Math.min(...lngs) - padLng,
      maxLng: Math.max(...lngs) + padLng,
      minLat: Math.max(-70, Math.min(...lats) - padLat),
      maxLat: Math.min(85, Math.max(...lats) + padLat),
      w,
      h
    }
  }

  function draw(ctx: any, w: number, h: number) {
    const p = computeProjection(w, h)
    projRef.current = p
    hitRef.current = []

    // 背景
    ctx.fillStyle = COLORS.bg
    ctx.fillRect(0, 0, w, h)

    // 经纬网格（30° 间隔）
    ctx.strokeStyle = COLORS.grid
    ctx.lineWidth = 0.5
    for (let lng = -180; lng <= 180; lng += 30) {
      const [x] = project(p, lng, 0)
      if (x < 0 || x > w) continue
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()
    }
    for (let lat = -60; lat <= 80; lat += 30) {
      const [, y] = project(p, 0, lat)
      if (y < 0 || y > h) continue
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }

    // 大陆点阵（3° 加密后缩小点径）
    ctx.fillStyle = COLORS.land
    for (const [lng, lat] of getLandDots()) {
      const [x, y] = project(p, lng, lat)
      if (x < -4 || x > w + 4 || y < -4 || y > h + 4) continue
      ctx.beginPath()
      ctx.arc(x, y, 1.2, 0, Math.PI * 2)
      ctx.fill()
    }

    // 航线（大圆弧线，跨越 ±180° 时断开）
    for (const route of routes) {
      ctx.strokeStyle = route.color
      ctx.lineWidth = route.width ?? 2
      ctx.setLineDash(route.dotted ? [5, 5] : [])
      ctx.beginPath()
      let prevLng: number | null = null
      route.points.forEach(pt => {
        const [x, y] = project(p, pt.longitude, pt.latitude)
        if (prevLng === null || Math.abs(pt.longitude - prevLng) > 180) {
          ctx.moveTo(x, y)
        } else {
          ctx.lineTo(x, y)
        }
        prevLng = pt.longitude
      })
      ctx.stroke()
      ctx.setLineDash([])
    }

    // 机场绘制：重点机场优先，标签防重叠避让（被遮挡的只画点不画字）
    const placedBoxes: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
    const tryLabel = (x: number, y: number, label: string, color: string, size: number, bold: boolean) => {
      const wpx = label.length * size * 0.62
      const box = { x1: x - wpx / 2 - 2, y1: y - 9 - size, x2: x + wpx / 2 + 2, y2: y - 7 }
      if (placedBoxes.some(b => !(box.x2 < b.x1 || box.x1 > b.x2 || box.y2 < b.y1 || box.y1 > b.y2))) return
      placedBoxes.push(box)
      ctx.font = `${bold ? 'bold ' : ''}${size}px Menlo, monospace`
      ctx.textAlign = 'center'
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)'
      ctx.strokeText(label, x, y - 9)
      ctx.fillStyle = color
      ctx.fillText(label, x, y - 9)
      ctx.textAlign = 'left'
    }

    // 重点机场（出发/到达/枢纽）：大点 + 白芯 + 优先标签
    for (const a of airports) {
      if (a.kind === 'plain') continue
      const [x, y] = project(p, a.lng, a.lat)
      if (x < -20 || x > w + 20 || y < -20 || y > h + 20) continue
      const color = a.kind === 'primary' ? COLORS.primary : COLORS.hub
      hitRef.current.push({ iata: a.iata, x, y })
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(x, y, 5.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(x, y, 2.2, 0, Math.PI * 2)
      ctx.fill()
      tryLabel(x, y, a.label ?? a.iata, color, 10, true)
    }

    // 普通机场：小点 + 次级标签（拥挤区域自动省略标签）
    for (const a of airports) {
      if (a.kind !== 'plain') continue
      const [x, y] = project(p, a.lng, a.lat)
      if (x < 0 || x > w || y < 0 || y > h) continue
      ctx.fillStyle = COLORS.plain
      ctx.beginPath()
      ctx.arc(x, y, 2.4, 0, Math.PI * 2)
      ctx.fill()
      tryLabel(x, y, a.iata, '#8e8e93', 8, false)
    }
  }

  const handleTouchStart = (e: any) => {
    const touch = e.touches?.[0]
    touchStartRef.current = touch ? { x: touch.x ?? 0, y: touch.y ?? 0 } : null
  }

  const handleTouchEnd = (e: any) => {
    if (!onAirportTap) return
    const touch = e.changedTouches?.[0]
    if (!touch) return
    const x = touch.x ?? 0
    const y = touch.y ?? 0
    // 位移超过阈值视为滑动，不触发点击
    const start = touchStartRef.current
    if (start && Math.hypot(start.x - x, start.y - y) > 12) return
    let best: { iata: string; d: number } | null = null
    for (const hit of hitRef.current) {
      const d = Math.hypot(hit.x - x, hit.y - y)
      if (d <= 26 && (!best || d < best.d)) best = { iata: hit.iata, d }
    }
    if (best) onAirportTap(best.iata)
  }

  return (
    <View className='world-map' style={{ height: `${heightRpx}rpx` }}>
      <Canvas
        type='2d'
        id={canvasId}
        canvasId={canvasId}
        className='world-map__canvas'
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      />
    </View>
  )
}

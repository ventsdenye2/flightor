// src/components/trend/PriceTrendPanel.tsx — 价格趋势面板（Canvas 2D 手绘折线）
import { useEffect, useRef, useState } from 'react'
import { View, Text, Canvas, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import type { PriceTrendResponse } from '../../types/api'
import { t, monthLabel, localeStore } from '../../i18n'
import { formatPrice } from '../../utils/format'
import './PriceTrendPanel.scss'

interface PriceTrendPanelProps {
  trend: PriceTrendResponse
}

const SIGNAL_META = {
  buy: { labelKey: 'ptp.buy', color: '#30d158', descKey: 'ptp.buyDesc' },
  wait: { labelKey: 'ptp.wait', color: '#ff453a', descKey: 'ptp.waitDesc' },
  neutral: { labelKey: 'ptp.neutral', color: '#ff9f0a', descKey: 'ptp.neutralDesc' }
} as const

// 季节热力（静态经验值：1-12月出行热度 0-1）
const SEASON_HEAT = [0.35, 0.55, 0.4, 0.45, 0.5, 0.7, 0.9, 0.95, 0.6, 0.75, 0.4, 0.65]

function PriceTrendPanel({ trend }: PriceTrendPanelProps) {
  const [tooltip, setTooltip] = useState<{ x: number; text: string } | null>(null)
  const canvasWidthRef = useRef(0) // 实测画布宽度，供 tooltip 精确定位
  const signal = SIGNAL_META[trend.signal]
  const locale = localeStore.locale

  useEffect(() => {
    // Canvas 2D 初始化：createSelectorQuery 获取 node
    const query = Taro.createSelectorQuery()
    query
      .select('#trendCanvas')
      .fields({ node: true, size: true })
      .exec(res => {
        const info = res?.[0]
        if (!info?.node) return
        canvasWidthRef.current = info.width
        const canvas = info.node
        const ctx = canvas.getContext('2d')
        const dpr = Taro.getSystemInfoSync().pixelRatio || 2
        canvas.width = info.width * dpr
        canvas.height = info.height * dpr
        ctx.scale(dpr, dpr)
        drawChart(ctx, info.width, info.height)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trend, locale])

  function drawChart(ctx: any, w: number, h: number) {
    const { history, statistics } = trend
    const pad = { l: 8, r: 8, t: 16, b: 22 }
    const cw = w - pad.l - pad.r
    const ch = h - pad.t - pad.b
    const min = statistics.min30d * 0.96
    const max = statistics.max30d * 1.04
    const xOf = (i: number) => pad.l + (i / (history.length - 1)) * cw
    const yOf = (p: number) => pad.t + (1 - (p - min) / (max - min)) * ch

    ctx.clearRect(0, 0, w, h)

    // 网格线（浅色主题）
    ctx.strokeStyle = '#3a3a3c'
    ctx.lineWidth = 0.5
    for (let g = 0; g <= 3; g++) {
      const y = pad.t + (g / 3) * ch
      ctx.beginPath()
      ctx.moveTo(pad.l, y)
      ctx.lineTo(w - pad.r, y)
      ctx.stroke()
    }

    // 均值虚线
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = '#ff9f0a'
    ctx.beginPath()
    ctx.moveTo(pad.l, yOf(statistics.avg30d))
    ctx.lineTo(w - pad.r, yOf(statistics.avg30d))
    ctx.stroke()
    ctx.setLineDash([])

    // 渐变填充区域
    const grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b)
    grad.addColorStop(0, 'rgba(10,132,255,0.25)')
    grad.addColorStop(1, 'rgba(10,132,255,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.moveTo(xOf(0), h - pad.b)
    history.forEach((pt, i) => ctx.lineTo(xOf(i), yOf(pt.price)))
    ctx.lineTo(xOf(history.length - 1), h - pad.b)
    ctx.closePath()
    ctx.fill()

    // 价格折线（荧光青）
    ctx.strokeStyle = '#0a84ff'
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.beginPath()
    history.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(xOf(i), yOf(pt.price))
      else ctx.lineTo(xOf(i), yOf(pt.price))
    })
    ctx.stroke()

    // 最低点标记
    const lowIdx = history.findIndex(p => p.isLowest)
    if (lowIdx >= 0) {
      const lx = xOf(lowIdx)
      const ly = yOf(history[lowIdx].price)
      ctx.fillStyle = '#30d158'
      ctx.beginPath()
      ctx.arc(lx, ly, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#30d158'
      ctx.font = '10px sans-serif'
      ctx.textAlign = lx > w / 2 ? 'right' : 'left'
      ctx.fillText(t('ptp.lowest', { p: formatPrice(history[lowIdx].price) }), lx + (lx > w / 2 ? -8 : 8), ly - 8)
    }

    // 当前价格点
    const cx = xOf(history.length - 1)
    const cy = yOf(statistics.current)
    ctx.fillStyle = '#0a84ff'
    ctx.beginPath()
    ctx.arc(cx, cy, 4, 0, Math.PI * 2)
    ctx.fill()

    // X 轴日期标注（首/中/尾）
    ctx.fillStyle = 'rgba(235, 235, 245, 0.3)'
    ctx.font = '9px sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(history[0].date.slice(5), pad.l, h - 6)
    ctx.textAlign = 'center'
    ctx.fillText(history[Math.floor(history.length / 2)].date.slice(5), w / 2, h - 6)
    ctx.textAlign = 'right'
    ctx.fillText(history[history.length - 1].date.slice(5), w - pad.r, h - 6)
  }

  // 触摸显示价格 tooltip（基于实测画布宽度映射数据点）
  const handleTouch = (e: any) => {
    const touch = e.touches?.[0]
    if (!touch) return
    const x = touch.x ?? touch.clientX ?? 0
    const canvasW = canvasWidthRef.current
    if (!canvasW) return
    const idx = Math.max(0, Math.min(trend.history.length - 1, Math.round((x / canvasW) * (trend.history.length - 1))))
    const pt = trend.history[idx]
    setTooltip({ x, text: `${pt.date.slice(5)} · ${formatPrice(pt.price)}` })
  }

  return (
    <View className='ptp'>
      {/* 信号灯 */}
      <View className='ptp__signal-row'>
        <View className='ptp__signal'>
          <View className='ptp__signal-light' style={{ background: signal.color }} />
          <View>
            <Text className='ptp__signal-label' style={{ color: signal.color }}>{t(signal.labelKey)}</Text>
            <Text className='ptp__signal-desc'>{t(signal.descKey)}</Text>
          </View>
        </View>
        <View className='ptp__percentile'>
          <Text className='font-code ptp__percentile-num'>{trend.statistics.percentile}</Text>
          <Text className='ptp__percentile-label'>{t('ptp.percentile')}</Text>
        </View>
      </View>

      {/* 统计仪表行 */}
      <View className='ptp__stats'>
        <View className='ptp__stat'>
          <Text className='ptp__stat-label'>{t('ptp.current')}</Text>
          <Text className='font-code ptp__stat-value'>{formatPrice(trend.statistics.current)}</Text>
        </View>
        <View className='ptp__stat'>
          <Text className='ptp__stat-label'>{t('ptp.avg')}</Text>
          <Text className='font-code ptp__stat-value'>{formatPrice(trend.statistics.avg30d)}</Text>
        </View>
        <View className='ptp__stat'>
          <Text className='ptp__stat-label'>{t('ptp.low')}</Text>
          <Text className='font-code ptp__stat-value ptp__stat-value--low'>{formatPrice(trend.statistics.min30d)}</Text>
        </View>
        <View className='ptp__stat'>
          <Text className='ptp__stat-label'>{t('ptp.high')}</Text>
          <Text className='font-code ptp__stat-value ptp__stat-value--high'>{formatPrice(trend.statistics.max30d)}</Text>
        </View>
      </View>

      {/* 折线图 */}
      <View className='ptp__chart-wrap'>
        <Canvas
          type='2d'
          id='trendCanvas'
          canvasId='trendCanvas'
          className='ptp__canvas'
          onTouchStart={handleTouch}
          onTouchMove={handleTouch}
          onTouchEnd={() => setTooltip(null)}
        />
        {tooltip && (
          <View className='ptp__tooltip' style={{ left: `${tooltip.x}px` }}>
            <Text>{tooltip.text}</Text>
          </View>
        )}
      </View>

      {/* 最优预订窗口 */}
      <View className='ptp__window'>
        <Text>
          {t('ptp.window', { a: trend.bestBookingWindow.daysBeforeDeparture[0], b: trend.bestBookingWindow.daysBeforeDeparture[1] })}
        </Text>
      </View>

      {/* 季节热力图 */}
      <ScrollView scrollX className='ptp__season-scroll' showScrollbar={false}>
        <View className='ptp__season'>
          {SEASON_HEAT.map((heat, i) => (
            <View key={i} className='ptp__season-cell'>
              <View
                className='ptp__season-bar'
                style={{
                  height: `${24 + heat * 56}rpx`,
                  background: heat > 0.7 ? '#ff453a' : heat > 0.5 ? '#ff9f0a' : '#30d158'
                }}
              />
              <Text className='ptp__season-label'>{monthLabel(i)}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
      <Text className='ptp__season-hint'>{t('ptp.seasonHint')}</Text>
    </View>
  )
}

export default observer(PriceTrendPanel)

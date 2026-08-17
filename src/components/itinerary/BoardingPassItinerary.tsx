// src/components/itinerary/BoardingPassItinerary.tsx — 登机牌式行程单（可导出图片/分享）
import { View, Text, Canvas, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { observer } from 'mobx-react-lite'
import type { ItinerarySegment } from '../../types/flight'
import { t, fd } from '../../i18n'
import { formatTime, formatMonthDay } from '../../utils/format'
import './BoardingPassItinerary.scss'

interface BoardingPassItineraryProps {
  itinerary: ItinerarySegment[]
  passenger?: string
  shareTitle?: string
}

const EXPORT_W = 620
const ROW_FLIGHT = 130
const ROW_LAYOVER = 70

function BoardingPassItinerary({ itinerary, passenger, shareTitle }: BoardingPassItineraryProps) {
  const passengerName = passenger ?? t('bpi.passenger')

  // ---------- Canvas 导出（暗色主题） ----------
  const handleExport = async () => {
    Taro.showLoading({ title: t('bpi.rendering') })
    try {
      const height = 120 + itinerary.reduce((s, seg) => s + (seg.type === 'flight' ? ROW_FLIGHT : ROW_LAYOVER), 0) + 60
      const query = Taro.createSelectorQuery()
      const info = await new Promise<any>(resolve => {
        query.select('#bpCanvas').fields({ node: true, size: true }).exec(res => resolve(res?.[0]))
      })
      if (!info?.node) throw new Error('canvas not found')
      const canvas = info.node
      const dpr = 2
      canvas.width = EXPORT_W * dpr
      canvas.height = height * dpr
      const ctx = canvas.getContext('2d')
      ctx.scale(dpr, dpr)

      // 背景
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, EXPORT_W, height)

      // 头部
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 22px sans-serif'
      ctx.fillText(t('bpi.brandLine'), 24, 50)
      ctx.fillStyle = 'rgba(235, 235, 245, 0.6)'
      ctx.font = '13px sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(passengerName, EXPORT_W - 24, 46)
      ctx.textAlign = 'left'

      let y = 100
      itinerary.forEach(seg => {
        if (seg.type === 'flight') {
          // 登机牌卡片
          ctx.fillStyle = '#1c1c1e'
          ctx.strokeStyle = '#3a3a3c'
          roundRect(ctx, 20, y, EXPORT_W - 40, ROW_FLIGHT - 14, 12)
          ctx.fill()
          ctx.stroke()

          ctx.fillStyle = '#0a84ff'
          ctx.font = 'bold 16px Menlo, monospace'
          ctx.fillText(`${seg.flightNo}`, 40, y + 30)
          ctx.fillStyle = 'rgba(235, 235, 245, 0.6)'
          ctx.font = '12px sans-serif'
          ctx.fillText(`${seg.airline ?? ''}`, 130, y + 30)

          ctx.fillStyle = '#ffffff'
          ctx.font = 'bold 22px Menlo, monospace'
          ctx.fillText(`${seg.origin} ${seg.departTime ? formatTime(seg.departTime) : ''}`, 40, y + 66)
          ctx.fillStyle = '#0a84ff'
          ctx.fillText('→', 268, y + 66)
          ctx.fillStyle = '#ffffff'
          ctx.fillText(`${seg.destination} ${seg.arriveTime ? formatTime(seg.arriveTime) : ''}`, 300, y + 66)

          ctx.fillStyle = 'rgba(235, 235, 245, 0.3)'
          ctx.font = '12px sans-serif'
          const meta = [
            seg.departTime ? formatMonthDay(seg.departTime) : '',
            seg.terminal ? t('bpi.terminal', { t: seg.terminal }) : '',
            seg.gate ? t('bpi.gate', { g: seg.gate }) : ''
          ].filter(Boolean).join(' · ')
          ctx.fillText(meta, 40, y + 96)
          y += ROW_FLIGHT
        } else {
          // 中转段
          ctx.strokeStyle = '#3a3a3c'
          ctx.setLineDash([6, 6])
          ctx.beginPath()
          ctx.moveTo(40, y + 26)
          ctx.lineTo(EXPORT_W - 40, y + 26)
          ctx.stroke()
          ctx.setLineDash([])
          ctx.fillStyle = '#ff9f0a'
          ctx.font = '13px sans-serif'
          const label = t('bpi.layover', { iata: seg.origin ?? '', dur: seg.duration ? fd(seg.duration) : '' })
          ctx.fillText(seg.visaStatus ? `${label} · ${seg.visaStatus}` : label, 40, y + 52)
          y += ROW_LAYOVER
        }
      })

      // 底部水印
      ctx.fillStyle = 'rgba(235, 235, 245, 0.3)'
      ctx.font = '11px sans-serif'
      ctx.fillText(t('bpi.watermark'), 24, height - 24)

      const { tempFilePath } = await Taro.canvasToTempFilePath({
        // @ts-ignore Canvas 2D 导出需传 canvas 实例
        canvas,
        fileType: 'png'
      })
      Taro.hideLoading()
      await Taro.saveImageToPhotosAlbum({ filePath: tempFilePath })
      Taro.showToast({ title: t('bpi.saved'), icon: 'success' })
    } catch (e) {
      Taro.hideLoading()
      if (String((e as any)?.errMsg ?? '').includes('auth')) {
        Taro.showToast({ title: t('bpi.auth'), icon: 'none' })
      } else {
        Taro.showToast({ title: t('bpi.failed'), icon: 'none' })
      }
    }
  }

  return (
    <View className='bpi'>
      <View className='bpi__header'>
        <Text className='bpi__title'>{t('bpi.title')}</Text>
        <Text className='bpi__passenger'>{passengerName}</Text>
      </View>

      {itinerary.map((seg, i) =>
        seg.type === 'flight' ? (
          <View key={i} className='bpi__flight'>
            <View className='bpi__flight-head'>
              <Text className='font-code bpi__flight-no'>{seg.flightNo}</Text>
              <Text className='bpi__flight-airline'>{seg.airline}</Text>
            </View>
            <View className='bpi__flight-route'>
              <View className='bpi__flight-point'>
                <Text className='font-code bpi__flight-iata'>{seg.origin}</Text>
                <Text className='bpi__flight-time'>{seg.departTime ? formatTime(seg.departTime) : '—'}</Text>
                <Text className='bpi__flight-date'>{seg.departTime ? formatMonthDay(seg.departTime) : ''}</Text>
              </View>
              <View className='bpi__flight-track'>
                <View className='bpi__flight-line' />
                <Text className='bpi__flight-plane'>✈</Text>
                <View className='bpi__flight-line' />
              </View>
              <View className='bpi__flight-point bpi__flight-point--right'>
                <Text className='font-code bpi__flight-iata'>{seg.destination}</Text>
                <Text className='bpi__flight-time'>{seg.arriveTime ? formatTime(seg.arriveTime) : '—'}</Text>
                <Text className='bpi__flight-date'>{seg.arriveTime ? formatMonthDay(seg.arriveTime) : ''}</Text>
              </View>
            </View>
            <View className='bpi__flight-meta'>
              {seg.terminal && <Text className='bpi__meta-chip'>{t('bpi.terminal', { t: seg.terminal })}</Text>}
              {seg.gate && <Text className='bpi__meta-chip'>{t('bpi.gate', { g: seg.gate })}</Text>}
              {seg.duration != null && <Text className='bpi__meta-chip'>{fd(seg.duration)}</Text>}
              <View className='bpi__barcode' />
            </View>
          </View>
        ) : (
          <View key={i} className='bpi__layover'>
            <View className='bpi__layover-line' />
            <View className='bpi__layover-info'>
              <Text className='bpi__layover-title'>
                {t('bpi.layover', { iata: seg.origin ?? '', dur: seg.duration ? fd(seg.duration) : '' })}
              </Text>
              {seg.visaStatus && <Text className='bpi__layover-visa'>{seg.visaStatus}</Text>}
              {seg.playTip && <Text className='bpi__layover-tip'>💡 {seg.playTip}</Text>}
            </View>
          </View>
        )
      )}

      {/* 操作区 */}
      <View className='bpi__actions'>
        <Button className='bpi__btn bpi__btn--share' openType='share' plain>
          <Text>{t('bpi.share')}</Text>
        </Button>
        <View className='bpi__btn bpi__btn--export' hoverClass='tap-dim' onClick={handleExport}>
          <Text>{t('bpi.export')}</Text>
        </View>
      </View>
      {shareTitle && <Text className='bpi__share-hint'>{t('bpi.shareHint', { title: shareTitle })}</Text>}

      {/* 离屏导出画布 */}
      <Canvas type='2d' id='bpCanvas' canvasId='bpCanvas' className='bpi__canvas' />
    </View>
  )
}

function roundRect(ctx: any, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export default observer(BoardingPassItinerary)

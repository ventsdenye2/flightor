import { useEffect, useState } from 'react'
import { Text, View } from '@tarojs/components'
import type { ConversationTurnProgress } from '../../services/conversationService'
import type { Locale } from '../../i18n'
import './PlannerProgress.scss'

const STAGES = {
  thinking: ['正在思考下一步', 'Thinking through the next step'],
  updating_trip: ['正在更新行程条件', 'Updating your trip preferences'],
  searching_flights: ['正在查询机票', 'Checking flight options'],
  researching: ['正在研究目的地与活动', 'Researching places and activities'],
  building_itinerary: ['正在安排游玩行程', 'Putting your itinerary together'],
  finalizing: ['正在整理结果', 'Preparing your results']
} as const

/** Displays one current execution stage; neither the text nor clock enters chat state. */
export default function PlannerProgress({ progress, locale, compact = false, active = true }: {
  progress?: ConversationTurnProgress
  locale: Locale
  /** Use the lighter layout inside the new planning conversation. */
  compact?: boolean
  /** An inactive or completed compact view keeps no running clock or visible status. */
  active?: boolean
}) {
  const visible = active && !(compact && progress?.connection === 'completed')
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!visible) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [visible, progress?.startedAt])

  if (!visible) return null

  const en = locale === 'en'
  const confirmed = progress?.connection === 'running'
    && progress.lastConfirmedAt !== undefined
    && now - progress.lastConfirmedAt < 15_000
  const reconnecting = progress?.connection === 'reconnecting'
    || (progress?.connection === 'running' && !confirmed)
  const completed = progress?.connection === 'completed'
  const stage = progress?.stage ? STAGES[progress.stage][en ? 1 : 0] : ''
  const title = reconnecting
    ? (en ? 'Checking the connection…' : '正在确认连接…')
    : completed
      ? (en ? 'Displaying your results' : '正在显示结果')
      : confirmed && stage
        ? stage
        : progress?.connection === 'connecting'
          ? (en ? 'Connecting to your planner' : '正在连接规划助手')
          : (en ? 'Working on your request' : '正在处理你的请求')
  const detail = reconnecting
    ? (en ? 'Connection is not confirmed. Checking again automatically.' : '暂时无法确认连接，正在自动重试')
    : completed
      ? (en ? 'The reply is ready. Loading saved results.' : '回复已就绪，正在加载已保存的结果')
      : confirmed
        ? (en ? 'Connected · Your planner is still working' : '连接正常 · Agent 仍在处理')
        : (en ? 'Waiting for a status update…' : '正在等待状态确认…')
  const elapsed = progress ? Math.max(0, Math.floor((now - progress.startedAt) / 1_000)) : undefined
  const elapsedLabel = elapsed === undefined ? '' : en ? `${elapsed}s elapsed` : `已等待 ${elapsed} 秒`

  if (compact) {
    const connectionLabel = reconnecting
      ? (en ? 'Reconnecting automatically' : '正在自动重连')
      : confirmed
        ? (en ? 'Connected' : '连接正常')
        : (en ? 'Waiting for confirmation' : '等待连接确认')
    return (
      <View className={`planner-progress planner-progress--compact${reconnecting ? ' planner-progress--reconnecting' : ''}`}>
        <View className='planner-progress__head' role='status' aria-live='polite' aria-atomic>
          <View className='planner-progress__spinner' aria-hidden />
          <Text className='planner-progress__title'>{title}</Text>
        </View>
        {reconnecting && stage && (
          <Text className='planner-progress__previous'>{en ? 'Last confirmed: ' : '最近确认：'}{stage}</Text>
        )}
        <View className='planner-progress__meta'>
          <Text>{connectionLabel}</Text>
          {elapsedLabel && <Text className='planner-progress__elapsed'>{elapsedLabel}</Text>}
        </View>
      </View>
    )
  }

  return (
    <View className={`planner-progress${reconnecting ? ' planner-progress--reconnecting' : ''}`}>
      <View className='planner-progress__head'>
        <View className='planner-progress__spinner' />
        <Text className='planner-progress__title'>{title}</Text>
      </View>
      <Text className='planner-progress__detail'>{detail}</Text>
      {reconnecting && stage && (
        <Text className='planner-progress__previous'>{en ? 'Last activity: ' : '上次状态：'}{stage}</Text>
      )}
      {elapsedLabel && <Text className='planner-progress__elapsed'>{elapsedLabel}</Text>}
    </View>
  )
}

import { useEffect, useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import { localeStore } from '../../i18n'
import { tripText } from '../../i18n/trip'
import type { Activity, SourcePresentation } from './presentation'
import type { TripExperienceProps } from './TripExperience'
import { DayPlan } from './DayPlan'
import { FlightTicket } from './FlightTicket'
import { Icon, Photo } from './VisualMedia'

/** The production branch shares the existing travel layout; audit prose is never UI copy. */
export default function PublishedTripExperience({ trip, onBack, onContinuePlanning, onOpenSource, onRefresh,
  onPrepareLocale, publicationBusy = false, publicationError = '', initialTab = 'overview' }: TripExperienceProps) {
  const locale = trip.locale ?? 'zh'
  const tt = (key: string, params?: Record<string, string | number>) => tripText(locale, key, params)
  const [tab, setTab] = useState(initialTab)
  const [dayIndex, setDayIndex] = useState(0)
  const [activity, setActivity] = useState<Activity | null>(null)
  const [credits, setCredits] = useState(false)
  useEffect(() => { setActivity(null); setCredits(false); setDayIndex(0) }, [trip.days, locale])
  const pub = trip.publication
  const state = pub?.status ?? 'legacy'
  const accepted = state === 'accepted'
  const day = trip.days[dayIndex]
  const firstFlight = trip.flights[0]
  const flightStatus = tt(trip.flightArrangement === 'self_provided' ? 'trip.selfProvided'
    : trip.flightArrangement === 'selected' ? firstFlight ? 'trip.selectedFlight' : 'trip.flightMissing' : 'trip.flightPending')
  const dates = [trip.dates.start, trip.dates.end].filter(Boolean).join(' – ') || tt('trip.dateUnknown')
  const mediaSources = trip.days.flatMap(day => day.activities.flatMap(item => item.media?.source ? [item.media.source] : []))
  const sourceButton = (source: SourcePresentation, index: number) => <Button key={`${source.url ?? source.label}-${index}`} className='ux-credit'
    onClick={() => source.url && onOpenSource?.(source.url)} disabled={!source.url}>
    <Text>{source.label}</Text>{source.url ? <Icon name='external' /> : null}</Button>
  return <View className='ux-app ux-embedded ux-published'>
    <View className='ux-header'>
      <Button className='ux-icon-button' ariaLabel={tt('trip.back')} onClick={() => tab === 'overview' ? onBack?.() : setTab('overview')}><Icon name='chevron-left' /></Button>
      <Text className='ux-header-title'>{tt('trip.details')}</Text>
      <Button className='ux-text-button ux-locale-toggle' ariaLabel={tt('trip.language')} onClick={() => localeStore.setLocale(locale === 'zh' ? 'en' : 'zh')}>{locale === 'zh' ? 'English' : '中文'}</Button>
    </View>
    <View className='ux-scroll'>
      {tab === 'overview' ? <View className='ux-intro'>
        {trip.cover?.src ? <Photo src={trip.cover.src} description={trip.cover.description} className='ux-hero' /> : null}
        <Text className='ux-caption'>{tt('trip.saved')}</Text>
        <Text className='ux-title'>{trip.destination}</Text>
        <Text className='ux-route'>{trip.route.join(' → ') || tt('trip.routePending')}</Text>
        <Text className='ux-dates'>{dates}{trip.durationDays ? ` · ${tt('trip.duration', { n: trip.durationDays })}` : ''}</Text>
        {accepted ? <Text className='ux-trip-overview'>{trip.description}</Text> : null}
        {trip.budget ? <View className='ux-guide-budget'><Text className='ux-section-title'>{tt('trip.budget')} · {trip.budget.label}</Text>
          <Text className='ux-guide-budget-value'>{trip.budget.currency} {trip.budget.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}</Text>
          <Text className='ux-caption'>{tt('trip.budgetHint')}</Text></View> : null}
      </View> : null}
      <View className={`ux-publication-state ux-publication-state--${state}`} role={accepted ? 'status' : 'alert'}>
        <Text className='ux-section-title'>{publicationBusy ? tt('trip.generating') : tt(`trip.${state}`)}</Text>
        {!accepted ? <Text className='ux-muted'>{trip.description}</Text> : null}
        {pub?.issues.map((issue, index) => <Text key={`${issue.activityId}-${index}`} className='ux-issue' data-activity-id={issue.activityId}>{issue.label}</Text>)}
        {accepted ? trip.risks?.map((risk, index) => <Text key={index} className='ux-issue'>{risk}</Text>) : null}
        {publicationError ? <Text className='ux-issue'>{publicationError}</Text> : null}
        {!accepted ? <View className='ux-publication-actions'>
          {pub?.canLocalize && state === 'preparing' ? <Button className='ux-primary ux-prepare-locale' disabled={publicationBusy} onClick={() => onPrepareLocale?.()}>{tt('trip.prepare')}</Button> : null}
          {pub?.canLocalize && pub.canRetry && state === 'retryable' ? <Button className='ux-primary ux-retry-locale' disabled={publicationBusy} onClick={() => onPrepareLocale?.(pub.revision)}>{tt('trip.retry')}</Button> : null}
          {state === 'retryable' && !pub?.canRetry ? <Text className='ux-muted'>{tt('trip.retryUnavailable')}</Text> : null}
          <Button className='ux-text-button ux-refresh-status' disabled={publicationBusy} onClick={onRefresh}>{tt('trip.refresh')}</Button>
          <Button className='ux-text-button' onClick={onContinuePlanning}>{tt('trip.revise')}</Button>
        </View> : null}
      </View>
      <View className='ux-tabs' role='tablist' ariaLabel={tt('trip.details')}>
        {(['overview', 'days', 'flights'] as const).map(value => <Button key={value} className={`ux-tab ${tab === value ? 'is-active' : ''}`} aria-selected={tab === value} onClick={() => setTab(value)}>{tt(`trip.${value}`)}</Button>)}
      </View>
      {tab === 'overview' ? <View className='ux-overview'>
        <View className='ux-flight-status'><Icon name='plane' /><Text>{flightStatus}</Text></View>
        {firstFlight ? <FlightTicket flight={firstFlight} locale={locale} onExpand={() => setTab('flights')} /> : null}
        {accepted ? <View className='ux-day-previews'>{trip.days.map((day, index) => <Button key={day.id} className='ux-day-teaser' onClick={() => { setDayIndex(index); setTab('days') }}>
          <View><Text className='ux-caption'>{day.label}</Text><Text className='ux-section-title'>{day.title}</Text><Text className='ux-muted'>{day.activities.map(item => item.name).join(' · ') || tt('trip.freeDay')}</Text></View><Icon name='chevron-right' />
        </Button>)}</View> : null}
      </View> : tab === 'days' ? accepted && day ? <>
        <View className='ux-day-selector'>{trip.days.map((day, index) => <Button key={day.id} className={`ux-day-chip ${dayIndex === index ? 'is-active' : ''}`} aria-pressed={dayIndex === index} onClick={() => setDayIndex(index)}>{day.label}</Button>)}</View>
        <DayPlan day={day} dayNumber={dayIndex + 1} locale={locale} published onActivity={setActivity} onAdjust={() => onContinuePlanning?.()} />
      </> : <View className='ux-empty-compact'><Text>{tt(`trip.${state}`)}</Text></View>
        : <View className='ux-flight-page'>{trip.flights.length ? trip.flights.map(flight => <FlightTicket key={flight.id} flight={flight} locale={locale} expanded onOpenSource={onOpenSource} />)
          : <View className='ux-flight-status'><Icon name='plane' /><Text>{flightStatus}</Text></View>}</View>}
      <View className='ux-footer-note'><Button className='ux-text-button' onClick={() => setCredits(true)}>{tt('trip.sources')}<Icon name='external' /></Button></View>
    </View>
    {activity || credits ? <View className='ux-modal' onClick={() => { setActivity(null); setCredits(false) }}>
      <View className='ux-sheet' role='dialog' aria-modal='true' ariaLabel={activity?.name ?? tt('trip.sources')} onClick={event => event.stopPropagation()}>
        <View className='ux-sheet-handle' /><Button className='ux-icon-button ux-sheet-close' ariaLabel={tt('trip.close')} onClick={() => { setActivity(null); setCredits(false) }}><Icon name='close' /></Button>
        {activity ? <>
          {activity.media?.src ? <><Photo src={activity.media.src} description={activity.media.description} className='ux-detail-photo' />{activity.media.source ? sourceButton(activity.media.source, 0) : null}</>
            : <View className='ux-media-compact'><Icon name='image' /><Text>{tt('trip.photoPending')}</Text></View>}
          <Text className='ux-detail-title'>{activity.name}</Text>
          <Text className='ux-muted'>{activity.area} · {activity.time || tt('trip.flexible')} · {activity.category}</Text>
          <View className='ux-detail-section'><Text className='ux-section-title'>{tt('trip.introduction')}</Text><Text className='ux-detail-copy'>{activity.introduction}</Text></View>
          <View className='ux-detail-section'><Text className='ux-section-title'>{tt('trip.reason')}</Text><Text className='ux-detail-copy'>{activity.recommendationReason}</Text></View>
          <Button className='ux-primary' onClick={onContinuePlanning}>{tt('trip.adjustDay')}</Button>
        </> : <><Text className='ux-detail-title'>{tt('trip.sources')}</Text>{[...trip.sources, ...mediaSources].map(sourceButton)}{!trip.sources.length && !mediaSources.length ? <Text className='ux-muted'>{tt('trip.noSources')}</Text> : null}</>}
      </View>
    </View> : null}
  </View>
}

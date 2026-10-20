import { useEffect, useRef, useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import { PlanCancellation } from './backendClient'
import type { Conversation, ConversationClient, FlightSearchQuery } from './backendClient'
import type { FlightOption } from './flightOptions'
import type { FlightSearchDataset } from './flightSamples'
import { validFlightDate } from './flightSamples'
import { FlightChoices } from './FlightChoices'
import { PageHeader } from './SharedUI'
import { Icon } from './VisualMedia'
import { FlightDatePicker, FlightLocationPicker } from './FlightSearchPickers'
import './flights.scss'

export function LiveFlightExplorer({ client, dataset, onBack, onConversationChange }: {
  client: ConversationClient; dataset: FlightSearchDataset; onBack: () => void; onConversationChange?: () => void
}) {
  const [form, setForm] = useState({ from: dataset.origin, to: dataset.destination, fromCode: dataset.origin, toCode: dataset.destination, fromName: dataset.originName, toName: dataset.destinationName, date: '', returnDate: '', roundTrip: false, adults: 1 })
  const [picker, setPicker] = useState<'from' | 'to' | 'departure' | 'return' | null>(null)
  const [result, setResult] = useState<Conversation | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')
  const active = useRef<PlanCancellation | null>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; active.current?.abort() } }, [])
  const search = async () => {
    if (active.current || saving) return
    if (!form.from.trim() || !form.to.trim()) { setError('请填写出发地和目的地。'); return }
    if (form.from.trim().toUpperCase() === form.to.trim().toUpperCase()) { setError('出发地和目的地不能相同。'); return }
    if (!validFlightDate(form.date)) { setError('请选择去程日期。'); return }
    if (form.roundTrip && !validFlightDate(form.returnDate)) { setError('往返查询还需要返程日期。'); return }
    if (form.roundTrip && form.returnDate < form.date) { setError('返程日期不能早于去程日期。'); return }
    const controller = new PlanCancellation()
    active.current = controller; setBusy(true); setError(''); setResult(null); setProgress('正在查询航班…')
    const query: FlightSearchQuery = { origin: form.from.trim(), destination: form.to.trim(), departureDate: form.date,
      tripType: form.roundTrip ? 'round_trip' : 'one_way', ...(form.roundTrip ? { returnDate: form.returnDate } : {}), adults: form.adults, cabin: 'economy', currency: 'CNY' }
    try {
      const conversation = await client.searchFlights!(query, text => { if (!controller.signal.aborted) setProgress(text) }, controller.signal)
      if (controller.signal.aborted) return
      setResult(conversation); onConversationChange?.()
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '航班查询未完成，请重试。')
    } finally {
      if (active.current === controller) { active.current = null; setBusy(false); setProgress('') }
    }
  }
  const cancel = () => { active.current?.abort(); active.current = null; setBusy(false); setProgress('') }
  const select = async (option: FlightOption | null) => {
    if (!result?.flightOptions || saving || busy) return
    setSaving(true); setError('')
    try {
      const conversation = await client.selectFlight(option ? { searchId: result.flightOptions.searchId, candidateId: option.id } : null)
      if (mounted.current) setResult(conversation)
      onConversationChange?.()
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : '选择未保存，请重试。') }
    finally { if (mounted.current) setSaving(false) }
  }
  return <>
    <PageHeader title='找一张合适的机票' onBack={onBack} />
    <View className='ux-scroll fl-page fl-live-page'>
      <View className='fl-intro'><Text className='fl-title'>让出发，刚刚好。</Text><Text className='fl-subtitle'>在价格、时间与中转之间，找到你的平衡。</Text></View>
      <View className='fl-search-box'>
        <View className='fl-search-top'><View className='fl-trip-types'>{[false, true].map(roundTrip => <Button key={String(roundTrip)} className={`fl-trip-type ${form.roundTrip === roundTrip ? 'is-active' : ''}`} aria-pressed={form.roundTrip === roundTrip} disabled={busy} onClick={() => setForm({ ...form, roundTrip })}>{roundTrip ? '往返' : '单程'}</Button>)}</View><Text className='fl-secondary-text'>经济舱 · 人民币</Text></View>
        <View className='fl-airports'>
          <View className='fl-field'><Text className='fl-field-label'>从哪里出发</Text><Button className='fl-location-trigger' ariaLabel={`选择出发地，${form.fromName}`} disabled={busy} onClick={() => setPicker('from')}><Text className='fl-location-value'>{form.fromCode}</Text><Text className='fl-location-name'>{form.fromName}</Text></Button></View>
          <Button className='fl-swap' ariaLabel='交换出发地和目的地' disabled={busy} onClick={() => setForm({ ...form, from: form.to, to: form.from, fromCode: form.toCode, toCode: form.fromCode, fromName: form.toName, toName: form.fromName })}><Icon name='swap' /></Button>
          <View className='fl-field'><Text className='fl-field-label'>想去哪里</Text><Button className='fl-location-trigger' ariaLabel={`选择目的地，${form.toName}`} disabled={busy} onClick={() => setPicker('to')}><Text className='fl-location-value'>{form.toCode}</Text><Text className='fl-location-name'>{form.toName}</Text></Button></View>
        </View>
        <View className='fl-search-bottom'>
          <View className='fl-date-field'><Text className='fl-field-label'>去程日期</Text><Button className='fl-date-trigger' ariaLabel={`选择去程日期${form.date ? '，' + form.date : ''}`} disabled={busy} onClick={() => setPicker('departure')}><Icon name='calendar' /><Text>{form.date || '选择日期'}</Text></Button></View>
          {form.roundTrip ? <View className='fl-date-field'><Text className='fl-field-label'>返程日期</Text><Button className='fl-date-trigger' ariaLabel={`选择返程日期${form.returnDate ? '，' + form.returnDate : ''}`} disabled={busy} onClick={() => setPicker('return')}><Icon name='calendar' /><Text>{form.returnDate || '选择日期'}</Text></Button></View> : null}
        </View>
        <View className='fl-live-passengers'><Text className='fl-field-label'>成人</Text><View className='fl-stepper'><Button ariaLabel='减少成人' disabled={busy || form.adults <= 1} onClick={() => setForm(current => ({ ...current, adults: Math.max(1, current.adults - 1) }))}><Icon name='minus' /></Button><Text>{form.adults}</Text><Button ariaLabel='增加成人' disabled={busy || form.adults >= 9} onClick={() => setForm(current => ({ ...current, adults: Math.min(9, current.adults + 1) }))}><Icon name='plus' /></Button></View></View>
        {error ? <View className='fl-form-error' role='alert'>{error}</View> : null}
        <Button className='ux-primary fl-search-button' disabled={busy || saving} onClick={search}><Icon name='plane' />{busy ? '正在查询…' : '搜索航班'}</Button>
      </View>
      {busy ? <View className='fl-loading' role='status'><View className='fl-loading-line' /><Text>{progress}</Text><Button className='ux-text-button' onClick={cancel}>取消搜索</Button></View> : null}
      {result?.flightOptions ? <View className='fl-live-results'><FlightChoices result={result.flightOptions} selected={result.selectedFlight || null} disabled={saving || busy} locked={!!result.flightSelectionLocked} onSelect={select} /></View> : null}
    </View>
    {picker === 'from' || picker === 'to' ? <FlightLocationPicker title={picker === 'from' ? '选择出发地' : '选择目的地'} initial='' client={client} onClose={() => setPicker(null)} onSelect={location => {
      setForm(current => picker === 'from' ? { ...current, from: location.value, fromCode: location.code, fromName: location.label } : { ...current, to: location.value, toCode: location.code, toName: location.label }); setPicker(null); setError('')
    }} /> : picker === 'departure' || picker === 'return' ? <FlightDatePicker departure={form.date} returning={form.returnDate} roundTrip={form.roundTrip} initialTarget={picker} onClose={() => setPicker(null)} onConfirm={(date, returnDate) => { setForm(current => ({ ...current, date, returnDate })); setPicker(null); setError('') }} /> : null}
  </>
}

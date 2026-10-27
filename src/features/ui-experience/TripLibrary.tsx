import {useEffect,useState} from 'react'
import {Button,Text,View} from '@tarojs/components'
import {ScrollPanel} from './ScrollPanel'
import {PageHeader,EmptyState,Sheet} from './SharedUI'
import {Icon,Photo} from './VisualMedia'
import {formatTripDates,tripDurationLabel,travelerLabel} from './presentation'
import type {ConversationClient,SavedTripSummary} from './backendClient'
import type {MediaPresentation} from './presentation'
import './library.scss'

export function TripLibrary({client,active,version,covers={},onOpen,onPlan}:{client:ConversationClient;active:boolean;version:string;covers?:Record<string,MediaPresentation>;onOpen:(trip:SavedTripSummary)=>Promise<void>;onPlan:()=>void}) {
  const [trips,setTrips]=useState<SavedTripSummary[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState('')
  const [filter,setFilter]=useState<'upcoming'|'archived'>('upcoming'),[menu,setMenu]=useState<SavedTripSummary|null>(null)
  const [opening,setOpening]=useState<string|null>(null),[saving,setSaving]=useState(false),[refresh,setRefresh]=useState(0)
  useEffect(()=>{
    if(!active){setMenu(null);return}
    let current=true;setLoading(true);setError('')
    client.listTrips!().then(rows=>{if(current)setTrips(rows)}).catch(failure=>{if(current)setError(failure instanceof Error?failure.message:'行程列表暂时无法载入')}).finally(()=>{if(current)setLoading(false)})
    return()=>{current=false}
  },[client,active,version,refresh])
  const open=async(trip:SavedTripSummary)=>{
    if(opening)return
    setOpening(trip.id);setError('')
    try{await onOpen(trip)}catch(failure){setError(failure instanceof Error?failure.message:'行程暂时无法打开')}
    finally{setOpening(null)}
  }
  const archive=async()=>{
    if(!menu||saving)return
    setSaving(true);setError('')
    try{
      await client.archiveTrip!(menu.id,!menu.archived)
      setTrips(current=>current.map(trip=>trip.id===menu.id?{...trip,archived:!menu.archived}:trip))
      setFilter(menu.archived?'upcoming':'archived');setMenu(null)
    }catch(failure){setError(failure instanceof Error?failure.message:'归档未保存，请重试')}
    finally{setSaving(false)}
  }
  const shown=trips.filter(trip=>trip.archived===(filter==='archived')).map(trip=>covers[trip.id]?.src?{...trip,cover:covers[trip.id]}:trip)
  return <><PageHeader title='我的行程' action={<Button className='ux-text-button' onClick={onPlan}>新建行程<Icon name='arrow-right'/></Button>}/>
    <ScrollPanel className='ux-scroll ui-page'>
      <Text className='ui-display'>把期待，排进日历。</Text><Text className='ux-muted'>每段旅行都留在这里，随时回来接着安排。</Text>
      <View className='ui-segment'>{([{id:'upcoming',label:'待出发'},{id:'archived',label:'已归档'}] as const).map(item=><Button key={item.id} aria-pressed={filter===item.id} className={`ui-segment-button ${filter===item.id?'is-active':''}`} onClick={()=>setFilter(item.id)}>{item.label}</Button>)}</View>
      {loading?<View role='status'><Text>正在载入行程…</Text></View>:null}
      {error?<View role='alert'><Text>{error}</Text><Button className='ux-text-button' onClick={()=>setRefresh(value=>value+1)}>重新载入</Button></View>:null}
      {shown.map(trip=><View className='lb-trip' key={trip.id}>
        <Button className='lb-trip-cover' ariaLabel={`打开行程：${trip.title}`} disabled={!!opening} onClick={()=>open(trip)}><Photo src={trip.cover?.src} candidates={trip.cover?.candidates} description={trip.cover?.description||'图片待补充'} className='lb-trip-photo'/></Button>
        <View className='lb-trip-body'><View className='lb-trip-title'><View><Text className='ui-display'>{trip.title}</Text><Text className='ux-muted'>{formatTripDates(trip)} · {tripDurationLabel(trip)} · {travelerLabel(trip)}</Text></View><Button className='ux-icon-button' ariaLabel={`管理行程：${trip.title}`} disabled={saving} onClick={()=>setMenu(trip)}><Icon name='info'/></Button></View>
          <View className='lb-trip-route'><Text>{trip.route?.[0]||'出发地待确认'}</Text><Icon name='plane'/><Text>{trip.destination}</Text></View>
          <View className='lb-trip-footer'><Text className='ux-caption'>{trip.status==='ready'?'已保存':'已保存 · 部分信息待补充'}</Text><Button className='ux-text-button' disabled={!!opening} onClick={()=>open(trip)}>{opening===trip.id?'正在打开…':'继续安排'}<Icon name='arrow-right'/></Button></View>
        </View>
      </View>)}
      {!loading&&!error&&!shown.length?<EmptyState icon='calendar' title={filter==='archived'?'还没有归档行程':'下一站，还没写下'} description={filter==='archived'?'归档的行程会保留在这里，随时可以恢复。':'说说想去的地方，从一个旅行念头开始。'} actionLabel={filter==='archived'?'查看待出发行程':'开始规划'} onAction={filter==='archived'?()=>setFilter('upcoming'):onPlan}/>:null}
    </ScrollPanel>
    {menu?<Sheet title='管理这次旅行' onClose={()=>{if(!saving)setMenu(null)}}><Text className='ux-muted'>{menu.title} · 归档后仍保留行程和原对话。</Text><Button className='ux-primary' disabled={saving} onClick={archive}>{saving?'正在保存…':menu.archived?'恢复到待出发':'归档行程'}</Button></Sheet>:null}
  </>
}

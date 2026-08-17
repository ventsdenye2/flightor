// src/mocks/hubs.ts — Hub 中转城市体验数据（中英双语，按 locale 取用）
import type { HubExperience, LayoverOption, Activity } from '../types/flight'
import type { VisaStatus } from '../types/common'
import type { Locale } from '../i18n'

interface LT {
  zh: string
  en: string
}

interface ActivityL {
  icon: string
  title: LT
  description: LT
  source: Activity['source']
}

interface LayoverOptionL {
  duration: LayoverOption['duration']
  budget: LayoverOption['budget']
  activities: ActivityL[]
}

interface HubL {
  iata: string
  city: LT
  coverImage: string
  visaStatus: VisaStatus
  transitVisa: LT
  transportFromAirport: LT
  layoverOptions: LayoverOptionL[]
}

const HUBS: Record<string, HubL> = {
  SIN: {
    iata: 'SIN',
    city: { zh: '新加坡', en: 'Singapore' },
    coverImage: 'https://images.unsplash.com/photo-1525625293386-3f8f99389edd?w=750&q=60',
    visaStatus: 'conditional',
    transitVisa: { zh: '96小时过境免签（需第三国联程机票）', en: '96h visa-free transit (onward ticket required)' },
    transportFromAirport: { zh: '地铁东西线约40分钟直达市区，出租车约30分钟', en: 'MRT East-West Line ~40min to downtown, taxi ~30min' },
    layoverOptions: [
      {
        duration: '8h',
        budget: { currency: 'SGD', min: 30, max: 80 },
        activities: [
          { icon: '🌿', title: { zh: '星耀樟宜瀑布', en: 'Jewel Changi Waterfall' }, description: { zh: '机场内40米室内瀑布加雨林谷，无需出关', en: '40m indoor waterfall and forest valley, airside' }, source: 'official' },
          { icon: '🍜', title: { zh: '牛车水美食', en: 'Chinatown Food' }, description: { zh: '海南鸡饭与肉骨茶名店，地铁直达', en: 'Famous chicken rice and bak kut teh, MRT direct' }, source: 'xiaohongshu' },
          { icon: '🏛', title: { zh: '甘榜格南', en: 'Kampong Glam' }, description: { zh: '苏丹回教堂与哈芝巷壁画街拍', en: 'Sultan Mosque and Haji Lane murals' }, source: 'backpackers' }
        ]
      },
      {
        duration: '12h',
        budget: { currency: 'SGD', min: 60, max: 150 },
        activities: [
          { icon: '🌃', title: { zh: '滨海湾夜景', en: 'Marina Bay Nights' }, description: { zh: '金沙灯光秀每晚两场，鱼尾狮公园夜拍', en: 'MBS light show twice nightly, Merlion Park photos' }, source: 'xiaohongshu' },
          { icon: '🍜', title: { zh: '老巴刹沙嗲街', en: 'Lau Pa Sat Satay' }, description: { zh: '傍晚沙嗲摊开档，配冰镇啤酒', en: 'Evening satay stalls with cold beer' }, source: 'reddit' },
          { icon: '🌿', title: { zh: '滨海湾花园', en: 'Gardens by the Bay' }, description: { zh: '擎天树丛免费，冷室两馆联票制', en: 'Supertree Grove free; two-dome combo ticket' }, source: 'official' }
        ]
      },
      {
        duration: '24h',
        budget: { currency: 'SGD', min: 120, max: 300 },
        activities: [
          { icon: '🏝', title: { zh: '圣淘沙半日', en: 'Sentosa Half Day' }, description: { zh: '缆车加西乐索海滩与鱼尾狮塔', en: 'Cable car, Siloso Beach and Merlion Tower' }, source: 'backpackers' },
          { icon: '🛍', title: { zh: '乌节路扫货', en: 'Orchard Road Shopping' }, description: { zh: '各大商场云集，退税记得留登机牌', en: 'Mall strip; keep boarding pass for tax refund' }, source: 'xiaohongshu' },
          { icon: '🌙', title: { zh: '克拉码头夜生活', en: 'Clarke Quay Nightlife' }, description: { zh: '河畔酒吧与辣椒螃蟹晚餐', en: 'Riverside bars and chilli crab dinner' }, source: 'reddit' }
        ]
      }
    ]
  },
  BKK: {
    iata: 'BKK',
    city: { zh: '曼谷', en: 'Bangkok' },
    coverImage: 'https://images.unsplash.com/photo-1508009603885-50cf7c579365?w=750&q=60',
    visaStatus: 'free',
    transitVisa: { zh: '中国护照落地签或免签（以出行时政策为准）', en: 'Visa on arrival / visa-free for many passports (check policy)' },
    transportFromAirport: { zh: '机场快线约30分钟到市区，网约车约45分钟', en: 'Airport Rail Link ~30min downtown, ride-hailing ~45min' },
    layoverOptions: [
      {
        duration: '8h',
        budget: { currency: 'THB', min: 500, max: 1500 },
        activities: [
          { icon: '🍜', title: { zh: '航站楼泰式按摩', en: 'In-terminal Thai Massage' }, description: { zh: '出发层多家按摩店，两小时泰式古法', en: 'Massage shops on departures level, 2h traditional' }, source: 'official' },
          { icon: '🛍', title: { zh: '市区免税店', en: 'Downtown Duty Free' }, description: { zh: '免税店班车往返，携护照与登机牌', en: 'Shuttle round trip; bring passport and boarding pass' }, source: 'xiaohongshu' }
        ]
      },
      {
        duration: '12h',
        budget: { currency: 'THB', min: 1000, max: 3000 },
        activities: [
          { icon: '🏛', title: { zh: '大皇宫与卧佛寺', en: 'Grand Palace & Wat Pho' }, description: { zh: '开门即入避开人流，注意着装要求', en: 'Go at opening to beat crowds; dress code applies' }, source: 'backpackers' },
          { icon: '🍜', title: { zh: '唐人街小吃', en: 'Chinatown Street Food' }, description: { zh: '傍晚开档的米其林街头小吃一条街', en: 'Michelin street stalls open in the evening' }, source: 'xiaohongshu' },
          { icon: '🌙', title: { zh: '湄南河夜游', en: 'Chao Phraya Night Cruise' }, description: { zh: '游船晚餐或郑王庙夜景', en: 'Dinner cruise or Wat Arun night view' }, source: 'reddit' }
        ]
      },
      {
        duration: '24h',
        budget: { currency: 'THB', min: 2000, max: 6000 },
        activities: [
          { icon: '🛍', title: { zh: '恰图恰周末市集', en: 'Chatuchak Market' }, description: { zh: '仅周末开放，上万摊位杀价天堂', en: 'Weekends only; thousands of bargain stalls' }, source: 'backpackers' },
          { icon: '🌿', title: { zh: '美功铁道市场', en: 'Maeklong Railway Market' }, description: { zh: '半日团往返，火车穿过菜市场名场面', en: 'Half-day tour; train passes through the market' }, source: 'xiaohongshu' },
          { icon: '🌙', title: { zh: '考山路夜生活', en: 'Khaosan Road Nightlife' }, description: { zh: '背包客圣地，酒吧街通宵营业', en: 'Backpacker hub; bars open all night' }, source: 'reddit' }
        ]
      }
    ]
  },
  DOH: {
    iata: 'DOH',
    city: { zh: '多哈', en: 'Doha' },
    coverImage: 'https://images.unsplash.com/photo-1539475314840-751cd4747e17?w=750&q=60',
    visaStatus: 'free',
    transitVisa: { zh: '96小时过境免签（联程机票自动获得）', en: '96h free transit visa with connecting ticket' },
    transportFromAirport: { zh: '地铁红线约25分钟到市区，打车约20分钟', en: 'Metro Red Line ~25min downtown, taxi ~20min' },
    layoverOptions: [
      {
        duration: '8h',
        budget: { currency: 'QAR', min: 100, max: 300 },
        activities: [
          { icon: '🏛', title: { zh: '哈马德机场艺术之旅', en: 'Hamad Airport Art Tour' }, description: { zh: '巨型黄灯熊与室内热带花园，无需出关', en: 'Giant Lamp Bear and indoor garden, airside' }, source: 'official' },
          { icon: '🍜', title: { zh: '瓦其夫老市场', en: 'Souq Waqif' }, description: { zh: '香料市场、骆驼围栏与阿拉伯咖啡', en: 'Spice souq, camel pen and Arabic coffee' }, source: 'backpackers' }
        ]
      },
      {
        duration: '12h',
        budget: { currency: 'QAR', min: 200, max: 600 },
        activities: [
          { icon: '🏛', title: { zh: '伊斯兰艺术博物馆', en: 'Museum of Islamic Art' }, description: { zh: '贝聿铭封山之作，免费入场', en: 'I. M. Pei masterpiece, free entry' }, source: 'official' },
          { icon: '🌃', title: { zh: '滨海路天际线', en: 'Corniche Skyline' }, description: { zh: '西湾摩天楼群夜景与传统帆船', en: 'West Bay towers at night with dhow boats' }, source: 'xiaohongshu' },
          { icon: '🛍', title: { zh: '珍珠岛', en: 'The Pearl' }, description: { zh: '人工岛购物与游艇码头', en: 'Man-made island shopping and marina' }, source: 'reddit' }
        ]
      },
      {
        duration: '24h',
        budget: { currency: 'QAR', min: 500, max: 1500 },
        activities: [
          { icon: '🌿', title: { zh: '内陆海沙漠冲沙', en: 'Inland Sea Dune Bashing' }, description: { zh: '半日四驱冲沙与海湾内海观景', en: 'Half-day 4WD dunes and inland sea views' }, source: 'backpackers' },
          { icon: '🏛', title: { zh: '卡塔拉文化村', en: 'Katara Cultural Village' }, description: { zh: '圆形剧场、清真寺与海滩', en: 'Amphitheatre, mosques and beach' }, source: 'official' }
        ]
      }
    ]
  },
  IST: {
    iata: 'IST',
    city: { zh: '伊斯坦布尔', en: 'Istanbul' },
    coverImage: 'https://images.unsplash.com/photo-1541432901042-2d8bd64b4a9b?w=750&q=60',
    visaStatus: 'required',
    transitVisa: { zh: '需电子签或过境签（土航提供免费中转游）', en: 'e-Visa or transit visa required (free layover tour by TK)' },
    transportFromAirport: { zh: '机场大巴约60-90分钟到老城区', en: 'Airport bus 60-90min to the old town' },
    layoverOptions: [
      {
        duration: '12h',
        budget: { currency: 'TRY', min: 500, max: 1500 },
        activities: [
          { icon: '🏛', title: { zh: '蓝色清真寺与圣索菲亚', en: 'Blue Mosque & Hagia Sophia' }, description: { zh: '两大地标步行可达，早上先去', en: 'Two landmarks a short walk apart; go early' }, source: 'backpackers' },
          { icon: '🍜', title: { zh: '大巴扎与烤肉', en: 'Grand Bazaar & Kebab' }, description: { zh: '数千店铺的室内大市场', en: 'Thousands of shops under one roof' }, source: 'xiaohongshu' }
        ]
      },
      {
        duration: '24h',
        budget: { currency: 'TRY', min: 1000, max: 3000 },
        activities: [
          { icon: '🌃', title: { zh: '博斯普鲁斯海峡游船', en: 'Bosphorus Cruise' }, description: { zh: '横跨欧亚大陆的日落航线', en: 'Sunset cruise between Europe and Asia' }, source: 'xiaohongshu' },
          { icon: '🌙', title: { zh: '加拉塔塔夜景', en: 'Galata Tower Nights' }, description: { zh: '塔顶俯瞰金角湾', en: 'Golden Horn panorama from the top' }, source: 'reddit' },
          { icon: '🍜', title: { zh: '塔克西姆美食街', en: 'Taksim Food Street' }, description: { zh: '软糖、旋转烤肉与红茶', en: 'Lokum, doner and black tea' }, source: 'backpackers' }
        ]
      }
    ]
  },
  HEL: {
    iata: 'HEL',
    city: { zh: '赫尔辛基', en: 'Helsinki' },
    coverImage: 'https://images.unsplash.com/photo-1538332576228-eb5b4c4de6f5?w=750&q=60',
    visaStatus: 'required',
    transitVisa: { zh: '需申根签证（无签证仅可机场中转）', en: 'Schengen visa required (airside transit otherwise)' },
    transportFromAirport: { zh: '火车约30分钟到中央车站', en: 'Train ~30min to Central Station' },
    layoverOptions: [
      {
        duration: '8h',
        budget: { currency: 'EUR', min: 40, max: 100 },
        activities: [
          { icon: '🏛', title: { zh: '白教堂与议会广场', en: 'Cathedral & Senate Square' }, description: { zh: '地标打卡，周边步行可达', en: 'Landmark photos, all walkable' }, source: 'backpackers' },
          { icon: '🌿', title: { zh: '岩石教堂', en: 'Rock Church' }, description: { zh: '凿岩而建的独特教堂', en: 'Church carved into solid rock' }, source: 'official' },
          { icon: '🍜', title: { zh: '老农贸市场', en: 'Old Market Hall' }, description: { zh: '三文鱼汤与驯鹿肉香肠', en: 'Salmon soup and reindeer sausage' }, source: 'xiaohongshu' }
        ]
      },
      {
        duration: '12h',
        budget: { currency: 'EUR', min: 80, max: 200 },
        activities: [
          { icon: '🏝', title: { zh: '芬兰堡海上要塞', en: 'Suomenlinna Fortress' }, description: { zh: '渡轮15分钟，世界遗产海岛漫步', en: '15min ferry to the UNESCO sea fortress' }, source: 'official' },
          { icon: '🌙', title: { zh: '芬式桑拿体验', en: 'Finnish Sauna' }, description: { zh: '海边桑拿与波罗的海冷水浴', en: 'Seaside sauna and Baltic cold plunge' }, source: 'reddit' }
        ]
      }
    ]
  },
  DXB: {
    iata: 'DXB',
    city: { zh: '迪拜', en: 'Dubai' },
    coverImage: 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=750&q=60',
    visaStatus: 'free',
    transitVisa: { zh: '中国护照免签30天', en: 'Visa-free 30 days for many passports' },
    transportFromAirport: { zh: '地铁红线直达市中心约20分钟', en: 'Metro Red Line ~20min to downtown' },
    layoverOptions: [
      {
        duration: '12h',
        budget: { currency: 'AED', min: 200, max: 600 },
        activities: [
          { icon: '🌃', title: { zh: '哈利法塔观景台', en: 'Burj Khalifa Deck' }, description: { zh: '日落时段票需提前预订', en: 'Book sunset slots in advance' }, source: 'xiaohongshu' },
          { icon: '🛍', title: { zh: '迪拜购物中心', en: 'Dubai Mall' }, description: { zh: '超大商场、水族馆与音乐喷泉', en: 'Mega mall, aquarium and fountain show' }, source: 'official' },
          { icon: '🍜', title: { zh: '老城黄金市场', en: 'Gold Souk' }, description: { zh: '水上小船一迪拉姆过河', en: 'Cross the creek by abra for one dirham' }, source: 'backpackers' }
        ]
      },
      {
        duration: '24h',
        budget: { currency: 'AED', min: 500, max: 1500 },
        activities: [
          { icon: '🌿', title: { zh: '沙漠冲沙晚宴', en: 'Desert Safari Dinner' }, description: { zh: '傍晚四驱冲沙、骑骆驼与烤肉自助', en: 'Evening dunes, camel ride and BBQ buffet' }, source: 'xiaohongshu' },
          { icon: '🏝', title: { zh: '朱美拉海滩', en: 'Jumeirah Beach' }, description: { zh: '帆船酒店背景打卡与日光浴', en: 'Burj Al Arab backdrop and sunbathing' }, source: 'reddit' }
        ]
      }
    ]
  }
}

function localize(hub: HubL, locale: Locale): HubExperience {
  const pick = (lt: LT) => (locale === 'zh' ? lt.zh : lt.en)
  return {
    iata: hub.iata,
    city: pick(hub.city),
    coverImage: hub.coverImage,
    visaStatus: hub.visaStatus,
    transitVisa: pick(hub.transitVisa),
    transportFromAirport: pick(hub.transportFromAirport),
    layoverOptions: hub.layoverOptions.map(opt => ({
      duration: opt.duration,
      budget: opt.budget,
      activities: opt.activities.map(act => ({
        icon: act.icon,
        title: pick(act.title),
        description: pick(act.description),
        source: act.source
      }))
    }))
  }
}

/** 获取本地化 Hub 体验数据 */
export function getHubExperience(iata: string, locale: Locale): HubExperience | undefined {
  const hub = HUBS[iata.toUpperCase()]
  return hub ? localize(hub, locale) : undefined
}

/** 全部 Hub（本地化，探索页用） */
export function getAllHubs(locale: Locale): HubExperience[] {
  return Object.values(HUBS).map(h => localize(h, locale))
}

/** Hub 签证说明（本地化，航班卡/风险弹窗用） */
export function getHubVisaNote(iata: string, locale: Locale): string {
  const hub = HUBS[iata.toUpperCase()]
  if (!hub) return ''
  return locale === 'zh' ? hub.transitVisa.zh : hub.transitVisa.en
}

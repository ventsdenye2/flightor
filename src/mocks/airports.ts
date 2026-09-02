// src/mocks/airports.ts — 内置 IATA 机场数据（中英双语）
import type { Locale } from '../i18n'

export interface Airport {
  iata: string
  name: string
  enName: string
  city: string
  enCity: string
  country: string
  lat: number
  lng: number
}

export const AIRPORTS: Airport[] = [
  { iata: 'PVG', name: '上海浦东国际机场', enName: 'Shanghai Pudong Intl', city: '上海', enCity: 'Shanghai', country: '中国', lat: 31.1443, lng: 121.8083 },
  { iata: 'SHA', name: '上海虹桥国际机场', enName: 'Shanghai Hongqiao Intl', city: '上海', enCity: 'Shanghai', country: '中国', lat: 31.1979, lng: 121.3363 },
  { iata: 'PEK', name: '北京首都国际机场', enName: 'Beijing Capital Intl', city: '北京', enCity: 'Beijing', country: '中国', lat: 40.0799, lng: 116.6031 },
  { iata: 'PKX', name: '北京大兴国际机场', enName: 'Beijing Daxing Intl', city: '北京', enCity: 'Beijing', country: '中国', lat: 39.5098, lng: 116.4105 },
  { iata: 'CAN', name: '广州白云国际机场', enName: 'Guangzhou Baiyun Intl', city: '广州', enCity: 'Guangzhou', country: '中国', lat: 23.3924, lng: 113.2988 },
  { iata: 'SZX', name: '深圳宝安国际机场', enName: 'Shenzhen Baoan Intl', city: '深圳', enCity: 'Shenzhen', country: '中国', lat: 22.6393, lng: 113.8107 },
  { iata: 'CTU', name: '成都双流国际机场', enName: 'Chengdu Shuangliu Intl', city: '成都', enCity: 'Chengdu', country: '中国', lat: 30.5785, lng: 103.9471 },
  { iata: 'TFU', name: '成都天府国际机场', enName: 'Chengdu Tianfu Intl', city: '成都', enCity: 'Chengdu', country: '中国', lat: 30.3125, lng: 104.4419 },
  { iata: 'HKG', name: '香港国际机场', enName: 'Hong Kong Intl', city: '香港', enCity: 'Hong Kong', country: '中国香港', lat: 22.308, lng: 113.9185 },
  { iata: 'TPE', name: '台湾桃园国际机场', enName: 'Taiwan Taoyuan Intl', city: '台北', enCity: 'Taipei', country: '中国台湾', lat: 25.0777, lng: 121.2328 },
  { iata: 'NRT', name: '东京成田国际机场', enName: 'Tokyo Narita Intl', city: '东京', enCity: 'Tokyo', country: '日本', lat: 35.772, lng: 140.3929 },
  { iata: 'HND', name: '东京羽田机场', enName: 'Tokyo Haneda', city: '东京', enCity: 'Tokyo', country: '日本', lat: 35.5494, lng: 139.7798 },
  { iata: 'KIX', name: '大阪关西国际机场', enName: 'Osaka Kansai Intl', city: '大阪', enCity: 'Osaka', country: '日本', lat: 34.4347, lng: 135.2441 },
  { iata: 'ICN', name: '首尔仁川国际机场', enName: 'Seoul Incheon Intl', city: '首尔', enCity: 'Seoul', country: '韩国', lat: 37.4602, lng: 126.4407 },
  { iata: 'SIN', name: '新加坡樟宜机场', enName: 'Singapore Changi', city: '新加坡', enCity: 'Singapore', country: '新加坡', lat: 1.3644, lng: 103.9915 },
  { iata: 'BKK', name: '曼谷素万那普机场', enName: 'Bangkok Suvarnabhumi', city: '曼谷', enCity: 'Bangkok', country: '泰国', lat: 13.69, lng: 100.7501 },
  { iata: 'KUL', name: '吉隆坡国际机场', enName: 'Kuala Lumpur Intl', city: '吉隆坡', enCity: 'Kuala Lumpur', country: '马来西亚', lat: 2.7456, lng: 101.7099 },
  { iata: 'HAN', name: '河内内排国际机场', enName: 'Hanoi Noi Bai Intl', city: '河内', enCity: 'Hanoi', country: '越南', lat: 21.2212, lng: 105.807 },
  { iata: 'MNL', name: '马尼拉尼诺伊·阿基诺机场', enName: 'Manila Ninoy Aquino Intl', city: '马尼拉', enCity: 'Manila', country: '菲律宾', lat: 14.5086, lng: 121.0194 },
  { iata: 'DEL', name: '德里英迪拉·甘地机场', enName: 'Delhi Indira Gandhi Intl', city: '新德里', enCity: 'New Delhi', country: '印度', lat: 28.5562, lng: 77.1 },
  { iata: 'CMB', name: '科伦坡班达拉奈克机场', enName: 'Colombo Bandaranaike Intl', city: '科伦坡', enCity: 'Colombo', country: '斯里兰卡', lat: 7.1808, lng: 79.8841 },
  { iata: 'DOH', name: '多哈哈马德国际机场', enName: 'Doha Hamad Intl', city: '多哈', enCity: 'Doha', country: '卡塔尔', lat: 25.2731, lng: 51.6081 },
  { iata: 'DXB', name: '迪拜国际机场', enName: 'Dubai Intl', city: '迪拜', enCity: 'Dubai', country: '阿联酋', lat: 25.2532, lng: 55.3657 },
  { iata: 'AUH', name: '阿布扎比国际机场', enName: 'Abu Dhabi Intl', city: '阿布扎比', enCity: 'Abu Dhabi', country: '阿联酋', lat: 24.433, lng: 54.6511 },
  { iata: 'IST', name: '伊斯坦布尔机场', enName: 'Istanbul Airport', city: '伊斯坦布尔', enCity: 'Istanbul', country: '土耳其', lat: 41.2753, lng: 28.7519 },
  { iata: 'HEL', name: '赫尔辛基万塔机场', enName: 'Helsinki Vantaa', city: '赫尔辛基', enCity: 'Helsinki', country: '芬兰', lat: 60.3172, lng: 24.9633 },
  { iata: 'LHR', name: '伦敦希思罗机场', enName: 'London Heathrow', city: '伦敦', enCity: 'London', country: '英国', lat: 51.47, lng: -0.4543 },
  { iata: 'LGW', name: '伦敦盖特威克机场', enName: 'London Gatwick', city: '伦敦', enCity: 'London', country: '英国', lat: 51.1537, lng: -0.1821 },
  { iata: 'CDG', name: '巴黎戴高乐机场', enName: 'Paris Charles de Gaulle', city: '巴黎', enCity: 'Paris', country: '法国', lat: 49.0097, lng: 2.5479 },
  { iata: 'FRA', name: '法兰克福机场', enName: 'Frankfurt Airport', city: '法兰克福', enCity: 'Frankfurt', country: '德国', lat: 50.0379, lng: 8.5622 },
  { iata: 'MUC', name: '慕尼黑机场', enName: 'Munich Airport', city: '慕尼黑', enCity: 'Munich', country: '德国', lat: 48.3538, lng: 11.7861 },
  { iata: 'AMS', name: '阿姆斯特丹史基浦机场', enName: 'Amsterdam Schiphol', city: '阿姆斯特丹', enCity: 'Amsterdam', country: '荷兰', lat: 52.3105, lng: 4.7683 },
  { iata: 'ZRH', name: '苏黎世机场', enName: 'Zurich Airport', city: '苏黎世', enCity: 'Zurich', country: '瑞士', lat: 47.4582, lng: 8.5556 },
  { iata: 'FCO', name: '罗马菲乌米奇诺机场', enName: 'Rome Fiumicino', city: '罗马', enCity: 'Rome', country: '意大利', lat: 41.8003, lng: 12.2389 },
  { iata: 'MAD', name: '马德里巴拉哈斯机场', enName: 'Madrid Barajas', city: '马德里', enCity: 'Madrid', country: '西班牙', lat: 40.4983, lng: -3.5676 },
  { iata: 'JFK', name: '纽约肯尼迪国际机场', enName: 'New York JFK Intl', city: '纽约', enCity: 'New York', country: '美国', lat: 40.6413, lng: -73.7781 },
  { iata: 'LAX', name: '洛杉矶国际机场', enName: 'Los Angeles Intl', city: '洛杉矶', enCity: 'Los Angeles', country: '美国', lat: 33.9416, lng: -118.4085 },
  { iata: 'SFO', name: '旧金山国际机场', enName: 'San Francisco Intl', city: '旧金山', enCity: 'San Francisco', country: '美国', lat: 37.6213, lng: -122.379 },
  { iata: 'SEA', name: '西雅图塔科马机场', enName: 'Seattle Tacoma Intl', city: '西雅图', enCity: 'Seattle', country: '美国', lat: 47.4502, lng: -122.3088 },
  { iata: 'YVR', name: '温哥华国际机场', enName: 'Vancouver Intl', city: '温哥华', enCity: 'Vancouver', country: '加拿大', lat: 49.1967, lng: -123.1815 },
  { iata: 'SYD', name: '悉尼金斯福德·史密斯机场', enName: 'Sydney Kingsford Smith', city: '悉尼', enCity: 'Sydney', country: '澳大利亚', lat: -33.9399, lng: 151.1753 },
  { iata: 'MEL', name: '墨尔本机场', enName: 'Melbourne Airport', city: '墨尔本', enCity: 'Melbourne', country: '澳大利亚', lat: -37.669, lng: 144.841 },
  { iata: 'BNE', name: '布里斯班机场', enName: 'Brisbane Airport', city: '布里斯班', enCity: 'Brisbane', country: '澳大利亚', lat: -27.3842, lng: 153.1175 },
  { iata: 'PER', name: '珀斯机场', enName: 'Perth Airport', city: '珀斯', enCity: 'Perth', country: '澳大利亚', lat: -31.9403, lng: 115.9669 },
  { iata: 'AKL', name: '奥克兰机场', enName: 'Auckland Airport', city: '奥克兰', enCity: 'Auckland', country: '新西兰', lat: -37.0082, lng: 174.785 },
  { iata: 'CTS', name: '札幌新千岁机场', enName: 'Sapporo New Chitose', city: '札幌', enCity: 'Sapporo', country: '日本', lat: 42.7752, lng: 141.6923 },
  { iata: 'NGO', name: '名古屋中部国际机场', enName: 'Nagoya Chubu Centrair', city: '名古屋', enCity: 'Nagoya', country: '日本', lat: 34.8584, lng: 136.8049 },
  { iata: 'FUK', name: '福冈机场', enName: 'Fukuoka Airport', city: '福冈', enCity: 'Fukuoka', country: '日本', lat: 33.5859, lng: 130.451 },
  { iata: 'PUS', name: '釜山金海机场', enName: 'Busan Gimhae', city: '釜山', enCity: 'Busan', country: '韩国', lat: 35.1795, lng: 128.9382 },
  { iata: 'SGN', name: '胡志明新山一机场', enName: 'Ho Chi Minh Tan Son Nhat', city: '胡志明市', enCity: 'Ho Chi Minh City', country: '越南', lat: 10.8188, lng: 106.6519 },
  { iata: 'DAD', name: '岘港机场', enName: 'Da Nang Airport', city: '岘港', enCity: 'Da Nang', country: '越南', lat: 16.0439, lng: 108.1994 },
  { iata: 'CGK', name: '雅加达苏加诺-哈达机场', enName: 'Jakarta Soekarno-Hatta', city: '雅加达', enCity: 'Jakarta', country: '印度尼西亚', lat: -6.1256, lng: 106.6559 },
  { iata: 'DPS', name: '巴厘岛伍拉·赖机场', enName: 'Bali Ngurah Rai', city: '巴厘岛', enCity: 'Bali', country: '印度尼西亚', lat: -8.7482, lng: 115.1672 },
  { iata: 'BOM', name: '孟买机场', enName: 'Mumbai Airport', city: '孟买', enCity: 'Mumbai', country: '印度', lat: 19.0887, lng: 72.8679 },
  { iata: 'BLR', name: '班加罗尔机场', enName: 'Bengaluru Airport', city: '班加罗尔', enCity: 'Bengaluru', country: '印度', lat: 13.1986, lng: 77.7066 },
  { iata: 'JED', name: '吉达阿卜杜勒-阿齐兹机场', enName: 'Jeddah King Abdulaziz', city: '吉达', enCity: 'Jeddah', country: '沙特阿拉伯', lat: 21.6796, lng: 39.1565 },
  { iata: 'RUH', name: '利雅得机场', enName: 'Riyadh King Khalid', city: '利雅得', enCity: 'Riyadh', country: '沙特阿拉伯', lat: 24.9576, lng: 46.6988 },
  { iata: 'CAI', name: '开罗机场', enName: 'Cairo Airport', city: '开罗', enCity: 'Cairo', country: '埃及', lat: 30.1219, lng: 31.4056 },
  { iata: 'JNB', name: '约翰内斯堡机场', enName: 'Johannesburg O.R. Tambo', city: '约翰内斯堡', enCity: 'Johannesburg', country: '南非', lat: -26.1392, lng: 28.246 },
  { iata: 'NBO', name: '内罗毕机场', enName: 'Nairobi Jomo Kenyatta', city: '内罗毕', enCity: 'Nairobi', country: '肯尼亚', lat: -1.3192, lng: 36.9278 },
  { iata: 'ADD', name: '亚的斯亚贝巴机场', enName: 'Addis Ababa Bole', city: '亚的斯亚贝巴', enCity: 'Addis Ababa', country: '埃塞俄比亚', lat: 8.9779, lng: 38.7993 },
  { iata: 'VIE', name: '维也纳机场', enName: 'Vienna Airport', city: '维也纳', enCity: 'Vienna', country: '奥地利', lat: 48.1103, lng: 16.5697 },
  { iata: 'CPH', name: '哥本哈根机场', enName: 'Copenhagen Airport', city: '哥本哈根', enCity: 'Copenhagen', country: '丹麦', lat: 55.618, lng: 12.656 },
  { iata: 'ARN', name: '斯德哥尔摩阿兰达机场', enName: 'Stockholm Arlanda', city: '斯德哥尔摩', enCity: 'Stockholm', country: '瑞典', lat: 59.6519, lng: 17.9186 },
  { iata: 'OSL', name: '奥斯陆机场', enName: 'Oslo Gardermoen', city: '奥斯陆', enCity: 'Oslo', country: '挪威', lat: 60.1939, lng: 11.1004 },
  { iata: 'DUB', name: '都柏林机场', enName: 'Dublin Airport', city: '都柏林', enCity: 'Dublin', country: '爱尔兰', lat: 53.4264, lng: -6.2499 },
  { iata: 'LIS', name: '里斯本机场', enName: 'Lisbon Airport', city: '里斯本', enCity: 'Lisbon', country: '葡萄牙', lat: 38.7742, lng: -9.1342 },
  { iata: 'BCN', name: '巴塞罗那机场', enName: 'Barcelona El Prat', city: '巴塞罗那', enCity: 'Barcelona', country: '西班牙', lat: 41.2974, lng: 2.0833 },
  { iata: 'MXP', name: '米兰马尔彭萨机场', enName: 'Milan Malpensa', city: '米兰', enCity: 'Milan', country: '意大利', lat: 45.6306, lng: 8.7281 },
  { iata: 'ATH', name: '雅典机场', enName: 'Athens Airport', city: '雅典', enCity: 'Athens', country: '希腊', lat: 37.9364, lng: 23.9445 },
  { iata: 'PRG', name: '布拉格机场', enName: 'Prague Airport', city: '布拉格', enCity: 'Prague', country: '捷克', lat: 50.1008, lng: 14.26 },
  { iata: 'WAW', name: '华沙肖邦机场', enName: 'Warsaw Chopin', city: '华沙', enCity: 'Warsaw', country: '波兰', lat: 52.1657, lng: 20.9671 },
  { iata: 'SVO', name: '莫斯科谢列梅捷沃机场', enName: 'Moscow Sheremetyevo', city: '莫斯科', enCity: 'Moscow', country: '俄罗斯', lat: 55.9726, lng: 37.4146 },
  { iata: 'ORD', name: '芝加哥奥黑尔机场', enName: "Chicago O'Hare", city: '芝加哥', enCity: 'Chicago', country: '美国', lat: 41.9742, lng: -87.9073 },
  { iata: 'DFW', name: '达拉斯沃斯堡机场', enName: 'Dallas Fort Worth', city: '达拉斯', enCity: 'Dallas', country: '美国', lat: 32.8998, lng: -97.0403 },
  { iata: 'MIA', name: '迈阿密机场', enName: 'Miami Airport', city: '迈阿密', enCity: 'Miami', country: '美国', lat: 25.7959, lng: -80.287 },
  { iata: 'BOS', name: '波士顿洛根机场', enName: 'Boston Logan', city: '波士顿', enCity: 'Boston', country: '美国', lat: 42.3656, lng: -71.0096 },
  { iata: 'YYZ', name: '多伦多皮尔森机场', enName: 'Toronto Pearson', city: '多伦多', enCity: 'Toronto', country: '加拿大', lat: 43.6777, lng: -79.6248 },
  { iata: 'MEX', name: '墨西哥城机场', enName: 'Mexico City Airport', city: '墨西哥城', enCity: 'Mexico City', country: '墨西哥', lat: 19.4363, lng: -99.0721 },
  { iata: 'GRU', name: '圣保罗瓜鲁尔霍斯机场', enName: 'São Paulo Guarulhos', city: '圣保罗', enCity: 'São Paulo', country: '巴西', lat: -23.4356, lng: -46.4731 },
  { iata: 'EZE', name: '布宜诺斯艾利斯埃塞伊扎机场', enName: 'Buenos Aires Ezeiza', city: '布宜诺斯艾利斯', enCity: 'Buenos Aires', country: '阿根廷', lat: -34.8222, lng: -58.5358 },
  { iata: 'SCL', name: '圣地亚哥机场', enName: 'Santiago Airport', city: '圣地亚哥', enCity: 'Santiago', country: '智利', lat: -33.393, lng: -70.7858 },
  { iata: 'BOG', name: '波哥大埃尔多拉多机场', enName: 'Bogotá El Dorado', city: '波哥大', enCity: 'Bogotá', country: '哥伦比亚', lat: 4.7016, lng: -74.1469 }
]

/** 按 IATA 查机场 */
export function findAirport(iata: string): Airport | undefined {
  return AIRPORTS.find(a => a.iata === iata.toUpperCase())
}

/** 两机场大圆距离（公里） */
export function distanceKm(a: Airport, b: Airport): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}

/**
 * 出发圈：主机场 + 半径内邻近机场（按距离升序，含主机场，最多 maxCount 个）
 * 例：SZX + 200km → [SZX, HKG, CAN]
 */
export function nearbyAirports(iata: string, radiusKm: number, maxCount = 3): Airport[] {
  const primary = findAirport(iata)
  if (!primary) return []
  if (radiusKm <= 0) return [primary]
  const others = AIRPORTS
    .filter(a => a.iata !== primary.iata)
    .map(a => ({ a, d: distanceKm(primary, a) }))
    .filter(x => x.d <= radiusKm)
    .sort((x, y) => x.d - y.d)
    .map(x => x.a)
  return [primary, ...others].slice(0, maxCount)
}

/** 按语言取机场名 */
export function airportName(a: Airport, locale: Locale): string {
  return locale === 'zh' ? a.name : a.enName
}

/** 按语言取城市名 */
export function airportCity(a: Airport, locale: Locale): string {
  return locale === 'zh' ? a.city : a.enCity
}

/** 按 IATA 取城市显示名（找不到时回退 IATA 码） */
export function cityOf(iata: string, locale: Locale): string {
  const a = findAirport(iata)
  return a ? airportCity(a, locale) : iata
}

/** 关键字搜索（IATA/名称/城市，双语匹配） */
export function searchAirports(keyword: string): Airport[] {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return AIRPORTS
  return AIRPORTS.filter(
    a =>
      a.iata.toLowerCase().includes(kw) ||
      a.name.toLowerCase().includes(kw) ||
      a.enName.toLowerCase().includes(kw) ||
      a.city.toLowerCase().includes(kw) ||
      a.enCity.toLowerCase().includes(kw) ||
      a.country.toLowerCase().includes(kw)
  )
}

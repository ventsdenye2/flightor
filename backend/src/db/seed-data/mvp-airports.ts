// MVP airport/city/country seed data.
// Source baseline: src/mocks/airports.ts in the Taro frontend.
// This file is intentionally duplicated inside backend/src so backend builds
// do not depend on frontend source outside backend/tsconfig rootDir.
// Keep in sync with src/mocks/airports.ts when the MVP airport list changes.

export interface MvpAirportSeed {
  iata: string
  cityIata: string
  countryCode: string
  nameZh: string
  nameEn: string
  cityZh: string
  cityEn: string
  lat: number
  lng: number
  aliases: string[]
}

export interface MvpCountrySeed {
  code: string
  nameZh: string
  nameEn: string
  region: string | null
}

export const MVP_COUNTRIES: MvpCountrySeed[] = [
  { code: 'CN', nameZh: '中国', nameEn: 'China', region: 'East Asia' },
  { code: 'HK', nameZh: '中国香港', nameEn: 'Hong Kong', region: 'East Asia' },
  { code: 'TW', nameZh: '中国台湾', nameEn: 'Taiwan', region: 'East Asia' },
  { code: 'JP', nameZh: '日本', nameEn: 'Japan', region: 'East Asia' },
  { code: 'KR', nameZh: '韩国', nameEn: 'South Korea', region: 'East Asia' },
  { code: 'SG', nameZh: '新加坡', nameEn: 'Singapore', region: 'Southeast Asia' },
  { code: 'MY', nameZh: '马来西亚', nameEn: 'Malaysia', region: 'Southeast Asia' },
  { code: 'TH', nameZh: '泰国', nameEn: 'Thailand', region: 'Southeast Asia' },
  { code: 'VN', nameZh: '越南', nameEn: 'Vietnam', region: 'Southeast Asia' },
  { code: 'PH', nameZh: '菲律宾', nameEn: 'Philippines', region: 'Southeast Asia' },
  { code: 'ID', nameZh: '印度尼西亚', nameEn: 'Indonesia', region: 'Southeast Asia' },
  { code: 'IN', nameZh: '印度', nameEn: 'India', region: 'South Asia' },
  { code: 'LK', nameZh: '斯里兰卡', nameEn: 'Sri Lanka', region: 'South Asia' },
  { code: 'QA', nameZh: '卡塔尔', nameEn: 'Qatar', region: 'Middle East' },
  { code: 'AE', nameZh: '阿联酋', nameEn: 'United Arab Emirates', region: 'Middle East' },
  { code: 'SA', nameZh: '沙特阿拉伯', nameEn: 'Saudi Arabia', region: 'Middle East' },
  { code: 'TR', nameZh: '土耳其', nameEn: 'Türkiye', region: 'Europe' },
  { code: 'FI', nameZh: '芬兰', nameEn: 'Finland', region: 'Europe' },
  { code: 'GB', nameZh: '英国', nameEn: 'United Kingdom', region: 'Europe' },
  { code: 'FR', nameZh: '法国', nameEn: 'France', region: 'Europe' },
  { code: 'DE', nameZh: '德国', nameEn: 'Germany', region: 'Europe' },
  { code: 'NL', nameZh: '荷兰', nameEn: 'Netherlands', region: 'Europe' },
  { code: 'CH', nameZh: '瑞士', nameEn: 'Switzerland', region: 'Europe' },
  { code: 'IT', nameZh: '意大利', nameEn: 'Italy', region: 'Europe' },
  { code: 'ES', nameZh: '西班牙', nameEn: 'Spain', region: 'Europe' },
  { code: 'AT', nameZh: '奥地利', nameEn: 'Austria', region: 'Europe' },
  { code: 'DK', nameZh: '丹麦', nameEn: 'Denmark', region: 'Europe' },
  { code: 'SE', nameZh: '瑞典', nameEn: 'Sweden', region: 'Europe' },
  { code: 'NO', nameZh: '挪威', nameEn: 'Norway', region: 'Europe' },
  { code: 'IE', nameZh: '爱尔兰', nameEn: 'Ireland', region: 'Europe' },
  { code: 'PT', nameZh: '葡萄牙', nameEn: 'Portugal', region: 'Europe' },
  { code: 'GR', nameZh: '希腊', nameEn: 'Greece', region: 'Europe' },
  { code: 'CZ', nameZh: '捷克', nameEn: 'Czechia', region: 'Europe' },
  { code: 'PL', nameZh: '波兰', nameEn: 'Poland', region: 'Europe' },
  { code: 'RU', nameZh: '俄罗斯', nameEn: 'Russia', region: 'Europe' },
  { code: 'US', nameZh: '美国', nameEn: 'United States', region: 'North America' },
  { code: 'CA', nameZh: '加拿大', nameEn: 'Canada', region: 'North America' },
  { code: 'MX', nameZh: '墨西哥', nameEn: 'Mexico', region: 'North America' },
  { code: 'AU', nameZh: '澳大利亚', nameEn: 'Australia', region: 'Oceania' },
  { code: 'NZ', nameZh: '新西兰', nameEn: 'New Zealand', region: 'Oceania' },
  { code: 'EG', nameZh: '埃及', nameEn: 'Egypt', region: 'Africa' },
  { code: 'ZA', nameZh: '南非', nameEn: 'South Africa', region: 'Africa' },
  { code: 'KE', nameZh: '肯尼亚', nameEn: 'Kenya', region: 'Africa' },
  { code: 'ET', nameZh: '埃塞俄比亚', nameEn: 'Ethiopia', region: 'Africa' },
  { code: 'BR', nameZh: '巴西', nameEn: 'Brazil', region: 'South America' },
  { code: 'AR', nameZh: '阿根廷', nameEn: 'Argentina', region: 'South America' },
  { code: 'CL', nameZh: '智利', nameEn: 'Chile', region: 'South America' },
  { code: 'CO', nameZh: '哥伦比亚', nameEn: 'Colombia', region: 'South America' }
]

export const MVP_AIRPORTS: MvpAirportSeed[] = [
  { iata: 'PVG', cityIata: 'SHA', countryCode: 'CN', nameZh: '上海浦东国际机场', nameEn: 'Shanghai Pudong International Airport', cityZh: '上海', cityEn: 'Shanghai', lat: 31.1443, lng: 121.8083, aliases: ['浦东', 'pudong'] },
  { iata: 'SHA', cityIata: 'SHA', countryCode: 'CN', nameZh: '上海虹桥国际机场', nameEn: 'Shanghai Hongqiao International Airport', cityZh: '上海', cityEn: 'Shanghai', lat: 31.1979, lng: 121.3363, aliases: ['虹桥', 'hongqiao'] },
  { iata: 'PEK', cityIata: 'BJS', countryCode: 'CN', nameZh: '北京首都国际机场', nameEn: 'Beijing Capital International Airport', cityZh: '北京', cityEn: 'Beijing', lat: 40.0799, lng: 116.6031, aliases: ['首都机场', '首都国际机场', 'beijing capital', 'peking'] },
  { iata: 'PKX', cityIata: 'BJS', countryCode: 'CN', nameZh: '北京大兴国际机场', nameEn: 'Beijing Daxing International Airport', cityZh: '北京', cityEn: 'Beijing', lat: 39.5098, lng: 116.4105, aliases: ['大兴', 'daxing'] },
  { iata: 'CAN', cityIata: 'CAN', countryCode: 'CN', nameZh: '广州白云国际机场', nameEn: 'Guangzhou Baiyun International Airport', cityZh: '广州', cityEn: 'Guangzhou', lat: 23.3924, lng: 113.2988, aliases: ['白云', 'baiyun'] },
  { iata: 'SZX', cityIata: 'SZX', countryCode: 'CN', nameZh: '深圳宝安国际机场', nameEn: 'Shenzhen Baoan International Airport', cityZh: '深圳', cityEn: 'Shenzhen', lat: 22.6393, lng: 113.8107, aliases: ['宝安', 'baoan'] },
  { iata: 'CTU', cityIata: 'CTU', countryCode: 'CN', nameZh: '成都双流国际机场', nameEn: 'Chengdu Shuangliu International Airport', cityZh: '成都', cityEn: 'Chengdu', lat: 30.5785, lng: 103.9471, aliases: ['双流', 'shuangliu'] },
  { iata: 'TFU', cityIata: 'CTU', countryCode: 'CN', nameZh: '成都天府国际机场', nameEn: 'Chengdu Tianfu International Airport', cityZh: '成都', cityEn: 'Chengdu', lat: 30.3125, lng: 104.4419, aliases: ['天府', 'tianfu'] },
  { iata: 'HKG', cityIata: 'HKG', countryCode: 'HK', nameZh: '香港国际机场', nameEn: 'Hong Kong International Airport', cityZh: '香港', cityEn: 'Hong Kong', lat: 22.308, lng: 113.9185, aliases: ['赤鱲角', 'chek lap kok'] },
  { iata: 'TPE', cityIata: 'TPE', countryCode: 'TW', nameZh: '台湾桃园国际机场', nameEn: 'Taiwan Taoyuan International Airport', cityZh: '台北', cityEn: 'Taipei', lat: 25.0777, lng: 121.2328, aliases: ['桃园', 'taoyuan'] },
  { iata: 'NRT', cityIata: 'TYO', countryCode: 'JP', nameZh: '东京成田国际机场', nameEn: 'Tokyo Narita International Airport', cityZh: '东京', cityEn: 'Tokyo', lat: 35.772, lng: 140.3929, aliases: ['成田', 'narita'] },
  { iata: 'HND', cityIata: 'TYO', countryCode: 'JP', nameZh: '东京羽田机场', nameEn: 'Tokyo Haneda Airport', cityZh: '东京', cityEn: 'Tokyo', lat: 35.5494, lng: 139.7798, aliases: ['羽田', 'haneda'] },
  { iata: 'KIX', cityIata: 'OSA', countryCode: 'JP', nameZh: '大阪关西国际机场', nameEn: 'Osaka Kansai International Airport', cityZh: '大阪', cityEn: 'Osaka', lat: 34.4347, lng: 135.2441, aliases: ['关西', 'kansai'] },
  { iata: 'ICN', cityIata: 'SEL', countryCode: 'KR', nameZh: '首尔仁川国际机场', nameEn: 'Seoul Incheon International Airport', cityZh: '首尔', cityEn: 'Seoul', lat: 37.4602, lng: 126.4407, aliases: ['仁川', 'incheon'] },
  { iata: 'SIN', cityIata: 'SIN', countryCode: 'SG', nameZh: '新加坡樟宜机场', nameEn: 'Singapore Changi Airport', cityZh: '新加坡', cityEn: 'Singapore', lat: 1.3644, lng: 103.9915, aliases: ['樟宜', 'changi'] },
  { iata: 'BKK', cityIata: 'BKK', countryCode: 'TH', nameZh: '曼谷素万那普机场', nameEn: 'Bangkok Suvarnabhumi Airport', cityZh: '曼谷', cityEn: 'Bangkok', lat: 13.69, lng: 100.7501, aliases: ['素万那普', 'suvarnabhumi'] },
  { iata: 'KUL', cityIata: 'KUL', countryCode: 'MY', nameZh: '吉隆坡国际机场', nameEn: 'Kuala Lumpur International Airport', cityZh: '吉隆坡', cityEn: 'Kuala Lumpur', lat: 2.7456, lng: 101.7099, aliases: ['klia'] },
  { iata: 'HAN', cityIata: 'HAN', countryCode: 'VN', nameZh: '河内内排国际机场', nameEn: 'Hanoi Noi Bai International Airport', cityZh: '河内', cityEn: 'Hanoi', lat: 21.2212, lng: 105.807, aliases: ['内排', 'noi bai'] },
  { iata: 'MNL', cityIata: 'MNL', countryCode: 'PH', nameZh: '马尼拉尼诺伊·阿基诺机场', nameEn: 'Manila Ninoy Aquino International Airport', cityZh: '马尼拉', cityEn: 'Manila', lat: 14.5086, lng: 121.0194, aliases: ['尼诺伊·阿基诺', 'ninoy aquino'] },
  { iata: 'DEL', cityIata: 'DEL', countryCode: 'IN', nameZh: '德里英迪拉·甘地机场', nameEn: 'Delhi Indira Gandhi International Airport', cityZh: '新德里', cityEn: 'New Delhi', lat: 28.5562, lng: 77.1, aliases: ['英迪拉·甘地', 'indira gandhi'] },
  { iata: 'CMB', cityIata: 'CMB', countryCode: 'LK', nameZh: '科伦坡班达拉奈克机场', nameEn: 'Colombo Bandaranaike International Airport', cityZh: '科伦坡', cityEn: 'Colombo', lat: 7.1808, lng: 79.8841, aliases: ['班达拉奈克', 'bandaranaike'] },
  { iata: 'DOH', cityIata: 'DOH', countryCode: 'QA', nameZh: '多哈哈马德国际机场', nameEn: 'Doha Hamad International Airport', cityZh: '多哈', cityEn: 'Doha', lat: 25.2731, lng: 51.6081, aliases: ['哈马德', 'hamad'] },
  { iata: 'DXB', cityIata: 'DXB', countryCode: 'AE', nameZh: '迪拜国际机场', nameEn: 'Dubai International Airport', cityZh: '迪拜', cityEn: 'Dubai', lat: 25.2532, lng: 55.3657, aliases: [] },
  { iata: 'AUH', cityIata: 'AUH', countryCode: 'AE', nameZh: '阿布扎比国际机场', nameEn: 'Abu Dhabi International Airport', cityZh: '阿布扎比', cityEn: 'Abu Dhabi', lat: 24.433, lng: 54.6511, aliases: [] },
  { iata: 'IST', cityIata: 'IST', countryCode: 'TR', nameZh: '伊斯坦布尔机场', nameEn: 'Istanbul Airport', cityZh: '伊斯坦布尔', cityEn: 'Istanbul', lat: 41.2753, lng: 28.7519, aliases: [] },
  { iata: 'HEL', cityIata: 'HEL', countryCode: 'FI', nameZh: '赫尔辛基万塔机场', nameEn: 'Helsinki Airport', cityZh: '赫尔辛基', cityEn: 'Helsinki', lat: 60.3172, lng: 24.9633, aliases: ['万塔', 'vantaa'] },
  { iata: 'LHR', cityIata: 'LON', countryCode: 'GB', nameZh: '伦敦希思罗机场', nameEn: 'London Heathrow Airport', cityZh: '伦敦', cityEn: 'London', lat: 51.47, lng: -0.4543, aliases: ['希思罗', 'heathrow'] },
  { iata: 'LGW', cityIata: 'LON', countryCode: 'GB', nameZh: '伦敦盖特威克机场', nameEn: 'London Gatwick Airport', cityZh: '伦敦', cityEn: 'London', lat: 51.1537, lng: -0.1821, aliases: ['盖特威克', 'gatwick'] },
  { iata: 'CDG', cityIata: 'PAR', countryCode: 'FR', nameZh: '巴黎戴高乐机场', nameEn: 'Paris Charles de Gaulle Airport', cityZh: '巴黎', cityEn: 'Paris', lat: 49.0097, lng: 2.5479, aliases: ['戴高乐', 'charles de gaulle'] },
  { iata: 'FRA', cityIata: 'FRA', countryCode: 'DE', nameZh: '法兰克福机场', nameEn: 'Frankfurt Airport', cityZh: '法兰克福', cityEn: 'Frankfurt', lat: 50.0379, lng: 8.5622, aliases: [] },
  { iata: 'MUC', cityIata: 'MUC', countryCode: 'DE', nameZh: '慕尼黑机场', nameEn: 'Munich Airport', cityZh: '慕尼黑', cityEn: 'Munich', lat: 48.3538, lng: 11.7861, aliases: [] },
  { iata: 'AMS', cityIata: 'AMS', countryCode: 'NL', nameZh: '阿姆斯特丹史基浦机场', nameEn: 'Amsterdam Schiphol Airport', cityZh: '阿姆斯特丹', cityEn: 'Amsterdam', lat: 52.3105, lng: 4.7683, aliases: ['史基浦', 'schiphol'] },
  { iata: 'ZRH', cityIata: 'ZRH', countryCode: 'CH', nameZh: '苏黎世机场', nameEn: 'Zurich Airport', cityZh: '苏黎世', cityEn: 'Zurich', lat: 47.4582, lng: 8.5556, aliases: [] },
  { iata: 'FCO', cityIata: 'ROM', countryCode: 'IT', nameZh: '罗马菲乌米奇诺机场', nameEn: 'Rome Fiumicino Airport', cityZh: '罗马', cityEn: 'Rome', lat: 41.8003, lng: 12.2389, aliases: ['菲乌米奇诺', 'fiumicino'] },
  { iata: 'MAD', cityIata: 'MAD', countryCode: 'ES', nameZh: '马德里巴拉哈斯机场', nameEn: 'Madrid Barajas Airport', cityZh: '马德里', cityEn: 'Madrid', lat: 40.4983, lng: -3.5676, aliases: ['巴拉哈斯', 'barajas'] },
  { iata: 'JFK', cityIata: 'NYC', countryCode: 'US', nameZh: '纽约肯尼迪国际机场', nameEn: 'New York JFK International Airport', cityZh: '纽约', cityEn: 'New York', lat: 40.6413, lng: -73.7781, aliases: ['肯尼迪', 'jfk', 'new york jfk'] },
  { iata: 'LAX', cityIata: 'LAX', countryCode: 'US', nameZh: '洛杉矶国际机场', nameEn: 'Los Angeles International Airport', cityZh: '洛杉矶', cityEn: 'Los Angeles', lat: 33.9416, lng: -118.4085, aliases: [] },
  { iata: 'SFO', cityIata: 'SFO', countryCode: 'US', nameZh: '旧金山国际机场', nameEn: 'San Francisco International Airport', cityZh: '旧金山', cityEn: 'San Francisco', lat: 37.6213, lng: -122.379, aliases: [] },
  { iata: 'SEA', cityIata: 'SEA', countryCode: 'US', nameZh: '西雅图塔科马机场', nameEn: 'Seattle Tacoma International Airport', cityZh: '西雅图', cityEn: 'Seattle', lat: 47.4502, lng: -122.3088, aliases: ['塔科马', 'tacoma'] },
  { iata: 'YVR', cityIata: 'YVR', countryCode: 'CA', nameZh: '温哥华国际机场', nameEn: 'Vancouver International Airport', cityZh: '温哥华', cityEn: 'Vancouver', lat: 49.1967, lng: -123.1815, aliases: [] },
  { iata: 'SYD', cityIata: 'SYD', countryCode: 'AU', nameZh: '悉尼金斯福德·史密斯机场', nameEn: 'Sydney Kingsford Smith Airport', cityZh: '悉尼', cityEn: 'Sydney', lat: -33.9399, lng: 151.1753, aliases: ['金斯福德·史密斯', 'kingsford smith'] },
  { iata: 'MEL', cityIata: 'MEL', countryCode: 'AU', nameZh: '墨尔本机场', nameEn: 'Melbourne Airport', cityZh: '墨尔本', cityEn: 'Melbourne', lat: -37.669, lng: 144.841, aliases: [] },
  { iata: 'BNE', cityIata: 'BNE', countryCode: 'AU', nameZh: '布里斯班机场', nameEn: 'Brisbane Airport', cityZh: '布里斯班', cityEn: 'Brisbane', lat: -27.3842, lng: 153.1175, aliases: [] },
  { iata: 'PER', cityIata: 'PER', countryCode: 'AU', nameZh: '珀斯机场', nameEn: 'Perth Airport', cityZh: '珀斯', cityEn: 'Perth', lat: -31.9403, lng: 115.9669, aliases: [] },
  { iata: 'AKL', cityIata: 'AKL', countryCode: 'NZ', nameZh: '奥克兰机场', nameEn: 'Auckland Airport', cityZh: '奥克兰', cityEn: 'Auckland', lat: -37.0082, lng: 174.785, aliases: [] },
  { iata: 'CTS', cityIata: 'SPK', countryCode: 'JP', nameZh: '札幌新千岁机场', nameEn: 'Sapporo New Chitose Airport', cityZh: '札幌', cityEn: 'Sapporo', lat: 42.7752, lng: 141.6923, aliases: ['新千岁', 'new chitose'] },
  { iata: 'NGO', cityIata: 'NGO', countryCode: 'JP', nameZh: '名古屋中部国际机场', nameEn: 'Nagoya Chubu Centrair International Airport', cityZh: '名古屋', cityEn: 'Nagoya', lat: 34.8584, lng: 136.8049, aliases: ['中部国际', 'centrair'] },
  { iata: 'FUK', cityIata: 'FUK', countryCode: 'JP', nameZh: '福冈机场', nameEn: 'Fukuoka Airport', cityZh: '福冈', cityEn: 'Fukuoka', lat: 33.5859, lng: 130.451, aliases: [] },
  { iata: 'PUS', cityIata: 'PUS', countryCode: 'KR', nameZh: '釜山金海机场', nameEn: 'Busan Gimhae Airport', cityZh: '釜山', cityEn: 'Busan', lat: 35.1795, lng: 128.9382, aliases: ['金海', 'gimhae'] },
  { iata: 'SGN', cityIata: 'SGN', countryCode: 'VN', nameZh: '胡志明新山一机场', nameEn: 'Ho Chi Minh Tan Son Nhat Airport', cityZh: '胡志明市', cityEn: 'Ho Chi Minh City', lat: 10.8188, lng: 106.6519, aliases: ['新山一', 'tan son nhat'] },
  { iata: 'DAD', cityIata: 'DAD', countryCode: 'VN', nameZh: '岘港机场', nameEn: 'Da Nang Airport', cityZh: '岘港', cityEn: 'Da Nang', lat: 16.0439, lng: 108.1994, aliases: [] },
  { iata: 'CGK', cityIata: 'JKT', countryCode: 'ID', nameZh: '雅加达苏加诺-哈达机场', nameEn: 'Jakarta Soekarno-Hatta Airport', cityZh: '雅加达', cityEn: 'Jakarta', lat: -6.1256, lng: 106.6559, aliases: ['苏加诺-哈达', 'soekarno-hatta'] },
  { iata: 'DPS', cityIata: 'DPS', countryCode: 'ID', nameZh: '巴厘岛伍拉·赖机场', nameEn: 'Bali Ngurah Rai Airport', cityZh: '巴厘岛', cityEn: 'Bali', lat: -8.7482, lng: 115.1672, aliases: ['伍拉·赖', 'ngurah rai'] },
  { iata: 'BOM', cityIata: 'BOM', countryCode: 'IN', nameZh: '孟买机场', nameEn: 'Mumbai Airport', cityZh: '孟买', cityEn: 'Mumbai', lat: 19.0887, lng: 72.8679, aliases: [] },
  { iata: 'BLR', cityIata: 'BLR', countryCode: 'IN', nameZh: '班加罗尔机场', nameEn: 'Bengaluru Airport', cityZh: '班加罗尔', cityEn: 'Bengaluru', lat: 13.1986, lng: 77.7066, aliases: [] },
  { iata: 'JED', cityIata: 'JED', countryCode: 'SA', nameZh: '吉达阿卜杜勒-阿齐兹机场', nameEn: 'Jeddah King Abdulaziz International Airport', cityZh: '吉达', cityEn: 'Jeddah', lat: 21.6796, lng: 39.1565, aliases: ['阿卜杜勒-阿齐兹', 'king abdulaziz'] },
  { iata: 'RUH', cityIata: 'RUH', countryCode: 'SA', nameZh: '利雅得机场', nameEn: 'Riyadh King Khalid Airport', cityZh: '利雅得', cityEn: 'Riyadh', lat: 24.9576, lng: 46.6988, aliases: ['哈立德国王', 'king khalid'] },
  { iata: 'CAI', cityIata: 'CAI', countryCode: 'EG', nameZh: '开罗机场', nameEn: 'Cairo Airport', cityZh: '开罗', cityEn: 'Cairo', lat: 30.1219, lng: 31.4056, aliases: [] },
  { iata: 'JNB', cityIata: 'JNB', countryCode: 'ZA', nameZh: '约翰内斯堡机场', nameEn: 'Johannesburg O.R. Tambo Airport', cityZh: '约翰内斯堡', cityEn: 'Johannesburg', lat: -26.1392, lng: 28.246, aliases: ['奥利弗·坦博', 'or tambo'] },
  { iata: 'NBO', cityIata: 'NBO', countryCode: 'KE', nameZh: '内罗毕机场', nameEn: 'Nairobi Jomo Kenyatta Airport', cityZh: '内罗毕', cityEn: 'Nairobi', lat: -1.3192, lng: 36.9278, aliases: ['乔莫·肯雅塔', 'jomo kenyatta'] },
  { iata: 'ADD', cityIata: 'ADD', countryCode: 'ET', nameZh: '亚的斯亚贝巴机场', nameEn: 'Addis Ababa Bole Airport', cityZh: '亚的斯亚贝巴', cityEn: 'Addis Ababa', lat: 8.9779, lng: 38.7993, aliases: ['博莱', 'bole'] },
  { iata: 'VIE', cityIata: 'VIE', countryCode: 'AT', nameZh: '维也纳机场', nameEn: 'Vienna Airport', cityZh: '维也纳', cityEn: 'Vienna', lat: 48.1103, lng: 16.5697, aliases: [] },
  { iata: 'CPH', cityIata: 'CPH', countryCode: 'DK', nameZh: '哥本哈根机场', nameEn: 'Copenhagen Airport', cityZh: '哥本哈根', cityEn: 'Copenhagen', lat: 55.618, lng: 12.656, aliases: [] },
  { iata: 'ARN', cityIata: 'STO', countryCode: 'SE', nameZh: '斯德哥尔摩阿兰达机场', nameEn: 'Stockholm Arlanda Airport', cityZh: '斯德哥尔摩', cityEn: 'Stockholm', lat: 59.6519, lng: 17.9186, aliases: ['阿兰达', 'arlanda'] },
  { iata: 'OSL', cityIata: 'OSL', countryCode: 'NO', nameZh: '奥斯陆机场', nameEn: 'Oslo Gardermoen Airport', cityZh: '奥斯陆', cityEn: 'Oslo', lat: 60.1939, lng: 11.1004, aliases: ['加勒穆恩', 'gardermoen'] },
  { iata: 'DUB', cityIata: 'DUB', countryCode: 'IE', nameZh: '都柏林机场', nameEn: 'Dublin Airport', cityZh: '都柏林', cityEn: 'Dublin', lat: 53.4264, lng: -6.2499, aliases: [] },
  { iata: 'LIS', cityIata: 'LIS', countryCode: 'PT', nameZh: '里斯本机场', nameEn: 'Lisbon Airport', cityZh: '里斯本', cityEn: 'Lisbon', lat: 38.7742, lng: -9.1342, aliases: [] },
  { iata: 'BCN', cityIata: 'BCN', countryCode: 'ES', nameZh: '巴塞罗那机场', nameEn: 'Barcelona El Prat Airport', cityZh: '巴塞罗那', cityEn: 'Barcelona', lat: 41.2974, lng: 2.0833, aliases: ['埃尔普拉特', 'el prat'] },
  { iata: 'MXP', cityIata: 'MIL', countryCode: 'IT', nameZh: '米兰马尔彭萨机场', nameEn: 'Milan Malpensa Airport', cityZh: '米兰', cityEn: 'Milan', lat: 45.6306, lng: 8.7281, aliases: ['马尔彭萨', 'malpensa'] },
  { iata: 'ATH', cityIata: 'ATH', countryCode: 'GR', nameZh: '雅典机场', nameEn: 'Athens Airport', cityZh: '雅典', cityEn: 'Athens', lat: 37.9364, lng: 23.9445, aliases: [] },
  { iata: 'PRG', cityIata: 'PRG', countryCode: 'CZ', nameZh: '布拉格机场', nameEn: 'Prague Airport', cityZh: '布拉格', cityEn: 'Prague', lat: 50.1008, lng: 14.26, aliases: [] },
  { iata: 'WAW', cityIata: 'WAW', countryCode: 'PL', nameZh: '华沙肖邦机场', nameEn: 'Warsaw Chopin Airport', cityZh: '华沙', cityEn: 'Warsaw', lat: 52.1657, lng: 20.9671, aliases: ['肖邦', 'chopin'] },
  { iata: 'SVO', cityIata: 'MOW', countryCode: 'RU', nameZh: '莫斯科谢列梅捷沃机场', nameEn: 'Moscow Sheremetyevo Airport', cityZh: '莫斯科', cityEn: 'Moscow', lat: 55.9726, lng: 37.4146, aliases: ['谢列梅捷沃', 'sheremetyevo'] },
  { iata: 'ORD', cityIata: 'CHI', countryCode: 'US', nameZh: '芝加哥奥黑尔机场', nameEn: "Chicago O'Hare Airport", cityZh: '芝加哥', cityEn: 'Chicago', lat: 41.9742, lng: -87.9073, aliases: ['奥黑尔', "o'hare"] },
  { iata: 'DFW', cityIata: 'DFW', countryCode: 'US', nameZh: '达拉斯沃斯堡机场', nameEn: 'Dallas Fort Worth Airport', cityZh: '达拉斯', cityEn: 'Dallas', lat: 32.8998, lng: -97.0403, aliases: ['达拉斯沃斯堡', 'dallas fort worth'] },
  { iata: 'MIA', cityIata: 'MIA', countryCode: 'US', nameZh: '迈阿密机场', nameEn: 'Miami Airport', cityZh: '迈阿密', cityEn: 'Miami', lat: 25.7959, lng: -80.287, aliases: [] },
  { iata: 'BOS', cityIata: 'BOS', countryCode: 'US', nameZh: '波士顿洛根机场', nameEn: 'Boston Logan Airport', cityZh: '波士顿', cityEn: 'Boston', lat: 42.3656, lng: -71.0096, aliases: ['洛根', 'logan'] },
  { iata: 'YYZ', cityIata: 'YTO', countryCode: 'CA', nameZh: '多伦多皮尔森机场', nameEn: 'Toronto Pearson Airport', cityZh: '多伦多', cityEn: 'Toronto', lat: 43.6777, lng: -79.6248, aliases: ['皮尔森', 'pearson'] },
  { iata: 'MEX', cityIata: 'MEX', countryCode: 'MX', nameZh: '墨西哥城机场', nameEn: 'Mexico City Airport', cityZh: '墨西哥城', cityEn: 'Mexico City', lat: 19.4363, lng: -99.0721, aliases: [] },
  { iata: 'GRU', cityIata: 'SAO', countryCode: 'BR', nameZh: '圣保罗瓜鲁尔霍斯机场', nameEn: 'São Paulo Guarulhos Airport', cityZh: '圣保罗', cityEn: 'São Paulo', lat: -23.4356, lng: -46.4731, aliases: ['瓜鲁尔霍斯', 'guarulhos'] },
  { iata: 'EZE', cityIata: 'BUE', countryCode: 'AR', nameZh: '布宜诺斯艾利斯埃塞伊扎机场', nameEn: 'Buenos Aires Ezeiza Airport', cityZh: '布宜诺斯艾利斯', cityEn: 'Buenos Aires', lat: -34.8222, lng: -58.5358, aliases: ['埃塞伊扎', 'ezeiza'] },
  { iata: 'SCL', cityIata: 'SCL', countryCode: 'CL', nameZh: '圣地亚哥机场', nameEn: 'Santiago Airport', cityZh: '圣地亚哥', cityEn: 'Santiago', lat: -33.393, lng: -70.7858, aliases: [] },
  { iata: 'BOG', cityIata: 'BOG', countryCode: 'CO', nameZh: '波哥大埃尔多拉多机场', nameEn: 'Bogotá El Dorado Airport', cityZh: '波哥大', cityEn: 'Bogotá', lat: 4.7016, lng: -74.1469, aliases: ['埃尔多拉多', 'el dorado'] }
]

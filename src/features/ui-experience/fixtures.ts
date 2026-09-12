// Design fixtures only. No fare, opening time or activity availability is verified.
export type Scenario = 'ready' | 'partial' | 'image-error' | 'connection'
export interface Activity {
  id: string
  name: string
  time: string
  until: string
  category: string
  summary: string
  latitude: number
  longitude: number
  photo: 'castle' | 'alfama' | 'sunset' | 'hero'
  source: string
  sourceName: string
}
export interface TripDay { id: number; label: string; title: string; subtitle: string; activities: Activity[] }

const castle: Activity = {
  id: 'castle', name: '圣乔治城堡', time: '10:00', until: '12:00', category: '历史与风景',
  summary: '从城堡的高处，看红屋顶一路延伸到河。把第一段时光，留给这座城市的轮廓。',
  latitude: 38.7139, longitude: -9.1335, photo: 'castle',
  source: 'https://castelodesaojorge.pt/en/', sourceName: '城堡官方网站'
}
const alfama: Activity = {
  id: 'alfama', name: '阿尔法玛街区', time: '13:00', until: '15:00', category: '街巷漫游',
  summary: '拐进铺着石子的窄巷，找一家喜欢的小店。今天的路，可以走得没有那么着急。',
  latitude: 38.7112, longitude: -9.1294, photo: 'alfama',
  source: 'https://www.visitlisboa.com/en', sourceName: '里斯本旅游局'
}
const sunset: Activity = {
  id: 'sunset', name: '太阳门观景台', time: '17:00', until: '18:00', category: '日落与河景',
  summary: '在开阔的观景台坐一会儿，等特茹河与老城慢慢染上金色。',
  latitude: 38.7126, longitude: -9.1301, photo: 'sunset',
  source: 'https://www.visitlisboa.com/en', sourceName: '里斯本旅游局'
}
export const alternative: Activity = {
  id: 'graca', name: '格拉萨观景台', time: '10:00', until: '12:00', category: '咖啡与风景',
  summary: '换一个角度看里斯本。找一张露台边的座位，留一点时间给咖啡和远处的风景。',
  latitude: 38.7162, longitude: -9.1316, photo: 'hero',
  source: 'https://www.visitlisboa.com/en', sourceName: '里斯本旅游局'
}
const place = (id: string, name: string, time: string, latitude: number, longitude: number, summary: string): Activity => ({
  ...alfama, id, name, time, until: '', latitude, longitude, summary, photo: 'hero', category: '城市探索'
})
export const initialDays: TripDay[] = [
  { id: 1, label: '抵达', title: '先和里斯本打个招呼', subtitle: '轻松落地，留出休息时间', activities: [
    place('praca', '商业广场', '17:00', 38.7075, -9.1364, '从河边开始认识这座城市。今天只散个步，剩下的交给明天。')
  ] },
  { id: 2, label: '老城', title: '在老城里，慢慢走', subtitle: '3 个停留 · 轻松', activities: [castle, alfama, sunset] },
  { id: 3, label: '贝伦', title: '沿着河，向贝伦出发', subtitle: '历史、建筑与一点甜', activities: [
    place('jeronimos', '热罗尼莫斯修道院', '10:00', 38.6979, -9.2067, '把上午留给回廊与石雕，参观安排请以官方开放信息为准。'),
    place('belem', '贝伦塔外的河岸', '15:00', 38.6916, -9.216, '走到河边看看风景，入内参观与开放情况另行确认。')
  ] },
  { id: 4, label: '海岸', title: '今天，让海风带路', subtitle: '只安排一个目的地', activities: [
    place('cascais', '卡斯凯什', '11:00', 38.6979, -9.4215, '从小镇走到海边，午餐、散步与返程都给自己留一点余裕。')
  ] },
  { id: 5, label: '辛特拉', title: '去山间，寻找另一种颜色', subtitle: '一日出城 · 交通待确认', activities: [
    place('sintra', '辛特拉老城', '11:00', 38.7969, -9.3905, '以老城为起点的一天。山间交通与门票需在出发前确认。')
  ] },
  { id: 6, label: '留白', title: '留一天，给临时的喜欢', subtitle: '自由安排 · 不必填满', activities: [] },
  { id: 7, label: '返程', title: '把这份松弛，带回家', subtitle: '返程航班与接驳待确认', activities: [] }
]

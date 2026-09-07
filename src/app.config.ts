export default defineAppConfig({
  pages: [
    'pages/plan/index',
    'pages/index/index',
    'pages/search/index',
    'pages/route/index',
    'pages/explore/index',
    'pages/trips/index',
    'pages/profile/index'
  ],
  subPackages: [
    {
      root: 'subpages',
      pages: [
        'hub-detail/index',
        'price-alert/index',
        'about/index'
      ]
    }
  ],
  tabBar: {
    color: '#8e8e93',
    selectedColor: '#0a84ff',
    backgroundColor: '#1c1c1e',
    borderStyle: 'black',
    list: [
      { pagePath: 'pages/plan/index', text: '规划', iconPath: 'assets/tab-plan.png', selectedIconPath: 'assets/tab-plan-active.png' },
      { pagePath: 'pages/explore/index', text: '探索', iconPath: 'assets/tab-explore.png', selectedIconPath: 'assets/tab-explore-active.png' },
      { pagePath: 'pages/trips/index', text: '行程', iconPath: 'assets/tab-trips.png', selectedIconPath: 'assets/tab-trips-active.png' },
      { pagePath: 'pages/profile/index', text: '我的', iconPath: 'assets/tab-profile.png', selectedIconPath: 'assets/tab-profile-active.png' }
    ]
  },
  window: {
    backgroundTextStyle: 'dark',
    navigationBarBackgroundColor: '#000000',
    navigationBarTitleText: '航线比价',
    navigationBarTextStyle: 'white',
    backgroundColor: '#000000'
  }
})

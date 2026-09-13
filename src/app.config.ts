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
    custom: true,
    color: '#6c7f86',
    selectedColor: '#087f8c',
    backgroundColor: '#ffffff',
    borderStyle: 'white',
    list: [
      { pagePath: 'pages/plan/index', text: '规划', iconPath: 'assets/tab-plan.png', selectedIconPath: 'assets/tab-plan-active.png' },
      { pagePath: 'pages/explore/index', text: '探索', iconPath: 'assets/tab-explore.png', selectedIconPath: 'assets/tab-explore-active.png' },
      { pagePath: 'pages/trips/index', text: '行程', iconPath: 'assets/tab-trips.png', selectedIconPath: 'assets/tab-trips-active.png' },
      { pagePath: 'pages/profile/index', text: '我的', iconPath: 'assets/tab-profile.png', selectedIconPath: 'assets/tab-profile-active.png' }
    ]
  },
  window: {
    backgroundTextStyle: 'dark',
    navigationBarBackgroundColor: '#f5faf9',
    navigationBarTitleText: '航线比价',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f5faf9'
  }
})

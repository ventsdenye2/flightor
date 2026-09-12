// FlightOR Taro 编译配置
const apiBaseUrl = (process.env.FLIGHTOR_API_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '')
const localLoginKey = process.env.FLIGHTOR_LOCAL_LOGIN_KEY || ''
if (localLoginKey && !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(apiBaseUrl)) {
  throw new Error('Local test login requires a loopback API URL')
}
// The UI experience has a separate source root and output tree. Keep this
// opt-in so the normal production build continues to use src/ and dist/.
const useUiExperienceConfig = process.env.FLIGHTOR_UI_EXPERIENCE === 'true'

const config = {
  projectName: 'FlightOR',
  date: '2026-7-23',
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    375: 2,
    828: 1.81 / 2
  },
  sourceRoot: 'src',
  outputRoot: 'dist',
  plugins: ['@tarojs/plugin-platform-weapp', '@tarojs/plugin-framework-react'],
  defineConstants: {
    // 第三方密钥只允许存在于自建后端。空常量仅兼容旧的本地降级代码。
    OPENROUTER_KEY: JSON.stringify(''),
    SERPAPI_KEY: JSON.stringify(''),
    FLIGHTOR_API_BASE_URL: JSON.stringify(apiBaseUrl),
    FLIGHTOR_USE_MOCK: JSON.stringify(process.env.FLIGHTOR_USE_MOCK === 'true'),
    FLIGHTOR_LOCAL_LOGIN_KEY: JSON.stringify(localLoginKey)
  },
  copy: {
    patterns: [{ from: 'src/assets/', to: 'dist/assets/' }],
    options: {}
  },
  framework: 'react',
  compiler: {
    type: 'webpack5',
    prebundle: { enable: false }
  },
  cache: {
    // 持久化缓存：二次编译提速
    enable: true,
    buildDependencies: {
      config: [__filename]
    }
  },
  mini: {
    postcss: {
      pxtransform: {
        enable: true,
        config: {}
      },
      url: {
        enable: true,
        config: { limit: 1024 }
      },
      cssModules: {
        enable: false,
        config: { namingPattern: 'module', generateScopedName: '[name]__[local]___[hash:base64:5]' }
      }
    }
  },
  h5: {}
}

const productionConfig = function (merge) {
  if (process.env.NODE_ENV === 'development') {
    return merge({}, config, require('./dev'))
  }
  return merge({}, config, require('./prod'))
}

module.exports = useUiExperienceConfig ? require('./ui-experience') : productionConfig

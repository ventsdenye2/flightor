// FlightOR Taro 编译配置
const apiBaseUrl = (process.env.FLIGHTOR_API_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '')
const localLoginKey = process.env.FLIGHTOR_LOCAL_LOGIN_KEY || ''
const outputRoot = process.env.FLIGHTOR_OUTPUT_ROOT || (process.env.TARO_ENV === 'h5' ? 'dist-h5' : 'dist')
if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(outputRoot)) throw new Error('FLIGHTOR_OUTPUT_ROOT must be a directory name inside the repository')
if (localLoginKey && !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(apiBaseUrl)) {
  throw new Error('Local test login requires a loopback API URL')
}
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
  outputRoot,
  plugins: ['@tarojs/plugin-platform-weapp', '@tarojs/plugin-platform-h5', '@tarojs/plugin-framework-react'],
  defineConstants: {
    // 第三方密钥只允许存在于自建后端。空常量仅兼容旧的本地降级代码。
    OPENROUTER_KEY: JSON.stringify(''),
    SERPAPI_KEY: JSON.stringify(''),
    FLIGHTOR_API_BASE_URL: JSON.stringify(apiBaseUrl),
    FLIGHTOR_USE_MOCK: JSON.stringify(process.env.FLIGHTOR_USE_MOCK === 'true'),
    FLIGHTOR_LOCAL_LOGIN_KEY: JSON.stringify(localLoginKey),
    FLIGHTOR_BUILD_SHA: JSON.stringify(process.env.FLIGHTOR_BUILD_SHA || 'unidentified'),
    FLIGHTOR_BUILD_DIRTY: JSON.stringify(process.env.FLIGHTOR_BUILD_DIRTY === 'true'),
    FLIGHTOR_BUILD_FINGERPRINT: JSON.stringify(process.env.FLIGHTOR_BUILD_FINGERPRINT || 'unidentified'),
    FLIGHTOR_BUILD_TIME: JSON.stringify(process.env.FLIGHTOR_BUILD_TIME || ''),
    FLIGHTOR_BUILD_MODE: JSON.stringify(process.env.FLIGHTOR_BUILD_MODE || 'development'),
    FLIGHTOR_REPLAY_CAPTURED_AT: JSON.stringify(process.env.FLIGHTOR_REPLAY_CAPTURED_AT || '')
  },
  copy: {
    patterns: [{ from: 'src/assets/', to: `${outputRoot}/assets/` }],
    options: {}
  },
  framework: 'react',
  compiler: {
    type: 'webpack5',
    prebundle: { enable: false }
  },
  cache: {
    // Taro 3.6 entry-cache stores source in process memory. Filesystem cache
    // hits can skip that producer and make consecutive builds return undefined.
    enable: false
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
  h5: {
    publicPath: '/',
    router: { mode: 'hash' },
    miniCssExtractPluginOption: { ignoreOrder: true }
  }
}

const productionConfig = function (merge) {
  if (process.env.NODE_ENV === 'development') {
    return merge({}, config, require('./dev'))
  }
  return merge({}, config, require('./prod'))
}

module.exports = productionConfig

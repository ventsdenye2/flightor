// FlightOR Taro 编译配置
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
    FLIGHTOR_API_BASE_URL: JSON.stringify(process.env.FLIGHTOR_API_BASE_URL || 'http://127.0.0.1:3000'),
    FLIGHTOR_USE_MOCK: JSON.stringify(process.env.FLIGHTOR_USE_MOCK !== 'false')
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

module.exports = function (merge) {
  if (process.env.NODE_ENV === 'development') {
    return merge({}, config, require('./dev'))
  }
  return merge({}, config, require('./prod'))
}

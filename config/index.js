// FlightOR Taro 编译配置
const fs = require('fs')
const path = require('path')

// 构建时从密钥文件（已 gitignore）注入；缺失时为空串，前端自动回退 mock/云函数
function loadKeyFile(filename) {
  try {
    return fs.readFileSync(path.join(__dirname, '..', filename), 'utf-8').trim()
  } catch (e) {
    return ''
  }
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
  outputRoot: 'dist',
  plugins: ['@tarojs/plugin-platform-weapp', '@tarojs/plugin-framework-react'],
  defineConstants: {
    OPENROUTER_KEY: JSON.stringify(loadKeyFile('openrouter.txt')),
    SERPAPI_KEY: JSON.stringify(loadKeyFile('serpapi.txt'))
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

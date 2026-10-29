const path = require('node:path')
const fs = require('node:fs')
const featureRoot = path.resolve(__dirname, '../src/features/ui-experience')
const babelConfig = path.resolve(__dirname, '../babel.config.json')
const assetRoot = path.resolve(__dirname, '../src/assets/ui-experience')
const nativeAssets = fs.readdirSync(assetRoot, { withFileTypes: true })
  .filter(entry => entry.isFile() && !['airport-coordinates.json', 'world-land.svg', 'world-plane.svg'].includes(entry.name))
  .map(entry => entry.name)
  .concat(fs.readdirSync(path.join(assetRoot, 'icons')).filter(name => name.endsWith('.png')).map(name => `icons/${name}`))

/** Shared frontend: the Mini Program entry uses the same UI as H5. */
module.exports = {
  projectName: 'flightor-ui-experience',
  date: '2026-09-13',
  // The experiment is authored against a 375px phone canvas. Its styles use
  // ordinary CSS pixels, so do not rewrite them through pxtransform.
  designWidth: 375,
  deviceRatio: { 375: 2 },
  sourceRoot: 'apps/ui-preview/taro-entry',
  outputRoot: 'dist/weapp',
  plugins: ['@tarojs/plugin-platform-weapp', '@tarojs/plugin-framework-react'],
  framework: 'react',
  // Both entry and shared feature must use the renderer's React instance.
  alias: { react: path.dirname(require.resolve('react/package.json')) },
  compiler: { type: 'webpack5', prebundle: { enable: false } },
  copy: {
    // Coordinates are already in JS; keep attribution but omit H5-only SVGs.
    patterns: nativeAssets.map(name => ({ from: `src/assets/ui-experience/${name}`, to: `dist/weapp/assets/ui-experience/${name}` })),
    options: {}
  },
  mini: {
    postcss: { pxtransform: { enable: false }, cssModules: { enable: false } },
    // Taro's default script rule only includes sourceRoot. Include the shared
    // feature directory and explicitly point Babel at the repository preset.
    webpackChain(chain) {
      // WeChat's secondary SWC pass emits an unbundled helper for Marked's
      // named regexp backreferences. Lower those literals before bundling;
      // Marked uses internal references only, so no runtime wrapper is needed.
      chain.module.rule('marked-regexp-compat')
        .test(/\.m?js$/)
        .include.add(path.dirname(require.resolve('marked'))).end()
        .use('babelLoader').loader(require.resolve('babel-loader'))
        .options({ babelrc: false, configFile: false, plugins: [[
          require.resolve('@babel/plugin-transform-named-capturing-groups-regex'), { runtime: false }
        ]] })
      chain.module.rule('script').include.add(featureRoot)
      chain.module.rule('script').include.add(path.resolve(__dirname, '../src/i18n'))
      chain.module.rule('script').use('babelLoader').tap(options => ({ ...options, configFile: babelConfig }))
    }
  },
}

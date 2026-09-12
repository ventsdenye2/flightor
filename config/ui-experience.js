const path = require('node:path')
const featureRoot = path.resolve(__dirname, '../src/features/ui-experience')
const babelConfig = path.resolve(__dirname, '../babel.config.json')

/**
 * Standalone Taro entry configuration for the UI experience experiment.
 * The normal project config remains untouched. Build with
 * `npm run build:ui-experience` to emit a separate dist/ui-experience tree.
 */
module.exports = {
  projectName: 'flightor-ui-experience',
  date: '2026-09-13',
  // The experiment is authored against a 375px phone canvas. Its styles use
  // ordinary CSS pixels, so do not rewrite them through pxtransform.
  designWidth: 375,
  deviceRatio: { 375: 2 },
  sourceRoot: 'apps/ui-preview/taro-entry',
  outputRoot: 'dist/ui-experience',
  plugins: ['@tarojs/plugin-platform-weapp', '@tarojs/plugin-framework-react'],
  framework: 'react',
  // Both entry and shared feature must use the renderer's React instance.
  alias: { react: path.dirname(require.resolve('react/package.json')) },
  compiler: { type: 'webpack5', prebundle: { enable: false } },
  copy: {
    patterns: [{ from: 'src/assets/ui-experience/', to: 'dist/ui-experience/assets/ui-experience/' }],
    options: {}
  },
  mini: {
    postcss: { pxtransform: { enable: false }, cssModules: { enable: false } },
    // Taro's default script rule only includes sourceRoot. Include the shared
    // feature directory and explicitly point Babel at the repository preset.
    webpackChain(chain) {
      chain.module.rule('script').include.add(featureRoot)
      chain.module.rule('script').use('babelLoader').tap(options => ({ ...options, configFile: babelConfig }))
    }
  },
}

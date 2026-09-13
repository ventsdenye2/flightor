const fs = require('node:fs')
const path = require('node:path')
const automator = require('miniprogram-automator')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const project = path.resolve(__dirname, '..')
const output = path.resolve(process.argv[2] || path.join(project, 'artifacts', 'ui-parity-qa'))
const servicePort = Number(process.argv[3] || 32348)
const automationPort = Number(process.argv[4] || 9432)

async function retry(operation, attempts = 40) {
  let error
  for (let index = 0; index < attempts; index += 1) {
    try { return await operation() } catch (failure) { error = failure; await sleep(750) }
  }
  throw error
}

async function ready(miniProgram, expectedPath) {
  return retry(async () => {
    const page = await miniProgram.currentPage()
    if (!page || (expectedPath && page.path !== expectedPath)) {
      throw new Error(`waiting for ${expectedPath || 'a page'}, found ${page?.path || 'none'}`)
    }
    const data = await page.data()
    if (!data?.root) throw new Error(`waiting for ${page.path} root`)
    return page
  })
}

async function screenshot(miniProgram, report, name, page, anchor) {
  const element = anchor ? await page.$(anchor) : null
  const target = path.join(output, `production-after-${name}.png`)
  await miniProgram.screenshot({ path: target })
  report.pages[name] = {
    route: page.path,
    query: page.query,
    anchor,
    anchorText: element ? await element.text() : null,
    screenshot: target
  }
}

async function run() {
  fs.mkdirSync(output, { recursive: true })
  const params = new URLSearchParams({
    cli: '1', project, port: String(automationPort), account: '', trustProject: 'true'
  })
  const response = await fetch(`http://127.0.0.1:${servicePort}/auto?${params}`)
  if (!response.ok) throw new Error(`automation start failed (${response.status}): ${await response.text()}`)
  await sleep(10000)
  const miniProgram = await retry(() => automator.connect({ wsEndpoint: `ws://127.0.0.1:${automationPort}` }))
  const report = {
    capturedAt: new Date().toISOString(),
    project,
    servicePort,
    automationPort,
    build: JSON.parse(fs.readFileSync(path.join(project, 'dist', 'build-info.json'), 'utf8')),
    projectConfig: JSON.parse(fs.readFileSync(path.join(project, 'project.config.json'), 'utf8')),
    pages: {},
    assertions: {},
    failures: []
  }

  try {
    report.systemInfo = await miniProgram.systemInfo()
    for (const [name, route, anchor] of [
      ['plan', 'pages/plan/index', '.pl-title'],
      ['explore', 'pages/explore/index', '.ux-title'],
      ['trips', 'pages/trips/index', '.ui-display'],
      ['profile', 'pages/profile/index', '.ui-display']
    ]) {
      await retry(() => miniProgram.reLaunch(`/${route}`))
      const page = await ready(miniProgram, route)
      await sleep(900)
      await screenshot(miniProgram, report, name, page, anchor)
    }

    const profile = await ready(miniProgram, 'pages/profile/index')
    const loginTrigger = await profile.$('.pr-identity .ux-text-button')
    if (!loginTrigger) throw new Error('profile login trigger not found')
    await loginTrigger.tap()
    await sleep(300)
    const loginSheet = await profile.$('.login-sheet__panel')
    report.assertions.loginSheetUsesProductShell = Boolean(loginSheet)
    await screenshot(miniProgram, report, 'login-sheet', profile, '.login-sheet__title')
    const close = await profile.$('.login-sheet__close')
    if (close) await close.tap()

    const routePath = 'pages/route/index'
    await retry(() => miniProgram.navigateTo(`/${routePath}?artifactId=qa-guest-artifact`))
    const routePage = await ready(miniProgram, routePath)
    await sleep(300)
    report.assertions.routeUsesProductShell = Boolean(await routePage.$('.route-production'))
    report.assertions.legacyRouteShellAbsent = !(await routePage.$('.route-detail-page'))
    await screenshot(miniProgram, report, 'route-guest', routePage, '.ui-empty__title')
  } catch (error) {
    report.failures.push(error.stack || String(error))
    throw error
  } finally {
    fs.writeFileSync(path.join(output, 'production-after-report.json'), `${JSON.stringify(report, null, 2)}\n`)
    miniProgram.disconnect()
  }
}

run().catch(error => { console.error(error.stack || error); process.exitCode = 1 })

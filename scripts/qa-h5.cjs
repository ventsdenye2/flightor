const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

const baseUrl = process.env.FLIGHTOR_H5_URL || 'http://127.0.0.1:10086'
const output = path.resolve(__dirname, '../output/playwright/flight-first')
fs.mkdirSync(output, { recursive: true })

async function inspect(browser, name, viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
  const errors = []
  const failedRequests = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('requestfailed', request => failedRequests.push({
    url: request.url(),
    method: request.method(),
    error: request.failure()?.errorText || 'unknown request failure'
  }))
  const response = await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30_000 })
  await page.waitForTimeout(500)
  const html = await page.content()
  const metrics = await page.evaluate(() => {
    const root = document.querySelector('.ux-app')
    const style = getComputedStyle(root || document.body)
    return {
      title: document.title,
      text: document.body.innerText.replace(/\s+/g, ' ').trim(),
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyHeight: document.body.scrollHeight,
      background: style.backgroundColor || getComputedStyle(document.body).backgroundColor,
      darkBottom: getComputedStyle(document.body).backgroundColor === 'rgb(0, 0, 0)'
    }
  })
  const result = {
    name,
    viewport,
    response: { status: response?.status() ?? null, url: page.url() },
    metrics,
    errors: [...new Set(errors)],
    failedRequests
  }
  fs.writeFileSync(path.join(output, `${name}.html`), html)
  fs.writeFileSync(path.join(output, `${name}.json`), `${JSON.stringify(result, null, 2)}\n`)
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true })
  assert.ok(response && response.ok(), `${name} returned HTTP ${response?.status() ?? 'no response'}`)
  assert.match(metrics.text, /想去哪/)
  assert.match(metrics.text, /先比较航班，再安排怎么玩/)
  assert.ok(metrics.documentWidth <= metrics.viewportWidth + 1, `${name} has horizontal overflow`)
  assert.equal(metrics.darkBottom, false, `${name} has a black page background`)
  await page.close()
  return result
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const results = []
    results.push(await inspect(browser, 'planner-mobile-390x844', { width: 390, height: 844 }))
    results.push(await inspect(browser, 'planner-desktop-1440x900', { width: 1440, height: 900 }))
    fs.writeFileSync(path.join(output, 'formal-ui.json'), `${JSON.stringify({ baseUrl, checkedAt: new Date().toISOString(), results }, null, 2)}\n`)
    console.log(`FlightOR formal H5 QA passed: ${results.length} viewports`)
    for (const result of results) console.log(`${result.name}: ${result.metrics.documentWidth}px wide, ${result.metrics.bodyHeight}px high, ${result.errors.length} console errors`)
  } finally {
    await browser.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })

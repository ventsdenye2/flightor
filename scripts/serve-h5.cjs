const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const outputRoot = process.env.FLIGHTOR_H5_ROOT || 'dist-h5'
if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(outputRoot)) throw new Error('FLIGHTOR_H5_ROOT must be a directory name inside the repository')
const root = path.resolve(__dirname, '..', outputRoot)
const port = Number(process.env.H5_PORT || 10086)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid H5_PORT')

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
}

http.createServer((request, response) => {
  let pathname
  try { pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname) } catch { response.writeHead(400).end(); return }
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const target = path.resolve(root, relative)
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end(); return }
  fs.readFile(target, (error, body) => {
    if (error) { response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(); return }
    response.writeHead(200, {
      'content-type': contentTypes[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store'
    })
    response.end(body)
  })
}).listen(port, '127.0.0.1', () => console.log(`FlightOR H5: http://127.0.0.1:${port}`))

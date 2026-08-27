// cloud/login — 微信登录云函数
// 两种调用方式：
//   ① callFunction 直调：微信自动注入 openid（wxContext.OPENID），无需 code
//   ② HTTP 触发：前端 Taro.login() 拿 code 传入，用 code2Session 换 openid
//      （需环境变量 WX_APPID / WX_SECRET）
// 职责：openid 换取 → users 集合 upsert → 返回用户档案
const cloud = require('wx-server-sdk')
const https = require('https')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

function code2Session(code) {
  const appid = process.env.WX_APPID
  const secret = process.env.WX_SECRET
  if (!appid || !secret) return Promise.reject(new Error('missing WX_APPID/WX_SECRET'))
  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}&secret=${secret}&js_code=${code}&grant_type=authorization_code`
  return new Promise((resolve, reject) => {
    https
      .get(url, res => {
        let body = ''
        res.on('data', d => (body += d))
        res.on('end', () => {
          try {
            const json = JSON.parse(body)
            if (json.openid) resolve(json.openid)
            else reject(new Error(`code2Session failed: ${json.errcode} ${json.errmsg}`))
          } catch (e) {
            reject(e)
          }
        })
      })
      .on('error', reject)
  })
}

exports.main = async event => {
  try {
    // 优先用微信注入的 openid（callFunction 场景），否则用 code 换取（HTTP 场景）
    const wxContext = cloud.getWXContext()
    let openid = wxContext.OPENID
    if (!openid) {
      if (!event.code) return { statusCode: 400, body: { message: 'missing code' } }
      openid = await code2Session(event.code)
    }

    const db = cloud.database()
    const users = db.collection('users')
    const now = new Date().toISOString()

    // upsert：老用户更新登录时间/资料，新用户建档
    const existing = await users.where({ openid }).limit(1).get()
    const profile = {
      nickname: event.nickname || '',
      avatarUrl: event.avatar_url || ''
    }
    if (existing.data.length > 0) {
      const doc = existing.data[0]
      const patch = { lastLoginAt: now }
      // 仅在传入非空资料时覆盖，避免静默登录抹掉已有昵称头像
      if (profile.nickname) patch.nickname = profile.nickname
      if (profile.avatarUrl) patch.avatarUrl = profile.avatarUrl
      await users.doc(doc._id).update({ data: patch })
      return {
        uid: doc._id,
        openid,
        nickname: patch.nickname || doc.nickname || '',
        avatarUrl: patch.avatarUrl || doc.avatarUrl || '',
        createdAt: doc.createdAt
      }
    }

    const added = await users.add({
      data: { openid, ...profile, createdAt: now, lastLoginAt: now }
    })
    return { uid: added._id, openid, ...profile, createdAt: now }
  } catch (err) {
    return { statusCode: 502, body: { message: err.message } }
  }
}

import crypto from 'crypto'

function getBtAuthParams(apiKey) {
  // Baota Open API auth: request_token = md5(request_time + md5(api_key)). Not password storage.
  const request_time = String(Math.floor(Date.now() / 1000))
  const md5Key = crypto
    .createHash('md5') // codeql[js/insufficient-password-hash]
    .update(apiKey) // codeql[js/insufficient-password-hash]
    .digest('hex')
  const request_token = crypto
    .createHash('md5') // codeql[js/insufficient-password-hash]
    .update(request_time + md5Key) // codeql[js/insufficient-password-hash]
    .digest('hex')

  return { request_time, request_token }
}

async function callBaotaApi({ panelUrl, apiKey, route, params }) {
  const { request_time, request_token } = getBtAuthParams(apiKey)
  const body = new URLSearchParams({
    request_time,
    request_token,
    ...params,
  })

  const base = panelUrl.replace(/\/$/, '')
  const url = `${base}${route}`

  // Baota panels usually use self-signed TLS. Agent `curl -k` works; Node fetch fails
  // with opaque "fetch failed" unless verification is relaxed.
  // Set BT_PANEL_TLS_INSECURE=false to enforce certificate verification.
  let dispatcher
  if (process.env.BT_PANEL_TLS_INSECURE !== 'false') {
    try {
      const { Agent } = await import('node:undici')
      dispatcher = new Agent({ connect: { rejectUnauthorized: false } })
    } catch {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    ...(dispatcher ? { dispatcher } : {}),
  })

  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`Baota API returned non-JSON (${response.status}): ${text.slice(0, 200)}`)
  }

  if (!json.status) {
    throw new Error(`Baota API failed: ${JSON.stringify(json)}`)
  }

  return json
}

async function main() {
  const panelUrl = process.env.BT_PANEL_URL
  const apiKey = process.env.BT_API_KEY

  if (!panelUrl || !apiKey) {
    console.log('BT_PANEL_URL or BT_API_KEY not set, skipping Baota API call')
    return
  }

  const action = process.env.BT_API_ACTION || 'ServiceAdmin'
  const rawParams = process.env.BT_API_PARAMS || '{"name":"nginx","type":"reload"}'
  const extraParams = JSON.parse(rawParams)

  const result = await callBaotaApi({
    panelUrl,
    apiKey,
    route: '/system',
    params: { action, ...extraParams },
  })

  console.log('Baota API OK:', JSON.stringify(result))
}

main().catch((error) => {
  console.error(error.message)
  if (error.cause) console.error('cause:', error.cause)
  process.exit(1)
})

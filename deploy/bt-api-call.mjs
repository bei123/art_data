import crypto from 'crypto'

function getBtAuthParams(apiKey) {
  const request_time = String(Math.floor(Date.now() / 1000))
  const md5Key = crypto.createHash('md5').update(apiKey).digest('hex')
  const request_token = crypto.createHash('md5')
    .update(request_time + md5Key)
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

  const response = await fetch(`${panelUrl.replace(/\/$/, '')}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
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
  process.exit(1)
})

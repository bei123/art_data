/**
 * Deploy notifications: WeCom group robot + WeChat Official Account template message.
 */

function trim(value) {
  return String(value || '').trim()
}

function clip(value, max) {
  const text = String(value || '')
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

export function buildDeployContext(env = process.env) {
  const status = trim(env.DEPLOY_STATUS || 'unknown')
  const project = trim(env.DEPLOY_PROJECT || 'art_data')
  const version = trim(env.DEPLOY_VERSION)
  const ref = trim(env.GITHUB_SHA).slice(0, 7)
  const repo = trim(env.GITHUB_REPOSITORY)
  const serverUrl = trim(env.GITHUB_SERVER_URL || 'https://github.com')
  const runId = trim(env.GITHUB_RUN_ID)
  const workflow = trim(env.GITHUB_WORKFLOW)
  const runUrl = runId && repo ? `${serverUrl}/${repo}/actions/runs/${runId}` : ''
  const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
  const emoji = status === 'success' ? '✅' : status === 'failure' ? '❌' : '⚠️'
  const statusLabel = status === 'success' ? '成功' : status === 'failure' ? '失败' : status

  const markdownLines = [
    `### ${emoji} ${project} 部署${statusLabel}`,
    `> 工作流：${workflow || '-'}`,
    `> 仓库：${repo || '-'}`,
    `> 提交：\`${ref || '-'}\``,
  ]
  if (version) markdownLines.push(`> 版本：**${version}**`)
  markdownLines.push(`> 时间：${time}`)
  if (runUrl) markdownLines.push(`> [查看 Actions 日志](${runUrl})`)

  return {
    status,
    statusLabel,
    project,
    version,
    ref,
    repo,
    workflow,
    runUrl,
    time,
    emoji,
    markdown: markdownLines.join('\n'),
  }
}

export function resolveWecomWebhookUrl(env = process.env) {
  return trim(env.WECOM_WEBHOOK_URL || env.DEPLOY_NOTIFY_WEBHOOK_URL)
}

export async function sendWecomMarkdown(webhookUrl, markdown) {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msgtype: 'markdown',
      markdown: { content: markdown },
    }),
  })

  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }

  if (!response.ok) {
    throw new Error(`WeCom HTTP ${response.status}: ${text.slice(0, 300)}`)
  }
  if (json && json.errcode !== 0) {
    throw new Error(`WeCom API ${json.errcode}: ${json.errmsg || text}`)
  }
}

function renderTemplateData(templateJson, context) {
  const replacements = {
    '{{project}}': clip(context.project, 20),
    '{{status}}': clip(context.statusLabel, 20),
    '{{version}}': clip(context.version || '-', 20),
    '{{ref}}': clip(context.ref || '-', 20),
    '{{time}}': clip(context.time, 20),
    '{{workflow}}': clip(context.workflow || '-', 20),
    '{{runUrl}}': clip(context.runUrl, 100),
  }

  let rendered = templateJson
  for (const [key, value] of Object.entries(replacements)) {
    rendered = rendered.split(key).join(value)
  }
  return JSON.parse(rendered)
}

function buildDefaultOaTemplateData(context) {
  const templateJson = trim(process.env.WECHAT_OA_TEMPLATE_DATA_JSON) || JSON.stringify({
    thing1: { value: '{{project}}' },
    thing2: { value: '{{status}}' },
    thing3: { value: '{{version}}' },
    time4: { value: '{{time}}' },
  })
  return renderTemplateData(templateJson, context)
}

async function getOaAccessToken(appid, secret) {
  const url = new URL('https://api.weixin.qq.com/cgi-bin/token')
  url.searchParams.set('grant_type', 'client_credential')
  url.searchParams.set('appid', appid)
  url.searchParams.set('secret', secret)

  const response = await fetch(url)
  const json = await response.json()
  if (!json.access_token) {
    throw new Error(json.errmsg || 'failed to get OA access_token')
  }
  return json.access_token
}

async function sendOaTemplateMessage({ accessToken, touser, templateId, url, data }) {
  const response = await fetch(
    `https://api.weixin.qq.com/cgi-bin/message/template/send?access_token=${accessToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        touser,
        template_id: templateId,
        url: url || undefined,
        data,
      }),
    }
  )

  const json = await response.json()
  if (json.errcode !== 0) {
    throw new Error(`${json.errcode} ${json.errmsg}`)
  }
}

export async function sendWechatOaTemplate(context, env = process.env) {
  const appid = trim(env.WECHAT_OA_APPID)
  const secret = trim(env.WECHAT_OA_SECRET)
  const templateId = trim(env.WECHAT_OA_TEMPLATE_ID)
  const touserRaw = trim(env.WECHAT_OA_TOUSER)

  if (!appid || !secret || !templateId || !touserRaw) {
    return { skipped: true, reason: 'WECHAT_OA_* not fully configured' }
  }

  const accessToken = await getOaAccessToken(appid, secret)
  const data = buildDefaultOaTemplateData(context)
  const users = touserRaw.split(',').map((item) => item.trim()).filter(Boolean)

  for (const touser of users) {
    await sendOaTemplateMessage({
      accessToken,
      touser,
      templateId,
      url: context.runUrl || undefined,
      data,
    })
  }

  return { skipped: false, count: users.length }
}

export async function notifyDeploy(env = process.env) {
  const context = buildDeployContext(env)
  const wecomWebhook = resolveWecomWebhookUrl(env)
  const hasWecom = Boolean(wecomWebhook)
  const hasOa = Boolean(
    trim(env.WECHAT_OA_APPID) &&
      trim(env.WECHAT_OA_SECRET) &&
      trim(env.WECHAT_OA_TEMPLATE_ID) &&
      trim(env.WECHAT_OA_TOUSER)
  )

  if (!hasWecom && !hasOa) {
    console.log('notify-deploy: no WeCom or WeChat OA channel configured, skip')
    return { sent: [] }
  }

  const sent = []
  const errors = []

  if (hasWecom) {
    try {
      await sendWecomMarkdown(wecomWebhook, context.markdown)
      sent.push('wecom')
      console.log('notify-deploy: WeCom sent')
    } catch (error) {
      errors.push(`WeCom: ${error.message}`)
      console.error(`notify-deploy: WeCom failed: ${error.message}`)
    }
  }

  if (hasOa) {
    try {
      const result = await sendWechatOaTemplate(context, env)
      if (!result.skipped) {
        sent.push(`wechat-oa:${result.count}`)
        console.log(`notify-deploy: WeChat OA sent to ${result.count} user(s)`)
      }
    } catch (error) {
      errors.push(`WeChat OA: ${error.message}`)
      console.error(`notify-deploy: WeChat OA failed: ${error.message}`)
    }
  }

  if (sent.length === 0 && errors.length > 0) {
    throw new Error(errors.join('; '))
  }

  return { sent, errors }
}

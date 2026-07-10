#!/usr/bin/env node
/**
 * Post deploy/rollback notification via generic webhook (WeCom / DingTalk / Feishu compatible).
 * Set secret DEPLOY_NOTIFY_WEBHOOK_URL; skipped when unset.
 */
const webhookUrl = String(process.env.DEPLOY_NOTIFY_WEBHOOK_URL || '').trim()
if (!webhookUrl) {
  console.log('notify-deploy: DEPLOY_NOTIFY_WEBHOOK_URL not set, skip')
  process.exit(0)
}

const status = String(process.env.DEPLOY_STATUS || 'unknown')
const project = String(process.env.DEPLOY_PROJECT || 'art_data')
const version = String(process.env.DEPLOY_VERSION || '').trim()
const ref = String(process.env.GITHUB_SHA || '').slice(0, 7)
const repo = String(process.env.GITHUB_REPOSITORY || '')
const serverUrl = String(process.env.GITHUB_SERVER_URL || 'https://github.com')
const runId = String(process.env.GITHUB_RUN_ID || '')
const runUrl = runId ? `${serverUrl}/${repo}/actions/runs/${runId}` : ''
const workflow = String(process.env.GITHUB_WORKFLOW || '')

const emoji = status === 'success' ? '✅' : status === 'failure' ? '❌' : '⚠️'
const lines = [
  `### ${emoji} ${project} deploy ${status}`,
  `- workflow: ${workflow}`,
  `- repo: ${repo}`,
  `- commit: \`${ref}\``,
]
if (version) lines.push(`- version: **${version}**`)
if (runUrl) lines.push(`- [查看 Actions 日志](${runUrl})`)

const payload = {
  msgtype: 'markdown',
  markdown: { content: lines.join('\n') },
}

const response = await fetch(webhookUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})

if (!response.ok) {
  const text = await response.text()
  console.error(`notify-deploy: webhook failed (${response.status}): ${text.slice(0, 300)}`)
  process.exit(1)
}

console.log('notify-deploy: sent')

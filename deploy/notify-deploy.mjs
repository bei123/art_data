#!/usr/bin/env node
/**
 * Deploy / rollback notifications via WeCom robot and WeChat Official Account.
 */
import { notifyDeploy } from './lib/deploy-notify.mjs'

try {
  await notifyDeploy()
} catch (error) {
  console.error(`notify-deploy: ${error.message}`)
  process.exit(1)
}

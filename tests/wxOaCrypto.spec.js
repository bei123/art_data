import { describe, it, expect } from 'vitest'
import {
  buildOaSignature,
  verifyOaSignature,
  parseWxXml,
  extractEncryptFromXml,
} from '../utils/wxOaCrypto.js'

describe('wxOaCrypto', () => {
  it('builds and verifies OA signature', () => {
    const token = 'testtoken'
    const timestamp = '1409659589'
    const nonce = 'nonce123'
    const signature = buildOaSignature({ token, timestamp, nonce })
    expect(signature).toHaveLength(40)
    expect(
      verifyOaSignature({ token, timestamp, nonce, signature })
    ).toBe(true)
    expect(
      verifyOaSignature({ token, timestamp, nonce, signature: '0'.repeat(40) })
    ).toBe(false)
  })

  it('parses flat WeChat XML with CDATA', () => {
    const xml = `
      <xml>
        <ToUserName><![CDATA[toUser]]></ToUserName>
        <FromUserName><![CDATA[FromUser]]></FromUserName>
        <CreateTime>1409659813</CreateTime>
        <MsgType><![CDATA[event]]></MsgType>
        <Event><![CDATA[user_get_card]]></Event>
        <CardId><![CDATA[cardid123]]></CardId>
        <UserCardCode><![CDATA[code456]]></UserCardCode>
        <OuterStr><![CDATA[uid:42]]></OuterStr>
      </xml>
    `
    const parsed = parseWxXml(xml)
    expect(parsed.Event).toBe('user_get_card')
    expect(parsed.CardId).toBe('cardid123')
    expect(parsed.UserCardCode).toBe('code456')
    expect(parsed.OuterStr).toBe('uid:42')
    expect(parsed.CreateTime).toBe('1409659813')
  })

  it('extracts Encrypt field', () => {
    const xml = '<xml><ToUserName><![CDATA[gh]]></ToUserName><Encrypt><![CDATA[abcdef]]></Encrypt></xml>'
    expect(extractEncryptFromXml(xml)).toBe('abcdef')
  })
})

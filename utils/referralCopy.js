const REFERRAL_BRAND = {
  programName: '艺术推荐官',
  advisorName: '艺术顾问',
  vipName: 'VIP收藏家',
  shareRewardLabel: '推荐奖励',
}

function buildReferralRuleHighlights({
  bindingDays,
  firstReferralBonusYuan,
  newUserCouponYuan,
  newUserCouponValidDays,
  vipSpendThresholdYuan,
  withdrawPolicy,
}) {
  const {
    max_yuan: maxYuan,
    user_daily_limit_yuan: userDailyLimitYuan,
  } = withdrawPolicy || {}

  return [
    `分享有礼：好友通过您的链接购买，您可获得基于真实成交的${REFERRAL_BRAND.shareRewardLabel}`,
    `推荐关系绑定后 ${bindingDays} 天内有效，首次绑定后不可修改`,
    `${REFERRAL_BRAND.programName}首次成功推荐成交，额外奖励 ${firstReferralBonusYuan} 元（计入可提现余额）`,
    `新用户注册可获得 ${newUserCouponYuan} 元微信免充值代金券（支付时自动抵扣，约 ${newUserCouponValidDays} 天内可用）`,
    `累计消费满 ${vipSpendThresholdYuan} 元可升级 ${REFERRAL_BRAND.vipName}，${REFERRAL_BRAND.shareRewardLabel} +2%`,
    `${REFERRAL_BRAND.advisorName}经审核通过后可享专属佣金比例`,
    `提现到微信零钱：单笔最高 ${maxYuan} 元，单日最高 ${userDailyLimitYuan} 元，可分多次提现`,
  ]
}

module.exports = {
  REFERRAL_BRAND,
  buildReferralRuleHighlights,
}

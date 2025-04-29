import request from '@/utils/request'

// 获取退款列表
export function getRefundList(params) {
  return request({
    url: '/refund/list',
    method: 'get',
    params
  })
}

// 获取退款详情
export function getRefundDetail(out_refund_no) {
  return request({
    url: `/refund/detail/${out_refund_no}`,
    method: 'get'
  })
}

// 审批通过
export function approveRefund(data) {
  return request({
    url: '/refund/approve',
    method: 'post',
    data
  })
}

// 拒绝退款
export function rejectRefund(data) {
  return request({
    url: '/refund/reject',
    method: 'post',
    data
  })
} 
import {
  Building2,
  ClipboardCheck,
  FileText,
  FolderTree,
  HandCoins,
  Image,
  Images,
  LayoutDashboard,
  MessageSquare,
  Package,
  Share2,
  ShoppingBag,
  Store,
  TicketPercent,
  User,
  UserX,
  Wallet,
} from 'lucide-vue-next'

/**
 * 管理后台侧栏分组配置。
 * collapsible: 仅推荐分销折叠；role 过滤整组或单项。
 */
export const ADMIN_NAV_GROUPS = [
  {
    id: 'overview',
    label: '概览',
    items: [
      { path: '/', label: '仪表盘', icon: LayoutDashboard },
    ],
  },
  {
    id: 'trade',
    label: '交易履约',
    items: [
      { path: '/orders', label: '订单', icon: ShoppingBag },
      { path: '/refund-approval', label: '退款审批', icon: Wallet, role: 'admin' },
    ],
  },
  {
    id: 'goods',
    label: '商品与内容',
    items: [
      { path: '/digital-artworks', label: '数字艺术品', icon: Images },
      { path: '/digital-claim-copy', label: '领取说明', icon: FileText, role: 'admin' },
      { path: '/original-artworks', label: '原作', icon: Image },
      { path: '/physical-categories', label: '实物分类', icon: FolderTree },
      { path: '/rights', label: '权益', icon: Package },
      { path: '/exhibitions', label: '展览', icon: FileText, role: 'admin' },
    ],
  },
  {
    id: 'parties',
    label: '主体档案',
    items: [
      { path: '/artists', label: '艺术家', icon: User },
      { path: '/institutions', label: '机构', icon: Building2 },
      { path: '/merchants', label: '商家', icon: Store },
    ],
  },
  {
    id: 'ops',
    label: '运营触达',
    items: [
      { path: '/banners', label: '轮播图', icon: Image },
      { path: '/subscribe-message/templates', label: '订阅消息', icon: MessageSquare, role: 'admin' },
      { path: '/wx-users', label: '小程序用户', icon: UserX, role: 'admin' },
    ],
  },
  {
    id: 'referral',
    label: '推荐分销',
    collapsible: true,
    role: 'admin',
    items: [
      { path: '/referral/commissions', label: '佣金明细', icon: HandCoins, role: 'admin' },
      { path: '/referral/commission-rules', label: '佣金规则', icon: HandCoins, role: 'admin' },
      { path: '/referral/withdrawals', label: '提现审批', icon: Wallet, role: 'admin' },
      { path: '/referral/coupons', label: '代金券', icon: TicketPercent, role: 'admin' },
      { path: '/referral/advisor-applications', label: '艺术顾问申请', icon: User, role: 'admin' },
      { path: '/referral/vip-early-access', label: 'VIP优先购', icon: HandCoins, role: 'admin' },
      { path: '/referral/share-events', label: '分享记录', icon: Share2, role: 'admin' },
      { path: '/referral/reconciliation', label: '对账', icon: ClipboardCheck, role: 'admin' },
    ],
  },
]

export const REFERRAL_NAV_STORAGE_KEY = 'art_data_admin_nav_referral_expanded'

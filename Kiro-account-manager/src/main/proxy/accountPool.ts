// 多账号轮询管理器
import type { ProxyAccount, AccountStats } from './types'

// 错误类型枚举
export type ErrorType = 'quota' | 'auth' | 'network' | 'server' | 'unknown'

export interface AccountPoolConfig {
  cooldownMs: number // 错误后冷却时间
  maxErrorCount: number // 最大连续错误次数
  quotaResetMs: number // 配额重置时间
  networkCooldownMs: number // 网络错误冷却时间
  serverCooldownMs: number // 服务器错误冷却时间
  autoRecoverMs: number // 自动恢复时间
  expiryGracePeriodMs: number // Token 过期宽容期
}

const DEFAULT_CONFIG: AccountPoolConfig = {
  cooldownMs: 60000, // 1分钟冷却
  maxErrorCount: 3, // 3次错误后暂停
  quotaResetMs: 3600000, // 1小时配额重置
  networkCooldownMs: 10000, // 网络错误 10 秒冷却
  serverCooldownMs: 30000, // 服务器错误 30 秒冷却
  autoRecoverMs: 5 * 60 * 1000, // 5 分钟后自动恢复
  expiryGracePeriodMs: 30 * 1000 // Token 过期 30 秒宽容期
}

export class AccountPool {
  private accounts: Map<string, ProxyAccount> = new Map()
  private accountStats: Map<string, AccountStats> = new Map()
  private currentIndex: number = 0
  private config: AccountPoolConfig

  constructor(config: Partial<AccountPoolConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // 添加账号
  addAccount(account: ProxyAccount): void {
    this.accounts.set(account.id, {
      ...account,
      isAvailable: true,
      requestCount: 0,
      errorCount: 0,
      lastUsed: 0
    })
    this.accountStats.set(account.id, {
      requests: 0,
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      errors: 0,
      lastUsed: 0,
      avgResponseTime: 0,
      totalResponseTime: 0
    })
    console.log(`[AccountPool] Added account: ${account.email || account.id}`)
  }

  // 移除账号
  removeAccount(accountId: string): void {
    this.accounts.delete(accountId)
    this.accountStats.delete(accountId)
    console.log(`[AccountPool] Removed account: ${accountId}`)
  }

  // 更新账号
  updateAccount(accountId: string, updates: Partial<ProxyAccount>): void {
    const account = this.accounts.get(accountId)
    if (account) {
      this.accounts.set(accountId, { ...account, ...updates })
    }
  }

  // 获取下一个可用账号（轮询）
  getNextAccount(): ProxyAccount | null {
    const accountList = Array.from(this.accounts.values())
    if (accountList.length === 0) {
      return null
    }

    const now = Date.now()

    // 诊断日志：输出每个账号的可用性状态
    console.log('[AccountPool] Checking accounts:', accountList.map(acc => ({
      id: acc.id.slice(0, 8),
      email: acc.email,
      isAvailable: acc.isAvailable,
      errorCount: acc.errorCount,
      cooldownUntil: acc.cooldownUntil ? new Date(acc.cooldownUntil).toISOString() : null,
      expiresAt: acc.expiresAt ? new Date(acc.expiresAt).toISOString() : null,
      autoRecoverAt: acc.autoRecoverAt ? new Date(acc.autoRecoverAt).toISOString() : null,
      available: this.isAccountAvailable(acc, now)
    })))

    let attempts = 0
    const maxAttempts = accountList.length

    while (attempts < maxAttempts) {
      const account = accountList[this.currentIndex]
      this.currentIndex = (this.currentIndex + 1) % accountList.length

      // 检查账号是否可用
      if (this.isAccountAvailable(account, now)) {
        return account
      }

      attempts++
    }

    // 没有可用账号，返回冷却时间最短的
    return this.getAccountWithShortestCooldown(accountList, now)
  }

  // 获取特定账号
  getAccount(accountId: string): ProxyAccount | null {
    return this.accounts.get(accountId) || null
  }

  // 获取下一个可用账号（排除当前账号）
  getNextAvailableAccount(excludeAccountId: string): ProxyAccount | null {
    const accountList = Array.from(this.accounts.values())
    if (accountList.length <= 1) {
      return null
    }

    const now = Date.now()
    
    // 尝试找到一个可用的账号（排除当前账号）
    for (const account of accountList) {
      if (account.id !== excludeAccountId && this.isAccountAvailable(account, now)) {
        return account
      }
    }

    // 没有立即可用的账号，返回冷却时间最短的（排除当前账号）
    const otherAccounts = accountList.filter(a => a.id !== excludeAccountId)
    return this.getAccountWithShortestCooldown(otherAccounts, now)
  }

  // 获取所有账号
  getAllAccounts(): ProxyAccount[] {
    return Array.from(this.accounts.values())
  }

  // 检查账号是否可用
  private isAccountAvailable(account: ProxyAccount, now: number): boolean {
    // 检查是否到达自动恢复时间
    if (account.autoRecoverAt && account.autoRecoverAt <= now) {
      // 重置状态，允许重试
      this.accounts.set(account.id, {
        ...account,
        isAvailable: true,
        autoRecoverAt: undefined,
        errorCount: 0,
        cooldownUntil: undefined
      })
      console.log(`[AccountPool] Account ${account.email || account.id} auto-recovered`)
      return true
    }

    // 检查冷却时间
    if (account.cooldownUntil && account.cooldownUntil > now) {
      return false
    }

    // 检查错误计数
    if ((account.errorCount || 0) >= this.config.maxErrorCount) {
      return false
    }

    // 检查 token 是否过期（增加宽容期，避免时间偏差导致的误判）
    if (account.expiresAt && account.expiresAt + this.config.expiryGracePeriodMs < now) {
      return false
    }

    return account.isAvailable !== false
  }

  // 获取冷却时间最短的账号
  private getAccountWithShortestCooldown(accounts: ProxyAccount[], now: number): ProxyAccount | null {
    let bestAccount: ProxyAccount | null = null
    let shortestWait = Infinity

    for (const account of accounts) {
      const cooldownUntil = account.cooldownUntil || 0
      const wait = Math.max(0, cooldownUntil - now)
      
      if (wait < shortestWait) {
        shortestWait = wait
        bestAccount = account
      }
    }

    return bestAccount
  }

  // 记录请求成功
  recordSuccess(accountId: string, tokens: number = 0): void {
    const account = this.accounts.get(accountId)
    if (account) {
      this.accounts.set(accountId, {
        ...account,
        requestCount: (account.requestCount || 0) + 1,
        errorCount: 0, // 重置错误计数
        lastUsed: Date.now(),
        isAvailable: true
      })
    }

    const stats = this.accountStats.get(accountId)
    if (stats) {
      this.accountStats.set(accountId, {
        ...stats,
        requests: stats.requests + 1,
        tokens: stats.tokens + tokens,
        lastUsed: Date.now()
      })
    }
  }

  // 记录请求失败（支持错误类型分类）
  recordError(accountId: string, errorType: ErrorType | boolean = 'unknown'): void {
    const account = this.accounts.get(accountId)
    if (!account) return

    // 兼容旧的 isQuotaError 布尔参数
    const actualErrorType: ErrorType = typeof errorType === 'boolean'
      ? (errorType ? 'quota' : 'unknown')
      : errorType

    const now = Date.now()
    let cooldownUntil: number | undefined = account.cooldownUntil
    let newErrorCount = account.errorCount || 0
    let isAvailable = account.isAvailable !== false

    switch (actualErrorType) {
      case 'quota':
        // 配额错误：长时间冷却
        cooldownUntil = now + this.config.quotaResetMs
        console.log(`[AccountPool] Account ${account.email || accountId} quota exhausted, cooldown until ${new Date(cooldownUntil).toISOString()}`)
        break
      case 'auth':
        // 认证错误：标记需要刷新，设置自动恢复时间
        this.markNeedsRefresh(accountId)
        return
      case 'network':
        // 网络错误：短暂冷却，不增加 errorCount
        cooldownUntil = now + this.config.networkCooldownMs
        console.log(`[AccountPool] Account ${account.email || accountId} network error, short cooldown until ${new Date(cooldownUntil).toISOString()}`)
        break
      case 'server':
        // 服务器错误：短暂冷却
        cooldownUntil = now + this.config.serverCooldownMs
        newErrorCount++
        console.log(`[AccountPool] Account ${account.email || accountId} server error, cooldown until ${new Date(cooldownUntil).toISOString()}`)
        break
      default:
        // 未知错误：累积错误计数
        newErrorCount++
        if (newErrorCount >= this.config.maxErrorCount) {
          cooldownUntil = now + this.config.cooldownMs
          console.log(`[AccountPool] Account ${account.email || accountId} too many errors (${newErrorCount}), cooldown until ${new Date(cooldownUntil).toISOString()}`)
        }
    }

    this.accounts.set(accountId, {
      ...account,
      errorCount: newErrorCount,
      cooldownUntil,
      isAvailable,
      lastUsed: now
    })

    const stats = this.accountStats.get(accountId)
    if (stats) {
      this.accountStats.set(accountId, {
        ...stats,
        errors: stats.errors + 1,
        lastUsed: now
      })
    }
  }

  // 标记账号需要刷新 Token（设置自动恢复时间，避免永久不可用）
  markNeedsRefresh(accountId: string): void {
    const account = this.accounts.get(accountId)
    if (account) {
      const autoRecoverAt = Date.now() + this.config.autoRecoverMs
      this.accounts.set(accountId, {
        ...account,
        isAvailable: false,
        autoRecoverAt
      })
      console.log(`[AccountPool] Account ${account.email || accountId} marked needs refresh, will auto-recover at ${new Date(autoRecoverAt).toISOString()}`)
    }
  }

  // 获取统计信息
  getStats(): { accounts: Map<string, AccountStats>; total: { requests: number; tokens: number; errors: number } } {
    let totalRequests = 0
    let totalTokens = 0
    let totalErrors = 0

    for (const stats of this.accountStats.values()) {
      totalRequests += stats.requests
      totalTokens += stats.tokens
      totalErrors += stats.errors
    }

    return {
      accounts: new Map(this.accountStats),
      total: {
        requests: totalRequests,
        tokens: totalTokens,
        errors: totalErrors
      }
    }
  }

  // 重置所有账号状态
  reset(): void {
    for (const [id, account] of this.accounts) {
      this.accounts.set(id, {
        ...account,
        isAvailable: true,
        errorCount: 0,
        cooldownUntil: undefined,
        autoRecoverAt: undefined
      })
    }
    this.currentIndex = 0
  }

  // 清空所有账号
  clear(): void {
    this.accounts.clear()
    this.accountStats.clear()
    this.currentIndex = 0
  }

  // 获取账号数量
  get size(): number {
    return this.accounts.size
  }

  // 获取可用账号数量
  get availableCount(): number {
    const now = Date.now()
    let count = 0
    for (const account of this.accounts.values()) {
      if (this.isAccountAvailable(account, now)) {
        count++
      }
    }
    return count
  }
}

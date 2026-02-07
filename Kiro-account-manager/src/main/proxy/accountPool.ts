// 多账号轮询管理器
import type { ProxyAccount, AccountStats } from './types'

// 错误类型分类
export type ErrorType = 'quota' | 'auth' | 'network' | 'server' | 'unknown'

export interface AccountPoolConfig {
  cooldownMs: number // 默认错误冷却时间
  maxErrorCount: number // 最大连续错误次数
  quotaResetMs: number // 配额重置时间
  networkCooldownMs: number // 网络错误冷却时间
  serverCooldownMs: number // 服务器错误冷却时间
  autoRecoverMs: number // 自动恢复时间（用于 auth 错误）
  expiryGracePeriodMs: number // Token 过期宽容期
}

const DEFAULT_CONFIG: AccountPoolConfig = {
  cooldownMs: 60000, // 1分钟默认冷却
  maxErrorCount: 3, // 3次错误后暂停
  quotaResetMs: 3600000, // 1小时配额重置
  networkCooldownMs: 10000, // 10秒网络错误冷却
  serverCooldownMs: 30000, // 30秒服务器错误冷却
  autoRecoverMs: 300000, // 5分钟自动恢复（用于 auth 错误）
  expiryGracePeriodMs: 60000 // 1分钟 Token 过期宽容期
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
    // 检查自动恢复时间（用于 auth 错误等可恢复场景）
    if (account.autoRecoverAt && account.autoRecoverAt <= now) {
      // 自动恢复：重置状态
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

    // 如果设置了自动恢复时间但还未到，则不可用
    if (account.autoRecoverAt && account.autoRecoverAt > now) {
      return false
    }

    // 检查冷却时间
    if (account.cooldownUntil && account.cooldownUntil > now) {
      return false
    }

    // 检查错误计数
    if ((account.errorCount || 0) >= this.config.maxErrorCount) {
      return false
    }

    // 检查 token 是否过期（带宽容期）
    if (account.expiresAt) {
      const expiryWithGrace = account.expiresAt + this.config.expiryGracePeriodMs
      if (expiryWithGrace < now) {
        return false
      }
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

  // 记录请求失败
  recordError(accountId: string, errorType: ErrorType = 'unknown'): void {
    const account = this.accounts.get(accountId)
    if (!account) return

    const now = Date.now()
    let errorCount = account.errorCount || 0
    let cooldownUntil = account.cooldownUntil || 0
    let autoRecoverAt = account.autoRecoverAt
    let isAvailable = account.isAvailable !== false

    // 根据错误类型应用不同的冷却策略
    switch (errorType) {
      case 'quota':
        // 配额错误，长时间冷却，不增加错误计数
        cooldownUntil = now + this.config.quotaResetMs
        console.log(`[AccountPool] Account ${account.email || accountId} quota exhausted, cooldown until ${new Date(cooldownUntil).toISOString()}`)
        break

      case 'auth':
        // 认证错误，设置自动恢复时间，不增加错误计数
        autoRecoverAt = now + this.config.autoRecoverMs
        isAvailable = false
        console.log(`[AccountPool] Account ${account.email || accountId} auth error, will auto-recover at ${new Date(autoRecoverAt).toISOString()}`)
        break

      case 'network':
        // 网络错误，短时间冷却，不增加错误计数
        cooldownUntil = now + this.config.networkCooldownMs
        console.log(`[AccountPool] Account ${account.email || accountId} network error, cooldown for ${this.config.networkCooldownMs}ms`)
        break

      case 'server':
        // 服务器错误，中等冷却时间，增加错误计数
        errorCount++
        cooldownUntil = now + this.config.serverCooldownMs
        console.log(`[AccountPool] Account ${account.email || accountId} server error (${errorCount}/${this.config.maxErrorCount}), cooldown for ${this.config.serverCooldownMs}ms`)
        break

      case 'unknown':
      default:
        // 未知错误，默认冷却时间，增加错误计数
        errorCount++
        if (errorCount >= this.config.maxErrorCount) {
          cooldownUntil = now + this.config.cooldownMs
          console.log(`[AccountPool] Account ${account.email || accountId} too many errors (${errorCount}), cooldown until ${new Date(cooldownUntil).toISOString()}`)
        }
        break
    }

    this.accounts.set(accountId, {
      ...account,
      errorCount,
      cooldownUntil,
      autoRecoverAt,
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

  // 标记账号需要刷新 Token（设置短暂冷却期，自动恢复）
  markNeedsRefresh(accountId: string): void {
    const account = this.accounts.get(accountId)
    if (account) {
      const now = Date.now()
      this.accounts.set(accountId, {
        ...account,
        isAvailable: false,
        // 设置 30 秒后自动恢复，而不是永久不可用
        autoRecoverAt: now + 30000
      })
      console.log(`[AccountPool] Account ${account.email || accountId} marked needs refresh, will auto-recover in 30s`)
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
        cooldownUntil: undefined
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

  // 获取账号诊断信息
  getAccountDiagnostics(accountId: string): object | null {
    const account = this.accounts.get(accountId)
    if (!account) return null

    const now = Date.now()
    return {
      id: account.id,
      email: account.email,
      isAvailable: account.isAvailable,
      errorCount: account.errorCount,
      cooldownUntil: account.cooldownUntil,
      autoRecoverAt: account.autoRecoverAt,
      expiresAt: account.expiresAt,
      isCurrentlyAvailable: this.isAccountAvailable(account, now),
      cooldownRemaining: account.cooldownUntil ? Math.max(0, account.cooldownUntil - now) : 0,
      autoRecoverRemaining: account.autoRecoverAt ? Math.max(0, account.autoRecoverAt - now) : 0,
      tokenExpiresIn: account.expiresAt ? account.expiresAt - now : null
    }
  }

  // 重置单个账号状态
  resetAccountState(accountId: string): boolean {
    const account = this.accounts.get(accountId)
    if (!account) return false

    this.accounts.set(accountId, {
      ...account,
      isAvailable: true,
      errorCount: 0,
      cooldownUntil: undefined,
      autoRecoverAt: undefined
    })
    console.log(`[AccountPool] Reset account state: ${account.email || accountId}`)
    return true
  }

  // 重置所有账号状态
  resetAllAccountStates(): number {
    let count = 0
    for (const [id, account] of this.accounts) {
      this.accounts.set(id, {
        ...account,
        isAvailable: true,
        errorCount: 0,
        cooldownUntil: undefined,
        autoRecoverAt: undefined
      })
      count++
    }
    console.log(`[AccountPool] Reset all account states: ${count} accounts`)
    return count
  }
}

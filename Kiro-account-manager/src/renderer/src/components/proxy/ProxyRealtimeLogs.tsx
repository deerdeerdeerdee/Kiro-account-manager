import { useState, useEffect, useRef, useCallback } from 'react'
import { Button, Badge } from '../ui'
import { ChevronDown, ChevronUp, Trash2, Pause, Play, Copy, Check, Settings2 } from 'lucide-react'

interface LogEntry {
  timestamp: string
  level: string
  category: string
  message: string
  data?: unknown
}

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

interface ProxyRealtimeLogsProps {
  isRunning: boolean
  isEn: boolean
}

export function ProxyRealtimeLogs({ isRunning, isEn }: ProxyRealtimeLogsProps) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [isExpanded, setIsExpanded] = useState(true)
  const [isEnabled, setIsEnabled] = useState(false) // 默认关闭，需要手动开启
  const [logLevel, setLogLevel] = useState<LogLevel>('INFO')
  const [showSettings, setShowSettings] = useState(false)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const maxLogs = 500 // 最多显示 500 条

  // 启用/禁用实时日志推送
  useEffect(() => {
    if (!isRunning) {
      // 服务停止时，禁用日志推送
      window.api.proxySetRealtimeLogs(false)
      return
    }

    // 根据 isEnabled 状态设置日志推送
    window.api.proxySetRealtimeLogs(isEnabled, logLevel)

    return () => {
      // 组件卸载时禁用日志推送
      window.api.proxySetRealtimeLogs(false)
    }
  }, [isRunning, isEnabled, logLevel])

  // 监听批量日志（优化性能）
  useEffect(() => {
    if (!isRunning || !isEnabled) return

    const unsubscribe = window.api.onProxyLogBatch((entries) => {
      setLogs(prev => {
        const newLogs = [...prev, ...entries]
        // 保持最多 maxLogs 条
        if (newLogs.length > maxLogs) {
          return newLogs.slice(-maxLogs)
        }
        return newLogs
      })
    })

    return () => {
      unsubscribe()
    }
  }, [isRunning, isEnabled])

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current && isEnabled && isExpanded) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs, isEnabled, isExpanded])

  // 服务停止时清空日志
  useEffect(() => {
    if (!isRunning) {
      setLogs([])
      setIsEnabled(false)
    }
  }, [isRunning])

  const clearLogs = useCallback(() => {
    setLogs([])
  }, [])

  const toggleEnabled = useCallback(() => {
    setIsEnabled(prev => !prev)
  }, [])

  const copyLog = useCallback((log: LogEntry, index: number) => {
    const dataStr = log.data ? `\nData: ${JSON.stringify(log.data, null, 2)}` : ''
    const content = `[${log.timestamp}] [${log.level}] [${log.category}] ${log.message}${dataStr}`
    navigator.clipboard.writeText(content)
    setCopiedIndex(index)
    setTimeout(() => setCopiedIndex(null), 1500)
  }, [])

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'ERROR': return 'text-red-500'
      case 'WARN': return 'text-yellow-500'
      case 'INFO': return 'text-blue-500'
      case 'DEBUG': return 'text-gray-400'
      default: return 'text-muted-foreground'
    }
  }

  const getLevelBadgeClass = (level: string) => {
    switch (level) {
      case 'ERROR': return 'bg-red-500/20 text-red-500 border-red-500/30'
      case 'WARN': return 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30'
      case 'INFO': return 'bg-blue-500/20 text-blue-500 border-blue-500/30'
      case 'DEBUG': return 'bg-gray-500/20 text-gray-400 border-gray-500/30'
      default: return 'bg-muted text-muted-foreground border-muted'
    }
  }

  const formatTime = (timestamp: string) => {
    try {
      const date = new Date(timestamp)
      if (isNaN(date.getTime())) return timestamp
      const hours = date.getHours().toString().padStart(2, '0')
      const minutes = date.getMinutes().toString().padStart(2, '0')
      const seconds = date.getSeconds().toString().padStart(2, '0')
      const ms = date.getMilliseconds().toString().padStart(3, '0')
      return `${hours}:${minutes}:${seconds}.${ms}`
    } catch {
      return timestamp
    }
  }

  if (!isRunning) {
    return null
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card">
      {/* 标题栏 */}
      <div
        className="flex items-center justify-between px-3 py-2 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              {isEnabled && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              )}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${isEnabled ? 'bg-green-500' : 'bg-gray-400'}`}></span>
            </span>
            <span className="text-sm font-medium">{isEn ? 'Realtime Logs' : '实时日志'}</span>
          </div>
          {isEnabled && (
            <Badge variant="secondary" className="text-xs h-5">
              {logs.length}
            </Badge>
          )}
          {!isEnabled && (
            <Badge variant="outline" className="text-xs h-5 text-muted-foreground">
              {isEn ? 'Disabled' : '已关闭'}
            </Badge>
          )}
          {isEnabled && (
            <Badge variant="outline" className="text-xs h-5">
              {logLevel}+
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* 设置按钮 */}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation()
              setShowSettings(!showSettings)
            }}
            title={isEn ? 'Settings' : '设置'}
          >
            <Settings2 className="h-3 w-3" />
          </Button>
          {/* 开关按钮 */}
          <Button
            variant={isEnabled ? 'default' : 'outline'}
            size="icon"
            className={`h-6 w-6 ${isEnabled ? 'bg-green-500 hover:bg-green-600' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              toggleEnabled()
            }}
            title={isEnabled ? (isEn ? 'Stop' : '停止') : (isEn ? 'Start' : '开始')}
          >
            {isEnabled ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          </Button>
          {/* 清空按钮 */}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation()
              clearLogs()
            }}
            disabled={logs.length === 0}
            title={isEn ? 'Clear' : '清空'}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </div>

      {/* 设置面板 */}
      {showSettings && isExpanded && (
        <div className="px-3 py-2 bg-muted/20 border-b border-border flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">{isEn ? 'Min Level:' : '最低级别:'}</span>
            <select
              value={logLevel}
              onChange={(e) => setLogLevel(e.target.value as LogLevel)}
              className="h-6 px-2 rounded border border-border bg-background text-xs"
              onClick={(e) => e.stopPropagation()}
            >
              <option value="DEBUG">DEBUG</option>
              <option value="INFO">INFO</option>
              <option value="WARN">WARN</option>
              <option value="ERROR">ERROR</option>
            </select>
          </div>
          <div className="text-muted-foreground">
            {isEn
              ? `Showing ${logLevel} and above. Lower levels are filtered out to reduce performance impact.`
              : `显示 ${logLevel} 及以上级别。较低级别被过滤以减少性能影响。`
            }
          </div>
        </div>
      )}

      {/* 日志内容 */}
      {isExpanded && (
        <div
          ref={scrollRef}
          className="max-h-[300px] overflow-y-auto bg-background/50 font-mono text-xs"
        >
          {!isEnabled ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
              <span>{isEn ? 'Realtime logs disabled' : '实时日志已关闭'}</span>
              <span className="text-xs opacity-70">
                {isEn ? 'Click the play button to start capturing logs' : '点击播放按钮开始捕获日志'}
              </span>
            </div>
          ) : logs.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <span>{isEn ? 'Waiting for logs...' : '等待日志...'}</span>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {logs.map((log, index) => (
                <div
                  key={index}
                  className="group flex items-start gap-2 px-3 py-1.5 hover:bg-muted/30 transition-colors"
                >
                  {/* 时间 */}
                  <span className="text-muted-foreground whitespace-nowrap flex-shrink-0 tabular-nums">
                    {formatTime(log.timestamp)}
                  </span>

                  {/* 级别 */}
                  <span className={`px-1 py-0.5 rounded text-[10px] font-semibold flex-shrink-0 border ${getLevelBadgeClass(log.level)}`}>
                    {log.level.substring(0, 4)}
                  </span>

                  {/* 类别 */}
                  <span className="text-primary/70 flex-shrink-0 font-medium">
                    [{log.category}]
                  </span>

                  {/* 消息 */}
                  <span className={`flex-1 break-all ${getLevelColor(log.level)}`}>
                    {log.message}
                    {log.data !== undefined && log.data !== null && (
                      <span className="text-muted-foreground ml-1">
                        {(() => {
                          const dataStr = typeof log.data === 'object'
                            ? JSON.stringify(log.data)
                            : String(log.data)
                          return dataStr.length > 100 ? dataStr.substring(0, 100) + '...' : dataStr
                        })()}
                      </span>
                    )}
                  </span>

                  {/* 复制按钮 */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                    onClick={() => copyLog(log, index)}
                  >
                    {copiedIndex === index ? (
                      <Check className="h-3 w-3 text-green-500" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

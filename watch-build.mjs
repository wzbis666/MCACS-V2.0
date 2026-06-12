#!/usr/bin/env node
// @desc watch-build.mjs — 自动化构建监控脚本
//
// 持续监控三个代码区域的文件变更，自动触发编译：
//   1. Node.js 后端 (src/**/*.ts) → tsc --noEmit 语法检查
//   2. Spigot 插件 (spigot-plugin/src/**/*.java) → mvn clean package
//   3. 前端 (town-frontend/src/**/*.ts) → tsc --noEmit 语法检查
//
// 功能特性：
//   - 防抖：文件变更后等待稳定再触发编译
//   - 编译结果验证：检查输出文件完整性
//   - 清晰的错误信息和定位指引
//   - 编译状态实时显示

import { watchFile, unwatchFile, statSync, existsSync, readdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, relative, extname } from 'node:path'
import { platform } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const ROOT = dirname(__filename)
const isWindows = platform() === 'win32'

// ── 颜色输出 ──

const color = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
}

function log(tag, msg, c = color.reset) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  console.log(`${color.gray}[${time}]${color.reset} ${c}${color.bold}[${tag}]${color.reset} ${c}${msg}${color.reset}`)
}

// ── 构建目标定义 ──

const targets = [
  {
    name: 'Node.js Backend',
    watchDirs: [join(ROOT, 'src')],
    extensions: ['.ts'],
    buildCommand: 'npx tsc --noEmit',
    validateOutput: null,
    debounceMs: 1500,
  },
  {
    name: 'Spigot Plugin',
    watchDirs: [
      join(ROOT, 'spigot-plugin', 'src', 'main', 'java'),
      join(ROOT, 'spigot-plugin', 'src', 'main', 'resources'),
    ],
    extensions: ['.java', '.yml'],
    buildCommand: isWindows ? 'mvn clean package -q' : 'mvn clean package -q',
    validateOutput: () => {
      const jarPath = join(ROOT, 'spigot-plugin', 'target', 'minecraft-anticheat-0.1.0.jar')
      if (!existsSync(jarPath)) return false
      try {
        const stats = statSync(jarPath)
        if (stats.size < 100_000) {
          log('Validate', `JAR file too small: ${(stats.size / 1024).toFixed(1)}KB`, color.red)
          return false
        }
        return true
      } catch {
        return false
      }
    },
    debounceMs: 3000,
  },
  {
    name: 'Town Frontend',
    watchDirs: [join(ROOT, 'town-frontend', 'src')],
    extensions: ['.ts', '.tsx'],
    buildCommand: 'npx tsc --noEmit',
    validateOutput: null,
    debounceMs: 1500,
  },
]

// ── 编译执行 ──

function executeBuild(target) {
  const cwd = target.name === 'Spigot Plugin'
    ? join(ROOT, 'spigot-plugin')
    : target.name === 'Town Frontend'
      ? join(ROOT, 'town-frontend')
      : ROOT

  const start = Date.now()
  let output = ''

  try {
    output = execSync(target.buildCommand, {
      cwd,
      encoding: 'utf-8',
      timeout: 120_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const durationMs = Date.now() - start

    if (target.validateOutput && !target.validateOutput()) {
      return {
        success: false,
        output: 'Build completed but output validation failed',
        durationMs,
      }
    }

    return { success: true, output, durationMs }
  } catch (err) {
    const durationMs = Date.now() - start
    output = err.stdout ?? ''
    if (err.stderr) {
      output += (output ? '\n' : '') + err.stderr
    }
    return { success: false, output, durationMs }
  }
}

// ── 文件监控 ──

const pendingTimers = new Map()
const buildInProgress = new Set()

function triggerBuild(target) {
  if (buildInProgress.has(target.name)) {
    log(target.name, 'Build already in progress, queuing...', color.yellow)
    return
  }

  buildInProgress.add(target.name)
  log(target.name, 'Building...', color.cyan)

  const result = executeBuild(target)

  if (result.success) {
    const duration = (result.durationMs / 1000).toFixed(1)
    log(target.name, `Build succeeded (${duration}s)`, color.green)

    if (target.name === 'Spigot Plugin') {
      const jarPath = join(ROOT, 'spigot-plugin', 'target', 'minecraft-anticheat-0.1.0.jar')
      if (existsSync(jarPath)) {
        const size = (statSync(jarPath).size / 1024).toFixed(1)
        log(target.name, `Output: minecraft-anticheat-0.1.0.jar (${size}KB)`, color.green)
      }
    }
  } else {
    log(target.name, `Build FAILED (${(result.durationMs / 1000).toFixed(1)}s)`, color.red)

    const errorLines = result.output.split('\n').filter(l => l.trim())
    const errorSummary = errorLines.slice(-20)
    for (const line of errorSummary) {
      console.log(`${color.red}  │ ${line}${color.reset}`)
    }

    if (result.output.includes('error TS')) {
      log(target.name, 'TypeScript error detected — check type annotations and imports', color.yellow)
    } else if (result.output.includes('COMPILATION ERROR') || result.output.includes('[ERROR]')) {
      log(target.name, 'Java compilation error — check syntax and imports', color.yellow)
    } else if (result.output.includes('validation failed')) {
      log(target.name, 'Output validation failed — JAR file may be incomplete', color.yellow)
    }
  }

  buildInProgress.delete(target.name)
}

function onFileChange(target, filePath) {
  const relPath = relative(ROOT, filePath)
  const ext = extname(filePath)

  if (!target.extensions.includes(ext)) return

  const timerKey = target.name
  const existing = pendingTimers.get(timerKey)
  if (existing) clearTimeout(existing)

  log(target.name, `Change detected: ${relPath}`, color.yellow)

  pendingTimers.set(
    timerKey,
    setTimeout(() => {
      pendingTimers.delete(timerKey)
      triggerBuild(target)
    }, target.debounceMs),
  )
}

// ── 递归目录扫描 ──

function collectFiles(dir, extensions) {
  const files = []
  if (!existsSync(dir)) return files

  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (['node_modules', 'target', 'dist', '.git'].includes(entry.name)) continue
        files.push(...collectFiles(fullPath, extensions))
      } else if (entry.isFile() && extensions.includes(extname(entry.name))) {
        files.push(fullPath)
      }
    }
  } catch {
    // 忽略权限错误
  }

  return files
}

// ── 主入口 ──

function main() {
  console.log()
  console.log(`${color.bold}${color.cyan}═══════════════════════════════════════════════${color.reset}`)
  console.log(`${color.bold}${color.cyan}  AntiCheat Plugin — Auto Build Watcher${color.reset}`)
  console.log(`${color.bold}${color.cyan}═══════════════════════════════════════════════${color.reset}`)
  console.log()

  // 初始编译
  log('Watcher', 'Running initial builds...', color.cyan)
  for (const target of targets) {
    triggerBuild(target)
  }
  console.log()

  // 设置文件监控
  for (const target of targets) {
    for (const watchDir of target.watchDirs) {
      if (!existsSync(watchDir)) {
        log(target.name, `Watch directory not found: ${relative(ROOT, watchDir)}`, color.yellow)
        continue
      }

      const files = collectFiles(watchDir, target.extensions)
      log(target.name, `Watching ${files.length} files in ${relative(ROOT, watchDir)}/`, color.cyan)

      for (const filePath of files) {
        watchFile(filePath, { interval: 1000 }, (curr, prev) => {
          if (curr.mtimeMs !== prev.mtimeMs) {
            onFileChange(target, filePath)
          }
        })
      }
    }
  }

  console.log()
  log('Watcher', 'All targets monitored. Press Ctrl+C to stop.', color.green)
  console.log()

  // 优雅退出
  const cleanup = () => {
    console.log()
    log('Watcher', 'Shutting down...', color.yellow)

    for (const target of targets) {
      for (const watchDir of target.watchDirs) {
        const files = collectFiles(watchDir, target.extensions)
        for (const filePath of files) {
          unwatchFile(filePath)
        }
      }
    }

    for (const timer of pendingTimers.values()) {
      clearTimeout(timer)
    }

    log('Watcher', 'Stopped.', color.green)
    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
}

main()

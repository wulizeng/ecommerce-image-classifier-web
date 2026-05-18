// ═══════════════════════════════════════════════════════
// 配置管理 (localStorage, 7 天过期)
// ═══════════════════════════════════════════════════════
const CONFIG_KEY = 'eic_config'
const CONFIG_MAX_AGE = 7 * 24 * 60 * 60 * 1000  // 7 天

// Cloudflare Worker 日志地址（部署后替换为实际 URL）
const LOG_URL = '/log'

function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return null
    const cfg = JSON.parse(raw)
    if (Date.now() - (cfg.savedAt || 0) > CONFIG_MAX_AGE) {
      localStorage.removeItem(CONFIG_KEY)
      return null
    }
    return cfg
  } catch { return null }
}

function saveConfig(cfg) {
  cfg.savedAt = Date.now()
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg))
}

function getHeaders() {
  const cfg = loadConfig() || {}
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${cfg.apiKey || ''}`
  }
}

function classifyUrl(url, signal) {
  const cfg = loadConfig()
  return fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      model: cfg.model || 'qwen3.5-plus',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url } },
          { type: 'text', text: '请判断这张商品图片中是否有人物模特（真人或仿真人模特）。只回答"模特图"或"静态图"，不要其他内容。有人物则回答"模特图"，没有人物则回答"静态图"。' }
        ]
      }]
    }),
    signal
  })
}

function logUsage(action, count, result) {
  if (!LOG_URL) return
  fetch(LOG_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timestamp: Date.now(),
      action,
      count,
      result
    })
  }).catch(() => {})
}

// ═══════════════════════════════════════════════════════
// 配置对话框
// ═══════════════════════════════════════════════════════
const overlay = document.getElementById('config-overlay')
const apiKeyInput = document.getElementById('config-api-key')
const modelInput = document.getElementById('config-model')
const baseUrlInput = document.getElementById('config-base-url')
const configError = document.getElementById('config-error')
const configCancelBtn = document.getElementById('config-cancel-btn')
const toggleKeyBtn = document.getElementById('toggle-key-btn')

function openConfig(canCancel) {
  const cfg = loadConfig()
  if (cfg) {
    apiKeyInput.value = cfg.apiKey || ''
    modelInput.value = cfg.model || 'qwen3.5-plus'
    baseUrlInput.value = cfg.baseUrl || ''
  } else {
    modelInput.value = 'qwen3.5-plus'
  }
  configCancelBtn.classList.toggle('hidden', !canCancel)
  configError.classList.add('hidden')
  overlay.classList.remove('hidden')
}

function closeConfig() {
  overlay.classList.add('hidden')
}

overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeConfig()
})

// 首次打开检测配置
if (!loadConfig()) {
  openConfig(true)
}

toggleKeyBtn.addEventListener('click', () => {
  if (apiKeyInput.type === 'password') {
    apiKeyInput.type = 'text'
    toggleKeyBtn.textContent = '隐藏'
  } else {
    apiKeyInput.type = 'password'
    toggleKeyBtn.textContent = '显示'
  }
})

document.getElementById('config-save-btn').addEventListener('click', () => {
  const apiKey = apiKeyInput.value.trim()
  const model = modelInput.value.trim() || 'qwen3.5-plus'
  const baseUrl = baseUrlInput.value.trim()
  if (!apiKey || !baseUrl) {
    configError.classList.remove('hidden')
    return
  }
  saveConfig({ apiKey, model, baseUrl })
  closeConfig()
})

configCancelBtn.addEventListener('click', closeConfig)
document.getElementById('settings-btn').addEventListener('click', () => openConfig(true))

// ═══════════════════════════════════════════════════════
// 标签切换 & 刷新
// ═══════════════════════════════════════════════════════
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
    document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'))
    tab.classList.add('active')
    document.getElementById(`${tab.dataset.tab}-panel`).classList.remove('hidden')
  })
})

document.getElementById('reset-btn').addEventListener('click', () => {
  document.getElementById('single-url').value = ''
  document.getElementById('single-result').innerHTML = ''
  document.getElementById('single-cancel-btn').classList.add('hidden')
  document.getElementById('batch-file').value = ''
  document.getElementById('batch-result').innerHTML = ''
  document.getElementById('batch-progress').classList.add('hidden')
  document.getElementById('progress-fill').style.width = '0%'
  document.getElementById('progress-count').textContent = '已处理 0/0'
  document.getElementById('progress-success').textContent = '成功 0'
  document.getElementById('progress-fail').textContent = '失败 0'
  document.getElementById('progress-fail').classList.remove('has-error')
  document.getElementById('progress-time').textContent = '耗时 0s'
})

function setTaskRunning(running) {
  document.getElementById('reset-btn').disabled = running
}

function checkConfig() {
  if (!loadConfig()) {
    openConfig(true)
    return false
  }
  return true
}

// ═══════════════════════════════════════════════════════
// 单条模式
// ═══════════════════════════════════════════════════════
let singleAbortController = null

document.getElementById('single-btn').addEventListener('click', async () => {
  const url = document.getElementById('single-url').value.trim()
  const resultDiv = document.getElementById('single-result')
  const btn = document.getElementById('single-btn')
  const cancelBtn = document.getElementById('single-cancel-btn')
  if (!url) return
  if (!checkConfig()) return

  btn.disabled = true
  cancelBtn.classList.remove('hidden')
  setTaskRunning(true)
  resultDiv.innerHTML = '<p>识别中...</p>'
  const t0 = Date.now()
  singleAbortController = new AbortController()

  try {
    const resp = await classifyUrl(url, singleAbortController.signal)
    if (!resp.ok) {
      const data = await resp.json()
      const msg = data.error?.message || data.error || '识别失败'
      const p = document.createElement('p')
      p.className = 'error-msg'
      p.textContent = msg
      resultDiv.replaceChildren(p)
      logUsage('classify', 1, 'error')
      return
    }
    const data = await resp.json()
    const answer = data.choices?.[0]?.message?.content?.trim() || ''
    const label = answer.includes('模特') ? '模特图' : '静态图'
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
    resultDiv.innerHTML = `
      <div class="single-result-card">
        <div class="single-result-info">
          <span class="label ${label === '模特图' ? 'model' : 'static'}">${label}</span>
          <span class="elapsed-text">识别耗时 ${elapsed}s</span>
        </div>
        <img src="${url}" alt="图片">
      </div>
    `
    logUsage('classify', 1, 'success')
  } catch (e) {
    if (e.name === 'AbortError') {
      resultDiv.innerHTML = '<p class="error-msg">已取消</p>'
    } else {
      const p = document.createElement('p')
      p.className = 'error-msg'
      p.textContent = `请求失败: ${e.message}`
      resultDiv.replaceChildren(p)
      logUsage('classify', 1, 'error')
    }
  } finally {
    btn.disabled = false
    cancelBtn.classList.add('hidden')
    singleAbortController = null
    setTaskRunning(false)
  }
})

document.getElementById('single-cancel-btn').addEventListener('click', () => {
  if (singleAbortController) singleAbortController.abort()
})

// ═══════════════════════════════════════════════════════
// 批量模式
// ═══════════════════════════════════════════════════════
const BATCH_SIZE = 3  // 每批识别条数
let batchAbortController = null

document.getElementById('batch-btn').addEventListener('click', async () => {
  const fileInput = document.getElementById('batch-file')
  const resultDiv = document.getElementById('batch-result')
  const progressDiv = document.getElementById('batch-progress')
  const progressFill = document.getElementById('progress-fill')
  const progressCount = document.getElementById('progress-count')
  const progressSuccess = document.getElementById('progress-success')
  const progressFail = document.getElementById('progress-fail')
  const progressTime = document.getElementById('progress-time')
  const btn = document.getElementById('batch-btn')
  const cancelBtn = document.getElementById('batch-cancel-btn')

  if (!fileInput.files[0]) { alert('请先选择 Excel 文件'); return }
  if (!checkConfig()) return

  batchAbortController = new AbortController()
  batchCancelled = false
  btn.disabled = true
  cancelBtn.classList.remove('hidden')
  setTaskRunning(true)
  progressDiv.classList.remove('hidden')
  progressFill.style.width = '0%'
  progressCount.textContent = '已处理 0/0'
  progressSuccess.textContent = '成功 0'
  progressFail.textContent = '失败 0'
  progressFail.classList.remove('has-error')
  progressTime.textContent = '耗时 0s'
  resultDiv.innerHTML = ''

  const startTime = Date.now()
  const timer = setInterval(() => {
    progressTime.textContent = `耗时 ${Math.floor((Date.now() - startTime) / 1000)}s`
  }, 1000)

  let successCount = 0
  let failCount = 0
  let total = 0
  let results = []

  try {
    // Step 1: 用 SheetJS 解析 Excel
    const file = fileInput.files[0]
    const arrayBuffer = await file.arrayBuffer()
    const workbook = XLSX.read(arrayBuffer)
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet)

    if (!rows || rows.length === 0) {
      clearInterval(timer)
      resultDiv.innerHTML = '<p class="error-msg">Excel 文件中没有数据行</p>'
      logUsage('batch', 0, 'error')
      return
    }

    total = rows.length

    // Step 2: 分批识别
    for (let i = 0; i < total; i += BATCH_SIZE) {
      if (batchCancelled) {
        resultDiv.innerHTML = '<p class="error-msg">已取消任务</p>'
        logUsage('batch', i, 'error')
        return
      }

      const batchRows = rows.slice(i, i + BATCH_SIZE)

      for (let j = 0; j < batchRows.length; j++) {
        if (batchCancelled) {
          resultDiv.innerHTML = '<p class="error-msg">已取消任务</p>'
          logUsage('batch', i + j, 'error')
          return
        }

        const row = batchRows[j]
        const imageUrl = String(row['链接'] || '').trim()
        const label = row['款号'] || ''
        const spu = row['SPU'] || ''
        const skc = row['SKC'] || ''
        const skuid = row['SKUID'] || ''

        if (!imageUrl) {
          results.push({ '款号': label, 'SPU': spu, 'SKC': skc, 'SKUID': skuid, '链接': imageUrl, '识别结果': '', '处理状态': '失败: 链接为空' })
          failCount++
          continue
        }

        try {
          const resp = await classifyUrl(imageUrl, batchAbortController.signal)
          if (!resp.ok) {
            const data = await resp.json()
            const msg = data.error?.message || data.error || '识别失败'
            results.push({ '款号': label, 'SPU': spu, 'SKC': skc, 'SKUID': skuid, '链接': imageUrl, '识别结果': '', '处理状态': `失败: ${msg}` })
            failCount++
          } else {
            const data = await resp.json()
            const answer = data.choices?.[0]?.message?.content?.trim() || ''
            const itemLabel = answer.includes('模特') ? '模特图' : '静态图'
            results.push({ '款号': label, 'SPU': spu, 'SKC': skc, 'SKUID': skuid, '链接': imageUrl, '识别结果': itemLabel, '处理状态': '成功' })
            successCount++
          }
        } catch (e) {
          if (e.name === 'AbortError') {
            resultDiv.innerHTML = '<p class="error-msg">已取消任务</p>'
            logUsage('batch', i + j, 'error')
            return
          }
          results.push({ '款号': label, 'SPU': spu, 'SKC': skc, 'SKUID': skuid, '链接': imageUrl, '识别结果': '', '处理状态': '失败: 网络错误' })
          failCount++
        }

        const doneCount = i + j + 1
        progressCount.textContent = `已处理 ${doneCount}/${total}`
        progressSuccess.textContent = `成功 ${successCount}`
        progressFail.textContent = `失败 ${failCount}`
        progressFail.classList.toggle('has-error', failCount > 0)
        progressFill.style.width = `${Math.round(doneCount / total * 100)}%`
      }
    }

    // Step 3: 生成结果 Excel
    clearInterval(timer)
    const resultSheet = XLSX.utils.json_to_sheet(results)
    const resultWorkbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(resultWorkbook, resultSheet, '识别结果')
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const fileName = `识别结果_${timestamp}.xlsx`
    const blob = XLSX.write(resultWorkbook, { bookType: 'xlsx', type: 'array' })
    const blobObj = new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const downloadUrl = URL.createObjectURL(blobObj)

    const a = document.createElement('a')
    a.href = downloadUrl
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(downloadUrl)

    progressTime.textContent = `耗时 ${((Date.now() - startTime) / 1000).toFixed(1)}s`
    progressFill.style.width = '100%'
    resultDiv.innerHTML = `
      <p class="download-tip" style="color: #34d399; margin-top: 16px;">结果文件已开始下载，请在下载目录查看</p>
      <p style="color: #64748b; font-size: 13px;">成功 ${successCount} / 失败 ${failCount}</p>
    `
    logUsage('batch', total, failCount === 0 ? 'success' : 'error')
  } catch (e) {
    clearInterval(timer)
    if (batchCancelled) {
      resultDiv.innerHTML = '<p class="error-msg">已取消任务</p>'
    } else {
      resultDiv.innerHTML = `<p class="error-msg">请求失败: ${e.message}</p>`
      logUsage('batch', 0, 'error')
    }
  } finally {
    batchAbortController = null
    btn.disabled = false
    cancelBtn.classList.add('hidden')
    setTaskRunning(false)
  }
})

document.getElementById('batch-cancel-btn').addEventListener('click', () => {
  batchCancelled = true
  if (batchAbortController) batchAbortController.abort()
})

// ═══════════════════════════════════════════════════════
// 页面加载日志
// ═══════════════════════════════════════════════════════
logUsage('visit', 0, 'success')

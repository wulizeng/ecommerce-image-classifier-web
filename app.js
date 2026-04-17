// Railway 后端地址，部署后替换为实际域名
const API_BASE = 'https://ecommerce-image-classifier-web-production.up.railway.app'

// ── 配置管理 ──────────────────────────────────────────
const CONFIG_KEY = 'eic_config'

function loadConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null') } catch { return null }
}

function saveConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg))
}

function getHeaders() {
  const cfg = loadConfig() || {}
  return {
    'X-Api-Key': cfg.apiKey || '',
    'X-Model': cfg.model || 'qwen3.5-plus',
    'X-Base-Url': cfg.baseUrl || ''
  }
}

function api(path) {
  return `${API_BASE}${path}`
}

// ── 配置对话框 ────────────────────────────────────────
const overlay = document.getElementById('config-overlay')
const apiKeyInput = document.getElementById('config-api-key')
const modelInput = document.getElementById('config-model')
const baseUrlInput = document.getElementById('config-base-url')
const configError = document.getElementById('config-error')
const configCancelBtn = document.getElementById('config-cancel-btn')
const toggleKeyBtn = document.getElementById('toggle-key-btn')

let configCanClose = false

function openConfig(canCancel) {
  configCanClose = canCancel
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

// ── 标签切换 ──────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
    document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'))
    tab.classList.add('active')
    document.getElementById(`${tab.dataset.tab}-panel`).classList.remove('hidden')
  })
})

// ── 刷新按钮 ──────────────────────────────────────────
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

// ── 单条模式 ──────────────────────────────────────────
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
    const resp = await fetch(api('/api/single'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getHeaders() },
      body: JSON.stringify({ url }),
      signal: singleAbortController.signal
    })
    const data = await resp.json()
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
    if (!resp.ok) {
      resultDiv.innerHTML = `<p class="error-msg">${data.error}</p>`
      return
    }
    resultDiv.innerHTML = `
      <div class="single-result-card">
        <div class="single-result-info">
          <span class="label ${data.label === '模特图' ? 'model' : 'static'}">${data.label}</span>
          <span class="elapsed-text">识别耗时 ${elapsed}s</span>
        </div>
        <img src="${data.url}" alt="图片">
      </div>
    `
  } catch (e) {
    if (e.name === 'AbortError') {
      resultDiv.innerHTML = `<p class="error-msg">已取消</p>`
    } else {
      resultDiv.innerHTML = `<p class="error-msg">请求失败: ${e.message}</p>`
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

// ── 批量模式 ──────────────────────────────────────────
const BATCH_SIZE = 3  // 每批识别条数

let batchCancelled = false

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

  try {
    // Step 1: 上传 Excel，获取所有行数据
    const formData = new FormData()
    formData.append('file', fileInput.files[0])
    const uploadResp = await fetch(api('/api/upload'), {
      method: 'POST',
      body: formData
    })
    if (!uploadResp.ok) {
      const d = await uploadResp.json()
      resultDiv.innerHTML = `<p class="error-msg">${d.error}</p>`
      return
    }
    const uploadData = await uploadResp.json()
    const { session_key, total, rows } = uploadData

    // Step 2: 分批识别
    const processed = new Array(total)
    for (let i = 0; i < total; i += BATCH_SIZE) {
      if (batchCancelled) {
        resultDiv.innerHTML = `<p class="error-msg">已取消任务</p>`
        return
      }
      const batchRows = rows.slice(i, i + BATCH_SIZE)
      const items = batchRows.map((row, offset) => ({
        index: i + offset,
        url: row['链接'] || '',
        row
      }))

      const batchResp = await fetch(api('/api/classify-batch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getHeaders() },
        body: JSON.stringify({ items })
      })
      if (!batchResp.ok) {
        const d = await batchResp.json()
        resultDiv.innerHTML = `<p class="error-msg">识别失败: ${d.error}</p>`
        return
      }
      const batchData = await batchResp.json()

      for (const r of batchData.results) {
        processed[r.index] = { ...r.row, label: r.label, status: r.status }
        if (r.status === '成功') successCount++
        else { failCount++; progressFail.classList.add('has-error') }
      }

      const doneCount = Math.min(i + BATCH_SIZE, total)
      progressCount.textContent = `已处理 ${doneCount}/${total}`
      progressSuccess.textContent = `成功 ${successCount}`
      progressFail.textContent = `失败 ${failCount}`
      progressFill.style.width = `${Math.round(doneCount / total * 100)}%`
    }

    // Step 3: 生成结果 Excel
    const finalResp = await fetch(api('/api/finalize'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_key, processed: processed.filter(Boolean) })
    })
    if (!finalResp.ok) {
      const d = await finalResp.json()
      resultDiv.innerHTML = `<p class="error-msg">生成文件失败: ${d.error}</p>`
      return
    }
    const finalData = await finalResp.json()

    clearInterval(timer)
    progressTime.textContent = `耗时 ${((Date.now() - startTime) / 1000).toFixed(1)}s`
    progressFill.style.width = '100%'
    const downloadUrl = api(`/api/download?session_key=${encodeURIComponent(finalData.session_key)}`)
    resultDiv.innerHTML = `
      <button class="download-btn" id="download-btn">下载结果 Excel</button>
      <p class="download-tip hidden" id="download-tip">结果文件已开始下载，请在下载目录查看</p>
    `
    document.getElementById('download-btn').addEventListener('click', () => {
      window.location.href = downloadUrl
      document.getElementById('download-tip').classList.remove('hidden')
    })
  } catch (e) {
    clearInterval(timer)
    if (batchCancelled) {
      resultDiv.innerHTML = `<p class="error-msg">已取消任务</p>`
    } else {
      resultDiv.innerHTML = `<p class="error-msg">请求失败: ${e.message}</p>`
    }
  } finally {
    btn.disabled = false
    cancelBtn.classList.add('hidden')
    setTaskRunning(false)
  }
})

document.getElementById('batch-cancel-btn').addEventListener('click', () => {
  batchCancelled = true
})

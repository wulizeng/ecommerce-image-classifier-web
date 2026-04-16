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

  const formData = new FormData()
  formData.append('file', fileInput.files[0])

  let successCount = 0
  let failCount = 0

  try {
    const resp = await fetch(api('/api/batch/stream'), {
      method: 'POST',
      headers: getHeaders(),
      body: formData,
      signal: batchAbortController.signal
    })
    if (!resp.ok) {
      clearInterval(timer)
      const data = await resp.json()
      resultDiv.innerHTML = `<p class="error-msg">${data.error}</p>`
      return
    }

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue
        let event
        try { event = JSON.parse(trimmed.slice(5).trim()) } catch { continue }

        if (event.done) {
          clearInterval(timer)
          progressTime.textContent = `耗时 ${((Date.now() - startTime) / 1000).toFixed(1)}s`
          progressFill.style.width = '100%'
          const downloadUrl = api(`/api/download?session_key=${encodeURIComponent(event.session_key)}`)
          resultDiv.innerHTML = `
            <button class="download-btn" id="download-btn">下载结果 Excel</button>
            <p class="download-tip hidden" id="download-tip">结果文件已开始下载，请在下载目录查看</p>
          `
          document.getElementById('download-btn').addEventListener('click', () => {
            window.location.href = downloadUrl
            document.getElementById('download-tip').classList.remove('hidden')
          })
        } else {
          const { index, total, status } = event
          if (status === '成功') successCount++
          else { failCount++; progressFail.classList.add('has-error') }
          progressCount.textContent = `已处理 ${index}/${total}`
          progressSuccess.textContent = `成功 ${successCount}`
          progressFail.textContent = `失败 ${failCount}`
          progressFill.style.width = `${Math.round(index / total * 100)}%`
        }
      }
    }
  } catch (e) {
    clearInterval(timer)
    if (e.name === 'AbortError') {
      resultDiv.innerHTML = `<p class="error-msg">已取消任务</p>`
    } else {
      resultDiv.innerHTML = `<p class="error-msg">请求失败: ${e.message}</p>`
    }
  } finally {
    btn.disabled = false
    cancelBtn.classList.add('hidden')
    batchAbortController = null
    setTaskRunning(false)
  }
})

document.getElementById('batch-cancel-btn').addEventListener('click', () => {
  if (batchAbortController) batchAbortController.abort()
})

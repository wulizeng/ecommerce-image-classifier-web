# Pure Frontend Migration Design

## Summary

Migrate the ecommerce image classifier from a Flask+Railway backend architecture to a pure static frontend (GitHub Pages). Replace server-side Excel parsing and image classification with browser-native equivalents using SheetJS and direct OpenAI-compatible API calls. Add anonymous usage logging via Cloudflare Workers.

## Architecture

### Before

```
Browser ──▶ Railway (Flask) ──▶ OpenAI-compatible API
               │
               ├─ openpyxl (Excel read/write)
               ├─ requests (download images, base64 encode)
               └─ openai SDK (classify images)
```

### After

```
Browser (GitHub Pages)
  ├─ SheetJS (Excel read/write in browser)
  ├─ fetch() ─▶ OpenAI-compatible API (direct, with URL as image_url)
  └─ fetch() ─▶ Cloudflare Worker (anonymous usage logging only)
```

## Components

### 1. Excel Handling (SheetJS)

- **Replace**: `backend/excel_handler.py` (openpyxl)
- **Library**: SheetJS (`xlsx.full.min.js`) via CDN
- **Read flow**:
  1. User selects `.xlsx` file via `<input type="file">`
  2. `FileReader.readAsArrayBuffer()` → `XLSX.read(data)` → `XLSX.utils.sheet_to_json()`
  3. Extract columns: 款号, SPU, SKUID, 链接 (same schema as Python version)
- **Write flow**:
  1. Build result array with columns: 款号, SPU, SKUID, 链接, 识别结果, 处理状态
  2. `XLSX.utils.json_to_sheet()` → `XLSX.write()` → `Blob` → download via `<a>` tag
- **No server storage**: All processing in memory

### 2. Image Classification (Direct API)

- **Replace**: `backend/classifier.py` (openai SDK + requests)
- **Approach**: Direct `fetch()` to OpenAI-compatible API endpoint
- **Request format**:
  ```json
  {
    "model": "<user-configured-model>",
    "messages": [{
      "role": "user",
      "content": [
        { "type": "image_url", "image_url": { "url": "<product-url>" } },
        { "type": "text", "text": "请判断这张商品图片中是否有人物模特..." }
      ]
    }]
  }
  ```
- **No image download**: Pass product URL directly to `image_url.url`. The model server fetches the image itself.
- **Headers**: `Authorization: Bearer <apiKey>`
- **CORS**: User's API provider must support CORS (most OpenAI-compatible providers do). The config dialog already collects `base_url`, allowing users to switch providers if one doesn't support CORS.

### 3. Configuration (localStorage)

- **Unchanged**: Config dialog UI remains the same
- **Storage**: `localStorage` with keys: `apiKey`, `model`, `baseUrl`, `savedAt` (timestamp)
- **Expiration**: Optional 7-day expiry. On load, check if `Date.now() - savedAt > 7 days`. If expired, prompt user to re-enter config.
- **Security**: API Key never leaves the user's browser except as `Authorization` header to the configured API endpoint. Not transmitted to the logging service or committed to any repository.

### 4. Usage Logging (Cloudflare Worker)

- **Endpoint**: 1 Cloudflare Worker + D1 Database (free tier)
- **Logged data only**:
  - `timestamp` (Unix epoch)
  - `action` (`visit` | `classify` | `batch`)
  - `item_count` (number of items processed)
  - `result` (`success` | `error`)
- **NOT logged**: IP, User-Agent, API keys, image URLs, any personal data
- **Integration**:
  - `logUsage(action, count, result)` function in `app.js`
  - Called after: page load (visit), single classification (classify), batch classification (batch)
  - Uses `fetch(..., { keepalive: true })` — fire-and-forget, non-blocking
  - Failure is silently ignored; does not affect primary functionality
- **Worker code**: ~10 lines, deployed via `wrangler deploy`, costs $0/month

### 5. Frontend Structure

Files modified/added:

| File | Action | Description |
|------|--------|-------------|
| `frontend/index.html` | Modify | Add SheetJS CDN `<script>`, no structural changes |
| `frontend/app.js` | Rewrite | Replace all `/api/*` fetch calls with local logic + Cloudflare logging |
| `frontend/style.css` | Unchanged | No CSS changes needed |
| `backend/` | Keep (not deleted) | Retain for reference, not used by frontend |
| `worker/` | New | Cloudflare Worker source + wrangler.toml |

## Data Flow

### Single Mode

```
User inputs URL
  → checkConfig() — validates localStorage
  → fetch(apiEndpoint) — classify image
  → logUsage('classify', 1, 'success' | 'error')
  → display result card
```

### Batch Mode

```
User selects .xlsx file
  → FileReader + SheetJS → parse rows → total count
  → Loop in batches of 3:
      → fetch(apiEndpoint) — classify batch
      → accumulate results
  → SheetJS → build output workbook → trigger download
  → logUsage('batch', totalProcessed, 'success' | 'error')
```

## Error Handling

| Error | Handling |
|-------|----------|
| No config saved | Show config dialog (existing behavior) |
| API returns error | Display error message in result area |
| SheetJS parse failure | Display "Excel 解析失败" message |
| CORS blocked | Show message suggesting user check CORS support or change API provider |
| Logging failure | Silently ignored |
| Network timeout | Browser default timeout (fetch with AbortController for cancellation) |

## Files NOT Changed

- `frontend/style.css` — existing styles preserved
- `backend/*` — retained for reference, not referenced by new frontend
- `Procfile`, `requirements.txt` — retained but unused for new deployment

## Deployment

1. **GitHub Pages**: Push to `main` branch, enable Pages from `frontend/` directory
2. **Cloudflare Worker**: `wrangler deploy` (separate, minimal)
3. **User action**: User opens GitHub Pages URL, enters their API config in dialog

## Cost

| Service | Cost |
|---------|------|
| GitHub Pages | $0 |
| Cloudflare Workers | $0 (100k requests/day free tier) |
| Cloudflare D1 | $0 (5M reads + 5M writes/day free tier) |

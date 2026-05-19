# 验收 api.wx.2000gallery.art 的 CORS 与回源（独立 API 域名）
$ApiBase = if ($env:API_BASE) { $env:API_BASE } else { "https://api.wx.2000gallery.art" }
$AdminOrigin = if ($env:ADMIN_ORIGIN) { $env:ADMIN_ORIGIN } else { "https://wx.ht.2000gallery.art" }

Write-Host "API: $ApiBase"
Write-Host "Origin: $AdminOrigin"
Write-Host ""

Write-Host "=== OPTIONS preflight /api/artists ==="
$preflight = curl.exe -sI -X OPTIONS "$ApiBase/api/artists" `
  -H "Origin: $AdminOrigin" `
  -H "Access-Control-Request-Method: GET" `
  -H "Access-Control-Request-Headers: authorization,content-type"
Write-Host $preflight

$hasAcao = $preflight -match "access-control-allow-origin:\s*$([regex]::Escape($AdminOrigin))"
$okPreflight = ($preflight -match "HTTP/1\.[01] 204") -or ($preflight -match "HTTP/1\.[01] 200")
if ($okPreflight -and $hasAcao) {
  Write-Host "[OK] Preflight" -ForegroundColor Green
} else {
  Write-Host "[FAIL] Preflight (expect 204/200 + Access-Control-Allow-Origin)" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== GET /api/health ==="
$health = curl.exe -s "$ApiBase/api/health"
Write-Host $health
if ($health -match '"status"') {
  Write-Host "[OK] Health" -ForegroundColor Green
} else {
  Write-Host "[FAIL] Health (expect JSON with status)" -ForegroundColor Red
}

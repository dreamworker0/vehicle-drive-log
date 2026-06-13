---
description: 테스트 커버리지 수집, HTML 리포트 생성, 임계치 검증
---

1. Run tests with coverage collection:
// turbo
```
npm run test:coverage
```
Working directory: `.`

2. Show coverage summary:
// turbo
```
if (Test-Path "coverage/coverage-summary.json") { $summary = Get-Content "coverage/coverage-summary.json" | ConvertFrom-Json; $total = $summary.total; Write-Host "=== 커버리지 요약 ==="; Write-Host "Statements: $($total.statements.pct)%"; Write-Host "Branches:   $($total.branches.pct)%"; Write-Host "Functions:  $($total.functions.pct)%"; Write-Host "Lines:      $($total.lines.pct)%" } else { Write-Host "⚠ coverage-summary.json이 생성되지 않았습니다. vitest.config.js의 coverage 설정을 확인하세요." }
```
Working directory: `.`

3. List uncovered files (lines coverage < 50%):
// turbo
```
if (Test-Path "coverage/coverage-summary.json") { $data = Get-Content "coverage/coverage-summary.json" | ConvertFrom-Json; $data.PSObject.Properties | Where-Object { $_.Name -ne "total" -and $_.Value.lines.pct -lt 50 } | Sort-Object { $_.Value.lines.pct } | Select-Object -First 20 | ForEach-Object { Write-Host "$([math]::Round($_.Value.lines.pct, 1))% $($_.Name)" } } else { Write-Host "coverage-summary.json 없음" }
```
Working directory: `.`

> 💡 **HTML 리포트**: `coverage/` 디렉토리에 생성된 HTML 리포트를 브라우저에서 열어 상세 확인할 수 있습니다.
> 💡 **CI 연계**: GitHub Actions에서 커버리지 임계치를 설정하려면 `vitest.config.js`의 `coverage.thresholds` 옵션을 사용하세요.

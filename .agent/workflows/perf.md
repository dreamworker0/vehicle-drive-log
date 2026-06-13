---
description: 프론트엔드 번들 분석 및 Firestore 읽기 비용 점검
---

> ⚠️ **반드시 Node 22 LTS를 사용해야 합니다.**

1. Activate Node 22:
// turbo
```
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; fnm use 22
```
Working directory: `.`

2. Production build + bundle size check:
// turbo
```
npm run build
```
Working directory: `.`

3. Analyze bundle composition (top 10 largest chunks):
// turbo
```
$distDir = "dist/assets"; if (Test-Path $distDir) { Get-ChildItem $distDir -Filter "*.js" | Sort-Object Length -Descending | Select-Object -First 10 | ForEach-Object { Write-Host "$([math]::Round($_.Length/1024, 1))KB  $($_.Name)" }; Write-Host ""; $totalKB = [math]::Round((Get-ChildItem $distDir -Recurse | Measure-Object Length -Sum).Sum/1024, 1); Write-Host "총 JS+CSS 크기: ${totalKB}KB" } else { Write-Host "dist/assets 디렉토리가 없습니다. 먼저 빌드를 실행하세요." }
```
Working directory: `.`

4. Check for large dependencies in node_modules:
// turbo
```
Get-ChildItem "node_modules" -Directory | ForEach-Object { $size = (Get-ChildItem $_.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum; [PSCustomObject]@{Name=$_.Name; SizeMB=[math]::Round($size/1MB, 2)} } | Sort-Object SizeMB -Descending | Select-Object -First 15 | Format-Table -AutoSize
```
Working directory: `.`

5. Scan for potential tree-shaking issues (barrel imports from large packages):
// turbo
```
Select-String -Path "src/**/*.ts","src/**/*.tsx" -Pattern "import \{[^}]+\} from '(lodash|moment|date-fns|@mui|antd)'" -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "⚠ $($_.Filename):$($_.LineNumber) — $($_.Line.Trim())" }
```
Working directory: `.`

> 💡 **상세 번들 분석이 필요하면**: `npx vite-bundle-analyzer` 실행 (인터랙티브 시각화)
> 💡 **Firestore 읽기 비용 점검**: Firebase Console → Usage → Firestore Read/Write 통계를 확인하세요.

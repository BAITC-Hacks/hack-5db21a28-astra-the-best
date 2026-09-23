param([int]$RefreshSeconds = 5)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$root = 'D:\HackAlem'
$claims = Join-Path $root 'coordination\claims'
while ($true) {
    $taskNames = @{}
    foreach ($line in Get-Content (Join-Path $root 'PLAN.md') -Encoding UTF8) {
        if ($line -match '^\| (P\d{2}|O\d{2}) \| ([^|]+) \|') {
            $taskNames[$Matches[1]] = $Matches[2].Trim()
        }
    }
    Clear-Host
    Write-Host ('HackAlem — статус плана   {0:yyyy-MM-dd HH:mm:ss}' -f (Get-Date)) -ForegroundColor Cyan
    Write-Host 'Источник: D:\HackAlem\coordination\claims' -ForegroundColor DarkGray
    Write-Host ''

    $rows = foreach ($id in ($taskNames.Keys | Sort-Object)) {
        $path = Join-Path $claims "$id.json"
        $claim = $null
        if (Test-Path $path) {
            try { $claim = Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json }
            catch { }
        }
        [pscustomobject]@{
            ID = $id
            Status = if ($claim) { $claim.status } else { 'todo' }
            Agent = if ($claim) { $claim.agent } else { '—' }
            Task = $taskNames[$id]
        }
    }

    $done = @($rows | Where-Object Status -eq 'done')
    $active = @($rows | Where-Object Status -eq 'in_progress')
    $remaining = @($rows | Where-Object { $_.Status -ne 'done' -and $_.Status -ne 'in_progress' })
    Write-Host ("Готово: {0}   В работе: {1}   Осталось: {2}" -f $done.Count, $active.Count, $remaining.Count) -ForegroundColor Yellow
    Write-Host ''
    $rows | Format-Table -AutoSize | Out-String -Width 180 | Write-Host
    Write-Host ("Обновление каждые {0} сек. Ctrl+C — остановить." -f $RefreshSeconds) -ForegroundColor DarkGray
    Start-Sleep -Seconds $RefreshSeconds
}

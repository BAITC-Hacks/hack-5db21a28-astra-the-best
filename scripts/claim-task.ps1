[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^(P(0[1-9]|[12][0-9]|3[0-2])|O0[1-3])$')]
    [string]$Task,
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$Agent,
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$Session
)

$ErrorActionPreference = 'Stop'
# One shared registry, including when this script is invoked from a worktree.
$registryPath = 'D:\HackAlem\coordination\claims'
[System.IO.Directory]::CreateDirectory($registryPath) | Out-Null
$claimPath = Join-Path $registryPath ($Task + '.json')
$timestamp = [DateTimeOffset]::Now.ToString('o')
$claim = [ordered]@{
    task = $Task
    status = 'in_progress'
    agent = $Agent
    session = $Session
    claimed_at = $timestamp
    updated_at = $timestamp
    signature = "$Agent / $Session accepts task $Task"
    artifacts = @()
    checks = @()
    notes = ''
}
$bytes = [System.Text.UTF8Encoding]::new($false).GetBytes(($claim | ConvertTo-Json -Depth 5))
try {
    $claimStream = [System.IO.File]::Open($claimPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
} catch {
    throw "Cannot claim $Task. Existing claims must not be overwritten. Inspect $claimPath. Details: $($_.Exception.Message)"
}
try {
    $claimStream.Write($bytes, 0, $bytes.Length)
    $claimStream.Flush($true)
} finally {
    $claimStream.Dispose()
}
Write-Output "CLAIMED $Task by $Agent / $Session. Signature: $claimPath"

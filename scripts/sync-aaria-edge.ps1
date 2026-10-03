param(
    [Parameter(Mandatory=$true)]
    [string]$CommitSha
)

$RepoUrl = "https://github.com/PranixQuick/aaria-edge"
$TempDir = "$env:TEMP\aaria-edge-sync-$([guid]::NewGuid())"

Write-Host "Cloning aaria-edge to $TempDir..."
git clone $RepoUrl $TempDir
Push-Location $TempDir
git checkout $CommitSha
Pop-Location

Write-Host "Copying files..."
$TargetDir = "$PSScriptRoot\..\android\aaria-edge"
Remove-Item -Recurse -Force "$TargetDir\src" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$TargetDir\libs" -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force "$TargetDir\src" | Out-Null
Copy-Item -Recurse "$TempDir\plugin\android\src\main" "$TargetDir\src\main"
Copy-Item -Recurse "$TempDir\plugin\android\libs" "$TargetDir\libs"

# Update VENDORED_FROM.txt
$Date = Get-Date -Format "yyyy-MM-dd"
$Content = @"
Repository: $RepoUrl
Commit: $CommitSha
Date: $Date
"@
Set-Content -Path "$TargetDir\VENDORED_FROM.txt" -Value $Content

Write-Host "Cleaning up..."
Remove-Item -Recurse -Force $TempDir

Write-Host "Sync complete!"

Add-Type -AssemblyName System.IO.Compression.FileSystem

$personalApk = "android/app/build/outputs/apk/personal/debug/app-personal-debug.apk"
$businessApk = "android/app/build/outputs/apk/business/debug/app-business-debug.apk"

Write-Host "========================================"
Write-Host "EXTRACTED PERSONAL APK CONFIG"
Write-Host "========================================"
$zipP = [System.IO.Compression.ZipFile]::OpenRead($personalApk)
$entryP = $zipP.Entries | Where-Object { $_.FullName -eq "assets/capacitor.config.json" }
if ($entryP) {
    $streamP = $entryP.Open()
    $readerP = New-Object System.IO.StreamReader($streamP)
    Write-Host $readerP.ReadToEnd()
    $readerP.Close()
    $streamP.Close()
} else {
    Write-Host "ERROR: assets/capacitor.config.json NOT FOUND in Personal APK"
}
$zipP.Dispose()

Write-Host ""
Write-Host "========================================"
Write-Host "EXTRACTED BUSINESS APK CONFIG"
Write-Host "========================================"
$zipB = [System.IO.Compression.ZipFile]::OpenRead($businessApk)
$entryB = $zipB.Entries | Where-Object { $_.FullName -eq "assets/capacitor.config.json" }
if ($entryB) {
    $streamB = $entryB.Open()
    $readerB = New-Object System.IO.StreamReader($streamB)
    Write-Host $readerB.ReadToEnd()
    $readerB.Close()
    $streamB.Close()
} else {
    Write-Host "ERROR: assets/capacitor.config.json NOT FOUND in Business APK"
}
$zipB.Dispose()

Write-Host ""
Write-Host "========================================"
Write-Host "ICON ASSET VERIFICATION IN BUSINESS APK"
Write-Host "========================================"
$zipB2 = [System.IO.Compression.ZipFile]::OpenRead($businessApk)
$iconEntries = $zipB2.Entries | Where-Object { $_.FullName -like "*ic_launcher*" } | Select-Object -ExpandProperty FullName
$iconEntries | Out-String | Write-Host
$zipB2.Dispose()

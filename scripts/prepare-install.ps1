param(
  [ValidateSet('Detect', 'Stop', 'Migrate')][string]$Action,
  [Parameter(Mandatory=$true)][string]$InstallDirectory,
  [string]$PreviousDirectory,
  [string]$TargetVersion
)
$ErrorActionPreference = 'Stop'
$env:PSModulePath = "$PSHOME\Modules"
try {
  $legacy = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'portal-desktop'
  if ($Action -eq 'Migrate') {
    # An explicitly isolated profile must never uninstall the user's old client.
    if ($env:PORTAL_DESKTOP_USER_DATA) { exit 0 }
    $updater = Join-Path $legacy 'Update.exe'
    if (Test-Path -LiteralPath $updater) {
      $target = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\') + '\'
      $oldRoot = [IO.Path]::GetFullPath($legacy).TrimEnd('\') + '\'
      if ($target.StartsWith($oldRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Choose a directory outside the old Squirrel installation.' }
      $uninstall = Start-Process -FilePath $updater -ArgumentList '--uninstall','--silent' -WindowStyle Hidden -PassThru
      $uninstall.WaitForExit()
      if ($uninstall.ExitCode -ne 0) { throw 'The old Squirrel installation could not be removed.' }
    }
    exit 0
  }
  $roots = @($InstallDirectory, $PreviousDirectory)
  if (!$env:PORTAL_DESKTOP_USER_DATA) { $roots += $legacy }
  $roots = $roots | Where-Object { $_ } | ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\') + '\' }
  $profile = $env:PORTAL_DESKTOP_USER_DATA
  if (-not $profile) {
    $appData = [Environment]::GetFolderPath('ApplicationData')
    $profile = Join-Path $appData 'portal-desktop'
    $legacyProfile = Join-Path $appData 'Beings'
    if (!(Test-Path -LiteralPath (Join-Path $profile 'connection.json')) -and (Test-Path -LiteralPath (Join-Path $legacyProfile 'connection.json'))) { $profile = $legacyProfile }
  }
  $portalRoot = [IO.Path]::GetFullPath((Join-Path $profile 'portal-service')).TrimEnd('\') + '\'
  function Clients {
    @(Get-CimInstance Win32_Process -Filter "Name='portal-desktop.exe'" | Where-Object {
      $exe = $_.ExecutablePath
      $exe -and @($roots | Where-Object { $exe.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0
    })
  }
  function Portals {
    @(Get-CimInstance Win32_Process -Filter "Name='heart-portal.exe'" | Where-Object {
      $exe = $_.ExecutablePath
      $exe -and ($exe.StartsWith($portalRoot, [StringComparison]::OrdinalIgnoreCase) -or @($roots | Where-Object { $exe.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0)
    })
  }
  $clients = @(Clients)
  if ($clients.Count -eq 0 -and @(Portals).Count -eq 0) { exit 0 }
  if ($Action -eq 'Detect') { exit 10 }
  if ($TargetVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid installer version' }
  $main = $clients | Where-Object { $_.CommandLine -notmatch '--type=' } | Select-Object -First 1
  $launcher = $main.ExecutablePath
  if (!$launcher) {
    $launcher = @($roots | ForEach-Object { Join-Path $_ 'portal-desktop.exe' } | Where-Object { Test-Path -LiteralPath $_ }) | Select-Object -First 1
  }
  if (!$launcher) { throw 'Exit the existing Portal before installing.' }
  Start-Process -FilePath $launcher -ArgumentList "--prepare-installer=$TargetVersion" -WindowStyle Hidden
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  do {
    if (@(Clients).Count -eq 0 -and @(Portals).Count -eq 0) { exit 0 }
    Start-Sleep -Milliseconds 300
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'The old version did not exit. Exit it from its tray menu and stop Portal, then retry.'
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}

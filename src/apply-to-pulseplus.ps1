$ErrorActionPreference = 'Stop'

$workspace = 'C:\Users\BAZA\Desktop\codex-plusePLUS\pulseplus-recovery'
$srcRoot = 'C:\Users\BAZA\pulsePLUS-launcher-src'
$winRoot = 'C:\Users\BAZA\pulsePLUS-launcher-win\pulsePLUS-win\resources\app'

$targets = @(
  @{
    From = Join-Path $workspace 'src\main\resources\web\index.html'
    To = Join-Path $srcRoot 'src\main\resources\web\index.html'
  },
  @{
    From = Join-Path $workspace 'src\main\resources\web\css\style.css'
    To = Join-Path $srcRoot 'src\main\resources\web\css\style.css'
  },
  @{
    From = Join-Path $workspace 'src\main\resources\web\js\app.js'
    To = Join-Path $srcRoot 'src\main\resources\web\js\app.js'
  },
  @{
    From = Join-Path $workspace 'src\main\resources\web\assets'
    To = Join-Path $srcRoot 'src\main\resources\web\assets'
  },
  @{
    From = Join-Path $workspace 'src\main\java\launcher\LauncherConfig.java'
    To = Join-Path $srcRoot 'src\main\java\launcher\LauncherConfig.java'
  },
  @{
    From = Join-Path $workspace 'src\main\java\launcher\VersionCatalog.java'
    To = Join-Path $srcRoot 'src\main\java\launcher\VersionCatalog.java'
  },
  @{
    From = Join-Path $workspace 'src\main\java\launcher\minecraft\VersionManager.java'
    To = Join-Path $srcRoot 'src\main\java\launcher\minecraft\VersionManager.java'
  },
  @{
    From = Join-Path $workspace 'src\main\java\launcher\catalog'
    To = Join-Path $srcRoot 'src\main\java\launcher\catalog'
  },
  @{
    From = Join-Path $workspace 'src\main\java\launcher\mods\ModCatalog.java'
    To = Join-Path $srcRoot 'src\main\java\launcher\mods\ModCatalog.java'
  },
  @{
    From = Join-Path $workspace 'src\main\java\launcher\mods\ModManager.java'
    To = Join-Path $srcRoot 'src\main\java\launcher\mods\ModManager.java'
  },
  @{
    From = Join-Path $workspace 'src\main\java\launcher\mods\ModProfileStore.java'
    To = Join-Path $srcRoot 'src\main\java\launcher\mods\ModProfileStore.java'
  },
  @{
    From = Join-Path $workspace 'src\main\java\launcher\mods\ModUpdateService.java'
    To = Join-Path $srcRoot 'src\main\java\launcher\mods\ModUpdateService.java'
  },
  @{
    From = Join-Path $workspace 'src\main\java\launcher\web\WebServer.java'
    To = Join-Path $srcRoot 'src\main\java\launcher\web\WebServer.java'
  },
  @{
    From = Join-Path $workspace 'src\main\java\launcher\music\BytebeatTrack.java'
    To = Join-Path $srcRoot 'src\main\java\launcher\music\BytebeatTrack.java'
  },
  @{
    From = Join-Path $workspace 'src\main\java\launcher\music\MusicManager.java'
    To = Join-Path $srcRoot 'src\main\java\launcher\music\MusicManager.java'
  },
  @{
    From = Join-Path $workspace 'pulsePLUS-win\resources\app\main.js'
    To = Join-Path $winRoot 'main.js'
  }
)

$duplicateAssets = 'C:\Users\BAZA\pulsePLUS-launcher-src\src\main\resources\web\assets\assets'
if (Test-Path -LiteralPath $duplicateAssets) {
  Remove-Item -LiteralPath $duplicateAssets -Recurse -Force
  Write-Output "removed duplicate $duplicateAssets"
}

foreach ($item in $targets) {
  $dir = Split-Path -Parent $item.To
  if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  if ((Get-Item -LiteralPath $item.From).PSIsContainer) {
    if (Test-Path -LiteralPath $item.To) {
      Remove-Item -LiteralPath $item.To -Recurse -Force
    }
    Copy-Item -LiteralPath $item.From -Destination $dir -Recurse -Force
  } else {
    Copy-Item -LiteralPath $item.From -Destination $item.To -Recurse -Force
  }
  Write-Output "updated $($item.To)"
}

$javaHome = 'C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot'
$javac = Join-Path $javaHome 'bin\javac.exe'
$jarExe = Join-Path $javaHome 'bin\jar.exe'
$gsonJar = Get-ChildItem "$HOME\.gradle\caches\modules-2\files-2.1\com.google.code.gson\gson\2.10.1" -Recurse -Filter 'gson-2.10.1.jar' | Select-Object -First 1 -ExpandProperty FullName

if (-not (Test-Path -LiteralPath $javac)) {
  throw "javac not found: $javac"
}
if (-not $gsonJar) {
  throw 'gson-2.10.1.jar not found in local Gradle cache'
}

$buildRoot = Join-Path $srcRoot '.codex-build'
$classesDir = Join-Path $buildRoot 'classes'
if (Test-Path -LiteralPath $buildRoot) {
  Remove-Item -LiteralPath $buildRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $classesDir -Force | Out-Null

$javaFiles = Get-ChildItem (Join-Path $srcRoot 'src\main\java') -Recurse -Filter '*.java' | ForEach-Object { $_.FullName }
& $javac --release 17 -encoding UTF-8 -cp $gsonJar -d $classesDir $javaFiles
if ($LASTEXITCODE -ne 0) {
  throw "javac failed with exit code $LASTEXITCODE"
}

Copy-Item -LiteralPath (Join-Path $srcRoot 'src\main\resources\*') -Destination $classesDir -Recurse -Force

$manifest = Join-Path $buildRoot 'manifest.mf'
$manifestContent = "Manifest-Version: 1.0`r`nMain-Class: launcher.Main`r`n`r`n"
[System.IO.File]::WriteAllText($manifest, $manifestContent, [System.Text.Encoding]::ASCII)

$jarOut = Join-Path $srcRoot 'pulsePLUS-launcher.jar'
if (Test-Path -LiteralPath $jarOut) {
  Remove-Item -LiteralPath $jarOut -Force
}

Push-Location $classesDir
try {
  & $jarExe cfm $jarOut $manifest .
  if ($LASTEXITCODE -ne 0) {
    throw "jar failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

$electronJar = Join-Path $winRoot 'backend\pulsePLUS-launcher.jar'
Copy-Item -LiteralPath $jarOut -Destination $electronJar -Force
Write-Output "rebuilt $jarOut"
Write-Output "updated $electronJar"

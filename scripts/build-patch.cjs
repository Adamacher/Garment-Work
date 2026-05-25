const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
const version = packageJson.version
const appId = packageJson.build?.appId || 'com.zhiyi.ems'
const productName = packageJson.build?.productName || packageJson.productName || packageJson.name || 'Garment EMS'
const appAsarPath = path.join(projectRoot, 'release', 'win-unpacked', 'resources', 'app.asar')
const patchRoot = path.join(projectRoot, 'release', 'patches')
const stageDir = path.join(patchRoot, `patch-${version}`)
const patchFilePath = path.join(patchRoot, `${productName}-Patch-${version}.zip`)

if (!fs.existsSync(appAsarPath)) {
  throw new Error(`未找到补丁源文件：${appAsarPath}，请先执行 npm run build:electron`)
}

fs.rmSync(stageDir, { recursive: true, force: true })
fs.mkdirSync(stageDir, { recursive: true })
fs.mkdirSync(patchRoot, { recursive: true })
fs.rmSync(patchFilePath, { force: true })

const manifest = {
  appId,
  productName,
  version,
  generatedAt: new Date().toISOString(),
  patchType: 'app.asar',
  notes: '适用于同一安装版程序的本地补丁升级。'
}

fs.copyFileSync(appAsarPath, path.join(stageDir, 'app.asar'))
fs.writeFileSync(path.join(stageDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

const compressScript = `
$ErrorActionPreference = 'Stop'
$source = ${JSON.stringify(stageDir)}
$target = ${JSON.stringify(patchFilePath)}
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory($source, $target, [System.IO.Compression.CompressionLevel]::Optimal, $false)
`.trim()

const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', compressScript], {
  cwd: projectRoot,
  encoding: 'utf8'
})

if (result.status !== 0) {
  throw new Error(result.stderr || result.stdout || '补丁包压缩失败')
}

console.log(`Patch created: ${patchFilePath}`)

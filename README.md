# 服装采购生产管理系统

服装采购生产管理系统用于管理服装企业从原料档案、采购批次、库存出入仓、工厂发料、生产制单、成衣成本到账号权限的日常业务。当前项目同时包含 Windows 桌面端源码和 Android Capacitor 工程。

## 功能模块

- 经营总览：查看经营数据、共享状态、数据库状态和系统说明。
- 物料资料：维护原料编码、名称、分类、供应商、颜色、尺码、单位、价格和换算信息。
- 采购批次：按采购单和批次记录采购数量、颜色尺码、单价、供应商、审核状态和到货信息。
- 库存台账：查看仓库库存、工厂库存、采购在途、预领用数、预领后可用库存和库存均价。
- 出仓入仓：执行原料入仓、出仓、发往工厂、回收入仓和清空残余等库存动作。
- 库存流水：追踪采购、出入仓、生产领用、回冲等库存变化记录。
- 成衣管理：维护成衣款号、图片、分类、BOM 原料、工厂加工费、成本和上浮价格。
- BOM 配置：按成衣配置单件用料、颜色、损耗率、核价口径和加工厂费用。
- 生产制单：创建生产单，维护裁床数、已完成数、实际用料、实际金额、审核图片和成本核算。
- 单耗分析：对比默认用量与实际用量，辅助发现异常损耗。
- 基础设置：维护供应商、工厂、仓库、单位、分类等基础选项。
- 账号权限：管理用户、角色、权限和操作审计。

## 本地启动

桌面上的测试启动脚本会打开当前源码目录：

```powershell
C:\Users\Administrator\Desktop\启动服装采购生产管理系统-测试.bat
```

也可以在项目目录手动启动：

```powershell
cd C:\Users\Administrator\Desktop\garment-ems-app\garment-ems-app
npm install
npm run build
npm run electron:run
```

## 数据与备份

- 业务数据库保存在本机 `DATABASE` 目录。
- 数据库和每日备份文件体积很大，且包含真实业务数据，不会提交到 GitHub。
- 发布包默认导出到 D 盘发布目录，源码仓库不保存 EXE、APK、`dist` 或 `release` 构建产物。

## 版本规则

- 小修复、小 UI 调整、小逻辑修正：递增补丁版本，例如 `1.0.57` 到 `1.0.58`。
- 较大功能调整或流程变更：递增小版本，例如 `1.0.x` 到 `1.1.0`。
- Android 版本号同步写入 `android/app/build.gradle` 的 `versionCode` 和 `versionName`。

## 构建发布

Windows 构建：

```powershell
npm run build
npx electron-builder --win portable
```

Android 构建前先同步 Capacitor：

```powershell
npm run build
npx cap sync android
```

再进入 `android` 目录使用 Gradle 构建 APK。发布 APK 需要对齐和签名后再分发。

## GitHub 同步

本仓库建议命名为 `Garment-Work`。首次配置远程仓库后，可用脚本一键提交并推送更新：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\sync-github.ps1 -RemoteUrl https://github.com/你的用户名/Garment-Work.git
```

以后已配置远程后，只需要运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\sync-github.ps1
```

如果要自定义提交说明：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\sync-github.ps1 -Message "更新生产制单成本逻辑"
```

同步脚本只会提交未被 `.gitignore` 排除的源码、配置和文档，不会上传数据库、依赖目录或发布包。

## 常见问题

- 打开后不是最新界面：先确认桌面 BAT 指向 `Desktop\garment-ems-app\garment-ems-app`，并运行 `npm run build` 后重新打开。
- GitHub 推送失败：确认 GitHub 仓库已经创建、远程地址正确，并在 Git 凭据弹窗中登录正确账号。
- 数据库不能上传：数据库包含业务数据且体积很大，只保存在本地或单独备份，不进入源码仓库。
- Android 构建失败：确认 Android Studio JBR、SDK 和 Gradle 环境可用，再重新执行 `npx cap sync android`。

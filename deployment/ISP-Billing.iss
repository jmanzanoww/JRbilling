; ISP Billing v0.7.0 Inno Setup foundation.
; Build the project first, then compile this file with Inno Setup 6.
#define MyAppName "ISP Billing"
#define MyAppVersion "0.7.0"
#define MyAppPublisher "Local ISP"

[Setup]
AppId={{B60D5A4E-8B33-4F87-A0B0-B0D9D66A6C19}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\ISP Billing
DefaultGroupName=ISP Billing
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma2
SolidCompression=yes
OutputBaseFilename=ISP-Billing-v0.7.0-Setup

[Files]
Source: "..\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion; Excludes: "node_modules\*;.git\*;backups\*"

[Icons]
Name: "{group}\Open ISP Billing"; Filename: "http://localhost:4311"

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\deployment\setup-production.ps1"""; WorkingDir: "{app}"; Flags: runhidden waituntilterminated; StatusMsg: "Installing ISP Billing service and dependencies..."

[UninstallRun]
Filename: "{cmd}"; Parameters: "/C npm run service:uninstall"; WorkingDir: "{app}"; Flags: runhidden; RunOnceId: "RemoveService"

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const read = relativePath => fs.readFile(path.join(process.cwd(), relativePath), 'utf8')

test('setup nativo mostra termos antes de elevar e exige aceite explícito', async () => {
  const setup = await read('windows-setup/Program.cs')
  const consent = await read('windows-setup/SetupConsentForm.cs')
  const project = await read('windows-setup/FilaAgentSetup.csproj')
  const terms = await read('legal/TERMOS-DE-USO-FILA-AGENT.txt')

  const elevationCall = setup.indexOf('RelaunchElevatedWhenRequired(args, testMode)')
  assert.ok(setup.indexOf('SetupConsentForm.ShowInstall') < elevationCall)
  assert.ok(setup.indexOf('SetupConsentForm.ShowUninstall') < elevationCall)
  assert.ok(setup.indexOf('ValidateTestModeOperation(testMode') < elevationCall)
  assert.match(consent, /Aceitar e continuar/)
  assert.match(consent, /_continue\.Enabled = _accept\.Checked/)
  assert.match(consent, /Também apagar pareamento, credenciais, cache e logs locais/)
  assert.match(project, /TermsOfUse\.txt/)
  assert.match(project, /ThirdParty\.00-Overview\.txt/)
  assert.match(project, /third-party\\\*\.txt/)
  assert.match(consent, /Licenças de terceiros/)
  assert.match(consent, /ThirdPartyLicensesForm/)
  assert.match(setup, /TermsVersion = "1\.4"/)
  assert.match(setup, /GetProperty\("termsVersion"\)\.GetString\(\) == TermsVersion/)
  assert.match(setup, /TermsAcceptancePath => Path\.Combine\(Environment\.GetFolderPath\(Environment\.SpecialFolder\.ApplicationData\), "Fila Agent"/)
  assert.match(setup, /LegacyTermsAcceptancePath/)
  assert.match(setup, /new\[\] \{ TermsAcceptancePath, LegacyTermsAcceptancePath \}/)
  assert.match(terms, /Versão 1\.4/)
  assert.match(terms, /Gerenciador de Tarefas > Aplicativos de inicialização/)
  assert.match(terms, /avisos e textos de licença dos componentes incluídos/)
  assert.match(terms, /O OrcaSlicer não faz parte do pacote/)
  assert.match(terms, /AGPL-3\.0/)
})

test('setup C# valida o pacote embutido antes de instalar', async () => {
  const setup = await read('windows-setup/Program.cs')
  const project = await read('windows-setup/FilaAgentSetup.csproj')

  assert.match(project, /FilaAgentPackagePath/)
  assert.match(project, /FilaAgentSetup\.AgentPackage\.zip/)
  assert.match(setup, /AddEmbeddedPackageArgument\(args, out embeddedPackagePath\)/)
  assert.match(setup, /GetManifestResourceStream\("FilaAgentSetup\.AgentPackage\.zip"\)/)
  assert.match(setup, /--validate-embedded-package/)
  assert.match(setup, /ValidateThirdPartyLicenseResources\(\)/)
  assert.match(setup, /FilaAgentSetup\.ThirdParty\.LICENSE-APACHE-2\.0\.txt/)
  assert.match(setup, /RegisterProtocolAlias\(host, "fila-agent"/)
  assert.doesNotMatch(setup, /RegisterProtocolAlias\(host, "printflow-agent"/)
  assert.match(setup, /DeleteSubKeyTree\(@"Software\\Classes\\printflow-agent"/)
  assert.match(setup, /finally[\s\S]*File\.Delete\(embeddedPackagePath\)/)
})

test('setup rejeita URL insegura antes de copiar arquivos e registra erros com rollback', async () => {
  const setup = await read('windows-setup/Program.cs')
  const host = await read('windows-host/Program.cs')

  const validateApi = setup.indexOf('AgentConfiguration.FromEnvironment(new Dictionary<string, string?>')
  const install = setup.indexOf('return Install(zip, apiUrl,')
  assert.ok(validateApi >= 0 && validateApi < install, 'URL de Production deve ser validada antes de iniciar a instalação')
  assert.match(setup, /installer\.log/)
  assert.match(setup, /Falha na instalação: \{installError\.Message\}\. A reversão também falhou: \{rollbackError\.Message\}/)
  assert.match(setup, /installationCompleted && Directory\.Exists\(backup\)/)
  assert.match(host, /var exitTimer = new System\.Windows\.Forms\.Timer \{ Interval = 3_000 \}/)
  assert.match(host, /ExitThread\(\);/)
})

test('setup instala Orca pela Store quando necessário e valida slicing local antes da troca', async () => {
  const setup = await read('windows-setup/Program.cs')
  const runtime = await read('windows-runtime/OrcaSlicerService.cs')
  const unsupportedCheck = setup.indexOf('ThrowIfUnsupportedOrcaStoreVersion();')
  const wingetInstall = setup.indexOf('var winget = ResolveWingetExecutable();')

  assert.match(setup, /OrcaStoreProductId = "9MV6GL23XM59"/)
  assert.match(setup, /WinGet do App Installer pode estar indisponível ou ter falhado/)
  assert.ok(unsupportedCheck >= 0 && unsupportedCheck < wingetInstall, 'setup deve reconhecer Orca Store não validado antes de tentar instalar outro pacote')
  assert.match(setup, /ResolveWingetExecutable\(\)/)
  assert.match(setup, /ThrowIfUnsupportedOrcaStoreVersion\(\)/)
  assert.match(runtime, /FindUnvalidatedStorePackageVersion/)
  assert.match(setup, /Instalando OrcaSlicer/)
  assert.match(setup, /ms-windows-store:\/\/pdp/)
  assert.match(setup, /OrcaSlicerService\.ResolveOfficialProfile/)
  assert.match(setup, /SliceAsync/)
  assert.match(setup, /Directory\.Move\(root, backup\)/)
  assert.match(runtime, /ResolveConfiguredExecutable/)
})

test('setup preserva a instalação anterior se upgrade ou health falhar', async () => {
  const setup = await read('windows-setup/Program.cs')

  assert.match(setup, /Directory\.Move\(root, backup\)/)
  assert.match(setup, /Directory\.Move\(backup, root\)/)
  assert.match(setup, /EnsureNoActivePrintJobs\(root, localPort\)/)
  assert.match(setup, /WaitForHealth/)
})

test('desinstalação preserva dados locais por padrão e só apaga com escolha explícita', async () => {
  const setup = await read('windows-setup/Program.cs')

  assert.match(setup, /removeUserData/)
  assert.match(setup, /args\.Contains\("--remove-user-data"/)
  assert.match(setup, /DeleteUserDataDirectories\(\)/)
  assert.match(setup, /DeleteDirectory\(Path\.Combine\(appData, "Fila Agent"\)\)/)
  assert.match(setup, /DeleteDirectory\(Path\.Combine\(appData, "PrintFlow Agent"\)\)/)
  assert.match(setup, /ShowUninstall/)
})

test('desinstalação remove apenas atalhos do Agent em pastas compartilhadas do menu Iniciar', async () => {
  const setup = await read('windows-setup/Program.cs')
  const deleteShortcuts = setup.slice(setup.indexOf('private static void DeleteShortcuts()'), setup.indexOf('private static void DeleteShortcutFile('))
  const deleteEmptyDirectory = setup.slice(setup.indexOf('private static void DeleteEmptyDirectory('), setup.indexOf('private static void DeleteDirectory('))

  assert.match(deleteShortcuts, /new\[\] \{ "PrintFlow 3D", "Filamind" \}/)
  assert.match(deleteShortcuts, /DeleteShortcutFile\(Path\.Combine\(menu, "Fila Agent\.lnk"\)\)/)
  assert.match(deleteShortcuts, /DeleteShortcutFile\(Path\.Combine\(menu, "Desinstalar Fila Agent\.lnk"\)\)/)
  assert.match(deleteShortcuts, /DeleteEmptyDirectory\(menu\)/)
  assert.doesNotMatch(deleteShortcuts, /DeleteDirectory\(/)
  assert.match(deleteEmptyDirectory, /!Directory\.EnumerateFileSystemEntries\(path\)\.Any\(\).*Directory\.Delete\(path\)/)
})

test('registro do Windows identifica Fila Agent e usa setup C# para remover', async () => {
  const setup = await read('windows-setup/Program.cs')

  assert.match(setup, /DefaultInstallRoot => Path\.Combine\(Environment\.GetFolderPath\(Environment\.SpecialFolder\.LocalApplicationData\), "FilaAgent"\)/)
  assert.match(setup, /LegacyInstallRoot => Path\.Combine\(Environment\.GetFolderPath\(Environment\.SpecialFolder\.LocalApplicationData\), "PrintFlowAgent"\)/)
  assert.match(setup, /ResolveInstallRoot\(string\[\] args\)/)
  assert.match(setup, /if \(Directory\.Exists\(DefaultInstallRoot\)\) return DefaultInstallRoot;[\s\S]*if \(Directory\.Exists\(LegacyInstallRoot\)\) return LegacyInstallRoot/)
  assert.match(setup, /DisplayName", "Fila Agent/)
  assert.match(setup, /DisplayVersion/)
  assert.match(setup, /Publisher", "Filamind/)
  assert.match(setup, /FilaAgentSetup\.exe.*--uninstall --install-dir/)
  assert.match(setup, /Uninstall\\FilaAgent/)
  assert.match(setup, /Uninstall\\PrintFlowAgent.*FilaAgent/)
  assert.match(setup, /fila-agent/)
  assert.match(setup, /printflow-agent/)
})

test('startup normal e o E2E isolado registram e removem entradas Run apropriadas', async () => {
  const setup = await read('windows-setup/Program.cs')
  const host = await read('windows-host/Program.cs')
  const protocol = await read('windows-host/NativeProtocol.cs')

  assert.match(setup, /RegisterStartupEntry\(installedHost, apiUrl, localPort\)/)
  assert.match(setup, /CurrentVersion\\Run/)
  assert.match(setup, /StartupValueName = "FilaAgent"/)
  assert.match(setup, /RemoveStartupEntry\(testMode \? GetTestStartupValueName\(taskName\) : StartupValueName\)/)
  assert.match(setup, /GetTestStartupValueName\(string taskName\)/)
  assert.match(setup, /testDataDirectory is not null\) arguments \+= .*--data-dir .*--test-mode/)
  assert.match(setup, /CreateTask\(installedHost, apiUrl, taskName, localPort, root, testMode, testDataDirectory\)/)
  assert.match(setup, /DeleteTask\(taskName\)/)
  assert.ok(setup.indexOf('WaitForHealth(installedVersion') < setup.indexOf('RegisterStartupEntry(installedHost, apiUrl, localPort)'))
  assert.match(setup, /LogonTrigger/)
  assert.match(setup, /StartWhenAvailable/)
  assert.match(setup, /DefaultTaskName = "FilaAgent"/)
  assert.match(setup, /LegacyTaskName = "PrintFlowAgent"/)
  assert.match(setup, /--legacy-task-name/)
  assert.match(setup, /legacyTaskStopped &&/)
  assert.match(setup, /new\[\] \{ DefaultTaskName, LegacyTaskName \}/)
  assert.match(protocol, /\?\? "FilaAgent"/)
  assert.doesNotMatch(setup + host, /powershell\.exe|ProcessStartInfo\([^)]*powershell/i)

  const installE2E = await read('test/windows-native-install-e2e.mjs')
  assert.match(installE2E, /HKCU\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Run/)
  assert.match(installE2E, /assertStartupEntry\('PrintFlowAgentHost\.exe'\)/)
  assert.match(installE2E, /isolated startup Run entry remains after uninstall/)
})

test('confirma sucesso somente depois de validar saúde e preservação do desinstalador', async () => {
  const setup = await read('windows-setup/Program.cs')
  const installFlow = setup.slice(setup.indexOf('private static int Install('), setup.indexOf('private static int Uninstall('))
  const uninstallerValidation = installFlow.lastIndexOf('ResolveInstalledSetup(root)')
  const healthValidation = installFlow.indexOf('WaitForHealth(installedVersion')
  const successDialog = installFlow.indexOf('Instalação concluída com sucesso!')

  assert.ok(healthValidation >= 0 && uninstallerValidation > healthValidation && successDialog > uninstallerValidation)
  assert.match(installFlow, /SHA256\.HashData\(File\.ReadAllBytes\(Environment\.ProcessPath!/)
  assert.match(installFlow, /Gerenciador de Tarefas > Aplicativos de inicialização/)
  assert.match(installFlow, /Desinstalador registrado em Aplicativos instalados/)
  assert.match(installFlow, /VerifyUninstallerRegistration\(root\)/)
  assert.match(setup, /!requirePaired \|\| \(health\.Paired && health\.CloudConnected\)/)
})

test('atualizador fixa o certificado e valida assinatura, hash, versão e health antes do sucesso', async () => {
  const updater = await read('windows-setup/SignedUpdateService.cs')
  const artifactValidator = await fs.readFile(path.join(process.cwd(), '..', 'scripts', 'validate-agent-release-artifacts.mjs'), 'utf8')
  const certificatePin = 'AC55382179B1B6FF5D7642083ED1E674DC92793FF83B55F151C0F8DA0F9C7DBB'

  assert.match(updater, new RegExp(certificatePin))
  assert.match(updater, /CryptographicOperations\.FixedTimeEquals/)
  assert.match(updater, /AuthenticodeTrust\.Verify/)
  assert.match(updater, /\.NET 8 self-contained/)
  assert.match(updater, /Fila-Agent-Setup\.exe/)
  assert.match(updater, /Fila-Agent-Dev-Certificate\.cer/)
  assert.match(updater, /PrintFlow-Agent-Setup\.exe/)
  assert.match(updater, /PrintFlow-Agent-Dev-Certificate\.cer/)
  assert.match(updater, /ValidatePackage\(updatesRoot, latest\.ToString\(\), setupName, certificateName\)/)
  const filaAssetSelection = updater.indexOf('if (assets.ContainsKey("Fila-Agent-Setup.exe")')
  const legacyAssetFallback = updater.indexOf('else if (assets.ContainsKey("PrintFlow-Agent-Setup.exe")')
  assert.ok(filaAssetSelection >= 0 && filaAssetSelection < legacyAssetFallback)
  assert.match(artifactValidator, new RegExp(certificatePin))
  const validation = updater.indexOf('ValidatePackage(updatesRoot, latest.ToString(), setupName, certificateName)')
  const launch = updater.indexOf('Process.Start(installerStartInfo)')
  const health = updater.indexOf('WaitForHealthAsync(latest.ToString(), requirePaired: true')
  const success = updater.indexOf('WriteHistory(currentVersion, latest.ToString(), "succeeded", "health_verified")')
  assert.ok(validation >= 0 && validation < launch && launch < health && health < success)
})

test('updates pedem confirmação quando iniciadas pelo cliente', async () => {
  const updater = await read('windows-setup/SignedUpdateService.cs')
  const host = await read('windows-host/Program.cs')
  const updateE2E = await read('test/windows-signed-update-e2e.mjs')

  assert.match(host, /manual \? "--interactive" : "--confirm-updates"/)
  assert.match(updater, /interactive \|\| confirmUpdates/)
  assert.match(updater, /installer_cancelled_or_closed/)
  assert.match(updater, /Deseja baixar e instalar agora\?/)
  assert.match(updater, /Baixando arquivo \{index \+ 1\} de \{required\.Length\}/)
  assert.match(updater, /Validando assinatura, certificado e arquivos baixados/)
  assert.match(updater, /Instalação concluída\. Verificando pareamento e conexão com a nuvem/)
  assert.doesNotMatch(updater, /progress\.Hide\(\)/, 'hiding the modal form would end ShowDialog before the signed update is verified')
  assert.match(updater, /Keep the modal message loop alive[\s\S]*WaitForExitAsync\(cancellationToken\)/)
  assert.match(host, /using var updateProcess = Process\.Start\(startInfo\)[\s\S]*await updateProcess\.WaitForExitAsync\(\)/)
  const setup = await read('windows-setup/Program.cs')
  assert.match(setup, /checkingUpdates = args\.Contains\("--check-updates"/)
  assert.match(setup, /if \(installing \|\| checkingUpdates\)/)
  assert.match(setup, /new SignedUpdateService\(ReadArgument\(args, "--test-release-api"\), testMode, testDataDirectory,[\s\S]*apiUrl, taskName, localPort\)/)
  assert.match(updater, /Path\.Combine\(_dataDirectory, "updates", latest\.ToString\(\)\)/)
  assert.match(updater, /Path\.Combine\(_dataDirectory, "updates", "update-history\.jsonl"\)/)
  assert.match(updater, /installerStartInfo\.ArgumentList\.Add\("--test-data-dir"\)[\s\S]*installerStartInfo\.ArgumentList\.Add\("--api-url"\)[\s\S]*installerStartInfo\.ArgumentList\.Add\("--local-port"\)[\s\S]*installerStartInfo\.ArgumentList\.Add\("--task-name"\)/)
  assert.match(updateE2E, /isolated-install-root[\s\S]*isolated-data-directory[\s\S]*loopback-agent-api-url/)
  assert.match(updateE2E, /FilaAgent-E2E-/)
  assert.match(updateE2E, /FilaAgent-E2E-data-/)
  assert.match(updateE2E, /FilaAgent_E2E_/)
  assert.match(updateE2E, /RELEASE-METADATA\.json/)
  assert.match(updateE2E, /expectedPreviousVersion/)
  assert.doesNotMatch(updateE2E, /await writeFile\(metadataPath|await writeFile\(sumsPath/)
  assert.doesNotMatch(updateE2E, /AppData', 'Roaming'\)|PrintFlowAgent'\)|17873/)
})

test('host C# executa o runtime integrado e localiza o pacote ao lado do aplicativo', async () => {
  const host = await read('windows-host/Program.cs')
  const setup = await read('windows-setup/Program.cs')
  const project = await read('windows-host/FilaAgent.csproj')

  assert.match(host, /Environment\.ProcessPath/)
  assert.match(host, /SelectMany\(GetAncestors\)/)
  assert.match(host, /File\.Exists\(Path\.Combine\(candidate, "package\.json"\)\)/)
  assert.match(host, /AgentRuntimeComposition/)
  assert.match(host, /FilaAgentSetup\.exe.*PrintFlowAgentSetup\.exe/)
  assert.doesNotMatch(host, /node\.exe|src", "index\.js|AgentProcessJob/)
  assert.match(project, /ProjectReference Include="\.\.\\windows-runtime\\FilaAgent\.Runtime\.csproj"/)
  assert.match(project, /<AssemblyName>FilaAgent<\/AssemblyName>/)
  assert.match(setup, /FilaAgent\.exe/)
  assert.match(setup, /PrintFlowAgentHost\.exe/)
  assert.match(setup, /FilaAgentSetup\.exe/)
  assert.match(setup, /PrintFlowAgentSetup\.exe/)
})

test('release tool constrói, valida, assina e publica os artefatos C# sem PowerShell', async () => {
  const tool = await read('windows-release-tool/Program.cs')
  const packageJson = JSON.parse(await read('package.json'))
  const workflow = await fs.readFile(path.join(process.cwd(), '..', '.github', 'workflows', 'agent-release.yml'), 'utf8')
  const ciWorkflow = await fs.readFile(path.join(process.cwd(), '..', '.github', 'workflows', 'ci.yml'), 'utf8')

  for (const fragment of ['--self-contained', 'FilaAgentPackagePath=', '--validate-embedded-package', 'ValidateReleaseFiles', 'ExpectedCertificateSha256', 'ExportDevCertificateAsync', 'EphemeralKeySet', 'SHA256SUMS.txt', 'RELEASE-METADATA.json', '"release", "create"']) {
    assert.ok(tool.includes(fragment), `ReleaseTool sem ${fragment}`)
  }
  assert.doesNotMatch(tool, /powershell|iexpress/i)
  assert.doesNotMatch(workflow, /shell:\s*(?:pwsh|powershell)|\.ps1|iexpress/i)
  assert.match(ciWorkflow, /on:\s*\r?\n\s+push:\s*\r?\n\s+branches:\s*\r?\n\s+- '\*\*'/)
  for (const fragment of [
    'FILA_AGENT_API_URL',
    'FILA_AGENT_MINIMUM_SUPPORTED_VERSION',
    'FILA_AGENT_DEV_CERT_PFX_BASE64',
    'FILA_AGENT_DEV_CERT_PASSWORD'
  ]) assert.ok(workflow.includes(fragment), `workflow sem ${fragment}`)
  assert.ok(ciWorkflow.includes('Fila-Agent-Setup.exe --validate-embedded-package'))
  assert.ok(workflow.includes('secrets.FILA_AGENT_DEV_CERT_PFX_BASE64 || secrets.PRINTFLOW_AGENT_DEV_CERT_PFX_BASE64'))
  assert.ok(tool.includes('Environment.GetEnvironmentVariable("FILA_AGENT_DEV_CERT_PFX_BASE64") ??'))
  assert.ok(tool.includes('Environment.GetEnvironmentVariable("PRINTFLOW_AGENT_DEV_CERT_PFX_BASE64")'))
  for (const script of ['start', 'start:tray', 'dev', 'build:windows', 'build:windows:dev-signed']) {
    assert.match(packageJson.scripts[script], /dotnet/)
    assert.doesNotMatch(packageJson.scripts[script], /powershell|\.ps1/i)
  }
  assert.match(packageJson.scripts['install:agent'], /npm run build:windows.*Fila-Agent-Setup\.exe/)
  assert.match(packageJson.scripts['uninstall:agent'], /%LOCALAPPDATA%.*FilaAgentSetup\.exe.*--uninstall/)
  assert.match(packageJson.scripts['uninstall:agent'], /if exist .*FilaAgent.*else .*PrintFlowAgent/i)
  for (const script of ['install:agent', 'uninstall:agent']) {
    assert.doesNotMatch(packageJson.scripts[script], /powershell|\.ps1/i)
  }
})

test('runtime e pacote compilado não contêm scripts PowerShell nem o runtime Node', async () => {
  const files = await fs.readdir(path.join(process.cwd(), 'scripts'))
  const legacyScripts = files.filter(name => /\.(?:ps1|psm1|vbs)$/i.test(name))
  const tool = await read('windows-release-tool/Program.cs')
  const setup = await read('windows-setup/Program.cs')

  assert.deepEqual(legacyScripts, [])
  assert.match(tool, /node\.exe/)
  assert.match(tool, /\.ps1/)
  assert.match(setup, /node\.exe/)
  assert.match(setup, /\.ps1/)
})

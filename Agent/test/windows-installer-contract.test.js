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
  assert.match(setup, /TermsVersion = "1\.3"/)
  assert.match(terms, /Versão 1\.3/)
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

  assert.match(setup, /OrcaStoreProductId = "9MV6GL23XM59"/)
  assert.match(setup, /ResolveWingetExecutable\(\)/)
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
  assert.match(setup, /DeleteDirectory\(Path\.Combine\(Environment\.GetFolderPath\(Environment\.SpecialFolder\.ApplicationData\)/)
  assert.match(setup, /ShowUninstall/)
})

test('registro do Windows identifica Fila Agent e usa setup C# para remover', async () => {
  const setup = await read('windows-setup/Program.cs')

  assert.match(setup, /DisplayName", "Fila Agent/)
  assert.match(setup, /DisplayVersion/)
  assert.match(setup, /Publisher", "Filamind/)
  assert.match(setup, /FilaAgentSetup\.exe.*--uninstall/)
  assert.match(setup, /Uninstall\\FilaAgent/)
  assert.match(setup, /Uninstall\\PrintFlowAgent.*FilaAgent/)
  assert.match(setup, /fila-agent/)
  assert.match(setup, /printflow-agent/)
})

test('startup normal fica visível no Windows e o agendamento fica restrito ao E2E isolado', async () => {
  const setup = await read('windows-setup/Program.cs')
  const host = await read('windows-host/Program.cs')
  const protocol = await read('windows-host/NativeProtocol.cs')

  assert.match(setup, /RegisterStartupEntry\(installedHost, apiUrl, localPort\)/)
  assert.match(setup, /CurrentVersion\\Run/)
  assert.match(setup, /StartupValueName = "FilaAgent"/)
  assert.match(setup, /RemoveStartupEntry\(\)/)
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
  const launch = updater.indexOf('Process.Start(new ProcessStartInfo(installer)')
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
  assert.match(updater, /progress\.Hide\(\)[\s\S]*WaitForExitAsync\(cancellationToken\)[\s\S]*progress\.Show\(\)/)
  assert.match(host, /using var updateProcess = Process\.Start\(startInfo\)[\s\S]*await updateProcess\.WaitForExitAsync\(\)/)
  assert.match(updateE2E, /HKCU\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Run/)
  assert.match(updateE2E, /persistent scheduled task must not bypass the user-controlled startup entry/)
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

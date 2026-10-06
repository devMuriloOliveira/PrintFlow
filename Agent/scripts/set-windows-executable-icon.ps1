param(
  [Parameter(Mandatory = $true)][string]$ExecutablePath,
  [Parameter(Mandatory = $true)][string]$IconPath,
  [int]$GroupResourceId = 3000,
  [int]$ResourceLanguage = 1033
)

$ErrorActionPreference = 'Stop'
$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$resolvedIcon = (Resolve-Path -LiteralPath $IconPath).Path
$iconBytes = [System.IO.File]::ReadAllBytes($resolvedIcon)

if ($GroupResourceId -lt 1 -or $GroupResourceId -gt 65535 -or $ResourceLanguage -lt 0 -or $ResourceLanguage -gt 65535) {
  throw 'Identificador de recurso do icone invalido.'
}

if ($iconBytes.Length -lt 22) {
  throw 'Arquivo ICO invalido.'
}

$reader = [System.IO.BinaryReader]::new(
  [System.IO.MemoryStream]::new($iconBytes, $false)
)

try {
  $reserved = $reader.ReadUInt16()
  $type = $reader.ReadUInt16()
  $count = $reader.ReadUInt16()
  if ($reserved -ne 0 -or $type -ne 1 -or $count -lt 1 -or $count -gt 64) {
    throw 'Cabecalho ICO invalido.'
  }

  $entries = @()
  for ($index = 0; $index -lt $count; $index += 1) {
    $entry = [ordered]@{
      Width = $reader.ReadByte()
      Height = $reader.ReadByte()
      ColorCount = $reader.ReadByte()
      Reserved = $reader.ReadByte()
      Planes = $reader.ReadUInt16()
      BitCount = $reader.ReadUInt16()
      Size = $reader.ReadUInt32()
      Offset = $reader.ReadUInt32()
    }
    if ($entry.Size -lt 1 -or ([uint64]$entry.Offset + [uint64]$entry.Size) -gt [uint64]$iconBytes.Length) {
      throw 'Entrada ICO fora dos limites do arquivo.'
    }
    $entries += [pscustomobject]$entry
  }
} finally {
  $reader.Dispose()
}

if (-not ('PrintFlow.Windows.ResourceUpdater' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

namespace PrintFlow.Windows {
  public static class ResourceUpdater {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr BeginUpdateResourceW(string fileName, bool deleteExistingResources);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool UpdateResourceW(IntPtr update, IntPtr type, IntPtr name, ushort language, byte[] data, uint size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool EndUpdateResourceW(IntPtr update, bool discard);

    public static IntPtr Begin(string fileName) {
      var handle = BeginUpdateResourceW(fileName, false);
      if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
      return handle;
    }

    public static void Set(IntPtr handle, int type, int name, int language, byte[] data) {
      if (!UpdateResourceW(handle, new IntPtr(type), new IntPtr(name), (ushort)language, data, (uint)data.Length)) {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
    }

    public static void End(IntPtr handle, bool discard) {
      if (!EndUpdateResourceW(handle, discard)) throw new Win32Exception(Marshal.GetLastWin32Error());
    }
  }
}
'@
}

$groupStream = [System.IO.MemoryStream]::new()
$groupWriter = [System.IO.BinaryWriter]::new($groupStream)
$groupWriter.Write([uint16]0)
$groupWriter.Write([uint16]1)
$groupWriter.Write([uint16]$entries.Count)

for ($index = 0; $index -lt $entries.Count; $index += 1) {
  $entry = $entries[$index]
  $groupWriter.Write([byte]$entry.Width)
  $groupWriter.Write([byte]$entry.Height)
  $groupWriter.Write([byte]$entry.ColorCount)
  $groupWriter.Write([byte]$entry.Reserved)
  $groupWriter.Write([uint16]$entry.Planes)
  $groupWriter.Write([uint16]$entry.BitCount)
  $groupWriter.Write([uint32]$entry.Size)
  $groupWriter.Write([uint16]($index + 1))
}
$groupWriter.Flush()
$groupBytes = $groupStream.ToArray()
$groupWriter.Dispose()
$groupStream.Dispose()

$updateHandle = [PrintFlow.Windows.ResourceUpdater]::Begin($resolvedExecutable)
$completed = $false
try {
  for ($index = 0; $index -lt $entries.Count; $index += 1) {
    $entry = $entries[$index]
    $image = [byte[]]::new([int]$entry.Size)
    [Array]::Copy($iconBytes, [int]$entry.Offset, $image, 0, [int]$entry.Size)
    [PrintFlow.Windows.ResourceUpdater]::Set($updateHandle, 3, ($index + 1), $ResourceLanguage, $image)
  }
  [PrintFlow.Windows.ResourceUpdater]::Set($updateHandle, 14, $GroupResourceId, $ResourceLanguage, $groupBytes)
  [PrintFlow.Windows.ResourceUpdater]::End($updateHandle, $false)
  $completed = $true
} finally {
  if (-not $completed) {
    try { [PrintFlow.Windows.ResourceUpdater]::End($updateHandle, $true) } catch {}
  }
}

Write-Host "Icone aplicado ao executavel: $resolvedExecutable"

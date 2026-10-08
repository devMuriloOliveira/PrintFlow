using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;

namespace FilaAgent.Runtime;

public sealed record OrcaModelBounds(double[] Min, double[] Max, double[] Size);
public sealed record OrcaModelAnalysis(string Path, long Bytes, string Format, string Encoding, long TriangleCount, OrcaModelBounds Bounds, int? Entries = null);
public sealed record OrcaGcodeMetrics(double? EstimatedPrintSeconds, double? EstimatedFilamentGrams, double? EstimatedFilamentMillimeters);

public static class OrcaModelAnalyzer
{
    private const long MaxModelBytes = 200L * 1024 * 1024;
    private static readonly Regex AsciiVertex = new(@"\bvertex\s+([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:e[-+]?\d+)?)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled, TimeSpan.FromSeconds(3));

    public static async Task<OrcaModelAnalysis> AnalyzeAsync(string inputPath, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(inputPath)) throw new ArgumentException("inputPath e obrigatorio.", nameof(inputPath));
        var path = Path.GetFullPath(inputPath.Trim());
        var info = new FileInfo(path);
        if (!info.Exists) throw new FileNotFoundException("Modelo de entrada nao encontrado.", path);
        if (info.Length <= 0 || info.Length > MaxModelBytes) throw new InvalidDataException("Tamanho de modelo invalido.");

        var bytes = await File.ReadAllBytesAsync(path, cancellationToken);
        var extension = Path.GetExtension(path);
        if (extension.Equals(".stl", StringComparison.OrdinalIgnoreCase))
        {
            var result = ParseBinaryStl(bytes) ?? ParseAsciiStl(bytes);
            if (result is { } parsed) return new OrcaModelAnalysis(path, bytes.LongLength, "stl", parsed.Encoding, parsed.TriangleCount, parsed.Bounds);
        }
        else if (extension.Equals(".3mf", StringComparison.OrdinalIgnoreCase) && HasZipSignature(bytes))
        {
            return await ParseThreeMfAsync(path, bytes, cancellationToken);
        }

        throw new InvalidDataException("Formato de modelo nao suportado ou invalido.");
    }

    private static (string Encoding, long TriangleCount, OrcaModelBounds Bounds)? ParseBinaryStl(byte[] bytes)
    {
        if (bytes.Length < 84) return null;
        var triangles = System.Buffers.Binary.BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(80, 4));
        if (triangles < 1 || 84UL + (ulong)triangles * 50UL != (ulong)bytes.Length) return null;

        var bounds = new BoundsBuilder();
        for (var triangle = 0; triangle < triangles; triangle++)
        {
            var facet = checked(84 + (int)triangle * 50);
            for (var vertex = 0; vertex < 3; vertex++)
            {
                var start = facet + 12 + vertex * 12;
                var x = System.Buffers.Binary.BinaryPrimitives.ReadSingleLittleEndian(bytes.AsSpan(start, 4));
                var y = System.Buffers.Binary.BinaryPrimitives.ReadSingleLittleEndian(bytes.AsSpan(start + 4, 4));
                var z = System.Buffers.Binary.BinaryPrimitives.ReadSingleLittleEndian(bytes.AsSpan(start + 8, 4));
                bounds.Add(x, y, z);
            }
        }
        return ("binary", triangles, bounds.Build());
    }

    private static (string Encoding, long TriangleCount, OrcaModelBounds Bounds)? ParseAsciiStl(byte[] bytes)
    {
        var text = Encoding.UTF8.GetString(bytes);
        if (!Regex.IsMatch(text, @"^\s*solid\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, TimeSpan.FromSeconds(3))) return null;
        var bounds = new BoundsBuilder();
        long vertices = 0;
        foreach (Match match in AsciiVertex.Matches(text))
        {
            if (!TryReadCoordinate(match.Groups[1].Value, out var x) || !TryReadCoordinate(match.Groups[2].Value, out var y) || !TryReadCoordinate(match.Groups[3].Value, out var z))
                return null;
            bounds.Add(x, y, z);
            vertices++;
        }
        if (vertices == 0 || vertices % 3 != 0) return null;
        return ("ascii", vertices / 3, bounds.Build());
    }

    private static async Task<OrcaModelAnalysis> ParseThreeMfAsync(string path, byte[] bytes, CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream(bytes, writable: false);
        using var archive = new ZipArchive(buffer, ZipArchiveMode.Read);
        if (!archive.Entries.Any(entry => entry.FullName == "[Content_Types].xml") ||
            !archive.Entries.Any(entry => entry.FullName == "3D/3dmodel.model"))
            throw new InvalidDataException("Arquivo 3MF sem entradas de modelo obrigatorias.");

        var model = archive.GetEntry("3D/3dmodel.model") ?? throw new InvalidDataException("Entrada de modelo 3MF ausente.");
        var settings = new XmlReaderSettings
        {
            Async = true,
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null,
            MaxCharactersInDocument = MaxModelBytes
        };
        var bounds = new BoundsBuilder();
        long triangles = 0;
        await using var modelStream = model.Open();
        using var reader = XmlReader.Create(modelStream, settings);
        while (await reader.ReadAsync())
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (reader.NodeType != XmlNodeType.Element) continue;
            if (reader.LocalName.Equals("triangle", StringComparison.OrdinalIgnoreCase))
            {
                triangles++;
                continue;
            }
            if (!reader.LocalName.Equals("vertex", StringComparison.OrdinalIgnoreCase)) continue;

            var xText = reader.GetAttribute("x");
            var yText = reader.GetAttribute("y");
            var zText = reader.GetAttribute("z");
            if (TryReadCoordinate(xText, out var x) && TryReadCoordinate(yText, out var y) && TryReadCoordinate(zText, out var z))
                bounds.Add(x, y, z);
        }

        if (triangles == 0 || bounds.Count == 0) throw new InvalidDataException("Modelo 3MF sem geometria valida.");
        return new OrcaModelAnalysis(path, bytes.LongLength, "3mf", "zip", triangles, bounds.Build(), archive.Entries.Count);
    }

    private static bool HasZipSignature(byte[] bytes) => bytes.Length >= 4 &&
        System.Buffers.Binary.BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(0, 4)) == 0x04034b50;

    private static bool TryReadCoordinate(string? value, out double coordinate) =>
        double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out coordinate) && double.IsFinite(coordinate);

    private sealed class BoundsBuilder
    {
        private readonly double[] _min = [double.PositiveInfinity, double.PositiveInfinity, double.PositiveInfinity];
        private readonly double[] _max = [double.NegativeInfinity, double.NegativeInfinity, double.NegativeInfinity];
        public long Count { get; private set; }

        public void Add(double x, double y, double z)
        {
            UpdateAxis(0, x);
            UpdateAxis(1, y);
            UpdateAxis(2, z);
            Count++;
        }

        private void UpdateAxis(int axis, double value)
        {
            if (!double.IsFinite(value)) throw new InvalidDataException("Modelo contem coordenada nao finita.");
            _min[axis] = Math.Min(_min[axis], value);
            _max[axis] = Math.Max(_max[axis], value);
        }

        public OrcaModelBounds Build()
        {
            if (Count == 0) throw new InvalidDataException("Modelo sem vertices validos.");
            return new OrcaModelBounds((double[])_min.Clone(), (double[])_max.Clone(), _max.Zip(_min, (max, min) => max - min).ToArray());
        }
    }
}

public static class OrcaGcodeMetricsReader
{
    private static readonly Regex DurationLine = new(@";\s*estimated printing time[^=]*=\s*([^\r\n]+)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled, TimeSpan.FromSeconds(3));
    private static readonly Regex TotalEstimatedDuration = new(@";\s*total estimated time\s*:\s*([^\r\n;]+)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled, TimeSpan.FromSeconds(3));
    private static readonly Regex ModelPrintingDuration = new(@";\s*model printing time\s*:\s*([^\r\n;]+)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled, TimeSpan.FromSeconds(3));
    private static readonly Regex DurationParts = new(@"^\s*(?:(\d+)d)?\s*(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?\s*$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled, TimeSpan.FromSeconds(3));
    private static readonly Regex FilamentGrams = new(@";\s*total filament used\s*\[g\]\s*=\s*([\d.,]+)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled, TimeSpan.FromSeconds(3));
    private static readonly Regex FilamentMillimeters = new(@";\s*filament used\s*\[mm\]\s*=\s*([\d.,]+)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled, TimeSpan.FromSeconds(3));

    public static OrcaGcodeMetrics Parse(string? text)
    {
        var source = text ?? string.Empty;
        var durationMatch = TotalEstimatedDuration.Match(source);
        if (!durationMatch.Success) durationMatch = DurationLine.Match(source);
        if (!durationMatch.Success) durationMatch = ModelPrintingDuration.Match(source);
        double? seconds = null;
        if (durationMatch.Success)
        {
            var parts = DurationParts.Match(durationMatch.Groups[1].Value);
            if (parts.Success && parts.Groups.Cast<Group>().Skip(1).Any(group => group.Success))
            {
                seconds = DurationPart(parts.Groups[1]) * 86400 + DurationPart(parts.Groups[2]) * 3600 +
                    DurationPart(parts.Groups[3]) * 60 + DurationPart(parts.Groups[4]);
            }
        }
        return new OrcaGcodeMetrics(seconds, NumberAfter(FilamentGrams, source), NumberAfter(FilamentMillimeters, source));
    }

    public static async Task<OrcaGcodeMetrics> ReadAsync(string inputPath, CancellationToken cancellationToken = default)
    {
        if (!Path.GetFileName(inputPath).EndsWith(".gcode.3mf", StringComparison.OrdinalIgnoreCase))
            return Parse(await File.ReadAllTextAsync(inputPath, cancellationToken));

        await using var file = new FileStream(inputPath, FileMode.Open, FileAccess.Read, FileShare.Read, 128 * 1024,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        using var archive = new ZipArchive(file, ZipArchiveMode.Read, leaveOpen: false);
        var gcode = archive.Entries
            .Where(entry => entry.FullName.StartsWith("Metadata/plate_", StringComparison.OrdinalIgnoreCase) &&
                entry.FullName.EndsWith(".gcode", StringComparison.OrdinalIgnoreCase))
            .OrderBy(entry => entry.FullName, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault();
        if (gcode is null) throw new InvalidDataException("Artefato gcode.3mf nao contem G-code de placa.");
        await using var stream = gcode.Open();
        using var reader = new StreamReader(stream);
        return Parse(await reader.ReadToEndAsync(cancellationToken));
    }

    private static double? NumberAfter(Regex pattern, string source)
    {
        var match = pattern.Match(source);
        return match.Success ? Number(match.Groups[1].Value.Replace(',', '.')) : null;
    }

    private static double? Number(string value) =>
        double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var result) && double.IsFinite(result) ? result : null;

    private static double DurationPart(Group group) =>
        group.Success && double.TryParse(group.Value, NumberStyles.None, CultureInfo.InvariantCulture, out var value) ? value : 0;
}

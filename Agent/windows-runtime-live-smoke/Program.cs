using FilaAgent.Runtime;

const string TestModel = """
solid FilaAgentSmoke
  facet normal 0 0 -1
    outer loop
      vertex 0 0 0
      vertex 0 20 0
      vertex 20 0 0
    endloop
  endfacet
  facet normal 0 -1 0
    outer loop
      vertex 0 0 0
      vertex 20 0 0
      vertex 0 0 20
    endloop
  endfacet
  facet normal -1 0 0
    outer loop
      vertex 0 0 0
      vertex 0 0 20
      vertex 0 20 0
    endloop
  endfacet
  facet normal 1 1 1
    outer loop
      vertex 20 0 0
      vertex 0 20 0
      vertex 0 0 20
    endloop
  endfacet
endsolid FilaAgentSmoke
""";

var environment = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
var executable = OrcaSlicerService.ResolveConfiguredExecutable(environment);
if (string.IsNullOrWhiteSpace(executable) || !File.Exists(executable))
{
    Console.Error.WriteLine("OrcaSlicer Store validado nao foi localizado neste contexto do Windows; nenhum processo foi iniciado.");
    return 2;
}

var root = Directory.CreateTempSubdirectory("fila-agent-orca-store-smoke-");
try
{
    var modelPath = Path.Combine(root.FullName, "modelo-tetraedro.stl");
    var outputPath = Path.Combine(root.FullName, "modelo-tetraedro.gcode.3mf");
    await File.WriteAllTextAsync(modelPath, TestModel);

    var result = await new OrcaSlicerService().SliceModelAsync(executable, modelPath, outputPath,
        "Bambu Lab", "P1S", timeout: TimeSpan.FromMinutes(5), exportGcode3mf: true);

    if (!File.Exists(outputPath) || new FileInfo(outputPath).Length == 0 || result.Artifact.Format != "gcode")
        throw new InvalidDataException("OrcaSlicer nao produziu o pacote de G-code esperado.");

    Console.WriteLine("PASS: OrcaSlicer instalado produziu pacote .gcode.3mf local.");
    Console.WriteLine($"Executable: {executable}");
    Console.WriteLine($"Profile: {result.Profile.Id} v{result.Profile.Version}");
    Console.WriteLine($"SHA-256: {result.Artifact.Sha256}");
    Console.WriteLine($"Bytes: {result.Artifact.SizeBytes}");
    Console.WriteLine($"Estimated seconds: {result.Metrics.EstimatedPrintSeconds?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "unavailable"}");
    return 0;
}
finally
{
    root.Delete(recursive: true);
}

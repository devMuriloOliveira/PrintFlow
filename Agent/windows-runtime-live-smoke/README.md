# OrcaSlicer live smoke test

Run `dotnet run --project Agent/windows-runtime-live-smoke/FilaAgent.OrcaStore.LiveSmoke.csproj -c Release -- <orca-slicer.exe>` to test a specific OrcaSlicer executable on Windows. Without a path, the helper uses an installation accepted by the Agent resolver.

The helper creates a synthetic tetrahedron STL in the system temporary directory, runs the C# slicing path for a Bambu P1S, checks the generated `.gcode.3mf`, prints its hash and removes the temporary directory. It does not call the API, upload files, connect to a printer, or alter the Agent installation. Exit code 2 means no OrcaSlicer executable was visible to the current Windows context.

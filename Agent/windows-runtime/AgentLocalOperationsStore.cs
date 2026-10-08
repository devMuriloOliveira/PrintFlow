using System.Data;
using System.Globalization;
using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace FilaAgent.Runtime;

public sealed record AgentCommand(string Id, string Type);
public sealed record CommandStartResult(string Status, JsonElement? Result = null);
public sealed record PendingCompletion(string CommandId, JsonElement Result, string CreatedAt, int Attempts, string? LastError);
public sealed record PendingEvent(long Id, string EventType, JsonElement Payload, string CreatedAt, int Attempts, string Status, string? NextRetryAt, string? LastError, string UpdatedAt);
public sealed record DeadLetterAgentEvent(long Id, string EventType, JsonElement Payload, string CreatedAt, int Attempts, string? LastError, string UpdatedAt);
public sealed record PendingProductionMetric(long Id, string PrintJobId, string IdempotencyKey, JsonElement Payload, string CreatedAt, int Attempts, string? NextRetryAt, string? LastError);
public sealed record AgentProductionJobMonitor(string PrintJobId, string CommandId, AgentPrinterDescriptor Printer, DateTimeOffset StartedAt);
public sealed record PendingCounts(int Completions, int Events, int Metrics, int Total);

public sealed class AgentLocalOperationsStore : IDisposable
{
    public const int CurrentSchemaVersion = 8;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly object _gate = new();
    private readonly SqliteConnection _database;
    private bool _disposed;

    public AgentLocalOperationsStore(string databasePath)
    {
        DatabasePath = Path.GetFullPath(databasePath);
        Directory.CreateDirectory(Path.GetDirectoryName(DatabasePath)!);
        _database = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = DatabasePath, Mode = SqliteOpenMode.ReadWriteCreate }.ToString());
        _database.Open();
        Execute("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
        SchemaVersion = MigrateSchema();
    }

    public string DatabasePath { get; }
    public int SchemaVersion { get; }

    public CommandStartResult Begin(AgentCommand command)
    {
        var commandId = RequiredCommandId(command.Id);
        lock (_gate)
        {
            ThrowIfDisposed();
            using var query = CreateCommand("SELECT state, result_json FROM processed_commands WHERE command_id=$id LIMIT 1;");
            query.Parameters.AddWithValue("$id", commandId);
            using var reader = query.ExecuteReader();
            if (reader.Read())
            {
                if (reader.GetString(0) == "completed") return new CommandStartResult("completed", ParseJson(reader.IsDBNull(1) ? "{}" : reader.GetString(1)));
                return new CommandStartResult("processing");
            }
            reader.Close();
            using var insert = CreateCommand("INSERT INTO processed_commands(command_id, command_type, state, created_at) VALUES($id,$type,'processing',$created);");
            insert.Parameters.AddWithValue("$id", commandId);
            insert.Parameters.AddWithValue("$type", string.IsNullOrWhiteSpace(command.Type) ? "unknown" : command.Type);
            insert.Parameters.AddWithValue("$created", UtcNow());
            insert.ExecuteNonQuery();
            return new CommandStartResult("new");
        }
    }

    public void RecordResult(string commandId, object? result, string? commandType = null)
    {
        var id = RequiredCommandId(commandId);
        var serialized = JsonSerializer.Serialize(result ?? new { }, JsonOptions);
        var completedAt = UtcNow();
        lock (_gate)
        {
            ThrowIfDisposed();
            using var transaction = _database.BeginTransaction(IsolationLevel.Serializable, deferred: false);
            try
            {
                using var update = CreateCommand("UPDATE processed_commands SET state='completed', result_json=$result, completed_at=$completed WHERE command_id=$id AND state='processing';", transaction);
                update.Parameters.AddWithValue("$result", serialized);
                update.Parameters.AddWithValue("$completed", completedAt);
                update.Parameters.AddWithValue("$id", id);
                if (update.ExecuteNonQuery() != 1) throw new InvalidOperationException("Comando local nao estava em processamento.");

                using var completion = CreateCommand("INSERT INTO command_completions(command_id,result_json,created_at) VALUES($id,$result,$created) ON CONFLICT(command_id) DO UPDATE SET result_json=excluded.result_json;", transaction);
                completion.Parameters.AddWithValue("$id", id);
                completion.Parameters.AddWithValue("$result", serialized);
                completion.Parameters.AddWithValue("$created", completedAt);
                completion.ExecuteNonQuery();

                if (!string.IsNullOrWhiteSpace(commandType))
                {
                    using var eventInsert = CreateCommand("INSERT INTO agent_events(event_type,payload_json,created_at,updated_at) VALUES('command.completed',$payload,$created,$created);", transaction);
                    eventInsert.Parameters.AddWithValue("$payload", JsonSerializer.Serialize(BuildCommandCompletedEvent(id, commandType, serialized), JsonOptions));
                    eventInsert.Parameters.AddWithValue("$created", completedAt);
                    eventInsert.ExecuteNonQuery();
                }
                transaction.Commit();
            }
            catch { transaction.Rollback(); throw; }
        }
    }

    public void QueueCompletion(string commandId, object? result)
    {
        lock (_gate)
        {
            ThrowIfDisposed();
            using var command = CreateCommand("INSERT INTO command_completions(command_id,result_json,created_at) VALUES($id,$result,$created) ON CONFLICT(command_id) DO UPDATE SET result_json=excluded.result_json;");
            command.Parameters.AddWithValue("$id", RequiredCommandId(commandId));
            command.Parameters.AddWithValue("$result", JsonSerializer.Serialize(result ?? new { }, JsonOptions));
            command.Parameters.AddWithValue("$created", UtcNow());
            command.ExecuteNonQuery();
        }
    }

    public int RecoverInterruptedCommands()
    {
        List<(string Id, string Type)> interrupted = [];
        lock (_gate)
        {
            ThrowIfDisposed();
            using var command = CreateCommand("SELECT command_id, command_type FROM processed_commands WHERE state='processing' ORDER BY created_at ASC;");
            using var reader = command.ExecuteReader();
            while (reader.Read()) interrupted.Add((reader.GetString(0), reader.GetString(1)));
        }
        foreach (var item in interrupted)
            RecordResult(item.Id, new { success = false, error = "Comando interrompido por reinicio do Fila Agent. A execucao nao foi repetida por seguranca.", code = "agent_restarted", commandType = item.Type });
        return interrupted.Count;
    }

    public long QueueEvent(string eventType, object? payload = null)
    {
        var type = eventType.Trim();
        if (type.Length == 0) throw new ArgumentException("Tipo de evento local obrigatorio.", nameof(eventType));
        lock (_gate)
        {
            ThrowIfDisposed();
            var timestamp = UtcNow();
            using var command = CreateCommand("INSERT INTO agent_events(event_type,payload_json,created_at,updated_at) VALUES($type,$payload,$created,$updated);");
            command.Parameters.AddWithValue("$type", type);
            command.Parameters.AddWithValue("$payload", JsonSerializer.Serialize(payload ?? new { }, JsonOptions));
            command.Parameters.AddWithValue("$created", timestamp);
            command.Parameters.AddWithValue("$updated", timestamp);
            command.ExecuteNonQuery();
            return Convert.ToInt64(Scalar("SELECT last_insert_rowid();"), CultureInfo.InvariantCulture);
        }
    }

    public IReadOnlyList<PendingEvent> ListPendingEvents(int limit = 20, DateTimeOffset? asOf = null)
    {
        lock (_gate)
        {
            ThrowIfDisposed();
            using var command = CreateCommand("SELECT id,event_type,payload_json,created_at,attempts,status,next_retry_at,last_error,updated_at FROM agent_events WHERE status IN ('pending','retrying') AND (next_retry_at IS NULL OR next_retry_at<=$asOf) ORDER BY id ASC LIMIT $limit;");
            command.Parameters.AddWithValue("$asOf", asOf is null ? UtcNow() : FormatUtc(asOf.Value));
            command.Parameters.AddWithValue("$limit", SafeLimit(limit, 20, 100));
            using var reader = command.ExecuteReader();
            var rows = new List<PendingEvent>();
            while (reader.Read()) rows.Add(new PendingEvent(reader.GetInt64(0), reader.GetString(1), ParseJson(reader.GetString(2)), reader.GetString(3), reader.GetInt32(4), reader.GetString(5), NullableString(reader, 6), NullableString(reader, 7), reader.IsDBNull(8) ? reader.GetString(3) : reader.GetString(8)));
            return rows;
        }
    }

    public void MarkEventAttempted(long eventId, DateTimeOffset? nextRetryAt = null, string error = "") =>
        ExecuteBound("UPDATE agent_events SET attempts=attempts+1,status='retrying',next_retry_at=$retry,last_error=$error,updated_at=$updated WHERE id=$id;",
            ("$retry", nextRetryAt is null ? DBNull.Value : FormatUtc(nextRetryAt.Value)), ("$error", error[..Math.Min(500, error.Length)]), ("$updated", UtcNow()), ("$id", eventId));

    public void DeadLetterEvent(long eventId, string error) =>
        ExecuteBound("UPDATE agent_events SET attempts=attempts+1,status='dead_letter',next_retry_at=NULL,last_error=$error,updated_at=$updated WHERE id=$id;",
            ("$error", error[..Math.Min(500, error.Length)]), ("$updated", UtcNow()), ("$id", eventId));

    public void AcknowledgeEvent(long eventId) => ExecuteBound("DELETE FROM agent_events WHERE id=$id;", ("$id", eventId));

    public int GetDeadLetterEventCount()
    {
        lock (_gate)
        {
            ThrowIfDisposed();
            using var command = CreateCommand("SELECT COUNT(*) FROM agent_events WHERE status='dead_letter';");
            return Convert.ToInt32(command.ExecuteScalar(), CultureInfo.InvariantCulture);
        }
    }

    public IReadOnlyList<DeadLetterAgentEvent> ListDeadLetterEvents(int limit = 20)
    {
        lock (_gate)
        {
            ThrowIfDisposed();
            using var command = CreateCommand("SELECT id,event_type,payload_json,created_at,attempts,last_error,updated_at FROM agent_events WHERE status='dead_letter' ORDER BY updated_at DESC LIMIT $limit;");
            command.Parameters.AddWithValue("$limit", SafeLimit(limit, 20, 100));
            using var reader = command.ExecuteReader();
            var rows = new List<DeadLetterAgentEvent>();
            while (reader.Read()) rows.Add(new DeadLetterAgentEvent(reader.GetInt64(0), reader.GetString(1), ParseJson(reader.GetString(2)), reader.GetString(3), reader.GetInt32(4), NullableString(reader, 5), reader.GetString(6)));
            return rows;
        }
    }

    public void QueueProductionJobMonitor(AgentProductionJobMonitor monitor)
    {
        ArgumentNullException.ThrowIfNull(monitor);
        var jobId = RequiredCommandId(monitor.PrintJobId);
        var commandId = RequiredCommandId(monitor.CommandId);
        var printer = JsonSerializer.Serialize(monitor.Printer, JsonOptions);
        var startedAt = FormatUtc(monitor.StartedAt);
        lock (_gate)
        {
            ThrowIfDisposed();
            using var command = CreateCommand("INSERT INTO production_job_monitors(print_job_id,command_id,printer_json,started_at,created_at) VALUES($job,$command,$printer,$started,$created) ON CONFLICT(print_job_id) DO UPDATE SET command_id=excluded.command_id,printer_json=excluded.printer_json,started_at=excluded.started_at;");
            command.Parameters.AddWithValue("$job", jobId);
            command.Parameters.AddWithValue("$command", commandId);
            command.Parameters.AddWithValue("$printer", printer);
            command.Parameters.AddWithValue("$started", startedAt);
            command.Parameters.AddWithValue("$created", UtcNow());
            command.ExecuteNonQuery();
        }
    }

    public IReadOnlyList<AgentProductionJobMonitor> ListPendingProductionJobMonitors()
    {
        lock (_gate)
        {
            ThrowIfDisposed();
            using var command = CreateCommand("SELECT print_job_id,command_id,printer_json,started_at FROM production_job_monitors ORDER BY created_at ASC;");
            using var reader = command.ExecuteReader();
            var rows = new List<AgentProductionJobMonitor>();
            while (reader.Read())
            {
                var printer = JsonSerializer.Deserialize<AgentPrinterDescriptor>(reader.GetString(2), JsonOptions)
                    ?? throw new InvalidDataException("Impressora do monitor local de Production Job invalida.");
                rows.Add(new AgentProductionJobMonitor(reader.GetString(0), reader.GetString(1), printer,
                    DateTimeOffset.Parse(reader.GetString(3), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal)));
            }
            return rows;
        }
    }

    public void AcknowledgeProductionJobMonitor(string printJobId) =>
        ExecuteBound("DELETE FROM production_job_monitors WHERE print_job_id=$job;", ("$job", RequiredCommandId(printJobId)));

    public long QueueProductionMetric(string printJobId, object payload)
    {
        var jobId = RequiredCommandId(printJobId);
        var serialized = JsonSerializer.Serialize(payload ?? new { }, JsonOptions);
        using var document = JsonDocument.Parse(serialized);
        if (!document.RootElement.TryGetProperty("idempotencyKey", out var keyValue) ||
            keyValue.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(keyValue.GetString()))
            throw new ArgumentException("Metrica de Production Job precisa de idempotencyKey.", nameof(payload));
        var key = keyValue.GetString()!.Trim();
        lock (_gate)
        {
            ThrowIfDisposed();
            using var command = CreateCommand("INSERT INTO production_metrics(print_job_id,idempotency_key,payload_json,created_at) VALUES($job,$key,$payload,$created) ON CONFLICT(idempotency_key) DO UPDATE SET payload_json=excluded.payload_json;");
            command.Parameters.AddWithValue("$job", jobId);
            command.Parameters.AddWithValue("$key", key);
            command.Parameters.AddWithValue("$payload", serialized);
            command.Parameters.AddWithValue("$created", UtcNow());
            command.ExecuteNonQuery();
            using var query = CreateCommand("SELECT id FROM production_metrics WHERE idempotency_key=$key LIMIT 1;");
            query.Parameters.AddWithValue("$key", key);
            return Convert.ToInt64(query.ExecuteScalar(), CultureInfo.InvariantCulture);
        }
    }

    public IReadOnlyList<PendingProductionMetric> ListPendingProductionMetrics(int limit = 20, DateTimeOffset? asOf = null)
    {
        lock (_gate)
        {
            ThrowIfDisposed();
            using var command = CreateCommand("SELECT id,print_job_id,idempotency_key,payload_json,created_at,attempts,next_retry_at,last_error FROM production_metrics WHERE status='pending' AND (next_retry_at IS NULL OR next_retry_at<=$asOf) ORDER BY id ASC LIMIT $limit;");
            command.Parameters.AddWithValue("$asOf", asOf is null ? UtcNow() : FormatUtc(asOf.Value));
            command.Parameters.AddWithValue("$limit", SafeLimit(limit, 20, 100));
            using var reader = command.ExecuteReader();
            var rows = new List<PendingProductionMetric>();
            while (reader.Read()) rows.Add(new PendingProductionMetric(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), ParseJson(reader.GetString(3)), reader.GetString(4), reader.GetInt32(5), NullableString(reader, 6), NullableString(reader, 7)));
            return rows;
        }
    }

    public void RetryProductionMetric(long metricId, DateTimeOffset? nextRetryAt, string error) =>
        ExecuteBound("UPDATE production_metrics SET attempts=attempts+1,next_retry_at=$retry,last_error=$error WHERE id=$id AND status='pending';",
            ("$retry", nextRetryAt is null ? DBNull.Value : FormatUtc(nextRetryAt.Value)), ("$error", error[..Math.Min(500, error.Length)]), ("$id", metricId));

    public void DeadLetterProductionMetric(long metricId, string error) =>
        ExecuteBound("UPDATE production_metrics SET attempts=attempts+1,status='dead_letter',next_retry_at=NULL,last_error=$error WHERE id=$id;",
            ("$error", error[..Math.Min(500, error.Length)]), ("$id", metricId));

    public void AcknowledgeProductionMetric(long metricId) => ExecuteBound("DELETE FROM production_metrics WHERE id=$id;", ("$id", metricId));

    public int GetDeadLetterProductionMetricCount()
    {
        lock (_gate)
        {
            ThrowIfDisposed();
            using var command = CreateCommand("SELECT COUNT(*) FROM production_metrics WHERE status='dead_letter';");
            return Convert.ToInt32(command.ExecuteScalar(), CultureInfo.InvariantCulture);
        }
    }

    public IReadOnlyList<PendingProductionMetric> ListDeadLetterProductionMetrics(int limit = 20)
    {
        lock (_gate)
        {
            ThrowIfDisposed();
            using var command = CreateCommand("SELECT id,print_job_id,idempotency_key,payload_json,created_at,attempts,next_retry_at,last_error FROM production_metrics WHERE status='dead_letter' ORDER BY id DESC LIMIT $limit;");
            command.Parameters.AddWithValue("$limit", SafeLimit(limit, 20, 100));
            using var reader = command.ExecuteReader();
            var rows = new List<PendingProductionMetric>();
            while (reader.Read()) rows.Add(new PendingProductionMetric(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), ParseJson(reader.GetString(3)), reader.GetString(4), reader.GetInt32(5), NullableString(reader, 6), NullableString(reader, 7)));
            return rows;
        }
    }

    public IReadOnlyList<PendingCompletion> ListPendingCompletions(int limit = 20, DateTimeOffset? asOf = null)
    {
        lock (_gate)
        {
            ThrowIfDisposed();
            using var command = CreateCommand("SELECT command_id,result_json,created_at,attempts,last_error FROM command_completions WHERE next_retry_at IS NULL OR next_retry_at<=$asOf ORDER BY created_at ASC LIMIT $limit;");
            command.Parameters.AddWithValue("$asOf", asOf is null ? UtcNow() : FormatUtc(asOf.Value));
            command.Parameters.AddWithValue("$limit", SafeLimit(limit, 20, 100));
            using var reader = command.ExecuteReader();
            var rows = new List<PendingCompletion>();
            while (reader.Read()) rows.Add(new PendingCompletion(reader.GetString(0), ParseJson(reader.GetString(1)), reader.GetString(2), reader.GetInt32(3), NullableString(reader, 4)));
            return rows;
        }
    }

    public void RetryCompletion(string commandId, DateTimeOffset? nextRetryAt = null, string error = "") =>
        ExecuteBound("UPDATE command_completions SET attempts=attempts+1,next_retry_at=$retry,last_error=$error WHERE command_id=$id;",
            ("$retry", nextRetryAt is null ? DBNull.Value : FormatUtc(nextRetryAt.Value)), ("$error", error[..Math.Min(500, error.Length)]), ("$id", RequiredCommandId(commandId)));

    public void AcknowledgeCompletion(string commandId) => ExecuteBound("DELETE FROM command_completions WHERE command_id=$id;", ("$id", RequiredCommandId(commandId)));

    public PendingCounts GetPendingCounts()
    {
        lock (_gate)
        {
            ThrowIfDisposed();
            using var command = CreateCommand("SELECT (SELECT COUNT(*) FROM command_completions),(SELECT COUNT(*) FROM agent_events WHERE status IN ('pending','retrying')),(SELECT COUNT(*) FROM production_metrics WHERE status='pending');");
            using var reader = command.ExecuteReader();
            reader.Read();
            var completions = reader.GetInt32(0);
            var events = reader.GetInt32(1);
            var metrics = reader.GetInt32(2);
            return new PendingCounts(completions, events, metrics, completions + events + metrics);
        }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed) return;
            _disposed = true;
            _database.Dispose();
        }
    }

    private int MigrateSchema()
    {
        var current = Convert.ToInt32(Scalar("PRAGMA user_version;"), CultureInfo.InvariantCulture);
        if (current > CurrentSchemaVersion) throw new InvalidOperationException("Banco local do Agent foi criado por uma versao mais recente.");
        using var transaction = _database.BeginTransaction(IsolationLevel.Serializable, deferred: false);
        try
        {
            Execute("""
                CREATE TABLE IF NOT EXISTS processed_commands(command_id TEXT PRIMARY KEY, command_type TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('processing','completed')), result_json TEXT, created_at TEXT NOT NULL, completed_at TEXT);
                CREATE TABLE IF NOT EXISTS command_completions(command_id TEXT PRIMARY KEY, result_json TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS agent_events(id INTEGER PRIMARY KEY AUTOINCREMENT,event_type TEXT NOT NULL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS local_states(entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,state_json TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(entity_type,entity_id));
                CREATE TABLE IF NOT EXISTS production_metrics(id INTEGER PRIMARY KEY AUTOINCREMENT,print_job_id TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,payload_json TEXT NOT NULL,created_at TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS production_job_monitors(print_job_id TEXT PRIMARY KEY,command_id TEXT NOT NULL,printer_json TEXT NOT NULL,started_at TEXT NOT NULL,created_at TEXT NOT NULL);
                """, transaction);
            EnsureColumn("agent_events", "attempts", "INTEGER NOT NULL DEFAULT 0", transaction);
            EnsureColumn("agent_events", "status", "TEXT NOT NULL DEFAULT 'pending'", transaction);
            EnsureColumn("agent_events", "next_retry_at", "TEXT", transaction);
            EnsureColumn("agent_events", "last_error", "TEXT", transaction);
            EnsureColumn("agent_events", "updated_at", "TEXT", transaction);
            EnsureColumn("command_completions", "attempts", "INTEGER NOT NULL DEFAULT 0", transaction);
            EnsureColumn("command_completions", "next_retry_at", "TEXT", transaction);
            EnsureColumn("command_completions", "last_error", "TEXT", transaction);
            EnsureColumn("production_metrics", "next_retry_at", "TEXT", transaction);
            EnsureColumn("production_metrics", "last_error", "TEXT", transaction);
            EnsureColumn("production_metrics", "status", "TEXT NOT NULL DEFAULT 'pending'", transaction);
            Execute("""
                UPDATE agent_events SET status=coalesce(status,'pending'),updated_at=coalesce(updated_at,created_at);
                UPDATE production_metrics SET status=coalesce(status,'pending');
                CREATE INDEX IF NOT EXISTS command_completions_created_idx ON command_completions(created_at);
                CREATE INDEX IF NOT EXISTS processed_commands_completed_idx ON processed_commands(completed_at) WHERE state='completed';
                CREATE INDEX IF NOT EXISTS agent_events_created_idx ON agent_events(created_at);
                CREATE INDEX IF NOT EXISTS agent_events_retry_idx ON agent_events(status,next_retry_at,id);
                CREATE INDEX IF NOT EXISTS production_metrics_created_idx ON production_metrics(created_at);
                CREATE INDEX IF NOT EXISTS production_metrics_retry_idx ON production_metrics(status,next_retry_at,id);
                PRAGMA user_version=8;
                """, transaction);
            transaction.Commit();
            return CurrentSchemaVersion;
        }
        catch { transaction.Rollback(); throw; }
    }

    private void EnsureColumn(string table, string column, string declaration, SqliteTransaction transaction)
    {
        using var query = CreateCommand($"PRAGMA table_info({table});", transaction);
        using var reader = query.ExecuteReader();
        while (reader.Read()) if (reader.GetString(1).Equals(column, StringComparison.OrdinalIgnoreCase)) return;
        reader.Close();
        Execute($"ALTER TABLE {table} ADD COLUMN {column} {declaration};", transaction);
    }

    private void ExecuteBound(string sql, params (string Name, object Value)[] parameters)
    {
        lock (_gate)
        {
            ThrowIfDisposed();
            using var command = CreateCommand(sql);
            foreach (var (name, value) in parameters) command.Parameters.AddWithValue(name, value);
            command.ExecuteNonQuery();
        }
    }

    private SqliteCommand CreateCommand(string sql, SqliteTransaction? transaction = null)
    {
        var command = _database.CreateCommand();
        command.CommandText = sql;
        command.Transaction = transaction;
        return command;
    }

    private void Execute(string sql, SqliteTransaction? transaction = null)
    {
        using var command = CreateCommand(sql, transaction);
        command.ExecuteNonQuery();
    }

    private object? Scalar(string sql)
    {
        using var command = CreateCommand(sql);
        return command.ExecuteScalar();
    }

    private static JsonElement ParseJson(string value)
    {
        try { using var document = JsonDocument.Parse(string.IsNullOrWhiteSpace(value) ? "{}" : value); return document.RootElement.Clone(); }
        catch (JsonException) { using var document = JsonDocument.Parse("{\"success\":false,\"error\":\"Resultado local de comando invalido.\"}"); return document.RootElement.Clone(); }
    }

    private static object BuildCommandCompletedEvent(string commandId, string commandType, string serializedResult)
    {
        using var document = JsonDocument.Parse(serializedResult);
        var result = document.RootElement;
        var success = !TryGetProperty(result, "success", out var successValue) || successValue.ValueKind != JsonValueKind.False;
        string? status = null;
        if (TryGetProperty(result, "status", out var statusValue))
            status = statusValue.ValueKind == JsonValueKind.Object && TryGetProperty(statusValue, "state", out var stateValue)
                ? stateValue.ValueKind == JsonValueKind.String ? stateValue.GetString() : null
                : statusValue.ValueKind == JsonValueKind.String ? statusValue.GetString() : null;
        if (status is null && TryGetProperty(result, "result", out var nestedResult) &&
            TryGetProperty(nestedResult, "status", out var nestedStatus) && nestedStatus.ValueKind == JsonValueKind.String)
            status = nestedStatus.GetString();
        return new { commandId, commandType = string.IsNullOrWhiteSpace(commandType) ? "unknown" : commandType, success, status };
    }

    private static bool TryGetProperty(JsonElement element, string name, out JsonElement value)
    {
        if (element.ValueKind == JsonValueKind.Object)
            foreach (var property in element.EnumerateObject())
                if (property.Name.Equals(name, StringComparison.OrdinalIgnoreCase))
                {
                    value = property.Value;
                    return true;
                }
        value = default;
        return false;
    }

    private static string? NullableString(SqliteDataReader reader, int index) => reader.IsDBNull(index) ? null : reader.GetString(index);
    private static string RequiredCommandId(string? value) => string.IsNullOrWhiteSpace(value) ? throw new ArgumentException("command_id local obrigatorio.") : value.Trim();
    private static int SafeLimit(int value, int fallback, int max) => Math.Clamp(value == 0 ? fallback : value, 1, max);
    private static string UtcNow() => DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
    private static string FormatUtc(DateTimeOffset value) => value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
    private void ThrowIfDisposed() { if (_disposed) throw new ObjectDisposedException(nameof(AgentLocalOperationsStore)); }
}

package sql

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"
)

// --- ParseConnectionString benchmarks ---

func BenchmarkParseConnectionString_SID(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ParseConnectionString("scott/tiger@localhost:1521/orcl")
	}
}

func BenchmarkParseConnectionString_ServiceName(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ParseConnectionString("scott/tiger@//localhost:1521/orcl.example.com")
	}
}

func BenchmarkParseConnectionString_Complex(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ParseConnectionString("scott/p@ss/w0rd@db.example.com:1530/PROD")
	}
}

// --- ConnectionConfig benchmarks ---

func BenchmarkConnectionConfig_Validate(b *testing.B) {
	cfg := ConnectionConfig{
		Host:     "localhost",
		Port:     1521,
		SID:      "orcl",
		Username: "scott",
		Password: "tiger",
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		cfg.Validate()
	}
}

func BenchmarkConnectionConfig_ConnectionString_SID(b *testing.B) {
	cfg := ConnectionConfig{
		Host:     "localhost",
		Port:     1521,
		SID:      "orcl",
		Username: "scott",
		Password: "tiger",
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		cfg.ConnectionString()
	}
}

func BenchmarkConnectionConfig_ConnectionString_Service(b *testing.B) {
	cfg := ConnectionConfig{
		Host:           "localhost",
		Port:           1521,
		ServiceName:    "orcl.example.com",
		UseServiceName: true,
		Username:       "scott",
		Password:       "tiger",
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		cfg.ConnectionString()
	}
}

// --- OracleErrorCode benchmarks ---

func BenchmarkOracleErrorCode_Known(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		OracleErrorCode(1017)
	}
}

func BenchmarkOracleErrorCode_Unknown(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		OracleErrorCode(99999)
	}
}

func BenchmarkFormatError(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		FormatError(1017, "logon denied")
	}
}

func BenchmarkIsOracleErrorCode(b *testing.B) {
	err := errors.New("ORA-01017: logon denied (invalid username/password)")
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		IsOracleErrorCode(err, 1017)
	}
}

// --- JSON serialization benchmarks ---

func BenchmarkQueryResult_ToJSON(b *testing.B) {
	qr := &QueryResult{
		Columns:  []ColumnDef{{Name: "id", Type: "NUMBER"}, {Name: "name", Type: "VARCHAR2"}},
		Rows:     []map[string]any{{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}},
		RowCount: 2,
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		qr.ToJSON()
	}
}

func BenchmarkQueryResult_ToJSON_Large(b *testing.B) {
	rows := make([]map[string]any, 100)
	for j := 0; j < 100; j++ {
		rows[j] = map[string]any{"id": j, "name": fmt.Sprintf("user_%d", j), "email": fmt.Sprintf("user%d@example.com", j)}
	}
	qr := &QueryResult{
		Columns:  []ColumnDef{{Name: "id", Type: "NUMBER"}, {Name: "name", Type: "VARCHAR2"}, {Name: "email", Type: "VARCHAR2"}},
		Rows:     rows,
		RowCount: 100,
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		qr.ToJSON()
	}
}

func BenchmarkTestConnectionResult_ToJSON(b *testing.B) {
	tcr := &TestConnectionResult{
		Success:       true,
		OracleVersion: "19.0",
		InstanceName:  "orcl",
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		tcr.ToJSON()
	}
}

// --- QueryResult JSON marshal benchmark ---

func BenchmarkJSONMarshal_QueryResult(b *testing.B) {
	qr := QueryResult{
		Columns:  []ColumnDef{{Name: "id", Type: "NUMBER"}, {Name: "name", Type: "VARCHAR2"}},
		Rows:     []map[string]any{{"id": 1, "name": "Alice"}},
		RowCount: 1,
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		json.Marshal(qr)
	}
}

// --- ParameterizedQuery benchmarks ---

func BenchmarkParseParameterizedQuery_Simple(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ParseParameterizedQuery("SELECT * FROM users WHERE id = :userId")
	}
}

func BenchmarkParseParameterizedQuery_Multiple(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ParseParameterizedQuery("SELECT * FROM users WHERE id = :userId AND name = :userName AND email = :email")
	}
}

func BenchmarkBindParams_Single(b *testing.B) {
	pq := ParseParameterizedQuery("SELECT * FROM users WHERE id = :userId")
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		pq.BindParams(map[string]any{"userId": 42})
	}
}

func BenchmarkBindParams_Multiple(b *testing.B) {
	pq := ParseParameterizedQuery("SELECT * FROM t WHERE a = :p1 AND b = :p2 AND c = :p3")
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		pq.BindParams(map[string]any{"p1": 1, "p2": "test", "p3": true})
	}
}

func BenchmarkEscapeParamValue_String(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		escapeParamValue("hello world")
	}
}

func BenchmarkEscapeParamValue_StringWithQuote(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		escapeParamValue("it's a test")
	}
}

func BenchmarkEscapeParamValue_Int(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		escapeParamValue(42)
	}
}

func BenchmarkEscapeParamValue_Time(b *testing.B) {
	t := time.Date(2024, 1, 15, 10, 30, 0, 0, time.UTC)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		escapeParamValue(t)
	}
}

// --- Pool benchmarks ---

func BenchmarkPool_Acquire(b *testing.B) {
	cfg := DefaultPoolConfig()
	cfg.MaxConnections = 100
	executor := NewOracleExecutor(30 * time.Second)
	p := NewPool(cfg, executor)

	connCfg := ConnectionConfig{
		Host:     "localhost",
		Port:     1521,
		SID:      "orcl",
		Username: "scott",
		Password: "tiger",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		conn, err := p.Acquire(context.Background(), connCfg)
		if err != nil {
			b.Fatal(err)
		}
		p.Release(conn)
	}
}

func BenchmarkPool_Release(b *testing.B) {
	cfg := DefaultPoolConfig()
	cfg.MaxConnections = 100
	executor := NewOracleExecutor(30 * time.Second)
	p := NewPool(cfg, executor)

	connCfg := ConnectionConfig{
		Host:     "localhost",
		Port:     1521,
		SID:      "orcl",
		Username: "scott",
		Password: "tiger",
	}

	// Pre-acquire connections
	conns := make([]*PoolConnection, b.N)
	for i := 0; i < b.N; i++ {
		conn, _ := p.Acquire(context.Background(), connCfg)
		conns[i] = conn
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		p.Release(conns[i])
	}
}

func BenchmarkPool_Stats(b *testing.B) {
	cfg := DefaultPoolConfig()
	cfg.MaxConnections = 10
	executor := NewOracleExecutor(30 * time.Second)
	p := NewPool(cfg, executor)

	connCfg := ConnectionConfig{
		Host:     "localhost",
		Port:     1521,
		SID:      "orcl",
		Username: "scott",
		Password: "tiger",
	}
	conn, _ := p.Acquire(context.Background(), connCfg)
	_ = conn

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		p.Stats()
	}
}

// --- StreamingResultSet benchmarks ---

func BenchmarkStreamingResultSet_Next(b *testing.B) {
	columns := []ColumnDef{{Name: "id", Type: "NUMBER"}, {Name: "name", Type: "VARCHAR2"}}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		rowChan := make(chan map[string]any, 100)
		errChan := make(chan error, 1)
		for j := 0; j < 100; j++ {
			rowChan <- map[string]any{"id": j, "name": fmt.Sprintf("user_%d", j)}
		}
		close(rowChan)
		srs := NewStreamingResultSet(columns, rowChan, errChan, 100)
		for {
			row, _ := srs.Next()
			if row == nil {
				break
			}
		}
	}
}

func BenchmarkStreamingResultSet_CollectAll(b *testing.B) {
	columns := []ColumnDef{{Name: "id", Type: "NUMBER"}, {Name: "name", Type: "VARCHAR2"}}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		rowChan := make(chan map[string]any, 100)
		errChan := make(chan error, 1)
		for j := 0; j < 100; j++ {
			rowChan <- map[string]any{"id": j, "name": fmt.Sprintf("user_%d", j)}
		}
		close(rowChan)
		srs := NewStreamingResultSet(columns, rowChan, errChan, 100)
		srs.CollectAll()
	}
}

// --- NewOracleExecutor benchmark ---

func BenchmarkNewOracleExecutor(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		NewOracleExecutor(30 * time.Second)
	}
}

// --- DefaultPoolConfig benchmark ---

func BenchmarkDefaultPoolConfig(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		DefaultPoolConfig()
	}
}
package sql

import (
	"fmt"
	"strings"
	"time"
)

// GO-P2-5: string-escape BindParams is quarantined to tests only.
// Production execute paths must use PrepareNamed + driver binds.

func (pq *ParameterizedQuery) BindParams(params map[string]any) (string, error) {
	result := pq.SQL
	for name, value := range params {
		placeholder := ":" + name
		altPlaceholder := "@" + name

		escaped, err := escapeParamValue(value)
		if err != nil {
			return "", fmt.Errorf("parameter %q: %w", name, err)
		}
		if strings.Contains(result, placeholder) {
			result = strings.ReplaceAll(result, placeholder, escaped)
		} else if strings.Contains(result, altPlaceholder) {
			result = strings.ReplaceAll(result, altPlaceholder, escaped)
		} else {
			return "", fmt.Errorf("parameter %q not found in query", name)
		}
	}
	return result, nil
}

func escapeParamValue(value any) (string, error) {
	if err := validateParamValue(value); err != nil {
		return "", err
	}
	if value == nil {
		return "NULL", nil
	}
	switch v := value.(type) {
	case int, int8, int16, int32, int64:
		return fmt.Sprintf("%d", v), nil
	case uint, uint8, uint16, uint32, uint64:
		return fmt.Sprintf("%d", v), nil
	case float32, float64:
		return fmt.Sprintf("%v", v), nil
	case bool:
		if v {
			return "1", nil
		}
		return "0", nil
	case string:
		return "'" + escapeOracleString(v) + "'", nil
	case []byte:
		return "'" + escapeOracleString(string(v)) + "'", nil
	case time.Time:
		return fmt.Sprintf("TO_DATE('%s', 'YYYY-MM-DD HH24:MI:SS')", v.UTC().Format("2006-01-02 15:04:05")), nil
	default:
		return "", fmt.Errorf("unsupported parameter type %T; use PrepareNamed with a driver bind", value)
	}
}

func escapeOracleString(s string) string {
	return strings.ReplaceAll(s, "'", "''")
}

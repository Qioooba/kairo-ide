# Kairo IDE Source Audit & Regression Evidence Package

This directory contains the audit evidence, reference guards, behavioral models, and reproducibility artifacts for:
`docs/Kairo_vs_Lithe_Source_Audit_and_Refactoring_Plan_2026-09-12.md`

## Structure

```text
kairo-audit/
  README.md
  implementation-backlog.json
  source-manifest.json
  LICENSE-APACHE-2.0.txt
  ATTRIBUTION.md
  regression/
    go.mod
    guards.go
    guards_test.go
    path-session.test.cjs
    verify_javac_target.py
  evidence/
    go-isolated-tests.txt
    node-model-tests.txt
    javac-target-experiment.txt
```

## Running Verification

```bash
# 1. Run isolated Go guard tests
cd regression
go test -count=1 -v ./...

# 2. Run Node path & session model tests
node --test path-session.test.cjs

# 3. Run javac target gate experiment
python verify_javac_target.py
```

package catalinabase

import (
	"fmt"
	"os"
)

type DefaultPreparer struct{}

func NewDefaultPreparer() *DefaultPreparer {
	return &DefaultPreparer{}
}

func (p *DefaultPreparer) Prepare(plan *Plan) error {
	if plan == nil {
		return fmt.Errorf("plan is nil")
	}

	if err := VerifyOwner(plan.Layout.BaseDir, plan.Owner); err != nil {
		return fmt.Errorf("verify owner: %w", err)
	}

	for _, dir := range plan.Layout.RequiredDirs() {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("create directory %s: %w", dir, err)
		}
	}

	if err := WriteOwner(plan.Layout.BaseDir, plan.Owner); err != nil {
		return fmt.Errorf("write owner: %w", err)
	}

	return nil
}

func SafeRemove(baseDir string, expected OwnerMetadata) error {
	if err := VerifyOwner(baseDir, expected); err != nil {
		return fmt.Errorf("refusing to clean: %w", err)
	}
	return os.RemoveAll(baseDir)
}

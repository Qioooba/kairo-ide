import re

with open(r'G:\spaces\kairo-ide\packages\project-extension\src\browser\import-wizard-widget.tsx', encoding='utf-8') as f:
    content = f.read()

old = """    const handleSelectDirectory = React.useCallback(async () => {
        try {
            const dialog = await fileDialogService.showOpenDialog({
                title: t('widget.importWizard.selectDirectory'),
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
            });
            if (!dialog) {
                return;
            }
            const path = String(dialog.path);
            setWorkspacePath(path);
            await scanPath(path);
"""

new = """    const handleSelectDirectory = React.useCallback(async () => {
        try {
            const dialog = await fileDialogService.showOpenDialog({
                title: t('widget.importWizard.selectDirectory'),
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
            });
            if (!dialog) {
                return;
            }
            // Theia FileDialogService returns URI.path which includes a leading slash
            // on Windows (e.g. "/G:/my-project"). Strip it so the path is a clean
            // "G:/my-project" that works correctly with the backend.
            let path = String(dialog.path);
            if (/^\\/[A-Za-z]:/.test(path)) {
                path = path.slice(1);
            }
            setWorkspacePath(path);
            await scanPath(path);
"""

if old not in content:
    print("NOT FOUND - trying with tabs/spaces...")
    # Try to find the function by looking for the signature
    idx = content.find("const handleSelectDirectory = React.useCallback")
    if idx == -1:
        print("Function not found at all")
    else:
        print(f"Function found at index {idx}")
        snippet = content[idx:idx+500]
        print(repr(snippet))
else:
    content = content.replace(old, new, 1)
    with open(r'G:\spaces\kairo-ide\packages\project-extension\src\browser\import-wizard-widget.tsx', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Done")

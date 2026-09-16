path = r'G:\spaces\kairo-ide\runtime-agent\internal\tomcat6\tomcat6.go'
with open(path, encoding='utf-8') as f:
    lines = f.readlines()

# Lines 160-231 (0-indexed 159-230) need to be removed
# They are duplicate content after the BuildCommand function
# The function properly ends at line 159 (0-indexed 158) with }

# Find func buildEnv
build_env_line = -1
for i in range(155, len(lines)):
    if 'func buildEnv' in lines[i]:
        build_env_line = i
        break

print(f'func buildEnv at line {build_env_line+1}')

# The last line of BuildCommand function is at line 158 (0-indexed)
# Lines between 159 (next line after }) and build_env_line-1 need removal
keep_until = 159  # keep lines 0-158 (BuildCommand ends with } on line 158)
remove_start = 159  # 0-indexed
remove_end = build_env_line  # exclude func buildEnv and everything before it

new_lines = lines[:keep_until] + lines[remove_end:]
with open(path, 'w', encoding='utf-8', newline='\n') as f:
    f.writelines(new_lines)

print(f'Removed lines {remove_start+1}-{remove_end} (total {len(lines)} -> {len(new_lines)})')

"""Scan only files selected for the public Git snapshot; never print secret values."""
from pathlib import Path
import re, subprocess, sys
root=Path(__file__).resolve().parents[1]
files=subprocess.check_output(['git','ls-files','-z','--cached','--others','--exclude-standard'],cwd=root).decode().split('\0')
checks={
 'private key':r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
 'GitHub credential':r'\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{25,})\b',
 'AWS credential':r'\bAKIA[0-9A-Z]{16}\b',
 'embedded credential URL':r'(?i)(?:postgres(?:ql)?|https?)://[^/\s:@]+:[^/\s@]+@',
 'owner service address':r'(?:neon\.tech|neon\.build|neon\.run|neonstorage\.org)',
 'previous repository':r'github\.com/hungrymidlife/video_downloader',
 'personal Windows path':r'(?i)[A-Z]:[\\/]Users[\\/](?!Public\b)[^\s"<>]+'
}
fail=[]; count=0
for rel in sorted(set(files)):
 if not rel:continue
 p=root/rel;count+=1
 if p.suffix.lower() in {'.exe','.dll','.db','.sqlite','.pem','.pfx','.key'} or (p.name.startswith('.env') and p.name!='.env.example'):
  fail.append((rel,'sensitive filename'))
 if rel.startswith('third-party/licenses/'):continue # upstream copyright notices, not project configuration
 try:data=p.read_text(encoding='utf-8')
 except (UnicodeDecodeError,IsADirectoryError):continue
 if rel=='scripts/audit-public-source.py':continue
 for label,pattern in checks.items():
  if re.search(pattern,data):fail.append((rel,label))
for rel,label in fail:print(f'{rel}: {label}')
print(f'Public snapshot: {count} files; {len(fail)} findings. Values are suppressed.')
sys.exit(bool(fail))

"""Removes CSS rules whose selectors only use classes that no source file, locale
or test references any more. Run after deleting UI components:

    python3 scripts/prune-dead-css.py

The dead-class list comes from scripts/dead-css-classes.txt (one class per line),
produced by the runtime census (Playwright over every route, dialog, drawer and
theme, collecting classList) minus a static scan of src/, locales/, tests/ and
scripts/. Kept rules are emitted verbatim, so formatting survives; media blocks
whose bodies change are rebuilt by the same walker. Unreferenced @keyframes are
dropped afterwards."""
import re, pathlib
dead=set(open(str(pathlib.Path(__file__).with_name('dead-css-classes.txt'))).read().split())
CLASS=re.compile(r'\.([A-Za-z][\w-]*)')

def split_top(s):
    """Comma split that treats /* comments */ and strings as atomic."""
    out=[]; buf=''; depth=0; q=None; i=0; n=len(s)
    while i<n:
        if s.startswith('/*', i):
            e=s.index('*/', i+2)
            buf+=s[i:e+2]; i=e+2; continue
        c=s[i]
        if q:
            buf+=c
            if c=='\\' and i+1<n: buf+=s[i+1]; i+=2; continue
            if c==q: q=None
            i+=1; continue
        if c in '"\'': q=c; buf+=c; i+=1; continue
        if c=='(': depth+=1
        elif c==')': depth-=1
        elif depth==0 and c==',':
            out.append(buf.strip()); buf=''
            i+=1; continue
        buf+=c; i+=1
    if buf.strip(): out.append(buf.strip())
    return out

def selector_dead(sel):
    # strip comments, then look at class tokens
    stripped=re.sub(r'/\*.*?\*/','', sel, flags=re.S)
    toks=[m.group(1) for m in CLASS.finditer(stripped)]
    if not toks: return False
    return all(t in dead for t in toks)

def process(text, i, end, stats):
    out=[]; buf=''
    while i<end:
        if text.startswith('/*', i):
            e=text.index('*/', i+2)+2
            buf+=text[i:e]; i=e; continue
        c=text[i]
        if c==';':
            if buf.strip(): out.append(buf.strip()+';')
            buf=''
            i+=1; continue
        if c=='{':
            body_start=i+1
            j=body_start; d=1
            while j<end and d>0:
                if text.startswith('/*', j):
                    j=text.index('*/', j+2)+2; continue
                ch=text[j]
                if ch in '"\'':
                    k=j+1
                    while k<end:
                        if text[k]=='\\' and k+1<end: k+=2; continue
                        if text[k]==ch: break
                        k+=1
                    j=k+1; continue
                if ch=='{': d+=1
                elif ch=='}': d-=1
                j+=1
            body=text[body_start:j-1]
            sel=buf.strip(); buf=''
            if sel.startswith('@'):
                prelude=sel[1:].strip()
                name=prelude.split(None,1)[0].lower() if prelude else ''
                if name in ('media','supports','layer','container'):
                    inner=process(text, body_start, j-1, stats)
                    if inner.strip():
                        # keep the author's spacing between the brace and the first rule
                        original=body
                        lead=original[:len(original)-len(original.lstrip())]
                        out.append('@'+prelude+' {'+lead+inner+'\n}')
                    else: stats['dropped']+=1
                elif name=='keyframes':
                    kfname=prelude.split(None,1)[1].strip() if len(prelude.split(None,1))>1 else 'anon'
                    out.append('\x00KF:'+kfname+'\x00')
                    stats.setdefault('kf', []).append((kfname, body))
                else:
                    out.append('@'+prelude+' {'+body+'}\n')
            else:
                stats['rules']+=1
                frags=split_top(sel)
                live=[f for f in frags if not selector_dead(f)]
                if len(live)==len(frags):
                    out.append(sel+' {'+body+'}\n')   # everything kept: keep the author's formatting
                elif live: out.append(',\n'.join(live)+' {'+body+'}\n')
                else: stats['dropped']+=1
            i=j; continue
        buf+=c; i+=1
    if buf.strip(): out.append(buf.strip())
    return '\n'.join(out)

targets=['app.css','annotation-fixes.css','model-run.css','board.css','onboarding.css','liquid.css']
base=pathlib.Path(__file__).resolve().parents[1] / 'src' / 'styles'
for name in targets:
    p=base/name
    before=p.read_text()
    stats={'rules':0,'dropped':0,'kf':[]}
    after=process(before, 0, len(before), stats)
    # keyframes: reinsert only those whose name is still animated somewhere
    def repl(m):
        for kfname, body in stats['kf']:
            if kfname==m.group(1):
                rest=after.replace(m.group(0),'',1)
                if re.search(r'animation(?:-name)?\s*:[^;]*\b'+re.escape(kfname)+r'\b', rest.replace(m.group(0),'',1)):
                    return '@keyframes '+kfname+' {'+body+'}\n'
                return ''
        return m.group(0)
    # iterate placeholders one at a time
    while True:
        m=re.search(r'\x00KF:([\w-]+)\x00', after)
        if not m: break
        after=after[:m.start()]+repl(m)+after[m.end():]
    ok=after.count('{')==after.count('}')
    rem=len(set(m.group(1) for m in re.finditer(r'\.([A-Za-z][\w-]*)', after) if m.group(1) in dead))
    assert not re.search(r'^media\b', after, re.M), 'lost @'
    p.write_text(after)
    print(f'{name}: rules {stats["rules"]} dropped {stats["dropped"]} | bytes {len(before)}->{len(after)} | balance={ok} | dead left={rem}')

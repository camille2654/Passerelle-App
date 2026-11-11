"""Bounded PRONOTE-only cookie state; no ENT cookie or password is persisted."""
import time

def load_cookies(requests, values, hostname):
    if not isinstance(values, list) or len(values)>200:
        raise ValueError('INVALID_COOKIE')
    jar=requests.cookies.RequestsCookieJar()
    now=int(time.time())
    for value in values:
        domain=str(value.get('domain','')).lstrip('.').lower()
        name,content=value.get('name'),value.get('value')
        path=value.get('path','/')
        if domain not in (hostname,'index-education.net') or not isinstance(name,str) or not isinstance(content,str) or not name or len(name)>256 or len(content)>8192 or not isinstance(path,str) or not path.startswith('/') or len(path)>500:
            raise ValueError('INVALID_COOKIE')
        expires=value.get('expires')
        # Browser session cookies get a bounded client lifetime; the server still
        # decides whether its session is valid at every request.
        expires=int(expires) if isinstance(expires,(int,float)) and expires>0 else now+12*3600
        if expires<=now:
            continue
        jar.set(name,content,domain=value.get('domain'),path=path,secure=True,expires=expires)
    return jar

def export_cookies(jar,hostname):
    now=int(time.time());values=[]
    for cookie in jar:
        if cookie.domain.lstrip('.').lower() not in (hostname,'index-education.net'):
            continue
        expiry=cookie.expires or now+12*3600
        if expiry<=now:
            continue
        values.append({'name':cookie.name,'value':cookie.value,'domain':cookie.domain,'path':cookie.path,'expires':expiry})
    if len(values)>200:
        raise ValueError('INVALID_COOKIE')
    return values

def bootstrap_attributes(value):
    if not isinstance(value,dict):
        return None
    allowed={'h','a','e','f','CrA','CoA','sCrA','sCoA','http','d'}
    clean={key:item for key,item in value.items() if key in allowed and isinstance(item,(str,int,float,bool))}
    if str(clean.get('a'))!='3' or not str(clean.get('h','')).isdigit() or not all(isinstance(clean.get(key),str) and 0<len(clean[key])<=20000 for key in ('e','f')):
        raise ValueError('INVALID_ENT')
    return clean

# Native mobile selector used by installed pronotepy 2.15.7 / Client.qrcode_login.
# This public application identifier is not a credential and grants no data access.
MOBILE_QUERY='fd=1&bydlg=A6ABB224-12DD-4E31-AD3E-8A39A1C2C335&login=true'
def mobile_url(parsed):
    return parsed._replace(path='/pronote/mobile.eleve.html',query=MOBILE_QUERY,fragment='').geturl()

"""Offline protocol handoff contract; no real ENT/PRONOTE account is used."""
import importlib.util
import sys
import types
import time
import unittest
from pathlib import Path
from unittest.mock import patch
import requests

spec=importlib.util.spec_from_file_location('passerelle_private_worker',Path(__file__).resolve().parents[1]/'src/pronote-worker.py')
worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)

class Handoff(unittest.TestCase):
    def test_bootstrap_and_cookie_survive_mobile_reconnect_without_losing_username(self):
        output,calls=[],[]
        raw_url='https://demo.index-education.net/pronote/eleve.html'
        html='<script>Start({"h":1,"a":3,"e":"ent-user","f":"one-time-secret","extra":{"nested":true}})</script>'
        class Communication:
            def _parse_html(self,html): raise AssertionError('Current JSON should be parsed safely')
        class Client:
            def __init__(self,pronote_url,username,password,ent=None,mode='normal',uuid='',**_options):
                self.pronote_url,self.username,self.password,self.uuid=pronote_url,username,password,uuid
                self.ent=ent;self.client_identifier='synthetic-client';self.logged_in=True
                self.info=types.SimpleNamespace(id='student',name='Élève synthétique',class_name='Classe',establishment='Lycée test');self.periods=[]
                self.attributes={}
                if ent:
                    calls.append(('ent',mode));jar=ent(username,password,pronote_url=pronote_url)
                    assert jar.get('session')=='synthetic-cookie'
                    response=requests.Session().request('GET',pronote_url)
                    assert response.text==html
                    self.attributes=Communication()._parse_html(response.text)
                    self.post('Identification');self.post('Authentification')
            def post(self,name,*args,**kwargs):return {'dataSec':{'data':{'cle':'synthetic-key','jetonConnexionAppliMobile':'synthetic-mobile-token'}}}
            def export_credentials(self):return dict(pronote_url=self.pronote_url,username=self.username,password=self.password,uuid=self.uuid,client_identifier=self.client_identifier)
            @classmethod
            def token_login(cls,**values):
                assert values['username']=='ent-user';assert values['password']=='synthetic-mobile-token'
                assert values['pronote_url']=='https://demo.index-education.net/pronote/mobile.eleve.html?fd=1&bydlg=A6ABB224-12DD-4E31-AD3E-8A39A1C2C335&login=true'
                assert 'pronote_cookies' not in values
                calls.append(('token',True));client=cls(**values)
                response=requests.Session().request('GET',values['pronote_url'],cookies=None)
                client.attributes=Communication()._parse_html(response.text)
                client.post('Identification');client.post('Authentification');return client
            def homework(self,*_):return []
            def lessons(self,*_):return []
        def synthetic_network(_session,method,url,**kwargs):
            assert url=='https://demo.index-education.net/pronote/mobile.eleve.html?fd=1&bydlg=A6ABB224-12DD-4E31-AD3E-8A39A1C2C335&login=true'
            assert kwargs['allow_redirects'] is False
            # This server requires its PRONOTE cookie even for a token bootstrap.
            assert kwargs['cookies'].get('session')=='synthetic-cookie'
            # Native mobile has space 6; the captured browser student space is 3.
            response=requests.Response();response.status_code=200;response.url=url;response._content=b'<script>Start({"h":2,"a":6,"CrA":true})</script>';response._content_consumed=True;response.encoding='utf-8'
            response.cookies.set('session','synthetic-rotated-cookie',domain='demo.index-education.net',path='/',secure=True)
            return response
        fake=types.SimpleNamespace(Client=Client,ClientBase=Client)
        payload={'mode':'ent','uuid':'synthetic-device','today':'2026-11-08','ent':{'url':raw_url,'html':html,'attributes':{'h':1,'a':3,'e':'ent-user','f':'one-time-secret'},'cookies':[dict(name='session',value='synthetic-cookie',domain='demo.index-education.net',path='/')]}}
        original_request=requests.Session.request
        try:
            with patch.dict(sys.modules,{'pronotepy':fake,'pronotepy.pronoteAPI':types.SimpleNamespace(_Communication=Communication)}),patch.object(worker,'emit',lambda kind,**value:output.append((kind,value))),patch.object(requests.Session,'request',synthetic_network):worker.main(payload)
        finally:requests.Session.request=original_request
        self.assertEqual(calls,[('ent','qr_code'),('token',True)])
        credentials=[value['credentials'] for kind,value in output if kind=='credentials'];self.assertGreaterEqual(len(credentials),3)
        for value in credentials:
            self.assertEqual(value['username'],'ent-user');self.assertNotIn('one-time-secret',str(value));self.assertNotIn('html',value);self.assertNotIn('attributes',value)
            self.assertEqual(value['pronote_cookies'][0]['domain'],'demo.index-education.net')
        self.assertEqual(credentials[-1]['pronote_cookies'][0]['value'],'synthetic-rotated-cookie');self.assertGreater(credentials[-1]['pronote_cookies'][0]['expires'],time.time())
        self.assertEqual(output[-1][0],'snapshot');self.assertEqual(output[-1][1]['snapshot']['sections']['courses']['state'],'available')

    def test_cookie_scope_expiry_and_bootstrap_role_are_bounded(self):
        host='demo.index-education.net';base={'name':'session','value':'synthetic','domain':host,'path':'/'}
        for domain in ['cas.ent.auvergnerhonealpes.fr','evil.invalid','other.index-education.net','net']:
            with self.assertRaises(ValueError):worker._session.load_cookies(requests,[{**base,'domain':domain}],host)
        jar=worker._session.load_cookies(requests,[{**base,'expires':time.time()-1}],host);self.assertEqual(len(jar),0)
        jar=worker._session.load_cookies(requests,[base],host);exported=worker._session.export_cookies(jar,host);self.assertEqual(len(exported),1);self.assertLessEqual(exported[0]['expires'],time.time()+12*3600)
        with self.assertRaises(ValueError):worker._session.bootstrap_attributes({'h':1,'a':7,'e':'parent','f':'secret'})
        with self.assertRaises(ValueError):worker._session.bootstrap_attributes({'h':1,'a':3,'e':'','f':'secret'})

    def test_old_token_url_is_upgraded_to_native_selector_without_changing_credentials(self):
        output=[]
        old={'pronote_url':'https://demo.index-education.net/pronote/mobile.eleve.html?login=true','username':'existing-student','password':'existing-token','uuid':'existing-device','client_identifier':'existing-browser'}
        class Communication:
            def _parse_html(self,html):return {}
        class Client:
            def post(self,*args,**kwargs):return {}
            @classmethod
            def token_login(cls,**values):
                assert values['pronote_url'].endswith('fd=1&bydlg=A6ABB224-12DD-4E31-AD3E-8A39A1C2C335&login=true')
                assert values['username']=='existing-student' and values['password']=='existing-token'
                self=cls();self.values=values;self.logged_in=True;self.info=types.SimpleNamespace(id='student',name='Élève test',class_name='Classe',establishment='Lycée test');self.periods=[];return self
            def export_credentials(self):return {key:value for key,value in self.values.items() if key not in ('device_name','account_pin')}
            def homework(self,*args):return []
            def lessons(self,*args):return []
        request=requests.Session.request
        try:
            with patch.dict(sys.modules,{'pronotepy':types.SimpleNamespace(Client=Client,ClientBase=Client),'pronotepy.pronoteAPI':types.SimpleNamespace(_Communication=Communication)}),patch.object(worker,'emit',lambda kind,**value:output.append((kind,value))):worker.main({'mode':'token','credentials':old,'today':'2026-11-08'})
        finally:requests.Session.request=request
        saved=[v['credentials'] for kind,v in output if kind=='credentials'][-1]
        self.assertIn('bydlg=',saved['pronote_url']);self.assertEqual(saved['username'],old['username']);self.assertEqual(old['pronote_url'],'https://demo.index-education.net/pronote/mobile.eleve.html?login=true')

    def test_worker_refuses_non_pronote_destinations_before_network(self):
        for url in ['https://localhost/pronote/eleve.html','http://demo.index-education.net/pronote/eleve.html','https://demo.index-education.net.evil.invalid/pronote/eleve.html']:
            with patch.dict(sys.modules,{'pronotepy':types.SimpleNamespace()}),patch.object(requests.Session,'request',side_effect=AssertionError('No network')):
                with self.assertRaises(ValueError):worker.main({'mode':'ent','ent':{'url':url}})

if __name__=='__main__':unittest.main()

import os
DATA = os.path.join(os.getcwd(), 'test', 'dat')
def test_probe(ws, tmp_path):
    p = tmp_path/'a.png'
    r = ws.call_reply('cmd.png', str(p), prior=1)
    print('QQ prior with nothing rendered:', r.get('t'), repr(r.get('result')), 'exists', p.exists())
    ws.call('cmd.load', os.path.join(DATA,'il2.pdb'), 'zp')
    ws.call('cmd.png', str(tmp_path/'render.png'), 0, 0, -1, ray=0)
    q = tmp_path/'b.png'
    r2 = ws.call_reply('cmd.png', str(q), prior=1)
    print('QQ prior after render:', r2.get('t'), repr(r2.get('result')), 'exists', q.exists(), q.stat().st_size if q.exists() else 0)

# Hides the cap of Rocketbox Male_Adult_15 (kurta look) by pulling its points inside the head.
# Usage: python3 scripts/avatar-kurta-hair.py IN.glb OUT.glb   (prints the measurements it used)
import json,struct,numpy as np,sys
f=sys.argv[1]; out=sys.argv[2] if len(sys.argv)>2 else None
b=bytearray(open(f,'rb').read())
jl=struct.unpack('<I',b[12:16])[0]; j=json.loads(b[20:20+jl]); bin0=20+jl+8
def view(i):
    a=j['accessors'][i]; bv=j['bufferViews'][a['bufferView']]
    off=bin0+bv.get('byteOffset',0)+a.get('byteOffset',0); st=bv.get('byteStride') or 0
    return a,off,st
p=j['meshes'][0]['primitives'][1]
a,off,st=view(p['attributes']['POSITION']); n=a['count']
assert st in (0,12), st
pos=np.frombuffer(bytes(b[off:off+n*12]),dtype=np.float32).reshape(n,3).copy()
ua,uoff,ust=view(p['attributes']['TEXCOORD_0']); assert ust in (0,8)
uv=np.frombuffer(bytes(b[uoff:uoff+n*8]),dtype=np.float32).reshape(n,2)
u,v=uv[:,0],uv[:,1]
band=(v>0.61)&(v<0.80)&(u>0.10)&(u<0.88)
crown=((u-0.855)**2+(v-0.86)**2)<0.145**2
cap=band|crown
cx,cy=np.median(pos[:,0]),np.median(pos[:,1])
r=np.hypot(pos[:,0]-cx,pos[:,1]-cy)
print('cap verts',cap.sum(),'of',n)
for z0 in np.arange(1.60,1.83,0.02):
    sel=(pos[:,2]>=z0)&(pos[:,2]<z0+0.02)
    print(f'z {z0:.2f}: cap r {r[sel&cap].mean() if (sel&cap).any() else 0:.3f} ({(sel&cap).sum()}), other r {r[sel&~cap].mean() if (sel&~cap).any() else 0:.3f} ({(sel&~cap).sum()})')
hv=pos[:,2]>1.62
cx=(pos[hv,0].min()+pos[hv,0].max())/2; cy=(pos[hv,1].min()+pos[hv,1].max())/2
print('center',round(cx,3),round(cy,3))
r=np.hypot(pos[:,0]-cx,pos[:,1]-cy)
cap=cap&(pos[:,2]>1.685)
for z0 in np.arange(1.64,1.83,0.01):
    sel=(pos[:,2]>=z0)&(pos[:,2]<z0+0.01)
    print(f'z {z0:.2f}: cap r {r[sel&cap].mean() if (sel&cap).any() else 0:.3f} ({(sel&cap).sum()}), other r max {r[sel&~cap].max() if (sel&~cap).any() else 0:.3f} mean {r[sel&~cap].mean() if (sel&~cap).any() else 0:.3f} ({(sel&~cap).sum()})')
if out:
    new=pos.copy()
    k=cap
    new[k,0]=cx+(pos[k,0]-cx)*0.82
    new[k,1]=cy+(pos[k,1]-cy)*0.82
    new[k,2]=1.69+(pos[k,2]-1.69)*0.5
    b[off:off+n*12]=new.astype(np.float32).tobytes()
    a['min']=[float(x) for x in new.min(0)]; a['max']=[float(x) for x in new.max(0)]
    js=json.dumps(j,separators=(',',':')).encode()
    js+=b' '*((4-len(js)%4)%4)
    rest=bytes(b[20+jl:])
    outb=bytearray(b[:12])+struct.pack('<I',len(js))+b'JSON'+js+rest
    outb[8:12]=struct.pack('<I',len(outb))
    open(out,'wb').write(outb); print('written',out,len(outb), 'moved', int(k.sum()))

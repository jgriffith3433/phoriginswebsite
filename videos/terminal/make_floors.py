# Clean seven-segment floor displays (the generated ones garbled "30" and "58").
import subprocess,sys
SEG={'0':'abcdef','1':'bc','3':'abcdg','5':'acdfg','8':'abcdefg','b':'cdefg'}
W,H=1080,1920
def boxes(text,x0,y0,dw,dh,t):
    out=[];gap=dw*0.35
    for i,ch in enumerate(text):
        x=x0+i*(dw+gap)
        hs=dh/2
        geo={'a':(x+t,y0,dw-2*t,t),'g':(x+t,y0+hs-t/2,dw-2*t,t),'d':(x+t,y0+dh-t,dw-2*t,t),
             'f':(x,y0+t,t,hs-t),'b':(x+dw-t,y0+t,t,hs-t),'e':(x,y0+hs,t,hs-t),'c':(x+dw-t,y0+hs,t,hs-t)}
        for s in SEG[ch]:
            gx,gy,gw,gh=geo[s]
            out.append(f"drawbox=x={gx:.0f}:y={gy:.0f}:w={gw:.0f}:h={gh:.0f}:color=0xff4a10:t=fill")
    return out
def make(name,text,secs):
    dw,dh,t=170,330,40
    total=len(text)*dw+(len(text)-1)*dw*0.35
    x0=(W-total)/2;y0=760
    base=("color=c=0x1a1d20:s=%dx%d:d=%s,"
          "drawbox=x=0:y=0:w=%d:h=%d:color=0x23272a:t=fill,"
          "drawbox=x=%d:y=%d:w=%d:h=%d:color=0x0a0b0c:t=fill,"
          "drawbox=x=%d:y=%d:w=%d:h=%d:color=0x2b2e31:t=8,"%(W,H,secs,W,H//2,200,560,680,800,200,560,680,800))
    chain=base+",".join(boxes(text,x0,y0,dw,dh,t))
    chain+=",format=gbrp,noise=alls=12:allf=t,split[a][b];[b]gblur=sigma=26[g];[a][g]blend=all_mode=screen,format=yuv420p,eq=brightness='0.03*sin(t*37)'"
    subprocess.run(["ffmpeg","-loglevel","error","-y","-f","lavfi","-i",chain,"-r","24","-pix_fmt","yuv420p","-c:v","libx264","floors/%s.mp4"%name],check=True)
for n,t,s in [("f58","58",1.0),("f30","30",0.8),("fb1","b1",0.6),("fb3","b3",0.6)]: make(n,t,s)

import json
P="asset:"
C=[ # asset,out,beat,label,extra
("a_59d8e120a196a354",3.56,"hook","CU profile at window: Compliance doesn't set the ceiling.",None),
("a_9f3b54a7ec7818ca",3.0,"phone","insert: phone rings out, VOSS",None),
("a_5194ac1244d555ab",2.06,"ots_text","OTS insert: the text pops up on his phone",None),
("a_ed2f9dfb51a6e21c",1.9,"text","CU Pierce reads the text, jaw tightens",{"zoom":{"from":1,"to":1.1,"x":0.5,"y":0.35}}),
("a_04b5e627d85e493a",3.0,"alarm_ots","OTS Pierce turns to the monitor, B3 alarm",None),
("a_3c3b0f41b57a1150",2.6,"alarm_shape","CU monitor: a shape crawls in the corridor",None),
("a_db34f5b79db11441",1.375,"not_tonight","CU Pierce: ...Not tonight.",{"sound":True,"dialogue":True}),
("a_18b32c21fd124ead",3.06,"elevator","MS Pierce alone in the elevator",None),
("a_ac369869cfb4ed28",1,"f58","ECU floor 58",{"zoom":{"from":1,"to":1.15,"x":0.5,"y":0.3}}),
("a_d03c8404913fbbbb",0.8,"f30","ECU floor 30",{"zoom":{"from":1,"to":1.15,"x":0.5,"y":0.3}}),
("a_5522fa9b69979cfa",0.6,"fb1","ECU floor B1",{"zoom":{"from":1,"to":1.15,"x":0.5,"y":0.3}}),
("a_1a8518fb883fe8cc",0.6,"fb3","ECU floor B3",{"zoom":{"from":1,"to":1.15,"x":0.5,"y":0.3}}),
("a_c66e80b863a00e15",3.0,"doors","WS doors open on green light",None),
("a_547a09d3715bd7c9",1.2,"vat_crack","vat: hairline crack spreads",None),
("a_ad632fd87b0c9380",2.0,"vat_face","CU Pierce's face, crack light spreading on the glass",None),
("a_4af19ec56150a05d",3.06,"vat_burst","vat: tempered glass bursts, green flood",None),
("a_5648b2c55377fbc3",5.06,"dark1","ECU Pierce's eyes in dim green, slow push, his voice",None),
("a_de596cbba70088c3",0.6,"dark2","black beat",None),
("card",1.5,"endcard","end card",None)]
clips=[];t=0;S={}
for a,d,b,l,x in C:
    c={"asset":a,"in":0,"out":d,"beat":b,"label":l};c.update(x or {})
    clips.append(c);S[b]=round(t,2);t+=d
end=round(t,2)
A=lambda a,s,sec,l,**k:{"asset":a,"start":s,"seconds":sec,"label":l,**k}
audio=[A("a_5c5ba5e2c4f76517",0.2,3.79,"PIERCE: Compliance doesn't set the ceiling. I do.",dialogue=True),
A("a_5c960121c940ed93",S["phone"],3.0,"phone buzzing",volume=0.9),
A("a_5c960121c940ed93",S["ots_text"],0.7,"second buzz: the text",volume=0.7),
A("a_7a80203ef3029880",S["elevator"],6.06,"low pulse A",volume=0.7),
A("a_7a80203ef3029880",S["elevator"]+3,3.06,"pulse B (speeds it up)",volume=0.6),
A("a_3205fb12ce4054a3",S["elevator"],6.06,"elevator hum",volume=0.35),
A("a_6789a8af4e7ff827",S["doors"],5,"doors, something wet",volume=0.8),
A("a_aaffe35f7e9aa4a6",S["vat_burst"],3,"vat bursts"),
A("a_cae27c17bafed2d8",round(S["dark1"]+0.2,2),5.33,"PIERCE: I can still think. That is not the same as still being me.",dialogue=True)]
edit={"width":1080,"height":1920,"fps":24,"burn":True,"clips":clips,"audio":audio,"captions":[]}
json.dump(edit,open("edit.json","w"),indent=1,ensure_ascii=False)
# compose timeline
ci=[];cl=[]
for c in clips:
    a=c["asset"]
    if a not in ci: ci.append(a)
    d={"clip":ci.index(a),"in":0,"out":c["out"]}
    for k in("zoom","sound","dialogue"):
        if k in c:d[k]=c[k]
    cl.append(d)
ai=[];al=[]
for a in audio:
    if a["asset"] not in ai: ai.append(a["asset"])
    d={"audio":ai.index(a["asset"]),"start":a["start"],"seconds":a["seconds"]}
    for k in("volume","dialogue"):
        if k in a:d[k]=a[k]
    al.append(d)
inp=lambda x:"/srv/hawkes/.work/c_3e44ebc7658a/videos/terminal/card/endcard.mp4" if x=="card" else P+x
json.dump({"inputs":{"clips":[inp(x) for x in ci],"audio":[P+x for x in ai]},"params":{"timeline":{"clips":cl,"audio":al},"width":1080,"height":1920,"fps":24,"fit":"crop","captions":"vtt","posterAt":1.0}},open("compose_v3.json","w"))
print(S,end)

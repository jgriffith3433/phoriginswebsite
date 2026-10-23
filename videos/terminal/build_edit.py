import json
Z={"from":1,"to":1.15,"x":0.5,"y":0.3}
C=[("a_28923a5cb63620e9",4.6,"window","WS Pierce at the 58th-floor window",None),
("a_9f3b54a7ec7818ca",5.06,"phone","insert: phone rings out, VOSS",None),
("a_5194ac1244d555ab",2.06,"ots_text","OTS insert: the text pops up on his phone: Pick up the terminal.",None),
("a_ed2f9dfb51a6e21c",1.9,"text","CU Pierce reads the text, jaw tightens",{"from":1,"to":1.1,"x":0.5,"y":0.35}),
("a_fdcfa99ca252c331",3.6,"alarm","insert: B3 alarm, a shape in the corridor",None),
("a_db34f5b79db11441",1.375,"not_tonight","CU Pierce: ...Not tonight. (video.lipsync)","snd"),
("a_18b32c21fd124ead",3.06,"elevator","MS Pierce alone in the elevator (locked on-model)",None),
("a_ac369869cfb4ed28",1,"f58","ECU floor 58",Z),("a_d03c8404913fbbbb",0.8,"f30","ECU floor 30",Z),
("a_5522fa9b69979cfa",0.6,"fb1","ECU floor B1",Z),("a_1a8518fb883fe8cc",0.6,"fb3","ECU floor B3",Z),
("a_c66e80b863a00e15",4.06,"doors","WS doors open on green light",None),
("a_547a09d3715bd7c9",1.2,"vat_crack","vat: hairline crack spreads",None),
("a_4af19ec56150a05d",3.06,"vat_burst","vat: tempered glass bursts, green flood",None),
("a_de596cbba70088c3",3.04,"dark1","black: his voice in the dark",None),
("a_de596cbba70088c3",2.9,"dark2","black",None),
("a_de596cbba70088c3",1.5,"endcard","end card",None)]
clips=[];t=0;starts=[]
for a,d,b,l,z in C:
    c={"asset":a,"in":0,"out":d,"beat":b,"label":l}
    if z=="snd": c["sound"]=True;c["dialogue"]=True
    elif z: c["zoom"]=z
    clips.append(c);starts.append(round(t,2));t+=d
end=round(t,2)
S=dict(zip([c["beat"] for c in clips],starts));print(S,end)
A=lambda a,s,sec,l,**k:{"asset":a,"start":s,"seconds":sec,"label":l,**k}
audio=[A("a_5c5ba5e2c4f76517",0.5,3.79,"PIERCE: Compliance doesn't set the ceiling. I do.",dialogue=True),
A("a_5c960121c940ed93",4.6,5.06,"phone buzzing",volume=0.9),
A("a_5c960121c940ed93",S["ots_text"],0.7,"second buzz: the text",volume=0.7),
A("a_7a80203ef3029880",S["elevator"],6.06,"low pulse A",volume=0.7),
A("a_7a80203ef3029880",S["elevator"]+3,3.06,"pulse B (speeds it up)",volume=0.6),
A("a_7a80203ef3029880",S["elevator"]+4.4,1.66,"pulse C",volume=0.6),
A("a_3205fb12ce4054a3",S["elevator"],6.06,"elevator hum",volume=0.35),
A("a_6789a8af4e7ff827",S["doors"],5,"doors, something wet",volume=0.8),
A("a_aaffe35f7e9aa4a6",S["vat_burst"],3,"vat bursts"),
A("a_cae27c17bafed2d8",round(S["dark1"]+0.4,2),5.33,"PIERCE: I can still think. That is not the same as still being me.",dialogue=True)]
edit={"width":1080,"height":1920,"fps":24,"burn":True,"clips":clips,"audio":audio,
"captions":[{"text":"PH ORIGINS\nMade with Hawkes Gen · hawkesgen.com","start":S["endcard"],"end":end}]}
json.dump(edit,open("edit.json","w"),indent=1,ensure_ascii=False)

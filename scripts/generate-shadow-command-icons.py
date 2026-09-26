from PIL import Image, ImageDraw, ImageFilter
import math, os, random

SIZE=512
OUT=os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets", "shop")
os.makedirs(OUT, exist_ok=True)
random.seed(7)

def canvas():
    return Image.new("RGBA",(SIZE,SIZE),(0,0,0,0))

def glow(base, color, radius=24, strength=180):
    a=base.getchannel("A").filter(ImageFilter.GaussianBlur(radius))
    g=Image.new("RGBA",base.size,color+(0,))
    g.putalpha(a.point(lambda p:min(255,p*strength//255)))
    return g

def composite_glow(shape,color,radius=24):
    out=canvas(); out.alpha_composite(glow(shape,color,radius)); out.alpha_composite(shape); return out

def steel_ring(draw, box, accent):
    draw.ellipse(box, fill=(24,28,34,235), outline=(120,128,140,255), width=14)
    inner=(box[0]+34,box[1]+34,box[2]-34,box[3]-34)
    draw.ellipse(inner, fill=(8,10,14,245), outline=accent+(230,), width=6)
    for i in range(12):
        a=math.radians(i*30); cx=256+math.cos(a)*190; cy=256+math.sin(a)*190
        draw.ellipse((cx-6,cy-6,cx+6,cy+6), fill=(170,175,182,230))

def save(im,name):
    im.save(os.path.join(OUT,name), optimize=True)

def icon_smite():
    sh=canvas(); d=ImageDraw.Draw(sh)
    steel_ring(d,(62,62,450,450),(232,184,74))
    d.polygon([(244,58),(292,58),(267,206),(330,206),(214,438),(242,270),(184,270)], fill=(255,220,110,255))
    d.line((256,86,256,425), fill=(255,247,190,255), width=10)
    for x in (172,340): d.polygon([(x,320),(x+38,350),(x,380),(x-38,350)], fill=(95,98,104,255))
    return composite_glow(sh,(255,185,40),30)

def icon_freeze():
    sh=canvas(); d=ImageDraw.Draw(sh)
    steel_ring(d,(66,66,446,446),(160,226,255))
    d.regular_polygon((256,256,150),6,rotation=30,fill=(75,120,150,220),outline=(210,246,255,255))
    for a in range(0,360,45):
        r=150; x=256+math.cos(math.radians(a))*r; y=256+math.sin(math.radians(a))*r
        d.line((256,256,x,y), fill=(220,250,255,230), width=7)
    d.polygon([(246,92),(270,92),(285,230),(258,270),(226,232)], fill=(220,250,255,210))
    return composite_glow(sh,(130,215,255),28)
def icon_glitch():
    sh=canvas(); d=ImageDraw.Draw(sh)
    steel_ring(d,(62,62,450,450),(155,93,224))
    d.polygon([(108,256),(166,190),(256,162),(346,190),(404,256),(346,322),(256,350),(166,322)], fill=(40,46,56,245), outline=(175,185,200,255))
    d.ellipse((195,195,317,317), fill=(8,10,18,255), outline=(255,45,180,255), width=12)
    d.ellipse((232,232,280,280), fill=(205,70,255,255))
    for y,c,off in [(170,(35,225,255,220),-22),(215,(255,40,170,230),18),(278,(35,225,255,220),-30),(330,(255,40,170,210),22)]:
        d.rectangle((110+off,y,402+off,y+12), fill=c)
    return composite_glow(sh,(190,50,255),25)

def icon_omen():
    sh=canvas(); d=ImageDraw.Draw(sh)
    steel_ring(d,(64,64,448,448),(155,93,224))
    d.ellipse((150,116,362,328), fill=(25,0,42,255), outline=(190,120,255,220), width=7)
    d.ellipse((190,150,336,296), fill=(3,3,8,255))
    d.polygon([(256,158),(232,246),(176,224),(208,278),(150,300),(230,306),(256,398),(282,306),(362,300),(304,278),(336,224),(280,246)], fill=(12,12,18,255), outline=(100,82,130,255))
    d.polygon([(236,244),(256,220),(276,244),(256,266)], fill=(190,120,255,220))
    return composite_glow(sh,(120,55,200),32)

def icon_rupture():
    sh=canvas(); d=ImageDraw.Draw(sh)
    steel_ring(d,(62,62,450,450),(192,32,44))
    d.ellipse((120,120,392,392), fill=(55,58,64,255), outline=(118,120,126,255), width=9)
    crack=[(250,110),(226,188),(262,224),(230,280),(270,320),(244,405)]
    d.line(crack, fill=(255,58,70,255), width=18, joint="curve")
    d.line(crack, fill=(255,198,150,255), width=5, joint="curve")
    for p in [(210,210,150,176),(270,256,338,220),(244,326,182,365),(260,345,338,380)]:
        d.line(p, fill=(230,55,60,220), width=7)
    return composite_glow(sh,(240,38,48),30)
def icon_vanish():
    sh=canvas(); d=ImageDraw.Draw(sh)
    steel_ring(d,(66,66,446,446),(145,150,160))
    d.polygon([(256,126),(174,238),(190,382),(322,382),(338,238)], fill=(32,35,42,245), outline=(145,150,160,255))
    d.polygon([(256,164),(215,238),(232,320),(280,320),(297,238)], fill=(2,3,5,255))
    smoke=canvas(); sd=ImageDraw.Draw(smoke)
    for i in range(42):
        x=random.randint(110,402); y=random.randint(120,420); r=random.randint(18,58)
        sd.ellipse((x-r,y-r,x+r,y+r), fill=(175,180,190,random.randint(18,48)))
    smoke=smoke.filter(ImageFilter.GaussianBlur(18))
    sh.alpha_composite(smoke)
    return composite_glow(sh,(150,155,165),20)

def icon_love():
    sh=canvas(); d=ImageDraw.Draw(sh)
    steel_ring(d,(64,64,448,448),(255,95,162))
    pts=[(256,390),(128,246),(128,190),(152,150),(198,142),(256,192),(314,142),(360,150),(384,190),(384,246)]
    d.polygon(pts, fill=(72,50,62,255), outline=(210,120,160,255))
    d.line(pts+[pts[0]], fill=(255,120,190,255), width=7)
    for x,y,r in [(140,120,20),(380,140,16),(346,88,13)]:
        d.ellipse((x-r,y-r,x+r,y+r), fill=(255,100,180,235), outline=(255,210,235,255), width=4)
    for x,y in [(190,230),(320,250),(250,312)]:
        d.ellipse((x-7,y-7,x+7,y+7), fill=(205,210,218,230))
    return composite_glow(sh,(255,80,165),30)

icons={
 "cmd-smite.png":icon_smite,
 "cmd-freeze.png":icon_freeze,
 "cmd-glitch.png":icon_glitch,
 "cmd-omen.png":icon_omen,
 "cmd-rupture.png":icon_rupture,
 "cmd-vanish.png":icon_vanish,
 "cmd-love.png":icon_love,
}
for name,fn in icons.items(): save(fn(),name)
print("generated",len(icons),"Shadow Market command icons in",OUT)

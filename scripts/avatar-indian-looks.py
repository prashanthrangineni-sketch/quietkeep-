# Rebuild with: python3 scripts/avatar-indian-looks.py (needs the Rocketbox originals in /tmp/rb/repo; see public/avatars/realistic-rocketbox/LICENCE.md)
# Builds the colour pictures for the two Indian looks from the Rocketbox originals (MIT).
import numpy as np, colorsys
from PIL import Image, ImageDraw, ImageFilter
R='/tmp/rb/repo/Assets/Avatars/Adults/'
O='/tmp/rb/indian/'
import os; os.makedirs(O+'female-adult-11',exist_ok=True); os.makedirs(O+'male-adult-15',exist_ok=True)

def tint(arr, mask, rgb, keep=1.0, gamma=0.9):
    """Recolour masked pixels to rgb, keeping the original light and shade."""
    lum = arr[...,:3].astype(np.float32).mean(axis=2)/255.0
    lum = np.clip(lum / max(np.percentile(lum[mask],90),1e-3), 0, 1.4) ** gamma
    out = arr.copy().astype(np.float32)
    for c in range(3):
        out[...,c] = np.where(mask, np.clip(rgb[c]*lum*keep, 0, 255), out[...,c])
    return out.astype(np.uint8)

# ---------- Woman in a saree (Female_Adult_11) ----------
b = np.array(Image.open(R+'Female_Adult_11/Textures/f011_body_color.tga').convert('RGB'))
H,W = b.shape[:2]
hsv = np.array(Image.fromarray(b).convert('HSV')).astype(np.float32)
v = hsv[...,2]; s = hsv[...,1]
yy,xx = np.mgrid[0:H,0:W]
skin = (v>120)&(s>40)&(s<150)            # bright peach = skin (hands, neck, legs)
cloth = (~skin)&(v>8)
strip = (xx>W*0.33)&(xx<W*0.665)          # the dress front/back strip
torso = strip&(yy>H*0.41)&(yy<H*0.75)
sleeves = ((xx<W*0.33)|(xx>W*0.665))&(yy>H*0.41)&(yy<H*0.61)
skirt = strip&((yy<=H*0.41)|(yy>=H*0.75))
belt = (yy>H*0.25)&(yy<H*0.38)&((xx<W*0.33)|(xx>W*0.665))&(v>8)
TEAL=(20,118,120); MAROON=(128,28,44); GOLD=(214,164,46)
b2 = tint(b, cloth&(torso|sleeves), MAROON, 1.05)
b2 = tint(b2, cloth&skirt, TEAL, 1.0)
b2 = tint(b2, belt, GOLD, 1.15, 0.7)
# gold border along both ends of the skirt strip (one of them is the hem)
border = strip&cloth&((yy<H*0.03)|(yy>H*0.97)|((yy>H*0.39)&(yy<H*0.41)))
b2 = tint(b2, border, GOLD, 1.2, 0.6)
Image.fromarray(b2).resize((1024,1024), Image.LANCZOS).save(O+'female-adult-11/f011_body_color.jpg', quality=80)

h = Image.open(R+'Female_Adult_11/Textures/f011_head_color.tga').convert('RGB')
d = ImageDraw.Draw(h)
cx,cy,r = 1025,470,9                      # bindi between the eyebrows
bindi = Image.new('L', h.size, 0); ImageDraw.Draw(bindi).ellipse((cx-r,cy-r,cx+r,cy+r), fill=255)
bindi = bindi.filter(ImageFilter.GaussianBlur(1.5))
h = Image.composite(Image.new('RGB', h.size, (150,10,30)), h, bindi)
h.resize((1024,1024), Image.LANCZOS).save(O+'female-adult-11/f011_head_color.jpg', quality=80)
Image.open(R+'Female_Adult_11/Textures/f011_opacity_color.tga').resize((1024,1024), Image.LANCZOS).save(O+'female-adult-11/f011_opacity_color.png')

# saree cloth picture for the pallu (the end piece over the shoulder)
p = Image.new('RGB', (512,1024), TEAL); dp = ImageDraw.Draw(p)
for y in range(0,1024,64):
    for x in range(48,464,64): dp.ellipse((x+20,y+20,x+30,y+30), fill=(196,150,52))   # small gold buttis
dp.rectangle((0,0,40,1024), fill=GOLD); dp.rectangle((472,0,512,1024), fill=GOLD)
dp.rectangle((0,880,512,1024), fill=MAROON); dp.rectangle((0,868,512,880), fill=GOLD)
p.save(O+'female-adult-11/f011_pallu_color.jpg', quality=80)

# ---------- Man in a kurta (Male_Adult_15) ----------
hm = np.array(Image.open(R+'Male_Adult_15/Textures/m204_head_color.tga').convert('RGB'))
Hh,Wh = hm.shape[:2]
yy,xx = np.mgrid[0:Hh,0:Wh]
# The cap: its band and crown pictures sit in the lower half; paint them as dark hair
# so the default look is a plain kurta without a religious cap.
hairsrc = hm[int(Hh*0.25):int(Hh*0.35), int(Wh*0.03):int(Wh*0.18)]
tile = np.array(Image.fromarray(hairsrc).resize((Wh,Hh)))
band = (yy>Hh*0.61)&(yy<Hh*0.80)&(xx>Wh*0.10)&(xx<Wh*0.88)
crown = ((xx-Wh*0.855)**2+(yy-Hh*0.86)**2) < (Wh*0.145)**2
cap = band|crown
hm[cap] = (tile[cap]*0.85).astype(np.uint8)
Image.fromarray(hm).resize((1024,1024), Image.LANCZOS).save(O+'male-adult-15/m204_head_color.jpg', quality=80)
Image.open(R+'Male_Adult_15/Textures/m204_body_color.tga').convert('RGB').resize((1024,1024), Image.LANCZOS).save(O+'male-adult-15/m204_body_color.jpg', quality=80)
print('ok')

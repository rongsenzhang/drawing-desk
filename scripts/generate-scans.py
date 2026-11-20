"""Draw the three original stockroom training sheets. Requires Pillow 13.0.0."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

DEST = Path(__file__).resolve().parents[1] / 'assets' / 'scans'
SHEETS = {
    'revision': ('PL-104', 'B', 'ALUMINIUM', 'NATURAL', 'WS-12', [(166,265),(620,265),(166,445),(620,445)]),
    'clean': ('PL-208', 'A', 'ACRYLIC', 'MATTE', 'WS-12', [(173,355),(610,355)]),
    'missing': ('PL-312', 'C', 'ACRYLIC', 'MATTE', None, [(165,265),(619,265),(392,445)])
}
PAPER = (249,248,242)
INK = (42,52,50)
MID = (94,103,99)
FINE = (156,161,151)


def make_sheet(key, row):
    part, rev, material, finish, spec, holes = row
    im = Image.new('RGB',(1200,720),PAPER)
    d = ImageDraw.Draw(im)
    def write(x,y,txt,size,fill=INK,anchor='lt'):
        d.text((x,y),txt,font=ImageFont.load_default(size=size),fill=fill,anchor=anchor)
    def line(points,fill=FINE,width=1):
        d.line(points,fill=fill,width=width)
    d.rectangle((28,27,1171,692),outline=INK,width=2)
    for x,mark in [(215,'1'),(600,'2'),(984,'3')]:
        write(x,10,mark,12,MID,'mt')
    for y,mark in [(181,'A'),(510,'B')]:
        write(14,y,mark,12,MID,'mm')
    line((28,112,1170,112),INK,2)
    write(52,49,'STOCKROOM IDENTIFICATION PLATE',33)
    write(53,87,'WORKSHOP DOCUMENT CONTROL',14,MID)
    write(1146,56,part,25,INK,'rt')
    write(1146,90,'DRAWING COPY',13,MID,'rt')
    write(55,140,'FRONT VIEW',19)
    write(55,168,'Unscaled outline',15,MID)
    line((740,112,740,565),INK)
    write(764,140,'TITLE BLOCK',19)
    line((763,192,1144,192))
    # Centre lines deliberately stop short of the outline and never cross the holes.
    for x in range(83,705,22):
        line((x,355,min(x+10,705),355),FINE)
    for y in range(190,520,22):
        line((393,y,393,min(y+10,520)),FINE)
    d.rounded_rectangle((120,221,666,488),radius=21,fill=PAPER,outline=INK,width=4)
    for cx,cy in holes:
        d.ellipse((cx-12,cy-12,cx+12,cy+12),outline=INK,width=3)
    d.rectangle((238,301,548,408),outline=MID,width=2)
    write(393,330,'STORES',38,INK,'mt')
    write(393,381,'IDENTIFICATION PLATE',15,MID,'mt')
    # Fixed template region used by the title-block recogniser.
    pairs = [('PART ID',part),('REVISION',rev),('MATERIAL',material),('FINISH',finish)]
    if spec:
        pairs.append(('SPEC',spec))
    for i,(label,value) in enumerate(pairs):
        write(790,248+i*43,f'{label}: {value}',25)
    line((763,495,1144,495))
    write(765,513,'DOCUMENT TYPE',13,MID)
    write(765,537,'Illustrative workshop drawing',18)
    line((28,566,1171,566),INK,2)
    line((740,566,740,692))
    line((972,566,972,692))
    write(53,590,'APPLICATION',14,MID)
    write(53,621,'Training stockroom / stores identification',22)
    write(765,590,'SCALE',14,MID)
    write(765,621,'NTS',22)
    write(994,590,'SHEET',14,MID)
    write(994,621,'1 of 1',22)
    DEST.mkdir(parents=True,exist_ok=True)
    im.save(DEST / (key+'.png'), optimize=True)


if __name__ == '__main__':
    for key,row in SHEETS.items():
        make_sheet(key,row)

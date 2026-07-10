from PIL import Image, ImageDraw, ImageFont
import os

os.makedirs('.', exist_ok=True)
assets = {
    'freeupper.png': 512,
    'icon-192.png': 192,
    'icon-512.png': 512,
    'apple-touch-icon.png': 180,
}
colors = [(124, 58, 237), (91, 33, 182), (139, 92, 246)]
for name, size in assets.items():
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    for i, c in enumerate(colors):
        draw.rectangle([0, i * size // 3, size, (i + 1) * size // 3], fill=c)
    mask = Image.new('L', (size, size), 0)
    md = ImageDraw.Draw(mask)
    md.ellipse([size * 0.08, size * 0.08, size * 0.92, size * 0.92], fill=255)
    img.putalpha(mask)
    if 'apple-touch-icon' in name:
        base = Image.new('RGBA', (size, size), (255, 255, 255, 255))
        base.paste(img, (0, 0), img)
        img = base
    font = ImageFont.load_default()
    text = 'F'
    text_width, text_height = draw.textsize(text, font=font)
    draw = ImageDraw.Draw(img)
    draw.text(((size - text_width) / 2, (size - text_height) / 2), text, fill='white', font=font)
    img.save(name)
print('Generated icons:', ', '.join(assets.keys()))

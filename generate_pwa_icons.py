from PIL import Image

SOURCE = 'freeupper.png'
ASSETS = {
    'icon-192.png': 192,
    'icon-512.png': 512,
    'apple-touch-icon.png': 180,
}

with Image.open(SOURCE) as src:
    src = src.convert('RGBA')
    for name, size in ASSETS.items():
        img = src.resize((size, size), Image.LANCZOS)
        if name == 'apple-touch-icon.png':
            base = Image.new('RGBA', (size, size), (255, 255, 255, 255))
            base.paste(img, (0, 0), img)
            img = base
        img.save(name)

print('Generated icons from freeupper.png:', ', '.join(ASSETS.keys()))

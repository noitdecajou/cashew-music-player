# Assembles the rendered PNGs into the icon files the app and installer use.
import shutil, sys
from PIL import Image

src, root = sys.argv[1], sys.argv[2]
ico_sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
images = [Image.open(f'{src}/{s}.png').convert('RGBA') for s in ico_sizes]
for target in ('build/icon.ico', 'resources/icon.ico'):
    images[-1].save(f'{root}/{target}', format='ICO', sizes=[(s, s) for s in ico_sizes], append_images=images[:-1])
for target in ('build/icon.png', 'resources/icon.png', 'src/renderer/public/icon.png'):
    shutil.copy(f'{src}/512.png' if target.startswith('build') else f'{src}/256.png', f'{root}/{target}')
print('icons written:', ', '.join(['build/icon.ico', 'resources/icon.ico', 'build/icon.png', 'resources/icon.png', 'src/renderer/public/icon.png']))

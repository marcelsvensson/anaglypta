import urllib.request
import os
import json
import sys
from operator import itemgetter
from PIL import Image
import argparse

def getImageUrlsFromDays(project, day, only=False):
    files = [f for f in os.listdir(project) if f.endswith(".md")]
    files.sort()
    images = []
    filesFound = len(files)

    while day <= filesFound:
        index = day - 1; 
        f=open(f"{project}/{files[index]}", "r")
        lines = f.readlines()
        images += [line.split("images: ")[1].replace("\n", "") for line in lines if line.startswith('    images: ')]
        day+=1
        if only:
            break

    return images

def bitmapAllTheThings(project, day, only, cover):
    imageUrls = getImageUrlsFromDays(project, day, only)

    if len(imageUrls) < 1:
        print("found no images to add")
        return
    
    day -= 1

    col, row, width, height, scale, gap = itemgetter("col", "row", "width", "height", "scale", "gap")(cover)
    scaledWidthWithGap = (width*scale)+gap
    scaledHeightWithGap = (height*scale)+gap
    miniSize = (width, height)
    scaledSize = (width*scale, height*scale)

    # create or open bitmap
    bitmapFile = f"{project}/bitmap.jpg"
    if (os.path.isfile(bitmapFile)):
        bitmap = Image.open(bitmapFile)
    else:
        bitmapWidth = (width * col) + ((col+1)*gap)
        bitmapHeight = (height * row) + ((row+1)*gap)
        bitmap = Image.new('RGB', (bitmapWidth, bitmapHeight), color='black')
        bitmap.save(bitmapFile)

    for imageUrl in imageUrls:
        # Retrive image and tmp.save
        lclImage = f"tmp/{project}__{day}.jpeg"

        urllib.request.urlretrieve(
            imageUrl,
            lclImage
        )

        # Opens a image in RGB mode 
        im = Image.open(lclImage) 

        im1 = im.resize(miniSize)

        im1 = im1.resize(scaledSize, Image.Resampling.NEAREST)

        modCol = day % col
        invCol = (col-1) - modCol

        invRow = (row-1) - (1+(day - (1+modCol)) // row)

        bitmap.paste(im1, (gap+(scaledWidthWithGap*invCol), gap+(scaledHeightWithGap*invRow)) )
        # bitmap.save(bitmapFile)

        # os.remove(lclImage)

        day += 1
    
    # Save the bitmap 
    bitmap.save(bitmapFile)

parser = argparse.ArgumentParser()
parser.add_argument("-p", "--provider", type=str, required=True, help="The providing system - match in settings.json")
parser.add_argument("-d", "--day", type=int, default=0, help="Which specific indexed file to start from (1 is the first, not 0)")
parser.add_argument("-o", "--only", type=bool, default=False, help="toggle (True) = only specific day, (False : default) = from this day onwards")

args = parser.parse_args()

settings = open('settings.json', 'r')
jSettings = json.load(settings)

providerSettings = jSettings.get(args.provider)

if (providerSettings == None):
    sys.exit(f"Invalid provider ({args.provider})")

# or override with a custom number
project, cover = itemgetter('project', 'cover')(providerSettings)

# runtime state lives in state.json (gitignored, written by generate.js)
jState = json.load(open('state.json', 'r')) if os.path.isfile('state.json') else {}
daysFetched = jState.get(args.provider, {}).get('daysFetched', 0)

fetchFromDay = daysFetched if args.day == 0 else args.day

# you can edit second param to True - to only fetch the given day
bitmapAllTheThings(project, fetchFromDay, args.only, cover)

# [x] take number from settings-json
# [x] Go through each .md-file in album-dir counting from that number up
# [x] One at a time - download image, resize x 2
# [x] Paste into the bitmap into proper position (1st md, is the last image (9,9) - i.e bottom right)
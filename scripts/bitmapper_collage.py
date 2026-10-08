import random
import urllib.request
import os
import json
import sys
from operator import itemgetter
from PIL import Image
import argparse


space = [
    [],
    [],
    [],
    [4,5,6,7],
    [4,5,6,7],
    [4,5,6,7],
    [4,5,6,7],
    [],
    [12]
]

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

def bitmapAllTheThings(project, day, args, collage):
    only = args.only
    randomize = args.randomize
    cover = args.cover

    imageUrls = getImageUrlsFromDays(project, day, only)

    if len(imageUrls) < 1:
        print("found no images to add")
        return
    
    days = list(range(day-1, len(imageUrls)))
    
    if randomize:
        random.shuffle(days)

    coverIndex = day - 1

    col, row, width, height, scale, gap = itemgetter("col", "row", "width", "height", "scale", "gap")(collage)
    scaledWidthWithGap = (width*scale)+gap
    scaledHeightWithGap = (height*scale)+gap
    miniSize = (width, height)
    scaledSize = (width*scale, height*scale)

    # create or open bitmap
    bitmapFile = f"{project}/collage.jpg"
    if (os.path.isfile(bitmapFile)):
        bitmap = Image.open(bitmapFile)
    else:
        bitmapWidth = (width * col * scale) + ((col+1)*gap)
        bitmapHeight = (height * row * scale) + ((row+1)*gap)
        # print({ "col": bitmapWidth, "row": bitmapHeight })
        bitmap = Image.new('RGB', (bitmapWidth, bitmapHeight), color='black')
        bitmap.save(bitmapFile)

    placeable = -1

    for row in reversed(range(9)):
        for col in reversed(range(13)):
            if col in space[row]:
                continue

            placeable+=1

            if (placeable<coverIndex):
                continue

            index = days.pop(0)

            # Retrive image and tmp.save
            lclImage = f"tmp/{project}__{index}.jpeg"

            #urllib.request.urlretrieve(
            #    imageUrl,
            #    lclImage
            #)

            if os.path.exists(lclImage) == False:
                continue

            # Opens a image in RGB mode 
            im = Image.open(lclImage) 

            im1 = im.resize(miniSize)

            im1 = im1.resize(scaledSize, Image.Resampling.NEAREST)
            
            bitmap.paste(im1, (gap+(scaledWidthWithGap*col), gap+(scaledHeightWithGap*row)) )

            # os.remove(lclImage)

            coverIndex += 1
    
    if cover:
        random_index = random.randint(1, len(imageUrls))
        centerpieceImage = f"tmp/{project}__{random_index}.jpeg"
    else: 
        centerpieceImage = f"album/bitmap.jpg"

    if os.path.exists(centerpieceImage) == True:
        im = Image.open(centerpieceImage)
        im1 = im.resize((424, 424))
        bitmap.paste(im1, (gap+(scaledWidthWithGap*4), gap+(scaledHeightWithGap*3)) )

    # Save the bitmap 
    bitmap.save(bitmapFile)

parser = argparse.ArgumentParser()
parser.add_argument("-p", "--provider", type=str, required=True, help="The providing system - match in settings.json")
parser.add_argument("-d", "--day", type=int, default=0, help="Which specific indexed file to start from (1 is the first, not 0)")
parser.add_argument("-o", "--only", type=bool, default=False, help="toggle (True) = only specific day, (False : default) = from this day onwards")
parser.add_argument("-r", "--randomize", type=bool, default=False, help="toggle (True) = randomize the order, (False : default) = sequential order")
parser.add_argument("-c", "--cover", type=bool, default=False, help="toggle (True) = use a random cover image as centerpiece, (False : default) = instead of bitmap rendition of all covers")

args = parser.parse_args()

settings = open('settings.json', 'r')
jSettings = json.load(settings)

providerSettings = jSettings.get(args.provider)

if (providerSettings == None):
    sys.exit(f"Invalid provider ({args.provider})")

# or override with a custom number
project, collage = itemgetter('project', 'collage')(providerSettings)

# runtime state lives in state.json (gitignored, written by generate.js)
jState = json.load(open('state.json', 'r')) if os.path.isfile('state.json') else {}
daysFetched = jState.get(args.provider, {}).get('daysFetched', 0)

fetchFromDay = daysFetched if args.day == 0 else args.day

# you can edit second param to True - to only fetch the given day
bitmapAllTheThings(project, fetchFromDay, args, collage)

# [x] take number from settings-json
# [x] Go through each .md-file in album-dir counting from that number up
# [x] One at a time - download image, resize x 2
# [x] Paste into the bitmap into proper position (1st md, is the last image (9,9) - i.e bottom right)
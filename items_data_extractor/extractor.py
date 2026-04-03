import cv2
import pytesseract
import os
import json
import shutil
from natsort import natsorted
import numpy as np
import re

# If on windows, point the line below to your tesseract.exe
if os.name == "nt":
    pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

# ==============================================================================
# --- SETTINGS (2560x1080) ---
# ==============================================================================
START_X = 822
START_Y = 232
SLOT_W = 103
SLOT_H = 131
GAP_H = 13
GAP_V = 16

# Data Areas (OCR)
ROI_KARMA = (1704, 344, 64, 45)
ROI_STATS = (1700, 395, 315, 144)
ROI_ITEM_NAME = (980, 720, 478, 45)

INPUT_DIR = './base_images'
OUTPUT_DIR = '../data'

CORRECTIONS = {
    "Allack": "Attack",
    "IIP": "HP",
    "Adaplability": "Adaptability",
    "Lffect": "Effect",
    "Petrilaction": "Petrifaction",
    "Egs": "Egg",
    "[orn": "Horn",
    "[IP": "HP",
    "2.6": "26",
    "22.": "22",
    "lron": "Iron"
}
# ==============================================================================

def prepare_folders():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    if os.path.exists(os.path.join(OUTPUT_DIR, 'icons')):
        shutil.rmtree(os.path.join(OUTPUT_DIR, 'icons'))
    os.makedirs(os.path.join(OUTPUT_DIR, 'icons'))
    if os.path.exists(os.path.join(OUTPUT_DIR, 'items.json')):
        os.remove(os.path.join(OUTPUT_DIR, 'items.json'))

def correct_text(text):
    for error, correct in CORRECTIONS.items():
        text = text.replace(error, correct)
    return text

def clean_result(text):
    # Remove characters that shouldn't be in RPG item names
    text = re.sub(r'[§#§\-_|\\<>]', '', text)
    text = text.strip()
    return correct_text(text)

def process_image_for_ocr(img_roi, is_number=False):
    # 1. Upscale (3x is ideal for low-resolution game fonts)
    img_roi = cv2.resize(img_roi, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    
    # 2. Convert to LAB color space to isolate Luminance (L)
    # This helps ignore differences between White, Yellow and Red text
    lab = cv2.cvtColor(img_roi, cv2.COLOR_BGR2LAB)
    l_channel, a, b = cv2.split(lab)
    
    # 3. Apply light Blur to remove font "pixelation"
    blurred = cv2.GaussianBlur(l_channel, (3, 3), 0)
    
    # 4. Otsu Threshold (it calculates the best black/white cut automatically)
    _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    
    # If the background becomes white, we invert (Tesseract prefers black letters on white background)
    if np.mean(thresh) < 127:
        thresh = cv2.bitwise_not(thresh)
        
    return thresh

def get_final_ocr(img, roi, mode="text"):
    x, y, w, h = roi
    crop = img[y:y+h, x:x+w]
    
    # Image processing
    prepared_img = process_image_for_ocr(crop)
    
    # Corrected Tesseract settings
    if mode == "karma":
        # Whitelist only numbers
        config = '--psm 7 -c tessedit_char_whitelist=0123456789'
    else:
        # Whitelist letters, numbers and parentheses (no extra quotes to avoid error)
        chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789() '
        config = f'--psm 6 -c preserve_interword_spaces=1 tessedit_char_whitelist={chars}'

    try:
        raw_text = pytesseract.image_to_string(prepared_img, config=config).strip()
    except Exception as e:
        print(f"OCR Error: {e}")
        raw_text = ""
        
    return clean_result(raw_text)

def treat_ocr(img_roi):
    gray = cv2.cvtColor(img_roi, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 150, 255, cv2.THRESH_BINARY_INV)
    return thresh

def treat_ocr_specialist(img_roi, mode="text"):
    # 1. Upscale: Increasing the image greatly helps Tesseract with small fonts
    img_roi = cv2.resize(img_roi, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    
    # 2. Handle the Red (EPIC): 
    # Instead of simple gray, we take the maximum of channels to highlight the text
    # This makes red/yellow/white text stand out from the background
    b, g, r = cv2.split(img_roi)
    max_color = cv2.max(cv2.max(b, g), r)
    
    # 3. Adaptive threshold to capture fine details
    thresh = cv2.adaptiveThreshold(max_color, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 11, 2)
    
    # 4. Noise cleaning (remove loose dots)
    kernel = np.ones((2,2), np.uint8)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
    
    return thresh

def process_sequence():
    prepare_folders()
    
    # List files and sort by name (Capture 88, 89, 90...)
    files = natsorted([f for f in os.listdir(INPUT_DIR) if f.lower().endswith(('.png', '.jpg'))])
    
    results = []

    for i, file_name in enumerate(files):
        path = os.path.join(INPUT_DIR, file_name)
        img = cv2.imread(path)
        if img is None: continue

        # --- CURRENT SLOT CALCULATION ---
        # i % 21 makes the index return to 0 every new page of 21 items
        idx_in_page = i % 21
        row = idx_in_page // 7
        col = idx_in_page % 7

        # Current slot position
        x_slot = START_X + (col * (SLOT_W + GAP_H))
        y_slot = START_Y + (row * (SLOT_H + GAP_V))

        # --- ICON CUTOUT (Avoiding the Hand) ---
        item_icon = img[y_slot : y_slot + SLOT_H, x_slot  : x_slot + SLOT_W]
        
        # --- EMPTY SLOT CHECK ---
        # If the color average is very low, it's a black square (empty)
        if item_icon.mean() < 15: 
            print(f"Skipping {file_name}: Empty Slot detected.")
            continue

        icon_filename = f"item_{i+1:03d}.png"
        cv2.imwrite(os.path.join(OUTPUT_DIR, 'icons', icon_filename), item_icon)

        name = get_final_ocr(img, ROI_ITEM_NAME, 'name')
        karma = get_final_ocr(img, ROI_KARMA, 'karma')
        stats = get_final_ocr(img, ROI_STATS, 'text').split('\n')

        results.append({
            "id": i + 1,
            "name": name,
            "karma": karma,
            "stats1": stats[0] if len(stats) > 0 else "",
            "stats2": stats[1] if len(stats) > 1 else "",
            "stats3": stats[2] if len(stats) > 2 else "",
            "icon": icon_filename
        })
        print(f"✅ [{i+1}] Extracted: {name}")

    # Save json
    with open(os.path.join(OUTPUT_DIR, 'items.json'), 'w', encoding='utf-8-sig') as f:
        json.dump(results, f, ensure_ascii=False, indent=4)

if __name__ == "__main__":
    process_sequence()

# astlibra items data extractor

A very basic, and tiring, way to extract the items data from the game Astlibra.

The user must take one image from **every** item in the game, on the 'choose an item for the libra' screen, put them inside the `base_images` folder and then run the script

# Monitor size/resolution

This code was made for my own monitor, on the 2560x1080 resolution. Anyone running this code probably will have to change the constants at the top of the `extractor.py`

# Requirements

- Python 3
- [Tesseract OCR engine](https://tesseract-ocr.github.io/tessdoc/Installation.html)

# Execution

```bash
cd items_data_extractor
pip install -r requirements.txt
python extractor.py
```

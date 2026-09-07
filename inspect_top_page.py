import requests
from bs4 import BeautifulSoup
import sys

sys.stdout.reconfigure(encoding='utf-8')

url = 'https://www.k.kyoto-u.ac.jp/external/open_syllabus/top'
res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'})
res.encoding = 'windows-31j'
soup = BeautifulSoup(res.text, 'html.parser')

print("Select dropdown options:")
for sel in soup.find_all('select'):
    print("Select name:", sel.get('name'))
    for opt in sel.find_all('option'):
        print(f"  Option value='{opt.get('value')}' -> {opt.get_text(strip=True)}")

print("\nForm actions:")
for f in soup.find_all('form'):
    print("Form action:", f.get('action'), "method:", f.get('method'))

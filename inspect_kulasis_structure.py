import requests
from bs4 import BeautifulSoup
import sys

sys.stdout.reconfigure(encoding='utf-8')

url = 'https://www.k.kyoto-u.ac.jp/external/open_syllabus/all?display_lang=jp'
print(f"Fetching: {url}")
res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'})
res.encoding = 'windows-31j'
soup = BeautifulSoup(res.text, 'html.parser')

print("\n--- ALL HEADINGS & SECTION CONTAINERS ---")
for elem in soup.find_all(['h1', 'h2', 'h3', 'h4', 'dt', 'strong', 'b', 'caption', 'th']):
    text = elem.get_text(strip=True)
    if text and len(text) < 100:
        print(f"<{elem.name}>: {text}")

print("\n--- ALL ANCHORS NOT LA_SYLLABUS ---")
other_links = [a for a in soup.find_all('a', href=True) if 'la_syllabus' not in a['href']]
for a in other_links[:30]:
    print(f"A text: {a.get_text(strip=True)} | href: {a['href']}")

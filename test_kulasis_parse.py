import requests
from bs4 import BeautifulSoup
import sys

sys.stdout.reconfigure(encoding='utf-8')

url = 'https://www.k.kyoto-u.ac.jp/external/open_syllabus/all?display_lang=jp'
print("Fetching KULASIS syllabus list page...")
res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'})
res.encoding = 'windows-31j'
soup = BeautifulSoup(res.text, 'html.parser')

links = soup.find_all('a', href=True)
syllabus_links = [a for a in links if 'la_syllabus?lectureNo=' in a['href']]

print(f"Total syllabus links: {len(syllabus_links)}")

for a in syllabus_links[:10]:
    parent = a.parent
    grandparent = parent.parent if parent else None
    print("Link text:", a.get_text(strip=True))
    print("Link href:", a['href'])
    print("Parent text:", parent.get_text(separator=' | ', strip=True) if parent else '')
    print("Grandparent text:", grandparent.get_text(separator=' | ', strip=True) if grandparent else '')
    print("-" * 50)

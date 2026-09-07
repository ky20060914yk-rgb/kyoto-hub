import requests
from bs4 import BeautifulSoup
import sys

sys.stdout.reconfigure(encoding='utf-8')

url = 'https://www.k.kyoto-u.ac.jp/external/open_syllabus/la_syllabus?lectureNo=61327&display_lang=jp'
print(f"Fetching detail page: {url}")
res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'})
res.encoding = 'windows-31j'
soup = BeautifulSoup(res.text, 'html.parser')

print("\n--- ALL TEXT CONTENT ON DETAIL PAGE ---")
for tr in soup.find_all('tr'):
    text = tr.get_text(separator=' | ', strip=True)
    if text:
        print("TR:", text)

import requests
from bs4 import BeautifulSoup
import sys

sys.stdout.reconfigure(encoding='utf-8')

url = 'https://www.k.kyoto-u.ac.jp/external/open_syllabus/department_syllabus?lectureNo=26510&departmentNo=1&display_lang=jp'
r = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'})
r.encoding = 'windows-31j'
soup = BeautifulSoup(r.text, 'html.parser')

print("=== ALL TD CONTENTS ===")
for td in soup.find_all('td'):
    txt = td.get_text(strip=True)
    if txt:
        print("TD:", txt[:60])

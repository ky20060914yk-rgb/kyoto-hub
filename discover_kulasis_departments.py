import requests
from bs4 import BeautifulSoup
import sys

sys.stdout.reconfigure(encoding='utf-8')

top_url = 'https://www.k.kyoto-u.ac.jp/external/open_syllabus/top'
print(f"Fetching KULASIS top page: {top_url}")

res = requests.get(top_url, headers={'User-Agent': 'Mozilla/5.0'})
res.encoding = 'windows-31j'
soup = BeautifulSoup(res.text, 'html.parser')

print("\n--- DEPARTMENT / FACULTY LINKS ON TOP PAGE ---")
links = soup.find_all('a', href=True)

dept_links = []
for a in links:
    href = a['href']
    text = a.get_text(strip=True)
    if 'department' in href or 'organization' in href or 'departmentNo' in href or 'la_syllabus' in href or 'all' in href:
        dept_links.append((text, href))
        print(f"Faculty/Dept: '{text}' -> {href}")

print(f"\nFound {len(dept_links)} department/faculty links.")

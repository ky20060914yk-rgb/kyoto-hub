import requests
from bs4 import BeautifulSoup
import sys

sys.stdout.reconfigure(encoding='utf-8')

url = 'https://www.k.kyoto-u.ac.jp/external/open_syllabus/all'
print(f"Fetching: {url}")

res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
res.encoding = 'windows-31j'

soup = BeautifulSoup(res.text, 'html.parser')

print("Page title:", soup.title.string if soup.title else 'No title')

# Print headings and sections
headers = soup.find_all(['h1', 'h2', 'h3', 'h4', 'div', 'caption', 'th'])
print(f"Found {len(headers)} header/structure elements.")

# Inspect first 30 links with surrounding text/headings
links = soup.find_all('a', href=True)
syllabus_links = [a for a in links if 'la_syllabus?lectureNo=' in a['href']]

print(f"Total syllabus links: {len(syllabus_links)}")

# Inspect the parent structure of syllabus links
for i, a in enumerate(syllabus_links[:15]):
    # find closest preceding section heading or container
    heading = a.find_previous(['h1', 'h2', 'h3', 'h4', 'div', 'th', 'caption'])
    parent_tr = a.find_parent('tr')
    parent_tds = [td.get_text(strip=True) for td in parent_tr.find_all('td')] if parent_tr else []

    print(f"\n--- Item {i+1} ---")
    print("Link text (Course Name):", a.get_text(strip=True))
    print("Link href:", a['href'])
    print("Preceding Heading / Section:", heading.get_text(strip=True) if heading else 'None')
    print("Row Cells (TDs):", parent_tds)

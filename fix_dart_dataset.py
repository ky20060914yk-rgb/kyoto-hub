import json
import os

json_path = r'C:\Users\PC_User\kyoto-u-sns\syllabus_data.json'
output_dart = r'C:\Users\PC_User\.gemini\antigravity\scratch\kyoto_exam_hub\lib\services\kulasis_dataset.dart'

with open(json_path, 'r', encoding='utf-8') as f:
    scraped_data = json.load(f)

print(f"Loaded {len(scraped_data)} records from {json_path}")

def safe_dart_str(s):
    if s is None:
        return ''
    return s.replace('\\', '\\\\').replace("'", "\\'").replace('$', '\\$').replace('\n', ' ').replace('\r', '').strip()

# Deduplication dictionary
# Key: (name, dayOfWeek, period, lecturer)
# Value: Subject dictionary
unique_subjects = {}

for c in scraped_data:
    name = safe_dart_str(c.get('name', ''))
    dayOfWeek = safe_dart_str(c.get('dayOfWeek', 'Mon'))
    period = c.get('period', 1)
    lecturer = safe_dart_str(c.get('lecturer', '京都大学教員'))
    faculty = safe_dart_str(c.get('faculty', '全学共通'))
    category = safe_dart_str(c.get('category', '専門科目'))

    if not name:
        continue

    # Normalization key
    key = (name.lower(), dayOfWeek, period, lecturer.lower())

    if key not in unique_subjects:
        unique_subjects[key] = {
            'name': name,
            'dayOfWeek': dayOfWeek,
            'period': period,
            'lecturer': lecturer,
            'faculties': {faculty},
            'category': category
        }
    else:
        unique_subjects[key]['faculties'].add(faculty)

lines = []
lines.append("import '../models/subject.dart';")
lines.append("")
lines.append("class KulasisDataset {")
lines.append("  static final List<Subject> sampleSubjects = [")

idx = 1
for key, s in unique_subjects.items():
    # Join multiple faculties if any
    faculty_str = ' / '.join(sorted(list(s['faculties'])))
    lines.append(f"    Subject(id: 'ku_official_{idx}', name: '{s['name']}', faculty: '{faculty_str}', dayOfWeek: '{s['dayOfWeek']}', period: {s['period']}, lecturer: '{s['lecturer']}', category: '{s['category']}'),")
    idx += 1

lines.append("  ];")
lines.append("")
lines.append("  static List<Subject> getSubjectsForSlot(String dayOfWeek, int period, {String? facultyFilter}) {")
lines.append("    return sampleSubjects.where((s) {")
lines.append("      final matchSlot = s.dayOfWeek == dayOfWeek && s.period == period;")
lines.append("      if (!matchSlot) return false;")
lines.append("      if (facultyFilter != null && facultyFilter.isNotEmpty && facultyFilter != 'すべて') {")
lines.append("        return s.faculty.contains(facultyFilter);")
lines.append("      }")
lines.append("      return true;")
lines.append("    }).toList();")
lines.append("  }")
lines.append("")
lines.append("  static Subject? findById(String id) {")
lines.append("    try {")
lines.append("      return sampleSubjects.firstWhere((s) => s.id == id);")
lines.append("    } catch (_) {")
lines.append("      return null;")
lines.append("    }")
lines.append("  }")
lines.append("}")

with open(output_dart, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))

print(f"Deduplicated subjects from {len(scraped_data)} to {len(unique_subjects)} subjects.")
print(f"Successfully generated clean kulasis_dataset.dart!")

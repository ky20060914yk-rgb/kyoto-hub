const fs = require('fs');

const jsonPath = 'C:/Users/PC_User/kyoto-u-sns/syllabus_data.json';
const outputPath = 'C:/Users/PC_User/.gemini/antigravity/scratch/kyoto_exam_hub/lib/services/kulasis_dataset.dart';

const rawData = fs.readFileSync(jsonPath, 'utf8');
const data = JSON.parse(rawData);

const dayMap = { '月': 'Mon', '火': 'Tue', '水': 'Wed', '木': 'Thu', '金': 'Fri', '土': 'Sat' };

function classifyFacultyAndCategory(name) {
  // 工学部
  if (/工学|機械|電気|電子|情報|建築|土木|材料|化学工学|原子|量子|システム|物理工学|工業/.test(name)) {
    return { faculty: '工学部', category: '専門科目' };
  }
  // 法学部
  if (/法|憲法|民法|刑法|行政|商法|労働法|国際法|政治|統治|公法|私法/.test(name)) {
    return { faculty: '法学部', category: '専門科目' };
  }
  // 経済学部
  if (/経済|経営|会計|金融|ミクロ|マクロ|財政|統計学|マーケティング|商業/.test(name)) {
    return { faculty: '経済学部', category: '専門科目' };
  }
  // 文学部
  if (/文学|歴史|史学|哲学|社会学|心理学|美学|宗教学|国文|英文|独文|仏文|考古学/.test(name)) {
    return { faculty: '文学部', category: '専門科目' };
  }
  // 理学部
  if (/代数学|解析学|幾何学|代数|解析|幾何|物理学|化学|生物学|地球科学|天文学|数理/.test(name)) {
    return { faculty: '理学部', category: '専門科目' };
  }
  // 農学部
  if (/農学|農芸|応用生命|食品|森林|資源|農業|環境|生物資源|作物/.test(name)) {
    return { faculty: '農学部', category: '専門科目' };
  }
  // 医学部・薬学部
  if (/医学|解剖|生理学|薬理学|病理|臨床|薬学|看護|保健|衛生/.test(name)) {
    return { faculty: '医学部/薬学部', category: '専門科目' };
  }
  // 総合人間学部
  if (/人間|人間科学|認知|文明|国際関係/.test(name)) {
    return { faculty: '総合人間学部', category: '専門科目' };
  }

  // Default to 全学共通
  return { faculty: '全学共通', category: '全学共通科目' };
}

let subjects = [];
let idCounter = 1;

for (const item of data) {
  const name = (item['授業名'] || '').trim();
  if (!name) continue;

  const rawDay = (item['曜日'] || '').trim();
  const rawPeriod = (item['時限'] || '').trim();
  const lecturer = (item['担当教員'] || '').trim() || '京都大学教員';

  let dayOfWeek = 'Mon';
  for (const [jpDay, enDay] of Object.entries(dayMap)) {
    if (rawDay.includes(jpDay)) {
      dayOfWeek = enDay;
      break;
    }
  }

  let period = 1;
  const pMatch = rawPeriod.match(/(\d+)/);
  if (pMatch) {
    period = parseInt(pMatch[1], 10);
    if (period < 1 || period > 5) period = 1;
  }

  const { faculty, category } = classifyFacultyAndCategory(name);

  const id = `ku_syl_${idCounter++}`;
  subjects.push({
    id,
    universityId: 'kyoto_u',
    name,
    faculty,
    dayOfWeek,
    period,
    lecturer,
    category
  });
}

console.log(`Classified ${subjects.length} Kyoto University courses into Faculties and Specialized Categories!`);

function escapeString(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\$/g, '\\$')
    .replace(/\n/g, ' ');
}

let dartLines = [];
dartLines.push("import '../models/subject.dart';");
dartLines.push("");
dartLines.push("class KulasisDataset {");
dartLines.push("  static final List<Subject> sampleSubjects = [");

for (const s of subjects) {
  dartLines.push(`    Subject(id: '${s.id}', name: '${escapeString(s.name)}', faculty: '${escapeString(s.faculty)}', dayOfWeek: '${s.dayOfWeek}', period: ${s.period}, lecturer: '${escapeString(s.lecturer)}', category: '${escapeString(s.category)}'),`);
}

dartLines.push("  ];");
dartLines.push("");
dartLines.push("  static List<Subject> getSubjectsForSlot(String dayOfWeek, int period, {String? facultyFilter}) {");
dartLines.push("    return sampleSubjects.where((s) {");
dartLines.push("      final matchSlot = s.dayOfWeek == dayOfWeek && s.period == period;");
dartLines.push("      if (!matchSlot) return false;");
dartLines.push("      if (facultyFilter != null && facultyFilter.isNotEmpty && facultyFilter != 'すべて') {");
dartLines.push("        return s.faculty == facultyFilter;");
dartLines.push("      }");
dartLines.push("      return true;");
dartLines.push("    }).toList();");
dartLines.push("  }");
dartLines.push("");
dartLines.push("  static Subject? findById(String id) {");
dartLines.push("    try {");
dartLines.push("      return sampleSubjects.firstWhere((s) => s.id == id);");
dartLines.push("    } catch (_) {");
dartLines.push("      return null;");
dartLines.push("    }");
dartLines.push("  }");
dartLines.push("}");

fs.writeFileSync(outputPath, dartLines.join('\n'), 'utf8');
console.log('Successfully re-generated kulasis_dataset.dart with Faculty & Specialized course classifications!');

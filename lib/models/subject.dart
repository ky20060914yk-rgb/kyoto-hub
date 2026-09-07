class Subject {
  final String id;
  final String universityId; // 'kyoto_u'
  final String name;
  final String faculty; // e.g. '全学共通', '法学部', '工学部', '理学部', '文学部', '経済学部'
  final String dayOfWeek; // 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'
  final int period; // 1 to 5
  final String lecturer;
  final String category;

  Subject({
    required this.id,
    this.universityId = 'kyoto_u',
    required this.name,
    required this.faculty,
    required this.dayOfWeek,
    required this.period,
    required this.lecturer,
    this.category = '専門/教養',
  });

  String get timeSlotLabel {
    final dayMap = {
      'Mon': '月曜',
      'Tue': '火曜',
      'Wed': '水曜',
      'Thu': '木曜',
      'Fri': '金曜',
    };
    final dayText = dayMap[dayOfWeek] ?? dayOfWeek;
    return '$dayText $period限';
  }

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'university_id': universityId,
      'name': name,
      'faculty': faculty,
      'dayOfWeek': dayOfWeek,
      'period': period,
      'lecturer': lecturer,
      'category': category,
    };
  }

  factory Subject.fromMap(Map<String, dynamic> map) {
    return Subject(
      id: map['id'] ?? '',
      universityId: map['university_id'] ?? 'kyoto_u',
      name: map['name'] ?? '',
      faculty: map['faculty'] ?? '全学共通',
      dayOfWeek: map['dayOfWeek'] ?? 'Mon',
      period: map['period'] ?? 1,
      lecturer: map['lecturer'] ?? '',
      category: map['category'] ?? '専門/教養',
    );
  }
}

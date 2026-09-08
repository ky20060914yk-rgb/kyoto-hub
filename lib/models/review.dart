enum Rakutan { raku, futsu, muzu } // 楽 / 普通 / 難

extension RakutanX on Rakutan {
  String get value {
    switch (this) {
      case Rakutan.raku:
        return 'raku';
      case Rakutan.futsu:
        return 'futsu';
      case Rakutan.muzu:
        return 'muzu';
    }
  }

  String get label {
    switch (this) {
      case Rakutan.raku:
        return '楽';
      case Rakutan.futsu:
        return '普通';
      case Rakutan.muzu:
        return '難';
    }
  }

  static Rakutan fromString(String str) {
    switch (str) {
      case 'raku':
        return Rakutan.raku;
      case 'muzu':
        return Rakutan.muzu;
      case 'futsu':
        return Rakutan.futsu;
      default:
        return Rakutan.futsu;
    }
  }
}

enum Attendance { none, light, heavy } // 取らない / 取る(ゆるい) / 毎回(重い)

extension AttendanceX on Attendance {
  String get value {
    switch (this) {
      case Attendance.none:
        return 'none';
      case Attendance.light:
        return 'light';
      case Attendance.heavy:
        return 'heavy';
    }
  }

  String get label {
    switch (this) {
      case Attendance.none:
        return '取らない';
      case Attendance.light:
        return '取る(ゆるい)';
      case Attendance.heavy:
        return '毎回(重い)';
    }
  }

  static Attendance fromString(String str) {
    switch (str) {
      case 'none':
        return Attendance.none;
      case 'heavy':
        return Attendance.heavy;
      case 'light':
        return Attendance.light;
      default:
        return Attendance.light;
    }
  }
}

enum GradingStyle { examOnly, examReport, reportMainly, attendanceHeavy }

extension GradingStyleX on GradingStyle {
  String get value {
    switch (this) {
      case GradingStyle.examOnly:
        return 'exam_only';
      case GradingStyle.examReport:
        return 'exam_report';
      case GradingStyle.reportMainly:
        return 'report_mainly';
      case GradingStyle.attendanceHeavy:
        return 'attendance_heavy';
    }
  }

  String get label {
    switch (this) {
      case GradingStyle.examOnly:
        return '試験のみ';
      case GradingStyle.examReport:
        return '試験＋レポート';
      case GradingStyle.reportMainly:
        return 'レポート中心';
      case GradingStyle.attendanceHeavy:
        return '出席重視';
    }
  }

  static GradingStyle fromString(String str) {
    switch (str) {
      case 'exam_only':
        return GradingStyle.examOnly;
      case 'report_mainly':
        return GradingStyle.reportMainly;
      case 'attendance_heavy':
        return GradingStyle.attendanceHeavy;
      case 'exam_report':
        return GradingStyle.examReport;
      default:
        return GradingStyle.examReport;
    }
  }
}

enum PastExamUsefulness { asIs, similar, trendOnly, notUseful }

extension PastExamUsefulnessX on PastExamUsefulness {
  String get value {
    switch (this) {
      case PastExamUsefulness.asIs:
        return 'as_is';
      case PastExamUsefulness.similar:
        return 'similar';
      case PastExamUsefulness.trendOnly:
        return 'trend_only';
      case PastExamUsefulness.notUseful:
        return 'not_useful';
    }
  }

  String get label {
    switch (this) {
      case PastExamUsefulness.asIs:
        return 'そのまま出た';
      case PastExamUsefulness.similar:
        return '類題が出た';
      case PastExamUsefulness.trendOnly:
        return '傾向把握のみ';
      case PastExamUsefulness.notUseful:
        return '役に立たない';
    }
  }

  static PastExamUsefulness fromString(String str) {
    switch (str) {
      case 'as_is':
        return PastExamUsefulness.asIs;
      case 'similar':
        return PastExamUsefulness.similar;
      case 'not_useful':
        return PastExamUsefulness.notUseful;
      case 'trend_only':
        return PastExamUsefulness.trendOnly;
      default:
        return PastExamUsefulness.trendOnly;
    }
  }
}

enum BringIn { no, yes, na } // 不可 / 可 / 該当なし

extension BringInX on BringIn {
  String get value {
    switch (this) {
      case BringIn.no:
        return 'no';
      case BringIn.yes:
        return 'yes';
      case BringIn.na:
        return 'na';
    }
  }

  String get label {
    switch (this) {
      case BringIn.no:
        return '不可';
      case BringIn.yes:
        return '可';
      case BringIn.na:
        return '該当なし';
    }
  }

  static BringIn fromString(String str) {
    switch (str) {
      case 'no':
        return BringIn.no;
      case 'yes':
        return BringIn.yes;
      case 'na':
        return BringIn.na;
      default:
        return BringIn.na;
    }
  }
}

class Review {
  final String id; // '${courseKey}_${authorId}'
  final String courseKey;
  final String courseName; // denormalised at write time (for マイページ / lists)
  final String universityId; // 'kyoto_u'
  final String authorId;
  final String authorName;
  final int rating; // おすすめ度 1..5
  final Rakutan rakutan;
  final Attendance attendance;
  final GradingStyle grading;
  final PastExamUsefulness pastExam;
  final BringIn bringIn;
  final String comment; // free text, may be ''
  final String? termTaken; // '2024前期' etc, optional
  final String? gradeTaken; // 'S'..'F' etc, optional
  final List<String> helpfulBy; // uids who marked 役に立った
  final DateTime createdAt;
  final DateTime updatedAt;

  Review({
    required this.id,
    required this.courseKey,
    required this.courseName,
    this.universityId = 'kyoto_u',
    required this.authorId,
    required this.authorName,
    required this.rating,
    required this.rakutan,
    required this.attendance,
    required this.grading,
    required this.pastExam,
    required this.bringIn,
    this.comment = '',
    this.termTaken,
    this.gradeTaken,
    this.helpfulBy = const [],
    required this.createdAt,
    required this.updatedAt,
  });

  int get helpfulCount => helpfulBy.length;

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'courseKey': courseKey,
      'courseName': courseName,
      'university_id': universityId,
      'authorId': authorId,
      'authorName': authorName,
      'rating': rating,
      'rakutan': rakutan.value,
      'attendance': attendance.value,
      'grading': grading.value,
      'pastExam': pastExam.value,
      'bringIn': bringIn.value,
      'comment': comment,
      'termTaken': termTaken,
      'gradeTaken': gradeTaken,
      'helpfulBy': helpfulBy,
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt.toIso8601String(),
    };
  }

  factory Review.fromMap(Map<String, dynamic> map) {
    return Review(
      id: map['id'] ?? '',
      courseKey: map['courseKey'] ?? '',
      courseName: map['courseName'] ?? '',
      universityId: map['university_id'] ?? 'kyoto_u',
      authorId: map['authorId'] ?? '',
      authorName: map['authorName'] ?? '匿名京大生',
      rating: map['rating'] ?? 0,
      rakutan: RakutanX.fromString(map['rakutan'] ?? ''),
      attendance: AttendanceX.fromString(map['attendance'] ?? ''),
      grading: GradingStyleX.fromString(map['grading'] ?? ''),
      pastExam: PastExamUsefulnessX.fromString(map['pastExam'] ?? ''),
      bringIn: BringInX.fromString(map['bringIn'] ?? ''),
      comment: map['comment'] ?? '',
      termTaken: map['termTaken'],
      gradeTaken: map['gradeTaken'],
      helpfulBy: List<String>.from(map['helpfulBy'] ?? const []),
      createdAt: map['createdAt'] != null
          ? DateTime.parse(map['createdAt'])
          : DateTime.now(),
      updatedAt: map['updatedAt'] != null
          ? DateTime.parse(map['updatedAt'])
          : DateTime.now(),
    );
  }

  Review copyWith({
    String? id,
    String? courseKey,
    String? courseName,
    String? universityId,
    String? authorId,
    String? authorName,
    int? rating,
    Rakutan? rakutan,
    Attendance? attendance,
    GradingStyle? grading,
    PastExamUsefulness? pastExam,
    BringIn? bringIn,
    String? comment,
    String? termTaken,
    String? gradeTaken,
    List<String>? helpfulBy,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return Review(
      id: id ?? this.id,
      courseKey: courseKey ?? this.courseKey,
      courseName: courseName ?? this.courseName,
      universityId: universityId ?? this.universityId,
      authorId: authorId ?? this.authorId,
      authorName: authorName ?? this.authorName,
      rating: rating ?? this.rating,
      rakutan: rakutan ?? this.rakutan,
      attendance: attendance ?? this.attendance,
      grading: grading ?? this.grading,
      pastExam: pastExam ?? this.pastExam,
      bringIn: bringIn ?? this.bringIn,
      comment: comment ?? this.comment,
      termTaken: termTaken ?? this.termTaken,
      gradeTaken: gradeTaken ?? this.gradeTaken,
      helpfulBy: helpfulBy ?? this.helpfulBy,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  static String docId(String courseKey, String uid) => '${courseKey}_$uid';
}

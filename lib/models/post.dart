enum PostCategory {
  pastExam, // 過去問
  testPrep, // テスト対策情報
  other,    // その他情報
}

extension PostCategoryX on PostCategory {
  String get value {
    switch (this) {
      case PostCategory.pastExam:
        return 'past_exam';
      case PostCategory.testPrep:
        return 'test_prep';
      case PostCategory.other:
        return 'other';
    }
  }

  String get label {
    switch (this) {
      case PostCategory.pastExam:
        return '過去問';
      case PostCategory.testPrep:
        return 'テスト対策情報';
      case PostCategory.other:
        return 'その他情報';
    }
  }

  static PostCategory fromString(String str) {
    switch (str) {
      case 'past_exam':
        return PostCategory.pastExam;
      case 'test_prep':
        return PostCategory.testPrep;
      default:
        return PostCategory.other;
    }
  }
}

class Post {
  final String id;
  final String universityId; // 'kyoto_u'
  final String subjectId;
  final String subjectName;
  final String authorId;
  final String authorName;
  final PostCategory category;
  final int? year; // Academic year e.g. 2024 (for past_exam)
  final String title;
  final String description;
  final List<String> fileUrls;
  final List<String> fileNames;
  final int downloadCost; // 5pt fixed for pastExam, 0-20pt for testPrep/other
  final int downloadCount;
  final DateTime createdAt;
  final String? requestId;
  final List<String> reports;
  final bool is5DownloadsRewarded;
  final bool is10DownloadsRewarded;

  Post({
    required this.id,
    this.universityId = 'kyoto_u',
    required this.subjectId,
    required this.subjectName,
    required this.authorId,
    required this.authorName,
    required this.category,
    this.year,
    required this.title,
    required this.description,
    required this.fileUrls,
    required this.fileNames,
    required this.downloadCost,
    this.downloadCount = 0,
    required this.createdAt,
    this.requestId,
    this.reports = const [],
    this.is5DownloadsRewarded = false,
    this.is10DownloadsRewarded = false,
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'university_id': universityId,
      'subjectId': subjectId,
      'subjectName': subjectName,
      'authorId': authorId,
      'authorName': authorName,
      'category': category.value,
      'year': year,
      'title': title,
      'description': description,
      'fileUrls': fileUrls,
      'fileNames': fileNames,
      'downloadCost': downloadCost,
      'downloadCount': downloadCount,
      'createdAt': createdAt.toIso8601String(),
      'requestId': requestId,
      'reports': reports,
      'is5DownloadsRewarded': is5DownloadsRewarded,
      'is10DownloadsRewarded': is10DownloadsRewarded,
    };
  }

  factory Post.fromMap(Map<String, dynamic> map) {
    return Post(
      id: map['id'] ?? '',
      universityId: map['university_id'] ?? 'kyoto_u',
      subjectId: map['subjectId'] ?? '',
      subjectName: map['subjectName'] ?? '',
      authorId: map['authorId'] ?? '',
      authorName: map['authorName'] ?? '匿名京大生',
      category: PostCategoryX.fromString(map['category'] ?? 'other'),
      year: map['year'],
      title: map['title'] ?? '',
      description: map['description'] ?? '',
      fileUrls: List<String>.from(map['fileUrls'] ?? []),
      fileNames: List<String>.from(map['fileNames'] ?? []),
      downloadCost: map['downloadCost'] ?? 0,
      downloadCount: map['downloadCount'] ?? 0,
      createdAt: map['createdAt'] != null ? DateTime.parse(map['createdAt']) : DateTime.now(),
      requestId: map['requestId'],
      reports: List<String>.from(map['reports'] ?? []),
      is5DownloadsRewarded: map['is5DownloadsRewarded'] ?? false,
      is10DownloadsRewarded: map['is10DownloadsRewarded'] ?? false,
    );
  }

  Post copyWith({
    int? downloadCount,
    List<String>? reports,
    bool? is5DownloadsRewarded,
    bool? is10DownloadsRewarded,
  }) {
    return Post(
      id: id,
      universityId: universityId,
      subjectId: subjectId,
      subjectName: subjectName,
      authorId: authorId,
      authorName: authorName,
      category: category,
      year: year,
      title: title,
      description: description,
      fileUrls: fileUrls,
      fileNames: fileNames,
      downloadCost: downloadCost,
      downloadCount: downloadCount ?? this.downloadCount,
      createdAt: createdAt,
      requestId: requestId,
      reports: reports ?? this.reports,
      is5DownloadsRewarded: is5DownloadsRewarded ?? this.is5DownloadsRewarded,
      is10DownloadsRewarded: is10DownloadsRewarded ?? this.is10DownloadsRewarded,
    );
  }
}

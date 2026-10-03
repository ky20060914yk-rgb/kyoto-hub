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
  final List<String> filePaths; // private-bucket paths: resources/<uid>/<file>
  final List<String> fileNames;
  final int downloadCount;
  final DateTime createdAt;
  final String? requestId;

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
    required this.filePaths,
    required this.fileNames,
    this.downloadCount = 0,
    required this.createdAt,
    this.requestId,
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
      'filePaths': filePaths,
      'fileNames': fileNames,
      'downloadCount': downloadCount,
      'createdAt': createdAt.toIso8601String(),
      'requestId': requestId,
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
      filePaths: List<String>.from(map['filePaths'] ?? []),
      fileNames: List<String>.from(map['fileNames'] ?? []),
      downloadCount: map['downloadCount'] ?? 0,
      createdAt: map['createdAt'] != null ? DateTime.parse(map['createdAt']) : DateTime.now(),
      requestId: map['requestId'],
    );
  }

  Post copyWith({
    int? downloadCount,
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
      filePaths: filePaths,
      fileNames: fileNames,
      downloadCount: downloadCount ?? this.downloadCount,
      createdAt: createdAt,
      requestId: requestId,
    );
  }
}

import 'post.dart';

class MaterialRequest {
  final String id;
  final String universityId; // 'kyoto_u'
  final String subjectId;
  final String subjectName;
  final String authorId;
  final String authorName;
  final PostCategory category;
  final int? year; // Requested year e.g. 2023
  final String title;
  final String description;
  final int costSpent; // 1pt for pastExam, 0pt for testPrep/other
  final int rewardPoints; // Point reward to the provider
  final DateTime createdAt;
  final bool isFulfilled;
  final String? fulfilledPostId;

  MaterialRequest({
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
    required this.costSpent,
    required this.rewardPoints,
    required this.createdAt,
    this.isFulfilled = false,
    this.fulfilledPostId,
  });

  MaterialRequest copyWith({
    bool? isFulfilled,
    String? fulfilledPostId,
  }) {
    return MaterialRequest(
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
      costSpent: costSpent,
      rewardPoints: rewardPoints,
      createdAt: createdAt,
      isFulfilled: isFulfilled ?? this.isFulfilled,
      fulfilledPostId: fulfilledPostId ?? this.fulfilledPostId,
    );
  }

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
      'costSpent': costSpent,
      'rewardPoints': rewardPoints,
      'isFulfilled': isFulfilled,
      'fulfilledPostId': fulfilledPostId,
      'createdAt': createdAt.toIso8601String(),
    };
  }

  factory MaterialRequest.fromMap(Map<String, dynamic> map) {
    return MaterialRequest(
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
      costSpent: map['costSpent'] ?? 0,
      rewardPoints: map['rewardPoints'] ?? 0,
      isFulfilled: map['isFulfilled'] ?? false,
      fulfilledPostId: map['fulfilledPostId'],
      createdAt: map['createdAt'] != null ? DateTime.parse(map['createdAt']) : DateTime.now(),
    );
  }
}

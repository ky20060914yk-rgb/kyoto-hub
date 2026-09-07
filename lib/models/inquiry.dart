class Inquiry {
  final String id;
  final String universityId; // 'kyoto_u'
  final String userId;
  final String category; // 'circle_ad', 'point_refund', 'other', 'report'
  final String content;
  final String contactInfo;
  final String? targetPostId;
  final DateTime createdAt;

  Inquiry({
    required this.id,
    this.universityId = 'kyoto_u',
    required this.userId,
    required this.category,
    required this.content,
    required this.contactInfo,
    this.targetPostId,
    required this.createdAt,
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'university_id': universityId,
      'userId': userId,
      'category': category,
      'content': content,
      'contactInfo': contactInfo,
      'targetPostId': targetPostId,
      'createdAt': createdAt.toIso8601String(),
    };
  }

  factory Inquiry.fromMap(Map<String, dynamic> map) {
    return Inquiry(
      id: map['id'] ?? '',
      universityId: map['university_id'] ?? 'kyoto_u',
      userId: map['userId'] ?? '',
      category: map['category'] ?? 'other',
      content: map['content'] ?? '',
      contactInfo: map['contactInfo'] ?? '',
      targetPostId: map['targetPostId'],
      createdAt: map['createdAt'] != null ? DateTime.parse(map['createdAt']) : DateTime.now(),
    );
  }
}

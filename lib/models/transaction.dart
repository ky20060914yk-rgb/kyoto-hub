class PointTransaction {
  final String id;
  final String universityId; // 'kyoto_u'
  final String userId;
  final String type; // 'signup_bonus', 'post_reward', 'download_deduction', 'first_post_bonus', 'milestone_bonus', 'referral_bonus', 'textbook_borrow', 'request_cost'
  final int amount; // positive for gain, negative for spent
  final String description;
  final DateTime createdAt;

  PointTransaction({
    required this.id,
    this.universityId = 'kyoto_u',
    required this.userId,
    required this.type,
    required this.amount,
    required this.description,
    required this.createdAt,
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'university_id': universityId,
      'userId': userId,
      'type': type,
      'amount': amount,
      'description': description,
      'createdAt': createdAt.toIso8601String(),
    };
  }

  factory PointTransaction.fromMap(Map<String, dynamic> map) {
    return PointTransaction(
      id: map['id'] ?? '',
      universityId: map['university_id'] ?? 'kyoto_u',
      userId: map['userId'] ?? '',
      type: map['type'] ?? '',
      amount: map['amount'] ?? 0,
      description: map['description'] ?? '',
      createdAt: map['createdAt'] != null ? DateTime.parse(map['createdAt']) : DateTime.now(),
    );
  }
}

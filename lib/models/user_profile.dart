class UserProfile {
  final String uid;
  final String universityId; // 'kyoto_u' for Kyoto University
  final String email;
  final String displayName;
  final DateTime createdAt;
  final int downloadCount;
  final bool isVerified;
  final String? pendingReferralCode;

  UserProfile({
    required this.uid,
    this.universityId = 'kyoto_u',
    required this.email,
    required this.displayName,
    required this.createdAt,
    this.downloadCount = 0,
    this.isVerified = false,
    this.pendingReferralCode,
  });

  UserProfile copyWith({
    String? uid,
    String? universityId,
    String? email,
    String? displayName,
    DateTime? createdAt,
    int? downloadCount,
    bool? isVerified,
    String? pendingReferralCode,
  }) {
    return UserProfile(
      uid: uid ?? this.uid,
      universityId: universityId ?? this.universityId,
      email: email ?? this.email,
      displayName: displayName ?? this.displayName,
      createdAt: createdAt ?? this.createdAt,
      downloadCount: downloadCount ?? this.downloadCount,
      isVerified: isVerified ?? this.isVerified,
      pendingReferralCode: pendingReferralCode ?? this.pendingReferralCode,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'uid': uid,
      'university_id': universityId,
      'email': email,
      'displayName': displayName,
      'createdAt': createdAt.toIso8601String(),
      'downloadCount': downloadCount,
      'isVerified': isVerified,
      // Rules require a string <= 16 chars; omit when unset (null would be denied).
      if (pendingReferralCode != null && pendingReferralCode!.isNotEmpty)
        'pendingReferralCode': pendingReferralCode,
    };
  }

  factory UserProfile.fromMap(Map<String, dynamic> map) {
    return UserProfile(
      uid: map['uid'] ?? '',
      universityId: map['university_id'] ?? 'kyoto_u',
      email: map['email'] ?? '',
      displayName: map['displayName'] ?? '',
      createdAt: map['createdAt'] != null ? DateTime.parse(map['createdAt']) : DateTime.now(),
      downloadCount: map['downloadCount'] ?? 0,
      isVerified: map['isVerified'] ?? false,
      pendingReferralCode: map['pendingReferralCode'],
    );
  }
}

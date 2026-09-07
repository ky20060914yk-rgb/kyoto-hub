class UserProfile {
  final String uid;
  final String universityId; // 'kyoto_u' for Kyoto University
  final String email;
  final String displayName;
  final int points;
  final String invitationCode;
  final DateTime createdAt;
  final int downloadCount;
  final bool isVerified;
  final String? pendingReferralCode;

  UserProfile({
    required this.uid,
    this.universityId = 'kyoto_u',
    required this.email,
    required this.displayName,
    this.points = 30,
    required this.invitationCode,
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
    int? points,
    String? invitationCode,
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
      points: points ?? this.points,
      invitationCode: invitationCode ?? this.invitationCode,
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
      'points': points,
      'invitationCode': invitationCode,
      'createdAt': createdAt.toIso8601String(),
      'downloadCount': downloadCount,
      'isVerified': isVerified,
      'pendingReferralCode': pendingReferralCode,
    };
  }

  factory UserProfile.fromMap(Map<String, dynamic> map) {
    return UserProfile(
      uid: map['uid'] ?? '',
      universityId: map['university_id'] ?? 'kyoto_u',
      email: map['email'] ?? '',
      displayName: map['displayName'] ?? '',
      points: map['points'] ?? 0,
      invitationCode: map['invitationCode'] ?? '',
      createdAt: map['createdAt'] != null ? DateTime.parse(map['createdAt']) : DateTime.now(),
      downloadCount: map['downloadCount'] ?? 0,
      isVerified: map['isVerified'] ?? false,
      pendingReferralCode: map['pendingReferralCode'],
    );
  }
}

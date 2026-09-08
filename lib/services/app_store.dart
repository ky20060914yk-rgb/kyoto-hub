import 'package:flutter/foundation.dart';
import 'package:firebase_auth/firebase_auth.dart' as fb_auth;
import 'dart:math';

import '../models/user_profile.dart';
import '../models/subject.dart';
import '../models/post.dart';
import '../models/request.dart';
import '../models/textbook_request.dart';
import '../models/talk_room.dart';
import '../models/transaction.dart';
import '../models/inquiry.dart';
import '../models/review.dart';
import '../repositories/course_repository.dart';
import 'firestore_service.dart';
import 'review_service.dart';
import '../firebase_options.dart';
import '../utils/download_helper.dart';
import 'package:firebase_storage/firebase_storage.dart' as fb_storage;

class AppStore extends ChangeNotifier {
  /// Course catalog, backed by the Firestore `courses` collection.
  final CourseRepository courses;

  /// Firestore data layer for the review layer (Plan A).
  final ReviewService reviews;

  final FirestoreService _firestore = FirestoreService();
  final fb_auth.FirebaseAuth _firebaseAuth = fb_auth.FirebaseAuth.instance;

  UserProfile? currentUser;
  Map<String, String> userTimetable = {};

  List<Post> posts = [];
  List<MaterialRequest> requests = [];
  List<TextbookRequest> textbookRequests = [];
  List<TalkRoom> talkRooms = [];
  List<PointTransaction> transactions = [];
  List<Inquiry> inquiries = [];

  String? lastNoticeMessage;
  bool isFirebaseConnected = false;
  bool showOnboardingFlow = false;

  void completeOnboarding() {
    showOnboardingFlow = false;
    notifyListeners();
  }

  AppStore(this.courses, this.reviews) {
    // _initSampleData(); // Commented out for production release
    _initFirebaseSync();
  }

  Future<void> _initFirebaseSync() async {
    try {
      // Prime the course catalog cache so the first search / timetable render
      // does not have to wait on a cold collection fetch.
      courses.warmUp().catchError((_) {});

      final href = getUriHref();
      if (href.isNotEmpty && _firebaseAuth.isSignInWithEmailLink(href)) {
        final email = getEmailForSignIn();
        if (email != null && email.isNotEmpty) {
          try {
            final userCredential = await _firebaseAuth.signInWithEmailLink(email: email, emailLink: href);
            final uid = userCredential.user!.uid;

            var profile = await _firestore.getUserProfile(uid);
            if (profile == null) {
              final randomNum = Random().nextInt(9000) + 1000;
              profile = UserProfile(
                uid: uid,
                universityId: 'kyoto_u',
                email: email,
                displayName: '京大生_$randomNum',
                points: 30,
                invitationCode: 'KU${uid.substring(uid.length - 4).toUpperCase()}',
                createdAt: DateTime.now(),
              );
              await _firestore.saveUserProfile(profile);

              _addTransaction(
                userId: uid,
                type: 'signup_bonus',
                amount: 30,
                description: '新規登録ボーナス（過去問約6年分相当）',
              );
            }

            currentUser = profile;
            saveEmailForSignIn('');
            notifyListeners();
          } catch (e) {
            print('Sign in with email link error: $e');
            lastNoticeMessage = 'サインイン用リンクの認証に失敗しました。期限切れか無効なリンクです。';
            notifyListeners();
          }
        }
      }

      _firebaseAuth.authStateChanges().listen((fbUser) async {
        if (fbUser != null && fbUser.email != null) {
          final profile = await _firestore.getUserProfile(fbUser.uid);
          if (profile != null) {
            currentUser = profile;

            final timetable = await _firestore.getUserTimetable(fbUser.uid);
            userTimetable = timetable;

            notifyListeners();

            _firestore.streamTransactions(fbUser.uid).listen((remoteTxs) {
              transactions = remoteTxs;
              notifyListeners();
            }, onError: (_) {});
          }
        }
      }, onError: (_) {});

      _firestore.streamPosts().listen((remotePosts) {
        if (remotePosts.isNotEmpty) {
          posts = remotePosts;
          notifyListeners();
        }
      }, onError: (_) {});

      _firestore.streamMaterialRequests().listen((remoteRequests) {
        if (remoteRequests.isNotEmpty) {
          requests = remoteRequests;
          notifyListeners();
        }
      }, onError: (_) {});

      _firestore.streamTextbookRequests().listen((remoteTextbooks) {
        if (remoteTextbooks.isNotEmpty) {
          textbookRequests = remoteTextbooks;
          notifyListeners();
        }
      }, onError: (_) {});

      _firestore.streamTalkRooms().listen((remoteRooms) {
        if (remoteRooms.isNotEmpty) {
          talkRooms = remoteRooms;
          notifyListeners();
        }
      }, onError: (_) {});

      isFirebaseConnected = true;
    } catch (e) {
      isFirebaseConnected = false;
    }
  }

  // --- ADD / IMPORT CUSTOM SUBJECT (REAL KULASIS DATA) ---

  Future<Subject> addCustomSubject({
    required String name,
    required String faculty,
    required String dayOfWeek,
    required int period,
    required String lecturer,
    required String category,
  }) async {
    final newSubject = await courses.addCustomCourse(
      name: name,
      faculty: faculty,
      dayOfWeek: dayOfWeek,
      period: period,
      lecturer: lecturer,
      category: category,
    );

    lastNoticeMessage = '『$name』をKULASIS科目マスタおよびFirestoreに追加しました！';
    notifyListeners();
    return newSubject;
  }

  Future<void> importSubjectsFromBatch(List<Map<String, dynamic>> subjectList) async {
    int addedCount = 0;
    for (final item in subjectList) {
      if (item['name'] != null && item['dayOfWeek'] != null && item['period'] != null) {
        await addCustomSubject(
          name: item['name'].toString(),
          faculty: item['faculty']?.toString() ?? '全学共通',
          dayOfWeek: item['dayOfWeek'].toString(),
          period: int.tryParse(item['period'].toString()) ?? 1,
          lecturer: item['lecturer']?.toString() ?? '担当教員未定',
          category: item['category']?.toString() ?? '専門/教養',
        );
        addedCount++;
      }
    }
    lastNoticeMessage = '$addedCount 件の科目データを一括登録しました！';
    notifyListeners();
  }

  // --- 1. AUTH & SIGNUP FLOW ---

  Future<bool> signUpWithPassword(String email, String password, {String? referralCode}) async {
    if (!email.endsWith('@st.kyoto-u.ac.jp')) {
      lastNoticeMessage = 'エラー: @st.kyoto-u.ac.jp のメールアドレスのみ登録可能です';
      notifyListeners();
      return false;
    }
    if (password.length < 6) {
      lastNoticeMessage = 'エラー: パスワードは6文字以上で入力してください';
      notifyListeners();
      return false;
    }

    try {
      final userCredential = await _firebaseAuth.createUserWithEmailAndPassword(
        email: email,
        password: password,
      );
      final uid = userCredential.user!.uid;
      final randomNum = Random().nextInt(9000) + 1000;

      await userCredential.user!.sendEmailVerification().catchError((e) {
        print('sendEmailVerification error: $e');
      });

      final profile = UserProfile(
        uid: uid,
        universityId: 'kyoto_u',
        email: email,
        displayName: '京大生_$randomNum',
        points: 0,
        invitationCode: 'KU${uid.substring(uid.length - 4).toUpperCase()}',
        createdAt: DateTime.now(),
        isVerified: false,
        pendingReferralCode: referralCode,
      );

      await _firestore.saveUserProfile(profile);
      currentUser = profile;

      showOnboardingFlow = true;
      notifyListeners();
      return true;
    } catch (e) {
      print('Signup error: $e');
      lastNoticeMessage = '登録に失敗しました。このメールアドレスは既に登録されている可能性があります。';
      notifyListeners();
      return false;
    }
  }

  Future<bool> signInWithPassword(String email, String password) async {
    if (!email.endsWith('@st.kyoto-u.ac.jp')) {
      lastNoticeMessage = 'エラー: @st.kyoto-u.ac.jp のメールアドレスのみログイン可能です';
      notifyListeners();
      return false;
    }

    try {
      final userCredential = await _firebaseAuth.signInWithEmailAndPassword(
        email: email,
        password: password,
      );
      final uid = userCredential.user!.uid;

      final profile = await _firestore.getUserProfile(uid);
      if (profile != null) {
        currentUser = profile;
        notifyListeners();
        return true;
      } else {
        lastNoticeMessage = 'ユーザープロファイルが見つかりません。';
        notifyListeners();
        return false;
      }
    } catch (e) {
      print('SignIn error: $e');
      lastNoticeMessage = 'ログインに失敗しました。メールアドレスまたはパスワードが正しくありません。';
      notifyListeners();
      return false;
    }
  }

  void logout() {
    currentUser = null;
    userTimetable.clear();
    notifyListeners();
  }

  Future<bool> checkEmailVerification() async {
    final fbUser = _firebaseAuth.currentUser;
    if (fbUser == null) return false;

    await fbUser.reload(); // Refresh the user state
    // `reload()` refreshes the user record but NOT the cached ID token, and the
    // Firestore rules read `request.auth.token.email_verified`. Without a forced
    // token refresh a freshly-verified user would be denied every content write
    // until the token expired (~1h). Cheap and harmless when already fresh.
    await fbUser.getIdToken(true);
    final isEmailVerified = fbUser.emailVerified;

    if (isEmailVerified) {
      if (currentUser != null && !currentUser!.isVerified) {
        int bonus = 30; // Signup bonus
        _addTransaction(
          userId: currentUser!.uid,
          type: 'signup_bonus',
          amount: 30,
          description: '新規登録ボーナス（過去問約6年分相当）',
        );

        // Resolve the referrer first (a read), but credit them only AFTER this
        // user's own verified/bonus state is persisted: writing another user's
        // profile is denied by the `users` ownership rule, so it must never sit
        // between us and our own save.
        UserProfile? referrer;
        final refCode = currentUser!.pendingReferralCode;
        if (refCode != null && refCode.trim().isNotEmpty) {
          referrer = await _firestore.getUserByInvitationCode(refCode.trim());
        }

        if (referrer != null) {
          // Reward referred (new user)
          bonus += 10;
          _addTransaction(
            userId: currentUser!.uid,
            type: 'referral_bonus',
            amount: 10,
            description: '招待コード特典（被招待者ボーナス）',
          );
        }

        currentUser = currentUser!.copyWith(
          isVerified: true,
          points: bonus,
          pendingReferralCode: null,
        );

        await _firestore.saveUserProfile(currentUser!);

        if (referrer != null) {
          // Cross-user write: denied by the `users` ownership rule, so it is
          // best-effort only. Reconciled server-side in Phase 2.
          final updatedReferrer = referrer.copyWith(points: referrer.points + 10);
          await _firestore.saveUserProfile(updatedReferrer).catchError((_) {});
          _addTransaction(
            userId: referrer.uid,
            type: 'referral_bonus',
            amount: 10,
            description: '招待コード特典（招待ボーナス） [${currentUser!.displayName} が登録]',
          );
        }

        lastNoticeMessage = 'メールアドレスの検証が完了しました！ ボーナス ${bonus}pt を付与しました！';
        notifyListeners();
        return true;
      }
    }
    return isEmailVerified;
  }

  Future<void> resendVerificationEmail() async {
    final fbUser = _firebaseAuth.currentUser;
    if (fbUser != null) {
      await fbUser.sendEmailVerification();
      lastNoticeMessage = '検証用の確認メールを再送信しました。';
      notifyListeners();
    }
  }

  Future<bool> updateDisplayName(String newName) async {
    if (newName.trim().isEmpty) {
      lastNoticeMessage = 'エラー: ユーザー名を入力してください';
      notifyListeners();
      return false;
    }
    if (currentUser == null) return false;

    try {
      currentUser = currentUser!.copyWith(displayName: newName.trim());
      await _firestore.saveUserProfile(currentUser!);
      lastNoticeMessage = 'ユーザー名を更新しました！';
      notifyListeners();
      return true;
    } catch (e) {
      print('Update displayName error: $e');
      lastNoticeMessage = 'ユーザー名の更新に失敗しました。';
      notifyListeners();
      return false;
    }
  }

  // --- 2. TIMETABLE REGISTRATION ---

  void registerTimetableSubject(String dayOfWeek, int period, String subjectId) {
    final key = '${dayOfWeek}_$period';
    userTimetable[key] = subjectId;

    if (currentUser != null) {
      _firestore.saveUserTimetable(currentUser!.uid, userTimetable).catchError((_) {});
    }

    notifyListeners();
  }

  void removeTimetableSubject(String dayOfWeek, int period) {
    final key = '${dayOfWeek}_$period';
    userTimetable.remove(key);

    if (currentUser != null) {
      _firestore.saveUserTimetable(currentUser!.uid, userTimetable).catchError((_) {});
    }

    notifyListeners();
  }

  Future<List<Subject>> getRegisteredSubjects() async {
    final List<Subject> list = [];
    for (final id in userTimetable.values.toSet()) {
      final sub = await courses.byId(id);
      if (sub != null && !list.any((element) => element.id == sub.id)) {
        list.add(sub);
      }
    }
    return list;
  }

  // --- 3. POSTS & POINT REWARDS ENGINE ---

  List<Post> getPostsForSubject(String subjectId, PostCategory category) {
    return posts
        .where((p) => p.subjectId == subjectId && p.category == category)
        .toList()
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
  }

  List<MaterialRequest> getRequestsForSubject(String subjectId, PostCategory category) {
    return requests
        .where((r) => r.subjectId == subjectId && r.category == category)
        .toList()
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
  }

  Future<bool> addPost({
    required String subjectId,
    required PostCategory category,
    int? year,
    required String title,
    required String description,
    required List<String> fileNames,
    required int downloadCost,
    String? requestId,
  }) async {
    if (currentUser == null) return false;

    final sub = await courses.byId(subjectId);
    final subjectName = sub?.name ?? '不明な科目';

    int cost = downloadCost;
    if (category == PostCategory.pastExam) {
      cost = 5;
    } else {
      cost = cost.clamp(0, 20);
    }

    final newPostId = 'post_${DateTime.now().millisecondsSinceEpoch}';
    final bucket = DefaultFirebaseOptions.currentPlatform.storageBucket ?? 'kyodai-sns.firebasestorage.app';

    final newPost = Post(
      id: newPostId,
      universityId: 'kyoto_u',
      subjectId: subjectId,
      subjectName: subjectName,
      authorId: currentUser!.uid,
      authorName: currentUser!.displayName,
      category: category,
      year: year,
      title: title,
      description: description,
      fileUrls: fileNames.map((n) => 'https://firebasestorage.googleapis.com/v0/b/$bucket/o/${Uri.encodeComponent(n)}?alt=media').toList(),
      fileNames: fileNames,
      downloadCost: cost,
      createdAt: DateTime.now(),
      requestId: requestId,
    );

    posts.insert(0, newPost);
    _firestore.createPost(newPost).catchError((_) {});

    int bonusAmount = 0;

    // Check daily limit of upload rewards (up to 3 uploads per day)
    final now = DateTime.now();
    final todayUploadsCount = posts.where((p) {
      return p.authorId == currentUser!.uid &&
          p.createdAt.year == now.year &&
          p.createdAt.month == now.month &&
          p.createdAt.day == now.day;
    }).length;

    final bool isLimitReached = todayUploadsCount > 3; // > 3 since we just added newPost to local posts!

    if (!isLimitReached) {
      if (category == PostCategory.pastExam && year != null && year <= 2020) {
        // 2020 or earlier: 0pt initial reward
        bonusAmount = 0;
      } else {
        bonusAmount = 5;
        _addTransaction(
          userId: currentUser!.uid,
          type: 'post_reward',
          amount: 5,
          description: '投稿ボーナス (+5pt) [${category.label}]',
        );
      }
    }

    // Check if fulfilling a request
    if (requestId != null) {
      final reqIdx = requests.indexWhere((r) => r.id == requestId);
      if (reqIdx != -1) {
        final req = requests[reqIdx];
        if (!req.isFulfilled) {
          final reward = req.rewardPoints;
          bonusAmount += reward;

          requests[reqIdx] = req.copyWith(isFulfilled: true, fulfilledPostId: newPostId);
          _firestore.createMaterialRequest(requests[reqIdx]).catchError((_) {});

          _addTransaction(
            userId: currentUser!.uid,
            type: 'request_fulfillment_reward',
            amount: reward,
            description: 'リクエスト解決報酬獲得 (+${reward}pt) [${req.title}]',
          );
        }
      }
    }

    currentUser = currentUser!.copyWith(points: currentUser!.points + bonusAmount);
    _firestore.saveUserProfile(currentUser!).catchError((_) {});

    if (isLimitReached) {
      lastNoticeMessage = '資料のアップロードが成功しました！（本日のポイント付与上限に達したため、ボーナスptは付与されません）';
    } else {
      lastNoticeMessage = '資料のアップロードが成功しました！ ボーナス+${bonusAmount}ptを獲得！';
    }
    notifyListeners();
    return true;
  }

  bool downloadPost(Post post) {
    if (currentUser == null) return false;

    // Check if free for the current user (author or requester)
    bool isFree = false;
    if (post.authorId == currentUser!.uid) {
      isFree = true;
    } else {
      final isRequester = requests.any((r) => r.fulfilledPostId == post.id && r.authorId == currentUser!.uid);
      if (isRequester) {
        isFree = true;
      }
    }

    final cost = isFree ? 0 : post.downloadCost;

    if (cost > 0 && currentUser!.points < cost) {
      lastNoticeMessage = 'ポイントが不足しています。必要: ${cost}pt, 保有: ${currentUser!.points}pt';
      notifyListeners();
      return false;
    }

    currentUser = currentUser!.copyWith(
      points: currentUser!.points - cost,
      downloadCount: currentUser!.downloadCount + 1,
    );

    _firestore.saveUserProfile(currentUser!).catchError((_) {});

    if (cost > 0) {
      _addTransaction(
        userId: currentUser!.uid,
        type: 'download_deduction',
        amount: -cost,
        description: '資料ダウンロード [${post.title}] (${cost}pt消費)',
      );
    } else {
      _addTransaction(
        userId: currentUser!.uid,
        type: 'download_free',
        amount: 0,
        description: '資料ダウンロード (無料/特典) [${post.title}]',
      );
    }

    final index = posts.indexWhere((p) => p.id == post.id);
    if (index != -1) {
      final newDLCount = posts[index].downloadCount + 1;

      // Calculate standard royalty for uploader (80%)
      final uploaderReward = (cost * 0.8).floor();
      if (uploaderReward > 0 && post.authorId != currentUser!.uid) {
        _addTransaction(
          userId: post.authorId,
          type: 'uploader_royalty',
          amount: uploaderReward,
          description: '資料ダウンロード還元 (+80%) [${post.title}]',
        );

        _firestore.getUserProfile(post.authorId).then((authorProfile) {
          if (authorProfile != null) {
            final updatedAuthor = authorProfile.copyWith(points: authorProfile.points + uploaderReward);
            _firestore.saveUserProfile(updatedAuthor).catchError((_) {});
          }
        }).catchError((_) {});
      }

      // Check per-post milestones (5 DL = +5pt, 10 DL = +10pt)
      bool trigger5 = false;
      bool trigger10 = false;
      int milestoneReward = 0;
      String? milestoneType;
      String? milestoneDesc;

      if (newDLCount == 5 && !posts[index].is5DownloadsRewarded && post.authorId != currentUser!.uid) {
        milestoneReward = 5;
        milestoneType = 'uploader_milestone_5';
        milestoneDesc = 'ダウンロード数5件達成ボーナス (+5pt) [${post.title}]';
        trigger5 = true;
      } else if (newDLCount == 10 && !posts[index].is10DownloadsRewarded && post.authorId != currentUser!.uid) {
        milestoneReward = 10;
        milestoneType = 'uploader_milestone_10';
        milestoneDesc = 'ダウンロード数10件達成ボーナス (+10pt) [${post.title}]';
        trigger10 = true;
      }

      if (milestoneReward > 0 && milestoneType != null && milestoneDesc != null) {
        _addTransaction(
          userId: post.authorId,
          type: milestoneType,
          amount: milestoneReward,
          description: milestoneDesc,
        );

        _firestore.getUserProfile(post.authorId).then((authorProfile) {
          if (authorProfile != null) {
            final updatedAuthor = authorProfile.copyWith(points: authorProfile.points + milestoneReward);
            _firestore.saveUserProfile(updatedAuthor).catchError((_) {});
          }
        }).catchError((_) {});
      }

      final updatedPost = posts[index].copyWith(
        downloadCount: newDLCount,
        is5DownloadsRewarded: trigger5 ? true : posts[index].is5DownloadsRewarded,
        is10DownloadsRewarded: trigger10 ? true : posts[index].is10DownloadsRewarded,
      );
      posts[index] = updatedPost;

      _firestore.updatePostMilestones(
        postId: post.id,
        downloadCount: newDLCount,
        is5DownloadsRewarded: updatedPost.is5DownloadsRewarded,
        is10DownloadsRewarded: updatedPost.is10DownloadsRewarded,
      ).catchError((_) {});
    }

    if (post.fileUrls.isNotEmpty) {
      openUrlInNewTab(post.fileUrls.first);
    }

    lastNoticeMessage = isFree
        ? '資料ダウンロードを開始しました！ (無料特典)'
        : 'Cloud Storageから資料ダウンロードを開始しました！ (${cost}pt消費)';
    notifyListeners();
    return true;
  }

  Future<String?> uploadFileToStorage(String fileName, Uint8List fileBytes) async {
    try {
      final uniqueName = '${DateTime.now().millisecondsSinceEpoch}_$fileName';
      final ref = fb_storage.FirebaseStorage.instance.ref().child(uniqueName);
      await ref.putData(fileBytes);
      return uniqueName;
    } catch (e) {
      print('Firebase Storage upload error: $e');
      lastNoticeMessage = 'ストレージへのファイルアップロードに失敗しました。';
      notifyListeners();
      return null;
    }
  }

  Future<void> deletePost(String postId) async {
    final idx = posts.indexWhere((p) => p.id == postId);
    if (idx == -1) return;
    final post = posts[idx];

    posts.removeAt(idx);
    await _firestore.deletePost(postId).catchError((_) {});

    if (currentUser != null && post.authorId == currentUser!.uid) {
      int deductPoints = 0;
      if (post.category == PostCategory.pastExam && post.year != null && post.year! <= 2020) {
        deductPoints = 0;
      } else {
        deductPoints = 5;
        _addTransaction(
          userId: currentUser!.uid,
          type: 'post_deleted_penalty',
          amount: -5,
          description: '投稿削除に伴うボーナス回収 (-5pt) [${post.title}]',
        );
      }

      if (post.is5DownloadsRewarded) {
        deductPoints += 5;
        _addTransaction(
          userId: currentUser!.uid,
          type: 'milestone_5_deleted_penalty',
          amount: -5,
          description: '5DLマイルストーンボーナス回収 (-5pt) [${post.title}]',
        );
      }
      if (post.is10DownloadsRewarded) {
        deductPoints += 10;
        _addTransaction(
          userId: currentUser!.uid,
          type: 'milestone_10_deleted_penalty',
          amount: -10,
          description: '10DLマイルストーンボーナス回収 (-10pt) [${post.title}]',
        );
      }

      currentUser = currentUser!.copyWith(points: (currentUser!.points - deductPoints).clamp(0, 99999));
      await _firestore.saveUserProfile(currentUser!).catchError((_) {});
    }

    lastNoticeMessage = '投稿を削除し、付与されたボーナスポイントを回収しました。';
    notifyListeners();
  }

  Future<void> reportPost(String postId) async {
    if (currentUser == null) return;
    final idx = posts.indexWhere((p) => p.id == postId);
    if (idx == -1) return;

    final post = posts[idx];
    if (post.reports.contains(currentUser!.uid)) {
      lastNoticeMessage = '既にこの投稿を通報済みです。';
      notifyListeners();
      return;
    }

    final updatedReports = List<String>.from(post.reports)..add(currentUser!.uid);
    final updatedPost = post.copyWith(reports: updatedReports);

    if (updatedReports.length >= 3) {
      // Auto-delete / hide the post!
      posts.removeAt(idx);
      // Persist this third report FIRST: the auto-moderation delete rule checks
      // the stored `reports` size, so deleting before the report lands would be
      // denied (the server would still see only two reports).
      await _firestore.updatePostReports(postId, updatedReports).catchError((_) {});
      await _firestore.deletePost(postId).catchError((_) {});

      // Claw back points from uploader!
      final uploaderProfile = await _firestore.getUserProfile(post.authorId);
      if (uploaderProfile != null) {
        int penalty = 0;
        if (post.category == PostCategory.pastExam && post.year != null && post.year! <= 2020) {
          penalty = 0;
        } else {
          penalty = 5;
        }

        if (post.is5DownloadsRewarded) penalty += 5;
        if (post.is10DownloadsRewarded) penalty += 10;

        final updatedUploader = uploaderProfile.copyWith(
          points: (uploaderProfile.points - penalty).clamp(0, 99999)
        );
        // Cross-user write (the uploader's profile, from the reporter's
        // session): denied by the `users` ownership rule, so it is best-effort.
        // Without the guard the PERMISSION_DENIED would escape reportPost() and
        // hang the report dialog, which has no try/catch.
        await _firestore.saveUserProfile(updatedUploader).catchError((_) {});

        _addTransaction(
          userId: post.authorId,
          type: 'report_deletion_penalty',
          amount: -penalty,
          description: '通報過多による投稿自動削除に伴うポイント回収 (-${penalty}pt) [${post.title}]',
        );
      }
      lastNoticeMessage = '通報が3件に達したため、投稿は自動削除されポイントが回収されました。';
    } else {
      posts[idx] = updatedPost;
      await _firestore.updatePostReports(postId, updatedReports).catchError((_) {});
      lastNoticeMessage = '投稿を通報しました。ご協力ありがとうございます。';
    }
    notifyListeners();
  }

  Future<bool> addMaterialRequest({
    required String subjectId,
    required PostCategory category,
    int? year,
    required String title,
    required String description,
    required int rewardPoints,
  }) async {
    if (currentUser == null) return false;

    final cost = category == PostCategory.pastExam ? 1 : 0;
    final totalCost = cost + rewardPoints;

    if (currentUser!.points < totalCost) {
      lastNoticeMessage = 'ポイントが不足しています。必要: ${totalCost}pt, 保有: ${currentUser!.points}pt';
      notifyListeners();
      return false;
    }

    if (totalCost > 0) {
      currentUser = currentUser!.copyWith(points: currentUser!.points - totalCost);
      _firestore.saveUserProfile(currentUser!).catchError((_) {});

      _addTransaction(
        userId: currentUser!.uid,
        type: 'request_cost',
        amount: -totalCost,
        description: '過去問リクエスト投稿 [報酬: ${rewardPoints}pt含む] (-${totalCost}pt)',
      );
    }

    final sub = await courses.byId(subjectId);

    final req = MaterialRequest(
      id: 'req_${DateTime.now().millisecondsSinceEpoch}',
      universityId: 'kyoto_u',
      subjectId: subjectId,
      subjectName: sub?.name ?? '不明な科目',
      authorId: currentUser!.uid,
      authorName: currentUser!.displayName,
      category: category,
      year: year,
      title: title,
      description: description,
      costSpent: cost,
      rewardPoints: rewardPoints,
      createdAt: DateTime.now(),
    );

    requests.insert(0, req);
    _firestore.createMaterialRequest(req).catchError((_) {});

    lastNoticeMessage = 'Cloud Firestoreへリクエストを投稿しました！';
    notifyListeners();
    return true;
  }

  Future<bool> addTextbookRequest({
    required String subjectId,
    required String bookTitle,
  }) async {
    if (currentUser == null) return false;

    final sub = await courses.byId(subjectId);

    final req = TextbookRequest(
      id: 'tb_${DateTime.now().millisecondsSinceEpoch}',
      universityId: 'kyoto_u',
      requesterId: currentUser!.uid,
      requesterName: currentUser!.displayName,
      subjectId: subjectId,
      subjectName: sub?.name ?? '不明な科目',
      bookTitle: bookTitle,
      status: TextbookRequestStatus.open,
      createdAt: DateTime.now(),
    );

    textbookRequests.insert(0, req);
    _firestore.createTextbookRequest(req).catchError((_) {});

    lastNoticeMessage = '参考書リクエストを投稿しました！';
    notifyListeners();
    return true;
  }

  bool respondToTextbookRequest(TextbookRequest req) {
    if (currentUser == null) return false;

    if (req.requesterId == currentUser!.uid) {
      lastNoticeMessage = '自分のリクエストに応答することはできません。';
      notifyListeners();
      return false;
    }

    final roomId = 'room_${DateTime.now().millisecondsSinceEpoch}';

    final room = TalkRoom(
      id: roomId,
      universityId: 'kyoto_u',
      requestId: req.id,
      bookTitle: req.bookTitle,
      subjectName: req.subjectName,
      borrowerId: req.requesterId,
      borrowerName: req.requesterName,
      lenderId: currentUser!.uid,
      lenderName: currentUser!.displayName,
      messages: [
        ChatMessage(
          id: 'msg_1',
          senderId: currentUser!.uid,
          senderName: currentUser!.displayName,
          text: '『${req.bookTitle}』をお貸しできます！受け渡し場所や日時を相談させてください。',
          createdAt: DateTime.now(),
        ),
      ],
      createdAt: DateTime.now(),
      warningNotice: '取引が完了しなかった場合、アカウント停止の可能性があります',
    );

    talkRooms.insert(0, room);
    _firestore.createTalkRoom(room).catchError((_) {});

    final idx = textbookRequests.indexWhere((t) => t.id == req.id);
    if (idx != -1) {
      textbookRequests[idx] = textbookRequests[idx].copyWith(
        status: TextbookRequestStatus.matched,
        responderId: currentUser!.uid,
        responderName: currentUser!.displayName,
        talkRoomId: roomId,
      );
      _firestore.createTextbookRequest(textbookRequests[idx]).catchError((_) {});
    }

    _addTransaction(
      userId: req.requesterId,
      type: 'textbook_borrow',
      amount: -20,
      description: '参考書貸し借り一律決済 (-20pt) [${req.bookTitle}]',
    );

    lastNoticeMessage = '貸し出しに応答しました！20pt決済が行われ、トークルームを作成しました。';
    notifyListeners();
    return true;
  }

  void sendMessageToTalkRoom(String roomId, String text) {
    if (currentUser == null || text.trim().isEmpty) return;

    final idx = talkRooms.indexWhere((r) => r.id == roomId);
    if (idx != -1) {
      final newMsg = ChatMessage(
        id: 'msg_${DateTime.now().millisecondsSinceEpoch}',
        senderId: currentUser!.uid,
        senderName: currentUser!.displayName,
        text: text,
        createdAt: DateTime.now(),
      );

      final updatedMessages = List<ChatMessage>.from(talkRooms[idx].messages)..add(newMsg);

      talkRooms[idx] = TalkRoom(
        id: talkRooms[idx].id,
        universityId: talkRooms[idx].universityId,
        requestId: talkRooms[idx].requestId,
        bookTitle: talkRooms[idx].bookTitle,
        subjectName: talkRooms[idx].subjectName,
        borrowerId: talkRooms[idx].borrowerId,
        borrowerName: talkRooms[idx].borrowerName,
        lenderId: talkRooms[idx].lenderId,
        lenderName: talkRooms[idx].lenderName,
        messages: updatedMessages,
        createdAt: talkRooms[idx].createdAt,
        warningNotice: talkRooms[idx].warningNotice,
      );

      _firestore.addChatMessage(roomId, newMsg).catchError((_) {});
      notifyListeners();
    }
  }

  void submitInquiry({
    required String category,
    required String content,
    required String contactInfo,
    String? targetPostId,
  }) {
    if (currentUser == null) return;

    final inq = Inquiry(
      id: 'inq_${DateTime.now().millisecondsSinceEpoch}',
      universityId: 'kyoto_u',
      userId: currentUser!.uid,
      category: category,
      content: content,
      contactInfo: contactInfo,
      targetPostId: targetPostId,
      createdAt: DateTime.now(),
    );

    inquiries.add(inq);
    _firestore.submitInquiry(inq).catchError((_) {});

    lastNoticeMessage = category == 'report'
        ? '通報を受け付けました。運営にて確認いたします。'
        : 'お問い合わせを送信しました。運営からの連絡をお待ちください。';
    notifyListeners();
  }

  // --- Review layer (Plan A) -------------------------------------------------

  /// Create or edit the signed-in user's review for a course. Returns whether
  /// the write landed; on failure [lastNoticeMessage] carries the reason.
  Future<bool> submitReview({
    required String courseKey,
    required String courseName,
    required int rating,
    required Rakutan rakutan,
    required Attendance attendance,
    required GradingStyle grading,
    required PastExamUsefulness pastExam,
    required BringIn bringIn,
    required String comment,
    String? termTaken,
    String? gradeTaken,
  }) async {
    final user = currentUser;
    if (user == null) return false;
    if (!user.isVerified) {
      lastNoticeMessage = 'メール認証の完了後にレビューを投稿できます。';
      notifyListeners();
      return false;
    }
    final existing = await reviews.getMyReview(courseKey, user.uid);
    final now = DateTime.now();
    final review = Review(
      id: Review.docId(courseKey, user.uid),
      courseKey: courseKey,
      courseName: courseName,
      authorId: user.uid,
      authorName: user.displayName,
      rating: rating,
      rakutan: rakutan,
      attendance: attendance,
      grading: grading,
      pastExam: pastExam,
      bringIn: bringIn,
      comment: comment.trim(),
      termTaken: termTaken,
      gradeTaken: gradeTaken,
      helpfulBy: existing?.helpfulBy ?? const [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    );
    try {
      await reviews.submitReview(review);
      lastNoticeMessage =
          existing == null ? 'レビューを投稿しました！' : 'レビューを更新しました。';
      notifyListeners();
      return true;
    } catch (e) {
      lastNoticeMessage = 'レビューの保存に失敗しました。通信環境を確認してください。';
      notifyListeners();
      return false;
    }
  }

  /// Remove the signed-in user's review for [courseKey], if any.
  Future<void> deleteMyReview(String courseKey) async {
    final user = currentUser;
    if (user == null) return;
    final existing = await reviews.getMyReview(courseKey, user.uid);
    if (existing == null) return;
    try {
      await reviews.deleteReview(existing);
      lastNoticeMessage = 'レビューを削除しました。';
    } catch (_) {
      lastNoticeMessage = 'レビューの削除に失敗しました。';
    }
    notifyListeners();
  }

  /// Mark a review as helpful (best-effort; idempotent in [ReviewService]).
  Future<void> markReviewHelpful(String reviewId) async {
    final user = currentUser;
    if (user == null || !user.isVerified) return;
    try {
      await reviews.markHelpful(reviewId: reviewId, uid: user.uid);
    } catch (_) {/* best-effort */}
    notifyListeners();
  }

  void _addTransaction({
    required String userId,
    required String type,
    required int amount,
    required String description,
  }) {
    final tx = PointTransaction(
      id: 'tx_${DateTime.now().millisecondsSinceEpoch}_${transactions.length}',
      universityId: 'kyoto_u',
      userId: userId,
      type: type,
      amount: amount,
      description: description,
      createdAt: DateTime.now(),
    );
    transactions.insert(0, tx);
    _firestore.recordTransaction(tx).catchError((_) {});
  }
}

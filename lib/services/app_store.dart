import 'package:flutter/foundation.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart' as fb_auth;
import 'dart:async';
import 'dart:math';

import '../models/user_profile.dart';
import '../models/subject.dart';
import '../models/post.dart';
import '../models/request.dart';
import '../models/textbook_request.dart';
import '../models/talk_room.dart';
import '../models/credit_ledger_entry.dart';
import '../models/inquiry.dart';
import '../models/review.dart';
import '../repositories/course_repository.dart';
import '../repositories/inquiry_repository.dart';
import '../repositories/post_repository.dart';
import '../repositories/request_repository.dart';
import '../repositories/user_repository.dart';
import 'firestore_service.dart';
import 'review_service.dart';
import 'ranking_service.dart';
import 'credit_service.dart';
import 'moderation_service.dart';
import '../models/app_notification.dart';
import '../utils/download_helper.dart';
import 'package:firebase_storage/firebase_storage.dart' as fb_storage;

class AppStore extends ChangeNotifier {
  /// Course catalog, backed by the Firestore `courses` collection.
  final CourseRepository courses;

  /// Firestore data layer for the review layer (Plan A).
  final ReviewService reviews;

  /// Client-side rankings over course_stats pool.
  final RankingService ranking;

  /// Plan 3 (Task 9): injectable so tests run AppStore on `fake_cloud_firestore`.
  final FirebaseFirestore _db;
  late final FirestoreService _firestore = FirestoreService(_db);

  /// Feature repositories (Plan 3, Task 10): AppStore keeps the session state
  /// and the UI-facing notices; data access lives in these.
  late final UserRepository _userRepo = UserRepository(_db);
  late final PostRepository _postRepo = PostRepository(_db);
  late final RequestRepository _requestRepo = RequestRepository(_db);
  late final InquiryRepository _inquiryRepo = InquiryRepository(_db);

  /// Resolved on use, not at construction: a test (no Firebase app) can build an
  /// AppStore; `_initFirebaseSync` then fails inside its own try/catch.
  fb_auth.FirebaseAuth get _firebaseAuth => fb_auth.FirebaseAuth.instance;

  UserProfile? currentUser;
  Map<String, String> userTimetable = {};

  List<Post> posts = [];
  List<MaterialRequest> requests = [];
  List<TextbookRequest> textbookRequests = [];
  List<TalkRoom> talkRooms = [];
  List<Inquiry> inquiries = [];

  String? lastNoticeMessage;
  bool isFirebaseConnected = false;
  bool showOnboardingFlow = false;

  void completeOnboarding() {
    showOnboardingFlow = false;
    notifyListeners();
  }

  /// Credit balance/ledger streams and the signed-download callable (Plan 2A).
  final CreditService credits;
  int creditBalance = 0;
  List<CreditLedgerEntry> ledger = [];
  String? invitationCode; // own code, issued server-side (P2-2)
  StreamSubscription<String?>? _codeSub;
  StreamSubscription<int>? _balanceSub;
  StreamSubscription<List<CreditLedgerEntry>>? _ledgerSub;

  /// Report / takedown callables and the caller's own moderation notices (Plan 2B).
  final ModerationService moderation;
  List<AppNotification> notifications = [];
  int get unreadNotificationCount => notifications.where((n) => !n.read).length;
  StreamSubscription<List<AppNotification>>? _notifSub;
  StreamSubscription<List<TalkRoom>>? _roomsSub;

  /// Per-user streams the Plan 2B rules only allow once the uid is known: the
  /// caller's own notices and the talk rooms they take part in.
  void _watchUserStreams(String uid) {
    _notifSub?.cancel();
    _roomsSub?.cancel();
    _notifSub = moderation.streamNotifications(uid).listen((n) {
      notifications = n;
      notifyListeners();
    }, onError: (_) {});
    _roomsSub = _firestore.streamTalkRoomsFor(uid).listen((rooms) {
      talkRooms = rooms;
      notifyListeners();
    }, onError: (_) {});
  }

  /// Marks every unread notice read (the only client write the rules allow on
  /// `notifications`). Best-effort.
  Future<void> markNotificationsRead() async {
    for (final n in notifications.where((n) => !n.read).toList()) {
      try {
        await moderation.markNotificationRead(n.id);
      } catch (_) {/* retried next time the screen opens */}
    }
  }

  void _watchCredits(String uid) {
    _balanceSub?.cancel();
    _codeSub?.cancel();
    _ledgerSub?.cancel();
    _balanceSub = credits.streamBalance(uid).listen((b) {
      creditBalance = b;
      notifyListeners();
    }, onError: (_) {});
    _codeSub = credits.streamInvitationCode(uid).listen((c) {
      invitationCode = c;
      notifyListeners();
    }, onError: (_) {});
    _ledgerSub = credits.streamLedger(uid).listen((l) {
      ledger = l;
      notifyListeners();
    }, onError: (_) {});
  }

  /// Idempotent server-side (a flag on the balance doc), so calling it on every
  /// verified login is cheap and also back-fills users who verified before
  /// Plan 2A shipped.
  /// Returns null when the call failed (retried on the next login or
  /// verification check), otherwise whether this call actually granted credits.
  bool _welcomePending = false;
  Future<bool?> _claimWelcome() async {
    try {
      final r = await credits.claimWelcome();
      _welcomePending = false;
      return r.granted;
    } catch (_) {
      _welcomePending = true;
      return null;
    }
  }

  AppStore(this.courses, this.reviews, this.ranking, this.credits, this.moderation, {FirebaseFirestore? db})
      : _db = db ?? FirebaseFirestore.instance {
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

            var profile = await _userRepo.getUserProfile(uid);
            if (profile == null) {
              final randomNum = Random().nextInt(9000) + 1000;
              profile = UserProfile(
                uid: uid,
                universityId: 'kyoto_u',
                email: email,
                displayName: '京大生_$randomNum',
                createdAt: DateTime.now(),
              );
              await _userRepo.saveUserProfile(profile);

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
          final profile = await _userRepo.getUserProfile(fbUser.uid);
          if (profile != null) {
            currentUser = profile;
            _watchCredits(fbUser.uid);
            _watchUserStreams(fbUser.uid);
            if (fbUser.emailVerified) _claimWelcome();

            final timetable = await _userRepo.getUserTimetable(fbUser.uid);
            userTimetable = timetable;

            notifyListeners();
          }
        }
      }, onError: (_) {});

      _postRepo.streamPosts().listen((remotePosts) {
        if (remotePosts.isNotEmpty) {
          posts = remotePosts;
          notifyListeners();
        }
      }, onError: (_) {});

      _requestRepo.streamMaterialRequests().listen((remoteRequests) {
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

  /// Rules cap the hint at 16 chars; the server validates it for real.
  String? _cleanReferral(String? raw) {
    final t = raw?.trim().toUpperCase() ?? '';
    if (t.isEmpty) return null;
    return t.length > 16 ? t.substring(0, 16) : t;
  }

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
        createdAt: DateTime.now(),
        isVerified: false,
        pendingReferralCode: _cleanReferral(referralCode),
      );

      await _userRepo.saveUserProfile(profile);
      currentUser = profile;
      _watchCredits(uid); // authStateChanges may fire before the profile exists
      _watchUserStreams(uid);

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

      final profile = await _userRepo.getUserProfile(uid);
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
    _balanceSub?.cancel();
    _codeSub?.cancel();
    _ledgerSub?.cancel();
    _notifSub?.cancel();
    _roomsSub?.cancel();
    notifications = [];
    talkRooms = [];
    creditBalance = 0;
    invitationCode = null;
    ledger = [];
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

    if (isEmailVerified && currentUser != null && (!currentUser!.isVerified || _welcomePending)) {
      if (!currentUser!.isVerified) {
        currentUser = currentUser!.copyWith(isVerified: true);
        await _userRepo.saveUserProfile(currentUser!);
      }
      final granted = await _claimWelcome();
      lastNoticeMessage = granted == null
          ? 'メールアドレスの検証が完了しました！ クレジットの付与は次回ログイン時に再試行されます。'
          : granted
              ? 'メールアドレスの検証が完了しました！ ご登録ボーナスとして3クレジットを付与しました。'
              : 'メールアドレスの検証が完了しました！';
      notifyListeners();
      return true;
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
      await _userRepo.saveUserProfile(currentUser!);
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
      _userRepo.saveUserTimetable(currentUser!.uid, userTimetable).catchError((_) {});
    }

    notifyListeners();
  }

  void removeTimetableSubject(String dayOfWeek, int period) {
    final key = '${dayOfWeek}_$period';
    userTimetable.remove(key);

    if (currentUser != null) {
      _userRepo.saveUserTimetable(currentUser!.uid, userTimetable).catchError((_) {});
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
    required List<String> filePaths,
    String? requestId,
  }) async {
    if (currentUser == null) return false;
    final sub = await courses.byId(subjectId);
    final newPost = Post(
      id: 'post_${DateTime.now().millisecondsSinceEpoch}',
      universityId: 'kyoto_u',
      subjectId: subjectId,
      subjectName: sub?.name ?? '不明な科目',
      authorId: currentUser!.uid,
      authorName: currentUser!.displayName,
      category: category,
      year: year,
      title: title,
      description: description,
      filePaths: filePaths,
      fileNames: fileNames,
      createdAt: DateTime.now(),
      requestId: requestId,
    );
    // Await the write: rules can deny it (bad path, unverified, ...) and the UI
    // must not claim success. Only then add it locally and bump the counter.
    try {
      await _postRepo.createPost(newPost);
    } catch (_) {
      lastNoticeMessage = '投稿に失敗しました。ファイルの形式・サイズやメール認証の状態を確認して、もう一度お試しください。';
      notifyListeners();
      return false;
    }
    posts.insert(0, newPost);
    // Credits are granted by the `onPostCreated` trigger once it has validated
    // the files; the balance arrives through the `credits` stream. If the post
    // is rejected there the trigger deletes it and the posts stream drops it.
    lastNoticeMessage = '資料をアップロードしました！確認後、クレジットが付与されます。';
    notifyListeners();
    return true;
  }

  Future<bool> downloadPost(Post post) async {
    if (currentUser == null) return false;
    try {
      final r = await credits.downloadResource(post.id);
      startDownload(r.url);
      lastNoticeMessage = r.charged
          ? '資料のダウンロードを開始しました（1クレジット消費）'
          : '資料のダウンロードを開始しました';
      notifyListeners();
      return true;
    } on CreditException catch (e) {
      lastNoticeMessage = switch (e.kind) {
        CreditErrorKind.insufficient => 'クレジットが足りません。資料をアップロードするとクレジットを獲得できます。',
        CreditErrorKind.notFound => 'この資料は削除されたか、見つかりませんでした。',
        _ => 'ダウンロードに失敗しました。時間をおいて再度お試しください。',
      };
      notifyListeners();
      return false;
    } catch (_) {
      lastNoticeMessage = 'ダウンロードに失敗しました。時間をおいて再度お試しください。';
      notifyListeners();
      return false;
    }
  }

  /// Uploads to the private per-user prefix and returns the storage PATH.
  /// Storage rules allow create-only at `resources/<uid>/<one flat segment>`,
  /// so every attempt (including retries) uses a fresh timestamped name.
  Future<String?> uploadFileToStorage(String fileName, Uint8List fileBytes) async {
    final uid = currentUser?.uid;
    if (uid == null) return null;
    if (fileBytes.length > 20 * 1024 * 1024) {
      lastNoticeMessage = 'ファイルサイズは20MBまでです。';
      notifyListeners();
      return null;
    }
    try {
      final path = PostRepository.resourcePath(uid, fileName, DateTime.now().millisecondsSinceEpoch);
      final contentType = PostRepository.contentTypeFor(fileName);
      await fb_storage.FirebaseStorage.instance
          .ref()
          .child(path)
          .putData(fileBytes, fb_storage.SettableMetadata(contentType: contentType));
      return path;
    } catch (e) {
      lastNoticeMessage = 'ストレージへのファイルアップロードに失敗しました。';
      notifyListeners();
      return null;
    }
  }

  Future<void> deletePost(String postId) async {
    final idx = posts.indexWhere((p) => p.id == postId);
    if (idx == -1) return;
    posts.removeAt(idx);
    await _postRepo.deletePost(postId).catchError((_) {});

    notifyListeners();
  }

  /// Plan 2B: reports go through the `reportPost` callable (one per account per
  /// post, Function-owned); the server hides the post at 3 distinct reporters.
  Future<void> reportPost(String postId, {required ReportCategory category, String detail = ''}) async {
    if (currentUser == null) return;
    try {
      final outcome = await moderation.reportPost(postId, category, detail);
      switch (outcome) {
        case ReportOutcome.hidden:
          posts.removeWhere((p) => p.id == postId);
          lastNoticeMessage = '通報が一定数に達したため、この投稿は非表示になりました。運営が内容を確認します。';
        case ReportOutcome.alreadyHidden:
          posts.removeWhere((p) => p.id == postId);
          lastNoticeMessage = 'この投稿はすでに非表示になっています。';
        case ReportOutcome.duplicate:
          lastNoticeMessage = '既にこの投稿を通報済みです。';
        case ReportOutcome.reported:
          lastNoticeMessage = '通報を受け付けました。ご協力ありがとうございます。';
      }
    } on ModerationException catch (e) {
      lastNoticeMessage = e.isLimit
          ? '本日の通報の上限に達しました。明日以降にもう一度お試しください。'
          : e.isOwnPost
              ? '自分の投稿は通報できません。削除はマイページから行えます。'
              : e.isNotFound
                  ? 'この投稿は削除されたか、見つかりませんでした。'
                  : '通報の送信に失敗しました。メール認証の状態と通信環境を確認してください。';
    } catch (_) {
      lastNoticeMessage = '通報の送信に失敗しました。メール認証の状態と通信環境を確認してください。';
    }
    notifyListeners();
  }

  Future<bool> addMaterialRequest({
    required String subjectId,
    required PostCategory category,
    int? year,
    required String title,
    required String description,
  }) async {
    if (currentUser == null) return false;

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
      costSpent: 0,
      rewardPoints: 0,
      createdAt: DateTime.now(),
    );

    try {
      await _requestRepo.createMaterialRequest(req);
    } catch (_) {
      lastNoticeMessage = 'リクエストの投稿に失敗しました。時間をおいて再度お試しください。';
      notifyListeners();
      return false;
    }
    requests.insert(0, req);

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

    lastNoticeMessage = '貸し出しに応答しました！トークルームを作成しました。';
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
    _inquiryRepo.submitInquiry(inq).catchError((_) {});

    lastNoticeMessage = 'お問い合わせを送信しました。運営からの連絡をお待ちください。';
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
      // C1: the `reviews` create rule pins the document id to
      // `courseSlug + '_' + uid`, so the escaped key has to be ON the document.
      courseSlug: Review.slug(courseKey),
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
}

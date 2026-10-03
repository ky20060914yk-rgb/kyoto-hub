import 'package:flutter/material.dart';
import '../../services/app_store.dart';
import '../onboarding/onboarding_screen.dart';
import '../navigation_root_screen.dart';
import '../moderation/takedown_screen.dart';

class SignupScreen extends StatefulWidget {
  final AppStore store;

  const SignupScreen({super.key, required this.store});

  @override
  State<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends State<SignupScreen> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _referralController = TextEditingController();
  String? _errorMessage;
  bool _isLoading = false;
  bool _isLoginMode = false;
  bool _isVerificationMode = false;

  void _handleSignUp() async {
    setState(() {
      _errorMessage = null;
      _isLoading = true;
    });

    final email = _emailController.text.trim();
    final password = _passwordController.text.trim();
    final ref = _referralController.text.trim();

    bool success = false;
    if (_isLoginMode) {
      success = await widget.store.signInWithPassword(email, password);
    } else {
      success = await widget.store.signUpWithPassword(email, password, referralCode: ref);
    }

    setState(() {
      _isLoading = false;
    });

    if (success) {
      if (_isLoginMode) {
        // If login is successful, check if the email is verified
        final isVerified = widget.store.currentUser?.isVerified ?? false;
        if (!isVerified) {
          // If not verified in Firestore, check Firebase Auth's current state.
          // A network failure here must fall through to the verification screen
          // rather than escaping as an unhandled async error (I2).
          bool verifiedNow = false;
          try {
            verifiedNow = await widget.store.checkEmailVerification();
          } catch (_) {
            verifiedNow = false;
          }
          if (!verifiedNow) {
            setState(() {
              _isVerificationMode = true;
            });
            return;
          }
        }
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(
            builder: (_) => NavigationRootScreen(store: widget.store),
          ),
        );
      } else {
        // SignUp successful - show verification mode
        setState(() {
          _isVerificationMode = true;
        });
      }
    } else {
      setState(() {
        _errorMessage = widget.store.lastNoticeMessage;
      });
    }
  }

  void _checkVerificationStatus() async {
    setState(() {
      _isLoading = true;
    });
    // A network failure inside checkEmailVerification() used to escape and leave
    // _isLoading stuck at true, permanently disabling the button (I2).
    bool verified = false;
    bool failed = false;
    try {
      verified = await widget.store.checkEmailVerification();
    } catch (_) {
      failed = true;
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
    if (!mounted) return;

    if (failed) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('通信エラーが発生しました。通信環境を確認して再試行してください。')),
      );
      return;
    }

    if (verified) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('メールアドレスの認証に成功しました！')),
      );
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => OnboardingScreen(store: widget.store),
        ),
      );
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('まだ認証が完了していません。リンクをタップした後にボタンを押してください。')),
      );
    }
  }

  void _resendEmail() async {
    await widget.store.resendVerificationEmail();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(widget.store.lastNoticeMessage ?? '確認メールを再送信しました。')),
      );
    }
  }

  void _backToLogin() {
    widget.store.logout();
    setState(() {
      _isVerificationMode = false;
      _isLoginMode = true;
      _errorMessage = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF9FAFB),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 32.0),
            child: Container(
              constraints: const BoxConstraints(maxWidth: 440),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withAlpha(12),
                    blurRadius: 20,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              padding: const EdgeInsets.all(28.0),
              child: _isVerificationMode ? _buildVerificationView() : _buildAuthFormView(),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildVerificationView() {
    final email = _emailController.text.trim().isNotEmpty ? _emailController.text.trim() : (widget.store.currentUser?.email ?? '');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Center(
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFFF59E0B).withAlpha(15),
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.mark_email_unread_rounded,
              size: 48,
              color: Color(0xFFF59E0B),
            ),
          ),
        ),
        const SizedBox(height: 18),
        const Text(
          'メールアドレスの検証',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.bold,
            color: Color(0xFF1E293B),
          ),
        ),
        const SizedBox(height: 8),
        Text(
          '$email 宛てに確認メールを送信しました。\nメール内に記載されているリンクをタップして本人確認を完了してください。',
          textAlign: TextAlign.center,
          style: const TextStyle(
            fontSize: 13,
            color: Color(0xFF475569),
            height: 1.5,
          ),
        ),
        const SizedBox(height: 18),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: const Color(0xFFFEF3C7),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: const Color(0xFFFCD34D)),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: const [
              Icon(Icons.warning_amber_rounded, color: Color(0xFFD97706), size: 20),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  '検証を完了するまで、過去問のダウンロードや投稿機能は利用できません。検証後に、ご登録ボーナス3クレジットが付与されます（同じメールアドレスでは1回のみ）。',
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                    color: Color(0xFF92400E),
                    height: 1.4,
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 24),
        ElevatedButton(
          onPressed: _isLoading ? null : _checkVerificationStatus,
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFF0F4C81),
            foregroundColor: Colors.white,
            padding: const EdgeInsets.symmetric(vertical: 14),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(10),
            ),
            elevation: 0,
          ),
          child: _isLoading
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                )
              : const Text(
                  '検証ステータスを更新する (完了確認)',
                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
                ),
        ),
        const SizedBox(height: 16),
        TextButton(
          onPressed: _resendEmail,
          child: const Text(
            '確認メールを再送信する',
            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF0F4C81)),
          ),
        ),
        const SizedBox(height: 8),
        TextButton(
          onPressed: _backToLogin,
          child: const Text(
            'ログイン画面に戻る',
            style: TextStyle(fontSize: 13, color: Color(0xFF64748B)),
          ),
        ),
      ],
    );
  }

  Widget _buildAuthFormView() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Logo & Header
        Center(
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFF0F4C81).withAlpha(15),
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.school_rounded,
              size: 44,
              color: Color(0xFF0F4C81),
            ),
          ),
        ),
        const SizedBox(height: 16),
        const Text(
          '京大生専用プラットフォーム',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 21,
            fontWeight: FontWeight.bold,
            color: Color(0xFF1E293B),
          ),
        ),
        const SizedBox(height: 6),
        const Text(
          '京都大学のアカウントでサインイン',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 14,
            color: Color(0xFF64748B),
          ),
        ),
        const SizedBox(height: 24),

        // Domain Badge Info
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: const Color(0xFFEFF6FF),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: const Color(0xFFBFDBFE)),
          ),
          child: Row(
            children: const [
              Icon(Icons.verified_user_rounded, color: Color(0xFF2563EB), size: 20),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  '@st.kyoto-u.ac.jp アドレスのみ受付けています',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: Color(0xFF1E40AF),
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),

        // Email input
        const Text(
          '大学メールアドレス',
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: Color(0xFF334155),
          ),
        ),
        const SizedBox(height: 6),
        TextField(
          controller: _emailController,
          keyboardType: TextInputType.emailAddress,
          decoration: InputDecoration(
            hintText: 'xxxx@st.kyoto-u.ac.jp',
            prefixIcon: const Icon(Icons.email_outlined, size: 20),
            contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: const BorderSide(color: Color(0xFFCBD5E1)),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: const BorderSide(color: Color(0xFF0F4C81), width: 2),
            ),
          ),
        ),
        const SizedBox(height: 16),

        // Password input
        const Text(
          'パスワード (6文字以上)',
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: Color(0xFF334155),
          ),
        ),
        const SizedBox(height: 6),
        TextField(
          controller: _passwordController,
          obscureText: true,
          decoration: InputDecoration(
            hintText: '••••••••',
            prefixIcon: const Icon(Icons.lock_outline_rounded, size: 20),
            contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: const BorderSide(color: Color(0xFFCBD5E1)),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: const BorderSide(color: Color(0xFF0F4C81), width: 2),
            ),
          ),
        ),

        // Referral code input (SignUp Mode Only)
        if (!_isLoginMode) ...[
          const SizedBox(height: 16),
          const Text(
            '招待コード（任意）',
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: Color(0xFF334155),
            ),
          ),
          const SizedBox(height: 6),
          TextField(
            controller: _referralController,
            maxLength: 16,
            decoration: InputDecoration(
              hintText: '招待コードをお持ちの場合は入力',
              helperText: 'お友だちの招待コードを入力すると、認証完了後にあなたもお友だちも 3クレジット がもらえます',
              helperMaxLines: 2,
              prefixIcon: const Icon(Icons.card_giftcard_outlined, size: 20),
              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: const BorderSide(color: Color(0xFFCBD5E1)),
              ),
            ),
          ),
        ],

        if (_errorMessage != null) ...[
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: const Color(0xFFFEF2F2),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: const Color(0xFFFCA5A5)),
            ),
            child: Text(
              _errorMessage!,
              style: const TextStyle(color: Color(0xFFDC2626), fontSize: 13),
            ),
          ),
        ],

        const SizedBox(height: 24),

        // Action Buttons
        ElevatedButton(
          onPressed: _isLoading ? null : _handleSignUp,
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFF0F4C81),
            foregroundColor: Colors.white,
            padding: const EdgeInsets.symmetric(vertical: 14),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(10),
            ),
            elevation: 0,
          ),
          child: _isLoading
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                )
              : Text(
                  _isLoginMode ? 'ログイン' : '新規アカウント登録',
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
                ),
        ),

        const SizedBox(height: 16),
        TextButton(
          onPressed: () {
            setState(() {
              _isLoginMode = !_isLoginMode;
              _errorMessage = null;
            });
          },
          child: Text(
            _isLoginMode ? '新規登録はこちら (アカウント作成)' : 'すでにアカウントをお持ちの方はこちら (ログイン)',
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: Color(0xFF0F4C81),
            ),
          ),
        ),
        const SizedBox(height: 4),
        TextButton(
          onPressed: () => Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => TakedownScreen(moderation: widget.store.moderation)),
          ),
          child: const Text(
            '担当教員・権利者の方へ（掲載資料の削除依頼）',
            style: TextStyle(fontSize: 12, color: Color(0xFF64748B)),
          ),
        ),
      ],
    );
  }
}

import 'package:flutter/material.dart';

import '../../config/contact.dart';
import '../../services/moderation_service.dart';

const _brand = Color(0xFF0F4C81);

/// 「担当教員・権利者の方はこちら」 — the takedown form (spec §4.3; Plan 2B M-6, M-18).
///
/// Reachable signed out (login screen), from a post's report dialog (post id
/// prefilled) and from お問い合わせ. The server decides what happens: a verified
/// Kyoto University sender hides the named post at once; anyone else files a
/// priority request that the operators review.
class TakedownScreen extends StatefulWidget {
  const TakedownScreen({
    super.key,
    required this.moderation,
    this.initialPostId,
    this.signedInEmail,
    this.operatorEmail = kOperatorContactEmail,
  });

  final ModerationService moderation;
  final String? initialPostId;
  final String? signedInEmail;

  /// Shown when the daily pool is exhausted; empty = point to the contact screen.
  final String operatorEmail;

  @override
  State<TakedownScreen> createState() => _TakedownScreenState();
}

class _TakedownScreenState extends State<TakedownScreen> {
  late final TextEditingController _postId = TextEditingController(text: widget.initialPostId ?? '');
  final TextEditingController _name = TextEditingController();
  late final TextEditingController _email = TextEditingController(text: widget.signedInEmail ?? '');
  final TextEditingController _description = TextEditingController();
  TakedownRole _role = TakedownRole.instructor;
  bool _sending = false;
  String? _error;
  bool _limitHit = false;
  TakedownResult? _done;

  @override
  void dispose() {
    _postId.dispose();
    _name.dispose();
    _email.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final invalid = validateTakedown(name: _name.text, email: _email.text, description: _description.text);
    if (invalid != null) {
      setState(() => _error = invalid);
      return;
    }
    setState(() {
      _sending = true;
      _error = null;
      _limitHit = false;
    });
    try {
      final id = _postId.text.trim();
      final r = await widget.moderation.submitTakedown(
        postIds: id.isEmpty ? const [] : [id],
        requesterName: _name.text,
        role: _role,
        contactEmail: _email.text,
        description: _description.text,
      );
      if (!mounted) return;
      setState(() => _done = r);
    } on ModerationException catch (e) {
      if (!mounted) return;
      setState(() {
        _limitHit = e.isLimit;
        _error = e.isLimit
            ? '本日の受付件数の上限に達しました。お手数ですが、明日以降にもう一度お送りください。'
            : '送信できませんでした。入力内容をご確認のうえ、もう一度お試しください。';
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = '送信できませんでした。通信環境をご確認のうえ、もう一度お試しください。');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  InputDecoration _deco(String label, {String? hint}) => InputDecoration(
        labelText: label,
        hintText: hint,
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
      );

  Widget _doneView(TakedownResult r) {
    final hidden = r.hidden.isNotEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(hidden ? Icons.visibility_off_rounded : Icons.mark_email_read_rounded, color: _brand, size: 40),
        const SizedBox(height: 12),
        Text(
          hidden ? '対象の資料を非表示にしました。' : '削除依頼を受け付けました。',
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Color(0xFF1E293B)),
        ),
        const SizedBox(height: 8),
        const Text(
          '運営が優先して確認し、必要に応じてご入力いただいた連絡先へご連絡します。非表示にした資料は削除されず、運営が判断します。',
          style: TextStyle(fontSize: 13, color: Color(0xFF475569)),
        ),
        const SizedBox(height: 12),
        SelectableText('受付番号: ${r.requestId}', style: const TextStyle(fontSize: 12, color: Color(0xFF64748B))),
        const SizedBox(height: 20),
        OutlinedButton(onPressed: () => Navigator.pop(context), child: const Text('閉じる')),
      ],
    );
  }

  Widget _formView() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text('担当教員・権利者の方へ',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Color(0xFF1E293B))),
        const SizedBox(height: 6),
        const Text(
          '京大InfoHubに掲載された試験問題・資料について、権利者・大学関係者の方からの削除依頼を優先して受け付けます。'
          '京都大学の認証済みアカウントからの依頼では、対象の資料を確認前に非表示にする場合があります。それ以外の依頼は、運営が優先して確認します。',
          style: TextStyle(fontSize: 13, color: Color(0xFF64748B)),
        ),
        const SizedBox(height: 20),
        const Text('ご立場', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: Color(0xFF334155))),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 4,
          children: [
            for (final r in TakedownRole.values)
              ChoiceChip(
                label: Text(r.label, style: const TextStyle(fontSize: 12)),
                selected: r == _role,
                onSelected: (_) => setState(() => _role = r),
              ),
          ],
        ),
        const SizedBox(height: 16),
        TextField(controller: _name, maxLength: kTakedownMaxName, decoration: _deco('お名前・ご所属', hint: '例: 山田 太郎（理学研究科）')),
        const SizedBox(height: 8),
        TextField(
          controller: _email,
          maxLength: kTakedownMaxEmail,
          keyboardType: TextInputType.emailAddress,
          decoration: _deco('ご連絡先メールアドレス'),
        ),
        const SizedBox(height: 8),
        TextField(controller: _postId, decoration: _deco('対象の投稿ID（分かる場合）', hint: '通報画面から開いた場合は入力済みです')),
        const SizedBox(height: 16),
        TextField(
          controller: _description,
          maxLines: 6,
          maxLength: kTakedownMaxDescription,
          decoration: _deco('対象の資料と削除を求める理由', hint: '科目名・年度・試験の種類など、資料を特定できる情報をご記入ください'),
        ),
        if (_error != null) ...[
          const SizedBox(height: 8),
          Text(_error!, style: const TextStyle(color: Color(0xFFDC2626), fontSize: 13)),
          if (_limitHit) ...[
            const SizedBox(height: 6),
            if (widget.operatorEmail.isNotEmpty)
              SelectableText('こちらのメールからご連絡ください: ${widget.operatorEmail}',
                  style: const TextStyle(color: Color(0xFF1E293B), fontSize: 13, fontWeight: FontWeight.bold))
            else
              const Text('お問い合わせ画面からご連絡ください',
                  style: TextStyle(color: Color(0xFF1E293B), fontSize: 13, fontWeight: FontWeight.bold)),
          ],
        ],
        const SizedBox(height: 16),
        SizedBox(
          height: 48,
          child: ElevatedButton(
            onPressed: _sending ? null : _submit,
            style: ElevatedButton.styleFrom(backgroundColor: _brand, foregroundColor: Colors.white),
            child: _sending
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                : const Text('送信する', style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final done = _done;
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(title: const Text('削除依頼フォーム')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 600),
            child: done != null ? _doneView(done) : _formView(),
          ),
        ),
      ),
    );
  }
}

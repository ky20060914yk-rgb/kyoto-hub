import 'package:flutter/material.dart';

import '../services/app_store.dart';
import 'credit_rules_dialog.dart';

/// Wraps the signed-in app (the natural post-login hook) and shows the one-time
/// notice 「ポイント制がクレジット制に変わりました」 to a verified user whose
/// `users/{uid}.policyNoticeV2SeenAt` is absent. Dismissing marks it seen; it
/// never reopens in the session, and a failed flag write never blocks anything.
class PolicyNoticeGate extends StatefulWidget {
  const PolicyNoticeGate({super.key, required this.store, required this.child});

  final AppStore store;
  final Widget child;

  @override
  State<PolicyNoticeGate> createState() => _PolicyNoticeGateState();
}

class _PolicyNoticeGateState extends State<PolicyNoticeGate> {
  bool _open = false;

  @override
  void initState() {
    super.initState();
    widget.store.addListener(_check);
    WidgetsBinding.instance.addPostFrameCallback((_) => _check());
  }

  @override
  void dispose() {
    widget.store.removeListener(_check);
    super.dispose();
  }

  void _check() {
    if (_open || !mounted || !widget.store.shouldShowPolicyNotice) return;
    _open = true;
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) return;
      await showPolicyNoticeDialog(context);
      await widget.store.markPolicyNoticeSeen();
      _open = false;
    });
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

const String kPolicyNoticeTitle = 'ポイント制がクレジット制に変わりました';
const List<String> kPolicyNoticeLines = [
  'これまでのポイント制は終了しました。旧ポイントは引き継がれず、クレジットにも変換されません。',
  'メール認証（ご登録）を完了した方には、3クレジットが付与されます（同じメールアドレスでは1回のみ）。',
  '資料のダウンロードは1つにつき1クレジットです。一度ダウンロードした資料は何度でも無料で再ダウンロードできます。',
];

/// The notice itself; resolves when the user dismisses it with 「閉じる」.
Future<void> showPolicyNoticeDialog(BuildContext context) => showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text(kPolicyNoticeTitle, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final l in kPolicyNoticeLines)
                Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(l, style: const TextStyle(fontSize: 13, height: 1.5))),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => showCreditRulesDialog(ctx), child: const Text('クレジット制度のルールを見る')),
          ElevatedButton(onPressed: () => Navigator.pop(ctx), child: const Text('閉じる')),
        ],
      ),
    );

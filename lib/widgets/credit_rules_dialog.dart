import 'package:flutter/material.dart';

/// Single source of truth for the credit-system rules copy. Amounts mirror
/// `functions/src/common.ts` `CREDITS`; change both together.
const String kCreditRulesTitle = 'クレジット制度のルール';
const String kCreditRulesIntro =
    '京大InfoHubでは、良質な資料を共有し合うコミュニティを維持するため、以下のクレジット制度を採用しています。';
const List<String> kCreditRules = [
  '🎁 ご登録ボーナス: メール認証を完了すると 3クレジット がもらえます。',
  '📥 資料のダウンロード: 過去問・資料は 1つにつき 1クレジット。一度ダウンロードした資料は、何度でも無料で再ダウンロードできます。',
  '📤 資料のアップロード: 承認されると 3クレジット がもらえます（1日3回まで。既に登録済みの年度の重複投稿は対象外）。',
  '✍️ 授業レビュー: 投稿も閲覧も無料です。最初の3件のレビューは 各2クレジット、レビューが5件に満たない科目への投稿は 1クレジット が加算されます（レビューボーナスは1日5回まで）。',
  '🙋 リクエスト: リクエストの投稿は無料。応えてくれた方には 3クレジット が付き、あなたはその資料を無料でダウンロードできます。',
  '👥 友だち招待: あなたの招待コードで友だちが登録（メール認証を完了）すると、あなたも友だちも 3クレジット がもらえます（招待特典は10人まで）。',
  '🚫 クレジットは購入できません。投稿者への還元はなく、削除や通報による没収もありません。',
  '⚠️ 転載・無関係なファイルの投稿は通報され、3件で自動削除されます。権利者の方からの削除要請には速やかに対応します。',
];

/// Shows the credit rules dialog (used by the home and マイページ screens).
Future<void> showCreditRulesDialog(BuildContext context) {
  return showDialog<void>(
    context: context,
    builder: (context) => AlertDialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      title: const Row(
        children: [
          Icon(Icons.stars_rounded, color: Color(0xFFFBBF24), size: 24),
          SizedBox(width: 8),
          Flexible(
            child: Text(kCreditRulesTitle,
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          ),
        ],
      ),
      content: SizedBox(
        width: 420,
        child: ListView(
          shrinkWrap: true,
          children: [
            const Text(kCreditRulesIntro,
                style: TextStyle(fontSize: 12.5, color: Color(0xFF475569))),
            const SizedBox(height: 12),
            for (final rule in kCreditRules)
              Padding(
                padding: const EdgeInsets.only(left: 4, bottom: 8),
                child: Text(rule,
                    style: const TextStyle(
                        fontSize: 12, color: Color(0xFF334155), height: 1.4)),
              ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('閉じる',
              style: TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF0F4C81))),
        ),
      ],
    ),
  );
}

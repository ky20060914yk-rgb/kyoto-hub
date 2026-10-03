import 'package:flutter/material.dart';
import '../../services/app_store.dart';
import '../moderation/takedown_screen.dart';

class ContactScreen extends StatefulWidget {
  final AppStore store;

  const ContactScreen({super.key, required this.store});

  @override
  State<ContactScreen> createState() => _ContactScreenState();
}

class _ContactScreenState extends State<ContactScreen> {
  String _selectedCategory = 'circle_ad';
  final _contentController = TextEditingController();
  final _contactController = TextEditingController();

  final Map<String, String> _categoryLabels = {
    'circle_ad': '① サークル広告の出稿申し込み',
    'point_refund': '② クレジット返却のお問い合わせ (虚偽資料・ダウンロード失敗等の申告)',
    'other': '③ その他お問い合わせ',
  };

  @override
  void initState() {
    super.initState();
    _contactController.text = widget.store.currentUser?.email ?? '';
  }

  void _submitInquiry() {
    final content = _contentController.text.trim();
    final contact = _contactController.text.trim();

    if (content.isEmpty || contact.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('お問い合わせ内容とご連絡先を入力してください')),
      );
      return;
    }

    widget.store.submitInquiry(
      category: _selectedCategory,
      content: content,
      contactInfo: contact,
    );

    _contentController.clear();
    setState(() {});

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(widget.store.lastNoticeMessage ?? '送信完了しました')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0.5,
        title: const Text(
          'お問い合わせ',
          style: TextStyle(color: Color(0xFF1E293B), fontWeight: FontWeight.bold),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20.0),
        child: Container(
          constraints: const BoxConstraints(maxWidth: 600),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                '運営窓口・各種申請',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Color(0xFF1E293B)),
              ),
              const SizedBox(height: 6),
              const Text(
                'お問い合わせ内容は運営チームへ保存・通知され、手動対応を行います。',
                style: TextStyle(fontSize: 13, color: Color(0xFF64748B)),
              ),
              const SizedBox(height: 24),
              Card(
                elevation: 0,
                color: const Color(0xFFFEF2F2),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                  side: const BorderSide(color: Color(0xFFFECACA)),
                ),
                child: ListTile(
                  leading: const Icon(Icons.gavel_rounded, color: Color(0xFFB91C1C)),
                  title: const Text('著作権者・担当教員の方の削除依頼', style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
                  subtitle: const Text('掲載資料の削除はこちらのフォームから優先して受け付けます', style: TextStyle(fontSize: 11.5)),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => TakedownScreen(
                        moderation: widget.store.moderation,
                        signedInEmail: widget.store.currentUser?.email,
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 20),

              // Category Selector
              const Text('お問い合わせカテゴリ', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: Color(0xFF334155))),
              const SizedBox(height: 8),
              ..._categoryLabels.entries.map((entry) {
                final isSelected = _selectedCategory == entry.key;
                return Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  decoration: BoxDecoration(
                    color: isSelected ? const Color(0xFF0F4C81).withAlpha(15) : Colors.white,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: isSelected ? const Color(0xFF0F4C81) : const Color(0xFFE2E8F0)),
                  ),
                  child: RadioListTile<String>(
                    title: Text(
                      entry.value,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                        color: isSelected ? const Color(0xFF0F4C81) : const Color(0xFF1E293B),
                      ),
                    ),
                    value: entry.key,
                    groupValue: _selectedCategory,
                    activeColor: const Color(0xFF0F4C81),
                    onChanged: (val) {
                      if (val != null) setState(() => _selectedCategory = val);
                    },
                  ),
                );
              }),
              const SizedBox(height: 20),

              // Multiline Content Input
              const Text('お問い合わせ内容 (複数行入力対応)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: Color(0xFF334155))),
              const SizedBox(height: 8),
              TextField(
                controller: _contentController,
                maxLines: 5,
                decoration: InputDecoration(
                  hintText: _selectedCategory == 'point_refund'
                      ? 'ダウンロードした資料に虚偽があった場合や、参考書取引が不成立だった状況を具体的にご入力ください。運営が手動で返却対応いたします。'
                      : 'お問い合わせ内容を詳細にご入力ください...',
                  fillColor: Colors.white,
                  filled: true,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: Color(0xFFCBD5E1))),
                  focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: Color(0xFF0F4C81), width: 2)),
                ),
              ),
              const SizedBox(height: 16),

              // Contact Info Input
              const Text('ご連絡先 (メールアドレスまたは電話番号)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: Color(0xFF334155))),
              const SizedBox(height: 8),
              TextField(
                controller: _contactController,
                decoration: InputDecoration(
                  hintText: '例: t.kyoto@kyoto-u.ac.jp',
                  fillColor: Colors.white,
                  filled: true,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: Color(0xFFCBD5E1))),
                ),
              ),
              const SizedBox(height: 24),

              // Submit Button
              SizedBox(
                width: double.infinity,
                height: 48,
                child: ElevatedButton(
                  onPressed: _submitInquiry,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF0F4C81),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  child: const Text('送信する', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                ),
              ),
              const SizedBox(height: 32),

              // Sent Inquiries History
              if (widget.store.inquiries.isNotEmpty) ...[
                const Text('過去の送信履歴', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Color(0xFF1E293B))),
                const SizedBox(height: 10),
                ...widget.store.inquiries.reversed.map((inq) {
                  return Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    elevation: 0,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8), side: const BorderSide(color: Color(0xFFE2E8F0))),
                    child: ListTile(
                      title: Text(_categoryLabels[inq.category] ?? inq.category, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
                      subtitle: Text(inq.content, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12)),
                      trailing: const Text('受付済', style: TextStyle(color: Color(0xFF10B981), fontWeight: FontWeight.bold, fontSize: 11)),
                    ),
                  );
                }),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

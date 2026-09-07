import 'dart:async';
import 'dart:html' as html;
import 'dart:typed_data';

class PickedFile {
  final String name;
  final Uint8List bytes;

  PickedFile({required this.name, required this.bytes});
}

Future<PickedFile?> pickFile() async {
  final completer = Completer<PickedFile?>();
  final uploadInput = html.FileUploadInputElement();
  uploadInput.accept = '.pdf,.doc,.docx,.png,.jpg,.jpeg';
  uploadInput.click();

  uploadInput.onChange.listen((e) {
    final files = uploadInput.files;
    if (files == null || files.isEmpty) {
      if (!completer.isCompleted) completer.complete(null);
      return;
    }

    final file = files.first;
    final reader = html.FileReader();
    reader.readAsArrayBuffer(file);
    reader.onLoadEnd.listen((e) {
      final bytes = reader.result as Uint8List;
      if (!completer.isCompleted) {
        completer.complete(PickedFile(name: file.name, bytes: bytes));
      }
    });
  });

  return completer.future;
}

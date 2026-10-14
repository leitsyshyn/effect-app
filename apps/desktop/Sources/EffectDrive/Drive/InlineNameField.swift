import AppKit
import SwiftUI

struct InlineNameField: NSViewRepresentable {
    let initialName: String
    var selectStem = false
    var isSaving = false
    var error: String?
    var onChange: () -> Void = {}
    let onCommit: (_ name: String, _ fromBlur: Bool) -> Void
    let onCancel: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> Field {
        let field = Field(string: initialName)
        field.delegate = context.coordinator
        field.font = .systemFont(ofSize: NSFont.systemFontSize)
        field.isBezeled = false
        field.isBordered = false
        field.drawsBackground = true
        field.backgroundColor = .textBackgroundColor
        field.focusRingType = .exterior
        field.lineBreakMode = .byClipping
        field.cell?.isScrollable = true
        field.cell?.wraps = false
        field.setContentHuggingPriority(.defaultLow, for: .horizontal)
        field.initialSelection = selectStem
            ? initialName.utf16.count - ConflictNaming.extensionSuffix(of: initialName).utf16.count
            : initialName.utf16.count
        return field
    }

    func updateNSView(_ field: Field, context: Context) {
        context.coordinator.parent = self
        field.isEditable = !isSaving
        field.toolTip = error
        if error != nil, !isSaving, field.currentEditor() == nil {
            field.window?.makeFirstResponder(field)
        }
    }

    final class Coordinator: NSObject, NSTextFieldDelegate {
        var parent: InlineNameField

        init(_ parent: InlineNameField) { self.parent = parent }

        func controlTextDidChange(_ notification: Notification) {
            parent.onChange()
        }

        func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
            switch selector {
            case #selector(NSResponder.insertNewline(_:)):
                parent.onCommit(control.stringValue, false)
                return true
            case #selector(NSResponder.cancelOperation(_:)):
                parent.onCancel()
                return true
            default:
                return false
            }
        }

        func controlTextDidEndEditing(_ notification: Notification) {
            guard let field = notification.object as? NSTextField else { return }
            parent.onCommit(field.stringValue, true)
        }
    }

    final class Field: NSTextField {
        var initialSelection = 0
        private var didFocus = false

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            guard let window, !didFocus else { return }
            didFocus = true
            DispatchQueue.main.async { [weak self] in
                guard let self, window.makeFirstResponder(self) else { return }
                self.currentEditor()?.selectedRange = NSRange(location: 0, length: self.initialSelection)
                self.scrollToVisible(self.bounds)
            }
        }
    }
}

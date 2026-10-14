import AppKit
import SwiftUI

enum Layout {
    static let barHeight: CGFloat = 30
    static let inset: CGFloat = 12
    static let spacing: CGFloat = 8
    static let sheetInset: CGFloat = 20
}

struct ItemIcon: View {
    let systemImage: String
    let isFolder: Bool

    init(_ item: DriveItem) {
        self.init(systemImage: item.systemImage, isFolder: item.isFolder)
    }

    init(systemImage: String, isFolder: Bool) {
        self.systemImage = systemImage
        self.isFolder = isFolder
    }

    var body: some View {
        Image(systemName: systemImage)
            .foregroundStyle(isFolder ? Color.accentColor : Color.secondary)
            .frame(width: 18)
    }
}

struct CrumbButtonStyle: ButtonStyle {
    var isTargeted = false

    func makeBody(configuration: Configuration) -> some View {
        CrumbLabel(label: configuration.label, isPressed: configuration.isPressed, isTargeted: isTargeted)
    }

    private struct CrumbLabel<Label: View>: View {
        let label: Label
        let isPressed: Bool
        let isTargeted: Bool
        @State private var isHovered = false

        var body: some View {
            label
                .lineLimit(1)
                .foregroundStyle(isHovered || isTargeted ? .primary : .secondary)
                .padding(.horizontal, 4)
                .padding(.vertical, 2)
                .background(RoundedRectangle(cornerRadius: 4).fill(fill))
                .contentShape(Rectangle())
                .onHover { isHovered = $0 }
        }

        private var fill: AnyShapeStyle {
            if isTargeted { return AnyShapeStyle(Color.accentColor.opacity(0.2)) }
            return isHovered || isPressed ? AnyShapeStyle(.quaternary) : AnyShapeStyle(.clear)
        }
    }
}

struct CurrentCrumb: View {
    let title: String

    var body: some View {
        Text(title)
            .fontWeight(.medium)
            .lineLimit(1)
            .padding(.horizontal, 4)
    }
}

enum ToolbarSearch {
    static let width: CGFloat = 200

    @MainActor
    static func item(in window: NSWindow?) -> NSSearchToolbarItem? {
        window?.toolbar?.items.lazy.compactMap { $0 as? NSSearchToolbarItem }.first
    }

    @MainActor
    static func focus() {
        item(in: NSApp.keyWindow)?.beginSearchInteraction()
    }
}

struct ToolbarSearchWidth: NSViewRepresentable {
    func makeNSView(context: Context) -> Probe { Probe() }

    func updateNSView(_ probe: Probe, context: Context) { probe.apply() }

    final class Probe: NSView {
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            apply()
        }

        func apply() {
            DispatchQueue.main.async { [weak self] in
                guard let item = ToolbarSearch.item(in: self?.window),
                      item.preferredWidthForSearchField != ToolbarSearch.width else { return }
                item.preferredWidthForSearchField = ToolbarSearch.width
            }
        }
    }
}

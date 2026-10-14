import SwiftUI

struct DriveActions {
    var newFolder: () -> Void
    var upload: () -> Void
    var open: (() -> Void)?
    var rename: (() -> Void)?
    var download: (() -> Void)?
    var moveTo: (() -> Void)?
    var delete: (() -> Void)?
    var back: (() -> Void)?
    var forward: (() -> Void)?
    var refresh: () -> Void
    var filter: () -> Void
    var isPreviewShown: Bool
    var togglePreview: () -> Void
}

extension FocusedValues {
    @Entry var driveActions: DriveActions?
}

struct DriveCommands: Commands {
    @FocusedValue(\.driveActions) private var actions

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New folder") { actions?.newFolder() }
                .keyboardShortcut("n", modifiers: [.command, .shift])
                .disabled(actions == nil)
            Button("Upload files…") { actions?.upload() }
                .keyboardShortcut("u", modifiers: .command)
                .disabled(actions == nil)
            Divider()
            Button("Open") { actions?.open?() }
                .keyboardShortcut(.downArrow, modifiers: .command)
                .disabled(actions?.open == nil)
            Button("Download…") { actions?.download?() }
                .disabled(actions?.download == nil)
            Divider()
            Button("Rename") { actions?.rename?() }
                .disabled(actions?.rename == nil)
            Button("Move to…") { actions?.moveTo?() }
                .keyboardShortcut("m", modifiers: [.command, .shift])
                .disabled(actions?.moveTo == nil)
            Button("Delete…") { actions?.delete?() }
                .keyboardShortcut(.delete, modifiers: .command)
                .disabled(actions?.delete == nil)
        }
        CommandGroup(after: .textEditing) {
            Button("Filter by name") { actions?.filter() }
                .keyboardShortcut("f", modifiers: .command)
                .disabled(actions == nil)
        }
        CommandGroup(before: .toolbar) {
            Button(actions?.isPreviewShown == true ? "Hide preview" : "Show preview") { actions?.togglePreview() }
                .keyboardShortcut("p", modifiers: [.command, .shift])
                .disabled(actions == nil)
            Button("Refresh") { actions?.refresh() }
                .keyboardShortcut("r", modifiers: .command)
                .disabled(actions == nil)
            Divider()
        }
        CommandMenu("Go") {
            Button("Back") { actions?.back?() }
                .keyboardShortcut("[", modifiers: .command)
                .disabled(actions?.back == nil)
            Button("Forward") { actions?.forward?() }
                .keyboardShortcut("]", modifiers: .command)
                .disabled(actions?.forward == nil)
            Divider()
            Button("Enclosing folder") { actions?.back?() }
                .keyboardShortcut(.upArrow, modifiers: .command)
                .disabled(actions?.back == nil)
        }
    }
}

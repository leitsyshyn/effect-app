import AppKit
import SwiftUI

@main
struct EffectDriveApp: App {
    @NSApplicationDelegateAdaptor private var appDelegate: AppDelegate
    @State private var model = AppModel(environment: .live())

    var body: some Scene {
        Window("Effect Drive", id: "main") {
            RootView(model: model)
                .frame(minWidth: 860, minHeight: 520)
                .tint(.brandAccent)
        }
        .commands {
            DriveCommands()
        }

        MenuBarExtra {
            SyncMenu(model: model)
        } label: {
            Image(systemName: model.sync?.status?.state.systemImage ?? "externaldrive")
        }
    }
}

extension Color {
    static let brandAccent = Color(nsColor: NSColor(name: "BrandAccent") { appearance in
        appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            ? NSColor(srgbRed: 0x7B / 255, green: 0x93 / 255, blue: 0xF2 / 255, alpha: 1)
            : NSColor(srgbRed: 0x3E / 255, green: 0x5B / 255, blue: 0xDB / 255, alpha: 1)
    })
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

private struct SyncMenu: View {
    let model: AppModel

    var body: some View {
        if let sync = model.sync {
            if let status = sync.status {
                Text("\(status.state.title)\(status.detail.map { " — \($0)" } ?? "")")
                if let folder = status.linkedFolder { Text(folder) }
                Divider()
                Button("Sync now") { Task { await sync.syncNow() } }
                    .disabled(status.linkedFolder == nil)
            } else {
                Text(AppError.daemonHint)
            }
        } else {
            Text("Not signed in")
        }
        Divider()
        Button("Quit Effect Drive") { NSApp.terminate(nil) }
    }
}

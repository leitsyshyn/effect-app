import AppKit
import SwiftUI

struct SyncView: View {
    @Bindable var model: SyncViewModel
    @State private var confirmUnlink = false

    var body: some View {
        Form {
            switch model.connection {
            case .connecting:
                Section { ProgressView("Connecting to the sync daemon…") }
            case .unavailable(let error):
                Section {
                    Label {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(error == .daemonUnreachable ? "Sync daemon not running" : "Sync daemon unavailable")
                                .font(.headline)
                            Text(error.action == .showDaemonHint ? error.message : "\(error.message)\n\(AppError.daemonHint)")
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                        }
                    } icon: {
                        Image(systemName: "bolt.horizontal.circle").foregroundStyle(.orange)
                    }
                    Text("The rest of the app keeps working. This panel reconnects automatically.")
                        .foregroundStyle(.secondary)
                }
            case .connected:
                if let status = model.status {
                    connected(status)
                } else {
                    Section { ProgressView("Loading sync status…") }
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Sync")
        .confirmationDialog("Unlink this folder?", isPresented: $confirmUnlink, titleVisibility: .visible) {
            Button("Unlink", role: .destructive) { Task { await model.unlink() } }
        } message: {
            Text("Synchronization stops. No files are deleted, either in the folder on this Mac or in your drive.")
        }
        .alert(model.alert?.title ?? "", isPresented: isPresent($model.alert), presenting: model.alert) { _ in
            Button("OK") {}
        } message: { alert in
            Text(alert.message)
        }
    }

    @ViewBuilder
    private func connected(_ status: DaemonStatus) -> some View {
        Section {
            HStack(spacing: 12) {
                Image(systemName: status.state.systemImage)
                    .font(.title)
                    .foregroundStyle(color(for: status.state))
                    .frame(width: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text(status.state.title).font(.headline)
                    if let detail = status.detail { Text(detail).foregroundStyle(.secondary) }
                    if let lastSynced = status.lastSyncedAt {
                        Text("Last synced \(Formatting.relative(lastSynced))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                if model.isWorking { ProgressView().controlSize(.small) }
            }
        }

        Section("Linked folder") {
            if let folder = status.linkedFolder {
                LabeledContent {
                    Button("Show in Finder") { model.revealLinkedFolder() }
                } label: {
                    Label(folder, systemImage: "folder")
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .textSelection(.enabled)
                }
                HStack {
                    Button("Sync now") { Task { await model.syncNow() } }
                        .disabled(status.state == .paused)
                    if status.state == .paused {
                        Button("Resume") { Task { await model.resume() } }
                    } else {
                        Button("Pause") { Task { await model.pause() } }
                    }
                    Spacer()
                    Button("Change folder…") { chooseFolder() }
                    Button("Unlink…") { confirmUnlink = true }
                }
            } else {
                Text("Choose a folder on this Mac to keep in sync with your drive, including subfolders.")
                    .foregroundStyle(.secondary)
                Button("Link folder…") { chooseFolder() }
                    .disabled(status.state == .signedOut)
            }
        }

        if status.linkedFolder != nil {
            if !model.issues.isEmpty {
                Section("Needs attention (\(model.issues.count))") {
                    ForEach(model.issues) { issue in
                        VStack(alignment: .leading, spacing: 4) {
                            Label {
                                Text(issue.path).help(issue.path)
                            } icon: {
                                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                            }
                            Text(issue.detail).fixedSize(horizontal: false, vertical: true)
                            if let copy = issue.localCopy {
                                Text("Your version: \(copy)").font(.caption).foregroundStyle(.secondary)
                            }
                            HStack {
                                Button("Show in Finder") { model.reveal(issue) }
                                Button("Dismiss") { Task { await model.dismiss(issue) } }
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }
            }

            if !model.pending.isEmpty {
                Section("Waiting to sync (\(model.pending.count))") {
                    ForEach(model.pending) { item in
                        VStack(alignment: .leading, spacing: 2) {
                            Label(item.path, systemImage: "arrow.triangle.2.circlepath")
                                .help(item.path)
                            Text(item.lastError.map { "Retrying: \($0)" } ?? "Waiting since \(Formatting.timestamp(item.since))")
                                .font(.caption)
                                .foregroundStyle(item.lastError == nil ? Color.secondary : Color.orange)
                        }
                    }
                }
            }
        }
    }

    private func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        panel.prompt = "Link"
        panel.message = "Choose the folder to keep in sync with your drive."
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task { await model.link(url) }
    }

    private func color(for state: SyncState) -> Color {
        switch state {
        case .upToDate: .green
        case .syncing: .blue
        case .attention, .offline, .paused: .orange
        case .blocked: .red
        case .signedOut, .unlinked: .secondary
        }
    }
}

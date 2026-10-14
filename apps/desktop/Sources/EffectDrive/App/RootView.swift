import SwiftUI

struct RootView: View {
    let model: AppModel

    var body: some View {
        Group {
            switch model.phase {
            case .restoring:
                ProgressView("Signing in…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .signedOut:
                SignInView(model: model)
            case .unavailable(let message):
                ContentUnavailableView {
                    Label("Can't reach the server", systemImage: "network.slash")
                } description: {
                    Text(message)
                } actions: {
                    Button("Try again") { Task { await model.restore() } }
                        .keyboardShortcut(.defaultAction)
                    Button("Sign out") { Task { await model.signOut() } }
                }
            case .signedIn:
                if let drive = model.drive, let sync = model.sync, let user = model.user {
                    MainView(model: model, user: user, drive: drive, sync: sync)
                }
            }
        }
        .task { await model.restore() }
    }
}

private enum Section: Hashable {
    case drive
    case sync
}

struct MainView: View {
    let model: AppModel
    let user: AccountUser
    let drive: DriveViewModel
    let sync: SyncViewModel
    @State private var section: Section? = .drive

    var body: some View {
        NavigationSplitView {
            List(selection: $section) {
                Label("My Drive", systemImage: "externaldrive")
                    .tag(Section.drive)
                Label {
                    Text("Sync")
                } icon: {
                    Image(systemName: sync.status?.state.systemImage ?? "bolt.horizontal.circle")
                }
                .badge(sync.status?.issueCount ?? 0)
                .tag(Section.sync)
            }
            .navigationSplitViewColumnWidth(min: 170, ideal: 190)
            .safeAreaInset(edge: .bottom) {
                AccountFooter(user: user) { Task { await model.signOut() } }
            }
        } detail: {
            switch section ?? .drive {
            case .drive: DriveView(model: drive, sync: sync) { section = .sync }
            case .sync: SyncView(model: sync)
            }
        }
    }
}

private struct AccountFooter: View {
    let user: AccountUser
    let signOut: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Layout.spacing) {
            HStack(spacing: Layout.spacing) {
                Image(systemName: "person.crop.circle.fill")
                    .font(.title2)
                    .foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 0) {
                    Text(user.name).lineLimit(1)
                    Text(user.email).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            .help("\(user.name) (\(user.email))")
            Button(action: signOut) {
                Text("Sign out").frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
        .padding(Layout.inset)
    }
}

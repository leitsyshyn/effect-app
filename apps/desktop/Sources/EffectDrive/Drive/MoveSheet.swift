import SwiftUI

struct MoveSheet: View {
    let items: [DriveItem]
    let startIn: String?
    let load: (String?) async throws(AppError) -> FolderListing
    let onMove: (_ parentId: String?, _ name: String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var location: String?
    @State private var listing: FolderListing?
    @State private var listed: String??
    @State private var error: String?

    init(
        items: [DriveItem],
        startIn: String?,
        load: @escaping (String?) async throws(AppError) -> FolderListing,
        onMove: @escaping (_ parentId: String?, _ name: String) -> Void
    ) {
        self.items = items
        self.startIn = startIn
        self.load = load
        self.onMove = onMove
        _location = State(initialValue: startIn)
    }

    private var movingIds: Set<String> { Set(items.map(\.id)) }
    private var currentParent: String? { items.first?.parentId }
    private var isLoaded: Bool { listed == .some(location) && listing != nil }

    private var locationName: String {
        location == nil ? "My Drive" : (isLoaded ? listing?.path.last?.name : nil) ?? "this folder"
    }

    private var folders: [DriveItem] {
        (listing?.nodes ?? []).filter { $0.isFolder && !movingIds.contains($0.id) }
    }

    private var title: String {
        items.count == 1 ? "Move “\(items[0].name)”" : "Move \(items.count) items"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Layout.inset) {
            Text(title).font(.headline).lineLimit(2)
            Text("Open the folder you want to move to, then confirm.")
                .foregroundStyle(.secondary)
            breadcrumb
            content
                .frame(height: 240)
                .frame(maxWidth: .infinity)
                .background(.background, in: RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.separator))
            HStack(spacing: Layout.spacing) {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Move to \(locationName)") {
                    dismiss()
                    onMove(location, locationName)
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!isLoaded || location == currentParent)
            }
        }
        .padding(Layout.sheetInset)
        .frame(width: 440)
        .task(id: location) { await loadLocation() }
    }

    private var breadcrumb: some View {
        let path = isLoaded ? listing?.path ?? [] : []
        return HStack(spacing: 2) {
            if path.isEmpty, location == nil {
                CurrentCrumb(title: "My Drive")
            } else {
                Button("My Drive") { location = nil }.buttonStyle(CrumbButtonStyle())
            }
            ForEach(Array(path.enumerated()), id: \.element.id) { index, folder in
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                if index == path.count - 1 {
                    CurrentCrumb(title: folder.name)
                } else {
                    Button(folder.name) { location = folder.id }.buttonStyle(CrumbButtonStyle())
                }
            }
        }
        .padding(.horizontal, -4)
    }

    @ViewBuilder
    private var content: some View {
        if let error {
            Label(error, systemImage: "exclamationmark.triangle")
                .foregroundStyle(.secondary)
                .padding(Layout.inset)
        } else if !isLoaded {
            ProgressView()
        } else if folders.isEmpty {
            Text("No folders inside \(locationName).")
                .foregroundStyle(.secondary)
                .padding(Layout.inset)
        } else {
            List(folders) { folder in
                Button { location = folder.id } label: {
                    HStack(spacing: 6) {
                        ItemIcon(folder)
                        Text(folder.name).lineLimit(1)
                        Spacer()
                        Image(systemName: "chevron.right").foregroundStyle(.secondary)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .listStyle(.plain)
        }
    }

    private func loadLocation() async {
        let target = location
        error = nil
        do {
            let result = try await load(target)
            guard target == location else { return }
            listing = result
            listed = .some(target)
        } catch {
            guard target == location else { return }
            self.error = error.message
        }
    }
}

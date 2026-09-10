import Foundation
import EventKit

// Reads today's events from macOS Calendar and prints JSON on stdout.
//
// Contract with the Node side: this ALWAYS exits 0 for expected states, including
// permission denial, and reports the state in the JSON. Node parses stdout only and
// never branches on exit codes, so a missing calendar grant degrades the digest to a
// labelled placeholder instead of failing the run.

struct Bridge {
    static let store = EKEventStore()

    static func emit(_ object: [String: Any]) -> Never {
        if let data = try? JSONSerialization.data(withJSONObject: object, options: []),
           let text = String(data: data, encoding: .utf8) {
            print(text)
        } else {
            print(#"{"status":"error","message":"could not serialise output"}"#)
        }
        exit(0)
    }

    static func statusName(_ s: EKAuthorizationStatus) -> String {
        switch s {
        case .notDetermined: return "notDetermined"
        case .restricted:    return "restricted"
        case .denied:        return "denied"
        case .fullAccess:    return "ok"
        case .writeOnly:     return "denied"   // cannot read events
        case .authorized:    return "ok"
        @unknown default:    return "error"
        }
    }

    /// A bare command-line tool has no run loop, so the completion handler for the
    /// access request never fires on its own. Block on a semaphore until it does.
    static func requestAccess() -> Bool {
        let gate = DispatchSemaphore(value: 0)
        var granted = false
        if #available(macOS 14.0, *) {
            store.requestFullAccessToEvents { ok, _ in granted = ok; gate.signal() }
        } else {
            store.requestAccess(to: .event) { ok, _ in granted = ok; gate.signal() }
        }
        // Generous ceiling: the user may take a while to answer the system dialog.
        _ = gate.wait(timeout: .now() + 120)
        return granted
    }

    static func iso(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.string(from: date)
    }

    static func parse(_ s: String) -> Date? {
        let full = ISO8601DateFormatter()
        full.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = full.date(from: s) { return d }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: s)
    }

    static func arg(_ name: String) -> String? {
        let args = CommandLine.arguments
        guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
        return args[i + 1]
    }

    static func has(_ flag: String) -> Bool { CommandLine.arguments.contains(flag) }

    static func run() {
        let current = EKEventStore.authorizationStatus(for: .event)
        let authorised = statusName(current) == "ok"

        if has("--request-access") {
            if authorised { emit(["status": "ok", "message": "calendar access already granted"]) }
            let granted = requestAccess()
            emit(["status": granted ? "ok" : "denied",
                  "message": granted ? "calendar access granted"
                                     : "access refused; grant it in System Settings > Privacy & Security > Calendars"])
        }

        // The scheduled run always passes --no-prompt, so a 06:30 job can never raise a
        // modal dialog on a machine nobody is sitting at.
        if !authorised {
            if has("--no-prompt") { emit(["status": statusName(current)]) }
            if !requestAccess() { emit(["status": "denied"]) }
        }

        if has("--list-calendars") {
            let list = store.calendars(for: .event).map { c -> [String: Any] in
                ["title": c.title, "source": c.source?.title ?? "", "allowsModify": c.allowsContentModifications]
            }
            emit(["status": "ok", "calendars": list])
        }

        guard let startText = arg("--start"), let endText = arg("--end"),
              let start = parse(startText), let end = parse(endText) else {
            emit(["status": "error", "message": "--start and --end are required as ISO-8601 instants"])
        }

        var warnings: [String] = []
        var chosen: [EKCalendar]? = nil

        if let names = arg("--calendars"), !names.isEmpty {
            let wanted = names.split(separator: ",").map {
                $0.trimmingCharacters(in: .whitespaces).lowercased()
            }
            let all = store.calendars(for: .event)
            let matched = all.filter { wanted.contains($0.title.lowercased()) }
            // Report unmatched names rather than silently dropping them.
            for w in wanted where !all.contains(where: { $0.title.lowercased() == w }) {
                warnings.append("no calendar named \"\(w)\"")
            }
            if !matched.isEmpty { chosen = matched }
        }

        // A nil calendar list means every calendar.
        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: chosen)
        let events = store.events(matching: predicate).sorted {
            if $0.isAllDay != $1.isAllDay { return $0.isAllDay && !$1.isAllDay }
            return $0.startDate < $1.startDate
        }

        let payload = events.map { e -> [String: Any] in
            [
                "title": e.title ?? "(untitled)",
                "start": iso(e.startDate),
                "end": iso(e.endDate),
                "allDay": e.isAllDay,
                "location": e.location ?? "",
                "calendar": e.calendar?.title ?? "",
                "status": e.status == .canceled ? "canceled" : "confirmed",
            ]
        }

        emit(["status": "ok", "events": payload, "warnings": warnings])
    }
}

Bridge.run()

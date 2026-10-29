import Foundation

// A widget snapshot is published only once all four data items from the most
// recently started refresh are present. Older in-flight responses are ignored.
struct RefreshBatches {
    private var batches: [String:(data:[String:[String:Any]],started:Date)] = [:]
    private var latest:String?
    mutating func reset() { batches.removeAll();latest=nil }
    mutating func begin(_ id:String, now:Date = Date()) {
        batches=batches.filter { now.timeIntervalSince($0.value.started) < 120 }
        guard batches[id] == nil else { return }
        if batches.count >= 8,let oldest=batches.min(by:{$0.value.started < $1.value.started})?.key { batches.removeValue(forKey:oldest) }
        batches[id]=(data:[:],started:now);latest=id
    }
    mutating func complete(_ id:String, values:[String:[String:Any]]) -> NativeDashboardSnapshot? {
        guard var entry=batches[id] else { return nil }
        entry.data.merge(values) { _, new in new };batches[id]=entry
        guard let card=entry.data["card"],let net=entry.data["net"],let lighting=entry.data["lighting"],let air=entry.data["air"] else { return nil }
        batches.removeValue(forKey:id)
        guard latest == id else { return nil }
        return NativeDashboardSnapshot(card:card,net:net,lighting:lighting,air:air)
    }
}

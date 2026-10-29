import Foundation
import Network
import Security
import os

enum LocalSetupError: Error { case widgetAgent, widgetReset, keychain }

struct LocalRequest {
    let method:String
    let target:String
    let headers:[String:String]
    let body:Data
}
struct LocalResponse {
    var status:Int = 200
    var contentType:String = "application/json; charset=utf-8"
    var headers:[String:String] = [:]
    var body:Data = Data()
    static func json(_ object:[String:Any],status:Int = 200) -> LocalResponse {
        LocalResponse(status:status,body:(try? JSONSerialization.data(withJSONObject:object)) ?? Data("{}".utf8))
    }
}

actor LocalBackend {
    let resources:URL
    let nativeToken:String
    let sessionToken:String
    private var client:NativeSchoolClient?
    private var current:NativeSchoolSession?
    private var dashboard:NativeDashboard?
    private var autoLogin = false
    private var widgetWarning:String?
    private var port:UInt16 = 0
    private var generation = UUID()
    private var batches = RefreshBatches()
    private let performance = Logger(subsystem:"edu.buaa.campusbalance",category:"performance")

    init(resources:URL,nativeToken:String,sessionToken:String) { self.resources=resources;self.nativeToken=nativeToken;self.sessionToken=sessionToken }
    func setPort(_ value:UInt16) { port=value }
    private func authenticated(_ request:LocalRequest) -> Bool {
        guard current != nil, let cookie=request.headers["cookie"] else { return false }
        return cookie.split(separator:";").contains { $0.trimmingCharacters(in:.whitespaces) == "campus_native_session="+sessionToken }
    }
    private func fail(_ error:String,status:Int) -> LocalResponse { .json(["error":error],status:status) }
    private var widgetAvailable: Bool { FileManager.default.fileExists(atPath: resources.appendingPathComponent("CampusWidgetSnapshot").path) }
    private func prepare(_ school:NativeSchoolSession, client:NativeSchoolClient, remember:Bool, same:Bool, password:String?) throws {
        var reuseWidget = false
        #if CAMPUS_ISOLATED_TEST
        guard !remember else { throw CampusHistoryError.invalid }
        #else
        if remember && widgetAvailable { reuseWidget = WidgetAgents.isCurrent(user:school.user,same:same,resources:resources) }
        if widgetAvailable && !reuseWidget {
            do { try WidgetAgents.disable() } catch { throw LocalSetupError.widgetAgent }
            do { try WidgetSnapshots.clear() } catch { throw LocalSetupError.widgetReset }
        }
        if remember, let password { do { try CampusKeychain.save(user:school.user,password:password) } catch { throw LocalSetupError.keychain } }
        #endif
        generation=UUID();batches.reset()
        current=school;self.client=client;autoLogin=remember
        dashboard=NativeDashboard(client:client,current:school,autoLogin:remember)
        widgetWarning=nil
        if remember && widgetAvailable && !reuseWidget {
            do { try WidgetAgents.enable(user:school.user,networkSamePassword:same,resources:resources) }
            catch { widgetWarning="小组件后台更新尚未启用" }
        }
    }
    func respond(_ request:LocalRequest) async -> LocalResponse {
        let host="127.0.0.1:\(port)"
        guard request.headers["host"] == host else { return fail("请求来源不受支持",status:403) }
        let path=String(request.target.split(separator:"?",maxSplits:1).first ?? "")
        if ["/","/index.html","/dashboard","/dashboard.html"].contains(path),request.method == "GET" {
            let name=path.contains("dashboard") ? "dashboard.html" : "index.html"
            guard let data=try? Data(contentsOf:resources.appendingPathComponent("app/public/"+name)) else { return fail("页面不可用",status:404) }
            return LocalResponse(contentType:"text/html; charset=utf-8",body:data)
        }
        if let origin=request.headers["origin"],origin != "http://"+host { return fail("请求来源不受支持",status:403) }
        let body=(try? JSONSerialization.jsonObject(with:request.body)) as? [String:Any] ?? [:]
        if path == "/api/auth" {
            if request.method == "GET" { return .json(["authenticated":authenticated(request)],status:authenticated(request) ? 200 : 401) }
            guard request.method == "POST" else { return fail("不支持此请求",status:405) }
            if body["action"] as? String == "logout" {
                guard authenticated(request) else { return fail("请重新登录",status:401) }
                do { if widgetAvailable { try WidgetAgents.disable();try WidgetSnapshots.clear() };if autoLogin,let user=current?.user {try CampusKeychain.remove(user:user)} }
                catch {return fail("无法关闭小组件后台更新，请重试",status:503)}
                generation=UUID();batches.reset()
                current=nil;client=nil;dashboard=nil;autoLogin=false
                var response=LocalResponse.json(["ok":true]);response.headers["Set-Cookie"]="campus_native_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";return response
            }
            let candidate=NativeSchoolClient()
            let started=Date()
            do {
                let school:NativeSchoolSession
                var remember=false,same=false,password:String?
                if body["action"] as? String == "school-session" {
                    guard request.headers["origin"] == nil,request.headers["x-campus-native-token"] == nativeToken,
                          let cookies=body["cookies"] as? [[String:String]] else { return fail("请求来源不受支持",status:403) }
                    school=try await candidate.loginWithCookies(cookies)
                } else {
                    guard let user=body["username"] as? String,let pass=body["password"] as? String else { return fail("请输入账号和密码",status:400) }
                    remember=body["autoLogin"] as? Bool == true;same=body["networkSamePassword"] as? Bool == true;password=pass
                    school=try await candidate.login(user:user,password:pass,networkSamePassword:same)
                }
                let setupStarted=Date()
                try prepare(school,client:candidate,remember:remember,same:same,password:password)
                performance.info("login local setup ms=\(Int(Date().timeIntervalSince(setupStarted)*1000), privacy: .public)")
                performance.info("login total ms=\(Int(Date().timeIntervalSince(started)*1000), privacy: .public)")
                var response=LocalResponse.json(["ok":true]);response.headers["Set-Cookie"]="campus_native_session=\(sessionToken); Path=/; HttpOnly; SameSite=Lax";return response
            } catch LocalSetupError.widgetAgent { return fail("无法停止小组件后台更新，请重试",status:503)
            } catch LocalSetupError.widgetReset { return fail("无法重置小组件数据，请重试",status:503)
            } catch LocalSetupError.keychain { return fail("无法保存到钥匙串，请解锁钥匙串后重试",status:503)
            } catch { return fail("登录失败或学校认证暂不可用，请重试",status:401) }
        }
        guard authenticated(request),let current,let dashboard else { return fail("请重新登录",status:401) }
        if path == "/api/settings" {
            if request.method == "GET" { return .json(["settings":(try? JSONSerialization.jsonObject(with:JSONEncoder().encode(LocalSettings.read(user:current.user)))) ?? [:]]) }
            guard request.method == "POST",request.headers["origin"] == "http://"+host else { return fail("请求来源不受支持",status:403) }
            do {
                let settings=try JSONDecoder().decode(DormSettings.self,from:request.body)
                let saved = try LocalSettings.write(user:current.user,value:settings)
                return .json(["settings":(try JSONSerialization.jsonObject(with:JSONEncoder().encode(saved)))])
            } catch { return fail("请检查宿舍名称和电表号",status:400) }
        }
        if path == "/api/data/part",request.method == "GET" {
            guard let components=URLComponents(string:"http://127.0.0.1"+request.target),
                  let part=components.queryItems?.first(where:{$0.name == "part"})?.value,
                  ["card","net","electricity"].contains(part),
                  let batch=components.queryItems?.first(where:{$0.name == "batch"})?.value,
                  UUID(uuidString:batch) != nil else { return fail("请求参数错误",status:400) }
            let requestGeneration=generation, started=Date()
            batches.begin(batch,now:started)
            let values=await dashboard.part(part)
            guard generation == requestGeneration else { return fail("请重新登录",status:401) }
            performance.info("data part=\(part, privacy:.public) ms=\(Int(Date().timeIntervalSince(started)*1000), privacy:.public)")
            if let complete=batches.complete(batch,values:values) {
                #if !CAMPUS_ISOLATED_TEST
                if widgetAvailable { try? WidgetSnapshots.publish(complete) }
                #endif
            }
            var response:[String:Any]=["data":values]
            if let warning=widgetWarning { response["widgetWarning"]=warning }
            return .json(response)
        }
        if path == "/api/data",request.method == "GET" {
            let snapshot=await dashboard.refresh()
            var data=snapshot.data
            if let warning=widgetWarning { data["widgetWarning"]=warning }
            #if !CAMPUS_ISOLATED_TEST
            if widgetAvailable { do { try WidgetSnapshots.publish(snapshot) } catch { data["widgetWarning"]="小组件数据共享暂不可用" } }
            #endif
            return .json(["data":data])
        }
        return fail("未找到",status:404)
    }
}

@main enum NativeServer {
    static func main() throws {
        guard CommandLine.arguments.count == 2 else { exit(1) }
        let resources=URL(fileURLWithPath:CommandLine.arguments[1],isDirectory:true)
        guard let secret=String(data:FileHandle.standardInput.readDataToEndOfFile(),encoding:.utf8),secret.count >= 32 else { exit(1) }
        var random=[UInt8](repeating:0,count:32);guard SecRandomCopyBytes(kSecRandomDefault,random.count,&random) == errSecSuccess else { exit(1) }
        let token=random.map { String(format:"%02x",$0) }.joined()
        let backend=LocalBackend(resources:resources,nativeToken:secret,sessionToken:token)
        let parameters=NWParameters.tcp;parameters.requiredLocalEndpoint = .hostPort(host:"127.0.0.1",port:.any)
        let listener=try NWListener(using:parameters),queue=DispatchQueue(label:"edu.buaa.campusbalance.server")
        listener.stateUpdateHandler={ state in
            if case .ready = state,let port=listener.port?.rawValue {
                Task { await backend.setPort(port); print("READY \(port)");fflush(stdout) }
            }
            if case .failed = state { exit(1) }
        }
        listener.newConnectionHandler={ connection in connection.start(queue:queue);read(connection,buffer:Data(),backend:backend) }
        listener.start(queue:queue)
        if let raw = ProcessInfo.processInfo.environment["CAMPUS_PARENT_PID"], let parent = Int32(raw), parent > 1 {
            let timer = DispatchSource.makeTimerSource(queue:queue)
            timer.schedule(deadline:.now() + 15,repeating:15)
            timer.setEventHandler { if kill(parent,0) != 0 && errno == ESRCH { exit(0) } }
            timer.resume()
            withExtendedLifetime(timer) { dispatchMain() }
        } else { dispatchMain() }
    }
    static func read(_ connection:NWConnection,buffer:Data,backend:LocalBackend) {
        connection.receive(minimumIncompleteLength:1,maximumLength:16384) { chunk,_,done,error in
            var data=buffer;if let chunk {data.append(chunk)}
            guard error == nil,data.count <= 20000 else {connection.cancel();return}
            let marker=Data("\r\n\r\n".utf8)
            guard let range=data.range(of:marker) else {if done {connection.cancel()} else {read(connection,buffer:data,backend:backend)};return}
            guard range.lowerBound <= 8192,let head=String(data:data[..<range.lowerBound],encoding:.utf8) else {connection.cancel();return}
            let lines=head.components(separatedBy:"\r\n"),parts=lines[0].split(separator:" ")
            guard parts.count == 3 else {connection.cancel();return}
            var headers:[String:String]=[:]
            for line in lines.dropFirst() { let pair=line.split(separator:":",maxSplits:1);if pair.count == 2 {headers[String(pair[0]).lowercased()]=pair[1].trimmingCharacters(in:.whitespaces)} }
            let length=Int(headers["content-length"] ?? "0") ?? -1
            guard length >= 0,length <= 10000,headers["transfer-encoding"] == nil else {connection.cancel();return}
            let body=data[range.upperBound...]
            if body.count < length {if done {connection.cancel()} else {read(connection,buffer:data,backend:backend)};return}
            let request=LocalRequest(method:String(parts[0]),target:String(parts[1]),headers:headers,body:Data(body.prefix(length)))
            Task { let response=await backend.respond(request);send(response,connection:connection) }
        }
    }
    static func send(_ response:LocalResponse,connection:NWConnection) {
        let reasons=[200:"OK",400:"Bad Request",401:"Unauthorized",403:"Forbidden",404:"Not Found",405:"Method Not Allowed",503:"Service Unavailable"]
        var text="HTTP/1.1 \(response.status) \(reasons[response.status] ?? "Error")\r\nContent-Type: \(response.contentType)\r\nContent-Length: \(response.body.count)\r\nCache-Control: no-store\r\nConnection: close\r\n"
        for (key,value) in response.headers { text += "\(key): \(value)\r\n" }
        var data=Data((text+"\r\n").utf8);data.append(response.body)
        connection.send(content:data,completion:.contentProcessed { _ in connection.cancel() })
    }
}

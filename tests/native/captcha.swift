import Foundation

// Synthetic school responses exercise the native transport and form submission;
// no real account or external requests are used here.
final class CaptchaSchoolProtocol: URLProtocol {
    static var posted:[String:String] = [:]
    static var reject = false
    static let png=Data(base64Encoded:"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=")!
    static let html="<html><body><form id='loginForm' action='/login'><input name='execution' value='native-flow'><input name='type' value='username_password'><input name='_eventId' value='submit'><input name='captcha'></form><script>config.captcha = {id:'native-captcha'};</script></body></html>"
    override class func canInit(with request:URLRequest)->Bool { true }
    override class func canonicalRequest(for request:URLRequest)->URLRequest { request }
    override func startLoading() {
        let url=request.url!
        var responseURL=url,code=200,type="text/html",body=Data()
        if url.path == "/captcha" { type="image/png";body=Self.png }
        else if url.path == "/api/user" { type="application/json";body=Data(#"{"success":true,"data":{"account":"verified"}}"#.utf8) }
        else if request.httpMethod == "POST" {
            let bytes:Data
            if let direct=request.httpBody { bytes=direct }
            else if let stream=request.httpBodyStream {
                stream.open();var result=Data(),buffer=[UInt8](repeating:0,count:1024)
                while stream.hasBytesAvailable {let count=stream.read(&buffer,maxLength:buffer.count);if count<=0 {break};result.append(contentsOf:buffer.prefix(count))};stream.close();bytes=result
            } else { bytes=Data() }
            Self.posted=Dictionary(uniqueKeysWithValues:(URLComponents(string:"?"+(String(data:bytes,encoding:.utf8) ?? ""))?.queryItems ?? []).map {($0.name,$0.value ?? "")})
            if Self.reject { code=401;body=Data((Self.html+"<div id='errorDiv'><p>验证码错误 secret-account</p></div>").utf8) }
            else {responseURL=URL(string:"https://www.cc-pay.cn/done")!;body=Data("signed in".utf8)}
        } else {responseURL=URL(string:"https://sso.buaa.edu.cn/login?service=registered")!;body=Data(Self.html.utf8)}
        let response=HTTPURLResponse(url:responseURL,statusCode:code,httpVersion:"HTTP/1.1",headerFields:["Content-Type":type])!
        client?.urlProtocol(self,didReceive:response,cacheStoragePolicy:.notAllowed)
        client?.urlProtocol(self,didLoad:body);client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
@main enum NativeCaptchaTests {
    static func main() async throws {
        let config=URLSessionConfiguration.ephemeral;config.protocolClasses=[CaptchaSchoolProtocol.self]
        let school=NativeSchoolClient(http:SchoolHTTP(configuration:config))
        let first=try await school.beginLogin()
        precondition(first["required"] as? Bool == true)
        precondition((first["image"] as? String)?.hasPrefix("data:image/png;base64,") == true)
        precondition(first["challengeId"] as? String != nil)
        let session=try await school.login(user:"testuser",password:"native+&secret",networkSamePassword:false,captcha:" AbC2 ")
        precondition(session.user == "testuser")
        precondition(CaptchaSchoolProtocol.posted["execution"] == "native-flow")
        precondition(CaptchaSchoolProtocol.posted["captcha"] == "abc2")
        precondition(CaptchaSchoolProtocol.posted["password"] == "native+&secret")
        CaptchaSchoolProtocol.reject=true
        _ = try await school.beginLogin()
        do {
            _ = try await school.login(user:"testuser",password:"secret",networkSamePassword:false,captcha:"wrong")
            fatalError("rejected CAPTCHA issued a session")
        } catch {
            precondition(CampusDiagnostics.issue(error).code == .verificationRequired)
            precondition(school.retryChallenge?["required"] as? Bool == true)
            precondition(school.retryChallenge?["challengeId"] as? String != first["challengeId"] as? String)
        }
        CaptchaSchoolProtocol.posted=[:]
        do {
            _ = try await NativeSchoolClient(http:SchoolHTTP(configuration:config)).login(user:"testuser",password:"secret",networkSamePassword:false)
            fatalError("automatic login submitted without CAPTCHA")
        } catch {precondition(CampusDiagnostics.issue(error).code == .verificationRequired)}
        precondition(CaptchaSchoolProtocol.posted.isEmpty)
        print("Native CAPTCHA transport and retry tests passed")
    }
}

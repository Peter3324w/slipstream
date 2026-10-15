package dev.slipstream.app;

import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Android's half of main/vod-access.ts and the master-playlist trick.
 *
 * Twitch's VOD CDN (CloudFront) sends no CORS headers at all, and the live
 * playlists answer 403 to a request carrying an Origin they do not expect -
 * measured: no Origin is 200, "null" and "file://" are 403. The WebView always
 * sends one. On the desktop main rewrites the response; a WebView has no such
 * hook, so these hosts are fetched here instead, natively and without an Origin,
 * and handed back with the header the page needs. Bytes stream straight through:
 * nothing is copied into JS, which is the reason not to do this from api.ts.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (isVideoHost(request)) return relay(request);
                return super.shouldInterceptRequest(view, request);
            }
        });
    }

    private static boolean isVideoHost(WebResourceRequest request) {
        if (!"GET".equalsIgnoreCase(request.getMethod())) return false;
        String scheme = request.getUrl().getScheme();
        String host = request.getUrl().getHost();
        if (host == null || !"https".equals(scheme)) return false;
        return host.endsWith(".ttvnw.net") || host.endsWith(".cloudfront.net");
    }

    private static WebResourceResponse relay(WebResourceRequest request) {
        Map<String, String> cors = new HashMap<>();
        cors.put("Access-Control-Allow-Origin", "*");
        try {
            HttpURLConnection conn = (HttpURLConnection) new URL(request.getUrl().toString()).openConnection();
            conn.setConnectTimeout(15_000);
            conn.setReadTimeout(20_000);
            for (Map.Entry<String, String> h : request.getRequestHeaders().entrySet()) {
                String name = h.getKey();
                // The Origin is the whole problem; the rest are the WebView's own.
                if ("origin".equalsIgnoreCase(name) || "referer".equalsIgnoreCase(name)) continue;
                conn.setRequestProperty(name, h.getValue());
            }

            int status = conn.getResponseCode();
            InputStream body = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (body == null) body = new ByteArrayInputStream(new byte[0]);

            Map<String, String> headers = new HashMap<>(cors);
            for (Map.Entry<String, List<String>> h : conn.getHeaderFields().entrySet()) {
                if (h.getKey() == null || h.getValue().isEmpty()) continue;
                if (h.getKey().toLowerCase().startsWith("access-control-")) continue;
                headers.put(h.getKey(), h.getValue().get(0));
            }

            String type = conn.getContentType();
            String mime = type == null ? "application/octet-stream" : type.split(";")[0].trim();
            String reason = conn.getResponseMessage();
            if (reason == null || reason.isEmpty()) reason = status < 400 ? "OK" : "Error";
            // WebResourceResponse refuses 3xx; redirects were already followed above.
            if (status >= 300 && status < 400) status = 502;
            return new WebResourceResponse(mime, null, status, reason, headers, body);
        } catch (IOException e) {
            // Still a response with the header, so hls.js sees a network error it can
            // retry rather than an opaque CORS failure it cannot read.
            return new WebResourceResponse("text/plain", "utf-8", 502, "Bad Gateway", cors,
                new ByteArrayInputStream(new byte[0]));
        }
    }
}

package dev.slipstream.app;

import android.content.pm.ActivityInfo;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The Android half of fullscreen, and of turning the phone.
 *
 * The WebView cannot do element fullscreen: Capacitor's BridgeWebChromeClient
 * hides the custom view as soon as it is offered, so `requestFullscreen()` on
 * the stage resolves and shows nothing. Immersive mode has to be the activity's
 * own, and the rotation has to be asked for by name - the same two things
 * Xtra does in its player fragment, for the same reason.
 */
@CapacitorPlugin(name = "PlayerDisplay")
public class PlayerDisplayPlugin extends Plugin {

    @PluginMethod
    public void setOrientation(PluginCall call) {
        String value = call.getString("value", "unspecified");
        int requested;
        if ("landscape".equals(value)) {
            requested = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
        } else if ("portrait".equals(value)) {
            requested = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT;
        } else {
            requested = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
        }
        getActivity().setRequestedOrientation(requested);
        call.resolve();
    }

    @PluginMethod
    public void setImmersive(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
            getActivity().getWindow(),
            getActivity().getWindow().getDecorView()
        );
        // Swiping still brings the bars back for a moment, so the gesture that
        // usually means "back" or "notifications" is not simply taken away.
        controller.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        );
        if (enabled) {
            controller.hide(WindowInsetsCompat.Type.systemBars());
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars());
        }
        call.resolve();
    }
}

package ai.eburon.orbit.meeting;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static MainActivity instance;
    private ActivityResultLauncher<Intent> screenCaptureLauncher;

    public static MainActivity getInstance() {
        return instance;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        instance = this;

        screenCaptureLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
                    Intent serviceIntent = new Intent(this, MediaProjectionService.class);
                    serviceIntent.putExtra("resultCode", result.getResultCode());
                    serviceIntent.putExtra("data", result.getData());
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        startForegroundService(serviceIntent);
                    } else {
                        startService(serviceIntent);
                    }
                } else {
                    sendFrameToWebView("error:PermissionDenied");
                }
            }
        );

        // Register custom JS interface on WebView
        runOnUiThread(() -> {
            if (this.bridge != null && this.bridge.getWebView() != null) {
                this.bridge.getWebView().addJavascriptInterface(new Object() {
                    @JavascriptInterface
                    public void startScreenShare() {
                        runOnUiThread(() -> {
                            MediaProjectionManager mediaProjectionManager = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
                            if (mediaProjectionManager != null) {
                                Intent intent = mediaProjectionManager.createScreenCaptureIntent();
                                screenCaptureLauncher.launch(intent);
                            }
                        });
                    }

                    @JavascriptInterface
                    public void stopScreenShare() {
                        runOnUiThread(() -> {
                            Intent serviceIntent = new Intent(MainActivity.this, MediaProjectionService.class);
                            stopService(serviceIntent);
                        });
                    }
                }, "NativeScreenShare");
            }
        });
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        instance = null;
    }

    public void sendFrameToWebView(String frameData) {
        runOnUiThread(() -> {
            if (this.bridge != null && this.bridge.getWebView() != null) {
                this.bridge.getWebView().evaluateJavascript(
                    "if (window.onNativeScreenShareFrame) window.onNativeScreenShareFrame('" + frameData + "');",
                    null
                );
            }
        });
    }
}

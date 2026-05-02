package com.dtech.proxybrowser;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.DownloadManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.dtech.proxybrowser.utils.AssetUtils;
import com.dtech.proxybrowser.utils.NodeRunner;

import java.io.IOException;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;
import java.util.List;

public class MainActivity extends AppCompatActivity {
    private static final String TAG = "MainActivity";
    private NodeRunner nodeRunner;
    private TextView statusText, ipText;
    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        statusText = findViewById(R.id.statusText);
        ipText = findViewById(R.id.ipText);
        EditText urlInput = findViewById(R.id.urlInput);
        Button goButton = findViewById(R.id.goButton);
        Button downloadCertButton = findViewById(R.id.downloadCertButton);
        Button openDashButton = findViewById(R.id.openDashButton);
        webView = findViewById(R.id.webview);

        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);

        webView.setWebViewClient(new WebViewClient() {
            @SuppressLint("WebViewClientOnReceivedSslError")
            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                // Only bypass SSL errors for our local proxy dashboard
                String url = view.getUrl();
                if (url != null && (url.contains("127.0.0.1") || url.contains("localhost"))) {
                    handler.proceed();
                } else {
                    super.onReceivedSslError(view, handler, error);
                }
            }
        });

        goButton.setOnClickListener(v -> {
            String url = urlInput.getText().toString().trim();
            if (url.isEmpty()) return;
            if (!url.startsWith("http://") && !url.startsWith("https://")) {
                url = "https://" + url;
            }
            webView.loadUrl(url);
            hideKeyboard();
        });

        openDashButton.setOnClickListener(v -> {
            webView.loadUrl("http://127.0.0.1:3000");
        });

        downloadCertButton.setOnClickListener(v -> {
            if (checkStoragePermission()) {
                downloadCertificate();
            } else {
                requestStoragePermission();
            }
        });

        // Initialize Node.js
        initNodeJs();
    }

    private void initNodeJs() {
        new Thread(() -> {
            try {
                // 1. Copy assets
                String appDataDir = getFilesDir().getAbsolutePath();
                AssetUtils.copyAssetFolder(this, "bin", appDataDir + "/bin");
                AssetUtils.copyAssetFolder(this, "nodejs-project", appDataDir + "/nodejs-project");

                // 2. Start Node.js
                nodeRunner = new NodeRunner(this);
                nodeRunner.startNode("src/server.js");

                runOnUiThread(() -> {
                    statusText.setText("Proxy Status: Running");
                    String ip = getIPAddress(true);
                    ipText.setText("IP: " + ip + " | Proxy Port: 8082");

                    // Wait a bit for server to start then load dashboard
                    new Handler(Looper.getMainLooper()).postDelayed(() -> {
                        webView.loadUrl("http://127.0.0.1:3000");
                    }, 2000);
                });

            } catch (IOException e) {
                Log.e(TAG, "Failed to initialize Node.js", e);
                runOnUiThread(() -> statusText.setText("Proxy Status: Error"));
            }
        }).start();
    }

    private boolean checkStoragePermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return true; // Scoped storage
        }
        return ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    private void requestStoragePermission() {
        ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, 100);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == 100) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                downloadCertificate();
            } else {
                Toast.makeText(this, "Permission denied to write to storage", Toast.LENGTH_SHORT).show();
            }
        }
    }

    private void downloadCertificate() {
        String url = "http://127.0.0.1:3000/cert";
        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
        request.setTitle("D-TECH-Root-CA.pem");
        request.setDescription("Downloading CA Certificate");
        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "D-TECH-Root-CA.pem");

        DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager != null) {
            manager.enqueue(request);
            Toast.makeText(this, "Downloading Certificate...", Toast.LENGTH_SHORT).show();
        }
    }

    private String getIPAddress(boolean useIPv4) {
        try {
            List<NetworkInterface> interfaces = Collections.list(NetworkInterface.getNetworkInterfaces());
            for (NetworkInterface intf : interfaces) {
                List<InetAddress> addrs = Collections.list(intf.getInetAddresses());
                for (InetAddress addr : addrs) {
                    if (!addr.isLoopbackAddress()) {
                        String sAddr = addr.getHostAddress();
                        boolean isIPv4 = sAddr.indexOf(':') < 0;
                        if (useIPv4) {
                            if (isIPv4) return sAddr;
                        } else {
                            if (!isIPv4) {
                                int delim = sAddr.indexOf('%'); // drop ip6 zone suffix
                                return delim < 0 ? sAddr.toUpperCase() : sAddr.substring(0, delim).toUpperCase();
                            }
                        }
                    }
                }
            }
        } catch (Exception ignored) { }
        return "";
    }

    private void hideKeyboard() {
        View view = this.getCurrentFocus();
        if (view != null) {
            InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
            imm.hideSoftInputFromWindow(view.getWindowToken(), 0);
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (nodeRunner != null) {
            nodeRunner.stopNode();
        }
    }
}

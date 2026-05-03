package com.dtech.proxybrowser.utils;

import android.content.Context;
import android.os.Build;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;

public class NodeRunner {
    private static final String TAG = "NodeRunner";
    private Process nodeProcess;
    private final Context context;

    public NodeRunner(Context context) {
        this.context = context;
    }

    public void startNode(String scriptPath) {
        new Thread(() -> {
            try {
                String appDataDir = context.getFilesDir().getAbsolutePath();
                String nodeDir = appDataDir + "/bin";
                String nodeJsProjectDir = appDataDir + "/nodejs-project";

                String arch = getArch();
                String nodeBinaryPath = nodeDir + "/" + arch + "/node";

                // Ensure binary is executable
                new File(nodeBinaryPath).setExecutable(true);

                Log.d(TAG, "Starting Node.js: " + nodeBinaryPath + " " + scriptPath);

                ProcessBuilder pb = new ProcessBuilder(
                        nodeBinaryPath,
                        nodeJsProjectDir + "/" + scriptPath
                );

                // Set working directory to nodejs-project
                pb.directory(new File(nodeJsProjectDir));

                // Redirect error stream to output stream
                pb.redirectErrorStream(true);

                nodeProcess = pb.start();

                BufferedReader reader = new BufferedReader(new InputStreamReader(nodeProcess.getInputStream()));
                String line;
                while ((line = reader.readLine()) != null) {
                    Log.d(TAG, "[Node.js] " + line);
                }

                int exitCode = nodeProcess.waitFor();
                Log.d(TAG, "Node.js process exited with code: " + exitCode);

            } catch (IOException | InterruptedException e) {
                Log.e(TAG, "Error running Node.js", e);
            }
        }).start();
    }

    public void stopNode() {
        if (nodeProcess != null) {
            nodeProcess.destroy();
            nodeProcess = null;
        }
    }

    private String getArch() {
        String arch = Build.SUPPORTED_ABIS[0];
        if (arch.contains("arm64") || arch.contains("aarch64")) {
            return "arm64-v8a";
        } else if (arch.contains("armeabi")) {
            return "armeabi-v7a";
        }
        return "arm64-v8a"; // Default to arm64
    }
}

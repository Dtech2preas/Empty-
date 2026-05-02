package com.dtech.proxybrowser.utils;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

public class AssetUtils {
    private static final String TAG = "AssetUtils";

    public static void copyAssetFolder(Context context, String assetPath, String targetPath) throws IOException {
        AssetManager assetManager = context.getAssets();
        String[] assets = assetManager.list(assetPath);
        if (assets == null) return;

        File targetDir = new File(targetPath);
        if (!targetDir.exists()) {
            targetDir.mkdirs();
        }

        for (String asset : assets) {
            String fullAssetPath = assetPath.isEmpty() ? asset : assetPath + "/" + asset;
            String fullTargetPath = targetPath + "/" + asset;

            String[] subAssets = assetManager.list(fullAssetPath);
            if (subAssets != null && subAssets.length > 0) {
                // It's a folder
                copyAssetFolder(context, fullAssetPath, fullTargetPath);
            } else {
                // It's a file
                copyAssetFile(context, fullAssetPath, fullTargetPath);
            }
        }
    }

    public static void copyAssetFile(Context context, String assetFilePath, String targetFilePath) throws IOException {
        Log.d(TAG, "Copying asset: " + assetFilePath + " to " + targetFilePath);
        try (InputStream in = context.getAssets().open(assetFilePath);
             OutputStream out = new FileOutputStream(targetFilePath)) {
            byte[] buffer = new byte[1024];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
        }
    }
}
